import type { Prisma } from "@prisma/client";
import type {
  CreateDrawingDto,
  CreateRevisionDto,
  CreateTransmittalDto,
  UpdateDrawingDto,
} from "./drawings.dto";

/**
 * Prisma row ⇄ wire shape. **The last file in which a Prisma type is legal**,
 * together with `drawings.repository.ts` and `drawings.scope.ts`.
 *
 * Three translations, each a bug that otherwise happens somewhere else:
 *
 * | Row | Wire | What goes wrong without it |
 * | --- | --- | --- |
 * | `Date` | ISO `string` | a `Date` through `JSON.stringify` is already a string, but a *comparison* against one is not — and the client's mapper is what turns it back |
 * | `null` relation | `null`, not `undefined` | `undefined` disappears from JSON, so the client cannot tell "no building" from "field not selected" |
 * | nested selects | flat refs | a screen that reads `row.discipline.defaultColour` is coupled to a select two layers away |
 *
 * **There is no `Decimal` in this module**, which is worth noting rather than
 * assuming: `copies` is an `Int` and there is no money here at all. The day a
 * plan gains a price, it crosses as a string — see `toDecision` in the module
 * before this one.
 */

/* ================================================================== */
/* Selects                                                             */
/* ================================================================== */

const personSelect = {
  select: { id: true, firstName: true, lastName: true, email: true },
} as const;

function person(
  row: { id: string; firstName: string; lastName: string; email: string } | null,
): { id: string; name: string; email: string } | null {
  return row ? { id: row.id, name: `${row.firstName} ${row.lastName}`, email: row.email } : null;
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** The list row. Deliberately shallower than the detail — see `drawingDetailSelect`. */
export const drawingSelect = {
  id: true,
  number: true,
  title: true,
  type: true,
  scale: true,
  format: true,
  phase: true,
  status: true,
  currentRevision: true,
  issuedRevision: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  projectId: true,
  disciplineId: true,
  buildingId: true,
  drawnById: true,
  checkedById: true,
  approvedById: true,
  project: { select: { id: true, number: true, name: true } },
  discipline: { select: { id: true, code: true, name: true, defaultColour: true } },
  building: { select: { id: true, number: true, name: true } },
  drawnBy: personSelect,
  checkedBy: personSelect,
  approvedBy: personSelect,
  _count: { select: { revisions: true } },
} satisfies Prisma.DrawingSelect;

type DrawingRow = Prisma.DrawingGetPayload<{ select: typeof drawingSelect }>;

export function toDrawing(row: DrawingRow) {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    type: row.type,
    scale: row.scale,
    format: row.format,
    phase: row.phase,
    status: row.status,
    currentRevision: row.currentRevision,
    issuedRevision: row.issuedRevision,
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    project: row.project && { ...row.project },
    discipline: row.discipline && {
      id: row.discipline.id,
      code: row.discipline.code,
      name: row.discipline.name,
      // Flattened to `colour`, and it is a **token name** (`disc-air`), never a
      // hex literal — a Lüftung run has to be the same colour on a plan, in a
      // schedule and in the 3D scene, and a literal is the one colour that
      // cannot answer to dark mode.
      colour: row.discipline.defaultColour,
    },
    building: row.building && { ...row.building },
    drawnBy: person(row.drawnBy),
    checkedBy: person(row.checkedBy),
    approvedBy: person(row.approvedBy),
    counts: { revisions: row._count.revisions },
  };
}

export const revisionSelect = {
  id: true,
  drawingId: true,
  revision: true,
  changeNote: true,
  reason: true,
  storageKey: true,
  fileName: true,
  size: true,
  checksum: true,
  mimeType: true,
  releasedAt: true,
  supersededAt: true,
  createdAt: true,
  drawnBy: personSelect,
  checkedBy: personSelect,
  approvedBy: personSelect,
} satisfies Prisma.DrawingRevisionSelect;

type RevisionRow = Prisma.DrawingRevisionGetPayload<{ select: typeof revisionSelect }>;

export function toRevision(row: RevisionRow) {
  return {
    id: row.id,
    drawingId: row.drawingId,
    revision: row.revision,
    changeNote: row.changeNote,
    reason: row.reason,
    fileName: row.fileName,
    size: row.size,
    mimeType: row.mimeType,
    /**
     * `checksum` crosses and `storageKey` does **not**.
     *
     * The checksum is how somebody verifies the file they downloaded is the
     * file that was issued, which is exactly the question a Planversand exists
     * to answer. The storage key is an internal path; putting it on the wire
     * invites a client to construct a URL and bypass the authenticated
     * download — the same reason the dossier route does not expose one.
     */
    checksum: row.checksum,
    releasedAt: iso(row.releasedAt),
    supersededAt: iso(row.supersededAt),
    createdAt: iso(row.createdAt),
    drawnBy: person(row.drawnBy),
    checkedBy: person(row.checkedBy),
    approvedBy: person(row.approvedBy),
  };
}

