import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { itemKey } from "./meetings.rules";

/**
 * Prisma row → what the API returns. The server's DTO boundary, for Sitzungen.
 *
 * The same seam the other two modules establish: a `Decimal` stops being a
 * `Decimal` here and a `Date` stops being a `Date` here. Money is a **string**
 * — `costImpact` is what a decision cost, and a client that receives a number
 * will add it up in floating point.
 *
 * **One thing is computed here rather than read**: `key`, the `14.3` a protocol
 * line is cited by. It is derived from the meeting's series number and the
 * line's order, never stored, because a stored key goes wrong the first time a
 * line is inserted — silently, in a document somebody quotes.
 */

/* ================================================================== */
/* What the queries select                                             */
/* ================================================================== */

const PERSON = { select: { id: true, firstName: true, lastName: true, email: true } };

export const MEETING_LIST_SELECT = {
  id: true,
  title: true,
  type: true,
  status: true,
  location: true,
  seriesNumber: true,
  startsAt: true,
  endsAt: true,
  minutesSentAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, number: true, name: true } },
  organiser: PERSON,
  /**
   * Counts, not rows.
   *
   * A list row shows "12 Traktanden · 8 Zeilen · 3 Pendenzen"; fetching the
   * protocol for every meeting on the page would be four joins per row to
   * render three numbers. The detail select below takes the rows.
   */
  _count: { select: { attendees: true, agenda: true, items: true, approvals: true } },
} satisfies Prisma.MeetingSelect;

export const MEETING_DETAIL_SELECT = {
  ...MEETING_LIST_SELECT,
  projectId: true,
  organiserId: true,
  createdById: true,
  updatedById: true,
  attendees: {
    where: { deletedAt: null },
    orderBy: [{ employeeId: "asc" }, { externalName: "asc" }] as Prisma.MeetingAttendeeOrderByWithRelationInput[],
    select: {
      id: true,
      required: true,
      invitedAt: true,
      attended: true,
      apologised: true,
      externalName: true,
      externalOrg: true,
      employee: { select: { ...PERSON.select, position: true } },
    },
  },
  agenda: {
    where: { deletedAt: null },
    orderBy: { order: "asc" } as Prisma.MeetingAgendaItemOrderByWithRelationInput,
    select: {
      id: true,
      order: true,
      title: true,
      note: true,
      durationMinutes: true,
      presenter: PERSON,
    },
  },
  items: {
    where: { deletedAt: null },
    orderBy: { order: "asc" } as Prisma.MeetingItemOrderByWithRelationInput,
    select: {
      id: true,
      order: true,
      text: true,
      kind: true,
      agendaItemId: true,
      dueDate: true,
      responsible: PERSON,
      discipline: { select: { id: true, code: true, name: true, defaultColour: true } },
      task: { select: { id: true, title: true, status: true, dueDate: true } },
      decision: { select: { id: true, number: true, title: true, status: true } },
    },
  },
  approvals: {
    orderBy: { decidedAt: "desc" } as Prisma.MeetingApprovalOrderByWithRelationInput,
    select: { id: true, decision: true, note: true, decidedAt: true, decidedBy: PERSON },
  },
} satisfies Prisma.MeetingSelect;

export const DECISION_LIST_SELECT = {
  id: true,
  number: true,
  title: true,
  type: true,
  status: true,
  impact: true,
  costImpact: true,
  scheduleImpactDays: true,
  decidedAt: true,
  decidedByExternal: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  supersedesId: true,
  project: { select: { id: true, number: true, name: true } },
  decidedBy: PERSON,
  discipline: { select: { id: true, code: true, name: true, defaultColour: true } },
  meeting: { select: { id: true, title: true, seriesNumber: true, startsAt: true } },
} satisfies Prisma.DecisionSelect;

export const DECISION_DETAIL_SELECT = {
  ...DECISION_LIST_SELECT,
  rationale: true,
  projectId: true,
  meetingId: true,
  disciplineId: true,
  decidedById: true,
  createdById: true,
  updatedById: true,
  supersedes: { select: { id: true, number: true, title: true, status: true } },
  supersededBy: { select: { id: true, number: true, title: true, status: true } },
  item: { select: { id: true, order: true, meetingId: true } },
} satisfies Prisma.DecisionSelect;

export type MeetingListRow = Prisma.MeetingGetPayload<{ select: typeof MEETING_LIST_SELECT }>;
export type MeetingDetailRow = Prisma.MeetingGetPayload<{ select: typeof MEETING_DETAIL_SELECT }>;
export type DecisionListRow = Prisma.DecisionGetPayload<{ select: typeof DECISION_LIST_SELECT }>;
export type DecisionDetailRow = Prisma.DecisionGetPayload<{ select: typeof DECISION_DETAIL_SELECT }>;

