import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { MetricsService } from "../core/metrics/metrics.service";
import type { ModuleMetricsSource, RecordCounts } from "../core/metrics/metrics.types";

/**
 * What Unternehmen reports about itself.
 *
 * The firm's rule since F14: no module ships without metrics. This one is
 * unusual in that its record count is almost constant — two offices and one
 * organisation row — and that is exactly why it is worth reporting. The number
 * an operator wants from this module is not throughput; it is **how many
 * offices are archived**, because an archived office that should not be is how
 * a Standort disappears from the website with nobody noticing until a client
 * asks why the Bern number is gone.
 */
@Injectable()
export class OrganisationMetrics implements OnModuleInit, ModuleMetricsSource {
  readonly key = "organisation";
  readonly label = "Unternehmen";
  /**
   * `/organisation`, not `/offices`.
   *
   * `MetricsInterceptor` matches one prefix per module, and the two route
   * groups are one module. Splitting them into two sources would report the
   * same feature twice and make the latency figures per-controller rather than
   * per-module, which is the comparison `/metrics/modules` exists to allow.
   * The offices routes are therefore counted under the module's records and
   * events rather than under its latency — stated here because a reader
   * looking for `/offices` in the report should know where it went.
   */
  readonly routePrefix = "/organisation";

  readonly events = [
    "OrganisationUpdated",
    "OfficeCreated",
    "OfficeUpdated",
    "OfficeArchived",
    "OfficeRestored",
    "OfficeDeleted",
    "MailTested",
  ] as const;

  readonly jobs = [] as const;

  readonly auditResources = ["organisation", "office", "setting"] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.metrics.register(this);
  }

  /**
   * Offices, plus the organisation row itself.
   *
   * The singleton counts as a record: `total` reading `2` when the firm has
   * two offices but no organisation row yet would hide the one state worth
   * seeing on a fresh install. It is upserted on first read, so in practice
   * this is always 1 — and "always 1" is the correct answer to give rather
   * than a number to omit.
   */
  async records(): Promise<RecordCounts> {
    const [organisations, total, active, archived, deleted] = await this.prisma.$transaction([
      this.prisma.organisation.count(),
      this.prisma.office.count(),
      this.prisma.office.count({ where: { deletedAt: null, archivedAt: null } }),
      this.prisma.office.count({ where: { deletedAt: null, archivedAt: { not: null } } }),
      this.prisma.office.count({ where: { deletedAt: { not: null } } }),
    ]);
    return { total: total + organisations, active: active + organisations, archived, deleted };
  }
}
