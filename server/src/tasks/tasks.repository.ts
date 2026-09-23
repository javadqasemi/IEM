import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import {
  buildOrderBy,
  buildWhere,
  parseListQuery,
  skipTake,
  type ListParams,
} from "../core/list/list";
import type { RawListQuery } from "../core/list/list.decorator";
import { whereOf } from "../core/scope/scope";
import type { ProjectScope } from "../core/scope/project.scope";
import { CHECKLIST_LIST, TASK_LIST } from "./tasks.list";
import { TASK_DETAIL_SELECT, TASK_LIST_SELECT } from "./tasks.mapper";
import type { TaskScope } from "./tasks.scope";

/** A transaction client, or the plain one. Same seam as `projects.repository.ts`. */
export type PrismaTx = Prisma.TransactionClient | PrismaService;

/**
 * Every Prisma statement this module makes, and nothing else.
 *
 * The three things the repository owns so the service does not — stated once in
 * `projects.repository.ts` and true again here:
 *
 * - **The soft-delete predicate.** `deletedAt: null` is written in this file and
 *   a caller cannot forget it.
 * - **The scope predicate.** It arrives as a required `TaskScope` and is merged
 *   into the base. There is no default any more: `{}` used to be it, and `{}` is
 *   every row (SEC-R6) — a caller who wants all tasks writes
 *   `unrestricted(because)`.
 * - **The selects**, which are the mapper's, so the shape fetched and the shape
 *   read cannot drift.
 */