/* ================================================================== */
/* The conversions                                                     */
/* ================================================================== */

function money(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function person(
  employee: { id: string; firstName: string; lastName: string; email: string } | null,
) {
  if (!employee) return null;
  return { id: employee.id, name: `${employee.firstName} ${employee.lastName}`, email: employee.email };
}

function gewerk(
  row: { id: string; code: string; name: string; defaultColour: string } | null,
) {
  if (!row) return null;
  return { id: row.id, code: row.code, name: row.name, colour: row.defaultColour };
}

export function toMeetingListItem(row: MeetingListRow) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    location: row.location,
    seriesNumber: row.seriesNumber,
    /**
     * `Bausitzung 14`, assembled once.
     *
     * The client would otherwise concatenate a type label and a number in
     * every list, card and breadcrumb that mentions a meeting — and the day a
     * meeting has no series number, three of those would render
     * "Bausitzung null".
     */
    label: row.seriesNumber === null ? row.title : `${row.title} ${row.seriesNumber}`,
    startsAt: row.startsAt.toISOString(),
    endsAt: iso(row.endsAt),
    minutesSentAt: iso(row.minutesSentAt),
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    project: row.project && { ...row.project },
    organiser: person(row.organiser),
    counts: {
      attendees: row._count.attendees,
      agenda: row._count.agenda,
      items: row._count.items,
      approvals: row._count.approvals,
    },
  };
}

export function toMeetingDetail(row: MeetingDetailRow) {
  return {
    ...toMeetingListItem(row),
    projectId: row.projectId,
    organiserId: row.organiserId,
    createdById: row.createdById,
    updatedById: row.updatedById,
    attendees: row.attendees.map((a) => ({
      id: a.id,
      required: a.required,
      invitedAt: iso(a.invitedAt),
      attended: a.attended,
      apologised: a.apologised,
      employee: a.employee ? { ...person(a.employee)!, position: a.employee.position } : null,
      externalName: a.externalName,
      externalOrg: a.externalOrg,
      /** What the protocol prints, whichever kind of attendee it is. */
      name: a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : (a.externalName ?? "—"),
      organisation: a.employee ? "IEM" : a.externalOrg,
    })),
    agenda: row.agenda.map((item) => ({
      id: item.id,
      order: item.order,
      title: item.title,
      note: item.note,
      durationMinutes: item.durationMinutes,
      presenter: person(item.presenter),
    })),
    items: row.items.map((item) => ({
      id: item.id,
      order: item.order,
      // Computed, never stored — see the note at the top of this file.
      key: itemKey(row.seriesNumber, item.order),
      text: item.text,
      kind: item.kind,
      agendaItemId: item.agendaItemId,
      dueDate: iso(item.dueDate),
      responsible: person(item.responsible),
      discipline: gewerk(item.discipline),
      task: item.task && {
        id: item.task.id,
        title: item.task.title,
        status: item.task.status,
        dueDate: iso(item.task.dueDate),
      },
      decision: item.decision && { ...item.decision },
    })),
    approvals: row.approvals.map((a) => ({
      id: a.id,
      decision: a.decision,
      note: a.note,
      decidedAt: a.decidedAt.toISOString(),
      decidedBy: person(a.decidedBy),
    })),
  };
}

export function toDecisionListItem(row: DecisionListRow) {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    type: row.type,
    status: row.status,
    impact: row.impact,
    costImpact: money(row.costImpact),
    scheduleImpactDays: row.scheduleImpactDays,
    decidedAt: row.decidedAt.toISOString(),
    decidedByExternal: row.decidedByExternal,
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    /** Present means this decision reversed another — see `supersedes`. */
    supersedesId: row.supersedesId,
    project: row.project && { ...row.project },
    decidedBy: person(row.decidedBy),
    discipline: gewerk(row.discipline),
    meeting: row.meeting && {
      id: row.meeting.id,
      title: row.meeting.title,
      seriesNumber: row.meeting.seriesNumber,
      startsAt: row.meeting.startsAt.toISOString(),
    },
  };
}

export function toDecisionDetail(row: DecisionDetailRow) {
  return {
    ...toDecisionListItem(row),
    rationale: row.rationale,
    projectId: row.projectId,
    meetingId: row.meetingId,
    disciplineId: row.disciplineId,
    decidedById: row.decidedById,
    createdById: row.createdById,
    updatedById: row.updatedById,
    supersedes: row.supersedes && { ...row.supersedes },
    /**
     * The other direction, and the one that matters when reading an old
     * decision: "this was replaced by E-2026-031" is the sentence somebody
     * needs, and without it they act on a decision that no longer stands.
     */
    supersededBy: row.supersededBy && { ...row.supersededBy },
    item: row.item && { id: row.item.id, order: row.item.order, meetingId: row.item.meetingId },
  };
}

