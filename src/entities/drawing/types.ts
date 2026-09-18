import type { PersonRef } from "@/entities/project";
import type { DisciplineRef, ProjectRef } from "@/entities/task";

/**
 * What a plan and a Planversand *are*, on the client.
 *
 * `entities/` and not `features/drawings/`, for the reason the folder's README
 * gives: Issues will point at a drawing, BIM will link a model to one, and the
 * project detail embeds the register. Every one of those wants to render a
 * plan's number and status badge, and if that lived in the feature they would
 * each import its internals.
 *
 * **`ProjectRef` and `DisciplineRef` come from `entities/task`** rather than
 * being redeclared — the same shapes from the same selects, and a second copy is
 * one rename away from two modules disagreeing about what a Gewerk looks like.
 *
 * Dates are `Date`. There is **no money in this module at all**, which is worth
 * stating rather than assuming: the day a plan gains a price it crosses as a
 * string, for the reason `Decision.costImpact` does.
 */

export const DRAWING_TYPES = [
  "GRUNDRISS",
  "SCHNITT",
  "ANSICHT",
  "SCHEMA",
  "PRINZIPSCHEMA",
  "DETAIL",
  "STRANGSCHEMA",
  "ISOMETRIE",
] as const;
export type DrawingType = (typeof DRAWING_TYPES)[number];

export const DRAWING_FORMATS = ["A0", "A1", "A2", "A3", "A4", "SONDER"] as const;
export type DrawingFormat = (typeof DRAWING_FORMATS)[number];

/**
 * The lifecycle, and the distinction a single `APPROVED` cannot hold.
 *
 * **`RELEASED` is internal and `ISSUED` is external.** A released plan is
 * approved in-house; an issued one has left the building and somebody is
 * building from it. They are different facts with different consequences.
 */
export const DRAWING_STATUSES = [
  "WIP",
  "IN_CHECK",
  "CHECKED",
  "RELEASED",
  "ISSUED",
  "SUPERSEDED",
  "WITHDRAWN",
] as const;
export type DrawingStatus = (typeof DRAWING_STATUSES)[number];

export function isDrawingStatus(value: string): value is DrawingStatus {
  return (DRAWING_STATUSES as readonly string[]).includes(value);
}

export const REVISION_REASONS = [
  "ERSTAUSGABE",
  "KUNDENWUNSCH",
  "KOORDINATION",
  "FEHLERKORREKTUR",
  "BEHOERDE",
  "AUSFUEHRUNG",
] as const;
export type RevisionReason = (typeof REVISION_REASONS)[number];

export const TRANSMITTAL_PURPOSES = [
  "ZUR_INFORMATION",
  "ZUR_PRUEFUNG",
  "ZUR_AUSFUEHRUNG",
  "ZUR_FREIGABE",
] as const;
export type TransmittalPurpose = (typeof TRANSMITTAL_PURPOSES)[number];

export const TRANSMITTAL_MEDIA = ["EMAIL", "POST", "PLATTFORM", "UEBERGABE"] as const;
export type TransmittalMedium = (typeof TRANSMITTAL_MEDIA)[number];

export const RECIPIENT_ROLES = ["TO", "CC"] as const;
export type RecipientRole = (typeof RECIPIENT_ROLES)[number];

/** SIA 112, as the server spells it. */
export const SIA_PHASES = ["P31", "P32", "P33", "P41", "P51", "P52", "P53"] as const;
export type SiaPhase = (typeof SIA_PHASES)[number];

/* ================================================================== */
/* The plan                                                            */
/* ================================================================== */

export type BuildingRef = { id: string; number: string; name: string };

export type Drawing = {
  id: string;
  /** `4723-HZG-EG-101`. Unique within its project, and quoted in e-mails. */
  number: string;
  title: string;
  type: DrawingType;
  scale: string | null;
  format: DrawingFormat;
  phase: SiaPhase | null;
  status: DrawingStatus;
  /**
   * The newest revision's letter, `null` before the first one.
   *
   * Sent by the server rather than derived from `revisions` — a list row has no
   * revisions to derive it from, and a second derivation is the one that goes
   * wrong when a revision is inserted.
   */
  currentRevision: string | null;
  /**
   * The newest revision that has actually been issued, `null` until the first
   * Planversand.
   *
   * Beside `currentRevision` rather than instead of it, because the two answer
   * different questions: that one is what the office is drawing, this one is
   * what the Bauherr and the Unternehmer are holding. They differ exactly when
   * a plan has been revised since it went out, which is the set of plans that
   * need reissuing — so a register that shows only one of them cannot show that
   * set at all.
   */
  issuedRevision: string | null;
  version: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  project: ProjectRef | null;
  discipline: DisciplineRef | null;
  building: BuildingRef | null;
  /** Gezeichnet, geprüft, freigegeben — three columns because three people. */
  drawnBy: PersonRef | null;
  checkedBy: PersonRef | null;
  approvedBy: PersonRef | null;
  counts: { revisions: number };
};

