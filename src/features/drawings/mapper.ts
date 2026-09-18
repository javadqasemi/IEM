import type { Paginated } from "@/core/api";
import {
  DRAWING_FORMATS,
  DRAWING_STATUSES,
  DRAWING_TYPES,
  RECIPIENT_ROLES,
  REVISION_REASONS,
  SIA_PHASES,
  TRANSMITTAL_MEDIA,
  TRANSMITTAL_PURPOSES,
  type Drawing,
  type DrawingDetail,
  type DrawingDraft,
  type DrawingEdit,
  type DrawingFormat,
  type DrawingStats,
  type DrawingStatus,
  type DrawingStatusChange,
  type DrawingType,
  type ListedRevision,
  type PriorIssue,
  type RecipientRole,
  type Revision,
  type RevisionDraft,
  type RevisionReason,
  type SiaPhase,
  type Transmittal,
  type TransmittalDetail,
  type TransmittalDraft,
  type TransmittalMedium,
  type TransmittalPurpose,
  type TransmittalResult,
  type AcknowledgeDraft,
} from "@/entities/drawing";
import type {
  AcknowledgeBody,
  ChangeDrawingStatusBody,
  CreateDrawingBody,
  CreateRevisionBody,
  CreateTransmittalBody,
  DrawingDetailDto,
  DrawingDto,
  DrawingStatsDto,
  ListedRevisionDto,
  PriorIssueDto,
  RevisionDto,
  TransmittalDetailDto,
  TransmittalDto,
  TransmittalResultDto,
  UpdateDrawingBody,
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
 * **`revision` and `currentRevision` are passed through, never derived.** `C`
 * is allocated by the server — skipping `I` and `O`, which is a rule this side
 * does not know — and a second derivation here is the one that goes wrong the
 * first time somebody enters a label by hand.
 */

function toDate(iso: string): Date;
function toDate(iso: string | null): Date | null;
function toDate(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}

/**
 * Narrows an open string to a closed union, falling back **and warning**.
 *
 * The least-bad of three options: throwing would blank a register because one
 * row came from a newer server, leaving it a `string` would push the problem
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
    `[drawings] Unbekannter Wert „${value}“ für ${field} — erwartet: ${allowed.join(", ")}`,
  );
  return fallback;
}

function person(dto: { id: string; name: string; email: string } | null) {
  return dto ? { ...dto } : null;
}

function gewerk(dto: { id: string; code: string; name: string; colour: string } | null) {
  return dto ? { ...dto } : null;
}

/* ================================================================== */
/* Plans                                                               */
/* ================================================================== */

export function toDrawing(dto: DrawingDto): Drawing {
  return {
    id: dto.id,
    number: dto.number,
    title: dto.title,
    type: narrow<DrawingType>(dto.type, DRAWING_TYPES, "GRUNDRISS", "Plantyp"),
    scale: dto.scale,
    format: narrow<DrawingFormat>(dto.format, DRAWING_FORMATS, "A3", "Format"),
    phase: dto.phase === null ? null : narrow<SiaPhase>(dto.phase, SIA_PHASES, "P51", "SIA-Phase"),
    status: narrow<DrawingStatus>(dto.status, DRAWING_STATUSES, "WIP", "Planstatus"),
    currentRevision: dto.currentRevision,
    version: dto.version,
    createdAt: toDate(dto.createdAt),
    updatedAt: toDate(dto.updatedAt),
    // Copied rather than passed through: the DTO objects belong to the cache,
    // and an entity sharing one is a mutation away from changing what another
    // screen is reading.
    project: dto.project && { ...dto.project },
    discipline: gewerk(dto.discipline),
    building: dto.building && { ...dto.building },
    drawnBy: person(dto.drawnBy),
    checkedBy: person(dto.checkedBy),
    approvedBy: person(dto.approvedBy),
    counts: { ...dto.counts },
  };
}

export function toDrawingPage(page: Paginated<DrawingDto>): Paginated<Drawing> {
  return { ...page, items: page.items.map(toDrawing) };
}

export function toRevision(dto: RevisionDto): Revision {
  return {
    id: dto.id,
    drawingId: dto.drawingId,
    revision: dto.revision,
    changeNote: dto.changeNote,
    reason: narrow<RevisionReason>(dto.reason, REVISION_REASONS, "ERSTAUSGABE", "Revisionsgrund"),
    fileName: dto.fileName,
    size: dto.size,
    mimeType: dto.mimeType,
    checksum: dto.checksum,
    releasedAt: toDate(dto.releasedAt),
    supersededAt: toDate(dto.supersededAt),
    createdAt: toDate(dto.createdAt),
    drawnBy: person(dto.drawnBy),
    checkedBy: person(dto.checkedBy),
    approvedBy: person(dto.approvedBy),
  };
}

export function toDrawingDetail(dto: DrawingDetailDto): DrawingDetail {
  return {
    ...toDrawing(dto),
    projectId: dto.projectId,
    disciplineId: dto.disciplineId,
    buildingId: dto.buildingId,
    drawnById: dto.drawnById,
    checkedById: dto.checkedById,
    approvedById: dto.approvedById,
    createdById: dto.createdById,
    updatedById: dto.updatedById,
    revisions: dto.revisions.map(toRevision),
    allowedTransitions: dto.allowedTransitions.map((value) =>
      narrow<DrawingStatus>(value, DRAWING_STATUSES, "WIP", "Übergang"),
    ),
    readOnly: dto.readOnly,
  };
}

export function toListedRevision(dto: ListedRevisionDto): ListedRevision {
  return {
    ...toRevision(dto),
    drawing: {
      id: dto.drawing.id,
      number: dto.drawing.number,
      title: dto.drawing.title,
      status: narrow<DrawingStatus>(dto.drawing.status, DRAWING_STATUSES, "WIP", "Planstatus"),
      project: dto.drawing.project && { ...dto.drawing.project },
      discipline: gewerk(dto.drawing.discipline),
    },
  };
}

export function toRevisionPage(page: Paginated<ListedRevisionDto>): Paginated<ListedRevision> {
  return { ...page, items: page.items.map(toListedRevision) };
}

export function toDrawingStats(dto: DrawingStatsDto): DrawingStats {
  // Every status key filled, so one with no rows reads as 0 rather than as a
  // missing card — the endpoint returns only the statuses that have rows.
  const byStatus: Record<string, number> = {};
  for (const status of DRAWING_STATUSES) byStatus[status] = 0;
  for (const [key, value] of Object.entries(dto.byStatus)) byStatus[key] = value;

  return {
    byStatus,
    total: dto.total,
    awaitingCheck: dto.awaitingCheck,
    released: dto.released,
  };
}

/* ================================================================== */
/* Planversand                                                         */
/* ================================================================== */

export function toTransmittal(dto: TransmittalDto): Transmittal {
  return {
    id: dto.id,
    number: dto.number,
    sentAt: toDate(dto.sentAt),
    purpose: narrow<TransmittalPurpose>(
      dto.purpose,
      TRANSMITTAL_PURPOSES,
      "ZUR_INFORMATION",
      "Versandzweck",
    ),
    medium: narrow<TransmittalMedium>(dto.medium, TRANSMITTAL_MEDIA, "EMAIL", "Versandweg"),
    note: dto.note,
    createdAt: toDate(dto.createdAt),
    project: dto.project && { ...dto.project },
    sentBy: person(dto.sentBy),
    counts: { ...dto.counts },
  };
}

export function toTransmittalPage(page: Paginated<TransmittalDto>): Paginated<Transmittal> {
  return { ...page, items: page.items.map(toTransmittal) };
}

export function toTransmittalDetail(dto: TransmittalDetailDto): TransmittalDetail {
  return {
    ...toTransmittal(dto),
    projectId: dto.projectId,
    createdById: dto.createdById,
    items: dto.items.map((item) => ({
      id: item.id,
      copies: item.copies,
      format:
        item.format === null
          ? null
          : narrow<DrawingFormat>(item.format, DRAWING_FORMATS, "A3", "Format"),
      revisionId: item.revisionId,
      revision: item.revision,
      fileName: item.fileName,
      releasedAt: toDate(item.releasedAt),
      supersededAt: toDate(item.supersededAt),
      drawing: {
        id: item.drawing.id,
        number: item.drawing.number,
        title: item.drawing.title,
        discipline: gewerk(item.drawing.discipline),
      },
    })),
    recipients: dto.recipients.map((recipient) => ({
      id: recipient.id,
      role: narrow<RecipientRole>(recipient.role, RECIPIENT_ROLES, "TO", "Empfängerrolle"),
      acknowledgedAt: toDate(recipient.acknowledgedAt),
      employee: person(recipient.employee),
      externalName: recipient.externalName,
      externalOrg: recipient.externalOrg,
      externalMail: recipient.externalMail,
      // Assembled by the server, never here — the day three call sites
      // concatenated it themselves is the day one of them printed "null".
      name: recipient.name,
      organisation: recipient.organisation,
    })),
  };
}

export function toPriorIssue(dto: PriorIssueDto): PriorIssue {
  return { ...dto };
}

export function toTransmittalResult(dto: TransmittalResultDto): TransmittalResult {
  return {
    transmittal: toTransmittalDetail(dto.transmittal),
    warnings: dto.warnings.map(toPriorIssue),
  };
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
 */
function defined<T extends Record<string, unknown>>(body: T): T {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as T;
}

export function toCreateDrawingBody(draft: DrawingDraft): CreateDrawingBody {
  return defined({
    number: draft.number.trim(),
    title: draft.title.trim(),
    projectId: draft.projectId,
    disciplineId: draft.disciplineId,
    type: draft.type,
    // `?? undefined`: the create endpoint has no "clear it" case, so a `null`
    // from a form control becomes omission rather than an explicit null the
    // DTO would reject.
    scale: draft.scale?.trim() || undefined,
    format: draft.format,
    phase: draft.phase ?? undefined,
    buildingId: draft.buildingId ?? undefined,
    drawnById: draft.drawnById ?? undefined,
  });
}

/**
 * The update body, with the lock always present.
 *
 * `expectedVersion` is **never dropped**: the type requires it and the server
 * refuses a body without it. A lock a caller may omit is one every caller omits
 * exactly once, and the failure is the single data-loss bug a user cannot
 * detect, report or work around.
 */
export function toUpdateDrawingBody(edit: DrawingEdit): UpdateDrawingBody {
  return defined({
    expectedVersion: edit.expectedVersion,
    versionNote: edit.versionNote,
    number: edit.number?.trim(),
    title: edit.title?.trim(),
    type: edit.type,
    scale: edit.scale === undefined ? undefined : (edit.scale?.trim() || null),
    format: edit.format,
    phase: edit.phase,
    disciplineId: edit.disciplineId,
    buildingId: edit.buildingId,
    drawnById: edit.drawnById,
    checkedById: edit.checkedById,
    approvedById: edit.approvedById,
  });
}

export function toStatusBody(change: DrawingStatusChange): ChangeDrawingStatusBody {
  return defined({ status: change.status, reason: change.reason });
}

export function toCreateRevisionBody(draft: RevisionDraft): CreateRevisionBody {
  return defined({
    changeNote: draft.changeNote.trim(),
    reason: draft.reason,
    // Uppercased here rather than in the form, so a label typed as `c` is the
    // same request as one typed as `C`. The server refuses `I` and `O`.
    revision: draft.revision?.trim().toUpperCase() || undefined,
    drawnById: draft.drawnById ?? undefined,
    checkedById: draft.checkedById ?? undefined,
    storageKey: draft.storageKey,
    fileName: draft.fileName,
    size: draft.size,
    checksum: draft.checksum,
    mimeType: draft.mimeType,
  });
}

export function toCreateTransmittalBody(draft: TransmittalDraft): CreateTransmittalBody {
  return defined({
    projectId: draft.projectId,
    items: draft.items.map((item) =>
      defined({
        drawingRevisionId: item.drawingRevisionId,
        copies: item.copies,
        format: item.format,
      }),
    ),
    recipients: draft.recipients.map((recipient) =>
      defined({
        employeeId: recipient.employeeId,
        externalName: recipient.externalName?.trim() || undefined,
        externalOrg: recipient.externalOrg?.trim() || undefined,
        externalMail: recipient.externalMail?.trim() || undefined,
        role: recipient.role,
      }),
    ),
    // A Planversand happens at a moment, not on a day — it is stamped with a
    // time, so it crosses as a full instant rather than a date part.
    sentAt: draft.sentAt?.toISOString(),
    purpose: draft.purpose,
    medium: draft.medium,
    note: draft.note?.trim() || undefined,
  });
}

export function toAcknowledgeBody(draft: AcknowledgeDraft): AcknowledgeBody {
  return defined({
    recipientId: draft.recipientId,
    acknowledgedAt: draft.acknowledgedAt?.toISOString(),
  });
}
