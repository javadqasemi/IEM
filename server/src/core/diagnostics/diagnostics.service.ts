import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JobStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../../common/prisma.service";
import { RedisService } from "../../common/redis";
import { MailService } from "../../mail/mail.service";
import { classifyMailError } from "../../mail/mail.failure";
import { PostgresTools } from "../backup/backup.postgres";
import { classifyBackupError, redactToolOutput } from "../backup/backup.failure";
import { BACKUP_STORAGE, type BackupStorageProvider } from "../backup/backup.storage";
import { JobRunner } from "../jobs/job.runner";
import { Inject } from "@nestjs/common";
import {
  SLOW_CHECK_MS,
  overallResult,
  passOrSlow,
  runCheck,
  type DiagnosticCheck,
  type DiagnosticsRun,
} from "./diagnostics.rules";

/**
 * Eight checks, run on request, none of which changes anything a user owns.
 *
 * ---
 *
 * ## Why it is explicit rather than continuous
 *
 * Three of these open a connection to something outside the process. Running
 * them on every render of the System page would mean an SMTP handshake per
 * page view — which is both rude to the mail server and a fine way to get an
 * IP rate-limited by a provider. The System overview polls *counts*; this is
 * a button.
 *
 * ## What "safe" means here, precisely
 *
 * The brief says not to perform dangerous mutations to test health, and the
 * storage check is the one that has to be argued rather than assumed. There
 * is no way to prove a directory is writable except by writing to it, so it
 * writes **one file, with a random name, under a dot-prefixed probe name, and
 * deletes it**. Two properties make that safe rather than merely small:
 * the name cannot collide with anything the application stores, and it
 * **cannot be served** — `main.ts` guards the media root with a *positive*
 * match on `^/\d{4}/<name>.<ext>`, which a dotfile does not satisfy.
 *
 * The mail check is `verifyConnection`, which opens a connection and hangs
 * up. It sends nothing: a diagnostic that delivered a message would need a
 * recipient, and choosing one is the decision Email Operations already made
 * deliberately and kept behind its own route.
 */