@Injectable()
export class TasksRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ---- Reads ------------------------------------------------------- */

  parseList(query: RawListQuery): ListParams {
    return parseListQuery(query, TASK_LIST);
  }

  /**
   * One page and its total.
   *
   * **The scope is required and has no default** (P0, SEC-4). It used to
   * default to `{}` — every row — and this comment said that made the omission
   * "visible rather than impossible". It is impossible now: a method that
   * forgets the argument does not compile, and "every task" is spelled
   * `unrestricted(because)` at the call site. `tasks.scope.test.ts` asserts
   * the fragment itself.
   */
  async list(params: ListParams, scope: TaskScope) {
    const where = buildWhere(params, TASK_LIST, {
      deletedAt: null,
      ...whereOf(scope),
    }) as Prisma.TaskWhereInput;

    // One transaction for the page and the count: two statements can straddle a
    // write and produce a total of 41 above a page of 40, which reads as a
    // broken paginator rather than as a race.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        orderBy: buildOrderBy(params, TASK_LIST),
        ...skipTake(params),
        select: TASK_LIST_SELECT,
      }),
      this.prisma.task.count({ where }),
    ]);

    return { items, total };
  }

  /** Every row a filtered export covers. The `take` is a ceiling, not a page. */
  async listAll(params: ListParams, scope: TaskScope) {
    const where = buildWhere(params, TASK_LIST, {
      deletedAt: null,
      ...whereOf(scope),
    }) as Prisma.TaskWhereInput;

    return this.prisma.task.findMany({
      where,
      orderBy: buildOrderBy(params, TASK_LIST),
      take: 10_000,
      select: TASK_LIST_SELECT,
    });
  }

  findDetail(id: string, scope: TaskScope, tx: PrismaTx = this.prisma) {
    return tx.task.findFirst({
      where: { id, deletedAt: null, ...whereOf(scope) },
      select: TASK_DETAIL_SELECT,
    });
  }

  /**
   * The state the rules need, and only that.
   *
   * `refuseTransition` needs the subtask statuses and the blocking dependencies;
   * the detail select fetches four joins, both dependency directions and the
   * whole checklist. A rule check that costs the same as rendering the screen is
   * a rule check somebody eventually skips — the argument `findForRules` in
   * `projects.repository.ts` makes, and it applies harder here because a status
   * change is the commonest write in the module by an order of magnitude.
   */
  findForRules(id: string, tx: PrismaTx = this.prisma) {
    return tx.task.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        blockedFrom: true,
        position: true,
        version: true,
        dueDate: true,
        startDate: true,
        projectId: true,
        parentTaskId: true,
        assigneeId: true,
        createdById: true,
        subtasks: { where: { deletedAt: null }, select: { status: true } },
        dependsOn: {
          select: {
            type: true,
            predecessor: { select: { status: true, title: true } },
          },
        },
        checklist: { select: { done: true } },
      },
    });
  }

  /** The current version and who last touched it — for the conflict message. */
  versionOf(id: string, tx: PrismaTx = this.prisma) {
    return tx.task.findUnique({
      where: { id },
      select: { version: true, title: true, updatedById: true },
    });
  }

  async nameOfUser(id: string): Promise<string | null> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: { name: true } });
    return row?.name ?? null;
  }

  countByStatus(scope: TaskScope) {
    return this.prisma.task.groupBy({
      by: ["status"],
      where: { deletedAt: null, ...whereOf(scope) },
      _count: { _all: true },
    });
  }

  /**
   * How many of the caller's open tasks are past their date.
   *
   * A `count` with the predicate written out rather than a filter over a fetched
   * page — the same reason the scope is a `where` fragment. A badge that counted
   * the current page would say "3" on a backlog of forty.
   */
  countOverdue(scope: TaskScope, now: Date = new Date()) {
    return this.prisma.task.count({
      where: {
        deletedAt: null,
        dueDate: { lt: now },
        status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED"] },
        ...whereOf(scope),
      },
    });
  }

  /* ---- Writes ------------------------------------------------------ */

  create(data: Prisma.TaskUncheckedCreateInput, tx: PrismaTx = this.prisma) {
    return tx.task.create({ data, select: TASK_DETAIL_SELECT });
  }

  update(id: string, data: Prisma.TaskUncheckedUpdateInput, tx: PrismaTx = this.prisma) {
    return tx.task.update({ where: { id }, data, select: TASK_DETAIL_SELECT });
  }

  /**
   * The optimistic-lock write: update **only if** the row is still at
   * `expectedVersion`, and say how many rows matched.
   *
   * `updateMany`, because `update` takes only a unique filter and the version
   * cannot be part of one — and because it returns a count rather than throwing,
   * which is what turns "somebody else saved first" into a value this code can
   * read. The check and the write are **one statement**: reading the version,
   * comparing it and then writing is the same race with extra steps.
   */
  async updateIfUnchanged(
    id: string,
    expectedVersion: number,
    data: Prisma.TaskUncheckedUpdateInput,
    tx: PrismaTx = this.prisma,
  ): Promise<number> {
    const { count } = await tx.task.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    return count;
  }

  /**
   * Soft delete, and the subtasks with it.
   *
   * The children go too, and that is a real decision rather than housekeeping: a
   * subtask whose parent is gone appears on no screen — the board shows top-level
   * cards and the tree is reached through the parent — so leaving it live would
   * make it invisible *and* still counted in "what is assigned to me".
   *
   * `TaskDependency` and `ChecklistItem` are **not** touched, because both
   * cascade at the database: neither outlives its task in any meaningful sense,
   * and neither is soft-deleted. A dependency pointing at a soft-deleted task is
   * the one case left, and `dependenciesFor` filters it.
   */
  softDelete(id: string, at: Date) {
    return this.prisma.$transaction([
      this.prisma.task.updateMany({
        where: { parentTaskId: id, deletedAt: null },
        data: { deletedAt: at },
      }),
      this.prisma.task.update({ where: { id }, data: { deletedAt: at } }),
    ]);
  }

  /* ---- The board --------------------------------------------------- */

  /**
   * The positions already used in one column, in order.
   *
   * `projectId: null` is a real column — the firm-level board — and Prisma
   * writes that as `null` rather than omitting the key, which is the difference
   * between "tasks with no project" and "all tasks".
   */
  async positionsIn(projectId: string | null, status: Prisma.TaskWhereInput["status"]) {
    const rows = await this.prisma.task.findMany({
      where: { projectId, status, deletedAt: null, parentTaskId: null },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });
    return rows;
  }

  /**
   * Write a whole column's positions in one transaction.
   *
   * Used when `positionBetween` returns `null` — the gap is exhausted and the
   * column has to be renumbered. One transaction with the move itself, so a
   * renumber cannot half-apply and leave two cards claiming one slot.
   */
  renumber(rows: readonly { id: string; position: number }[], tx: PrismaTx = this.prisma) {
    return Promise.all(
      rows.map((row) => tx.task.update({ where: { id: row.id }, data: { position: row.position } })),
    );
  }

  /* ---- Dependencies ------------------------------------------------ */

  /**
   * Every dependency edge that could be part of a cycle with this task.
   *
   * **The whole graph for the project, not the neighbourhood.** A cycle is a
   * global property: A→B→C→A cannot be seen from A's immediate edges, and a
   * check that only looked one hop out would pass the request that closes the
   * loop. The scope is the project because a dependency between two projects'
   * tasks is refused in the service — which is what keeps this query bounded.
   */
  async edgesForProject(projectId: string | null) {
    const rows = await this.prisma.taskDependency.findMany({
      where: {
        predecessor: { projectId, deletedAt: null },
        successor: { projectId, deletedAt: null },
      },
      select: { predecessorId: true, successorId: true },
    });
    return rows;
  }

  /** The parent of every task in a project — for `wouldCycleParent`. */
  async parentsForProject(projectId: string | null): Promise<Map<string, string | null>> {
    const rows = await this.prisma.task.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, parentTaskId: true },
    });
    return new Map(rows.map((row) => [row.id, row.parentTaskId]));
  }

  addDependency(data: Prisma.TaskDependencyUncheckedCreateInput) {
    return this.prisma.taskDependency.create({ data });
  }

  findDependency(id: string) {
    return this.prisma.taskDependency.findUnique({
      where: { id },
      select: { id: true, predecessorId: true, successorId: true, type: true },
    });
  }

  removeDependency(id: string) {
    return this.prisma.taskDependency.delete({ where: { id } });
  }

  /* ---- Checklist --------------------------------------------------- */

  parseChecklist(query: RawListQuery): ListParams {
    return parseListQuery(query, CHECKLIST_LIST);
  }

  async checklistFor(taskId: string) {
    const rows = await this.prisma.checklistItem.findMany({
      where: { taskId },
      orderBy: { position: "asc" },
    });
    return rows;
  }

  async nextChecklistPosition(taskId: string): Promise<number> {
    const last = await this.prisma.checklistItem.findFirst({
      where: { taskId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return (last?.position ?? 0) + 1;
  }

  addChecklistItem(data: Prisma.ChecklistItemUncheckedCreateInput) {
    return this.prisma.checklistItem.create({ data });
  }

  findChecklistItem(id: string) {
    return this.prisma.checklistItem.findUnique({ where: { id } });
  }

  updateChecklistItem(id: string, data: Prisma.ChecklistItemUncheckedUpdateInput) {
    return this.prisma.checklistItem.update({ where: { id }, data });
  }

  removeChecklistItem(id: string) {
    return this.prisma.checklistItem.delete({ where: { id } });
  }

  /* ---- Comments ---------------------------------------------------- */

  /**
   * The thread on one record.
   *
   * Keyed by `(entity, entityId)` rather than by `taskId`, because `Comment` is
   * shared across the domain — see the note on the model. The repository for
   * Tasks owns the *task* half of it; the day Meetings wants comments it calls
   * the same table through its own repository, and neither reaches into the
   * other's.
   */
  commentsFor(entity: string, entityId: string) {
    return this.prisma.comment.findMany({
      where: { entity, entityId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  }

  addComment(data: Prisma.CommentUncheckedCreateInput) {
    return this.prisma.comment.create({ data });
  }

  findComment(id: string) {
    return this.prisma.comment.findFirst({ where: { id, deletedAt: null } });
  }

  softDeleteComment(id: string, at: Date) {
    return this.prisma.comment.update({ where: { id }, data: { deletedAt: at } });
  }

  /* ---- The overdue sweep ------------------------------------------- */

  /**
   * Open tasks past their date that have not yet been announced.
   *
   * `overdueNotifiedAt: null` is the whole guard: without it the nightly job
   * re-announces the same task every night, and a notification that arrives
   * every night is one nobody reads. The `take` bounds a first run against a
   * database that has been accumulating for months.
   */
  overdueUnannounced(now: Date, take = 500) {
    return this.prisma.task.findMany({
      where: {
        deletedAt: null,
        dueDate: { lt: now },
        overdueNotifiedAt: null,
        status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED"] },
      },
      orderBy: { dueDate: "asc" },
      take,
      select: { id: true, title: true, projectId: true, assigneeId: true, dueDate: true },
    });
  }

  markOverdueAnnounced(ids: readonly string[], at: Date) {
    return this.prisma.task.updateMany({ where: { id: { in: [...ids] } }, data: { overdueNotifiedAt: at } });
  }

  /* ---- Existence checks -------------------------------------------- */

  /**
   * One query for every foreign key the body named.
   *
   * Four `findUnique` calls would report four separate failures — the user fixes
   * the project, resubmits, and is told about the milestone. The argument
   * `missingReferences` in `projects.repository.ts` makes, and the extra clause
   * here is that a **milestone must belong to the project**: a task delivering
   * against another project's milestone is a data error that no foreign key can
   * see.
   */
  async missingReferences(input: {
    projectId?: string | null;
    milestoneId?: string | null;
    assigneeId?: string | null;
    disciplineId?: string | null;
    parentTaskId?: string | null;
  }): Promise<string[]> {
    const missing: string[] = [];

    const [project, milestone, assignee, discipline, parent] = await Promise.all([
      input.projectId
        ? this.prisma.project.findFirst({
            where: { id: input.projectId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
      input.milestoneId
        ? this.prisma.milestone.findFirst({
            where: { id: input.milestoneId, deletedAt: null },
            select: { id: true, projectId: true },
          })
        : Promise.resolve(null),
      input.assigneeId
        ? this.prisma.employee.findFirst({
            where: { id: input.assigneeId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
      input.disciplineId
        ? this.prisma.discipline.findFirst({
            where: { id: input.disciplineId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
      input.parentTaskId
        ? this.prisma.task.findFirst({
            where: { id: input.parentTaskId, deletedAt: null },
            select: { id: true, projectId: true },
          })
        : Promise.resolve(null),
    ]);

    if (input.projectId && !project) missing.push("Projekt");
    if (input.milestoneId && !milestone) missing.push("Meilenstein");
    if (input.assigneeId && !assignee) missing.push("Zuständige Person");
    if (input.disciplineId && !discipline) missing.push("Gewerk");
    if (input.parentTaskId && !parent) missing.push("Übergeordnete Aufgabe");

    return missing;
  }

  /** The milestone's project, for the cross-project check the service makes. */
  async milestoneProject(id: string): Promise<string | null | undefined> {
    const row = await this.prisma.milestone.findFirst({
      where: { id, deletedAt: null },
      select: { projectId: true },
    });
    return row?.projectId;
  }

  /**
   * Whether a project exists **and** is within the caller's reach.
   *
   * One question, deliberately: "unknown" and "not yours" must produce the same
   * answer, or a create becomes a way to test which project ids exist (SEC-R7).
   */
  async projectReachable(projectId: string, scope: ProjectScope): Promise<boolean> {
    const row = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null, ...whereOf(scope) },
      select: { id: true },
    });
    return row !== null;
  }

  /** The caller's `Employee` row, from their login. `null` is a legitimate state. */
  async employeeIdForUser(userId: string): Promise<string | null> {
    const row = await this.prisma.employee.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** Runs a callback in one transaction — the service's only handle on one. */
  transaction<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
