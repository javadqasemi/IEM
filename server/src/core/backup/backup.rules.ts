/**
 * Every backup decision that is arithmetic rather than I/O.
 *
 * The same split `auth.rules.ts`, `mfa.rules.ts` and `drawings.rules.ts` make,
 * and it earns it here more than anywhere else in the codebase: these are the
 * functions that decide **what gets deleted** and **what may be restored over a
 * production database**. Both fail silently when wrong — retention that deletes
 * one row too many leaves no trace of what it took, and a compatibility check
 * that says yes too easily produces a restore that half-works.
 *
 * No Prisma, no clock it does not receive, no filesystem.
 */

import type {
  BackupStatus,
  BackupTrigger,
  BackupType,
  RestoreStatus,
  VerificationStatus,
} from "@prisma/client";

/* ================================================================== */
/* Scheduling                                                          */
/* ================================================================== */

/**
 * The key that makes one scheduled night produce one backup.
 *
 * `2026-09-22:FULL` — a **date and a type**, deliberately not a timestamp. The
 * scheduler fires on a cron and may fire more than once for one occurrence: a
 * restart inside the window, a retry, two workers racing. A timestamp would
 * make each of those a different key and each of them a separate full backup of
 * the same database, which is how a nightly job fills a disk.
 *
 * It is a **unique index**, not a check — the same argument
 * `notificationEventKey` records. Nothing reads the key to decide whether to
 * write; the insert is attempted and the constraint is the answer.
 *
 * A manual backup gets **no** key, because two people deliberately pressing the
 * button twice want two backups, and the second is not a duplicate of the
 * first — it is a second recovery point a minute later.
 */
export function occurrenceKeyFor(type: BackupType, at: Date): string {
  const date = at.toISOString().slice(0, 10);
  return `${date}:${type}`;
}

/**
 * Whether a scheduled run is due, given when the last one of its type finished.
 *
 * Returns a reason rather than a boolean, because "not due" is a thing an
 * operator asks about — a status panel that says *"nächste Sicherung 22.09.,
 * 02:00"* is answering this function.
 */
export function nextScheduledRun(
  hourLocal: number,
  from: Date,
  timeZoneOffsetMinutes: number,
): Date {
  /*
    Computed against a fixed offset rather than with a timezone library.

    The firm is in one place — `Europe/Zurich` — and the only thing this has to
    get right is "roughly 02:00 local". A DST boundary shifts it by an hour
    once a year, at 02:00, on a night when a backup running at 01:00 or 03:00
    is equally fine. Pulling in a timezone database for that would be a
    dependency carried for ever to fix a non-problem.
  */
  const local = new Date(from.getTime() + timeZoneOffsetMinutes * 60_000);
  const next = new Date(local);
  next.setUTCHours(hourLocal, 0, 0, 0);
  if (next <= local) next.setUTCDate(next.getUTCDate() + 1);
  return new Date(next.getTime() - timeZoneOffsetMinutes * 60_000);
}

/* ================================================================== */
/* Retention                                                           */
/* ================================================================== */

/** The fields retention reasons about. Deliberately fewer than the row has. */
export type Retainable = {
  id: string;
  type: BackupType;
  status: BackupStatus;
  trigger: BackupTrigger;
  verification: VerificationStatus;
  protected: boolean;
  createdAt: Date;
};

export type RetentionPolicy = {
  /** How many of each type to keep. `0` disables retention for that type. */
  keepDatabase: number;
  keepMedia: number;
  keepFull: number;
  /** Nothing younger than this is ever taken, whatever the counts say. */
  minimumAgeHours: number;
};

export type RetentionPlan = {
  keep: Retainable[];
  deleteIds: string[];
  /** Why each survivor was kept, where the reason is not simply "recent". */
  spared: { id: string; reason: string }[];
};

