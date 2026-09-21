/**
 * Why a backup or a restore did not work, in words this application chose.
 *
 * Pure, and the same shape `mail.failure.ts` established in P2-4 — the pattern
 * is deliberate rather than copied: both wrap a **child process whose error
 * text this codebase does not control**, and both feed an audit log that people
 * who are not operators read.
 *
 * The risk here is sharper than it was for mail. `pg_dump` and `pg_restore`
 * report connection failures by echoing the connection they attempted, and a
 * naive implementation that passed the password on the command line would put
 * it in every one of those messages — which is the second reason
 * `backup.postgres.ts` passes it through the environment instead.
 */

export const BACKUP_FAILURE_CATEGORIES = [
  "DATABASE_UNAVAILABLE",
  "DUMP_FAILED",
  "STORAGE_UNAVAILABLE",
  "DISK_FULL",
  "ARCHIVE_FAILED",
  "CHECKSUM_FAILED",
  "VERIFICATION_FAILED",
  "RETENTION_FAILED",
  "RESTORE_FAILED",
  "VERSION_INCOMPATIBLE",
  "TOOL_MISSING",
  "UNKNOWN",
] as const;

export type BackupFailureCategory = (typeof BACKUP_FAILURE_CATEGORIES)[number];

export type BackupFailure = {
  category: BackupFailureCategory;
  /** German, operator-readable, written here. Never from a tool. */
  message: string;
};

/**
 * One sentence of diagnosis per category, held as data so the wording is
 * visible in one list and so the test can assert every category renders.
 */
const COPY: Record<BackupFailureCategory, string> = {
  DATABASE_UNAVAILABLE:
    "Die Datenbank war nicht erreichbar. Läuft PostgreSQL, und stimmt DATABASE_URL?",
  DUMP_FAILED:
    "Der Datenbank-Abzug ist fehlgeschlagen. Einzelheiten stehen im Server-Protokoll.",
  STORAGE_UNAVAILABLE:
    "Das Sicherungsverzeichnis ist nicht beschreibbar. Prüfen Sie BACKUP_ROOT und die Berechtigungen.",
  DISK_FULL:
    "Zu wenig freier Speicherplatz. Die Sicherung wurde abgebrochen, bevor sie begonnen hat.",
  ARCHIVE_FAILED: "Das Medienarchiv konnte nicht erstellt werden.",
  CHECKSUM_FAILED:
    "Die Prüfsumme der geschriebenen Datei stimmt nicht mit der berechneten überein. Die Sicherung ist unbrauchbar.",
  VERIFICATION_FAILED:
    "Die Sicherung wurde geschrieben, lässt sich aber nicht lesen. Sie taugt nicht zur Wiederherstellung.",
  RETENTION_FAILED: "Das Aufräumen alter Sicherungen ist fehlgeschlagen.",
  RESTORE_FAILED: "Die Wiederherstellung ist fehlgeschlagen. Einzelheiten im Server-Protokoll.",
  VERSION_INCOMPATIBLE:
    "Diese Sicherung stammt aus einer anderen Schema-Version und kann nicht ohne Weiteres eingespielt werden.",
  TOOL_MISSING:
    "Die PostgreSQL-Werkzeuge (pg_dump/pg_restore) wurden nicht gefunden. Setzen Sie PG_BIN_PATH.",
  UNKNOWN: "Unbekannter Fehler. Siehe Server-Protokoll.",
};

/** Node `spawn` codes and tool messages that map to a category reliably. */
const BY_CODE: Record<string, BackupFailureCategory> = {
  ENOENT: "TOOL_MISSING",
  ENOSPC: "DISK_FULL",
  EACCES: "STORAGE_UNAVAILABLE",
  EPERM: "STORAGE_UNAVAILABLE",
  EROFS: "STORAGE_UNAVAILABLE",
  ECONNREFUSED: "DATABASE_UNAVAILABLE",
  ETIMEDOUT: "DATABASE_UNAVAILABLE",
};

/**
 * Last resort: the tool's own text.
 *
 * Ordered so the more specific phrase wins. "no space left" contains the word
 * "space" and nothing else does; a connection refusal from libpq says
 * "could not connect to server" whatever else it says.
 */
function fromMessage(raw: string): BackupFailureCategory | null {
  const text = raw.toLowerCase();

  if (/no space left|enospc|disk full|quota exceeded/.test(text)) return "DISK_FULL";
  if (/could not connect|connection refused|server closed the connection|database .* does not exist/.test(text)) {
    return "DATABASE_UNAVAILABLE";
  }
  if (/permission denied|read-only file system|access is denied/.test(text)) {
    return "STORAGE_UNAVAILABLE";
  }
  if (/is not a valid|corrupt|unexpected end of file|input file does not appear/.test(text)) {
    return "VERIFICATION_FAILED";
  }
  if (/not found|is not recognized|command not found/.test(text)) return "TOOL_MISSING";
  return null;
}

/**
 * Classifies anything a child process or a filesystem call threw.
 *
 * `fallback` names what was being attempted, so a failure that matches nothing
 * still says whether the dump, the archive or the restore was the thing that
 * broke — `UNKNOWN` on its own sends an operator to read a log with no idea
 * which half to read.
 *
 * **Returns no part of the input.** `backup.failure.test.ts` asserts it by
 * classifying an error whose message carries a connection string.
 */
export function classifyBackupError(
  err: unknown,
  fallback: BackupFailureCategory = "UNKNOWN",
): BackupFailure {
  const category = detect(err) ?? fallback;
  return { category, message: COPY[category] };
}

function detect(err: unknown): BackupFailureCategory | null {
  if (err === null || typeof err !== "object") return null;
  const e = err as { code?: unknown; message?: unknown; stderr?: unknown };

  if (typeof e.code === "string") {
    const byCode = BY_CODE[e.code.toUpperCase()];
    if (byCode) return byCode;
  }

  // `stderr` before `message`: a spawned tool's diagnosis is in the first and
  // the second is usually only "Command failed with exit code 1".
  for (const field of [e.stderr, e.message]) {
    if (typeof field === "string") {
      const byText = fromMessage(field);
      if (byText) return byText;
    }
  }
  return null;
}

/** A failure this code decided on rather than caught. */
export function backupFailure(category: BackupFailureCategory, detail?: string): BackupFailure {
  return { category, message: detail ? `${COPY[category]} ${detail}` : COPY[category] };
}

/**
 * Strips anything credential-shaped out of a tool's own output before it
 * reaches a log line.
 *
 * Belt and braces: `backup.postgres.ts` passes the password through the
 * environment so it should never appear, and `pg_restore` echoes the
 * *connection string* on some failures, which carries the user and the host.
 * This is what stands between that and the server log.
 *
 * It is **not** what protects the audit log or the API — those get the
 * classified message and never see this text at all.
 */
export function redactToolOutput(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://<redacted>")
    .replace(/password=\S+/gi, "password=<redacted>")
    .replace(/PGPASSWORD=\S+/g, "PGPASSWORD=<redacted>");
}

