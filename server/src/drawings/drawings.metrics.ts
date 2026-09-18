import { Injectable, OnModuleInit } from "@nestjs/common";
import { DrawingStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { MetricsService } from "../core/metrics/metrics.service";
import type { ModuleMetricsSource, RecordCounts } from "../core/metrics/metrics.types";

/**
 * What Pläne reports about itself to operations.
 *
 * **Two aggregates, one source**, as Sitzungen has: `Drawing` and `Transmittal`
 * are one module because issuing is one transaction across both, and a second
 * source keyed `transmittal` would split figures that are read together.
 *
 * `records` counts **drawings**, the module's primary aggregate. The transmittal
 * count is not lost — `/drawings/stats` does not carry it, but `/transmittals`
 * is a paginated list whose total is the answer, and that is the screen an
 * operator opens to ask about Planversand.
 */
@Injectable()
export class DrawingsMetrics implements OnModuleInit, ModuleMetricsSource {
  readonly key = "drawing";
  readonly label = "Pläne";
  readonly routePrefix = "/drawings";

  /**
   * The eleven this module raises.
   *
   * Three of them — `DrawingReleased`, `DrawingIssued`, `DrawingWithdrawn` —
   * were declared during F7, before the module existed, and the module was
   * built to them rather than beside them. Listing them here is what makes the
   * count in `/metrics/modules` match what the bus actually sees.
   */
  readonly events = [
    "DrawingCreated",
    "DrawingUpdated",
    "DrawingStatusChanged",
    "DrawingDeleted",
    "DrawingReleased",
    "DrawingIssued",
    "DrawingWithdrawn",
    "RevisionCreated",
    "TransmittalSent",
    "PriorRevisionSuperseded",
    "TransmittalAcknowledged",
  ] as const;

  /**
   * Two resources.
   *
   * Revisions are audited under `drawing`, because a revision is a fact *about*
   * a plan and "was ist mit diesem Plan passiert" is the question somebody
   * asks — a separate `drawing_revision` resource would split one plan's story
   * across two filters. `transmittal` is its own, because a Planversand is
   * looked up by itself months later and is the row a liability question lands
   * on.
   */
  readonly auditResources = ["drawing", "transmittal"] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.metrics.register(this);
  }

  /**
   * `archived` counts **withdrawn** plans, and this is the first module where
   * that figure is not `null`.
   *
   * A withdrawn plan is precisely "kept, finished with": it is not deleted —
   * people are holding printed copies and the record of what they were given
   * has to survive — and it is not live. That is what the `archived` slot was
   * added for at the review, and reporting `null` here would waste it.
   *
   * `active` therefore excludes withdrawn plans as well as deleted ones, so the
   * three figures do not double-count. A register whose "aktiv" included
   * withdrawn sheets would be a number an operator cannot act on.
   */
  async records(): Promise<RecordCounts> {
    const [total, active, archived, deleted] = await this.prisma.$transaction([
      this.prisma.drawing.count(),
      this.prisma.drawing.count({
        where: { deletedAt: null, status: { not: DrawingStatus.WITHDRAWN } },
      }),
      this.prisma.drawing.count({
        where: { deletedAt: null, status: DrawingStatus.WITHDRAWN },
      }),
      this.prisma.drawing.count({ where: { deletedAt: { not: null } } }),
    ]);
    return { total, active, archived, deleted };
  }
}
