import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { MetricsService } from "../core/metrics/metrics.service";
import type { ModuleMetricsSource, RecordCounts } from "../core/metrics/metrics.types";

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
   * Four figures, in one transaction so they agree with each other.
   *
   * **`archived` is the one that earns its place here.** A firm's project table
   * is mostly archive after a decade, and a single live count would say the
   * module had shrunk when what happened is that work finished. `Project` has a
   * real `archivedAt`, stamped by the transition rather than typed, so the
   * split is a fact rather than a guess at what `COMPLETED` means.
   *
   * Separate counts rather than a `groupBy`, because the three predicates
   * overlap in the way that matters: an archived project that is later deleted
   * keeps its `archivedAt`, so `deleted` has to exclude it from `archived` and
   * a `groupBy` on one column cannot.
   */
  async records(): Promise<RecordCounts> {
    const [total, active, archived, deleted] = await this.prisma.$transaction([
      this.prisma.project.count(),
      this.prisma.project.count({ where: { deletedAt: null, archivedAt: null } }),
      this.prisma.project.count({ where: { deletedAt: null, archivedAt: { not: null } } }),
      this.prisma.project.count({ where: { deletedAt: { not: null } } }),
    ]);
    return { total, active, archived, deleted };
  }
}
