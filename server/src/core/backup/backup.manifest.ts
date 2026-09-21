import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { BackupType } from "@prisma/client";

/**
 * What a backup says about itself.
 *
 * ---
 *
 * ## The type has nowhere to put a secret
 *
 * The same technique `EmailInput` in `core/notifications/templates.ts` uses and
 * `MailProviderDescription` in P2-4: the way to guarantee a manifest never
 * carries a credential is to give the manifest's type no field one could
 * occupy. There is no `env`, no `config`, no `settings` and no `connection`
 * here — smuggling `APP_SECRETS_ENCRYPTION_KEY` into a downloadable file would
 * require changing this signature, which is a change a reviewer sees.
 *
 * `database.host` is deliberately absent too. It is not a secret, and it is
 * also not needed to restore — the target is whatever the restoring
 * installation is configured with — so it is one more thing that would be in a
 * file somebody may e-mail to a consultant for no benefit.
 *
 * ## Why the manifest is an artifact rather than only columns
 *
 * Everything in it is also in `BackupRun`. It is written into the backup as
 * well because **the database is the thing that may be gone**: an operator
 * holding three files and no application has to be able to tell which recovery
 * point they are looking at, what schema it needs and whether the archive
 * beside it belongs to it. A manifest that lives only in the database it backs
 * up answers nothing at the moment it is needed.
 */
export type BackupManifest = {
  /** The format of this file, so a future reader can refuse what it cannot parse. */
  manifestVersion: 1;
  backupId: string;
  type: BackupType;
  createdAt: string;
  /** Which installation, for somebody holding files from two of them. */
  organisation: string | null;
  application: {
    /** `null` when nothing stamps a build — see the roadmap's P1-3 note. */
    version: string | null;
    /** The Prisma migration the schema was at. What compatibility is judged on. */
    migration: string | null;
  };
  database: {
    /** PostgreSQL's own `server_version`, for a reader choosing a `pg_restore`. */
    serverVersion: string | null;
    name: string;
  };
  artifacts: {
    kind: string;
    file: string;
    sizeBytes: number;
    sha256: string;
  }[];
  /**
   * The consistency caveat, written into the file rather than assumed.
   *
   * A `FULL` backup dumps the database and archives the media one after the
   * other, so a file uploaded between the two is in the archive and not in the
   * database — or the reverse. That window is seconds and it is real, and an
   * operator reconciling a recovery deserves to be told rather than to deduce
   * it. Naming it here is what makes this a recovery point with a stated
   * limitation instead of one with an implied guarantee it does not have.
   */
  consistency: {
    databaseAt: string | null;
    mediaAt: string | null;
    note: string;
  };
};

export const CONSISTENCY_NOTE =
  "Datenbank und Medien werden nacheinander gesichert. Dateien, die zwischen beiden " +
  "Zeitpunkten hochgeladen wurden, können im Archiv fehlen oder ohne Datenbankzeile " +
  "vorhanden sein. Für eine punktgenaue Konsistenz wäre ein Snapshot auf Speicherebene nötig.";

/**
 * SHA-256 of a file, computed by **streaming** it.
 *
 * Never `readFile().digest()`: a database dump is not something to hold in
 * Node's heap, and the one time it would matter is the incident where the
 * database is large and the machine is already under pressure.
 */
export function checksumFile(path: string): Promise<{ sha256: string; bytes: number }> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    const stream = createReadStream(path);
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolvePromise({ sha256: hash.digest("hex"), bytes }));
  });
}

/**
 * Whether a manifest is one this build can read.
 *
 * Returns a reason rather than throwing, because the caller is a verification
 * pass that records the answer rather than a parser that gives up.
 */
export function refuseManifest(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "Die Manifest-Datei ist unlesbar.";
  const m = value as Partial<BackupManifest>;
  if (m.manifestVersion !== 1) {
    return `Unbekannte Manifest-Version (${String(m.manifestVersion)}).`;
  }
  if (!m.backupId || !Array.isArray(m.artifacts)) return "Dem Manifest fehlen Pflichtangaben.";
  return null;
}

/**
 * The keys a manifest must never contain, as a runtime check.
 *
 * The type already prevents them, and this exists because a type is not
 * present at runtime and `JSON.stringify` of a wider object would sail past it.
 * `backup.manifest.test.ts` runs it over a real manifest; the service runs it
 * before writing one, so a future field named `smtpPassword` fails the backup
 * rather than shipping in it.
 */
const FORBIDDEN = [
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "encryptionkey",
  "encryption_key",
  "pgpassword",
  "connectionstring",
  "connection_string",
  "databaseurl",
  "database_url",
];

export function findSecretLikeKeys(value: unknown, path = ""): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findSecretLikeKeys(v, `${path}[${i}]`)));
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      const flat = key.toLowerCase().replace(/[^a-z_]/g, "");
      if (FORBIDDEN.some((f) => flat.includes(f.replace(/_/g, "")) || flat === f)) {
        hits.push(path ? `${path}.${key}` : key);
      }
      hits.push(...findSecretLikeKeys(v, path ? `${path}.${key}` : key));
    }
  }
  return hits;
}

