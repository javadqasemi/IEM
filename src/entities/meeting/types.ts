import type { PersonRef } from "@/entities/project";
import type { DisciplineRef, ProjectRef, TaskStatus } from "@/entities/task";

/**
 * What a meeting and a decision *are*, on the client.
 *
 * `entities/` and not `features/meetings/`, for the reason the folder's README
 * gives: Documents will hang off a meeting, Drawings will cite a decision, and
 * the project detail embeds both. Every one of those wants to render a
 * decision's number and status badge, and if that lived in the feature they
 * would each import its internals.
 *
 * **`ProjectRef` and `DisciplineRef` come from `entities/task`** rather than
 * being redeclared. They are the same shapes the server sends from the same
 * selects, and a second copy is one rename away from two modules disagreeing
 * about what a Gewerk looks like. The same argument that made `Priority` shared.
 *
 * Dates are `Date`, money is `string`. `features/meetings/mapper.ts` is the only
 * place either is converted, and the money stays a string on purpose — a number
 * invites arithmetic, and float arithmetic on Rappen is how a total ends in
 * `.0000000001`.
 */

export const MEETING_TYPES = ["KICKOFF", "BAUSITZUNG", "ABNAHME", "INTERN", "KUNDE"] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const MEETING_STATUSES = ["PLANNED", "HELD", "CANCELLED"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export function isMeetingStatus(value: string): value is MeetingStatus {
  return (MEETING_STATUSES as readonly string[]).includes(value);
}

/**
 * The three kinds of protocol line, and they are not interchangeable.
 *
 * `INFORMATION` is a note, `ENTSCHEID` points at a `Decision` that outlives the
 * meeting, and `PENDENZ` points at a `Task` somebody owes. Collapsing them into
 * text is what makes minutes a document nobody reads.
 */
export const ITEM_KINDS = ["INFORMATION", "ENTSCHEID", "PENDENZ"] as const;
export type MeetingItemKind = (typeof ITEM_KINDS)[number];

export const APPROVAL_DECISIONS = ["APPROVED", "AMENDED"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const DECISION_TYPES = [
  "TECHNISCH",
  "KOMMERZIELL",
  "TERMIN",
  "GESTALTUNG",
  "ORGANISATORISCH",
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export const DECISION_STATUSES = ["OFFEN", "ENTSCHIEDEN", "UMGESETZT", "AUFGEHOBEN"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const DECISION_IMPACTS = ["KOSTEN", "TERMIN", "QUALITAET", "KEINE"] as const;
export type DecisionImpact = (typeof DECISION_IMPACTS)[number];

/* ================================================================== */
/* The meeting                                                         */
/* ================================================================== */

export type Meeting = {
  id: string;
  title: string;
  type: MeetingType;
  status: MeetingStatus;
  location: string | null;
  /** "Bausitzung 14" — null for a Kickoff or an Abnahme. */
  seriesNumber: number | null;
  /** Assembled by the server, so nothing concatenates "Bausitzung null". */
  label: string;
  startsAt: Date;
  endsAt: Date | null;
  /** Stamped by the act, never typed. Null is the "pending" queue. */
  minutesSentAt: Date | null;
  version: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  project: ProjectRef | null;
  organiser: PersonRef | null;
  counts: { attendees: number; agenda: number; items: number; approvals: number };
};

export type Attendee = {
  id: string;
  required: boolean;
  invitedAt: Date | null;
  /** `null` is "not recorded"; `false` is "invited and absent". */
  attended: boolean | null;
  apologised: boolean;
  employee: (PersonRef & { position: string | null }) | null;
  externalName: string | null;
  externalOrg: string | null;
  /** What the protocol prints, whichever kind of attendee it is. */
  name: string;
  organisation: string | null;
};

export type AgendaItem = {
  id: string;
  order: number;
  title: string;
  note: string | null;
  durationMinutes: number | null;
  presenter: PersonRef | null;
};

export type MeetingItem = {
  id: string;
  order: number;
  /** `14.3` — computed by the server from the series number and the order. */
  key: string;
  text: string;
  kind: MeetingItemKind;
  agendaItemId: string | null;
  dueDate: Date | null;
  responsible: PersonRef | null;
  discipline: DisciplineRef | null;
  task: { id: string; title: string; status: TaskStatus; dueDate: Date | null } | null;
  decision: { id: string; number: string; title: string; status: DecisionStatus } | null;
};

export type Approval = {
  id: string;
  decision: ApprovalDecision;
  note: string | null;
  decidedAt: Date;
  decidedBy: PersonRef | null;
};

export type MeetingDetail = Meeting & {
  projectId: string | null;
  organiserId: string | null;
  createdById: string | null;
  updatedById: string | null;
  attendees: Attendee[];
  agenda: AgendaItem[];
  items: MeetingItem[];
  approvals: Approval[];
  /** Decided by the server; a second copy on the client goes stale. */
  allowedTransitions: MeetingStatus[];
  /**
   * Whether the protocol is closed to editing.
   *
   * Sent with the record so the editor is read-only *before* the user types
   * rather than after they press save. The server refuses either way.
   */
  protocolLocked: boolean;
};

/** One protocol line as `/meetings/items` returns it — with its meeting. */
export type ProtocolLine = Omit<MeetingItem, "agendaItemId"> & {
  meeting: { id: string; title: string; seriesNumber: number | null; startsAt: Date };
};

export type MeetingStats = {
  byStatus: Record<string, number>;
  total: number;
  /** Held, minutes not sent. The one figure somebody acts on. */
  minutesPending: number;
};

/* ================================================================== */
/* The decision                                                        */
/* ================================================================== */

export type DecisionRef = {
  id: string;
  number: string;
  title: string;
  status: DecisionStatus;
};

export type Decision = {
  id: string;
  number: string;
  title: string;
  type: DecisionType;
  status: DecisionStatus;
  impact: DecisionImpact;
  /** A decimal string, e.g. `"48000.00"`. Format it; do not add it up. */
  costImpact: string | null;
  scheduleImpactDays: number | null;
  decidedAt: Date;
  decidedByExternal: string | null;
  version: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  /** Present means this decision reversed another. */
  supersedesId: string | null;
  project: ProjectRef | null;
  decidedBy: PersonRef | null;
  discipline: DisciplineRef | null;
  meeting: { id: string; title: string; seriesNumber: number | null; startsAt: Date } | null;
};

export type DecisionDetail = Decision & {
  /** Required by the server. The record exists to answer *why*. */
  rationale: string;
  projectId: string;
  meetingId: string | null;
  disciplineId: string | null;
  decidedById: string | null;
  createdById: string | null;
  updatedById: string | null;
  supersedes: DecisionRef | null;
  /**
   * The direction that matters when reading an *old* decision: without it
   * somebody acts on one that no longer stands.
   */
  supersededBy: DecisionRef | null;
  item: { id: string; order: number; meetingId: string } | null;
};

export type DecisionStats = { byStatus: Record<string, number>; total: number };

/* ================================================================== */
/* What a form produces                                                */
/* ================================================================== */

/**
 * **Entity-shaped drafts, not request bodies.**
 *
 * A hook naming `CreateMeetingBody` would put a DTO type above the mapper,
 * which is the boundary `architecture.test.ts` enforces.
 */
export type MeetingDraft = {
  title: string;
  startsAt: Date;
  endsAt?: Date | null;
  type?: MeetingType;
  location?: string | null;
  projectId?: string | null;
  organiserId?: string | null;
  seriesNumber?: number | null;
};

export type MeetingEdit = Partial<Omit<MeetingDraft, "title">> & {
  title?: string;
  expectedVersion: number;
  versionNote?: string;
};

export type MeetingStatusChange = { status: MeetingStatus; reason?: string };

export type AttendeeDraft = {
  employeeId?: string;
  externalName?: string;
  externalOrg?: string;
  required?: boolean;
  invitedAt?: Date | null;
};

export type AttendanceEntry = {
  attendeeId: string;
  attended?: boolean | null;
  apologised?: boolean;
};

export type AgendaDraft = {
  title: string;
  note?: string | null;
  presenterId?: string | null;
  durationMinutes?: number | null;
};

export type ItemDraft = {
  text: string;
  kind?: MeetingItemKind;
  agendaItemId?: string | null;
  responsibleId?: string | null;
  dueDate?: Date | null;
  disciplineId?: string | null;
  decisionId?: string | null;
  /** Default true for a Pendenz — the seam the wave order was built around. */
  createTask?: boolean;
  taskId?: string | null;
};

export type ItemEdit = Partial<ItemDraft>;

export type ApprovalDraft = { decision: ApprovalDecision; note?: string };

export type DecisionDraft = {
  title: string;
  rationale: string;
  projectId: string;
  decidedAt: Date;
  meetingId?: string | null;
  decidedById?: string | null;
  decidedByExternal?: string | null;
  type?: DecisionType;
  status?: DecisionStatus;
  disciplineId?: string | null;
  impact?: DecisionImpact;
  costImpact?: string | null;
  scheduleImpactDays?: number | null;
};

export type DecisionEdit = Partial<Omit<DecisionDraft, "projectId" | "status">> & {
  expectedVersion: number;
  versionNote?: string;
};

export type DecisionStatusChange = { status: DecisionStatus; reason?: string };