/**
 * What retention would do, as a value, before it does any of it.
 *
 * Pure so the **preview** and the **execution** are the same function — a
 * preview computed differently from the deletion it previews is a preview that
 * lies exactly when somebody is relying on it. The screen calls this and shows
 * the counts; the job calls it and deletes `deleteIds`.
 *
 * ---
 *
 * ## The four things it will not delete
 *
 * Each is a way a retention job has taken somebody's last recovery point:
 *
 * 1. **A protected run.** Somebody marked it before an upgrade. That is the
 *    whole feature.
 * 2. **Anything not finished.** A `RUNNING` or `VERIFYING` row has a file
 *    being written into it; deleting the row would orphan the artifact and
 *    deleting the artifact would break the writer.
 * 3. **A `PRE_RESTORE` backup.** It is the state somebody replaced, and it is
 *    wanted precisely when the restore turned out to be a mistake — which is
 *    discovered days later, not in the window a rolling count would keep.
 * 4. **The last verified backup of its type.** The guarantee that matters:
 *    retention may never leave zero recovery points. A count of zero would
 *    otherwise mean "delete everything", and a misconfigured form is not a
 *    reason to have no backups.
 *
 * Unverified runs are deletable, and that is deliberate: a backup that failed
 * verification is not a recovery point, and keeping it in the count would let
 * a run of corrupt artifacts push the last good one out.
 */
export function planRetention(
  runs: Retainable[],
  policy: RetentionPolicy,
  now: Date,
): RetentionPlan {
  const keep: Retainable[] = [];
  const deleteIds: string[] = [];
  const spared: { id: string; reason: string }[] = [];

  const keptFor = (type: BackupType): number =>
    type === "DATABASE" ? policy.keepDatabase : type === "MEDIA" ? policy.keepMedia : policy.keepFull;

  const cutoff = new Date(now.getTime() - policy.minimumAgeHours * 3_600_000);

  for (const type of ["DATABASE", "MEDIA", "FULL"] as BackupType[]) {
    const ofType = runs
      .filter((r) => r.type === type)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // The one that must survive whatever the numbers say.
    const lastGood = ofType.find(
      (r) => r.status === "SUCCESS" && r.verification === "PASSED",
    );

    let counted = 0;
    for (const run of ofType) {
      const limit = keptFor(type);

      if (run.status === "EXPIRED" || run.status === "DELETED") continue;

      if (run.protected) {
        keep.push(run);
        spared.push({ id: run.id, reason: "Vor Löschung geschützt." });
        continue;
      }
      if (run.status === "QUEUED" || run.status === "RUNNING" || run.status === "VERIFYING") {
        keep.push(run);
        spared.push({ id: run.id, reason: "Läuft noch." });
        continue;
      }
      if (run.trigger === "PRE_RESTORE") {
        keep.push(run);
        spared.push({ id: run.id, reason: "Sicherung vor einer Wiederherstellung." });
        continue;
      }
      if (lastGood && run.id === lastGood.id) {
        keep.push(run);
        spared.push({ id: run.id, reason: "Letzte geprüfte Sicherung dieser Art." });
        continue;
      }
      if (run.createdAt > cutoff) {
        keep.push(run);
        continue;
      }

      counted += 1;
      // `limit` counts the *keepable* ones. A spared run does not consume a
      // slot, or protecting three backups would silently evict three others.
      if (limit > 0 && counted <= limit) {
        keep.push(run);
        continue;
      }
      deleteIds.push(run.id);
    }
  }

  return { keep, deleteIds, spared };
}

/**
 * Why this run may not be deleted by hand, or `null` when it may.
 *
 * Narrower than retention: a person deleting one deliberately may take an
 * unverified or a pre-restore backup, because they can see what it is. What
 * nobody may do is take the **last verified recovery point** or a run that is
 * still being written.
 */
export function refuseDelete(run: Retainable, isLastVerifiedOfType: boolean): string | null {
  if (run.status === "RUNNING" || run.status === "VERIFYING" || run.status === "QUEUED") {
    return "Diese Sicherung läuft noch. Warten Sie, bis sie abgeschlossen ist.";
  }
  if (run.protected) {
    return "Diese Sicherung ist vor Löschung geschützt. Heben Sie den Schutz zuerst auf.";
  }
  if (isLastVerifiedOfType) {
    return (
      "Das ist die letzte geprüfte Sicherung dieser Art. Erstellen Sie zuerst eine neue, " +
      "sonst bleibt kein Wiederherstellungspunkt übrig."
    );
  }
  return null;
}

