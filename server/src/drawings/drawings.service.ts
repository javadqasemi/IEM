import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DrawingStatus } from "@prisma/client";
import type { AuthUser } from "../common/decorators";
import { EventBus } from "../core/events/event-bus";
import { paginated } from "../core/list/list";
import type { RawListQuery } from "../core/list/list.decorator";
import { VERSION_CONTROL_FIELDS, changedFields } from "../core/versioning/changed";
import { VersioningService } from "../core/versioning/versioning.service";
import type {
  AcknowledgeDto,
  ChangeDrawingStatusDto,
  CreateDrawingDto,
  CreateRevisionDto,
  CreateTransmittalDto,
  UpdateDrawingDto,
} from "./drawings.dto";
import {
  toDrawing,
  toDrawingCreateData,
  toDrawingDetail,
  toDrawingSnapshot,
  toDrawingUpdateData,
  toListedRevision,
  toRevision,
  toRevisionCreateData,
  toTransmittal,
  toTransmittalCreateData,
  toTransmittalDetail,
} from "./drawings.mapper";
import { DrawingsRepository } from "./drawings.repository";
import {
  formatTransmittalNumber,
  nextDrawingRevision,
  nextIssuedRevision,
  nextTransmittalSequence,
  priorIssueWarnings,
  refuseDrawingNumber,
  refuseRevision,
  refuseRevisionLabel,
  refuseTransition,
  refuseTransmittal,
  transitionsFrom,
} from "./drawings.rules";
import {
  scopeFor,
  seesAllDrawings,
  transmittalScopeFor,
  type DrawingScope,
  type TransmittalScope,
} from "./drawings.scope";
import { unrestricted } from "../core/scope/scope";
import {
  PROJECT_NOT_FOUND,
  projectScopeFor,
  seesAllProjects,
} from "../core/scope/project.scope";

/**
 * Pläne und Planversand — Wave 2, module 3.
 *
 * **No Prisma in here.** Every statement goes through `DrawingsRepository`,
 * which `architecture.test.ts` enforces: a service with a client in scope grows
 * one convenient `findFirst`, then a second, and within a release its rules
 * cannot be reasoned about — or tested — without a database.
 *
 * ---
 *
 * **What makes this module different from the three before it.** Projects,
 * Tasks and Meetings all own records that people edit. This one owns an
 * **artefact that leaves the building**, and that changes two things:
 *
 * - **`ISSUED` and `SUPERSEDED` are never set directly.** They are consequences
 *   — of a Planversand and of a newer revision — so a plan can never read as
 *   being in a contractor's hands without a row saying whose. `refuseTransition`
 *   refuses both by name and says what to do instead.
 * - **Issuing is one transaction across two aggregates.** The transmittal, its
 *   items, its recipients and the plans' new status are written together, so a
 *   Planversand that half-succeeded — plans marked issued with no record of who
 *   received them — is not a state this system can reach.
 */
@Injectable()
export class DrawingsService {
  constructor(
    private readonly repo: DrawingsRepository,
    private readonly events: EventBus,
    private readonly versions: VersioningService,
  ) {}

  /* ================================================================ */
  /* Drawings — reads                                                  */
  /* ================================================================ */

  async list(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseList(query);
    const { items, total } = await this.repo.list(params, await this.scope(user));
    return paginated(items.map(toDrawing), total, params);
  }

  async exportRows(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseList(query);
    const rows = await this.repo.listAll(params, await this.scope(user));
    return rows.map((row) => {
      const drawing = toDrawing(row);
      return {
        Nummer: drawing.number,
        Titel: drawing.title,
        Projekt: drawing.project?.number ?? "",
        Gewerk: drawing.discipline?.code ?? "",
        Typ: drawing.type,
        Format: drawing.format,
        Massstab: drawing.scale ?? "",
        Status: drawing.status,
        Revision: drawing.currentRevision ?? "",
        Gezeichnet: drawing.drawnBy?.name ?? "",
        Geprüft: drawing.checkedBy?.name ?? "",
        Freigegeben: drawing.approvedBy?.name ?? "",
      };
    });
  }

  async detail(id: string, user: AuthUser) {
    const row = await this.repo.findDetail(id, await this.scope(user));
    if (!row) throw new NotFoundException("Plan nicht gefunden.");
    return this.present(row);
  }