export type Revision = {
  id: string;
  drawingId: string;
  /** `A`, `B`, … — skipping `I` and `O`. Computed by the server, never here. */
  revision: string;
  /** Required by the server. "What changed" is the whole point of the row. */
  changeNote: string;
  reason: RevisionReason;
  fileName: string;
  size: number;
  mimeType: string;
  /**
   * How somebody verifies the file they downloaded is the file that was issued.
   *
   * The **storage key is deliberately absent** from the wire: it is an internal
   * path, and putting it here invites a client to construct a URL and bypass
   * the authenticated download.
   */
  checksum: string;
  releasedAt: Date | null;
  supersededAt: Date | null;
  createdAt: Date | null;
  drawnBy: PersonRef | null;
  checkedBy: PersonRef | null;
  approvedBy: PersonRef | null;
};

export type DrawingDetail = Drawing & {
  projectId: string;
  disciplineId: string;
  buildingId: string | null;
  drawnById: string | null;
  checkedById: string | null;
  approvedById: string | null;
  createdById: string | null;
  updatedById: string | null;
  /** Newest first. Append-only — the bytes of every revision survive. */
  revisions: Revision[];
  /** Decided by the server; a second transition table here goes stale. */
  allowedTransitions: DrawingStatus[];
  /** Past release a plan is a published fact. Sent with the record. */
  readOnly: boolean;
};

/** One revision as `/drawings/revisions` returns it — with its plan. */
export type ListedRevision = Revision & {
  drawing: {
    id: string;
    number: string;
    title: string;
    status: DrawingStatus;
    project: ProjectRef | null;
    discipline: DisciplineRef | null;
  };
};

export type DrawingStats = {
  byStatus: Record<string, number>;
  total: number;
  /** Somebody is waiting on these. The one figure on the screen to act on. */
  awaitingCheck: number;
  released: number;
};

/* ================================================================== */
/* Planversand                                                         */
/* ================================================================== */

export type TransmittalItem = {
  id: string;
  copies: number;
  format: DrawingFormat | null;
  revisionId: string;
  revision: string;
  fileName: string;
  releasedAt: Date | null;
  /**
   * Sent with the item because it is the fact that goes stale *after* the
   * Planversand: a revision superseded since it was issued is exactly the row
   * somebody needs flagged when they open an old one.
   */
  supersededAt: Date | null;
  drawing: {
    id: string;
    number: string;
    title: string;
    discipline: DisciplineRef | null;
  };
};

export type TransmittalRecipient = {
  id: string;
  role: RecipientRole;
  /** `null` is "not confirmed", which is not "did not receive". */
  acknowledgedAt: Date | null;
  employee: PersonRef | null;
  externalName: string | null;
  externalOrg: string | null;
  externalMail: string | null;
  /** What a Planversand prints, whichever kind of recipient it is. */
  name: string;
  organisation: string | null;
};

export type Transmittal = {
  id: string;
  /** `PV-2026-0007`. Never reused — a Planversand cannot be deleted. */
  number: string;
  sentAt: Date;
  purpose: TransmittalPurpose;
  medium: TransmittalMedium;
  note: string | null;
  createdAt: Date | null;
  project: ProjectRef | null;
  sentBy: PersonRef | null;
  counts: { items: number; recipients: number };
};

export type TransmittalDetail = Transmittal & {
  projectId: string;
  createdById: string | null;
  items: TransmittalItem[];
  recipients: TransmittalRecipient[];
};

/**
 * Who already holds an older revision of a plan being sent.
 *
 * A **warning, not a refusal** — reissuing a revised plan is the normal case —
 * returned beside the created transmittal so the screen can name the people who
 * must be told.
 */
export type PriorIssue = {
  recipientLabel: string;
  drawingNumber: string;
  previousRevision: string;
  newRevision: string;
};

export type TransmittalResult = {
  transmittal: TransmittalDetail;
  warnings: PriorIssue[];
};

/* ================================================================== */
/* What a form produces                                                */
/* ================================================================== */

/**
 * **Entity-shaped drafts, not request bodies.** A hook naming
 * `CreateDrawingBody` would put a DTO type above the mapper, which is the
 * boundary `architecture.test.ts` enforces.
 */
export type DrawingDraft = {
  number: string;
  title: string;
  projectId: string;
  disciplineId: string;
  type: DrawingType;
  scale?: string | null;
  format?: DrawingFormat;
  phase?: SiaPhase | null;
  buildingId?: string | null;
  drawnById?: string | null;
};

export type DrawingEdit = Partial<Omit<DrawingDraft, "projectId">> & {
  expectedVersion: number;
  versionNote?: string;
  checkedById?: string | null;
  approvedById?: string | null;
};

export type DrawingStatusChange = { status: DrawingStatus; reason?: string };

export type RevisionDraft = {
  changeNote: string;
  reason?: RevisionReason;
  /** Left out to have one allocated, skipping `I` and `O`. */
  revision?: string;
  drawnById?: string | null;
  checkedById?: string | null;
  storageKey: string;
  fileName: string;
  size: number;
  checksum: string;
  mimeType: string;
};

export type TransmittalDraft = {
  projectId: string;
  items: { drawingRevisionId: string; copies?: number; format?: DrawingFormat }[];
  recipients: {
    employeeId?: string;
    externalName?: string;
    externalOrg?: string;
    externalMail?: string;
    role?: RecipientRole;
  }[];
  sentAt?: Date;
  purpose?: TransmittalPurpose;
  medium?: TransmittalMedium;
  note?: string;
};

export type AcknowledgeDraft = { recipientId: string; acknowledgedAt?: Date };
