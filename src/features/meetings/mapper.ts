import type { Paginated } from "@/core/api";
import {
  APPROVAL_DECISIONS,
  DECISION_IMPACTS,
  DECISION_STATUSES,
  DECISION_TYPES,
  ITEM_KINDS,
  MEETING_STATUSES,
  MEETING_TYPES,
  type AgendaDraft,
  type AgendaItem,
  type ApprovalDecision,
  type ApprovalDraft,
  type Approval,
  type AttendanceEntry,
  type Attendee,
  type AttendeeDraft,
  type Decision,
  type DecisionDetail,
  type DecisionDraft,
  type DecisionEdit,
  type DecisionImpact,
  type DecisionRef,
  type DecisionStats,
  type DecisionStatus,
  type DecisionStatusChange,
  type DecisionType,
  type ItemDraft,
  type ItemEdit,
  type Meeting,
  type MeetingDetail,
  type MeetingDraft,
  type MeetingEdit,
  type MeetingItem,
  type MeetingItemKind,
  type MeetingStats,
  type MeetingStatus,
  type MeetingStatusChange,
  type MeetingType,
  type ProtocolLine,
} from "@/entities/meeting";
import { TASK_STATUSES, type TaskStatus } from "@/entities/task";
import type {
  AddAgendaItemBody,
  AddAttendeeBody,
  AddItemBody,
  AgendaItemDto,
  ApprovalDto,
  ApproveMinutesBody,
  AttendeeDto,
  ChangeDecisionStatusBody,
  ChangeMeetingStatusBody,
  CreateDecisionBody,
  CreateMeetingBody,
  DecisionDetailDto,
  DecisionDto,
  DecisionRefDto,
  DecisionStatsDto,
  MeetingDetailDto,
  MeetingDto,
  MeetingItemDto,
  MeetingStatsDto,
  ProtocolLineDto,
  RecordAttendanceBody,
  UpdateAgendaItemBody,
  UpdateDecisionBody,
  UpdateItemBody,
  UpdateMeetingBody,
  VersionDto,
} from "./dto";

/**
 * DTO ⇄ entity. **The last file in which a DTO type is legal.**
 *
 * Three translations, each a bug that otherwise happens somewhere else:
 *
 * | Wire | Entity | What goes wrong without it |
 * | --- | --- | --- |
 * | `"2026-09-10T…"` | `Date` | `"2026-09-10" < someDate` compares a string to an object and never throws |
 * | open `string` | closed union | a `switch` with no case for a value the server already sends |
 * | `null` date | `null` | `new Date(null)` is 1 January 1970, silently |
 *
 * **`costImpact` is deliberately *not* converted.** It stays the decimal string
 * the server sent: parsing it is the first step toward adding it up, and a
 * column of decision costs that ends in eleven decimals is a column nobody
 * trusts. `formatDecimalString` in `entities/meeting` groups the digits of the
 * string without ever making it a number.
 *
 * **`key` and `label` are passed through, never assembled.** `14.3` and
 * "Bausitzung 14" are computed on the server from fields the client also has —
 * and a second assembly here is the one that renders "Bausitzung null" the day
 * a meeting has no series number.
 */

function toDate(iso: string): Date;
function toDate(iso: string | null): Date | null;
function toDate(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}

/**
 * Narrows an open string to a closed union, falling back **and warning**.
 *
 * The least-bad of three options: throwing would blank a protocol because one
 * line came from a newer server, leaving it a `string` would push the problem
 * into every `switch`, and mapping it silently would hide a deployment skew.
 */
function narrow<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T,
  field: string,
): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  console.warn(
    `[meetings] Unbekannter Wert „${value}“ für ${field} — erwartet: ${allowed.join(", ")}`,
  );
  return fallback;
}

function person(dto: { id: string; name: string; email: string } | null) {
  return dto ? { ...dto } : null;
}

function gewerk(dto: { id: string; code: string; name: string; colour: string } | null) {
  return dto ? { ...dto } : null;
}

function meetingRef(dto: {
  id: string;
  title: string;
  seriesNumber: number | null;
  startsAt: string;
} | null) {
  return dto
    ? {
        id: dto.id,
        title: dto.title,
        seriesNumber: dto.seriesNumber,
        startsAt: toDate(dto.startsAt),
      }
    : null;
}

function decisionRef(dto: DecisionRefDto | null): DecisionRef | null {
  return dto
    ? {
        id: dto.id,
        number: dto.number,
        title: dto.title,
        status: narrow<DecisionStatus>(dto.status, DECISION_STATUSES, "ENTSCHIEDEN", "Entscheid-Status"),
      }
    : null;
}

