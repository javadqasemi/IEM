import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DecisionStatus, MeetingItemKind, MeetingStatus } from "@prisma/client";
import { EventBus } from "../core/events/event-bus";
import { VersioningService } from "../core/versioning/versioning.service";
import { VERSION_CONTROL_FIELDS, changedFields } from "../core/versioning/changed";
import type { AuthUser } from "../common/decorators";
import type { RawListQuery } from "../core/list/list.decorator";
import { paginated } from "../core/list/list";
// The **pure** position helper from the tasks module, not its service.
//
// `architecture.test.ts` forbids a feature importing a sibling's `*.service`,
// and correctly: a service carries a transaction, an event bus and a
// permission model, and reaching into one is how two modules become one.
// `tasks.rules.ts` carries none of that — it is a file of pure functions over
// plain values, the server-side equivalent of `entities/` on the client, and
// importing `nextPosition` from it is the same kind of borrowing as importing
// an enum. The alternative is a second, slightly different copy of the board's
// gap arithmetic living here, which is exactly the drift the rules files exist
// to prevent.
import { nextPosition } from "../tasks/tasks.rules";
import { MeetingsRepository, type PrismaTx } from "./meetings.repository";
import { decisionScopeFor, scopeFor, seesAllDecisions, seesAllMeetings } from "./meetings.scope";
import {
  toDate,
  toDecisionAuditSnapshot,
  toDecisionCreateData,
  toDecisionDetail,
  toDecisionExportRow,
  toDecisionListItem,
  toDecisionUpdateData,
  toMeetingAuditSnapshot,
  toMeetingCreateData,
  toMeetingDetail,
  toMeetingExportRow,
  toMeetingListItem,
  toMeetingUpdateData,
  toMoneyNumber,
} from "./meetings.mapper";
import {
  formatDecisionNumber,
  itemKey,
  nextDecisionSequence,
  nextSeriesNumber,
  refuseApproval,
  refuseApprovalTiming,
  refuseDecision,
  refuseDecisionDate,
  refuseDecisionStatus,
  refuseItem,
  refuseProtocolEdit,
  refuseSupersede,
  refuseTimes,
  refuseTransition,
  transitionsFrom,
  wouldSupersedeCycle,
} from "./meetings.rules";
import type {
  AddAgendaItemDto,
  AddAttendeeDto,
  AddMeetingItemDto,
  ApproveMinutesDto,
  BulkItemsDto,
  ChangeDecisionStatusDto,
  ChangeMeetingStatusDto,
  CreateDecisionDto,
  CreateMeetingDto,
  RecordAttendanceDto,
  ReorderItemsDto,
  SupersedeDecisionDto,
  UpdateAgendaItemDto,
  UpdateDecisionDto,
  UpdateMeetingDto,
  UpdateMeetingItemDto,
} from "./meetings.dto";

/**
 * Orchestration: rules, transactions and events. **No queries, no Prisma.**
 *
 * Two aggregates, one service, for the reason `meetings.repository.ts` gives:
 * a decision is taken *at* a meeting and a protocol line *is* the citation, so
 * the interesting writes touch both.
 *
 * ---
 *
 * **What makes this module different from the two before it.** Projects and
 * Tasks both own records people edit. This one owns a **record of what was
 * agreed**, and that changes one rule fundamentally: once minutes are approved
 * they are closed, and the way to change them is to approve an amendment at the
 * next meeting. `refuseProtocolEdit` is checked on every protocol write, and it
 * does not consult permissions — somebody with `meeting.update` still cannot
 * edit an approved protocol, because the rule protects the record rather than
 * ranking the people.
 */
@Injectable()
export class MeetingsService {
  constructor(
    private readonly repo: MeetingsRepository,
    private readonly events: EventBus,
    private readonly versions: VersioningService,
  ) {}

  /* ================================================================ */
  /* Meetings — reads                                                  */
  /* ================================================================ */

  async list(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseList(query);
    const { items, total } = await this.repo.list(params, await this.scope(user));
    return paginated(items.map(toMeetingListItem), total, params);
  }

  async exportRows(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseList(query);
    const rows = await this.repo.listAll(params, await this.scope(user));
    return rows.map(toMeetingExportRow);
  }

  async detail(id: string, user: AuthUser) {
    const row = await this.repo.findDetail(id, await this.scope(user));
    if (!row) throw new NotFoundException("Sitzung nicht gefunden.");
    return {
      ...toMeetingDetail(row),
      allowedTransitions: transitionsFrom(row.status),
      /**
       * Whether the protocol is closed, sent with the record.
       *
       * So the editor is read-only before the user types rather than after
       * they press save. The server refuses either way — `refuseProtocolEdit`
       * is on every write path — and this is the courtesy that stops somebody
       * writing a paragraph into a field that will not take it.
       */
      protocolLocked:
        refuseProtocolEdit({ status: row.status, approvals: row.approvals }) !== null,
    };
  }

  async stats(user: AuthUser) {
    const scope = await this.scope(user);
    const [rows, minutesPending] = await Promise.all([
      this.repo.countByStatus(scope),
      this.repo.countMinutesPending(scope),
    ]);
    const byStatus: Record<string, number> = {};
    for (const row of rows) byStatus[row.status] = row._count._all;
    return {
      byStatus,
      total: rows.reduce((sum, row) => sum + row._count._all, 0),
      /** Held, minutes not sent. The one figure somebody acts on. */
      minutesPending,
    };
  }