  async stats(user: AuthUser) {
    const scope = await this.scope(user);
    const [rows, totals] = await Promise.all([
      this.repo.countByStatus(scope),
      this.repo.statsFor(scope),
    ]);

    // Every status key filled, so one with no rows reads as 0 rather than as a
    // missing card — `groupBy` returns only the statuses that have rows, and a
    // missing key renders as nothing where 0 is the answer.
    const byStatus: Record<string, number> = {};
    for (const status of Object.values(DrawingStatus)) byStatus[status] = 0;
    for (const row of rows) byStatus[row.status] = row._count._all;

    return { byStatus, ...totals };
  }

  /**
   * A plan's version history — through `require()`, like every other read of
   * one plan.
   *
   * It used to take the id alone and read `EntityVersion` directly, so any
   * holder of `drawing.read` could fetch the full snapshots of any plan in the
   * firm by id, whatever its project (SEC-R6, the one route the audit found
   * where the scope had been forgotten outright). `require()` answers 404 for
   * a plan the caller cannot see, as `GET /drawings/:id` does.
   */
  async history(id: string, user: AuthUser) {
    await this.require(id, user);
    return this.versions.history("drawing", id);
  }

  /* ================================================================ */
  /* Drawings — writes                                                 */
  /* ================================================================ */

  async create(dto: CreateDrawingDto, user: AuthUser) {
    const refusal = refuseDrawingNumber(dto.number);
    if (refusal) throw new BadRequestException(refusal);

    // A plan may only be started in a project the caller can reach, and a
    // hidden project answers exactly like a missing one (SEC-R7).
    await this.requireProjectReach(dto.projectId, user);

    const row = await this.repo
      .create(toDrawingCreateData(dto, user.id))
      .catch((error: unknown) => {
        throw this.translateUnique(error, dto.number);
      });

    this.events.publish("DrawingCreated", {
      entity: "drawing",
      entityId: row.id,
      payload: {
        projectId: row.projectId,
        number: row.number,
        disciplineId: row.disciplineId,
        type: row.type,
      },
      after: toDrawingSnapshot(row),
    });

    return this.present(row);
  }

  async update(id: string, dto: UpdateDrawingDto, user: AuthUser) {
    const current = await this.require(id, user);

    if (dto.number !== undefined) {
      const refusal = refuseDrawingNumber(dto.number);
      if (refusal) throw new BadRequestException(refusal);
    }

    /*
      **`changedFields`, never `Object.keys(dto)`.**

      `useDefineForClassFields` defines every declared optional as `undefined`
      on the transformed instance, so `Object.keys` returns all sixteen fields
      for a PATCH that sent one. That shipped for a whole wave, and vitest
      cannot reproduce it because esbuild does not emit the definitions —
      `core/versioning/changed.ts` carries the measurement.
    */
    const changed = changedFields(dto, VERSION_CONTROL_FIELDS);
    if (!changed.length) return this.detail(id, user);

    const before = await this.repo.findDetail(
      id,
      unrestricted("the row require() has just checked, read for the audit snapshot"),
    );

    /*
      The lock, the re-read and the version row in **one transaction**.

      Recording the version outside it would leave a window in which the plan
      is at v8 and its history stops at v7 — and the history is the thing
      somebody reaches for precisely when a write went wrong.
    */
    const after = await this.repo.transaction(async (tx) => {
      const ok = await this.repo
        .updateIfUnchanged(id, dto.expectedVersion, toDrawingUpdateData(dto, user.id), tx)
        .catch((error: unknown) => {
          throw this.translateUnique(error, dto.number ?? current.number);
        });

      if (!ok) await this.refuseStale(id, dto.expectedVersion, user);

      const updated = await this.repo.findDetail(
        id,
        unrestricted("re-read of the row this transaction just wrote; require() checked reach"),
      );
      if (!updated) throw new NotFoundException("Plan nicht gefunden.");

      await this.versions.record(tx, {
        entity: "drawing",
        entityId: id,
        version: dto.expectedVersion + 1,
        // The **mapped** record, never the Prisma row, so a document read in
        // five years does not depend on a schema that has since changed.
        data: toDrawingSnapshot(updated),
        changed,
        note: dto.versionNote ?? null,
      });

      return updated;
    });

    this.events.publish("DrawingUpdated", {
      entity: "drawing",
      entityId: id,
      payload: { projectId: after.projectId, number: after.number, fields: changed },
      before: before ? toDrawingSnapshot(before) : undefined,
      after: toDrawingSnapshot(after),
    });

    return this.present(after);
  }

