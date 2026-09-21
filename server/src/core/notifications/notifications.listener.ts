import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { EventBus } from "../events/event-bus";
import { JobService } from "../jobs/job.service";
import type { DomainEvent, DomainEventName } from "../events/catalogue";
import { notificationEventKey } from "./notifications.rules";
import {
  NotificationsService,
  type NotificationDraft,
} from "./notifications.service";
import type { NotificationType } from "./catalogue";

/**
 * The only place a domain event becomes a notification.
 *
 * ---
 *
 * **Every producer in the system is this file's `MAP`.** Not a
 * `notify(...)` call scattered through ten services — that is the shape the
 * platform replaces, and the reason is the one `AuditListener` gives for the
 * same decision one layer up: a call somebody has to remember to write is a
 * call somebody forgets, and the ones nobody wrote are invisible. There is no
 * failing test for a notification that was never sent.
 *
 * So a module raises its event and is finished. It does not import this, does
 * not know Notifications exists, and cannot break by forgetting it.
 *
 * **It subscribes by name, not with `"*"`.** `EventBus` reserves the wildcard
 * for consumers that need every event by definition — the audit listener and,
 * later, the workflow engine — and says a third is a sign something should be
 * reacting to named events instead. This is that third, and it is named.
 *
 * ---
 *
 * ## The loop that had to be cut
 *
 * `JobFailed` produces a notification, a notification produces an e-mail job,
 * and a failing e-mail job produces a `JobFailed`. Left alone that is a mail
 * server outage turning into an unbounded queue of mail about mail.
 *
 * `SELF_INFLICTED` is the cut: a `notification.deliver` job that dies does
 * **not** raise a notification. The failure is still a `DEAD` row, still an
 * audit entry and still in the log — the three places an operator looks —
 * and the one channel that cannot report its own failure is the channel that
 * is broken.
 */
@Injectable()
export class NotificationsListener implements OnModuleInit {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly bus: EventBus,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobService,
  ) {}

  onModuleInit(): void {
    for (const name of Object.keys(MAP) as DomainEventName[]) {
      this.bus.on(name, (event) => this.handle(event));
    }

    /*
      The e-mail channel's worker, registered here rather than in the service.

      `JobService.register` throws on a duplicate name, so registration has to
      happen exactly once — `onModuleInit` on a singleton is that place, and
      keeping it beside the subscriptions means the producer and the consumer
      of `notification.deliver` are visible together.
    */
    this.jobs.register("notification.deliver", async (payload) => {
      const { status } = await this.notifications.deliverEmail(payload.deliveryId);
      return { status };
    });
  }

  private async handle(event: DomainEvent): Promise<void> {
    const build = MAP[event.name];
    if (!build) return;

    try {
      const draft = build(event);
      if (!draft) return;
      await this.notifications.dispatch({
        ...draft,
        eventKey: notificationEventKey({
          eventName: event.name,
          entity: event.entity,
          entityId: event.entityId,
          correlationId: event.correlationId,
        }),
        actor: event.actor ? { id: event.actor.id, name: event.actor.name } : null,
      });
    } catch (err) {
      // `EventBus` already isolates a throwing listener from its publisher.
      // This second guard is so that one unmappable event does not stop the
      // handler being registered for the next one.
      this.logger.error(
        `Benachrichtigung für ${event.name} fehlgeschlagen: ${(err as Error).message}`,
      );
    }
  }
}

/* ================================================================== */
/* The map                                                             */
/* ================================================================== */

/** Everything a builder returns except the parts the listener fills in. */
type Built = Omit<NotificationDraft, "eventKey" | "actor"> | null;

type Builder = (event: DomainEvent) => Built;

/** Narrow the payload without a cast at every call site. */
const payloadOf = <T>(event: DomainEvent): T => event.payload as T;

/**
 * Jobs whose failure must not be announced by a notification.
 *
 * Exactly the one that *is* the notification channel — see the note above.
 */
const SELF_INFLICTED = new Set<string>(["notification.deliver"]);