  /**
   * Protocol lines across every meeting the caller may see.
   *
   * *"Alle offenen Pendenzen für Lüftung über alle Bausitzungen"* —
   * `data-model.md` §3.11 names this query, and it is the reason `disciplineId`
   * sits on the line.
   */
  async listItems(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseItemList(query);
    const { items, total } = await this.repo.listItems(params, await this.scope(user));
    return paginated(
      items.map((item) => ({
        id: item.id,
        order: item.order,
        key: itemKey(item.meeting.seriesNumber, item.order),
        text: item.text,
        kind: item.kind,
        dueDate: item.dueDate?.toISOString() ?? null,
        responsible: item.responsible && {
          id: item.responsible.id,
          name: `${item.responsible.firstName} ${item.responsible.lastName}`,
          email: item.responsible.email,
        },
        discipline: item.discipline && {
          id: item.discipline.id,
          code: item.discipline.code,
          name: item.discipline.name,
          colour: item.discipline.defaultColour,
        },
        task: item.task && {
          id: item.task.id,
          title: item.task.title,
          status: item.task.status,
          dueDate: item.task.dueDate?.toISOString() ?? null,
        },
        decision: item.decision && { ...item.decision },
        meeting: {
          id: item.meeting.id,
          title: item.meeting.title,
          seriesNumber: item.meeting.seriesNumber,
          startsAt: item.meeting.startsAt.toISOString(),
        },
      })),
      total,
      params,
    );
  }

  /* ================================================================ */
  /* Meetings — writes                                                 */
  /* ================================================================ */

  async create(dto: CreateMeetingDto, user: AuthUser) {
    const startsAt = toDate(dto.startsAt)!;
    const timeError = refuseTimes(startsAt, toDate(dto.endsAt));
    if (timeError) throw new BadRequestException(timeError);

    const missing = await this.repo.missingReferences(dto);
    if (missing.length) throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);

    /*
      The series number, allocated from the maximum already issued.

      The same race `ProjectsService.create` names: two creates in the same
      millisecond can read the same maximum. There is no unique constraint on
      `(projectId, type, seriesNumber)` to catch it, and deliberately not — a
      series legitimately has gaps and duplicates when a meeting is entered
      retrospectively at its real number. Two Bausitzungen 14 is a visible,
      correctable data error; a constraint would make entering historical
      minutes impossible.
    */
    const type = dto.type ?? "BAUSITZUNG";
    const seriesNumber =
      dto.seriesNumber ??
      nextSeriesNumber(await this.repo.seriesNumbersFor(dto.projectId ?? null, type));

    const row = await this.repo.create(
      toMeetingCreateData(
        { ...dto, type, projectId: dto.projectId ?? null, seriesNumber },
        user.id,
      ),
    );

    this.events.publish("MeetingScheduled", {
      entity: "meeting",
      entityId: row.id,
      payload: {
        projectId: row.projectId,
        title: row.title,
        type: row.type,
        startsAt: row.startsAt.toISOString(),
      },
      after: toMeetingAuditSnapshot(row),
    });

