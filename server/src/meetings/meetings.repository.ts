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
import { whereOf, type Scope } from "../core/scope/scope";
import type { ProjectScope } from "../core/scope/project.scope";
import { DECISION_LIST, MEETING_ITEM_LIST, MEETING_LIST } from "./meetings.list";
import type { DecisionScope, MeetingScope } from "./meetings.scope";
import {
  DECISION_DETAIL_SELECT,
  DECISION_LIST_SELECT,
  MEETING_DETAIL_SELECT,
  MEETING_LIST_SELECT,
} from "./meetings.mapper";

/** A transaction client, or the plain one. */
export type PrismaTx = Prisma.TransactionClient | PrismaService;

/**
 * Every Prisma statement this module makes, and nothing else.
 *
 * Two aggregates live here — `Meeting` and `Decision` — and that is deliberate
 * rather than a missed split. They are one module because a decision is *taken*
 * at a meeting and a protocol line *is* the citation, so every interesting
 * write touches both: holding a meeting closes its decisions' provenance, and
 * superseding a decision is read from the minutes that recorded it. Two feature
 * folders would mean one importing the other's service, which
 * `architecture.test.ts` forbids and which would be the right call to forbid.
 */
@Injectable()
export class MeetingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ---- Meetings: reads --------------------------------------------- */

  parseList(query: RawListQuery): ListParams {
    return parseListQuery(query, MEETING_LIST);
  }

  async list(params: ListParams, scope: MeetingScope) {
    const where = buildWhere(params, MEETING_LIST, {
      deletedAt: null,
      ...whereOf(scope),
    }) as Prisma.MeetingWhereInput;

    // One transaction for the page and the count: two statements can straddle
    // a write and produce a total of 41 above a page of 40.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.meeting.findMany({
        where,
        orderBy: buildOrderBy(params, MEETING_LIST),
        ...skipTake(params),
        select: MEETING_LIST_SELECT,
      }),
      this.prisma.meeting.count({ where }),
    ]);

    return { items, total };
  }

  listAll(params: ListParams, scope: MeetingScope) {
    const where = buildWhere(params, MEETING_LIST, {
      deletedAt: null,
      ...whereOf(scope),
    }) as Prisma.MeetingWhereInput;

    return this.prisma.meeting.findMany({
      where,
      orderBy: buildOrderBy(params, MEETING_LIST),
      take: 10_000,
      select: MEETING_LIST_SELECT,
    });
  }

  findDetail(id: string, scope: MeetingScope, tx: PrismaTx = this.prisma) {
    return tx.meeting.findFirst({
      where: { id, deletedAt: null, ...whereOf(scope) },
      select: MEETING_DETAIL_SELECT,
    });
  }

  /**
   * The state the rules need, and only that.
   *
   * `refuseTransition` needs the protocol lines' text and the attendance
   * column; `refuseProtocolEdit` needs the approvals. The detail select fetches
   * five joins and every line with its task and its decision — a rule check
   * that costs the same as rendering the page is one somebody eventually skips.
   */
  findForRules(id: string, tx: PrismaTx = this.prisma) {
    return tx.meeting.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        seriesNumber: true,
        startsAt: true,
        version: true,
        projectId: true,
        organiserId: true,
        createdById: true,
        minutesSentAt: true,
        items: {
          where: { deletedAt: null },
          select: { id: true, kind: true, text: true, order: true, taskId: true },
        },
        attendees: { where: { deletedAt: null }, select: { id: true, attended: true } },
        approvals: { select: { decision: true } },
      },
    });
  }

  versionOf(id: string, tx: PrismaTx = this.prisma) {
    return tx.meeting.findUnique({
      where: { id },
      select: { version: true, title: true, updatedById: true },
    });
  }

  async nameOfUser(id: string): Promise<string | null> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: { name: true } });
    return row?.name ?? null;
  }

  countByStatus(scope: MeetingScope) {
    return this.prisma.meeting.groupBy({
      by: ["status"],
      where: { deletedAt: null, ...whereOf(scope) },
      _count: { _all: true },
    });
  }

  /**
   * Held meetings whose minutes have not gone out.
   *
   * The queue a Projektleiter works through on a Friday, and the one figure on
   * this module's stats tile that somebody acts on.
   */
  countMinutesPending(scope: MeetingScope) {
    return this.prisma.meeting.count({
      where: { deletedAt: null, status: "HELD", minutesSentAt: null, ...whereOf(scope) },
    });
  }

  /**
   * The series numbers already issued for a type on a project.
   *
   * Deleted meetings **included on purpose**: "Bausitzung 12" was written in an
   * e-mail, and reissuing 12 would make two meetings answer to one name.
   */
  async seriesNumbersFor(projectId: string | null, type: Prisma.MeetingWhereInput["type"]) {
    const rows = await this.prisma.meeting.findMany({
      where: { projectId, type },
      select: { seriesNumber: true },
    });
    return rows.map((row) => row.seriesNumber);
  }

  /* ---- Meetings: writes -------------------------------------------- */

  create(data: Prisma.MeetingUncheckedCreateInput, tx: PrismaTx = this.prisma) {
    return tx.meeting.create({ data, select: MEETING_DETAIL_SELECT });
  }

  update(id: string, data: Prisma.MeetingUncheckedUpdateInput, tx: PrismaTx = this.prisma) {
    return tx.meeting.update({ where: { id }, data, select: MEETING_DETAIL_SELECT });
  }

  /**
   * The optimistic-lock write — one statement, not three.
   *
   * Reading the version, comparing it and then writing is the same race with
   * extra steps: two callers both read 7, both find it equal, both write 8.
   * Postgres's row lock on `UPDATE … WHERE version = 7` is what decides.
   */
  async updateIfUnchanged(
    id: string,
    expectedVersion: number,
    data: Prisma.MeetingUncheckedUpdateInput,
    tx: PrismaTx = this.prisma,
  ): Promise<number> {
    const { count } = await tx.meeting.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    return count;
  }

  /**
   * Soft delete, and the four child tables with it.
   *
   * `MeetingApproval` is **not** soft-deleted and has no `deletedAt`: an
   * approval is a fact about who accepted a record on a date, and it cascades
   * at the database with the meeting. The other four carry `deletedAt` because
   * they are read from the *other* side too — a decision links to its meeting,
   * a task to its protocol line — and a hard delete would break those links.
   */
  softDelete(id: string, at: Date) {
    return this.prisma.$transaction([
      this.prisma.meetingItem.updateMany({
        where: { meetingId: id, deletedAt: null },
        data: { deletedAt: at },
      }),
      this.prisma.meetingAgendaItem.updateMany({
        where: { meetingId: id, deletedAt: null },
        data: { deletedAt: at },
      }),
      this.prisma.meetingAttendee.updateMany({
        where: { meetingId: id, deletedAt: null },
        data: { deletedAt: at },
      }),
      this.prisma.meeting.update({ where: { id }, data: { deletedAt: at } }),
    ]);
  }

  /* ---- Attendees ---------------------------------------------------- */

  addAttendee(data: Prisma.MeetingAttendeeUncheckedCreateInput) {
    return this.prisma.meetingAttendee.create({ data });
  }

  findAttendee(id: string) {
    return this.prisma.meetingAttendee.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, meetingId: true, employeeId: true },
    });
  }

  removeAttendee(id: string, at: Date) {
    return this.prisma.meetingAttendee.update({ where: { id }, data: { deletedAt: at } });
  }

  /** The whole room's attendance, in one transaction. */
  recordAttendance(
    entries: readonly { id: string; attended?: boolean | null; apologised?: boolean }[],
  ) {
    return this.prisma.$transaction(
      entries.map((entry) =>
        this.prisma.meetingAttendee.update({
          where: { id: entry.id },
          data: { attended: entry.attended, apologised: entry.apologised },
        }),
      ),
    );
  }

  /* ---- Agenda ------------------------------------------------------- */

  async nextAgendaOrder(meetingId: string): Promise<number> {
    const last = await this.prisma.meetingAgendaItem.findFirst({
      where: { meetingId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    return (last?.order ?? 0) + 1;
  }

  addAgendaItem(data: Prisma.MeetingAgendaItemUncheckedCreateInput) {
    return this.prisma.meetingAgendaItem.create({ data });
  }

  findAgendaItem(id: string) {
    return this.prisma.meetingAgendaItem.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, meetingId: true, order: true, title: true },
    });
  }

  updateAgendaItem(id: string, data: Prisma.MeetingAgendaItemUncheckedUpdateInput) {
    return this.prisma.meetingAgendaItem.update({ where: { id }, data });
  }

  removeAgendaItem(id: string, at: Date) {
    return this.prisma.meetingAgendaItem.update({ where: { id }, data: { deletedAt: at } });
  }

  /* ---- Protocol ----------------------------------------------------- */

  parseItemList(query: RawListQuery): ListParams {
    return parseListQuery(query, MEETING_ITEM_LIST);
  }

  /**
   * Protocol lines across **every** meeting the caller may see.
   *
   * The query `docs/data-model.md` §3.11 names: *"alle offenen Pendenzen für
   * Lüftung über alle Bausitzungen"*. It is a list over `MeetingItem` with the
   * meeting scope applied through the relation, and it is why `disciplineId`
   * sits on the line rather than being reached through the project.
   */
  async listItems(params: ListParams, scope: MeetingScope) {
    const where = buildWhere(params, MEETING_ITEM_LIST, {
      deletedAt: null,
      meeting: { deletedAt: null, ...whereOf(scope) },
    }) as Prisma.MeetingItemWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.meetingItem.findMany({
        where,
        orderBy: buildOrderBy(params, MEETING_ITEM_LIST),
        ...skipTake(params),
        select: {
          id: true,
          order: true,
          text: true,
          kind: true,
          dueDate: true,
          responsible: { select: { id: true, firstName: true, lastName: true, email: true } },
          discipline: { select: { id: true, code: true, name: true, defaultColour: true } },
          task: { select: { id: true, title: true, status: true, dueDate: true } },
          decision: { select: { id: true, number: true, title: true, status: true } },
          meeting: { select: { id: true, title: true, seriesNumber: true, startsAt: true } },
        },
      }),
      this.prisma.meetingItem.count({ where }),
    ]);

    return { items, total };
  }

  async nextItemOrder(meetingId: string, tx: PrismaTx = this.prisma): Promise<number> {
    const last = await tx.meetingItem.findFirst({
      where: { meetingId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    return (last?.order ?? 0) + 1;
  }

  addItem(data: Prisma.MeetingItemUncheckedCreateInput, tx: PrismaTx = this.prisma) {
    return tx.meetingItem.create({ data });
  }

  findItem(id: string, tx: PrismaTx = this.prisma) {
    return tx.meetingItem.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        meetingId: true,
        order: true,
        text: true,
        kind: true,
        taskId: true,
        decisionId: true,
        responsibleId: true,
        dueDate: true,
        disciplineId: true,
      },
    });
  }

  updateItem(id: string, data: Prisma.MeetingItemUncheckedUpdateInput, tx: PrismaTx = this.prisma) {
    return tx.meetingItem.update({ where: { id }, data });
  }

  removeItem(id: string, at: Date) {
    return this.prisma.meetingItem.update({ where: { id }, data: { deletedAt: at } });
  }

  /**
   * A whole protocol renumbered, in one transaction.
   *
   * **Two passes, through a negative range.** `@@unique([meetingId, order])`
   * means a straight renumber collides the moment two lines swap: writing line
   * B to 3 while line C still holds 3 fails, and which one fails depends on the
   * order the updates happen to run in. Moving everything to `-1, -2, -3` first
   * and then to its final place cannot collide, because no real row is ever
   * negative.
   */
  reorderItems(ids: readonly string[]) {
    return this.prisma.$transaction([
      ...ids.map((id, index) =>
        this.prisma.meetingItem.update({ where: { id }, data: { order: -(index + 1) } }),
      ),
      ...ids.map((id, index) =>
        this.prisma.meetingItem.update({ where: { id }, data: { order: index + 1 } }),
      ),
    ]);
  }

  bulkDiscipline(ids: readonly string[], disciplineId: string | null) {
    return this.prisma.meetingItem.updateMany({
      where: { id: { in: [...ids] }, deletedAt: null },
      data: { disciplineId },
    });
  }

  /* ---- Approvals ---------------------------------------------------- */

  addApproval(data: Prisma.MeetingApprovalUncheckedCreateInput) {
    return this.prisma.meetingApproval.create({ data });
  }

  /* ---- Decisions ---------------------------------------------------- */

  parseDecisionList(query: RawListQuery): ListParams {
    return parseListQuery(query, DECISION_LIST);
  }

  async listDecisions(params: ListParams, scope: DecisionScope) {
    const where = buildWhere(params, DECISION_LIST, {
      deletedAt: null,
      ...whereOf(scope),
    }) as Prisma.DecisionWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.decision.findMany({
        where,
        orderBy: buildOrderBy(params, DECISION_LIST),
        ...skipTake(params),
        select: DECISION_LIST_SELECT,
      }),
      this.prisma.decision.count({ where }),
    ]);

    return { items, total };
  }

  listAllDecisions(params: ListParams, scope: DecisionScope) {
    const where = buildWhere(params, DECISION_LIST, {
      deletedAt: null,
      ...whereOf(scope),
    }) as Prisma.DecisionWhereInput;

    return this.prisma.decision.findMany({
      where,
      orderBy: buildOrderBy(params, DECISION_LIST),
      take: 10_000,
      select: DECISION_LIST_SELECT,
    });
  }

  findDecision(id: string, scope: DecisionScope, tx: PrismaTx = this.prisma) {
    return tx.decision.findFirst({
      where: { id, deletedAt: null, ...whereOf(scope) },
      select: DECISION_DETAIL_SELECT,
    });
  }

  findDecisionForRules(id: string, tx: PrismaTx = this.prisma) {
    return tx.decision.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        number: true,
        title: true,
        rationale: true,
        status: true,
        impact: true,
        projectId: true,
        meetingId: true,
        decidedAt: true,
        decidedById: true,
        supersedesId: true,
        version: true,
        createdById: true,
      },
    });
  }

  decisionVersionOf(id: string, tx: PrismaTx = this.prisma) {
    return tx.decision.findUnique({
      where: { id },
      select: { version: true, number: true, title: true, updatedById: true },
    });
  }

  /** The numbers already issued on a project — `nextDecisionSequence` reads the max. */
  async decisionNumbersFor(projectId: string): Promise<string[]> {
    const rows = await this.prisma.decision.findMany({
      // Deleted rows included: the number is quoted in e-mails and on drawings.
      where: { projectId },
      select: { number: true },
    });
    return rows.map((row) => row.number);
  }

  /**
   * Every supersede edge on a project — for the cycle check.
   *
   * The whole project's graph rather than the neighbourhood, because a cycle is
   * a global property: A→B→C→A cannot be seen from A's own edge. Bounded
   * because `refuseSupersede` refuses a cross-project reversal.
   */
  async supersedesForProject(projectId: string): Promise<Map<string, string | null>> {
    const rows = await this.prisma.decision.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, supersedesId: true },
    });
    return new Map(rows.map((row) => [row.id, row.supersedesId]));
  }

  createDecision(data: Prisma.DecisionUncheckedCreateInput, tx: PrismaTx = this.prisma) {
    return tx.decision.create({ data, select: DECISION_DETAIL_SELECT });
  }

  updateDecision(
    id: string,
    data: Prisma.DecisionUncheckedUpdateInput,
    tx: PrismaTx = this.prisma,
  ) {
    return tx.decision.update({ where: { id }, data, select: DECISION_DETAIL_SELECT });
  }

  async updateDecisionIfUnchanged(
    id: string,
    expectedVersion: number,
    data: Prisma.DecisionUncheckedUpdateInput,
    tx: PrismaTx = this.prisma,
  ): Promise<number> {
    const { count } = await tx.decision.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    return count;
  }

  softDeleteDecision(id: string, at: Date) {
    return this.prisma.decision.update({ where: { id }, data: { deletedAt: at } });
  }

  countDecisionsByStatus(scope: DecisionScope) {
    return this.prisma.decision.groupBy({
      by: ["status"],
      where: { deletedAt: null, ...whereOf(scope) },
      _count: { _all: true },
    });
  }

  /* ---- The Pendenz's task -------------------------------------------- */

  /**
   * Writing a `Task` from this module, and why the statements live here.
   *
   * **A repository may know any table.** That is the rule `tasks.repository.ts`
   * already relies on to call `/projects` and `/employees`, and it is what
   * keeps `meetings.service.ts` free of Prisma: the service decides *that* a
   * Pendenz becomes a task and supplies the values, and these two statements
   * are the only place in the module that touches the tasks table.
   *
   * What is **not** done here is calling `TasksService` —
   * `architecture.test.ts` forbids a feature importing a sibling's service, and
   * correctly, because a service carries a transaction, an event bus and a
   * permission model of its own. The arithmetic that would otherwise be
   * duplicated is borrowed from `tasks.rules.ts`, which is pure.
   */
  async taskPositionsIn(projectId: string | null, tx: PrismaTx = this.prisma): Promise<number[]> {
    const rows = await tx.task.findMany({
      where: { projectId, status: "TODO", deletedAt: null, parentTaskId: null },
      select: { position: true },
    });
    return rows.map((row) => row.position);
  }

  async createTaskForPendenz(
    data: Prisma.TaskUncheckedCreateInput,
    tx: PrismaTx = this.prisma,
  ): Promise<string> {
    const created = await tx.task.create({ data, select: { id: true } });
    return created.id;
  }

  /* ---- Existence checks --------------------------------------------- */

  /**
   * One query for every foreign key the body named.
   *
   * Four `findUnique` calls would report four separate failures — the user
   * fixes the project, resubmits, and is told about the Gewerk.
   */
  async missingReferences(input: {
    projectId?: string | null;
    organiserId?: string | null;
    employeeId?: string | null;
    disciplineId?: string | null;
    meetingId?: string | null;
  }): Promise<string[]> {
    const missing: string[] = [];
    const employeeIds = [input.organiserId, input.employeeId].filter(
      (id): id is string => typeof id === "string",
    );

    const [project, employees, discipline, meeting] = await Promise.all([
      input.projectId
        ? this.prisma.project.findFirst({
            where: { id: input.projectId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds }, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve([] as { id: string }[]),
      input.disciplineId
        ? this.prisma.discipline.findFirst({
            where: { id: input.disciplineId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
      input.meetingId
        ? this.prisma.meeting.findFirst({
            where: { id: input.meetingId, deletedAt: null },
            select: { id: true, projectId: true, startsAt: true },
          })
        : Promise.resolve(null),
    ]);

    const found = new Set(employees.map((row) => row.id));
    if (input.projectId && !project) missing.push("Projekt");
    if (input.organiserId && !found.has(input.organiserId)) missing.push("Sitzungsleitung");
    if (input.employeeId && !found.has(input.employeeId)) missing.push("Person");
    if (input.disciplineId && !discipline) missing.push("Gewerk");
    if (input.meetingId && !meeting) missing.push("Sitzung");
    return missing;
  }

  /** The meeting a decision names, for the cross-project and date checks. */
  meetingContext(id: string) {
    return this.prisma.meeting.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, projectId: true, startsAt: true, seriesNumber: true, title: true },
    });
  }

  async employeeIdForUser(userId: string): Promise<string | null> {
    const row = await this.prisma.employee.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Whether a project exists **and** is within the caller's reach — one
   * question, so "unknown" and "not yours" answer alike (SEC-R7).
   */
  async projectReachable(projectId: string, scope: ProjectScope): Promise<boolean> {
    const row = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null, ...whereOf(scope) },
      select: { id: true },
    });
    return row !== null;
  }

  /** The project a task belongs to, when the caller can see the task at all. */
  async taskProjectIfVisible(
    taskId: string,
    scope: Scope<Prisma.TaskWhereInput>,
  ): Promise<{ projectId: string | null } | null> {
    return this.prisma.task.findFirst({
      where: { id: taskId, deletedAt: null, ...whereOf(scope) },
      select: { projectId: true },
    });
  }

  transaction<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