/* ================================================================== */
/* Meetings                                                            */
/* ================================================================== */

export function toMeeting(dto: MeetingDto): Meeting {
  return {
    id: dto.id,
    title: dto.title,
    type: narrow<MeetingType>(dto.type, MEETING_TYPES, "BAUSITZUNG", "Sitzungstyp"),
    status: narrow<MeetingStatus>(dto.status, MEETING_STATUSES, "PLANNED", "status"),
    location: dto.location,
    seriesNumber: dto.seriesNumber,
    label: dto.label,
    startsAt: toDate(dto.startsAt),
    endsAt: toDate(dto.endsAt),
    minutesSentAt: toDate(dto.minutesSentAt),
    version: dto.version,
    createdAt: toDate(dto.createdAt),
    updatedAt: toDate(dto.updatedAt),
    // Copied rather than passed through: the DTO objects belong to the cache,
    // and an entity sharing one is a mutation away from changing what another
    // screen is reading.
    project: dto.project && { ...dto.project },
    organiser: person(dto.organiser),
    counts: { ...dto.counts },
  };
}

export function toMeetingPage(page: Paginated<MeetingDto>): Paginated<Meeting> {
  return { ...page, items: page.items.map(toMeeting) };
}

export function toAttendee(dto: AttendeeDto): Attendee {
  return {
    id: dto.id,
    required: dto.required,
    invitedAt: toDate(dto.invitedAt),
    attended: dto.attended,
    apologised: dto.apologised,
    employee: dto.employee && { ...dto.employee },
    externalName: dto.externalName,
    externalOrg: dto.externalOrg,
    name: dto.name,
    organisation: dto.organisation,
  };
}

export function toAgendaItem(dto: AgendaItemDto): AgendaItem {
  return {
    id: dto.id,
    order: dto.order,
    title: dto.title,
    note: dto.note,
    durationMinutes: dto.durationMinutes,
    presenter: person(dto.presenter),
  };
}

export function toMeetingItem(dto: MeetingItemDto): MeetingItem {
  return {
    id: dto.id,
    order: dto.order,
    key: dto.key,
    text: dto.text,
    kind: narrow<MeetingItemKind>(dto.kind, ITEM_KINDS, "INFORMATION", "Zeilentyp"),
    agendaItemId: dto.agendaItemId,
    dueDate: toDate(dto.dueDate),
    responsible: person(dto.responsible),
    discipline: gewerk(dto.discipline),
    task: dto.task && {
      id: dto.task.id,
      title: dto.task.title,
      status: narrow<TaskStatus>(dto.task.status, TASK_STATUSES, "TODO", "Aufgabenstatus"),
      dueDate: toDate(dto.task.dueDate),
    },
    decision: decisionRef(dto.decision),
  };
}

export function toApproval(dto: ApprovalDto): Approval {
  return {
    id: dto.id,
    decision: narrow<ApprovalDecision>(
      dto.decision,
      APPROVAL_DECISIONS,
      "APPROVED",
      "Genehmigung",
    ),
    note: dto.note,
    decidedAt: toDate(dto.decidedAt),
    decidedBy: person(dto.decidedBy),
  };
}

export function toMeetingDetail(dto: MeetingDetailDto): MeetingDetail {
  return {
    ...toMeeting(dto),
    projectId: dto.projectId,
    organiserId: dto.organiserId,
    createdById: dto.createdById,
    updatedById: dto.updatedById,
    attendees: dto.attendees.map(toAttendee),
    agenda: dto.agenda.map(toAgendaItem),
    items: dto.items.map(toMeetingItem),
    approvals: dto.approvals.map(toApproval),
    /**
     * Filtered rather than narrowed with a fallback.
     *
     * A transition the client does not recognise must **disappear**, not become
     * `PLANNED` — offering the wrong button is worse than offering one fewer.
     */
    allowedTransitions: dto.allowedTransitions.filter((value): value is MeetingStatus =>
      (MEETING_STATUSES as readonly string[]).includes(value),
    ),
    protocolLocked: dto.protocolLocked,
  };
}

export function toProtocolLine(dto: ProtocolLineDto): ProtocolLine {
  const { meeting, ...rest } = dto;
  return {
    ...toMeetingItem({ ...rest, agendaItemId: null }),
    meeting: meetingRef(meeting)!,
  };
}

export function toProtocolPage(page: Paginated<ProtocolLineDto>): Paginated<ProtocolLine> {
  return { ...page, items: page.items.map(toProtocolLine) };
}

/**
 * Fills every status the endpoint left out.
 *
 * `/meetings/stats` groups by status, so a fresh database sends `{ HELD: 2 }`.
 * The filter chips read this map directly, and `undefined` renders as nothing
 * where `0` is the truthful answer.
 */