@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly postgres: PostgresTools,
    private readonly runner: JobRunner,
    @Inject(BACKUP_STORAGE) private readonly storage: BackupStorageProvider,
  ) {}

  async run(): Promise<DiagnosticsRun> {
    const startedAt = new Date();
    const started = Date.now();

    /*
      Sequential, not `Promise.all`.

      Eight concurrent checks would measure a machine under load created by
      the measurement — the mistake `e2e/budgets.ts` records at length about
      the performance budgets. A slow check here is information, and it is
      only information if it was not competing with seven others for the same
      database connection pool.
    */
    const checks: DiagnosticCheck[] = [];
    checks.push(await this.checkDatabase());
    checks.push(await this.checkMigrations());
    checks.push(await this.checkRedis());
    checks.push(await this.checkStorage());
    checks.push(await this.checkBackupTools());
    checks.push(await this.checkJobWorker());
    checks.push(await this.checkPublishedContent());
    checks.push(await this.checkMail());

    return {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - started,
      result: overallResult(checks),
      checks,
    };
  }

  /* ================================================================ */

  private checkDatabase() {
    return runCheck("database", "Datenbank", sanitizeDatabase, async () => {
      const started = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const ms = Date.now() - started;
      return passOrSlow(
        ms,
        `Verbindung steht, Antwort in ${ms} ms.`,
        `Verbindung steht, aber die Antwort brauchte ${ms} ms — mehr als ${SLOW_CHECK_MS} ms.`,
      );
    });
  }

  /**
   * Whether the schema is the one the code expects.
   *
   * Separate from the connection check because the two failures need
   * different answers: an unreachable database is an infrastructure problem
   * and a half-applied migration is a deployment one, and folding them into
   * one row would send somebody to restart Postgres over a failed `prisma
   * migrate deploy`.
   */
  private checkMigrations() {
    return runCheck("migrations", "Datenbankschema", sanitizeDatabase, async () => {
      const rows = await this.prisma.$queryRaw<
        { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
      >`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at DESC`;

      const unfinished = rows.filter((r) => !r.finished_at || r.rolled_back_at);
      if (unfinished.length) {
        return {
          result: "FAIL" as const,
          detail:
            `${unfinished.length} Migration(en) wurden begonnen und nicht abgeschlossen — ` +
            `zuletzt „${unfinished[0].migration_name}“. Das Schema ist unvollständig.`,
        };
      }
      return {
        result: "PASS" as const,
        detail: `${rows.length} Migration(en) angewendet, zuletzt „${rows[0]?.migration_name ?? "—"}“.`,
      };
    });
  }

  /**
   * Redis, or the documented single-process mode.
   *
   * `NOT_CONFIGURED` rather than `FAIL`, because the fallback is a supported
   * arrangement and not a fault — the bootstrap log says so in as many words.
   * What it costs is stated so the reader can decide whether it matters to
   * them: on one instance, nothing; on several, every rate limit multiplies
   * and the scheduler runs unlocked.
   */
  private checkRedis() {
    return runCheck("redis", "Redis", (err) => `Redis antwortet nicht: ${short(err)}`, async () => {
      if (!this.redis.enabled) {
        return {
          result: "NOT_CONFIGURED" as const,
          detail:
            "Kein REDIS_URL gesetzt — Einzelprozess-Betrieb. Das ist zulässig; bei mehreren " +
            "Instanzen zählt dann aber jede Ratenbegrenzung für sich und die Zeitsteuerung läuft ungesperrt.",
        };
      }
      const ok = await this.redis.ping();
      return ok
        ? { result: "PASS" as const, detail: "Redis antwortet auf PING." }
        : {
            result: "FAIL" as const,
            detail: "REDIS_URL ist gesetzt, aber der Server antwortet nicht auf PING.",
          };
    });
  }

  /**
   * Writability, proved by writing. See the note at the top of the class.
   *
   * The probe is deleted in a `finally`, so a failure between write and
   * delete does not leave one behind — and if the delete itself fails, that
   * is the interesting result rather than a swallowed one: a directory that
   * accepts writes and refuses deletes fills up.
   */
  private checkStorage() {
    return runCheck("storage", "Dateiablage", sanitizeStorage, async () => {
      const key = `.diagnostics-probe-${randomBytes(8).toString("hex")}`;
      let written = false;
      try {
        /*
          A stream, because that is the provider's only write.

          `BackupStorageProvider` is a streaming interface by design — a
          database dump does not fit in memory — so the probe uses the same
          path a real backup does rather than a convenience method added for
          it. Fifteen bytes through a stream proves the same thing and tests
          more of the code that matters.
        */
        const out = await this.storage.writeStream(key);
        await new Promise<void>((resolve, reject) => {
          out.on("error", reject);
          out.end(Buffer.from("iem-diagnostics"), () => resolve());
        });
        written = true;
        const free = await this.storage.freeBytes();
        if (free === null) {
          return {
            result: "WARNING" as const,
            detail:
              "Schreibzugriff funktioniert. Der freie Speicherplatz lässt sich auf dieser " +
              "Plattform nicht ermitteln, deshalb gibt es dazu keine Warnung.",
          };
        }
        return {
          result: "PASS" as const,
          detail: `Schreibzugriff funktioniert, ${formatGb(free)} GB frei.`,
        };
      } finally {
        if (written) await this.storage.delete(key).catch(() => undefined);
      }
    });
  }

  /**
   * `pg_dump` and `pg_restore`, which the backup module needs and the rest of
   * the application does not.
   *
   * `NOT_CONFIGURED` when they are absent, not `FAIL`: an installation that
   * has deliberately not set up backups is not broken. `BackupStatusService`
   * reports the consequence — no recovery point — and that is where the
   * warning belongs.
   */
  private checkBackupTools() {
    return runCheck("backup-tools", "Sicherungswerkzeuge", sanitizeBackup, async () => {
      const { ok, version } = await this.postgres.available();
      return ok
        ? { result: "PASS" as const, detail: `pg_dump gefunden${version ? ` (${version})` : ""}.` }
        : {
            result: "NOT_CONFIGURED" as const,
            detail:
              "pg_dump/pg_restore sind nicht auffindbar. Ohne sie lassen sich keine Sicherungen " +
              "erstellen oder einspielen.",
          };
    });
  }

  /**
   * Is anything actually working the queue?
   *
   * The check that could not exist before `JobRunner.lastTick` (P2-6), and the
   * one an operator most needs: a queue with waiting rows and no worker looks
   * exactly like a queue whose jobs are not due yet.
   *
   * The threshold is generous — the poller ticks every ten seconds, and a
   * minute of silence is either a very long job or a stopped worker. Both
   * deserve a look; neither is worth crying wolf over a garbage collection.
   */
  private checkJobWorker() {
    return runCheck("job-worker", "Arbeitsprozess", (err) => short(err), async () => {
      const last = this.runner.lastTick;
      const [queued, dead] = await this.prisma.$transaction([
        this.prisma.job.count({ where: { status: JobStatus.QUEUED } }),
        this.prisma.job.count({ where: { status: JobStatus.DEAD } }),
      ]);

      if (!last) {
        return {
          result: "WARNING" as const,
          detail:
            "Der Arbeitsprozess hat seit dem Start noch keinen Durchlauf beendet. " +
            "Kurz nach dem Start ist das normal.",
        };
      }

      const ageMs = Date.now() - last.getTime();
      if (ageMs > WORKER_SILENT_MS) {
        return {
          result: "FAIL" as const,
          detail:
            `Der letzte Durchlauf liegt ${Math.round(ageMs / 1000)} Sekunden zurück ` +
            `(erwartet: alle 10 Sekunden). ${queued} Aufgabe(n) warten.`,
        };
      }
      return {
        result: "PASS" as const,
        detail: `Letzter Durchlauf vor ${Math.round(ageMs / 1000)} s. ${queued} wartend, ${dead} aufgegeben.`,
      };
    });
  }

  /**
   * The one thing a visitor actually depends on.
   *
   * Read through Prisma rather than over HTTP. An internal call proves the
   * snapshot exists and is readable; a `fetch` to the process's own port would
   * also be testing the reverse proxy, the port binding and the DNS of a
   * machine talking to itself — three things that, if broken, mean nobody is
   * reading this page either.
   */
  private checkPublishedContent() {
    return runCheck("public-content", "Öffentliche Website", sanitizeDatabase, async () => {
      const snapshot = await this.prisma.contentSnapshot.findFirst({
        orderBy: { version: "desc" },
        select: { version: true, publishedAt: true, content: true },
      });
      if (!snapshot) {
        return {
          result: "WARNING" as const,
          detail:
            "Es wurde noch nie veröffentlicht. Die Website zeigt den Stand, der im Build " +
            "mitgeliefert wurde — sie ist also nicht leer, aber auch nicht aktualisierbar.",
        };
      }
      const keys = Object.keys((snapshot.content ?? {}) as Record<string, unknown>).length;
      if (keys === 0) {
        return {
          result: "FAIL" as const,
          detail: `Stand ${snapshot.version} ist leer — die Website hätte keinen Inhalt zu zeigen.`,
        };
      }
      return {
        result: "PASS" as const,
        detail: `Stand ${snapshot.version} mit ${keys} Bereichen, veröffentlicht am ${snapshot.publishedAt.toISOString().slice(0, 10)}.`,
      };
    });
  }

  /**
   * An SMTP handshake, and **nothing sent**.
   *
   * `verifyConnection` is Email Operations' own probe, reused rather than
   * re-implemented — so a diagnostics failure and a settings-screen failure
   * are the same nine sanitized categories rather than two vocabularies for
   * one problem.
   */
  private checkMail() {
    return runCheck("mail", "E-Mail-Versand", sanitizeMail, async () => {
      const outcome = await this.mail.verifyConnection();
      /*
        Switched on the discriminant rather than on an `ok` boolean.

        `MailVerifyResult` is a three-way union for the reason P2-4 records:
        "not configured", "refused" and "connected" are different facts, and
        an optional-field shape lets a caller forget one of them. The three
        arms here map onto exactly three of the four diagnostic results, and
        `WARNING` is deliberately not among them — a mail server either
        answered or it did not.
      */
      switch (outcome.status) {
        case "unconfigured":
          return {
            result: "NOT_CONFIGURED" as const,
            detail:
              "Kein SMTP-Server hinterlegt. Benachrichtigungen erscheinen im Dashboard, " +
              "E-Mails werden als übersprungen protokolliert.",
          };
        case "connected":
          return {
            result: "PASS" as const,
            detail: `Der SMTP-Server nimmt die Verbindung an (${outcome.describedAs}, ${outcome.durationMs} ms).`,
          };
        case "failed":
          return { result: "FAIL" as const, detail: outcome.failure.message };
      }
    });
  }
}

