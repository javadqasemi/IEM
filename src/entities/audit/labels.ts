/**
 * Maps an audit action to a readable German phrase.
 *
 * A lookup rather than a mechanical de-dotting of the key, because the log is
 * the one screen a non-developer reads in an incident and
 * "content.rolled_back" is not a sentence. Unknown actions fall through to the
 * raw key — visible and greppable, rather than hidden behind a generic label.
 *
 * The keys are written by `AuditService.record` on the server. Nothing keeps
 * the two lists in step today; a new action simply shows as its key, which is
 * the right failure — wrong-but-readable rather than blank.
 */
const ACTION_LABELS: Record<string, string> = {
  "auth.login": "hat sich angemeldet",
  "auth.logout": "hat sich abgemeldet",
  "auth.logout_all": "hat alle Sitzungen beendet",
  "auth.login_failed": "Anmeldung fehlgeschlagen",
  "auth.login_locked": "Konto gesperrt nach Fehlversuchen",
  "auth.login_suspended": "Anmeldung eines gesperrten Kontos",
  "auth.refresh_reuse_detected": "Wiederverwendetes Sitzungstoken erkannt",
  "auth.password_changed": "hat das Passwort geändert",
  "auth.password_reset_requested": "hat ein neues Passwort angefordert",
  "auth.password_reset_completed": "hat das Passwort zurückgesetzt",
  "content.created": "hat angelegt",
  "content.updated": "hat bearbeitet",
  "content.deleted": "hat gelöscht",
  "content.restored": "hat wiederhergestellt",
  "content.duplicated": "hat dupliziert",
  "content.reordered": "hat die Reihenfolge geändert",
  "content.submitted": "hat zur Freigabe eingereicht",
  "content.approved": "hat freigegeben",
  "content.rejected": "hat abgelehnt",
  "content.published": "hat veröffentlicht",
  "content.rolled_back": "hat zurückgesetzt",
  "content.snapshot_restored": "hat einen früheren Stand wiederhergestellt",
  "content.scheduled_publish_failed": "Zeitgesteuerte Veröffentlichung fehlgeschlagen",
  "media.uploaded": "hat hochgeladen",
  "media.updated": "hat Metadaten geändert",
  "media.replaced": "hat die Datei ersetzt",
  "media.deleted": "hat gelöscht",
  "media.bulk_deleted": "hat mehrere Dateien gelöscht",
  "media.folder_created": "hat einen Ordner angelegt",
  "media.folder_deleted": "hat einen Ordner gelöscht",
  "user.invited": "hat eingeladen",
  "user.updated": "hat bearbeitet",
  "user.roles_changed": "hat Rollen geändert",
  "user.deleted": "hat gelöscht",
  "user.password_reset_sent": "hat einen Passwortlink verschickt",
  "role.created": "hat eine Rolle angelegt",
  "role.updated": "hat eine Rolle geändert",
  "role.deleted": "hat eine Rolle gelöscht",
  "settings.updated": "hat Einstellungen geändert",
  "application.viewed": "hat eine Bewerbung geöffnet",
  "application.file_downloaded": "hat Unterlagen heruntergeladen",
  "application.retention_purge": "Aufbewahrungsfrist abgelaufen",

  /**
   * These three are now written by the server's audit *listener* rather than
   * by a hand-called `audit.record` (foundation stage F8).
   *
   * The key is derived from the event's name in `core/events/catalogue.ts`, so
   * the vocabulary has one source on both sides. Two of the three happen to
   * derive to exactly what they were called before — `ApplicationReceived` →
   * `application.received` — which is why the migration needed no change here.
   *
   * `application_status.changed` is the one that moved: it replaces
   * `application.updated`, and it says more. The old key stays in this map
   * because rows written under it still exist — nothing rewrites history, and
   * a lookup that lost a spelling would turn three months of the log into raw
   * keys.
   */
  "application.received": "Neue Bewerbung eingegangen",
  "application.deleted": "hat eine Bewerbung gelöscht",
  "application_status.changed": "hat den Status geändert",
  "application.updated": "hat eine Bewerbung bearbeitet",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export type AuditOutcome = "SUCCESS" | "FAILURE" | "DENIED";

/** One line of the audit trail, as the feed renders it. */
export type ActivityItem = {
  id: string;
  action: string;
  actor: string;
  target?: string;
  message?: string | null;
  outcome?: AuditOutcome;
  at: string;
};
