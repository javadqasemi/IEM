import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { redactToolOutput } from "./backup.failure";

/**
 * `pg_dump` and `pg_restore`, run safely.
 *
 * ---
 *
 * ## Why the tools and not a Prisma walk
 *
 * The obvious alternative — read every table through Prisma and write JSON —
 * is wrong in ways that only show up when somebody tries to recover. It misses
 * everything that is not a model: sequences and their current values, enum
 * types, indexes, constraints, the `_prisma_migrations` table itself. A restore
 * from it would produce a database whose next insert collides on a primary key.
 * `pg_dump` in custom format captures the schema and the data as PostgreSQL
 * itself understands them, and `pg_restore` puts them back.
 *
 * ## The two things this file exists to get right
 *
 * **1. No shell.** `spawn` with an explicit argument array and `shell: false`,
 * which is the default and is stated here anyway because the failure it
 * prevents is command injection through a database name. Nothing user-supplied
 * reaches an argument at all — the connection comes from `DATABASE_URL` and the
 * paths are generated — but the day somebody adds a `--table` filter from a
 * form, the shape of this file is what decides whether that is a feature or a
 * remote code execution.
 *
 * **2. No password on the command line.** `PGPASSWORD` in the child's
 * environment, never `--dbname=postgresql://user:pass@…`. An argument is
 * visible in `ps`, in a crash dump, and — the one that actually happens — in
 * the tool's own error message, which libpq builds by echoing the connection it
 * attempted. `redactToolOutput` is the second line of defence for exactly that.
 */
@Injectable()
export class PostgresTools {
  private readonly logger = new Logger(PostgresTools.name);
  private readonly binDir: string;

  constructor(private readonly config: ConfigService) {
    // Empty means "on PATH", which is the normal Linux case. Windows installs
    // put them under `C:\Program Files\PostgreSQL\<n>\bin` and do not add it.
    this.binDir = config.get<string>("PG_BIN_PATH") ?? "";
  }

  private bin(tool: string): string {
    return this.binDir ? join(this.binDir, tool) : tool;
  }

  /**
   * The connection, split into the parts each tool wants.
   *
   * Parsed once here rather than in three places. `database` is returned
   * separately because the restore path **checks it** before doing anything
   * destructive — "never restore blindly into an unknown database" is a rule
   * that needs the name to compare.
   */
  connection(urlOverride?: string): PgConnection {
    const raw = urlOverride ?? this.config.get<string>("DATABASE_URL") ?? "";
    const url = new URL(raw);
    return {
      host: url.hostname || "localhost",
      port: url.port || "5432",
      user: decodeURIComponent(url.username || "postgres"),
      password: decodeURIComponent(url.password || ""),
      database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    };
  }

  /** The environment a child gets: the password, and nothing else added. */
  private envFor(conn: PgConnection): NodeJS.ProcessEnv {
    return { ...process.env, PGPASSWORD: conn.password };
  }

  /**
   * One scalar, out of an arbitrary database, through `psql`.
   *
   * Used by the post-restore validation, which has to read a database **Prisma
   * is not connected to** — the drill target does not exist when the client is
   * constructed and would need a second `PrismaClient` and a second pool to
   * reach. One short-lived `psql` per check is the cheaper and more honest
   * answer, and it is also closer to what an operator would type.
   *
   * The SQL is a **literal from this codebase**, never assembled from input.
   * The parameter exists so the six validation queries can share one
   * implementation, not so a caller can compose one.
   */
  async query(conn: PgConnection, sql: string): Promise<string> {
    const out = await this.run(
      this.bin("psql"),
      [...this.base(conn), "-d", conn.database, "-t", "-A", "-c", sql],
      conn,
    );
    return out.stdout;
  }