/* ================================================================== */
/* Restore                                                             */
/* ================================================================== */

export type Compatibility = "COMPATIBLE" | "REQUIRES_MIGRATION" | "INCOMPATIBLE";

/**
 * Whether a backup can be restored into the application as it stands.
 *
 * Three answers rather than a boolean, because the middle one is the common
 * case and treating it as either extreme is wrong in a different direction:
 * refusing it makes last month's backup useless, and allowing it silently
 * produces a database the application half-understands.
 *
 * The comparison is the **migration name**, which is what Prisma's
 * `_prisma_migrations` table records and the only thing that actually describes
 * a schema. An application version would be a proxy for it, and a wrong one —
 * two releases can share a version and differ in schema, and the reverse.
 *
 * | | |
 * | --- | --- |
 * | Same migration | `COMPATIBLE` — restore and run |
 * | Backup is **older** | `REQUIRES_MIGRATION` — restore, then `prisma migrate deploy` |
 * | Backup is **newer** | `INCOMPATIBLE` — the code does not know the schema |
 * | Either unknown | `INCOMPATIBLE` — refuse rather than guess |
 *
 * The newer case is the one worth stating: restoring a backup from a *later*
 * release means the database has tables and columns this build has never heard
 * of, and Prisma will not migrate backwards. That is a manual recovery, and
 * saying so is more useful than attempting it.
 */
export function assessCompatibility(
  backupMigration: string | null,
  currentMigration: string | null,
  knownMigrations: string[],
): { result: Compatibility; reason: string } {
  if (!backupMigration || !currentMigration) {
    return {
      result: "INCOMPATIBLE",
      reason:
        "Der Schema-Stand dieser Sicherung ist nicht bekannt. Eine Wiederherstellung wäre ein Blindflug.",
    };
  }
  if (backupMigration === currentMigration) {
    return { result: "COMPATIBLE", reason: "Gleicher Schema-Stand wie die laufende Anwendung." };
  }

  const backupAt = knownMigrations.indexOf(backupMigration);
  const currentAt = knownMigrations.indexOf(currentMigration);

  if (backupAt === -1) {
    return {
      result: "INCOMPATIBLE",
      reason:
        `Die Migration „${backupMigration}“ ist dieser Anwendung unbekannt — die Sicherung stammt ` +
        "vermutlich aus einer neueren Version. Prisma migriert nicht rückwärts.",
    };
  }
  if (backupAt < currentAt) {
    return {
      result: "REQUIRES_MIGRATION",
      reason:
        `Die Sicherung ist ${currentAt - backupAt} Migration(en) älter. Nach dem Einspielen muss ` +
        "`prisma migrate deploy` laufen.",
    };
  }
  return {
    result: "INCOMPATIBLE",
    reason: "Die Sicherung ist neuer als die laufende Anwendung. Das ist eine manuelle Wiederherstellung.",
  };
}

/**
 * Whether a restore run may be *executed* in its current status.
 *
 * `REQUESTED` only. A run in any other status has already been picked up —
 * `RUNNING`/`VALIDATING` by a worker that may still be at it, `FAILED`/
 * `ABORTED` after touching its target — and executing it again would replace
 * a database whose state nobody has examined. `SUCCESS` is answered earlier
 * as a no-op. The second lock behind `NEVER_RETRYABLE` (SEC-R4).
 */
export function mayRun(status: RestoreStatus): boolean {
  return status === "REQUESTED";
}

/**
 * Why this backup may not be restored, or `null` when it may.
 *
 * Consults no permission — that is `@RequirePermissions` and the re-auth
 * window, and both are checked before this is reached. What this answers is
 * whether the *artifact* is fit to restore, which is a different question and
 * one no permission can settle.
 */