  /**
   * The status change, and the two refusals that carry the module.
   *
   * A withdrawal **requires a reason**, and that rule was settled by the event
   * catalogue rather than by this method: `DrawingWithdrawn.reason` was declared
   * a non-nullable `string` during F7, before the module existed. Withdrawing a
   * plan people are building from without saying why is exactly the thing that
   * should not be possible, and the payload said so first.
   */
  async changeStatus(id: string, dto: ChangeDrawingStatusDto, user: AuthUser) {
    const current = await this.require(id, user);

    const refusal = refuseTransition(current.status, dto.status, {
      revisions: current.revisions,
      drawnById: current.drawnById,
      checkedById: current.checkedById,
    });
    if (refusal) throw new BadRequestException(refusal);

    const reason = dto.reason?.trim() ?? "";
    if (dto.status === DrawingStatus.WITHDRAWN && !reason) {
      throw new BadRequestException(
        "Ein Plan wird nicht ohne Begründung zurückgezogen — wer ihn hat, muss wissen warum.",
      );
    }

    if (current.status === dto.status) return this.detail(id, user);

    const releasing = dto.status === DrawingStatus.RELEASED;
    const newest = current.revisions[0];

    await this.repo.transaction(async (tx) => {
      await this.repo.update(
        id,
        {
          status: dto.status,
          updatedById: user.id,
          // Released *by* whoever pressed the button, and only then: the column
          // is evidence, so it is stamped by the act rather than typed.
          ...(releasing ? { approvedById: current.checkedById } : {}),
        },
        tx,
      );

      if (releasing && newest && !newest.releasedAt) {
        await this.repo.releaseRevision(newest.id, new Date(), current.checkedById, tx);
        // Everything before the newest is now history.
        await this.repo.supersedeEarlierRevisions(id, newest.id, new Date(), tx);
      }
    });

    this.events.publish("DrawingStatusChanged", {
      entity: "drawing",
      entityId: id,
      payload: {
        projectId: current.projectId,
        number: current.number,
        from: current.status,
        to: dto.status,
      },
      before: { status: current.status },
      after: { status: dto.status },
      message: reason || undefined,
    });

    if (releasing && newest) {
      this.events.publish("DrawingReleased", {
        entity: "drawing",
        entityId: id,
        payload: {
          projectId: current.projectId,
          number: current.number,
          revision: newest.revision,
        },
      });
    }

    if (dto.status === DrawingStatus.WITHDRAWN) {
      this.events.publish("DrawingWithdrawn", {
        entity: "drawing",
        entityId: id,
        payload: { projectId: current.projectId, number: current.number, reason },
      });
    }

    return this.detail(id, user);
  }

  async remove(id: string, user: AuthUser) {
    const current = await this.require(id, user);

    // A plan that has been issued is somebody else's record too. Withdrawing it
    // tells them; deleting it removes the row they would have been told about.
    if (current.status === DrawingStatus.ISSUED) {
      throw new BadRequestException(
        "Ein ausgegebener Plan wird zurückgezogen, nicht gelöscht — er ist bei den Empfängern.",
      );
    }

    await this.repo.softDelete(id, new Date());

    this.events.publish("DrawingDeleted", {
      entity: "drawing",
      entityId: id,
      payload: { projectId: current.projectId, number: current.number },
    });

    return { ok: true };
  }

  /* ================================================================ */
  /* Revisions                                                         */
  /* ================================================================ */

  async listRevisions(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseRevisionList(query);
    const { items, total } = await this.repo.listRevisions(params, await this.scope(user));
    return paginated(items.map(toListedRevision), total, params);
  }