const MAP: Partial<Record<DomainEventName, Builder>> = {
  /* ---- Sicherheit --------------------------------------------------- */
  /*
    All four address the **subject**, which is `event.entityId` — the account
    whose protection changed, never the actor who changed it. On a
    self-service change those are the same person and the notification is
    still sent, deliberately: see `suppressesActor`.
  */
  MfaEnabled: (event) => ({
    type: "security.mfa_enabled" satisfies NotificationType,
    title: "Zwei-Faktor-Authentisierung aktiviert",
    body:
      "Für Ihr Konto ist ab sofort zusätzlich ein Code aus Ihrer Authenticator-App nötig. " +
      "Waren Sie das nicht, ändern Sie sofort Ihr Passwort und melden Sie sich bei der Administration.",
    entityType: "user",
    entityId: event.entityId,
    subjectId: event.entityId,
    link: "#/profil",
  }),

  MfaDisabled: (event) => ({
    type: "security.mfa_disabled" satisfies NotificationType,
    title: "Zwei-Faktor-Authentisierung deaktiviert",
    body:
      "Ihr Konto ist jetzt nur noch durch das Passwort geschützt. Die hinterlegte App und " +
      "alle Wiederherstellungscodes wurden gelöscht. Waren Sie das nicht, ändern Sie sofort " +
      "Ihr Passwort und melden Sie sich bei der Administration.",
    entityType: "user",
    entityId: event.entityId,
    subjectId: event.entityId,
    link: "#/profil",
  }),

  MfaReset: (event) => {
    const payload = payloadOf<{ sessionsRevoked: number }>(event);
    return {
      type: "security.mfa_reset" satisfies NotificationType,
      title: "Ihre Zwei-Faktor-Authentisierung wurde zurückgesetzt",
      body:
        "Die Administration hat den zweiten Faktor Ihres Kontos entfernt — üblicherweise, " +
        `weil Sie keinen Zugriff mehr darauf hatten. ${payload.sessionsRevoked} offene ` +
        "Sitzung(en) wurden dabei beendet. Bitte richten Sie den zweiten Faktor neu ein.",
      entityType: "user",
      entityId: event.entityId,
      subjectId: event.entityId,
      link: "#/profil",
    };
  },

  MfaRecoveryRegenerated: (event) => {
    const payload = payloadOf<{ codes: number }>(event);
    return {
      type: "security.mfa_recovery_regenerated" satisfies NotificationType,
      title: "Neue Wiederherstellungscodes erzeugt",
      body:
        `Für Ihr Konto wurden ${payload.codes} neue Wiederherstellungscodes erzeugt. ` +
        "Die bisherigen sind ab sofort ungültig.",
      entityType: "user",
      entityId: event.entityId,
      subjectId: event.entityId,
      link: "#/profil",
    };
  },

  /* ---- Inhalte ------------------------------------------------------ */
  ContentSubmitted: (event) => {
    const payload = payloadOf<{ typeKey: string; key: string }>(event);
    return {
      type: "content.submitted_for_review" satisfies NotificationType,
      title: "Ein Inhalt wartet auf Freigabe",
      body: `„${payload.key}“ (${payload.typeKey}) wurde zur Freigabe eingereicht.`,
      entityType: "content_entry",
      entityId: event.entityId,
      link: "#/freigaben",
    };
  },

  ContentApproved: (event) => {
    const payload = payloadOf<{ typeKey: string; key: string; requestedBy: string | null }>(event);
    // The submitter's account is gone — `ReviewRequest.requestedById` is
    // `SetNull`. There is nobody to tell, and inventing a recipient would be
    // worse than the silence.
    if (!payload.requestedBy) return null;
    return {
      type: "content.approved" satisfies NotificationType,
      title: "Ihr Inhalt wurde freigegeben",
      body: `„${payload.key}“ (${payload.typeKey}) ist freigegeben und kann veröffentlicht werden.`,
      entityType: "content_entry",
      entityId: event.entityId,
      recipientIds: [payload.requestedBy],
      link: `#/inhalte/${payload.typeKey}/${event.entityId}`,
    };
  },

  ContentRejected: (event) => {
    const payload = payloadOf<{
      typeKey: string;
      key: string;
      requestedBy: string | null;
      note?: string;
    }>(event);
    if (!payload.requestedBy) return null;
    return {
      type: "content.rejected" satisfies NotificationType,
      title: "Ihr Inhalt wurde abgelehnt",
      body:
        `„${payload.key}“ (${payload.typeKey}) wurde nicht freigegeben.` +
        (payload.note ? `\n\nBegründung: ${payload.note}` : ""),
      entityType: "content_entry",
      entityId: event.entityId,
      recipientIds: [payload.requestedBy],
      link: `#/inhalte/${payload.typeKey}/${event.entityId}`,
    };
  },

  ContentPublished: (event) => {
    const payload = payloadOf<{
      version: number;
      entriesPublished: number;
      warnings: string[];
    }>(event);
    return {
      type: "content.published" satisfies NotificationType,
      title: `Website veröffentlicht — Stand ${payload.version}`,
      body:
        `${payload.entriesPublished} Eintrag/Einträge sind live.` +
        (payload.warnings.length ? `\n\n${payload.warnings.length} Hinweis(e) beim Erstellen.` : ""),
      entityType: "content_snapshot",
      entityId: event.entityId,
      link: "#/veroeffentlichen",
    };
  },

  /* ---- Bewerbungen --------------------------------------------------- */
  ApplicationReceived: (event) => {
    const payload = payloadOf<{ position: string; files: number }>(event);
    return {
      type: "application.received" satisfies NotificationType,
      title: `Neue Bewerbung: ${payload.position}`,
      body:
        `Über das Formular auf der Website ist eine Bewerbung eingegangen, ` +
        `mit ${payload.files} Datei(en).`,
      entityType: "job_application",
      entityId: event.entityId,
      link: "#/bewerbungen",
    };
  },

  /* ---- System --------------------------------------------------------- */
  JobFailed: (event) => {
    const payload = payloadOf<{ job: string; attempts: number; error: string }>(event);
    // The one cut that stops a mail outage becoming a mail storm.
    if (SELF_INFLICTED.has(payload.job)) return null;
    return {
      type: "system.job_failed" satisfies NotificationType,
      title: `Hintergrundaufgabe fehlgeschlagen: ${payload.job}`,
      body:
        `Die Aufgabe hat nach ${payload.attempts} Versuch(en) aufgegeben.\n\n` +
        `Fehler: ${payload.error}`,
      entityType: "job",
      entityId: event.entityId,
      link: "#/einstellungen/system",
    };
  },
};

/**
 * The event names this listener consumes, for the catalogue agreement test.
 *
 * Exported rather than re-derived, so the test compares the *same* object the
 * listener registers from — a second list would be the thing that drifts.
 */
export const NOTIFIED_EVENTS = Object.keys(MAP) as DomainEventName[];

/** The notification types this listener can produce, for the same test. */
export const PRODUCED_TYPES: NotificationType[] = [
  "security.mfa_enabled",
  "security.mfa_disabled",
  "security.mfa_reset",
  "security.mfa_recovery_regenerated",
  "content.submitted_for_review",
  "content.approved",
  "content.rejected",
  "content.published",
  "application.received",
  "system.job_failed",
];