/** The detail: the plan plus its whole revision history, newest first. */
export const drawingDetailSelect = {
  ...drawingSelect,
  createdById: true,
  updatedById: true,
  revisions: { select: revisionSelect, orderBy: { createdAt: "desc" } },
} satisfies Prisma.DrawingSelect;

type DrawingDetailRow = Prisma.DrawingGetPayload<{ select: typeof drawingDetailSelect }>;

export function toDrawingDetail(row: DrawingDetailRow) {
  return {
    ...toDrawing(row),
    projectId: row.projectId,
    disciplineId: row.disciplineId,
    buildingId: row.buildingId,
    drawnById: row.drawnById,
    checkedById: row.checkedById,
    approvedById: row.approvedById,
    createdById: row.createdById,
    updatedById: row.updatedById,
    revisions: row.revisions.map(toRevision),
  };
}

/** One revision as the cross-plan list returns it — with its drawing. */
export const protocolRevisionSelect = {
  ...revisionSelect,
  drawing: {
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      project: { select: { id: true, number: true, name: true } },
      discipline: { select: { id: true, code: true, name: true, defaultColour: true } },
    },
  },
} satisfies Prisma.DrawingRevisionSelect;

type ListedRevisionRow = Prisma.DrawingRevisionGetPayload<{
  select: typeof protocolRevisionSelect;
}>;

export function toListedRevision(row: ListedRevisionRow) {
  return {
    ...toRevision(row),
    drawing: {
      id: row.drawing.id,
      number: row.drawing.number,
      title: row.drawing.title,
      status: row.drawing.status,
      project: row.drawing.project && { ...row.drawing.project },
      discipline: row.drawing.discipline && {
        id: row.drawing.discipline.id,
        code: row.drawing.discipline.code,
        name: row.drawing.discipline.name,
        colour: row.drawing.discipline.defaultColour,
      },
    },
  };
}

/* ================================================================== */
/* Planversand                                                         */
/* ================================================================== */

export const transmittalSelect = {
  id: true,
  number: true,
  sentAt: true,
  purpose: true,
  medium: true,
  note: true,
  createdAt: true,
  projectId: true,
  project: { select: { id: true, number: true, name: true } },
  sentBy: personSelect,
  _count: { select: { items: true, recipients: true } },
} satisfies Prisma.TransmittalSelect;

type TransmittalRow = Prisma.TransmittalGetPayload<{ select: typeof transmittalSelect }>;

export function toTransmittal(row: TransmittalRow) {
  return {
    id: row.id,
    number: row.number,
    sentAt: iso(row.sentAt)!,
    purpose: row.purpose,
    medium: row.medium,
    note: row.note,
    createdAt: iso(row.createdAt),
    project: row.project && { ...row.project },
    sentBy: person(row.sentBy),
    counts: { items: row._count.items, recipients: row._count.recipients },
  };
}

export const transmittalDetailSelect = {
  ...transmittalSelect,
  createdById: true,
  items: {
    select: {
      id: true,
      copies: true,
      format: true,
      drawingRevision: {
        select: {
          id: true,
          revision: true,
          fileName: true,
          releasedAt: true,
          supersededAt: true,
          drawing: {
            select: {
              id: true,
              number: true,
              title: true,
              discipline: { select: { id: true, code: true, name: true, defaultColour: true } },
            },
          },
        },
      },
    },
  },
  recipients: {
    select: {
      id: true,
      role: true,
      acknowledgedAt: true,
      externalName: true,
      externalOrg: true,
      externalMail: true,
      employee: personSelect,
    },
  },
} satisfies Prisma.TransmittalSelect;

type TransmittalDetailRow = Prisma.TransmittalGetPayload<{
  select: typeof transmittalDetailSelect;
}>;

