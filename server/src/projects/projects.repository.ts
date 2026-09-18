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
import { MILESTONE_LIST, PROJECT_LIST } from "./projects.list";
import { PROJECT_DETAIL_SELECT, PROJECT_LIST_SELECT } from "./projects.mapper";

/**
 * A transaction client, or the plain one.
 *
 * `Prisma.TransactionClient` is what `$transaction(fn)` hands a callback; a
 * method typed to accept either can be called inside a transaction or on its
 * own without a second copy of itself.
 */
export type PrismaTx = Prisma.TransactionClient | PrismaService;

/**
 * Every Prisma statement this module makes, and nothing else.
 *
 * The layer exists so that `projects.service.ts` contains rules and no queries,
 * and the test for whether it is doing its job is mechanical: **the service
 * imports no `Prisma` namespace and holds no `PrismaService`.**
 * `architecture.test.ts` asserts exactly that, because the failure mode is not
 * a bad query — it is a service that grows one convenient `findFirst` and then
 * cannot be reasoned about without a database.
 *
 * Three things the repository owns and the service therefore does not:
 *
 * - **The soft-delete predicate.** `deletedAt: null` is written here, in one
 *   place, and a caller cannot forget it. Every `deletedAt` bug in every system
 *   that has them is a query somewhere that omitted the clause.
 * - **The scope predicate.** Row-level visibility (`project.readAll`) arrives
 *   as a `where` fragment and is merged into the base — so a caller who forgets
 *   to pass it gets *their own* projects, never everyone's. The safe direction
 *   is the default.
 * - **The selects**, which are `projects.mapper.ts`'s, so the shape the mapper
 *   reads and the shape the query fetches cannot drift.
 */
