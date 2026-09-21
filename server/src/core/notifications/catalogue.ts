/**
 * Every notification this system can produce, by name, with who gets it.
 *
 * The third catalogue in `core/`, and it exists for the reason the other two
 * do. `core/events/catalogue.ts` opens by saying that a bus with free-text
 * names is a mesh that has learned to use strings; the same is true of a
 * notification platform with free-text kinds, and worse — a typo there
 * produces a message nobody can switch off, because the settings screen is
 * generated from this file and would not know the type exists.
 *
 * ---
 *
 * ## What one entry decides
 *
 * A single declaration answers every question the platform asks, in one place
 * a reader can check against the settings screen:
 *
 * | | |
 * | --- | --- |
 * | `severity` | how it is drawn, everywhere |
 * | `recipients` | who is owed it — never a hardcoded id in a business service |
 * | `defaults` | what happens before anybody configures anything |
 * | `mandatory` | whether it can be switched off at all |
 *
 * ## `mandatory`, and why four entries have it
 *
 * The same shape `security.policy.ts` gives its numbers:
 * **invariant → organisation policy → user preference**, resolved in that
 * order and never the other way. A mandatory notification's *in-app* copy
 * cannot be disabled by the firm or by the person, because the four that carry
 * it are the ones that tell you somebody changed how your account is
 * protected. A notification you can be talked out of receiving is not a
 * security control; it is a courtesy that an attacker turns off first.
 *
 * What stays configurable even there is the **e-mail**. Somebody who reads
 * every notification in the dashboard may legitimately not want a second copy
 * in their inbox, and refusing that is how people stop reading either.
 *
 * ## Why there is no entry without a producer
 *
 * Ten types, and every one of them is raised by something that exists —
 * `notifications.listener.ts` is the whole list of producers and
 * `notifications.catalogue.test.ts` asserts the two agree in both directions.
 * A declared type nothing raises would appear in the settings screen as a
 * switch that governs nothing, which is exactly the dead-permission problem
 * `rbac/resources.ts` was restructured to end.
 */

import type { NotificationSeverity } from "@prisma/client";

/* ================================================================== */
/* Recipients                                                          */
/* ================================================================== */

/**
 * How the platform works out who is owed a notification.
 *
 * Centralised here rather than decided per call site, which is the rule the
 * brief states and the one that keeps a business service from growing an
 * `if (user.email === "hr@…")`. Three strategies cover every case the system
 * has; a fourth is a change to this union and to `recipients.ts`, not to ten
 * services.
 */
export type RecipientStrategy =
  /**
   * The person the event is *about* — `entityId` is their user id.
   *
   * Every security notification uses this. It is the only strategy where the
   * recipient can also be the actor, and the one place that matters: if
   * somebody with your session disables your second factor, they *are* you as
   * far as the system can tell, and suppressing the message because
   * "the actor already knows" would suppress precisely the case the
   * notification exists for. See `SUPPRESS_ACTOR` below.
   */
  | { kind: "subject" }
  /**
   * Everybody holding a permission.
   *
   * "Whoever can approve content" rather than a list of names, so the
   * recipients follow the role editor instead of drifting from it. Super
   * Admin is included by the same short-circuit `PermissionsGuard` uses.
   */
  | { kind: "permission"; permission: string }
  /**
   * Specific people the event names — the author of an entry, the person a
   * task was assigned to.
   *
   * The listener supplies the ids from the event payload, which is why those
   * payloads carry them: "who should be told" is part of the fact, and a
   * resolver that had to go and look it up would be reaching into another
   * module's tables.
   */
  | { kind: "explicit" };

/* ================================================================== */
/* The catalogue                                                       */
/* ================================================================== */

export type NotificationCategory = "Sicherheit" | "Inhalte" | "Bewerbungen" | "System";

export type NotificationDef = {
  key: NotificationType;
  category: NotificationCategory;
  /** What the settings screen calls it. Never the key. */
  label: string;
  /** One sentence a non-developer can decide from. */
  description: string;
  severity: NotificationSeverity;
  recipients: RecipientStrategy;
  defaults: { inApp: boolean; email: boolean };
  /**
   * Cannot be switched off — see the note at the top.
   *
   * It binds the in-app channel only. `mandatory: true` with
   * `defaults.email: false` would be a contradiction nobody could resolve, so
   * every mandatory entry defaults e-mail on and lets the person turn it off.
   */
  mandatory: boolean;
};

export type NotificationType =
  | "security.mfa_enabled"
  | "security.mfa_disabled"
  | "security.mfa_reset"
  | "security.mfa_recovery_regenerated"
  | "content.submitted_for_review"
  | "content.approved"
  | "content.rejected"
  | "content.published"
  | "application.received"
  | "system.job_failed";

