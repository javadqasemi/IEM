import { Injectable, OnModuleInit } from "@nestjs/common";
import { NotificationDeliveryStatus } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { MetricsService } from "../metrics/metrics.service";
import type { ModuleMetricsSource, RecordCounts } from "../metrics/metrics.types";

/**
 * What the notification platform reports about itself.
 *
 * The firm's rule from the Wave 2 review — *no module ships without metrics* —
 * applied to a module `architecture.test.ts` would not have asked it of:
 * `core/` is infrastructure and the `WITHOUT_METRICS` gate only walks feature
 * folders. It is declared anyway, because the rule is about modules rather
 * than about which test happens to check, and because this is the one place
 * in the system where **a silence is the symptom**. Nothing else here fails by
 * doing nothing.
 *
 * `read` rather than `archived` in the record counts, which is the module
 * saying what its lifecycle actually is: a notification is never archived and
 * never deleted by anybody, it is read or it is not. Reporting a constant `0`
 * under `archived` would invite an operator to ask why nothing is ever
 * archived — a question about a feature that does not exist, which is the
 * mistake `TasksMetrics` documents from the other side.
 */
@Injectable()
export class NotificationsMetrics implements OnModuleInit, ModuleMetricsSource {
  readonly key = "notification";
  readonly label = "Benachrichtigungen";
  readonly routePrefix = "/notifications";

  /** Only what this module raises — not the nine events it reacts to. */
  readonly events = ["NotificationSettingsUpdated"] as const;

  readonly jobs = ["notification.deliver"] as const;

  readonly auditResources = ["notification_rule"] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.metrics.register(this);
  }

  async records(): Promise<RecordCounts> {
    const [total, unread] = await this.prisma.$transaction([
      this.prisma.notification.count(),
      this.prisma.notification.count({ where: { readAt: null } }),
    ]);
    return { total, active: unread, archived: null, deleted: 0 };
  }

  /**
   * The number an operator actually watches.
   *
   * Not part of `ModuleMetricsSource` — it is this module's own, exposed
   * through the delivery list rather than the metrics report, and kept here
   * so the query lives beside the counts it belongs with.
   */
  failedDeliveries(): Promise<number> {
    return this.prisma.notificationDelivery.count({
      where: { status: NotificationDeliveryStatus.FAILED },
    });
  }
}
