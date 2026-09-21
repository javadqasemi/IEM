import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { statfs } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";

/**
 * Where backup artifacts live.
 *
 * ---
 *
 * ## A second storage seam, not a reuse of the first
 *
 * `media/storage.ts` already defines a `StorageAdapter`, and reusing it here
 * would have been one line. It is the wrong line, for a reason that is a
 * security property rather than a taste: **the media root is served over HTTP**
 * by the static handler in `main.ts`, behind a *positive* allowlist. Putting
 * database dumps under a root that something serves means the only thing
 * standing between an attacker and the whole database is a regex — and
 * CLAUDE.md records two ways that regex has already been walked past
 * (`/media/%62ewerbungen/…` and `/media/bewerbungen%2f…`).
 *
 * So backups get their own root, `BACKUP_ROOT`, which **nothing serves**. The
 * only way to a backup artifact is `GET /backups/:id/download`, behind
 * `system.restore` and audited.
 *
 * The interfaces also want different things: media puts and gets whole buffers
 * because an image is a few megabytes, and a backup must **stream** because a
 * database dump is not something to hold in Node's heap.
 *
 * ## Why an interface with one implementation
 *
 * The same argument `StorageAdapter` makes and a stronger one: a backup stored
 * on the same disk as the database it protects is not disaster recovery, so an
 * off-server provider is not speculative — it is the next required step. S3,
 * Azure Blob and SFTP are all "implement four methods", and the day one
 * arrives nothing above this file changes.
 */
export interface BackupStorageProvider {
  /** What this provider is called in the UI and the manifest. */
  readonly kind: string;
  /** Where it writes, for an operator reading a status panel. Never a secret. */
  describe(): { kind: string; location: string; offSite: boolean };
  /** A stream to write one artifact into. The key is generated, never supplied. */
  writeStream(key: string): Promise<Writable>;
  readStream(key: string): Promise<Readable>;
  /** Byte length, or `null` when the artifact is not there. */
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  /** Bytes free where artifacts are written, or `null` when unknowable. */
  freeBytes(): Promise<number | null>;
  /** Resolve for a tool that needs a real path — `pg_dump`, `tar`. */
  localPath(key: string): string | null;
}

export const BACKUP_STORAGE = Symbol("BACKUP_STORAGE");

/**
 * Local disk, under `BACKUP_ROOT`.
 *
 * **Not disaster recovery on its own**, and the UI says so rather than leaving
 * an operator to work it out: a backup on the same machine survives a dropped
 * table and a bad migration, and does not survive the disk, the machine or the
 * building. `describe().offSite` is `false` and the status panel renders a
 * warning from it.
 */
@Injectable()
export class LocalBackupStorage implements BackupStorageProvider {
  readonly kind = "LOCAL";
  private readonly logger = new Logger(LocalBackupStorage.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>("BACKUP_ROOT") ?? "./var/backups");
  }

  describe() {
    return { kind: this.kind, location: this.root, offSite: false };
  }

  /**
   * Resolves a key to a path, refusing to leave the root.
   *
   * Keys are built from a cuid and a fixed suffix — no caller supplies one —
   * but this is the function where a traversal would become an arbitrary file
   * write **or an arbitrary file read through the download route**, so it
   * checks rather than trusting an invariant to hold for ever. The same
   * reasoning, and the same shape, as `LocalStorageAdapter.pathFor`.
   */
  private pathFor(key: string): string {
    const full = resolve(join(this.root, key));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Backup key escapes the backup root: ${key}`);
    }
    return full;
  }

  localPath(key: string): string {
    return this.pathFor(key);
  }

  async writeStream(key: string): Promise<Writable> {
    const path = this.pathFor(key);
    await fs.mkdir(dirname(path), { recursive: true });
    return createWriteStream(path);
  }

  async readStream(key: string): Promise<Readable> {
    return createReadStream(this.pathFor(key));
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await fs.stat(this.pathFor(key))).size;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.pathFor(key));
    } catch (err) {
      // A missing artifact is the desired end state. Anything else is worth
      // knowing but must not fail the caller, which has already decided the
      // row is going.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn(`Konnte ${key} nicht löschen: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Free space where artifacts are written.
   *
   * Used to refuse a backup **before** it starts rather than to fail halfway
   * through one — filling the disk under a running PostgreSQL is how a backup
   * job takes the database down, which is the opposite of the job's purpose.
   *
   * `null` rather than a guess when the platform cannot answer: a made-up
   * figure here would either block backups that would have worked or wave
   * through the one that fills the disk.
   */
  async freeBytes(): Promise<number | null> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      const fsStat = await statfs(this.root);
      return Number(fsStat.bavail) * Number(fsStat.bsize);
    } catch {
      return null;
    }
  }
}