export type MeetingListItem = ReturnType<typeof toMeetingListItem>;
export type MeetingDetail = ReturnType<typeof toMeetingDetail>;
export type DecisionListItem = ReturnType<typeof toDecisionListItem>;
export type DecisionDetail = ReturnType<typeof toDecisionDetail>;

/**
 * What an audit row records about a meeting. A diff, not a dump.
 *
 * Takes the organiser **either way** — the scalar column from the rule read,
 * the relation from the detail read — which is the guard `projects.mapper.ts`
 * documents: reading only one shape means every `after` loses the field and the
 * log records it being removed on every edit. Nothing throws; it lies.
 */
export function toMeetingAuditSnapshot(row: {
  title: string;
  status: string;
  type?: string;
  seriesNumber?: number | null;
  startsAt: Date;
  organiserId?: string | null;
  organiser?: { id: string } | null;
}) {
  return {
    title: row.title,
    status: row.status,
    type: row.type ?? null,
    seriesNumber: row.seriesNumber ?? null,
    startsAt: row.startsAt.toISOString(),
    organiserId: row.organiserId ?? row.organiser?.id ?? null,
  };
}

export function toDecisionAuditSnapshot(row: {
  number: string;
  title: string;
  status: string;
  rationale?: string;
  impact?: string;
  decidedById?: string | null;
  decidedBy?: { id: string } | null;
}) {
  return {
    number: row.number,
    title: row.title,
    status: row.status,
    // The rationale is in the snapshot because changing *why* is the change a
    // dispute cares about, and a diff that omitted it would show a decision
    // being edited without saying what moved.
    rationale: row.rationale ?? null,
    impact: row.impact ?? null,
    decidedById: row.decidedById ?? row.decidedBy?.id ?? null,
  };
}

/* ================================================================== */
/* Inbound: DTO → what Prisma writes                                   */
/* ================================================================== */

/** `"1234.50"` → `Decimal`. Throws with the field named, never silently zero. */
export function toMoney(value: string | null | undefined, field: string): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(value)) {
    throw new BadRequestException(
      `„${value}“ ist kein gültiger Betrag für ${field}. Erwartet: 1234.50`,
    );
  }
  return new Prisma.Decimal(value);
}

/** The same value as a plain number, so the pure rules never meet a `Decimal`. */
export function toMoneyNumber(value: string | null | undefined, field: string): number | null {
  const decimal = toMoney(value, field);
  return decimal === null ? null : decimal.toNumber();
}

export function toDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  return new Date(value);
}

export type MeetingWriteInput = {
  title?: string;
  startsAt?: string;
  endsAt?: string | null;
  type?: string;
  location?: string | null;
  organiserId?: string | null;
  seriesNumber?: number | null;
};

/**
 * The edit body → a Prisma update.
 *
 * **Scalar foreign keys, never `connect`/`disconnect`.** The optimistic lock
 * needs the version inside the `where`, only `updateMany` allows that, and
 * `MeetingUncheckedUpdateInput` has no relation operations at all — a body
 * carrying `organiser: { connect: … }` is a runtime 500 that typechecks. That
 * exact failure shipped in Projects.
 */
export function toMeetingUpdateData(
  input: MeetingWriteInput,
  updatedById: string | null,
): Prisma.MeetingUncheckedUpdateInput {
  const data: Prisma.MeetingUncheckedUpdateInput = { updatedById };

  if (input.title !== undefined) data.title = input.title;
  if (input.type !== undefined) data.type = input.type as Prisma.MeetingUpdateInput["type"];
  if (input.location !== undefined) data.location = input.location;
  if (input.organiserId !== undefined) data.organiserId = input.organiserId;
  if (input.seriesNumber !== undefined) data.seriesNumber = input.seriesNumber;
  if (input.startsAt !== undefined) data.startsAt = toDate(input.startsAt)!;
  if (input.endsAt !== undefined) data.endsAt = toDate(input.endsAt);

  return data;
}

export type DecisionWriteInput = {
  title?: string;
  rationale?: string;
  decidedAt?: string;
  decidedById?: string | null;
  decidedByExternal?: string | null;
  type?: string;
  disciplineId?: string | null;
  impact?: string;
  costImpact?: string | null;
  scheduleImpactDays?: number | null;
};

