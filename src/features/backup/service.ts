import type { BadgeTone } from "@/shared/ui/primitives";
import type {
  BackupRun,
  BackupState,
  BackupStatus,
  BackupTrigger,
  BackupType,
  RestoreMode,
  RestoreStatus,
  VerificationStatus,
} from "./types";

/**
 * Everything the backup screens decide that is arithmetic rather than I/O.
 *
 * Pure, so it can be covered exhaustively. What lives here is the *wording* of
 * an operational panel, and it is worth testing for one reason: **a backup
 * panel that reads reassuringly when it should not is worse than no panel**,
 * and nothing about that failure is visible from the code that renders it.
 */

/* ================================================================== */
/* The verdict                                                         */
/* ================================================================== */

const STATE: Record<BackupState, { label: string; tone: BadgeTone; detail: string }> = {
  healthy: {
    label: "Betriebsbereit",
    tone: "energy",
    detail: "Automatische Sicherungen laufen und werden geprüft.",
  },
  warning: {
    label: "Eingeschränkt",
    tone: "gold",
    detail:
      "Es gibt Wiederherstellungspunkte, aber etwas stimmt nicht — keine Automatik, oder die letzte Sicherung ist alt.",
  },
  critical: {
    label: "Gestört",
    tone: "bronze",
    detail: "Es gibt derzeit keinen brauchbaren Wiederherstellungspunkt. Das ist dringend.",
  },
  not_configured: {
    label: "Nicht konfiguriert",
    tone: "neutral",
    detail: "Sicherungen sind nicht eingerichtet.",
  },
  /*
    `unknown` is "never taken one", and it is **not** drawn green.

    A green light on an installation that has never taken a backup is the
    single most dangerous thing this panel could say — it is the statement an
    operator would rely on, and it would be false in exactly the case where
    relying on it costs everything.
  */
  unknown: {
    label: "Ungeprüft",
    tone: "neutral",
    detail: "Es wurde noch nie eine Sicherung erstellt. Erstellen Sie jetzt eine.",
  },
};

export function describeState(state: BackupState) {
  return STATE[state];
}

/* ================================================================== */
/* Runs                                                                */
/* ================================================================== */

const STATUS: Record<BackupStatus, { label: string; tone: BadgeTone }> = {
  QUEUED: { label: "Eingereiht", tone: "neutral" },
  RUNNING: { label: "Läuft", tone: "air" },
  VERIFYING: { label: "Wird geprüft", tone: "air" },
  SUCCESS: { label: "Erfolgreich", tone: "energy" },
  FAILED: { label: "Fehlgeschlagen", tone: "bronze" },
  EXPIRED: { label: "Abgelaufen", tone: "neutral" },
  DELETED: { label: "Gelöscht", tone: "neutral" },
};

export function describeStatus(status: BackupStatus) {
  return STATUS[status] ?? { label: status, tone: "neutral" as BadgeTone };
}

const VERIFICATION: Record<VerificationStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "Ungeprüft", tone: "neutral" },
  PASSED: { label: "Geprüft", tone: "energy" },
  FAILED: { label: "Prüfung fehlgeschlagen", tone: "bronze" },
};

export function describeVerification(v: VerificationStatus) {
  return VERIFICATION[v];
}

const TYPE: Record<BackupType, string> = {
  DATABASE: "Datenbank",
  MEDIA: "Medien",
  FULL: "Datenbank und Medien",
};

export function describeType(type: BackupType): string {
  return TYPE[type] ?? type;
}

const TRIGGER: Record<BackupTrigger, string> = {
  MANUAL: "Manuell",
  SCHEDULED: "Geplant",
  PRE_RESTORE: "Vor Wiederherstellung",
};

export function describeTrigger(trigger: BackupTrigger): string {
  return TRIGGER[trigger] ?? trigger;
}

/**
 * Whether a run is still moving, so the screen knows to keep polling.
 *
 * Polling stops when nothing is in flight, which matters more here than
 * elsewhere: a backup list left polling every few seconds on an idle tab is a
 * request per tab per interval against an endpoint that aggregates.
 */
