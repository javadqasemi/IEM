import { Injectable } from "@nestjs/common";
import { DrawingStatus, Prisma } from "@prisma/client";
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
import { DRAWING_LIST, REVISION_LIST, TRANSMITTAL_LIST } from "./drawings.list";
import type { DrawingScope, TransmittalScope } from "./drawings.scope";
import {
  drawingDetailSelect,
  drawingSelect,
  protocolRevisionSelect,
  revisionSelect,
  transmittalDetailSelect,
  transmittalSelect,
} from "./drawings.mapper";

/** A transaction client, or the plain one. */
export type PrismaTx = Prisma.TransactionClient | PrismaService;

/**
 * Every Prisma statement this module makes, and nothing else.
 *
 * Two aggregates again — `Drawing` and `Transmittal` — and the same argument the
 * module before it made: a Planversand is what moves a plan from `RELEASED` to
 * `ISSUED`, so the interesting write touches both in one transaction. Splitting
 * them into two feature folders would mean one importing the other's service,
 * which `architecture.test.ts` forbids and is right to.
 */
@Injectable()
export class DrawingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ---- Drawings: reads --------------------------------------------- */

  parseList(query: RawListQuery): ListParams {
    return parseListQuery(query, DRAWING_LIST);
  }

  async list(params: ListParams, scope: DrawingScope) {
    const where = buildWhere(params, DRAWING_LIST, {
      deletedAt: null,
      ...whereOf(scope),
    }) as Prisma.DrawingWhereInput;

    // One transaction for the page and the count: two statements can straddle a
    // write and produce a total of 41 above a page of 40.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.drawing.findMany({
        where,
        orderBy: buildOrderBy(params, DRAWING_LIST),
        ...skipTake(params),
        select: drawingSelect,
      }),
      this.prisma.drawing.count({ where }),
    ]);

    return { items, total };
  }

  listAll(params: ListParams, scope: DrawingScope) {
    const where = buildWhere(params, DRAWING_LIST, {
      deletedAt: null,
      ...whereOf(scope),
    }) as Prisma.DrawingWhereInput;

    return this.prisma.drawing.findMany({
      where,
      orderBy: buildOrderBy(params, DRAWING_LIST),
      take: 10_000,
      select: drawingSelect,
    });
  }

  findDetail(id: string, scope: DrawingScope) {
    return this.prisma.drawing.findFirst({
      where: { id, deletedAt: null, ...whereOf(scope) },
      select: drawingDetailSelect,
    });
  }

  /**
   * The narrow read the rules need, and nothing more.
   *
   * `refuseTransition` wants the revisions' release state and the two people;
   * fetching the whole detail to decide a status change is a join nobody reads.
   * `projects.repository.ts` draws the same distinction with `findForRules`.
   */
  findForRules(id: string, scope: DrawingScope) {
    return this.prisma.drawing.findFirst({
      where: { id, deletedAt: null, ...whereOf(scope) },
      select: {
        id: true,
        number: true,
        projectId: true,
        status: true,
        version: true,
        currentRevision: true,
        drawnById: true,
        checkedById: true,
        revisions: {
          select: { id: true, revision: true, releasedAt: true, supersededAt: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  }

  /**
   * The counts behind the register's KPI tiles.
   *
   * `groupBy` is kept **out** of the `$transaction([…])` array, and that is not
   * style: inside the tuple Prisma widens `_count` to the union of every
   * possible shape, so `row._count._all` stops typechecking and the obvious
   * repair — a cast — would throw the check away. `countByStatus` in the module
   * before this one is a separate statement for the same reason. The three
   * counts stay batched; they are the ones that must agree with each other.
   */
  countByStatus(scope: DrawingScope) {
    return this.prisma.drawing.groupBy({
      by: ["status"],
      where: { deletedAt: null, ...whereOf(scope) },
      _count: { _all: true },
    });
  }

  async statsFor(scope: DrawingScope) {
    const where: Prisma.DrawingWhereInput = { deletedAt: null, ...whereOf(scope) };

    const [total, awaitingCheck, released] = await this.prisma.$transaction([
      this.prisma.drawing.count({ where }),
      this.prisma.drawing.count({ where: { ...where, status: DrawingStatus.IN_CHECK } }),
      this.prisma.drawing.count({ where: { ...where, status: DrawingStatus.RELEASED } }),
    ]);

    return { total, awaitingCheck, released };
  }

  /* ---- Drawings: writes -------------------------------------------- */

  create(data: Prisma.DrawingUncheckedCreateInput, tx: PrismaTx = this.prisma) {
    return tx.drawing.create({ data, select: drawingDetailSelect });
  }

  /**
   * The optimistic lock, as **one statement**.
   *
   * `updateMany({ where: { id, version: expected } })` and read the count.
   * Reading the version, comparing it, then writing looks equivalent and is
   * not: two callers both read 7, both find it equal to 7, and both write 8.
   * Postgres's row lock on `UPDATE … WHERE version = 7` is what actually
   * decides. `updateMany` rather than `update` because `update` takes only a
   * *unique* filter, and because a count is a value this code can read where an
   * exception would have to be parsed.
   */
  async updateIfUnchanged(
    id: string,
    expectedVersion: number,
    data: Prisma.DrawingUncheckedUpdateInput,
    tx: PrismaTx = this.prisma,
  ): Promise<boolean> {
    const result = await tx.drawing.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count === 1;
  }

  /** A write with no lock, for the acts that are not edits — status, revision. */
  update(id: string, data: Prisma.DrawingUncheckedUpdateInput, tx: PrismaTx = this.prisma) {
    return tx.drawing.update({ where: { id }, data, select: { id: true } });
  }

  softDelete(id: string, at: Date, tx: PrismaTx = this.prisma) {
    return tx.drawing.update({ where: { id }, data: { deletedAt: at }, select: { id: true } });
  }

  /* ---- Revisions ---------------------------------------------------- */

  parseRevisionList(query: RawListQuery): ListParams {
    return parseListQuery(query, REVISION_LIST);
  }

  /**
   * Revisions across every plan the caller may see.
   *
   * The scope is applied through the **drawing**, because a revision has no
   * project of its own. Expressing it as `{ drawing: scope }` rather than
   * post-filtering is the rule `projects.scope.ts` states: a page of eleven
   * rows out of twenty-five and a total that counts rows nobody can open are
   * both worse than a slower query.
   */
  async listRevisions(params: ListParams, scope: DrawingScope) {
    const where = buildWhere(params, REVISION_LIST, {
      drawing: { deletedAt: null, ...whereOf(scope) },
    }) as Prisma.DrawingRevisionWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.drawingRevision.findMany({
        where,
        orderBy: buildOrderBy(params, REVISION_LIST),
        ...skipTake(params),
        select: protocolRevisionSelect,
      }),
      this.prisma.drawingRevision.count({ where }),
    ]);

    return { items, total };
  }

  findRevision(id: string, scope: DrawingScope) {
    return this.prisma.drawingRevision.findFirst({
      where: { id, drawing: { deletedAt: null, ...whereOf(scope) } },
      select: revisionSelect,
    });
  }

  /** What `refuseTransmittal` needs about each revision being sent. */
  findRevisionsForTransmittal(ids: readonly string[], scope: DrawingScope) {
    return this.prisma.drawingRevision.findMany({
      where: { id: { in: [...ids] }, drawing: { deletedAt: null, ...whereOf(scope) } },
      select: {
        id: true,
        revision: true,
        releasedAt: true,
        supersededAt: true,
        drawingId: true,
        // `issuedRevision` comes along because `markIssued` may only advance it,
        // never move it backwards — deciding that needs the letter already there.
        drawing: {
          select: { id: true, number: true, status: true, projectId: true, issuedRevision: true },
        },
      },
    });
  }

  createRevision(data: Prisma.DrawingRevisionUncheckedCreateInput, tx: PrismaTx = this.prisma) {
    return tx.drawingRevision.create({ data, select: revisionSelect });
  }

  /**
   * Marks every earlier revision of a plan superseded.
   *
   * `updateMany` over "not this one and not already superseded" rather than a
   * read-then-write loop, so a plan that somehow has two unsuperseded
   * predecessors is repaired rather than half-repaired.
   */
  supersedeEarlierRevisions(
    drawingId: string,
    exceptId: string,
    at: Date,
    tx: PrismaTx = this.prisma,
  ) {
    return tx.drawingRevision.updateMany({
      where: { drawingId, id: { not: exceptId }, supersededAt: null },
      data: { supersededAt: at },
    });
  }

  releaseRevision(id: string, at: Date, approvedById: string | null, tx: PrismaTx = this.prisma) {
    return tx.drawingRevision.update({
      where: { id },
      data: { releasedAt: at, approvedById },
      select: { id: true },
    });
  }

  /* ---- Planversand -------------------------------------------------- */

  parseTransmittalList(query: RawListQuery): ListParams {
    return parseListQuery(query, TRANSMITTAL_LIST);
  }

  async listTransmittals(params: ListParams, scope: TransmittalScope) {
    const where = buildWhere(params, TRANSMITTAL_LIST, {
      ...whereOf(scope),
    }) as Prisma.TransmittalWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.transmittal.findMany({
        where,
        orderBy: buildOrderBy(params, TRANSMITTAL_LIST),
        ...skipTake(params),
        select: transmittalSelect,
      }),
      this.prisma.transmittal.count({ where }),
    ]);

    return { items, total };
  }

  listAllTransmittals(params: ListParams, scope: TransmittalScope) {
    const where = buildWhere(params, TRANSMITTAL_LIST, { ...whereOf(scope) }) as Prisma.TransmittalWhereInput;
    return this.prisma.transmittal.findMany({
      where,
      orderBy: buildOrderBy(params, TRANSMITTAL_LIST),
      take: 10_000,
      select: transmittalSelect,
    });
  }

  findTransmittal(id: string, scope: TransmittalScope) {
    return this.prisma.transmittal.findFirst({
      where: { id, ...whereOf(scope) },
      select: transmittalDetailSelect,
    });
  }

  /** The numbers already issued this year, for `nextTransmittalSequence`. */
  transmittalNumbersIn(year: number) {
    return this.prisma.transmittal
      .findMany({
        where: { number: { startsWith: `PV-${year}-` } },
        select: { number: true },
      })
      .then((rows) => rows.map((row) => row.number));
  }

  /**
   * Who already holds a revision of these plans.
   *
   * The input to `priorIssueWarnings`, and the reason the whole module exists:
   * *"welche Revision hatte der Sanitär am 14. März"* has to be a row. The
   * recipient label is assembled here because the two shapes — an employee and
   * a typed name — are a persistence detail.
   */
  async alreadyIssuedFor(drawingIds: readonly string[]) {
    const rows = await this.prisma.transmittalItem.findMany({
      where: { drawingRevision: { drawingId: { in: [...drawingIds] } } },
      select: {
        drawingRevision: { select: { drawingId: true, revision: true } },
        transmittal: {
          select: {
            recipients: {
              select: {
                externalName: true,
                employee: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });

    return rows.flatMap((row) =>
      row.transmittal.recipients.map((recipient) => ({
        drawingId: row.drawingRevision.drawingId,
        revision: row.drawingRevision.revision,
        recipientLabel: recipient.employee
          ? `${recipient.employee.firstName} ${recipient.employee.lastName}`
          : (recipient.externalName ?? "—"),
      })),
    );
  }

  createTransmittal(
    data: Prisma.TransmittalUncheckedCreateInput,
    items: readonly Prisma.TransmittalItemUncheckedCreateWithoutTransmittalInput[],
    recipients: readonly Prisma.TransmittalRecipientUncheckedCreateWithoutTransmittalInput[],
    tx: PrismaTx = this.prisma,
  ) {
    return tx.transmittal.create({
      data: {
        ...data,
        items: { create: [...items] },
        recipients: { create: [...recipients] },
      },
      select: transmittalDetailSelect,
    });
  }

  /**
   * Moves every plan in a transmittal to `ISSUED` and records **which revision**
   * went out, in the same transaction.
   *
   * One statement per plan rather than one `updateMany` for all of them, and
   * that is forced rather than preferred: `issuedRevision` differs per drawing,
   * and `updateMany` writes one `data` object to every matched row. Sending
   * three plans at revisions `C`, `A` and `F` through a single `updateMany`
   * would stamp all three with whichever letter the caller happened to put in
   * the object — a wrong revision in a register whose whole purpose is to say
   * what a contractor holds.
   *
   * The `WITHDRAWN` guard stays on each one, so a plan withdrawn between the
   * rule check and the write is skipped exactly as before; `updateMany` is kept
   * per row rather than `update` so a skipped plan is a count of zero instead of
   * an exception that would roll the whole Planversand back.
   */
  async markIssued(
    issued: readonly { drawingId: string; issuedRevision: string | null }[],
    userId: string | null,
    tx: PrismaTx = this.prisma,
  ) {
    let count = 0;
    for (const plan of issued) {
      const result = await tx.drawing.updateMany({
        where: { id: plan.drawingId, status: { not: DrawingStatus.WITHDRAWN } },
        data: {
          status: DrawingStatus.ISSUED,
          issuedRevision: plan.issuedRevision,
          updatedById: userId,
        },
      });
      count += result.count;
    }
    return { count };
  }

  acknowledge(recipientId: string, at: Date, tx: PrismaTx = this.prisma) {
    return tx.transmittalRecipient.update({
      where: { id: recipientId },
      data: { acknowledgedAt: at },
      select: { id: true, transmittalId: true },
    });
  }

  findRecipient(id: string, scope: TransmittalScope) {
    return this.prisma.transmittalRecipient.findFirst({
      where: { id, transmittal: whereOf(scope) },
      select: {
        id: true,
        acknowledgedAt: true,
        externalName: true,
        employee: { select: { firstName: true, lastName: true } },
        transmittal: { select: { id: true, number: true, projectId: true } },
      },
    });
  }

  /* ---- Metrics ------------------------------------------------------ */

  async recordCounts() {
    const [total, deleted, withdrawn, transmittals] = await this.prisma.$transaction([
      this.prisma.drawing.count(),
      this.prisma.drawing.count({ where: { deletedAt: { not: null } } }),
      this.prisma.drawing.count({
        where: { deletedAt: null, status: DrawingStatus.WITHDRAWN },
      }),
      this.prisma.transmittal.count(),
    ]);

    return { total, deleted, withdrawn, transmittals };
  }

  /**
   * The caller's `Employee` row, or null.
   *
   * **An `Employee` is not a `User`**, and the two ids are both cuids — passing
   * one where the other belongs compiles, matches nothing, and reads as "this
   * person has no plans". `tasks.scope.ts` documents the trap and every module
   * since has carried this lookup for the same reason.
   */
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

  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
