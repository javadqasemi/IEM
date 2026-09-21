import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  type NotificationSeverity,
  type Prisma,
} from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { EventBus } from "../events/event-bus";
import { JobService } from "../jobs/job.service";
import { OrganisationService } from "../organisation/organisation.service";
import { MailService } from "../../mail/mail.service";
import {
  NOTIFICATION_TYPES,
  notificationDef,
  type NotificationDef,
  type NotificationType,
} from "./catalogue";
import {
  isLocked,
  resolveChannels,
  resolveRecipients,
  type Candidate,
} from "./notifications.rules";
import { renderNotificationEmail } from "./templates";

/* ------------------------------------------------------------------ */
/* What a producer hands over                                          */
/* ------------------------------------------------------------------ */

/**
 * One fact, addressed to nobody in particular.
 *
 * A producer says *what happened* and, where the catalogue's strategy is
 * `explicit` or `subject`, *who it is about*. It never says which channels,
 * never resolves a permission and never names an e-mail address — all three
 * are this service's business, which is the whole point of having one.
 */
export type NotificationDraft = {
  type: NotificationType;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** A dashboard hash route: `#/freigaben`. */
  link?: string | null;
  /** For the `subject` strategy — the user the event is *about*. */
  subjectId?: string | null;
  /** For the `explicit` strategy — the people the event names. */
  recipientIds?: string[];
  /** Idempotency; see `notificationEventKey`. */
  eventKey: string;
  actor: { id: string | null; name: string | null } | null;
};

export type NotificationView = {
  id: string;
  type: string;
  category: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  link: string | null;
  actorName: string | null;
  read: boolean;
  createdAt: string;
};

/* ------------------------------------------------------------------ */