export const NOTIFICATION_TYPES: NotificationDef[] = [
  /* ---- Sicherheit — the four that cannot be switched off ----------- */
  {
    key: "security.mfa_enabled",
    category: "Sicherheit",
    label: "Zwei-Faktor-Authentisierung aktiviert",
    description:
      "Wenn für Ihr Konto ein zweiter Faktor eingerichtet wurde. Sie erfahren es auch dann, wenn Sie es selbst waren — sonst wäre die Meldung genau im Ernstfall still.",
    severity: "SUCCESS",
    recipients: { kind: "subject" },
    defaults: { inApp: true, email: true },
    mandatory: true,
  },
  {
    key: "security.mfa_disabled",
    category: "Sicherheit",
    label: "Zwei-Faktor-Authentisierung deaktiviert",
    description:
      "Wenn der zweite Faktor Ihres Kontos entfernt wurde. Das ist die wichtigste Meldung im System: wer Ihre Sitzung übernommen hat, würde genau hier ansetzen.",
    severity: "WARNING",
    recipients: { kind: "subject" },
    defaults: { inApp: true, email: true },
    mandatory: true,
  },
  {
    key: "security.mfa_reset",
    category: "Sicherheit",
    label: "Zwei-Faktor-Authentisierung zurückgesetzt",
    description:
      "Wenn die Administration Ihren zweiten Faktor zurückgesetzt hat — etwa nach einem verlorenen Telefon. Alle Ihre Sitzungen wurden dabei beendet.",
    severity: "CRITICAL",
    recipients: { kind: "subject" },
    defaults: { inApp: true, email: true },
    mandatory: true,
  },
  {
    key: "security.mfa_recovery_regenerated",
    category: "Sicherheit",
    label: "Neue Wiederherstellungscodes",
    description:
      "Wenn für Ihr Konto neue Wiederherstellungscodes erzeugt wurden. Die bisherigen sind damit ungültig.",
    severity: "WARNING",
    recipients: { kind: "subject" },
    defaults: { inApp: true, email: true },
    mandatory: true,
  },

  /* ---- Inhalte ----------------------------------------------------- */
  {
    key: "content.submitted_for_review",
    category: "Inhalte",
    label: "Inhalt zur Freigabe eingereicht",
    description:
      "Geht an alle, die freigeben dürfen. Ohne diese Meldung liegt eine Einreichung so lange in der Freigabeliste, bis jemand zufällig hinsieht.",
    severity: "INFO",
    recipients: { kind: "permission", permission: "content.approve" },
    defaults: { inApp: true, email: false },
    mandatory: false,
  },
  {
    key: "content.approved",
    category: "Inhalte",
    label: "Eigener Inhalt freigegeben",
    description: "Geht an die Person, die den Eintrag eingereicht hat.",
    severity: "SUCCESS",
    recipients: { kind: "explicit" },
    defaults: { inApp: true, email: false },
    mandatory: false,
  },
  {
    key: "content.rejected",
    category: "Inhalte",
    label: "Eigener Inhalt abgelehnt",
    description:
      "Geht an die Person, die den Eintrag eingereicht hat, mit der Begründung. Standardmässig auch per E-Mail: eine Ablehnung liegt sonst ungesehen im Dashboard, während jemand auf die Veröffentlichung wartet.",
    severity: "WARNING",
    recipients: { kind: "explicit" },
    defaults: { inApp: true, email: true },
    mandatory: false,
  },
  {
    key: "content.published",
    category: "Inhalte",
    label: "Website veröffentlicht",
    description:
      "Wenn ein neuer Stand der Website live gegangen ist. Geht an alle, die freigeben dürfen.",
    severity: "SUCCESS",
    recipients: { kind: "permission", permission: "content.approve" },
    defaults: { inApp: true, email: false },
    mandatory: false,
  },

  /* ---- Bewerbungen -------------------------------------------------- */
  {
    key: "application.received",
    category: "Bewerbungen",
    label: "Neue Bewerbung",
    description:
      "Wenn über das Formular auf der Website eine Bewerbung eingeht. Geht an alle, die Bewerbungen ansehen dürfen.",
    severity: "INFO",
    recipients: { kind: "permission", permission: "application.read" },
    /*
      E-Mail an, und das ist kein Vorschlag, sondern der bisherige Zustand.

      Before this module, a new application sent a mail to a configured
      address. Defaulting the replacement to in-app only would have quietly
      stopped that mail on the day this shipped — a regression nobody would
      notice until an application sat unread for a week.
    */
    defaults: { inApp: true, email: true },
    mandatory: false,
  },

  /* ---- System -------------------------------------------------------- */
  {
    key: "system.job_failed",
    category: "System",
    label: "Hintergrundaufgabe endgültig fehlgeschlagen",
    description:
      "Wenn eine Aufgabe nach allen Versuchen aufgibt — ein Export, eine Veröffentlichung, ein Versand. Geht an alle, die den Systemzustand einsehen dürfen.",
    severity: "CRITICAL",
    recipients: { kind: "permission", permission: "system.health" },
    defaults: { inApp: true, email: true },
    mandatory: false,
  },
];

/* ================================================================== */
/* Lookups                                                             */
/* ================================================================== */

const BY_KEY = new Map(NOTIFICATION_TYPES.map((def) => [def.key, def]));

export function notificationDef(type: string): NotificationDef | null {
  return BY_KEY.get(type as NotificationType) ?? null;
}

/** The keys, at runtime — for the settings screen and for the tests. */
export const NOTIFICATION_TYPE_KEYS = NOTIFICATION_TYPES.map((d) => d.key);

/**
 * The categories in the order the settings screen shows them.
 *
 * Declared rather than derived from the entries, because the order is
 * editorial: Sicherheit first because it is the group a reader is most likely
 * to be looking for and the only one they cannot change.
 */
export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  "Sicherheit",
  "Inhalte",
  "Bewerbungen",
  "System",
];

/**
 * Whether the actor is removed from the recipients of this type.
 *
 * True for everything except the `subject` strategy, and the exception is the
 * entire point: telling somebody what they just did is noise, **unless the
 * message is "somebody changed how your account is protected"** — because
 * there the actor and the account holder being the same person is exactly what
 * the reader needs to be able to check.
 */
export function suppressesActor(def: NotificationDef): boolean {
  return def.recipients.kind !== "subject";
}
