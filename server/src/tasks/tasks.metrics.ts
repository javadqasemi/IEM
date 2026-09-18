import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { MetricsService } from "../core/metrics/metrics.service";
import type { ModuleMetricsSource, RecordCounts } from "../core/metrics/metrics.types";

/**
 * What Aufgaben reports about itself to operations.
 *
 * The firm's condition for Wave 2, met by the first module of it: records, API
 * latency, event counts, audit entries, job runtimes and an error rate — five of
 * which are measured centrally and need no cooperation. This file declares only
 * what the module *owns*, which is the property that keeps twenty-six of them
 * comparable.
 *
 * It registers itself in `onModuleInit`; `core` imports no feature.
 */
@Injectable()
export class TasksMetrics implements OnModuleInit, ModuleMetricsSource {
  readonly key = "task";
  readonly label = "Aufgaben";
  readonly routePrefix = "/tasks";

  /** Only the events this module raises — not the ones it reacts to. */
  readonly events = [
    "TaskCreated",
    "TaskUpdated",
    "TaskStatusChanged",
    "TaskAssigned",
    "TaskCompleted",
    "TaskBlocked",
    "TaskDeleted",
    "TaskOverdue",
    "TaskDependencyAdded",
    "TaskCommented",
  ] as const;

  readonly jobs = ["tasks.flagOverdue"] as const;

  /**
   * `task` and `comment`, and **not** `checklist_item` or `task_dependency`.
   *
   * The two that are missing raise no events, so they write no audit rows —
   * ticking a checklist point is a field write on a child row, and recording
   * every one of them would bury the log under the cheapest interaction in the
   * module. Listing a resource nothing writes would report a constant 0 and read
   * as a feature nobody uses.
   */
  readonly auditResources = ["task", "comment"] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.metrics.register(this);
  }

  /**
   * `archived: null`, and that is the module saying it has no archive rather
   * than reporting an empty one.
   *
   * A task has nothing hanging off it that a soft delete would orphan, so
   * `CANCELLED` is the whole of "this will not happen" and there is no second
   * mechanism — `rbac/resources.ts` gives `task` no `archive` action for the
   * same reason. Reporting `0` here would invite an operator to ask why nothing
   * is ever archived, which is a question about a feature that does not exist.
   *
   * `active` is therefore "not deleted", and a cancelled task is counted in it:
   * it is a live row with a terminal status, and the status breakdown under
   * `/tasks/stats` is where that distinction belongs.
   */
  async records(): Promise<RecordCounts> {
    const [total, active, deleted] = await this.prisma.$transaction([
      this.prisma.task.count(),
      this.prisma.task.count({ where: { deletedAt: null } }),
      this.prisma.task.count({ where: { deletedAt: { not: null } } }),
    ]);
    return { total, active, archived: null, deleted };
  }
}