  /**
   * A new revision.
   *
   * The letter is allocated by `nextDrawingRevision`, which skips `I` and `O` —
   * the exclusion `core/versioning/revision.ts` wrote down during F13 and left
   * for this module. A caller may supply one instead, because a plan set that
   * started life in AutoCAD arrives at `C`.
   *
   * **Creating a revision does not release it.** The new revision is the
   * newest; the previous one stays current until somebody releases the plan,
   * which is the act that supersedes it. Doing both here would mean uploading a
   * file silently invalidated the plan the contractor is holding.
   */
  async createRevision(drawingId: string, dto: CreateRevisionDto, user: AuthUser) {
    const current = await this.require(drawingId, user);

    const refusal = refuseRevision({
      changeNote: dto.changeNote,
      drawnById: dto.drawnById ?? current.drawnById,
      checkedById: dto.checkedById ?? current.checkedById,
      status: current.status,
    });
    if (refusal) throw new BadRequestException(refusal);

    let revision: string;
    if (dto.revision) {
      const bad = refuseRevisionLabel(dto.revision);
      if (bad) throw new BadRequestException(bad);
      revision = dto.revision.trim().toUpperCase();
    } else {
      revision = nextDrawingRevision(current.currentRevision);
    }

    const row = await this.repo.transaction(async (tx) => {
      const created = await this.repo.createRevision(
        toRevisionCreateData(dto, drawingId, revision, user.id),
        tx,
      );
      // `currentRevision` is denormalised so a register can sort by it without
      // a join. Written by exactly one method, like `Project.progressPercent`.
      await this.repo.update(
        drawingId,
        { currentRevision: revision, updatedById: user.id, status: DrawingStatus.WIP },
        tx,
      );
      return created;
    });

    this.events.publish("RevisionCreated", {
      entity: "drawing",
      entityId: drawingId,
      payload: {
        projectId: current.projectId,
        number: current.number,
        revision,
        reason: row.reason,
        supersedes: current.currentRevision,
      },
    });

    return toRevision(row);
  }

  async revision(id: string, user: AuthUser) {
    const row = await this.repo.findRevision(id, await this.scope(user));
    if (!row) throw new NotFoundException("Revision nicht gefunden.");
    return toRevision(row);
  }

  /* ================================================================ */
  /* Planversand                                                       */
  /* ================================================================ */

  async listTransmittals(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseTransmittalList(query);
    const { items, total } = await this.repo.listTransmittals(
      params,
      await this.transmittalScope(user),
    );
    return paginated(items.map(toTransmittal), total, params);
  }

  async transmittalDetail(id: string, user: AuthUser) {
    const row = await this.repo.findTransmittal(id, await this.transmittalScope(user));
    if (!row) throw new NotFoundException("Planversand nicht gefunden.");
    return toTransmittalDetail(row);
  }

  async exportTransmittalRows(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseTransmittalList(query);
    const rows = await this.repo.listAllTransmittals(params, await this.transmittalScope(user));
    return rows.map((row) => {
      const t = toTransmittal(row);
      return {
        Nummer: t.number,
        Projekt: t.project?.number ?? "",
        Versandt: t.sentAt.slice(0, 10),
        Zweck: t.purpose,
        Weg: t.medium,
        Pläne: t.counts.items,
        Empfänger: t.counts.recipients,
        Durch: t.sentBy?.name ?? "",
      };
    });
  }