export function refuseRestore(input: {
  status: BackupStatus;
  verification: VerificationStatus;
  type: BackupType;
  compatibility: Compatibility;
  hasDatabaseArtifact: boolean;
}): string | null {
  if (input.status !== "SUCCESS") {
    return `Diese Sicherung steht auf „${input.status}“. Nur abgeschlossene Sicherungen lassen sich einspielen.`;
  }
  if (input.verification !== "PASSED") {
    /*
      The rule the whole module turns on.

      A backup that has not been proved readable is an assumption. Restoring
      from one means discovering it was corrupt *after* replacing the database
      it was meant to replace — which is the single worst outcome this feature
      can produce, and the one an unverified-restore button makes reachable.
    */
    return (
      "Diese Sicherung wurde nicht erfolgreich geprüft. Eine ungeprüfte Sicherung einzuspielen " +
      "heisst, erst nach dem Überschreiben zu erfahren, ob sie brauchbar war."
    );
  }
  if (input.type === "MEDIA") {
    return "Eine reine Medien-Sicherung enthält keine Datenbank. Wählen Sie eine Datenbank- oder Voll-Sicherung.";
  }
  if (!input.hasDatabaseArtifact) {
    return "Zu dieser Sicherung gibt es keinen Datenbank-Abzug.";
  }
  if (input.compatibility === "INCOMPATIBLE") {
    return "Diese Sicherung ist mit dem laufenden Schema nicht verträglich.";
  }
  return null;
}

/**
 * The phrase an operator has to type before an in-place restore proceeds.
 *
 * A fixed word rather than the backup's own id, and that is a usability
 * decision with a safety argument: an id is copied and pasted, which is the one
 * interaction that defeats a confirmation box entirely. A word that must be
 * typed cannot be produced by selecting the thing on screen.
 */
export const RESTORE_CONFIRMATION = "WIEDERHERSTELLEN";

export function refuseConfirmation(typed: string): string | null {
  return typed.trim() === RESTORE_CONFIRMATION
    ? null
    : `Zum Bestätigen muss „${RESTORE_CONFIRMATION}“ eingegeben werden.`;
}

/* ================================================================== */
/* Concurrency                                                         */
/* ================================================================== */

/**
 * Which operations may not overlap, as one table.
 *
 * Held here rather than as `if` statements at three call sites, because the
 * rule is about *pairs* and a pair is exactly what gets forgotten: the author
 * who adds a lock to the restore path remembers restore-versus-restore and not
 * retention-versus-restore.
 *
 * `BACKUP + BACKUP` is **allowed**, and that is not an oversight: two backups
 * write to two generated keys and contend for nothing but disk. Forbidding it
 * would mean a manual backup failing because the nightly one is running, at
 * the moment somebody is taking a backup *because* they are about to do
 * something risky.
 */
export type BackupOperation = "BACKUP" | "RESTORE" | "RETENTION";

const FORBIDDEN: [BackupOperation, BackupOperation][] = [
  ["RESTORE", "RESTORE"],
  ["RESTORE", "BACKUP"],
  ["RESTORE", "RETENTION"],
  ["RETENTION", "RETENTION"],
];

/**
 * Why `wanted` may not start while `running` is in flight, or `null`.
 *
 * Symmetric by construction — the pair is checked both ways round, so
 * `[RESTORE, BACKUP]` also forbids a restore starting during a backup. A
 * one-directional table is how "we blocked backups during a restore" turns out
 * not to have blocked a restore during a backup.
 */
export function refuseConcurrent(
  wanted: BackupOperation,
  running: BackupOperation[],
): string | null {
  for (const other of running) {
    const clash = FORBIDDEN.some(
      ([a, b]) => (a === wanted && b === other) || (a === other && b === wanted),
    );
    if (clash) {
      return LABEL[other] + " läuft gerade. " + REASON[wanted];
    }
  }
  return null;
}

const LABEL: Record<BackupOperation, string> = {
  BACKUP: "Eine Sicherung",
  RESTORE: "Eine Wiederherstellung",
  RETENTION: "Das Aufräumen alter Sicherungen",
};

const REASON: Record<BackupOperation, string> = {
  BACKUP: "Während einer Wiederherstellung wäre die Sicherung ein Abbild eines halben Zustands.",
  RESTORE: "Zwei destruktive Vorgänge dürfen sich nicht überschneiden.",
  RETENTION: "Es könnte genau die Sicherung löschen, die gerade eingespielt wird.",
};

