import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { basename, dirname, resolve } from "node:path";

/**
 * The media archive.
 *
 * ---
 *
 * ## An allowlist, not an exclude list
 *
 * The brief asks not to archive `node_modules`, build output, caches, logs or
 * source. The way to guarantee that is **not** to list them: an exclude list is
 * a promise to remember every future directory somebody adds beside the media
 * root, and the one that gets forgotten is the one with something in it.
 *
 * So this names the roots it *does* archive — today exactly one, `MEDIA_ROOT` —
 * and anything not named is not in the backup. Adding a second owned directory
 * is a line here, which is a change a reviewer sees.
 *
 * ## What is inside, and why it makes a backup sensitive
 *
 * `MEDIA_ROOT` holds two things: uploaded site media under `<year>/`, and
 * **applicant dossiers under `bewerbungen/`** — CVs, references, personal data
 * the firm is obliged to look after. That is the reason downloading a backup
 * sits behind `system.restore` rather than `system.backup`: obtaining the
 * archive and restoring it give you the same data.
 *
 * ## Why `tar` rather than a Node zip library
 *
 * It streams, it is present on every platform this runs on (Windows ships
 * bsdtar in `System32` since 1803), and it preserves the directory structure a
 * restore has to reproduce. A Node archiver would be a dependency that reads
 * the whole tree into the heap to save a few hundred megabytes of photographs.
 *
 * Gzip rather than zstd: `zstd` is not on the PATH here and `tar -z` is, and
 * the contents are mostly **already-compressed JPEG and PDF**, where the
 * difference between the two is a couple of percent of something that barely
 * compresses at all. Measured rather than assumed — see the note on the
 * `--compress` level in `backup.postgres.ts`.
 */
@Injectable()
export class MediaArchiver {
  private readonly logger = new Logger(MediaArchiver.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * The directories this application owns and may archive.
   *
   * Returned as absolute paths with the entry each should appear under in the
   * archive, so a restore can put them back without guessing.
   */
  roots(): { path: string; label: string }[] {
    return [{ path: resolve(this.config.get<string>("MEDIA_ROOT") ?? "./var/media"), label: "media" }];
  }

  /** What is there to archive, so a run can refuse early and size a disk check. */
  async measure(): Promise<{ files: number; bytes: number; missing: string[] }> {
    let files = 0;
    let bytes = 0;
    const missing: string[] = [];

    for (const root of this.roots()) {
      try {
        await fs.access(root.path);
      } catch {
        missing.push(root.label);
        continue;
      }
      const stack = [root.path];
      while (stack.length) {
        const dir = stack.pop()!;
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          const full = resolve(dir, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.isFile()) {
            files += 1;
            bytes += (await fs.stat(full)).size;
          }
        }
      }
    }
    return { files, bytes, missing };
  }

  /**
   * Writes a gzipped tar of the owned roots to `target`.
   *
   * `-C <parent> <basename>` rather than an absolute path, so the archive holds
   * `media/2026/…` rather than `C:/…/server/var/media/2026/…`. An archive of
   * absolute paths is one that can only be restored onto the machine it came
   * from, which defeats the purpose.
   *
   * An **empty** media root is a success with no entries, not a failure: a
   * fresh installation has uploaded nothing, and a nightly backup that fails
   * until somebody uploads a photograph is a nightly backup nobody trusts.
   */
  async archive(target: string): Promise<{ entries: number }> {
    const present: { parent: string; name: string }[] = [];

    for (const root of this.roots()) {
      try {
        await fs.access(root.path);
        present.push({ parent: dirname(root.path), name: basename(root.path) });
      } catch {
        this.logger.warn(`Medienverzeichnis ${root.path} existiert nicht — wird übersprungen.`);
      }
    }

    if (present.length === 0) {
      // An empty but valid archive, so the artifact, its checksum and its
      // verification all exist and mean what they say.
      await this.runTar(["-czf", target, "--files-from", nullDevice()]);
      return { entries: 0 };
    }

    /*
      One `-C` per root, which is why this builds an argument array rather than
      a command string. Every one of these values is derived from configuration
      and a generated target path; none is user input, and `shell: false` means
      it would not matter if one were.
    */
    const args = ["-czf", target];
    for (const root of present) args.push("-C", root.parent, root.name);
    await this.runTar(args);

    return { entries: present.length };
  }

  /**
   * Reads the archive's table of contents.
   *
   * The media equivalent of `pg_restore --list`: it decompresses and walks
   * every header, so a truncated or corrupt archive fails here rather than
   * during a recovery.
   */
  async listArchive(path: string): Promise<string[]> {
    const out = await this.runTar(["-tzf", path]);
    return out.split(/\r?\n/).filter(Boolean);
  }

  /** Extracts into `destination`, used by the media recovery drill. */
  async extract(path: string, destination: string): Promise<void> {
    await fs.mkdir(destination, { recursive: true });
    await this.runTar(["-xzf", path, "-C", destination]);
  }

  private runTar(args: string[]): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn("tar", args, { shell: false, windowsHide: true });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => {
        if (stdout.length < 1_000_000) stdout += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        if (stderr.length < 32_000) stderr += d.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          const err = new Error(`tar exited with ${code}`) as Error & { stderr: string };
          err.stderr = stderr.trim();
          reject(err);
          return;
        }
        resolvePromise(stdout);
      });
    });
  }
}

/** `NUL` on Windows, `/dev/null` everywhere else. */
function nullDevice(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