@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ---- Reads ------------------------------------------------------- */

  /**
   * Parsing is here rather than in the service, and that is the one piece of
   * the layer split worth defending: `parseListQuery` turns an untrusted query
   * string into a validated `ListParams`, which is repository business. The
   * service receives `Paginated<T>` and never sees a query string — so it
   * cannot accidentally trust one.
   */
  parseList(query: RawListQuery): ListParams {
    return parseListQuery(query, PROJECT_LIST);
  }

  async list(params: ListParams, scope: Prisma.ProjectWhereInput = {}) {
    const where = buildWhere(params, PROJECT_LIST, {
      deletedAt: null,
      ...scope,
    }) as Prisma.ProjectWhereInput;

    /*
      One transaction for the page and the count.

      Not for atomicity of a read — for consistency of the *pair*. Two separate
      statements can straddle a write, and the result is a total of 41 above a
      page that has 40 rows in it, which reads as a broken paginator.
    */
    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        orderBy: buildOrderBy(params, PROJECT_LIST),
        ...skipTake(params),
        select: PROJECT_LIST_SELECT,
      }),
      this.prisma.project.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Every row a filtered export covers, with no page.
   *
   * The `take` is not a paginator — it is the ceiling that stops an export
   * being a way around `maxPerPage`. Ten thousand projects is more than the
   * firm will have this century; a request that hits it is a mistake, and
   * truncating is better than reading the table into memory.
   */
  async listAll(params: ListParams, scope: Prisma.ProjectWhereInput = {}) {
    const where = buildWhere(params, PROJECT_LIST, {
      deletedAt: null,
      ...scope,
    }) as Prisma.ProjectWhereInput;

    return this.prisma.project.findMany({
      where,
      orderBy: buildOrderBy(params, PROJECT_LIST),
      take: 10_000,
      select: PROJECT_LIST_SELECT,
    });
  }

  findDetail(id: string, scope: Prisma.ProjectWhereInput = {}, tx: PrismaTx = this.prisma) {
    return tx.project.findFirst({
      where: { id, deletedAt: null, ...scope },
      select: PROJECT_DETAIL_SELECT,
    });
  }

  /**
   * A display name for a user id, for the conflict message.
   *
   * "Geändert von Anna Meier" turns an error into a conversation; "Konflikt"
   * turns it into a support ticket. `null` when the account is gone — the
   * message then says only that somebody did, which is still true.
   */
  async nameOfUser(id: string): Promise<string | null> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: { name: true } });
    return row?.name ?? null;
  }

  /**
   * The state the rules need, and only that.
   *
   * A separate, tiny read rather than reusing `findDetail`, because
   * `refuseTransition` needs four fields and the detail select fetches three
   * joins and every milestone. A rule check that costs the same as rendering
   * the page is a rule check somebody eventually skips.
   */
  findForRules(id: string) {
    return this.prisma.project.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        number: true,
        name: true,
        status: true,
        managerId: true,
        startDate: true,
        plannedEndDate: true,
        progressPercent: true,
        health: true,
        customerId: true,
        milestones: {
          where: { deletedAt: null },
          select: { status: true, dueDate: true },
        },
      },
    });
  }

  /** The numbers already issued in a year — `nextSequence` reads the maximum. */
  async numbersForYear(year: number): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      // Deleted rows included **on purpose**: a number a deleted project used is
      // still on drawings and invoices, and reissuing it would make two
      // different projects answer to one key.
      where: { number: { startsWith: `P-${year}-` } },
      select: { number: true },
    });
    return rows.map((row) => row.number);
  }

  countByStatus(scope: Prisma.ProjectWhereInput = {}) {
    return this.prisma.project.groupBy({
      by: ["status"],
      where: { deletedAt: null, ...scope },
      _count: { _all: true },
    });
  }

  /* ---- Writes ------------------------------------------------------ */

  create(data: Prisma.ProjectCreateInput) {
    return this.prisma.project.create({ data, select: PROJECT_DETAIL_SELECT });
  }

  update(id: string, data: Prisma.ProjectUpdateInput, tx: PrismaTx = this.prisma) {
    return tx.project.update({ where: { id }, data, select: PROJECT_DETAIL_SELECT });
  }

  /**
   * The optimistic-lock write: update **only if** the row is still at
   * `expectedVersion`, and say how many rows that matched.
   *
   * `updateMany` rather than `update`, and the reason is the whole mechanism:
   * `update` throws when the `where` matches nothing, but it also only takes a
   * *unique* filter — so the version cannot be part of it. `updateMany` takes
   * an arbitrary `where` and returns a count, which is what turns "somebody
   * else saved first" into a value this code can read instead of an exception
   * it would have to parse.
   *
   * **The check and the write are one statement.** Reading the version, then
   * comparing it, then writing is the same race with extra steps: two callers
   * both read 7, both find it equal to 7, and both write 8. Postgres's row lock
   * on `UPDATE … WHERE version = 7` is what actually decides, and only one of
   * them gets `count: 1`.
   */
  async updateIfUnchanged(
    id: string,
    expectedVersion: number,
    data: Prisma.ProjectUpdateInput,
    tx: PrismaTx = this.prisma,
  ): Promise<number> {
    const { count } = await tx.project.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    return count;
  }

  /** The current version and who last touched it — for the conflict message. */
  versionOf(id: string, tx: PrismaTx = this.prisma) {
    return tx.project.findUnique({
      where: { id },
      select: { version: true, number: true, name: true, updatedById: true },
    });
  }

  /**
   * Soft delete, and the children with it.
   *
   * `deletedAt` on the parent alone would leave the member and discipline rows
   * live, and `ProjectMember` is queried from the *employee* side too — "what
   * is Anna working on" would keep listing a project nobody can open.
   */
  softDelete(id: string, at: Date) {
    return this.prisma.$transaction([
      this.prisma.projectMember.updateMany({
        where: { projectId: id, deletedAt: null },
        data: { deletedAt: at },
      }),
      this.prisma.projectDiscipline.updateMany({
        where: { projectId: id, deletedAt: null },
        data: { deletedAt: at },
      }),
      this.prisma.milestone.updateMany({
        where: { projectId: id, deletedAt: null },
        data: { deletedAt: at },
      }),
      this.prisma.project.update({ where: { id }, data: { deletedAt: at } }),
    ]);
  }

  /* ---- Members ----------------------------------------------------- */

  addMember(data: Prisma.ProjectMemberUncheckedCreateInput) {
    return this.prisma.projectMember.create({ data });
  }

  findMember(id: string) {
    return this.prisma.projectMember.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, projectId: true, employeeId: true, role: true },
    });
  }

  removeMember(id: string, at: Date) {
    return this.prisma.projectMember.update({ where: { id }, data: { deletedAt: at } });
  }

  /* ---- Disciplines ------------------------------------------------- */

  /**
   * Upsert on the composite unique.
   *
   * A Gewerk is either in scope on a project or it is not, and the UI is a set
   * of toggles rather than a list somebody appends to. Create-or-update on
   * `(projectId, disciplineId)` is what that interaction actually means; a
   * plain create would fail the second time a user corrects a budget.
   */
  upsertDiscipline(
    projectId: string,
    disciplineId: string,
    data: Omit<Prisma.ProjectDisciplineUncheckedCreateInput, "projectId" | "disciplineId">,
  ) {
    return this.prisma.projectDiscipline.upsert({
      where: { projectId_disciplineId: { projectId, disciplineId } },
      create: { projectId, disciplineId, ...data },
      update: { ...data, deletedAt: null },
    });
  }

  feeSharesFor(projectId: string) {
    return this.prisma.projectDiscipline.findMany({
      where: { projectId, deletedAt: null },
      select: { disciplineId: true, feeShare: true, feeShareOverride: true },
    });
  }

  /* ---- Milestones -------------------------------------------------- */

  parseMilestoneList(query: RawListQuery): ListParams {
    return parseListQuery(query, MILESTONE_LIST);
  }

  async listMilestones(projectId: string, params: ListParams) {
    const where = buildWhere(params, MILESTONE_LIST, {
      projectId,
      deletedAt: null,
    }) as Prisma.MilestoneWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.milestone.findMany({
        where,
        orderBy: buildOrderBy(params, MILESTONE_LIST),
        ...skipTake(params),
      }),
      this.prisma.milestone.count({ where }),
    ]);

    return { items, total };
  }

  createMilestone(data: Prisma.MilestoneUncheckedCreateInput) {
    return this.prisma.milestone.create({ data });
  }

  findMilestone(id: string) {
    return this.prisma.milestone.findFirst({ where: { id, deletedAt: null } });
  }

  updateMilestone(id: string, data: Prisma.MilestoneUpdateInput, tx: PrismaTx = this.prisma) {
    return tx.milestone.update({ where: { id }, data });
  }

  milestonesFor(projectId: string, tx: PrismaTx = this.prisma) {
    return tx.milestone.findMany({
      where: { projectId, deletedAt: null },
      select: { status: true, dueDate: true },
    });
  }

  /* ---- Existence checks -------------------------------------------- */

  /**
   * One query for all four foreign keys.
   *
   * Four `findUnique` calls would answer the same question with four
   * round-trips and, worse, with four separate failures — the user fixes the
   * customer, resubmits, and is told about the building. One check reports
   * everything wrong at once.
   */
  async missingReferences(input: {
    customerId?: string | null;
    architectId?: string | null;
    buildingId?: string | null;
    managerId?: string | null;
    officeId?: string | null;
  }): Promise<string[]> {
    const missing: string[] = [];
    const customerIds = [input.customerId, input.architectId].filter(
      (id): id is string => typeof id === "string",
    );

    // `Promise.all` and not `$transaction([...])`: the array form needs a
    // statement per slot, and three of these are conditional. Skipping the
    // query for a key that was not supplied is what keeps a create with no
    // building from costing four round-trips.
    const [customers, building, manager, office] = await Promise.all([
      customerIds.length
        ? this.prisma.customer.findMany({
            where: { id: { in: customerIds }, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve([] as { id: string }[]),
      input.buildingId
        ? this.prisma.building.findFirst({
            where: { id: input.buildingId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
      input.managerId
        ? this.prisma.employee.findFirst({
            where: { id: input.managerId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
      input.officeId
        ? this.prisma.office.findFirst({
            where: { id: input.officeId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    const found = new Set(customers.map((row) => row.id));
    if (input.customerId && !found.has(input.customerId)) missing.push("Kunde");
    if (input.architectId && !found.has(input.architectId)) missing.push("Architekt");
    if (input.buildingId && !building) missing.push("Gebäude");
    if (input.managerId && !manager) missing.push("Projektleitung");
    if (input.officeId && !office) missing.push("Standort");
    return missing;
  }

  /**
   * The caller's `Employee` row, from their login.
   *
   * `null` for a user who has none, and that is a legitimate state rather than
   * an error — see the note on `scopeFor`. The lookup is here because it is a
   * query; the *decision* about what a null means is in `projects.scope.ts`.
   */
  async employeeIdForUser(userId: string): Promise<string | null> {
    const row = await this.prisma.employee.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  employeeExists(id: string) {
    return this.prisma.employee.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
  }

  disciplineExists(id: string) {
    return this.prisma.discipline.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, code: true },
    });
  }

  /** Runs a callback in one transaction — the service's only handle on one. */
  transaction<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