export function isInFlight(run: Pick<BackupRun, "status">): boolean {
  return run.status === "QUEUED" || run.status === "RUNNING" || run.status === "VERIFYING";
}

export function anyInFlight(runs: Pick<BackupRun, "status">[]): boolean {
  return runs.some(isInFlight);
}

/* ================================================================== */
/* Restores                                                            */
/* ================================================================== */

const RESTORE_STATUS: Record<RestoreStatus, { label: string; tone: BadgeTone }> = {
  REQUESTED: { label: "Angefordert", tone: "neutral" },
  RUNNING: { label: "Läuft", tone: "air" },
  VALIDATING: { label: "Wird geprüft", tone: "air" },
  SUCCESS: { label: "Erfolgreich", tone: "energy" },
  FAILED: { label: "Fehlgeschlagen", tone: "bronze" },
  /*
    `ABORTED` is neutral rather than red, and the distinction is the whole
    safety story: it means the pre-restore backup failed and the restore
    stopped **before overwriting anything**. That is the system working, not a
    fault, and drawing it as a failure would teach an operator to fear the one
    outcome that protected them.
  */
  ABORTED: { label: "Abgebrochen — nichts überschrieben", tone: "neutral" },
};

export function describeRestoreStatus(status: RestoreStatus) {
  return RESTORE_STATUS[status] ?? { label: status, tone: "neutral" as BadgeTone };
}

const MODE: Record<RestoreMode, { label: string; detail: string }> = {
  DRILL: {
    label: "Übung",
    detail:
      "Spielt die Sicherung in eine separate Datenbank ein und prüft das Ergebnis. Der Betrieb bleibt unberührt.",
  },
  IN_PLACE: {
    label: "Produktivsystem",
    detail:
      "Ersetzt die laufende Datenbank. Vorher wird automatisch eine Sicherung des aktuellen Standes erstellt; schlägt diese fehl, wird abgebrochen.",
  },
};

export function describeMode(mode: RestoreMode) {
  return MODE[mode];
}

const COMPATIBILITY: Record<string, { label: string; tone: BadgeTone }> = {
  COMPATIBLE: { label: "Verträglich", tone: "energy" },
  REQUIRES_MIGRATION: { label: "Migration nötig", tone: "gold" },
  INCOMPATIBLE: { label: "Nicht verträglich", tone: "bronze" },
};

export function describeCompatibility(value: string) {
  return COMPATIBILITY[value] ?? { label: value, tone: "neutral" as BadgeTone };
}

/** The word an operator has to type. Mirrors `RESTORE_CONFIRMATION` on the server. */
export const RESTORE_CONFIRMATION = "WIEDERHERSTELLEN";

/**
 * Why the restore button stays disabled, or `null`.
 *
 * The server refuses all of these too — it is the control and this is the
 * courtesy. The courtesy matters here more than usual: a button that could
 * only ever produce a 400 reads as an offer, and the offer being made is
 * "replace the production database".
 */
export function refuseSubmit(input: {
  restorable: boolean;
  refusal: string | null;
  confirmation: string;
}): string | null {
  if (!input.restorable) return input.refusal ?? "Diese Sicherung kann nicht eingespielt werden.";
  if (input.confirmation.trim() !== RESTORE_CONFIRMATION) {
    return `Zum Bestätigen „${RESTORE_CONFIRMATION}“ eingeben.`;
  }
  return null;
}

/* ================================================================== */
/* Formatting                                                          */
/* ================================================================== */

/**
 * Bytes, in the units an operator thinks in.
 *
 * Binary steps with decimal-looking labels, which is what every filesystem
 * tool on the machines this runs on does. Being pedantically correct about
 * MiB here would make the number disagree with what Explorer and `ls -lh` say
 * about the same file.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  // Swiss convention: apostrophe thousands. `toFixed` first so 1024 does not
  // render as "1'024.0 KB" when it should be "1 MB".
  const text = value >= 100 || i === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${text.replace(/\B(?=(\d{3})+(?!\d))/g, "'")} ${units[i]}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}
