import { Injectable } from "@nestjs/common";
import { NotificationChannel, NotificationDeliveryStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { SecretSettingsService } from "../core/settings/settings.secrets";
import { MailService } from "./mail.service";
import type { MailFailureCategory } from "./mail.failure";

/**
 * What an operator is told about the mail channel, and **nothing that was not
 * measured**.
 *
 * ---
 *
 * ## No new tables
 *
 * Every figure here is read from something that already records it:
 *
 * | | |
 * | --- | --- |
 * | Configuration | The settings, through `MailService.describe()` |
 * | Last connection test, last test send | `AuditLog`, where `MailTested` already lands |
 * | Deliveries, failures, queue depth | `NotificationDelivery`, which P2-3 built |
 *
 * A `MailHealth` table was the obvious alternative and it is the wrong one: a
 * status table is a **second** record of facts the system already holds, and
 * the day the writer misses one it reports a stale success indefinitely. The
 * brief's instruction is "never create fake status data", and the strongest
 * form of that is to derive every number from the row that caused it.
 *
 * ## The five states, and why `unknown` is one of them
 *
 * `not_configured` → `unknown` → `healthy` / `warning` / `critical`.
 *
 * **`unknown` is the state of a correctly configured server nobody has tested
 * yet**, and it is the one most systems get wrong by reporting `healthy`.
 * Configuration is a claim; a successful connection is evidence. A panel that
 * shows green because a form has been filled in teaches an operator that green
 * means nothing, which costs exactly the incident where it mattered.
 */
@Injectable()
export class MailStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly secrets: SecretSettingsService,
  ) {}

  async status(): Promise<MailStatus> {
    const provider = await this.mail.describe();
    const [lastVerify, lastTestSend, deliveries] = await Promise.all([
      this.lastProbe("verify"),
      this.lastProbe("send"),
      this.deliverySummary(),
    ]);

    const configured = provider.host.trim() !== "";

    /*
      A credential that exists and cannot be read is the case this flag is for.

      Without it the panel would say "configured" — which is true of the row —
      while every send fails, and the cause is a missing environment variable
      two layers away. `SecretSettingsService.warnIfUnreadable` says the same
      thing in the boot log; this is the half an operator sees.
    */
    const secretsReadable = this.secrets.available;

    return {
      provider: {
        kind: provider.kind,
        host: provider.host,
        port: provider.port,
        secure: provider.secure,
        hasCredentials: provider.hasCredentials,
        from: provider.from,
        fromName: provider.fromName,
        replyTo: provider.replyTo,
      },
      configured,
      secretsReadable,
      state: this.overall({ configured, secretsReadable, lastVerify, deliveries }),
      lastVerify,
      lastTestSend,
      deliveries,
    };
  }

  /**
   * The most recent connection test or test send, from the audit log.
   *
   * `MailTested` carries `mode` in its payload precisely so these two can be
   * told apart here — they are different operations with different meanings,
   * and a single "last tested" that conflated them would let a green
   * connection check hide the fact that no message has ever actually gone out.
   */
  private async lastProbe(mode: "verify" | "send"): Promise<MailProbe | null> {
    const rows = await this.prisma.auditLog.findMany({
      where: { action: "mail.tested", resource: "setting" },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { after: true, createdAt: true, actorEmail: true, message: true },
    });

    for (const row of rows) {
      const payload = (row.after ?? {}) as Record<string, unknown>;
      if (payload.mode !== mode) continue;
      return {
        at: row.createdAt.toISOString(),
        /*
          Read from the payload rather than from `AuditLog.outcome`.

          `EventEnvelope` carries no outcome — `AuditListener` writes `SUCCESS`
          for every event it turns into a row, because an event *is* a thing
          that happened. Whether the mail server answered is a property of the
          fact, not of the recording of it, so it lives in `ok`.
        */
        ok: payload.ok === true,
        by: row.actorEmail,
        /*
          The audit message, which this application wrote from the sanitized
          classification — never the provider's own text. `classifyMailError`
          is what guarantees that, and `mail.failure.test.ts` asserts it.
        */
        detail: row.message,
        category:
          typeof payload.category === "string" ? (payload.category as MailFailureCategory) : null,
        durationMs: typeof payload.durationMs === "number" ? payload.durationMs : null,
      };
    }
    return null;
  }

  /**
   * What the e-mail channel has actually done.
   *
   * Scoped to `channel: EMAIL` throughout: an in-app notification is written
   * `DELIVERED` because the row *is* the delivery, so counting both channels
   * together would produce a success rate that is mostly a measure of how many
   * notifications exist.
   */
  private async deliverySummary(): Promise<MailDeliverySummary> {
    const where = { channel: NotificationChannel.EMAIL };

    const [byStatus, lastDelivered, lastFailed] = await Promise.all([
      this.prisma.notificationDelivery.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
      this.prisma.notificationDelivery.findFirst({
        where: { ...where, status: NotificationDeliveryStatus.DELIVERED },
        orderBy: { settledAt: "desc" },
        select: { settledAt: true },
      }),
      this.prisma.notificationDelivery.findFirst({
        where: { ...where, status: NotificationDeliveryStatus.FAILED },
        orderBy: { settledAt: "desc" },
        select: { settledAt: true, detail: true, attempts: true },
      }),
    ]);

    const count = (status: NotificationDeliveryStatus) =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;

    return {
      delivered: count(NotificationDeliveryStatus.DELIVERED),
      failed: count(NotificationDeliveryStatus.FAILED),
      pending: count(NotificationDeliveryStatus.PENDING),
      processing: count(NotificationDeliveryStatus.PROCESSING),
      skipped: count(NotificationDeliveryStatus.SKIPPED),
      lastDeliveredAt: lastDelivered?.settledAt?.toISOString() ?? null,
      lastFailedAt: lastFailed?.settledAt?.toISOString() ?? null,
      // Already sanitized when it was written — `sendNotification` returns the
      // classified message, not the provider's.
      lastFailureDetail: lastFailed?.detail ?? null,
    };
  }

  /**
   * One word for the whole channel.
   *
   * The order of the tests is the order of severity, and each one is a
   * different thing an operator does next — which is the only justification a
   * status word ever has.
   */
  private overall(input: {
    configured: boolean;
    secretsReadable: boolean;
    lastVerify: MailProbe | null;
    deliveries: MailDeliverySummary;
  }): MailState {
    if (!input.configured) return "not_configured";

    // A stored credential nobody can decrypt is worse than none: the panel
    // would otherwise read as configured while every send fails.
    if (!input.secretsReadable) return "critical";

    if (input.lastVerify && !input.lastVerify.ok) return "critical";
    if (input.deliveries.failed > 0 && input.deliveries.delivered === 0) return "critical";

    // Configured, never proven. See the note at the head of the class.
    if (!input.lastVerify) return "unknown";

    if (input.deliveries.failed > 0) return "warning";
    return "healthy";
  }
}

export type MailState = "healthy" | "warning" | "critical" | "not_configured" | "unknown";

export type MailProbe = {
  at: string;
  ok: boolean;
  by: string | null;
  detail: string | null;
  category: MailFailureCategory | null;
  durationMs: number | null;
};

export type MailDeliverySummary = {
  delivered: number;
  failed: number;
  pending: number;
  processing: number;
  skipped: number;
  lastDeliveredAt: string | null;
  lastFailedAt: string | null;
  lastFailureDetail: string | null;
};

export type MailStatus = {
  provider: {
    kind: string;
    host: string;
    port: number;
    secure: boolean;
    hasCredentials: boolean;
    from: string;
    fromName: string;
    replyTo: string | null;
  };
  configured: boolean;
  secretsReadable: boolean;
  state: MailState;
  lastVerify: MailProbe | null;
  lastTestSend: MailProbe | null;
  deliveries: MailDeliverySummary;
};