export function toDecisionUpdateData(
  input: DecisionWriteInput,
  updatedById: string | null,
): Prisma.DecisionUncheckedUpdateInput {
  const data: Prisma.DecisionUncheckedUpdateInput = { updatedById };

  if (input.title !== undefined) data.title = input.title;
  if (input.rationale !== undefined) data.rationale = input.rationale;
  if (input.type !== undefined) data.type = input.type as Prisma.DecisionUpdateInput["type"];
  if (input.impact !== undefined) data.impact = input.impact as Prisma.DecisionUpdateInput["impact"];
  if (input.disciplineId !== undefined) data.disciplineId = input.disciplineId;
  if (input.decidedById !== undefined) data.decidedById = input.decidedById;
  if (input.decidedByExternal !== undefined) data.decidedByExternal = input.decidedByExternal;
  if (input.scheduleImpactDays !== undefined) data.scheduleImpactDays = input.scheduleImpactDays;
  if (input.decidedAt !== undefined) data.decidedAt = toDate(input.decidedAt)!;
  if (input.costImpact !== undefined) {
    data.costImpact = input.costImpact === null ? null : toMoney(input.costImpact, "Kostenfolge");
  }

  return data;
}

export type MeetingCreateInput = MeetingWriteInput & { title: string; startsAt: string };

export function toMeetingCreateData(
  input: MeetingCreateInput & { projectId: string | null; seriesNumber: number | null },
  createdById: string | null,
): Prisma.MeetingUncheckedCreateInput {
  return {
    title: input.title,
    type: input.type as Prisma.MeetingUncheckedCreateInput["type"],
    location: input.location ?? null,
    seriesNumber: input.seriesNumber,
    startsAt: toDate(input.startsAt)!,
    endsAt: toDate(input.endsAt),
    projectId: input.projectId,
    organiserId: input.organiserId ?? null,
    createdById,
    updatedById: createdById,
  };
}

export type DecisionCreateInput = DecisionWriteInput & {
  title: string;
  rationale: string;
  projectId: string;
  decidedAt: string;
  number: string;
  meetingId?: string | null;
  status?: string;
};

export function toDecisionCreateData(
  input: DecisionCreateInput,
  createdById: string | null,
): Prisma.DecisionUncheckedCreateInput {
  return {
    number: input.number,
    title: input.title,
    rationale: input.rationale,
    projectId: input.projectId,
    meetingId: input.meetingId ?? null,
    type: input.type as Prisma.DecisionUncheckedCreateInput["type"],
    status: input.status as Prisma.DecisionUncheckedCreateInput["status"],
    decidedAt: toDate(input.decidedAt)!,
    decidedById: input.decidedById ?? null,
    decidedByExternal: input.decidedByExternal ?? null,
    disciplineId: input.disciplineId ?? null,
    impact: input.impact as Prisma.DecisionUncheckedCreateInput["impact"],
    costImpact: toMoney(input.costImpact, "Kostenfolge"),
    scheduleImpactDays: input.scheduleImpactDays ?? null,
    createdById,
    updatedById: createdById,
  };
}

/**
 * The flat shapes the CSV exports write.
 *
 * Separate from the list items on purpose: an export is read by Excel, and
 * nesting `project.name` inside an object means the column header is decided by
 * whoever writes the CSV loop rather than by this module.
 */
export function toMeetingExportRow(row: MeetingListRow): Record<string, string> {
  return {
    Sitzung: row.title,
    Nummer: row.seriesNumber === null ? "" : String(row.seriesNumber),
    Typ: row.type,
    Status: row.status,
    Projekt: row.project?.name ?? "",
    Projektnummer: row.project?.number ?? "",
    Datum: row.startsAt.toISOString().slice(0, 10),
    Ort: row.location ?? "",
    Leitung: row.organiser ? `${row.organiser.firstName} ${row.organiser.lastName}` : "",
    Teilnehmende: String(row._count.attendees),
    Traktanden: String(row._count.agenda),
    Protokollzeilen: String(row._count.items),
    "Protokoll versandt": row.minutesSentAt?.toISOString().slice(0, 10) ?? "",
  };
}

export function toDecisionExportRow(row: DecisionListRow): Record<string, string> {
  return {
    Nummer: row.number,
    Entscheid: row.title,
    Typ: row.type,
    Status: row.status,
    Projekt: row.project?.name ?? "",
    Projektnummer: row.project?.number ?? "",
    Gewerk: row.discipline?.code ?? "",
    Entschieden: row.decidedAt.toISOString().slice(0, 10),
    "Entschieden von": row.decidedBy
      ? `${row.decidedBy.firstName} ${row.decidedBy.lastName}`
      : (row.decidedByExternal ?? ""),
    Sitzung: row.meeting
      ? `${row.meeting.title}${row.meeting.seriesNumber === null ? "" : ` ${row.meeting.seriesNumber}`}`
      : "",
    Auswirkung: row.impact,
    Kostenfolge: money(row.costImpact) ?? "",
    "Terminfolge (Tage)": row.scheduleImpactDays === null ? "" : String(row.scheduleImpactDays),
    Ersetzt: row.supersedesId ? "ja" : "nein",
  };
}