export function toMeetingStats(dto: MeetingStatsDto): MeetingStats {
  const byStatus = Object.fromEntries(
    MEETING_STATUSES.map((status) => [status, dto.byStatus[status] ?? 0]),
  ) as Record<MeetingStatus, number>;
  return { byStatus, total: dto.total, minutesPending: dto.minutesPending };
}

/* ================================================================== */
/* Decisions                                                           */
/* ================================================================== */

export function toDecision(dto: DecisionDto): Decision {
  return {
    id: dto.id,
    number: dto.number,
    title: dto.title,
    type: narrow<DecisionType>(dto.type, DECISION_TYPES, "TECHNISCH", "Entscheidtyp"),
    status: narrow<DecisionStatus>(dto.status, DECISION_STATUSES, "ENTSCHIEDEN", "Entscheid-Status"),
    impact: narrow<DecisionImpact>(dto.impact, DECISION_IMPACTS, "KEINE", "Auswirkung"),
    costImpact: dto.costImpact,
    scheduleImpactDays: dto.scheduleImpactDays,
    decidedAt: toDate(dto.decidedAt),
    decidedByExternal: dto.decidedByExternal,
    version: dto.version,
    createdAt: toDate(dto.createdAt),
    updatedAt: toDate(dto.updatedAt),
    supersedesId: dto.supersedesId,
    project: dto.project && { ...dto.project },
    decidedBy: person(dto.decidedBy),
    discipline: gewerk(dto.discipline),
    meeting: meetingRef(dto.meeting),
  };
}

export function toDecisionPage(page: Paginated<DecisionDto>): Paginated<Decision> {
  return { ...page, items: page.items.map(toDecision) };
}

export function toDecisionDetail(dto: DecisionDetailDto): DecisionDetail {
  return {
    ...toDecision(dto),
    rationale: dto.rationale,
    projectId: dto.projectId,
    meetingId: dto.meetingId,
    disciplineId: dto.disciplineId,
    decidedById: dto.decidedById,
    createdById: dto.createdById,
    updatedById: dto.updatedById,
    supersedes: decisionRef(dto.supersedes),
    supersededBy: decisionRef(dto.supersededBy),
    item: dto.item && { ...dto.item },
  };
}

export function toDecisionStats(dto: DecisionStatsDto): DecisionStats {
  const byStatus = Object.fromEntries(
    DECISION_STATUSES.map((status) => [status, dto.byStatus[status] ?? 0]),
  ) as Record<DecisionStatus, number>;
  return { byStatus, total: dto.total };
}

export type Version = {
  version: number;
  label: string;
  changed: string[];
  note: string | null;
  changedByName: string | null;
  createdAt: Date;
};

export function toVersion(dto: VersionDto): Version {
  return {
    version: dto.version,
    label: dto.label,
    changed: [...dto.changed],
    note: dto.note,
    changedByName: dto.changedByName,
    createdAt: new Date(dto.createdAt),
  };
}

/* ================================================================== */
/* The other direction: entity → request body                          */
/* ================================================================== */

/**
 * **The only place an entity shape becomes a request body.**
 *
 * Two rules run through everything below. `undefined` means "not supplied" and
 * `null` means "clear it" — a naive `{ ...values }` destroys the distinction
 * that makes `PATCH` work. And a date crosses as a plain `yyyy-mm-dd` in local
 * time, because `toISOString()` would shift a date typed in Zürich back a day
 * for most of the year.
 *
 * **`startsAt` is the exception**, and deliberately: a meeting has a *time*, not
 * just a day, so it crosses as a full ISO timestamp. Sending it as a date part
 * would put every Bausitzung at midnight.
 */