    return this.presentDetail(row);
  }

  async update(id: string, dto: UpdateMeetingDto, user: AuthUser) {
    const current = await this.require(id, user);
    this.refuseWhenClosed(current);

    const startsAt = dto.startsAt === undefined ? current.startsAt : toDate(dto.startsAt)!;
    const endsAt = dto.endsAt === undefined ? null : toDate(dto.endsAt);
    const timeError = refuseTimes(startsAt, endsAt);
    if (timeError) throw new BadRequestException(timeError);

    const missing = await this.repo.missingReferences(dto);
    if (missing.length) throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);

    const before = toMeetingAuditSnapshot(current);
    const fields = changedFields(dto, VERSION_CONTROL_FIELDS);

    const row = await this.repo.transaction(async (tx) => {
      const changed = await this.repo.updateIfUnchanged(
        id,
        dto.expectedVersion,
        toMeetingUpdateData(dto, user.id),
        tx,
      );
      if (changed === 0) await this.refuseStale(id, dto.expectedVersion);

      const updated = await this.repo.findDetail(id, {}, tx);
      if (!updated) throw new NotFoundException("Sitzung nicht gefunden.");

      await this.versions.record(tx, {
        entity: "meeting",
        entityId: id,
        version: dto.expectedVersion + 1,
        data: toMeetingDetail(updated),
        changed: fields,
        note: dto.versionNote ?? null,
      });

      return updated;
    });

    this.events.publish("MeetingUpdated", {
      entity: "meeting",
      entityId: id,
      payload: { title: row.title, fields },
      before,
      after: toMeetingAuditSnapshot(row),
    });

    return this.detail(id, user);
  }

  /**
   * Holding or cancelling — one route, because they are one act.
   *
   * `meeting.hold` rather than `meeting.update`: marking a Bausitzung held is
   * what turns a plan into a record, and somebody who may fix a typo in an
   * agenda is not necessarily somebody who may declare that a meeting took
   * place.
   */
  async changeStatus(id: string, dto: ChangeMeetingStatusDto, user: AuthUser) {
    const current = await this.require(id, user);

    const refusal = refuseTransition(current.status, dto.status, {
      items: current.items,
      attendees: current.attendees,
    });
    if (refusal) throw new BadRequestException(refusal);
    if (current.status === dto.status) return this.detail(id, user);

    await this.repo.update(id, { status: dto.status, updatedById: user.id });

    if (dto.status === MeetingStatus.HELD) {
      this.events.publish("MeetingHeld", {
        entity: "meeting",
        entityId: id,
        payload: {
          projectId: current.projectId,
          type: current.type,
          seriesNumber: current.seriesNumber,
          // On the payload so a listener does not have to load the protocol to
          // say "aus Bausitzung 14 sind 6 Pendenzen entstanden".
          pendenzen: current.items.filter((i) => i.kind === MeetingItemKind.PENDENZ).length,
        },
        before: { status: current.status },
        after: { status: dto.status },
      });
    } else {
      this.events.publish("MeetingCancelled", {
        entity: "meeting",
        entityId: id,
        payload: { projectId: current.projectId, title: current.title, reason: dto.reason },
        before: { status: current.status },
        after: { status: dto.status },
        message: dto.reason,
      });
    }

    return this.detail(id, user);
  }

  async remove(id: string, user: AuthUser) {
    const current = await this.require(id, user);

    /*
      An approved protocol is not deletable, by anybody.

      The record of what was agreed is the one thing in this module that is not
      the firm's to remove once it has been accepted — and unlike the edit rule,
      there is no amendment path that makes deletion safe. Cancel the meeting
      instead: that leaves the fact on the record, which is the point.
    */
    if (current.approvals.length) {
      throw new BadRequestException(
        "Ein genehmigtes Protokoll kann nicht gelöscht werden. Die Sitzung kann abgesagt werden.",
      );
    }

    await this.repo.softDelete(id, new Date());

    this.events.publish("MeetingDeleted", {
      entity: "meeting",
      entityId: id,
      payload: { projectId: current.projectId, title: current.title },
      before: toMeetingAuditSnapshot(current),
    });

    return { ok: true };
  }

  /* ================================================================ */
  /* Attendees                                                         */
  /* ================================================================ */

  async addAttendee(meetingId: string, dto: AddAttendeeDto, user: AuthUser) {
    const meeting = await this.require(meetingId, user);
    this.refuseWhenClosed(meeting);

    /*
      Exactly one of the two, checked here rather than in the DTO.

      class-validator can express it with `@ValidateIf`, and doing so would put
      half of "what an attendee is" in the DTO and half in the domain. It is
      also the rule that changes when `Contact` lands in Wave 3, and one place
      is easier to change than two.
    */
    const internal = Boolean(dto.employeeId);
    const external = Boolean(dto.externalName?.trim());
    if (internal === external) {
      throw new BadRequestException(
        "Eine teilnehmende Person ist entweder aus dem Haus oder extern — bitte genau eines angeben.",
      );
    }

    if (dto.employeeId) {
      const missing = await this.repo.missingReferences({ employeeId: dto.employeeId });
      if (missing.length) throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);
    }

    await this.repo.addAttendee({
      meetingId,
      employeeId: dto.employeeId ?? null,
      externalName: dto.externalName?.trim() ?? null,
      externalOrg: dto.externalOrg?.trim() ?? null,
      required: dto.required ?? true,
      invitedAt: toDate(dto.invitedAt),
    });

    return this.detail(meetingId, user);
  }

  async removeAttendee(meetingId: string, attendeeId: string, user: AuthUser) {
    const meeting = await this.require(meetingId, user);
    this.refuseWhenClosed(meeting);

    const attendee = await this.repo.findAttendee(attendeeId);
    // The nested route's parent checked against its child — without this,
    // `/meetings/<mine>/attendees/<somebody-else's>` works.
    if (!attendee || attendee.meetingId !== meetingId) {
      throw new NotFoundException("Teilnehmende Person nicht gefunden.");
    }

    await this.repo.removeAttendee(attendeeId, new Date());
    return this.detail(meetingId, user);
  }

  /**
   * Who turned up, for the whole room in one request.
   *
   * Attendance is entered once while writing the protocol; twelve requests for
   * one act would also make twelve audit rows out of one fact.
   */
  async recordAttendance(meetingId: string, dto: RecordAttendanceDto, user: AuthUser) {
    const meeting = await this.require(meetingId, user);
    this.refuseWhenClosed(meeting);

    const known = new Set(meeting.attendees.map((a) => a.id));
    const stranger = dto.attendance.find((entry) => !known.has(entry.attendeeId));
    if (stranger) {
      throw new BadRequestException("Eine der Personen gehört nicht zu dieser Sitzung.");
    }

    await this.repo.recordAttendance(
      dto.attendance.map((entry) => ({
        id: entry.attendeeId,
        attended: entry.attended ?? null,
        apologised: entry.apologised,
      })),
    );

    return this.detail(meetingId, user);
  }

  /* ================================================================ */
  /* Agenda                                                            */
  /* ================================================================ */

  async addAgendaItem(meetingId: string, dto: AddAgendaItemDto, user: AuthUser) {
    const meeting = await this.require(meetingId, user);
    this.refuseWhenClosed(meeting);

    if (dto.presenterId) {
      const missing = await this.repo.missingReferences({ employeeId: dto.presenterId });
      if (missing.length) throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);
    }

    await this.repo.addAgendaItem({
      meetingId,
      order: await this.repo.nextAgendaOrder(meetingId),
      title: dto.title.trim(),
      note: dto.note?.trim() ?? null,
      presenterId: dto.presenterId ?? null,
      durationMinutes: dto.durationMinutes ?? null,
    });

    return this.detail(meetingId, user);
  }

  async updateAgendaItem(
    meetingId: string,
    itemId: string,
    dto: UpdateAgendaItemDto,
    user: AuthUser,
  ) {
    const meeting = await this.require(meetingId, user);
    this.refuseWhenClosed(meeting);

    const item = await this.repo.findAgendaItem(itemId);
    if (!item || item.meetingId !== meetingId) {
      throw new NotFoundException("Traktandum nicht gefunden.");
    }

    await this.repo.updateAgendaItem(itemId, {
      title: dto.title?.trim(),
      note: dto.note === undefined ? undefined : (dto.note?.trim() ?? null),
      presenterId: dto.presenterId,
      durationMinutes: dto.durationMinutes,
    });

    return this.detail(meetingId, user);
  }

  async removeAgendaItem(meetingId: string, itemId: string, user: AuthUser) {
    const meeting = await this.require(meetingId, user);
    this.refuseWhenClosed(meeting);

    const item = await this.repo.findAgendaItem(itemId);
    if (!item || item.meetingId !== meetingId) {
      throw new NotFoundException("Traktandum nicht gefunden.");
    }

    await this.repo.removeAgendaItem(itemId, new Date());
    return this.detail(meetingId, user);
  }

  /* ================================================================ */
  /* The protocol                                                      */
  /* ================================================================ */

  /**
   * A protocol line — and, when it is a Pendenz, the task it becomes.
   *
   * **This is the seam the whole wave order was built around.** Tasks was built
   * before Meetings so that a `PENDENZ` has somewhere to go: the line and the
   * task are written in one transaction, so a protocol can never record work
   * that was never created, and the task carries the line's responsible person,
   * date and Gewerk.
   */
  async addItem(meetingId: string, dto: AddMeetingItemDto, user: AuthUser) {
    const meeting = await this.require(meetingId, user);
    this.refuseWhenClosed(meeting);

    const kind = dto.kind ?? MeetingItemKind.INFORMATION;
    const dueDate = toDate(dto.dueDate);

    const refusal = refuseItem({
      kind,
      text: dto.text,
      responsibleId: dto.responsibleId ?? null,
      dueDate,
      decisionId: dto.decisionId ?? null,
    });
    if (refusal) throw new BadRequestException(refusal);

    const missing = await this.repo.missingReferences({
      employeeId: dto.responsibleId,
      disciplineId: dto.disciplineId,
    });
    if (missing.length) throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);

    await this.refuseForeignDecision(dto.decisionId ?? null, meetingId);

    const createTask = kind === MeetingItemKind.PENDENZ && dto.createTask !== false && !dto.taskId;

    const { item, taskId } = await this.repo.transaction(async (tx) => {
      const order = await this.repo.nextItemOrder(meetingId, tx);

      let taskId = dto.taskId ?? null;
      if (createTask) {
        const created = await this.createTaskForPendenz(tx, {
          text: dto.text,
          projectId: meeting.projectId,
          responsibleId: dto.responsibleId!,
          dueDate: dueDate!,
          disciplineId: dto.disciplineId ?? null,
          userId: user.id,
        });
        taskId = created;
      }

      const item = await this.repo.addItem(
        {
          meetingId,
          order,
          text: dto.text.trim(),
          kind,
          agendaItemId: dto.agendaItemId ?? null,
          responsibleId: dto.responsibleId ?? null,
          dueDate,
          disciplineId: dto.disciplineId ?? null,
          decisionId: dto.decisionId ?? null,
          taskId,
        },
        tx,
      );

      return { item, taskId };
    });

    if (createTask && taskId) {
      this.events.publish("MeetingItemToTask", {
        entity: "meeting_item",
        entityId: item.id,
        payload: {
          meetingId,
          itemKey: itemKey(meeting.seriesNumber, item.order),
          taskId,
        },
      });
    }

    return this.detail(meetingId, user);
  }

  async updateItem(
    meetingId: string,
    itemId: string,
    dto: UpdateMeetingItemDto,
    user: AuthUser,
  ) {
    const meeting = await this.require(meetingId, user);
    this.refuseWhenClosed(meeting);

    const item = await this.repo.findItem(itemId);
    if (!item || item.meetingId !== meetingId) {
      throw new NotFoundException("Protokollzeile nicht gefunden.");
    }

    // The *resulting* line, not the submitted fields: a body that changes only
    // the kind has to be checked against the responsible person already stored.
    const kind = dto.kind ?? item.kind;
    const responsibleId =
      dto.responsibleId === undefined ? item.responsibleId : dto.responsibleId;
    const dueDate = dto.dueDate === undefined ? item.dueDate : toDate(dto.dueDate);
    const decisionId = dto.decisionId === undefined ? item.decisionId : dto.decisionId;

    const refusal = refuseItem({
      kind,
      text: dto.text ?? item.text,
      responsibleId,
      dueDate,
      decisionId,
    });
    if (refusal) throw new BadRequestException(refusal);

    const missing = await this.repo.missingReferences({
      employeeId: dto.responsibleId ?? undefined,
      disciplineId: dto.disciplineId ?? undefined,
    });
    if (missing.length) throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);

    await this.refuseForeignDecision(decisionId, meetingId);

    await this.repo.updateItem(itemId, {
      text: dto.text?.trim(),
      kind: dto.kind,
      agendaItemId: dto.agendaItemId,
      responsibleId: dto.responsibleId,
      dueDate: dto.dueDate === undefined ? undefined : dueDate,
      disciplineId: dto.disciplineId,
      decisionId: dto.decisionId,
    });

    return this.detail(meetingId, user);
  }

  async removeItem(meetingId: string, itemId: string, user: AuthUser) {
    const meeting = await this.require(meetingId, user);
    this.refuseWhenClosed(meeting);

    const item = await this.repo.findItem(itemId);
    if (!item || item.meetingId !== meetingId) {
      throw new NotFoundException("Protokollzeile nicht gefunden.");
    }

    /*
      The line goes; the task it created stays.

      Deleting a protocol line is a correction to the record of what was said.
      The work it produced is on somebody's board, may be half done, and is not
      this module's to withdraw — `MeetingItem.taskId` is `SetNull` at the
      database for the same reason.
    */
    await this.repo.removeItem(itemId, new Date());
    return this.detail(meetingId, user);
  }

  async reorderItems(meetingId: string, dto: ReorderItemsDto, user: AuthUser) {
    const meeting = await this.require(meetingId, user);
    this.refuseWhenClosed(meeting);

    const known = new Set(meeting.items.map((i) => i.id));
    if (dto.order.length !== known.size || dto.order.some((id) => !known.has(id))) {
      /*
        The whole protocol or nothing.

        A partial order would leave the omitted lines at numbers the reordered
        ones now occupy, and `@@unique([meetingId, order])` would refuse it
        halfway — leaving the protocol renumbered to a state nobody asked for.
      */
      throw new BadRequestException(
        "Die Reihenfolge muss genau die Zeilen dieses Protokolls enthalten.",
      );
    }

    await this.repo.reorderItems(dto.order);
    return this.detail(meetingId, user);
  }

  async bulkItems(dto: BulkItemsDto, user: AuthUser) {
    if (dto.disciplineId === undefined) {
      throw new BadRequestException("Es ist keine Änderung angegeben.");
    }
    if (dto.disciplineId) {
      const missing = await this.repo.missingReferences({ disciplineId: dto.disciplineId });
      if (missing.length) throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);
    }

    /*
      Every line is checked against the caller's scope and its meeting's lock
      before anything is written.

      A bulk action that wrote first and filtered afterwards would be the one
      place in the module where an approved protocol could be edited — and it
      would be the least visible.
    */
    const scope = await this.scope(user);
    const allowed: string[] = [];
    for (const id of dto.ids) {
      const item = await this.repo.findItem(id);
      if (!item) continue;
      const meeting = await this.repo.findDetail(item.meetingId, scope);
      if (!meeting) continue;
      if (refuseProtocolEdit({ status: meeting.status, approvals: meeting.approvals })) continue;
      allowed.push(id);
    }

    if (allowed.length) await this.repo.bulkDiscipline(allowed, dto.disciplineId);
    return { changed: allowed.length, requested: dto.ids.length };
  }

  /* ================================================================ */
  /* Approval and minutes                                              */
  /* ================================================================ */

  /**
   * Approving the minutes — the act that closes the record.
   *
   * `meeting.approve`, and it is not "may edit more": it is "may decide that
   * this is what was said". After it, `refuseProtocolEdit` closes the protocol
   * to everybody regardless of what they hold.
   */
  async approve(id: string, dto: ApproveMinutesDto, user: AuthUser) {
    const current = await this.require(id, user);

    const timing = refuseApprovalTiming({ status: current.status, approvals: current.approvals });
    if (timing) throw new BadRequestException(timing);

    const refusal = refuseApproval(dto.decision, dto.note ?? null);
    if (refusal) throw new BadRequestException(refusal);

    await this.repo.addApproval({
      meetingId: id,
      decision: dto.decision,
      note: dto.note?.trim() ?? null,
      decidedById: await this.employeeId(user),
    });

    this.events.publish("MeetingApproved", {
      entity: "meeting",
      entityId: id,
      payload: { meetingId: id, decision: dto.decision, note: dto.note?.trim() ?? null },
      message: dto.note,
    });

    return this.detail(id, user);
  }

  /**
   * Marking the minutes as sent.
   *
   * Stamped by the act, never typed. The *sending* is not here: an e-mail with
   * a PDF attached needs both the Documents module and `pdf.render`, and both
   * are later in the wave. What this records is the fact somebody needs on a
   * Friday — which protocols have gone out and which have not — and it is
   * useful on its own, which is why it ships rather than waiting.
   */
  async sendMinutes(id: string, user: AuthUser) {
    const current = await this.require(id, user);

    if (current.status !== MeetingStatus.HELD) {
      throw new BadRequestException(
        "Nur das Protokoll einer durchgeführten Sitzung kann versandt werden.",
      );
    }
    if (current.minutesSentAt) {
      throw new BadRequestException("Dieses Protokoll wurde bereits versandt.");
    }

    await this.repo.update(id, { minutesSentAt: new Date(), updatedById: user.id });

    this.events.publish("MinutesSent", {
      entity: "meeting",
      entityId: id,
      payload: {
        meetingId: id,
        projectId: current.projectId,
        recipients: current.attendees.length,
      },
    });

    return this.detail(id, user);
  }

  /* ================================================================ */
  /* Decisions                                                         */
  /* ================================================================ */

  async listDecisions(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseDecisionList(query);
    const { items, total } = await this.repo.listDecisions(params, await this.decisionScope(user));
    return paginated(items.map(toDecisionListItem), total, params);
  }

  async exportDecisionRows(query: RawListQuery, user: AuthUser) {
    const params = this.repo.parseDecisionList(query);
    const rows = await this.repo.listAllDecisions(params, await this.decisionScope(user));
    return rows.map(toDecisionExportRow);
  }

  async decisionStats(user: AuthUser) {
    const rows = await this.repo.countDecisionsByStatus(await this.decisionScope(user));
    const byStatus: Record<string, number> = {};
    for (const row of rows) byStatus[row.status] = row._count._all;
    return { byStatus, total: rows.reduce((sum, row) => sum + row._count._all, 0) };
  }

  async decision(id: string, user: AuthUser) {
    const row = await this.repo.findDecision(id, await this.decisionScope(user));
    if (!row) throw new NotFoundException("Entscheid nicht gefunden.");
    return toDecisionDetail(row);
  }

  async createDecision(dto: CreateDecisionDto, user: AuthUser) {
    const refusal = refuseDecision({
      title: dto.title,
      rationale: dto.rationale,
      impact: dto.impact ?? "KEINE",
      costImpact: toMoneyNumber(dto.costImpact, "Kostenfolge"),
    });
    if (refusal) throw new BadRequestException(refusal);

    const missing = await this.repo.missingReferences({
      projectId: dto.projectId,
      employeeId: dto.decidedById,
      disciplineId: dto.disciplineId,
      meetingId: dto.meetingId,
    });
    if (missing.length) throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);

    const decidedAt = toDate(dto.decidedAt)!;
    if (dto.meetingId) {
      const meeting = await this.repo.meetingContext(dto.meetingId);
      /*
        A decision recorded at a meeting belongs to that meeting's project.

        Neither is a foreign key the database can check, and the failure is
        silent: a decision filed under Guglera and minuted at an Aarefeld
        Bausitzung appears in one project's history and is cited from the
        other's.
      */
      if (meeting && meeting.projectId !== dto.projectId) {
        throw new BadRequestException(
          "Die Sitzung gehört zu einem anderen Projekt als der Entscheid.",
        );
      }
      const dateError = refuseDecisionDate(decidedAt, meeting?.startsAt ?? null);
      if (dateError) throw new BadRequestException(dateError);
    }

    const year = decidedAt.getFullYear();
    const numbers = await this.repo.decisionNumbersFor(dto.projectId);
    const number = formatDecisionNumber(year, nextDecisionSequence(numbers, year));

    const row = await this.repo.createDecision(
      toDecisionCreateData(
        {
          ...dto,
          number,
          type: dto.type ?? "TECHNISCH",
          status: dto.status ?? "ENTSCHIEDEN",
          impact: dto.impact ?? "KEINE",
        },
        user.id,
      ),
    );

    this.events.publish("DecisionTaken", {
      entity: "decision",
      entityId: row.id,
      payload: {
        projectId: row.projectId,
        number: row.number,
        type: row.type,
        impact: row.impact,
      },
      after: toDecisionAuditSnapshot(row),
    });

    return toDecisionDetail(row);
  }

  async updateDecision(id: string, dto: UpdateDecisionDto, user: AuthUser) {
    const current = await this.requireDecision(id, user);

    if (current.status === DecisionStatus.AUFGEHOBEN) {
      throw new ForbiddenException("Ein aufgehobener Entscheid ist schreibgeschützt.");
    }

    const refusal = refuseDecision({
      title: dto.title ?? current.title,
      rationale: dto.rationale ?? current.rationale,
      impact: dto.impact ?? current.impact,
      costImpact:
        dto.costImpact === undefined ? null : toMoneyNumber(dto.costImpact, "Kostenfolge"),
    });
    if (refusal) throw new BadRequestException(refusal);

    const missing = await this.repo.missingReferences({
      employeeId: dto.decidedById ?? undefined,
      disciplineId: dto.disciplineId ?? undefined,
    });
    if (missing.length) throw new BadRequestException(`Unbekannt: ${missing.join(", ")}.`);

    const before = toDecisionAuditSnapshot(current);
    const fields = changedFields(dto, VERSION_CONTROL_FIELDS);

    const row = await this.repo.transaction(async (tx) => {
      const changed = await this.repo.updateDecisionIfUnchanged(
        id,
        dto.expectedVersion,
        toDecisionUpdateData(dto, user.id),
        tx,
      );
      if (changed === 0) await this.refuseStaleDecision(id, dto.expectedVersion);

      const updated = await this.repo.findDecision(id, {}, tx);
      if (!updated) throw new NotFoundException("Entscheid nicht gefunden.");

      await this.versions.record(tx, {
        entity: "decision",
        entityId: id,
        version: dto.expectedVersion + 1,
        data: toDecisionDetail(updated),
        changed: fields,
        note: dto.versionNote ?? null,
      });

      return updated;
    });

    this.events.publish("DecisionUpdated", {
      entity: "decision",
      entityId: id,
      payload: { projectId: row.projectId, number: row.number, fields },
      before,
      after: toDecisionAuditSnapshot(row),
    });

    return toDecisionDetail(row);
  }

  async changeDecisionStatus(id: string, dto: ChangeDecisionStatusDto, user: AuthUser) {
    const current = await this.requireDecision(id, user);

    const refusal = refuseDecisionStatus(current.status, dto.status);
    if (refusal) throw new BadRequestException(refusal);
    if (current.status === dto.status) return this.decision(id, user);

    await this.repo.updateDecision(id, { status: dto.status, updatedById: user.id });

    this.events.publish("DecisionStatusChanged", {
      entity: "decision",
      entityId: id,
      payload: {
        projectId: current.projectId,
        number: current.number,
        from: current.status,
        to: dto.status,
      },
      before: { status: current.status },
      after: { status: dto.status },
      message: dto.reason,
    });

    return this.decision(id, user);
  }

  /**
   * Reversing a decision, by naming it from the one that replaces it.
   *
   * **The arrow points from the new decision to the old one**, which is what
   * makes `AUFGEHOBEN` a verifiable fact rather than a claim: a decision may
   * only reach that status through this method, and this method always leaves a
   * successor attached. `refuseDecisionStatus` refuses it as a direct
   * transition for exactly that reason.
   *
   * `decision.supersede` and not `decision.update` — `docs/permissions.md`
   * §3.11: *"`update` is corrections; reversing a decision is its own
   * authority."*
   */
  async supersede(id: string, dto: SupersedeDecisionDto, user: AuthUser) {
    const replacement = await this.requireDecision(id, user);
    const target = await this.repo.findDecisionForRules(dto.supersedesId);
    if (!target) throw new BadRequestException("Den zu ersetzenden Entscheid gibt es nicht.");

    const refusal = refuseSupersede({
      newProjectId: replacement.projectId,
      targetProjectId: target.projectId,
      targetStatus: target.status,
    });
    if (refusal) throw new BadRequestException(refusal);

    const edges = await this.repo.supersedesForProject(replacement.projectId);
    if (wouldSupersedeCycle(edges, id, dto.supersedesId)) {
      throw new BadRequestException(
        "Das würde einen Kreis ergeben — dann wäre kein Entscheid der aktuelle.",
      );
    }

    /*
      Both writes in one transaction.

      A reversal that set `supersedesId` and failed before `AUFGEHOBEN` would
      leave two decisions both reading as current, which is the one state this
      whole mechanism exists to prevent.
    */
    await this.repo.transaction(async (tx) => {
      await this.repo.updateDecision(id, { supersedesId: dto.supersedesId, updatedById: user.id }, tx);
      await this.repo.updateDecision(
        dto.supersedesId,
        { status: DecisionStatus.AUFGEHOBEN, updatedById: user.id },
        tx,
      );
    });

    this.events.publish("DecisionSuperseded", {
      entity: "decision",
      entityId: dto.supersedesId,
      payload: {
        projectId: target.projectId,
        number: target.number,
        bySupersedingId: id,
      },
      before: { status: target.status },
      after: { status: DecisionStatus.AUFGEHOBEN },
    });

    return this.decision(id, user);
  }

  async removeDecision(id: string, user: AuthUser) {
    const current = await this.requireDecision(id, user);

    if (current.supersedesId) {
      throw new BadRequestException(
        "Dieser Entscheid hebt einen anderen auf. Löschen würde den aufgehobenen ohne Nachfolger zurücklassen.",
      );
    }

    await this.repo.softDeleteDecision(id, new Date());
    return { ok: true };
  }

  /* ================================================================ */
  /* Version history                                                   */
  /* ================================================================ */

  async history(id: string, user: AuthUser) {
    await this.require(id, user);
    return this.versions.history("meeting", id);
  }

  async versionAt(id: string, version: number, user: AuthUser) {
    await this.require(id, user);
    const row = await this.versions.at("meeting", id, version);
    if (!row) throw new NotFoundException(`Version v${version} gibt es nicht.`);
    return row;
  }

  async decisionHistory(id: string, user: AuthUser) {
    await this.requireDecision(id, user);
    return this.versions.history("decision", id);
  }

  /* ================================================================ */
  /* Shared                                                            */
  /* ================================================================ */

  private async scope(user: AuthUser) {
    if (seesAllMeetings(user)) return {};
    return scopeFor(user, await this.employeeId(user), user.id);
  }

  private async decisionScope(user: AuthUser) {
    if (seesAllDecisions(user)) return {};
    return decisionScopeFor(user, await this.employeeId(user));
  }

  private employeeId(user: AuthUser): Promise<string | null> {
    return this.repo.employeeIdForUser(user.id);
  }

  /** Fetch-or-404, with the caller's scope applied. Every write starts here. */
  private async require(id: string, user: AuthUser) {
    const meeting = await this.repo.findForRules(id);
    if (!meeting) throw new NotFoundException("Sitzung nicht gefunden.");

    // Re-applied by hand, because `findForRules` deliberately takes no scope —
    // its job is the rule inputs, and a rule check must see the real row. A 404
    // rather than a 403: whether a meeting exists is itself information.
    if (!seesAllMeetings(user)) {
      const visible = await this.repo.findDetail(id, await this.scope(user));
      if (!visible) throw new NotFoundException("Sitzung nicht gefunden.");
    }
    return meeting;
  }

  private async requireDecision(id: string, user: AuthUser) {
    const decision = await this.repo.findDecisionForRules(id);
    if (!decision) throw new NotFoundException("Entscheid nicht gefunden.");

    if (!seesAllDecisions(user)) {
      const visible = await this.repo.findDecision(id, await this.decisionScope(user));
      if (!visible) throw new NotFoundException("Entscheid nicht gefunden.");
    }
    return decision;
  }

  /**
   * The rule that protects the record, applied to every protocol write.
   *
   * It consults **no permissions**, deliberately: somebody with
   * `meeting.update` still cannot edit an approved protocol, because the rule
   * is about what the record is rather than about who outranks whom.
   */
  private refuseWhenClosed(meeting: {
    status: MeetingStatus;
    approvals: readonly { decision: string }[];
  }): void {
    const refusal = refuseProtocolEdit(meeting);
    if (refusal) throw new ForbiddenException(refusal);
  }

  /** A decision may only be cited by the meeting it belongs to. */
  private async refuseForeignDecision(
    decisionId: string | null,
    meetingId: string,
  ): Promise<void> {
    if (!decisionId) return;
    const decision = await this.repo.findDecisionForRules(decisionId);
    if (!decision) throw new BadRequestException("Den Entscheid gibt es nicht.");
    if (decision.meetingId && decision.meetingId !== meetingId) {
      throw new BadRequestException(
        "Dieser Entscheid wurde an einer anderen Sitzung gefasst und kann hier nicht noch einmal festgehalten werden.",
      );
    }
  }

  /**
   * The Pendenz's task, written in the same transaction as the line.
   *
   * Through the repository and the tasks module's **pure** `nextPosition`, not
   * through `TasksService` — see the note on the import. What is borrowed is a
   * function over numbers; what is not borrowed is a service with its own
   * transaction, event bus and permission model.
   *
   * The task carries the line's responsible person, date and Gewerk, because a
   * Pendenz that arrives on a board without them is a card somebody has to come
   * back to the protocol to understand.
   */
  private async createTaskForPendenz(
    tx: PrismaTx,
    input: {
      text: string;
      projectId: string | null;
      responsibleId: string;
      dueDate: Date;
      disciplineId: string | null;
      userId: string;
    },
  ): Promise<string> {
    const positions = await this.repo.taskPositionsIn(input.projectId, tx);

    return this.repo.createTaskForPendenz(
      {
        // A protocol line is a sentence and a task title is a label, so the
        // title is the first sentence of it — the full text stays in the
        // description, and in the protocol, which is the record.
        title: firstLine(input.text),
        description: input.text.trim(),
        status: "TODO",
        priority: "MEDIUM",
        position: nextPosition(positions),
        projectId: input.projectId,
        assigneeId: input.responsibleId,
        disciplineId: input.disciplineId,
        dueDate: input.dueDate,
        createdById: input.userId,
        updatedById: input.userId,
      },
      tx,
    );
  }

  private presentDetail(row: Parameters<typeof toMeetingDetail>[0]) {
    return {
      ...toMeetingDetail(row),
      allowedTransitions: transitionsFrom(row.status),
      protocolLocked: refuseProtocolEdit({ status: row.status, approvals: row.approvals }) !== null,
    };
  }

  private async refuseStale(id: string, expected: number): Promise<never> {
    const now = await this.repo.versionOf(id);
    if (!now) throw new NotFoundException("Sitzung nicht gefunden.");
    const by = now.updatedById ? await this.repo.nameOfUser(now.updatedById) : null;
    throw VersioningService.conflict(now.title, now.version, by, expected);
  }

  private async refuseStaleDecision(id: string, expected: number): Promise<never> {
    const now = await this.repo.decisionVersionOf(id);
    if (!now) throw new NotFoundException("Entscheid nicht gefunden.");
    const by = now.updatedById ? await this.repo.nameOfUser(now.updatedById) : null;
    throw VersioningService.conflict(`${now.number} — ${now.title}`, now.version, by, expected);
  }
}

/**
 * The first sentence of a protocol line, for a task title.
 *
 * Truncated at a word boundary rather than mid-word: a card reading
 * "Lüftungskonzept OG2 gegen den revidierten Raumpl…" is legible, and one
 * reading "…Raump" is not.
 */
function firstLine(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  const sentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  if (sentence.length <= 120) return sentence;
  const cut = sentence.slice(0, 120);
  const boundary = cut.lastIndexOf(" ");
  return `${boundary > 60 ? cut.slice(0, boundary) : cut}…`;
}
