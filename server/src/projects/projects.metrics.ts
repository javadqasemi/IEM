import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { MetricsService } from "../core/metrics/metrics.service";
import type { ModuleMetricsSource } from "../core/metrics/metrics.types";

/**
 * What Projekte reports about itself to operations.
 *
 * **The file every module after this one copies**, and it is deliberately the
 * smallest thing that can satisfy the firm's rule that no module ships without
 * metrics: a name, a count, a route prefix, and the events, jobs and audit
 * resources it owns. Everything else — latency, error rate, job durations, the
 * percentiles — is measured centrally and needs no cooperation, which is the
 * only way twenty-six modules produce comparable figures.
 *
 * It registers itself in `onModuleInit`. `core` imports no feature, so the
 * arrow points the way `architecture.test.ts` requires; a registry in `core`
 * listing twenty-six modules would be the root-module problem F12 removed,
 * wearing a different hat.
 */
@Injectable()
export class ProjectsMetrics implements OnModuleInit, ModuleMetricsSource {
  readonly key = "project";
  readonly label = "Projekte";
  readonly routePrefix = "/projects";

  /**
   * Only the events this module *raises*.
   *
   * Not the ones it reacts to — there are none yet, and when there are, they
   * belong to whoever raised them. A module counting somebody else's events
   * would double every figure in the report.
   */
  readonly events = [
    "ProjectCreated",
    "ProjectUpdated",
    "ProjectStatusChanged",
    "ProjectArchived",
    "ProjectDeleted",
    "ProjectMemberAdded",
    "ProjectMemberRemoved",
    "ProjectDisciplineScoped",
    "MilestoneReached",
    "MilestoneMissed",
  ] as const;

  readonly jobs = ["projects.reconcileDerived"] as const;

  /**
   * Four resources, because four tables answer to this module.
   *
   * An operator asking "how much is happening in Projekte" means team changes
   * and milestone sign-offs as well as edits to the project row. Listing only
   * `project` would report a module that looks quiet while its sub-resources
   * are busy.
   */
  readonly auditResources = ["project", "project_member", "project_discipline", "milestone"] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.metrics.register(this);
  }

  /**
   * Live rows and soft-deleted ones, separately.
   *
   * The pair rather than a single total: everything here is soft-deleted, so a
   * table that grows while the live count does not is a retention question, and
   * one number cannot ask it.
   */
  async records(): Promise<{ total: number; deleted: number }> {
    const [total, deleted] = await this.prisma.$transaction([
      this.prisma.project.count({ where: { deletedAt: null } }),
      this.prisma.project.count({ where: { deletedAt: { not: null } } }),
    ]);
    return { total, deleted };
  }
}
