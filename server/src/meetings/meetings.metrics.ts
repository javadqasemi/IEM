import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { MetricsService } from "../core/metrics/metrics.service";
import type { ModuleMetricsSource, RecordCounts } from "../core/metrics/metrics.types";

/**
 * What Sitzungen reports about itself to operations.
 *
 * **Two aggregates, one metrics source**, because they are one module — a
 * second source keyed `decision` would split figures that are read together
 * ("how much is happening in Sitzungen" means the protocols *and* the
 * decisions) and would need a second route prefix that does not exist as a
 * module.
 *
 * `records` counts **meetings**, which is the module's primary aggregate. The
 * decision count is not lost: `/decisions/stats` reports it by status, and that
 * is the screen an operator would actually open to ask about decisions.
 */
@Injectable()
export class MeetingsMetrics implements OnModuleInit, ModuleMetricsSource {
  readonly key = "meeting";
  readonly label = "Sitzungen";
  readonly routePrefix = "/meetings";

  /** Only the events this module raises — the twelve in the catalogue. */
  readonly events = [
    "MeetingScheduled",
    "MeetingUpdated",
    "MeetingHeld",
    "MeetingCancelled",
    "MeetingDeleted",
    "MeetingApproved",
    "MinutesSent",
    "MeetingItemToTask",
    "DecisionTaken",
    "DecisionUpdated",
    "DecisionStatusChanged",
    "DecisionSuperseded",
  ] as const;

  /**
   * Three resources, and `meeting_item` is the one worth explaining.
   *
   * A protocol line becoming a task is audited under its own entity rather than
   * the meeting's, because "wann wurde aus dieser Zeile eine Aufgabe" is a
   * question about the line. Attendees, agenda items and approvals raise no
   * events and write no audit rows — they are edits to a record whose own
   * `MeetingUpdated` already covers the fact that it changed.
   */
  readonly auditResources = ["meeting", "meeting_item", "decision"] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.metrics.register(this);
  }

  /**
   * `archived: null` — a meeting has no archive.
   *
   * `CANCELLED` is a meeting that did not happen, not one that is filed away,
   * and `rbac/resources.ts` gives `meeting` no `archive` action. Reporting 0
   * would invite an operator to ask why nothing is ever archived.
   */
  async records(): Promise<RecordCounts> {
    const [total, active, deleted] = await this.prisma.$transaction([
      this.prisma.meeting.count(),
      this.prisma.meeting.count({ where: { deletedAt: null } }),
      this.prisma.meeting.count({ where: { deletedAt: { not: null } } }),
    ]);
    return { total, active, archived: null, deleted };
  }
}