export function toDatePart(value: Date | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function toInstant(value: Date | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.toISOString();
}

/** Drops the keys that were not supplied, so `PATCH` stays a patch. */
function defined<T extends Record<string, unknown>>(body: T): T {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as T;
}

export function toCreateMeetingBody(draft: MeetingDraft): CreateMeetingBody {
  return defined({
    title: draft.title,
    startsAt: draft.startsAt.toISOString(),
    // `?? undefined`: the create endpoint has no "clear it" case, so a `null`
    // from a form control becomes omission rather than an explicit null the DTO
    // would reject.
    endsAt: toInstant(draft.endsAt) ?? undefined,
    type: draft.type,
    location: draft.location ?? undefined,
    projectId: draft.projectId ?? undefined,
    organiserId: draft.organiserId ?? undefined,
    seriesNumber: draft.seriesNumber ?? undefined,
  });
}

export function toUpdateMeetingBody(edit: MeetingEdit): UpdateMeetingBody {
  return defined({
    // Never dropped: the type requires it and the server refuses a body without
    // it.
    expectedVersion: edit.expectedVersion,
    versionNote: edit.versionNote,
    title: edit.title,
    startsAt: toInstant(edit.startsAt) ?? undefined,
    endsAt: toInstant(edit.endsAt),
    type: edit.type,
    location: edit.location,
    organiserId: edit.organiserId,
    seriesNumber: edit.seriesNumber,
  });
}

export function toMeetingStatusBody(change: MeetingStatusChange): ChangeMeetingStatusBody {
  return defined({ status: change.status, reason: change.reason });
}

export function toAttendeeBody(draft: AttendeeDraft): AddAttendeeBody {
  return defined({
    employeeId: draft.employeeId,
    externalName: draft.externalName,
    externalOrg: draft.externalOrg,
    required: draft.required,
    invitedAt: toInstant(draft.invitedAt) ?? undefined,
  });
}

export function toAttendanceBody(entries: readonly AttendanceEntry[]): RecordAttendanceBody {
  return {
    attendance: entries.map((entry) => ({
      attendeeId: entry.attendeeId,
      attended: entry.attended,
      apologised: entry.apologised,
    })),
  };
}

export function toAgendaBody(draft: AgendaDraft): AddAgendaItemBody {
  return defined({
    title: draft.title,
    note: draft.note ?? undefined,
    presenterId: draft.presenterId ?? undefined,
    durationMinutes: draft.durationMinutes ?? undefined,
  });
}

export function toAgendaUpdateBody(edit: Partial<AgendaDraft>): UpdateAgendaItemBody {
  return defined({
    title: edit.title,
    note: edit.note,
    presenterId: edit.presenterId,
    durationMinutes: edit.durationMinutes,
  });
}

export function toItemBody(draft: ItemDraft): AddItemBody {
  return defined({
    text: draft.text,
    kind: draft.kind,
    agendaItemId: draft.agendaItemId ?? undefined,
    responsibleId: draft.responsibleId ?? undefined,
    // A protocol line's date is a day — "bis zur nächsten Sitzung" — so it
    // crosses as a date part, unlike the meeting's own start time.
    dueDate: toDatePart(draft.dueDate) ?? undefined,
    disciplineId: draft.disciplineId ?? undefined,
    decisionId: draft.decisionId ?? undefined,
    createTask: draft.createTask,
    taskId: draft.taskId ?? undefined,
  });
}

export function toItemUpdateBody(edit: ItemEdit): UpdateItemBody {
  return defined({
    text: edit.text,
    kind: edit.kind,
    agendaItemId: edit.agendaItemId,
    responsibleId: edit.responsibleId,
    dueDate: toDatePart(edit.dueDate),
    disciplineId: edit.disciplineId,
    decisionId: edit.decisionId,
  });
}

export function toApprovalBody(draft: ApprovalDraft): ApproveMinutesBody {
  return defined({ decision: draft.decision, note: draft.note });
}

export function toCreateDecisionBody(draft: DecisionDraft): CreateDecisionBody {
  return defined({
    title: draft.title,
    rationale: draft.rationale,
    projectId: draft.projectId,
    // A decision has a *day*: "entschieden am 10. September". The time it was
    // said is not recorded and would be invented by an ISO timestamp.
    decidedAt: toDatePart(draft.decidedAt)!,
    meetingId: draft.meetingId ?? undefined,
    decidedById: draft.decidedById ?? undefined,
    decidedByExternal: draft.decidedByExternal ?? undefined,
    type: draft.type,
    status: draft.status,
    disciplineId: draft.disciplineId ?? undefined,
    impact: draft.impact,
    costImpact: draft.costImpact ?? undefined,
    scheduleImpactDays: draft.scheduleImpactDays ?? undefined,
  });
}

export function toUpdateDecisionBody(edit: DecisionEdit): UpdateDecisionBody {
  return defined({
    expectedVersion: edit.expectedVersion,
    versionNote: edit.versionNote,
    title: edit.title,
    rationale: edit.rationale,
    decidedAt: toDatePart(edit.decidedAt) ?? undefined,
    decidedById: edit.decidedById,
    decidedByExternal: edit.decidedByExternal,
    type: edit.type,
    disciplineId: edit.disciplineId,
    impact: edit.impact,
    costImpact: edit.costImpact,
    scheduleImpactDays: edit.scheduleImpactDays,
  });
}

export function toDecisionStatusBody(change: DecisionStatusChange): ChangeDecisionStatusBody {
  return defined({ status: change.status, reason: change.reason });
}