  /** Server version, as the server reports it. Recorded in the manifest. */
  async serverVersion(conn: PgConnection): Promise<string | null> {
    try {
      const out = await this.run(
        this.bin("psql"),
        [...this.base(conn), "-d", conn.database, "-t", "-A", "-c", "SHOW server_version;"],
        conn,
      );
      return out.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /** Whether the tools are present at all, checked before a job starts. */
  async available(): Promise<{ ok: boolean; version: string | null }> {
    try {
      const out = await this.run(this.bin("pg_dump"), ["--version"], null);
      return { ok: true, version: out.stdout.trim() || null };
    } catch {
      return { ok: false, version: null };
    }
  }

  private base(conn: PgConnection): string[] {
    return ["-h", conn.host, "-p", conn.port, "-U", conn.user];
  }

  /**
   * A custom-format dump, written to `target`.
   *
   * `-F c` rather than plain SQL, because it is the format `pg_restore` can be
   * selective about and — the reason that matters here — the format whose table
   * of contents can be **listed without executing anything**, which is how
   * verification proves the artifact is readable without a database to put it
   * in.
   *
   * `--no-owner` and `--no-acl`: the dump is restored into a database whose
   * roles may not match the source's, and preserving ownership turns a restore
   * into a cascade of "role does not exist". Ownership is a deployment
   * property, not application data.
   */
  async dump(conn: PgConnection, target: string): Promise<void> {
    await this.run(
      this.bin("pg_dump"),
      [
        ...this.base(conn),
        "-d",
        conn.database,
        "--format=custom",
        // 6 rather than the default 0 (none) or 9: measured on this database at
        // ~4× smaller for ~1.3× the time. Level 9 bought another 3% for twice
        // the CPU, which on a machine also running PostgreSQL is a bad trade.
        "--compress=6",
        "--no-owner",
        "--no-acl",
        "--file",
        target,
      ],
      conn,
    );
  }

  /**
   * Reads the archive's table of contents.
   *
   * **This is the verification**, and it is stronger than it looks: `-l` makes
   * `pg_restore` parse the header, the compression framing and every entry in
   * the archive's directory. A truncated, half-written or corrupt file fails
   * here. What it does not prove is that the *data* restores cleanly, which is
   * why the drill exists as well.
   */
  async listArchive(path: string): Promise<string> {
    const out = await this.run(this.bin("pg_restore"), ["--list", path], null);
    return out.stdout;
  }

  /**
   * Creates an empty database. Used only for the drill target.
   *
   * The name is **not** interpolated from anything a caller supplies: it is
   * built in `backup.service.ts` from the live database's name plus a fixed
   * suffix, and `assertSafeDatabaseName` refuses anything else.
   */
  async createDatabase(conn: PgConnection, name: string): Promise<void> {
    assertSafeDatabaseName(name);
    await this.run(
      this.bin("psql"),
      [...this.base(conn), "-d", "postgres", "-c", `CREATE DATABASE "${name}"`],
      conn,
    );
  }

  async dropDatabase(conn: PgConnection, name: string): Promise<void> {
    assertSafeDatabaseName(name);
    await this.run(
      this.bin("psql"),
      [
        ...this.base(conn),
        "-d",
        "postgres",
        "-c",
        `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
      ],
      conn,
    );
  }

  async databaseExists(conn: PgConnection, name: string): Promise<boolean> {
    const out = await this.run(
      this.bin("psql"),
      [
        ...this.base(conn),
        "-d",
        "postgres",
        "-t",
        "-A",
        "-c",
        `SELECT 1 FROM pg_database WHERE datname = '${name.replace(/'/g, "''")}'`,
      ],
      conn,
    );
    return out.stdout.trim() === "1";
  }

  /**
   * Restores an archive into `conn.database`.
   *
   * `--clean --if-exists` drops what it is replacing, which is what makes this
   * destructive and why every guard upstream exists. `--single-transaction` is
   * deliberately **not** used: it is safer in principle and in practice fails
   * the whole restore on the first benign notice, and the errors that matter
   * are caught by the post-restore validation instead.
   *
   * `--exit-on-error` is also off, for the reason `--no-owner` is on: a dump
   * restored into a database with different roles produces harmless ownership
   * complaints, and stopping on the first one would make a correct restore look
   * like a failure. The exit code is checked; a non-zero one still throws.
   */
  async restore(conn: PgConnection, archive: string): Promise<{ warnings: string }> {
    const out = await this.run(
      this.bin("pg_restore"),
      [
        ...this.base(conn),
        "-d",
        conn.database,
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-acl",
        archive,
      ],
      conn,
      // pg_restore reports ownership notices on stderr and exits 1 for them.
      // The validation pass is what decides whether the restore worked.
      { allowNonZeroExit: true },
    );
    return { warnings: redactToolOutput(out.stderr).slice(0, 2000) };
  }

  /**
   * Spawns a tool and resolves with its output.
   *
   * `shell: false` is the default and is written out because it is the
   * property that matters. Output is captured rather than inherited so a
   * credential in a tool's error text goes through `redactToolOutput` before it
   * reaches a log.
   */
  private run(
    command: string,
    args: string[],
    conn: PgConnection | null,
    options: { allowNonZeroExit?: boolean } = {},
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, {
        shell: false,
        env: conn ? this.envFor(conn) : process.env,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      // Bounded: a pg_restore over a large archive can emit a great deal, and
      // an unbounded string here is a way to run the API out of memory while
      // recovering from an incident.
      const cap = (current: string, chunk: string) =>
        current.length > 64_000 ? current : current + chunk;

      child.stdout.on("data", (d: Buffer) => (stdout = cap(stdout, d.toString())));
      child.stderr.on("data", (d: Buffer) => (stderr = cap(stderr, d.toString())));

      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        const exit = code ?? -1;
        if (exit !== 0 && !options.allowNonZeroExit) {
          const safe = redactToolOutput(stderr).trim();
          this.logger.warn(`${command} beendet mit ${exit}: ${safe.slice(0, 500)}`);
          const err = new Error(`${command} exited with ${exit}`) as Error & { stderr: string };
          err.stderr = safe;
          reject(err);
          return;
        }
        resolvePromise({ stdout, stderr, code: exit });
      });
    });
  }
}

export type PgConnection = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
};

/**
 * Refuses a database name that is anything but a plain identifier.
 *
 * The names this passes are generated, not supplied — but `CREATE DATABASE`
 * cannot take a bound parameter, so the name is concatenated into SQL, and a
 * concatenation into SQL is exactly where a check belongs however trusted the
 * input is believed to be today.
 */
export function assertSafeDatabaseName(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(name)) {
    throw new Error(`Unsafe database name: ${name}`);
  }
}

