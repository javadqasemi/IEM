/**
 * The wire shapes, exactly as the server sends and accepts them.
 *
 * **A DTO type may be named here and in `mapper.ts` and nowhere else.**
 * `src/architecture.test.ts` enforces it, and the rule is what makes the mapper
 * a seam: the moment a hook or a screen names `MeetingDto`, an API rename
 * reaches every file that renders a protocol.
 *
 * Dates are ISO strings and money is a decimal string, because that is what
 * arrives. Nothing here parses anything.
 */

export type PersonDto = { id: string; name: string; email: string };
export type ProjectRefDto = { id: string; number: string; name: string };
export type DisciplineRefDto = { id: string; code: string; name: string; colour: string };
export type MeetingRefDto = {
  id: string;
  title: string;
  seriesNumber: number | null;
  startsAt: string;
};

export type MeetingDto = {
  id: string;
  title: string;
  type: string;
  status: string;
  location: string | null;
  seriesNumber: number | null;
  label: string;
  startsAt: string;
  endsAt: string | null;
  minutesSentAt: string | null;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  project: ProjectRefDto | null;
  organiser: PersonDto | null;
  counts: { attendees: number; agenda: number; items: number; approvals: number };
};

export type AttendeeDto = {
  id: string;
  required: boolean;
  invitedAt: string | null;
  attended: boolean | null;
  apologised: boolean;
  employee: (PersonDto & { position: string | null }) | null;
  externalName: string | null;
  externalOrg: string | null;
  name: string;
  organisation: string | null;
};

export type AgendaItemDto = {
  id: string;
  order: number;
  title: string;
  note: string | null;
  durationMinutes: number | null;
  presenter: PersonDto | null;
};

export type MeetingItemDto = {
  id: string;
  order: number;
  key: string;
  text: string;
  kind: string;
  agendaItemId: string | null;
  dueDate: string | null;
  responsible: PersonDto | null;
  discipline: DisciplineRefDto | null;
  task: { id: string; title: string; status: string; dueDate: string | null } | null;
  decision: { id: string; number: string; title: string; status: string } | null;
};

export type ApprovalDto = {
  id: string;
  decision: string;
  note: string | null;
  decidedAt: string;
  decidedBy: PersonDto | null;
};

export type MeetingDetailDto = MeetingDto & {
  projectId: string | null;
  organiserId: string | null;
  createdById: string | null;
  updatedById: string | null;
  attendees: AttendeeDto[];
  agenda: AgendaItemDto[];
  items: MeetingItemDto[];
  approvals: ApprovalDto[];
  allowedTransitions: string[];
  protocolLocked: boolean;
};

/** One line as `/meetings/items` returns it — with its meeting attached. */
export type ProtocolLineDto = Omit<MeetingItemDto, "agendaItemId"> & { meeting: MeetingRefDto };

export type MeetingStatsDto = {
  byStatus: Record<string, number>;
  total: number;
  minutesPending: number;
};

export type DecisionRefDto = { id: string; number: string; title: string; status: string };

export type DecisionDto = {
  id: string;
  number: string;
  title: string;
  type: string;
  status: string;
  impact: string;
  costImpact: string | null;
  scheduleImpactDays: number | null;
  decidedAt: string;
  decidedByExternal: string | null;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  supersedesId: string | null;
  project: ProjectRefDto | null;
  decidedBy: PersonDto | null;
  discipline: DisciplineRefDto | null;
  meeting: MeetingRefDto | null;
};

export type DecisionDetailDto = DecisionDto & {
  rationale: string;
  projectId: string;
  meetingId: string | null;
  disciplineId: string | null;
  decidedById: string | null;
  createdById: string | null;
  updatedById: string | null;
  supersedes: DecisionRefDto | null;
  supersededBy: DecisionRefDto | null;
  item: { id: string; order: number; meetingId: string } | null;
};

export type DecisionStatsDto = { byStatus: Record<string, number>; total: number };

export type VersionDto = {
  version: number;
  label: string;
  changed: string[];
  note: string | null;
  changedByName: string | null;
  createdAt: string;
};

/* ================================================================== */
/* Request bodies                                                      */
/* ================================================================== */

export type CreateMeetingBody = {
  title: string;
  startsAt: string;
  endsAt?: string;
  type?: string;
  location?: string;
  projectId?: string;
  organiserId?: string;
  seriesNumber?: number;
};

/** `status` is absent: holding or cancelling is a transition with its own route. */
export type UpdateMeetingBody = {
  expectedVersion: number;
  versionNote?: string;
  title?: string;
  startsAt?: string;
  endsAt?: string | null;
  type?: string;
  location?: string | null;
  organiserId?: string | null;
  seriesNumber?: number | null;
};

export type ChangeMeetingStatusBody = { status: string; reason?: string };

export type AddAttendeeBody = {
  employeeId?: string;
  externalName?: string;
  externalOrg?: string;
  required?: boolean;
  invitedAt?: string;
};

export type RecordAttendanceBody = {
  attendance: { attendeeId: string; attended?: boolean | null; apologised?: boolean }[];
};

export type AddAgendaItemBody = {
  title: string;
  note?: string;
  presenterId?: string;
  durationMinutes?: number;
};

export type UpdateAgendaItemBody = {
  title?: string;
  note?: string | null;
  presenterId?: string | null;
  durationMinutes?: number | null;
};

export type AddItemBody = {
  text: string;
  kind?: string;
  agendaItemId?: string;
  responsibleId?: string;
  dueDate?: string;
  disciplineId?: string;
  decisionId?: string;
  createTask?: boolean;
  taskId?: string;
};

export type UpdateItemBody = {
  text?: string;
  kind?: string;
  agendaItemId?: string | null;
  responsibleId?: string | null;
  dueDate?: string | null;
  disciplineId?: string | null;
  decisionId?: string | null;
};

export type ReorderItemsBody = { order: string[] };
export type ApproveMinutesBody = { decision: string; note?: string };

export type CreateDecisionBody = {
  title: string;
  rationale: string;
  projectId: string;
  decidedAt: string;
  meetingId?: string;
  decidedById?: string;
  decidedByExternal?: string;
  type?: string;
  status?: string;
  disciplineId?: string;
  impact?: string;
  costImpact?: string;
  scheduleImpactDays?: number;
};

/** `status` and `supersedesId` are absent: reversing is its own authority. */
export type UpdateDecisionBody = {
  expectedVersion: number;
  versionNote?: string;
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

export type ChangeDecisionStatusBody = { status: string; reason?: string };
export type SupersedeDecisionBody = { supersedesId: string };