  /**
   * Issuing plans — **the act the module exists for**, and one transaction.
   *
   * The transmittal, its items, its recipients and the plans' new `ISSUED`
   * status are written together. Anything less would allow a state this system
   * must not be able to reach: plans marked as being in a contractor's hands
   * with no record of whose.
   *
   * The **warnings** come back beside the created record rather than refusing
   * it. Reissuing a revised plan is the normal case — refusing it would make
   * the correct action impossible — but the person still holding revision B
   * while C goes out is the one who builds the wrong thing, so they are named,
   * and `PriorRevisionSuperseded` is raised once per pairing for Notifications
   * to consume when module 9 arrives.
   */
  async createTransmittal(dto: CreateTransmittalDto, user: AuthUser) {
    // The project the Planversand is filed under must be in reach, answered
    // like a missing one otherwise (SEC-R7). The revisions are then checked
    // against the plan scope and against this project below.
    await this.requireProjectReach(dto.projectId, user);
    const scope = await this.scope(user);
    const revisionIds = dto.items.map((item) => item.drawingRevisionId);

    const revisions = await this.repo.findRevisionsForTransmittal(revisionIds, scope);
    if (revisions.length !== new Set(revisionIds).size) {
      // A 404 rather than a 403: whether a plan exists is itself information.
      throw new NotFoundException("Mindestens eine Revision gibt es nicht oder ist nicht sichtbar.");
    }

    const foreign = revisions.filter((r) => r.drawing.projectId !== dto.projectId);
    if (foreign.length) {
      throw new BadRequestException(
        `${foreign.map((r) => r.drawing.number).join(", ")}: gehört nicht zu diesem Projekt.`,
      );
    }

    const refusal = refuseTransmittal({
      revisions: revisions.map((r) => ({
        id: r.id,
        label: `${r.drawing.number} Rev. ${r.revision}`,
        releasedAt: r.releasedAt,
        supersededAt: r.supersededAt,
        drawingStatus: r.drawing.status,
      })),
      recipients: dto.recipients.map((r) => ({
        employeeId: r.employeeId ?? null,
        externalName: r.externalName ?? null,
      })),
    });
    if (refusal) throw new BadRequestException(refusal);

    const drawingIds = [...new Set(revisions.map((r) => r.drawingId))];
    const warnings = priorIssueWarnings({
      sending: revisions.map((r) => ({
        drawingId: r.drawingId,
        drawingNumber: r.drawing.number,
        revision: r.revision,
      })),
      alreadyIssued: await this.repo.alreadyIssuedFor(drawingIds),
    });

    const year = (dto.sentAt ? new Date(dto.sentAt) : new Date()).getFullYear();
    const number = formatTransmittalNumber(
      year,
      nextTransmittalSequence(await this.repo.transmittalNumbersIn(year), year),
    );

    const employeeId = await this.employeeId(user);

    // What each plan's `issuedRevision` becomes. Grouped by drawing rather than
    // mapped over `revisions`, because one Planversand may carry two revisions
    // of the same plan and only the newer of them is "what is out there".
    const issued = drawingIds.map((drawingId) => {
      const mine = revisions.filter((r) => r.drawingId === drawingId);
      return {
        drawingId,
        issuedRevision: nextIssuedRevision(
          mine[0]?.drawing.issuedRevision ?? null,
          mine.map((r) => r.revision),
        ),
      };
    });

    const row = await this.repo.transaction(async (tx) => {
      const created = await this.repo.createTransmittal(
        toTransmittalCreateData(dto, number, employeeId, user.id),
        dto.items.map((item) => ({
          drawingRevisionId: item.drawingRevisionId,
          copies: item.copies ?? 1,
          format: item.format ?? null,
        })),
        dto.recipients.map((recipient) => ({
          employeeId: recipient.employeeId ?? null,
          externalName: recipient.externalName?.trim() || null,
          externalOrg: recipient.externalOrg?.trim() || null,
          externalMail: recipient.externalMail?.trim() || null,
          role: recipient.role,
        })),
        tx,
      );

      await this.repo.markIssued(issued, user.id, tx);
      return created;
    });

    this.events.publish("TransmittalSent", {
      entity: "transmittal",
      entityId: row.id,
      payload: {
        projectId: dto.projectId,
        transmittalNumber: number,
        drawings: drawingIds.length,
        recipients: dto.recipients.length,
        purpose: row.purpose,
      },
      after: { number, drawings: drawingIds.length, recipients: dto.recipients.length },
    });

    for (const revision of revisions) {
      this.events.publish("DrawingIssued", {
        entity: "drawing",
        entityId: revision.drawingId,
        payload: {
          projectId: dto.projectId,
          number: revision.drawing.number,
          revision: revision.revision,
          transmittalId: row.id,
        },
      });
    }

    for (const warning of warnings) {
      this.events.publish("PriorRevisionSuperseded", {
        entity: "transmittal",
        entityId: row.id,
        payload: {
          projectId: dto.projectId,
          number: warning.drawingNumber,
          previousRevision: warning.previousRevision,
          newRevision: warning.newRevision,
          recipientLabel: warning.recipientLabel,
        },
      });
    }

    return { transmittal: toTransmittalDetail(row), warnings };
  }