/**
 * The notification platform.
 *
 * ---
 *
 * ## The one flow
 *
 * ```
 * domain event → listener → draft → dispatch()
 *                                     ├─ recipients   (strategy → users → dedupe)
 *                                     ├─ channels     (invariant → org → person)
 *                                     ├─ Notification (one row per recipient)
 *                                     ├─ Delivery     (one row per channel)
 *                                     └─ job          (e-mail only, durable)
 * ```
 *
 * **No business module sends an e-mail.** They announce facts; this decides
 * who cares and how they are told. The rule is worth stating as an absolute
 * because the two places that broke it before this module —
 * `ApplicationsService` mailing a configured address, and a dead
 * `sendReviewRequest` nobody ever called — are exactly what a notification
 * platform looks like when every feature grows its own.
 *
 * ## Why the in-app copy is written synchronously and the e-mail is not
 *
 * A `Notification` row is one insert and it is what the bell counts; deferring
 * it would mean a user clicking "approve" and seeing nothing for ten seconds.
 * An e-mail is an SMTP round trip to a host that may be down, so it is a
 * `NotificationDelivery` row in `PENDING` and a durable job — which is also
 * what gives it retries, a backoff and a visible failure, all of which
 * `core/jobs` already owns.
 *
 * **A failed e-mail never removes the in-app notification**, because they are
 * different rows. That is the property the two-table split exists for.
 *
 * ## It never throws at its producer
 *
 * `EventBus` already isolates a failing listener, and this adds the second
 * half: a recipient lookup that fails must not lose the other recipients, and
 * nothing here is important enough to fail the request that caused it. What
 * it does instead is log — the same rule `AuditService` states for itself.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobService,
    private readonly mail: MailService,
    private readonly organisation: OrganisationService,
    private readonly config: ConfigService,
    /**
     * For `NotificationSettingsUpdated`, and that is the only direction.
     *
     * This service **publishes** one event and **subscribes to** none —
     * `notifications.listener.ts` is the subscriber, and keeping the two
     * apart is what stops the platform being able to notify itself about its
     * own configuration change.
     */
    private readonly events: EventBus,
  ) {}

  /* ================================================================ */
  /* Producing                                                         */
  /* ================================================================ */

  /**
   * Turns one fact into notifications for everybody owed one.
   *
   * Returns how many rows it wrote, which only the tests read — a producer
   * that awaited a count would be coupled to the delivery decision, which is
   * the coupling the platform removes.
   */
  async dispatch(draft: NotificationDraft): Promise<number> {
    const def = notificationDef(draft.type);
    if (!def) {
      // A type that is not in the catalogue cannot be configured, cannot be
      // switched off and would not appear in the settings screen. Refusing it
      // loudly in the log beats writing a row nobody can govern.
      this.logger.error(`Unbekannter Benachrichtigungstyp "${draft.type}" — verworfen.`);
      return 0;
    }

    const candidates = await this.candidatesFor(def, draft);
    const recipients = resolveRecipients(def, candidates, draft.actor?.id ?? null);
    if (!recipients.length) return 0;

    const [rules, preferences] = await Promise.all([
      this.ruleFor(def.key),
      this.preferencesFor(def.key, recipients),
    ]);

    let written = 0;
    for (const userId of recipients) {
      const channels = resolveChannels(def, rules, preferences.get(userId) ?? null);
      // Nothing at all for this person: no row, nothing to read, nothing to
      // deliver. A `Notification` with both channels off would be an unread
      // badge for something they asked not to be told.
      if (!channels.inApp && !channels.email) continue;

      const created = await this.writeFor(def, draft, userId, channels);
      if (created) written += 1;
    }
    return written;
  }

  /**
   * Who *might* be owed it, before the rules narrow it.
   *
   * The three strategies, and the only place a strategy is turned into people.
   */
  private async candidatesFor(
    def: NotificationDef,
    draft: NotificationDraft,
  ): Promise<Candidate[]> {
    if (def.recipients.kind !== "permission") {
      const ids =
        def.recipients.kind === "subject"
          ? draft.subjectId
            ? [draft.subjectId]
            : []
          : (draft.recipientIds ?? []);
      if (!ids.length) return [];

      const users = await this.prisma.user.findMany({
        where: { id: { in: [...new Set(ids)] } },
        select: { id: true, status: true, deletedAt: true },
      });
      return users.map((u) => ({ id: u.id, active: !u.deletedAt && u.status === "ACTIVE" }));
    }

    /*
      Everybody holding a permission — including Super Admin, who holds it by
      being Super Admin rather than by having the row.

      That short-circuit is the same one `PermissionsGuard` makes, and leaving
      it out here would be the quietest possible bug: the one account that can
      fix anything would be the one account never told that something needs
      fixing.
    */
    const permission = def.recipients.permission;
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        roles: {
          some: {
            role: {
              OR: [
                { key: "super_admin" },
                { permissions: { some: { permission: { key: permission } } } },
              ],
            },
          },
        },
      },
      select: { id: true },
    });
    return users.map((u) => ({ id: u.id, active: true }));
  }

  /**
   * One recipient's rows, written together.
   *
   * The `Notification` and its `NotificationDelivery` children are one
   * transaction: a notification with no delivery row would be invisible to the
   * operational view, and a delivery with no notification cannot exist at all.
   *
   * Returns `false` when the unique index refused it, which is the idempotency
   * working — see `notificationEventKey`. Caught rather than checked first,
   * because a read-then-write is the race the index exists to settle.
   */
  private async writeFor(
    def: NotificationDef,
    draft: NotificationDraft,
    userId: string,
    channels: { inApp: boolean; email: boolean; reason: string | null },
  ): Promise<boolean> {
    const deliveries: Prisma.NotificationDeliveryCreateWithoutNotificationInput[] = [];

    /*
      `IN_APP` is created `DELIVERED`, because the row *is* the delivery.
      There is nothing in flight and nothing to retry; the message is in the
      inbox the moment it is committed.
    */
    if (channels.inApp) {
      deliveries.push({
        channel: NotificationChannel.IN_APP,
        status: NotificationDeliveryStatus.DELIVERED,
        settledAt: new Date(),
      });
    } else {
      deliveries.push({
        channel: NotificationChannel.IN_APP,
        status: NotificationDeliveryStatus.SKIPPED,
        detail: channels.reason,
        settledAt: new Date(),
      });
    }

    deliveries.push(
      channels.email
        ? { channel: NotificationChannel.EMAIL, status: NotificationDeliveryStatus.PENDING }
        : {
            channel: NotificationChannel.EMAIL,
            status: NotificationDeliveryStatus.SKIPPED,
            detail: channels.reason ?? "E-Mail für diese Art nicht aktiviert.",
            settledAt: new Date(),
          },
    );

    try {
      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type: def.key,
          severity: def.severity,
          title: draft.title,
          body: draft.body ?? null,
          entityType: draft.entityType ?? null,
          entityId: draft.entityId ?? null,
          link: draft.link ?? null,
          actorId: draft.actor?.id ?? null,
          actorName: draft.actor?.name ?? null,
          eventKey: draft.eventKey,
          deliveries: { create: deliveries },
        },
        select: {
          id: true,
          deliveries: { select: { id: true, channel: true, status: true } },
        },
      });

      const pending = notification.deliveries.find(
        (d) => d.channel === NotificationChannel.EMAIL && d.status === NotificationDeliveryStatus.PENDING,
      );
      if (pending) {
        await this.jobs.enqueue("notification.deliver", { deliveryId: pending.id });
      }
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      // One recipient failing must not lose the others — the loop in
      // `dispatch` continues, and the log says who was missed.
      this.logger.error(
        `Benachrichtigung ${def.key} für ${userId} fehlgeschlagen: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /* ================================================================ */
  /* Delivering                                                        */
  /* ================================================================ */

  /**
   * The e-mail channel, run by `core/jobs`.
   *
   * Idempotent by construction: it claims the row by moving it out of
   * `PENDING` in a conditional `updateMany`, so a job that runs twice — a
   * duplicate enqueue, a reclaimed worker — finds nothing to do the second
   * time and returns. That is the same one-statement claim `JobService.claim`
   * uses and it needs no lock.
   *
   * @throws when the transport reports an error, so the job's own retry and
   * backoff apply rather than a second retry engine living here. A *stub*
   * send does not throw: it is not a fault, and retrying it three times on
   * every developer machine would fill the queue with work that cannot
   * succeed.
   */
  async deliverEmail(deliveryId: string): Promise<{ status: NotificationDeliveryStatus }> {
    const claimed = await this.prisma.notificationDelivery.updateMany({
      where: { id: deliveryId, status: NotificationDeliveryStatus.PENDING },
      data: { status: NotificationDeliveryStatus.PROCESSING, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      // Already sent, already failed, or already being sent. All three mean
      // "not mine", and saying so is more useful than a silent success.
      const current = await this.prisma.notificationDelivery.findUnique({
        where: { id: deliveryId },
        select: { status: true },
      });
      return { status: current?.status ?? NotificationDeliveryStatus.SKIPPED };
    }

    const delivery = await this.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
      select: {
        id: true,
        notification: {
          select: {
            title: true,
            body: true,
            severity: true,
            link: true,
            actorName: true,
            user: { select: { email: true } },
          },
        },
      },
    });

    const { notification } = delivery;
    const organisation = await this.organisationName();
    const email = renderNotificationEmail({
      title: notification.title,
      body: notification.body,
      severity: notification.severity,
      link: notification.link,
      adminUrl: this.adminUrl,
      actorName: notification.actorName,
      organisation,
    });

    const result = await this.mail.sendNotification(
      notification.user.email,
      email.subject,
      email.text,
    );

    if (result.ok) {
      await this.settle(deliveryId, NotificationDeliveryStatus.DELIVERED, null);
      return { status: NotificationDeliveryStatus.DELIVERED };
    }

    if (result.stub) {
      await this.settle(
        deliveryId,
        NotificationDeliveryStatus.SKIPPED,
        "Kein SMTP-Server konfiguriert — die Nachricht wurde protokolliert.",
      );
      return { status: NotificationDeliveryStatus.SKIPPED };
    }

    /*
      Back to `PENDING` before throwing.

      The job runner decides whether there is another attempt; if there is,
      it must find a row it can claim again. Leaving it `PROCESSING` would
      make the retry a no-op and the delivery would sit half-done for ever —
      the failure mode a status machine with a claim step has to be written
      against.
    */
    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: NotificationDeliveryStatus.PENDING,
        detail: (result.error ?? "Unbekannter Fehler").slice(0, 500),
      },
    });
    throw new Error(result.error ?? "Versand fehlgeschlagen.");
  }

  /**
   * Marks a delivery finally failed.
   *
   * Called by the job runner's own dead-letter path through
   * `notifications.listener.ts`, because `core/jobs` owns "out of attempts"
   * and this owns what that means for a delivery.
   */
  async markFailed(deliveryId: string, reason: string): Promise<void> {
    await this.prisma.notificationDelivery.updateMany({
      where: { id: deliveryId, status: { not: NotificationDeliveryStatus.DELIVERED } },
      data: {
        status: NotificationDeliveryStatus.FAILED,
        detail: reason.slice(0, 500),
        settledAt: new Date(),
      },
    });
  }

  private settle(
    id: string,
    status: NotificationDeliveryStatus,
    detail: string | null,
  ): Promise<unknown> {
    return this.prisma.notificationDelivery.update({
      where: { id },
      data: { status, detail, settledAt: new Date() },
    });
  }

  /* ================================================================ */
  /* Reading — the recipient's own                                     */
  /* ================================================================ */

  async list(
    userId: string,
    query: { unreadOnly?: boolean; type?: string; severity?: NotificationSeverity; page?: number; perPage?: number },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.min(100, Math.max(1, query.perPage ?? 20));

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      /*
        Only what was actually shown in-app.

        A notification whose in-app copy was `SKIPPED` — because the person
        turned that channel off and left e-mail on — still has a row, because
        the delivery record is the audit of what was decided. Listing it would
        put it in the inbox of somebody who asked for it not to be there.
      */
      deliveries: {
        some: {
          channel: NotificationChannel.IN_APP,
          status: NotificationDeliveryStatus.DELIVERED,
        },
      },
    };

    /*
      The unread count comes back with the page, so the bell and the list
      cannot disagree after a "mark all read" — one request, one answer.

      It is a third statement rather than a third element of the
      `$transaction` array: `unreadWhere` returns a plain promise and Prisma's
      array form takes only its own, so mixing them is a type error rather
      than a subtle one. Two round trips instead of one, both indexed counts.
    */
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.notification.count({ where }),
    ]);
    const unread = await this.unreadWhere(userId);

    return {
      items: items.map(toView),
      total,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
      unread,
    };
  }

  /** The bell's number, and the cheapest query in the module. */
  unreadCount(userId: string): Promise<number> {
    return this.unreadWhere(userId);
  }

  private unreadWhere(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        userId,
        readAt: null,
        deliveries: {
          some: {
            channel: NotificationChannel.IN_APP,
            status: NotificationDeliveryStatus.DELIVERED,
          },
        },
      },
    });
  }

  /**
   * Marks one read.
   *
   * `updateMany` with `userId` in the `where` rather than `update` by id: the
   * scope *is* the authorisation here, and a `findUnique` followed by an
   * ownership check would be two statements where one will do. A count of
   * zero is an id that is not this person's, and the caller is told 404 —
   * whether somebody else's notification exists is not information they are
   * owed.
   */
  async markRead(userId: string, id: string, read: boolean): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: read ? new Date() : null },
    });
    if (count !== 1) throw new BadRequestException("Benachrichtigung nicht gefunden.");
  }

  async markAllRead(userId: string): Promise<{ marked: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: count };
  }

  /* ================================================================ */
  /* Preferences — the person's own                                    */
  /* ================================================================ */

  /**
   * The catalogue, with this person's effective answer for each entry.
   *
   * The screen renders from the **catalogue**, not from the rows, so a type
   * added in a release appears immediately with its default rather than
   * needing a backfill — and a person who has never opened the screen has no
   * rows at all.
   */
  async preferences(userId: string) {
    const [stored, rules] = await Promise.all([
      this.prisma.notificationPreference.findMany({ where: { userId } }),
      this.allRules(),
    ]);
    const byType = new Map(stored.map((p) => [p.type, p]));

    return NOTIFICATION_TYPES.map((def) => {
      const resolved = resolveChannels(def, rules.get(def.key) ?? null, byType.get(def.key) ?? null);
      const rule = rules.get(def.key);
      return {
        type: def.key,
        category: def.category,
        label: def.label,
        description: def.description,
        severity: def.severity,
        mandatory: def.mandatory,
        inApp: resolved.inApp,
        email: resolved.email,
        /** What the person may still change, after the firm has had its say. */
        lockedInApp: isLocked(def, "inApp") || !(rule?.inApp ?? def.defaults.inApp),
        lockedEmail: !(rule?.email ?? def.defaults.email),
        /** Off for everybody, by the firm's decision — so the row says why. */
        disabledByOrganisation: Boolean(rule && !rule.enabled && !def.mandatory),
      };
    });
  }

  async updatePreferences(
    userId: string,
    updates: { type: string; inApp: boolean; email: boolean }[],
  ): Promise<void> {
    for (const update of updates) {
      const def = notificationDef(update.type);
      if (!def) throw new BadRequestException(`Unbekannte Benachrichtigungsart: ${update.type}`);
      /*
        Refused rather than silently corrected.

        `resolveChannels` would force the in-app copy back on anyway — the
        invariant is applied on read — so accepting this would store a
        preference that does nothing, and the screen would show the switch
        back on after a reload with no explanation. Saying no is the honest
        half of a control that cannot be turned off.
      */
      if (isLocked(def, "inApp") && !update.inApp) {
        throw new BadRequestException(
          `„${def.label}“ ist eine Sicherheitsmeldung und kann im Dashboard nicht abgeschaltet werden.`,
        );
      }
    }

    await this.prisma.$transaction(
      updates.map((update) =>
        this.prisma.notificationPreference.upsert({
          where: { userId_type: { userId, type: update.type } },
          create: { userId, type: update.type, inApp: update.inApp, email: update.email },
          update: { inApp: update.inApp, email: update.email },
        }),
      ),
    );
  }

  /* ================================================================ */
  /* Rules — the firm's                                                */
  /* ================================================================ */

  async rules() {
    const rules = await this.allRules();
    return NOTIFICATION_TYPES.map((def) => {
      const rule = rules.get(def.key);
      return {
        type: def.key,
        category: def.category,
        label: def.label,
        description: def.description,
        severity: def.severity,
        mandatory: def.mandatory,
        recipients: describeRecipients(def),
        enabled: def.mandatory ? true : (rule?.enabled ?? true),
        inApp: def.mandatory ? true : (rule?.inApp ?? def.defaults.inApp),
        email: rule?.email ?? def.defaults.email,
        /** Whether anything has been configured, or this is the default. */
        configured: Boolean(rule),
      };
    });
  }

  /**
   * Writes the firm's configuration.
   *
   * Returns which types actually changed, so the caller can raise one event
   * naming them rather than one per row — an administrator ticking six boxes
   * and saving is one decision, and six audit rows would make the log harder
   * to read than the screen it describes.
   */
  async updateRules(
    updates: { type: string; enabled: boolean; inApp: boolean; email: boolean }[],
  ): Promise<string[]> {
    for (const update of updates) {
      const def = notificationDef(update.type);
      if (!def) throw new BadRequestException(`Unbekannte Benachrichtigungsart: ${update.type}`);
      if (def.mandatory && (!update.enabled || !update.inApp)) {
        throw new BadRequestException(
          `„${def.label}“ ist eine Sicherheitsmeldung und kann nicht abgeschaltet werden. ` +
            "Der E-Mail-Versand lässt sich einzeln steuern.",
        );
      }
    }

    const before = await this.allRules();
    const changed: string[] = [];

    await this.prisma.$transaction(
      updates
        .filter((update) => {
          const def = notificationDef(update.type)!;
          const current = before.get(update.type) ?? {
            enabled: true,
            inApp: def.defaults.inApp,
            email: def.defaults.email,
          };
          const differs =
            current.enabled !== update.enabled ||
            current.inApp !== update.inApp ||
            current.email !== update.email;
          if (differs) changed.push(update.type);
          return differs;
        })
        .map((update) =>
          this.prisma.notificationRule.upsert({
            where: { type: update.type },
            create: {
              type: update.type,
              enabled: update.enabled,
              inApp: update.inApp,
              email: update.email,
            },
            update: { enabled: update.enabled, inApp: update.inApp, email: update.email },
          }),
        ),
    );

    /*
      One event for the whole save, and only when something moved.

      `AuditListener` turns it into the row, so this service writes no audit
      code — the F8 arrangement. Publishing on an unchanged save would put
      `notification_settings.updated` in the log every time somebody opened
      the screen and pressed save out of habit, which is how an audit log
      stops being evidence of anything.
    */
    if (changed.length) {
      this.events.publish("NotificationSettingsUpdated", {
        entity: "notification_rule",
        entityId: changed.length === 1 ? changed[0] : "*",
        payload: { types: changed },
        message: `${changed.length} Benachrichtigungsart(en) geändert: ${changed.join(", ")}`,
      });
    }

    return changed;
  }

  /* ================================================================ */
  /* Deliveries — the operator's view                                  */
  /* ================================================================ */

  /**
   * What the channels actually did, for somebody diagnosing a silence.
   *
   * The smallest thing that makes `NotificationDelivery` useful rather than
   * merely present: a status filter, the type, the recipient and the reason.
   * It is what a future System Control Centre reads, and it is why
   * `notification.readDeliveries` is a permission with a route rather than a
   * name in `KNOWN_UNENFORCED`.
   *
   * No body and no title: an operator diagnosing SMTP does not need to read
   * everybody's messages, and a delivery log that doubles as a way to read
   * other people's notifications is a different feature with a different
   * permission.
   */
  async deliveries(query: { status?: NotificationDeliveryStatus; page?: number; perPage?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.min(100, Math.max(1, query.perPage ?? 50));
    const where: Prisma.NotificationDeliveryWhereInput = query.status
      ? { status: query.status }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notificationDelivery.findMany({
        where,
        orderBy: { queuedAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          channel: true,
          status: true,
          attempts: true,
          detail: true,
          queuedAt: true,
          settledAt: true,
          notification: {
            select: { type: true, severity: true, user: { select: { email: true } } },
          },
        },
      }),
      this.prisma.notificationDelivery.count({ where }),
    ]);

    return {
      items: items.map((d) => ({
        id: d.id,
        channel: d.channel,
        status: d.status,
        attempts: d.attempts,
        detail: d.detail,
        queuedAt: d.queuedAt.toISOString(),
        settledAt: d.settledAt?.toISOString() ?? null,
        type: d.notification.type,
        severity: d.notification.severity,
        recipient: d.notification.user.email,
      })),
      total,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /* ================================================================ */
  /* Helpers                                                           */
  /* ================================================================ */

  private async allRules() {
    const rows = await this.prisma.notificationRule.findMany();
    return new Map(rows.map((r) => [r.type, { enabled: r.enabled, inApp: r.inApp, email: r.email }]));
  }

  private async ruleFor(type: string) {
    const row = await this.prisma.notificationRule.findUnique({ where: { type } });
    return row ? { enabled: row.enabled, inApp: row.inApp, email: row.email } : null;
  }

  private async preferencesFor(type: string, userIds: string[]) {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { type, userId: { in: userIds } },
    });
    return new Map(rows.map((r) => [r.userId, { inApp: r.inApp, email: r.email }]));
  }

  private get adminUrl(): string {
    return this.config.get<string>("ADMIN_URL") ?? "http://localhost:5173/admin.html";
  }

  private async organisationName(): Promise<string> {
    try {
      return (await this.organisation.identity()).name;
    } catch {
      return "IEM AG";
    }
  }
}

/* ------------------------------------------------------------------ */

function toView(row: {
  id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  link: string | null;
  actorName: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationView {
  return {
    id: row.id,
    type: row.type,
    category: notificationDef(row.type)?.category ?? "System",
    severity: row.severity,
    title: row.title,
    body: row.body,
    link: row.link,
    actorName: row.actorName,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** One sentence naming who a type goes to, for the administrator's screen. */
function describeRecipients(def: NotificationDef): string {
  switch (def.recipients.kind) {
    case "subject":
      return "Die betroffene Person";
    case "explicit":
      return "Die beteiligte Person";
    case "permission":
      return `Alle mit der Berechtigung „${def.recipients.permission}“`;
  }
}

/**
 * A duplicate on the idempotency index, told apart from every other failure.
 *
 * `P2002` by code rather than by message, because the message is localised by
 * the driver and a substring match on it is a test that passes until somebody
 * changes their locale.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}