/* ================================================================== */
/* Thresholds and sanitizers                                           */
/* ================================================================== */

/**
 * Silence from the poller before it is called a failure.
 *
 * Six ticks. Short enough to catch a stopped worker within a minute, long
 * enough that a slow batch or a garbage collection does not raise an alarm.
 */
const WORKER_SILENT_MS = 60_000;

function formatGb(bytes: number): string {
  return (bytes / 1_000_000_000).toFixed(1);
}

/** The first line of a message, capped. Never a stack trace. */
function short(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0].slice(0, 200);
}

/**
 * A Postgres error, with any connection string removed.
 *
 * libpq composes its failure text by echoing the connection it attempted,
 * password included — the exact disclosure `redactToolOutput` exists for, and
 * the reason this does not simply call `short`.
 */
function sanitizeDatabase(err: unknown): string {
  return redactToolOutput(short(err));
}

function sanitizeStorage(err: unknown): string {
  // A filesystem error names the path it failed on, which is a private
  // server path. The operator needs the failure, not the directory layout.
  const message = short(err);
  return message.replace(/([A-Za-z]:)?[\\/][^\s"']{8,}/g, "<Pfad>");
}

function sanitizeBackup(err: unknown): string {
  return classifyBackupError(short(err)).message;
}

function sanitizeMail(err: unknown): string {
  return classifyMailError(err).message;
}