export function toTransmittalDetail(row: TransmittalDetailRow) {
  return {
    ...toTransmittal(row),
    projectId: row.projectId,
    createdById: row.createdById,
    items: row.items.map((item) => ({
      id: item.id,
      copies: item.copies,
      format: item.format,
      revisionId: item.drawingRevision.id,
      revision: item.drawingRevision.revision,
      fileName: item.drawingRevision.fileName,
      releasedAt: iso(item.drawingRevision.releasedAt),
      /**
       * Sent with the item because it is the fact that goes stale *after* the
       * transmittal: a revision superseded since it was issued is exactly the
       * row somebody needs flagged when they open an old Planversand.
       */
      supersededAt: iso(item.drawingRevision.supersededAt),
      drawing: {
        id: item.drawingRevision.drawing.id,
        number: item.drawingRevision.drawing.number,
        title: item.drawingRevision.drawing.title,
        discipline: item.drawingRevision.drawing.discipline && {
          id: item.drawingRevision.drawing.discipline.id,
          code: item.drawingRevision.drawing.discipline.code,
          name: item.drawingRevision.drawing.discipline.name,
          colour: item.drawingRevision.drawing.discipline.defaultColour,
        },
      },
    })),
    recipients: row.recipients.map((recipient) => ({
      id: recipient.id,
      role: recipient.role,
      acknowledgedAt: iso(recipient.acknowledgedAt),
      employee: person(recipient.employee),
      externalName: recipient.externalName,
      externalOrg: recipient.externalOrg,
      externalMail: recipient.externalMail,
      /**
       * What a Planversand prints, whichever kind of recipient it is —
       * assembled once here rather than in every list, badge and warning.
       * `MeetingAttendee.name` does the same, and the day three call sites
       * concatenated it themselves is the day one of them printed "null".
       */
      name: recipient.employee
        ? `${recipient.employee.firstName} ${recipient.employee.lastName}`
        : (recipient.externalName ?? "—"),
      organisation: recipient.employee ? null : recipient.externalOrg,
    })),
  };
}

/* ================================================================== */
/* The other direction: DTO → Prisma data                              */
/* ================================================================== */

export function toDrawingCreateData(
  dto: CreateDrawingDto,
  userId: string | null,
): Prisma.DrawingUncheckedCreateInput {
  return {
    number: dto.number.trim(),
    title: dto.title.trim(),
    projectId: dto.projectId,
    disciplineId: dto.disciplineId,
    type: dto.type,
    scale: dto.scale?.trim() || null,
    format: dto.format,
    phase: dto.phase ?? null,
    buildingId: dto.buildingId ?? null,
    drawnById: dto.drawnById ?? null,
    createdById: userId,
    updatedById: userId,
  };
}

/**
 * **Scalar fields only, and that is forced rather than preferred.**
 *
 * The optimistic lock needs the version inside the `where`, only `updateMany`
 * allows that, and `updateMany` has no relation operations at all — a
 * `discipline: { connect: … }` here is rejected at runtime with *Unknown
 * argument `discipline`* while typechecking perfectly. `toProjectUpdateData`
 * carries the same note and the same scar.
 */
export function toDrawingUpdateData(
  dto: UpdateDrawingDto,
  userId: string | null,
): Prisma.DrawingUncheckedUpdateInput {
  const data: Prisma.DrawingUncheckedUpdateInput = { updatedById: userId };

  if (dto.number !== undefined) data.number = dto.number.trim();
  if (dto.title !== undefined) data.title = dto.title.trim();
  if (dto.type !== undefined) data.type = dto.type;
  if (dto.scale !== undefined) data.scale = dto.scale?.trim() || null;
  if (dto.format !== undefined) data.format = dto.format;
  if (dto.phase !== undefined) data.phase = dto.phase;
  if (dto.disciplineId !== undefined) data.disciplineId = dto.disciplineId;
  if (dto.buildingId !== undefined) data.buildingId = dto.buildingId;
  if (dto.drawnById !== undefined) data.drawnById = dto.drawnById;
  if (dto.checkedById !== undefined) data.checkedById = dto.checkedById;
  if (dto.approvedById !== undefined) data.approvedById = dto.approvedById;

  return data;
}

export function toRevisionCreateData(
  dto: CreateRevisionDto,
  drawingId: string,
  revision: string,
  userId: string | null,
): Prisma.DrawingRevisionUncheckedCreateInput {
  return {
    drawingId,
    revision,
    changeNote: dto.changeNote.trim(),
    reason: dto.reason,
    storageKey: dto.storageKey,
    fileName: dto.fileName,
    size: dto.size,
    checksum: dto.checksum,
    mimeType: dto.mimeType,
    drawnById: dto.drawnById ?? null,
    checkedById: dto.checkedById ?? null,
    createdById: userId,
  };
}

export function toTransmittalCreateData(
  dto: CreateTransmittalDto,
  number: string,
  sentById: string | null,
  userId: string | null,
): Prisma.TransmittalUncheckedCreateInput {
  return {
    number,
    projectId: dto.projectId,
    sentAt: dto.sentAt ? new Date(dto.sentAt) : new Date(),
    sentById,
    purpose: dto.purpose,
    medium: dto.medium,
    note: dto.note?.trim() || null,
    createdById: userId,
  };
}

/**
 * The snapshot stored in `EntityVersion`.
 *
 * **The mapped record, never the Prisma row** — so a document read in five
 * years does not depend on a schema that has since changed. The revisions are
 * deliberately left out: they are append-only and have their own history, and a
 * version payload that grew with every revision would be the same bytes stored
 * twice.
 */
export function toDrawingSnapshot(row: DrawingDetailRow) {
  const { revisions: _revisions, ...rest } = toDrawingDetail(row);
  return rest;
}