  /**
   * Recording that a recipient confirmed receipt.
   *
   * Its own permission because the person recording it is usually not the
   * person who sent it, and its own act because `acknowledgedAt` being null is
   * *"not confirmed"* rather than *"did not receive"* — the same three-state
   * distinction `MeetingAttendee.attended` makes.
   */
  async acknowledge(transmittalId: string, dto: AcknowledgeDto, user: AuthUser) {
    const scope = await this.transmittalScope(user);
    const recipient = await this.repo.findRecipient(dto.recipientId, scope);

    if (!recipient || recipient.transmittal.id !== transmittalId) {
      throw new NotFoundException("Empfänger nicht gefunden.");
    }
    if (recipient.acknowledgedAt) {
      throw new BadRequestException("Der Empfang ist bereits bestätigt.");
    }

    await this.repo.acknowledge(
      dto.recipientId,
      dto.acknowledgedAt ? new Date(dto.acknowledgedAt) : new Date(),
    );

    const label = recipient.employee
      ? `${recipient.employee.firstName} ${recipient.employee.lastName}`
      : (recipient.externalName ?? "—");

    this.events.publish("TransmittalAcknowledged", {
      entity: "transmittal",
      entityId: transmittalId,
      payload: {
        projectId: recipient.transmittal.projectId,
        transmittalNumber: recipient.transmittal.number,
        recipientLabel: label,
      },
    });

    return this.transmittalDetail(transmittalId, user);
  }

  /* ================================================================ */
  /* Shared                                                            */
  /* ================================================================ */

  private present(row: Parameters<typeof toDrawingDetail>[0]) {
    return {
      ...toDrawingDetail(row),
      /**
       * Computed by the server and sent with the record, so the client's
       * dropdown cannot go stale. A second transition table on the client
       * would start offering something the API refuses, and the user would
       * find out by pressing the button.
       */
      allowedTransitions: transitionsFrom(row.status),
      /** Whether the plan may still be edited — past release it is published. */
      readOnly: !(
        row.status === DrawingStatus.WIP ||
        row.status === DrawingStatus.IN_CHECK ||
        row.status === DrawingStatus.CHECKED
      ),
    };
  }

  private async scope(user: AuthUser): Promise<DrawingScope> {
    if (seesAllDrawings(user)) return scopeFor(user, null);
    return scopeFor(user, await this.employeeId(user));
  }

  private async transmittalScope(user: AuthUser): Promise<TransmittalScope> {
    return transmittalScopeFor(user, await this.employeeId(user));
  }

  /** Refuses a project the caller cannot reach — the same 404 as a missing one. */
  private async requireProjectReach(projectId: string, user: AuthUser): Promise<void> {
    const scope = seesAllProjects(user)
      ? projectScopeFor(user, null)
      : projectScopeFor(user, await this.employeeId(user));
    if (!(await this.repo.projectReachable(projectId, scope))) {
      throw new NotFoundException(PROJECT_NOT_FOUND);
    }
  }

  private employeeId(user: AuthUser): Promise<string | null> {
    return this.repo.employeeIdForUser(user.id);
  }

  /** Fetch-or-404, with the caller's scope applied. Every write starts here. */
  private async require(id: string, user: AuthUser) {
    // The rule inputs, read through the caller's scope in one query: a plan
    // they cannot see and a plan that does not exist are the same 404, because
    // whether a plan exists is itself information.
    const row = await this.repo.findForRules(id, await this.scope(user));
    if (!row) throw new NotFoundException("Plan nicht gefunden.");
    return row;
  }

  /**
   * Tells a stale write from an invisible one by re-reading.
   *
   * **409 and 404 are different answers and both are needed.** A stale write is
   * a conflict; a write to a plan the caller cannot see is a 404, because
   * whether it exists is itself information.
   */
  private async refuseStale(id: string, expected: number, user: AuthUser): Promise<never> {
    const now = await this.repo.findDetail(id, await this.scope(user));
    if (!now) throw new NotFoundException("Plan nicht gefunden.");

    throw new ConflictException(
      `${now.number} steht inzwischen auf Version ${now.version}; gespeichert wurde gegen ${expected}. ` +
        "Bitte neu laden — die Änderungen von jemand anderem würden sonst überschrieben.",
    );
  }

  /**
   * `(projectId, number)` is unique, and the clash has a sentence of its own.
   *
   * Prisma reports P2002, which reaches a user as "Unique constraint failed on
   * the fields: (`projectId`,`number`)" if nothing intercepts it. The plan
   * number is the one field somebody will collide on, because it is typed from
   * a printout.
   */
  private translateUnique(error: unknown, number: string): unknown {
    const code = (error as { code?: string } | null)?.code;
    if (code === "P2002") {
      return new ConflictException(`Die Plannummer „${number}“ gibt es auf diesem Projekt bereits.`);
    }
    return error;
  }
}
