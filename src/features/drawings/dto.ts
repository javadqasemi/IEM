/**
 * The wire shapes, exactly as the API sends and accepts them.
 *
 * **A DTO type may be named in `repository.ts` and `mapper.ts` and nowhere
 * else** — `architecture.test.ts` enforces it, and that rule is what makes the
 * mapper a seam rather than a decoration. A screen that imported one of these
 * would be reading dates as strings and enums as open strings, which is exactly
 * the coupling the layer exists to prevent.
 *
 * Every date is an ISO `string` here and a `Date` on the other side. Every enum
 * is an open `string` here and a closed union there — the server may ship a
 * value this client has never heard of, and `narrow()` in the mapper decides
 * what happens then.
 */

export type PersonDto = { id: string; name: string; email: string };
export type ProjectRefDto = { id: string; number: string; name: string };
export type BuildingRefDto = { id: string; number: string; name: string };
export type DisciplineRefDto = { id: string; code: string; name: string; colour: string };

export type DrawingDto = {
  id: string;
  number: string;
  title: string;
  type: string;
  scale: string | null;
  format: string;
  phase: string | null;
  status: string;
  currentRevision: string | null;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  project: ProjectRefDto | null;
  discipline: DisciplineRefDto | null;
  building: BuildingRefDto | null;
  drawnBy: PersonDto | null;
  checkedBy: PersonDto | null;
  approvedBy: PersonDto | null;
  counts: { revisions: number };
};

export type RevisionDto = {
  id: string;
  drawingId: string;
  revision: string;
  changeNote: string;
  reason: string;
  fileName: string;
  size: number;
  mimeType: string;
  checksum: string;
  releasedAt: string | null;
  supersededAt: string | null;
  createdAt: string | null;
  drawnBy: PersonDto | null;
  checkedBy: PersonDto | null;
  approvedBy: PersonDto | null;
};

export type DrawingDetailDto = DrawingDto & {
  projectId: string;
  disciplineId: string;
  buildingId: string | null;
  drawnById: string | null;
  checkedById: string | null;
  approvedById: string | null;
  createdById: string | null;
  updatedById: string | null;
  revisions: RevisionDto[];
  allowedTransitions: string[];
  readOnly: boolean;
};

export type ListedRevisionDto = RevisionDto & {
  drawing: {
    id: string;
    number: string;
    title: string;
    status: string;
    project: ProjectRefDto | null;
    discipline: DisciplineRefDto | null;
  };
};

export type DrawingStatsDto = {
  byStatus: Record<string, number>;
  total: number;
  awaitingCheck: number;
  released: number;
};

export type TransmittalDto = {
  id: string;
  number: string;
  sentAt: string;
  purpose: string;
  medium: string;
  note: string | null;
  createdAt: string | null;
  project: ProjectRefDto | null;
  sentBy: PersonDto | null;
  counts: { items: number; recipients: number };
};

export type TransmittalDetailDto = TransmittalDto & {
  projectId: string;
  createdById: string | null;
  items: {
    id: string;
    copies: number;
    format: string | null;
    revisionId: string;
    revision: string;
    fileName: string;
    releasedAt: string | null;
    supersededAt: string | null;
    drawing: {
      id: string;
      number: string;
      title: string;
      discipline: DisciplineRefDto | null;
    };
  }[];
  recipients: {
    id: string;
    role: string;
    acknowledgedAt: string | null;
    employee: PersonDto | null;
    externalName: string | null;
    externalOrg: string | null;
    externalMail: string | null;
    name: string;
    organisation: string | null;
  }[];
};

export type PriorIssueDto = {
  recipientLabel: string;
  drawingNumber: string;
  previousRevision: string;
  newRevision: string;
};

/** The create response: the record **and** the warnings, never one or other. */
export type TransmittalResultDto = {
  transmittal: TransmittalDetailDto;
  warnings: PriorIssueDto[];
};

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

export type CreateDrawingBody = {
  number: string;
  title: string;
  projectId: string;
  disciplineId: string;
  type: string;
  scale?: string;
  format?: string;
  phase?: string;
  buildingId?: string;
  drawnById?: string;
};

export type UpdateDrawingBody = {
  /** Never optional. See the note on `toUpdateDrawingBody`. */
  expectedVersion: number;
  versionNote?: string;
  number?: string;
  title?: string;
  type?: string;
  scale?: string | null;
  format?: string;
  phase?: string | null;
  disciplineId?: string;
  buildingId?: string | null;
  drawnById?: string | null;
  checkedById?: string | null;
  approvedById?: string | null;
};

export type ChangeDrawingStatusBody = { status: string; reason?: string };

export type CreateRevisionBody = {
  changeNote: string;
  reason?: string;
  revision?: string;
  drawnById?: string | null;
  checkedById?: string | null;
  storageKey: string;
  fileName: string;
  size: number;
  checksum: string;
  mimeType: string;
};

export type CreateTransmittalBody = {
  projectId: string;
  items: { drawingRevisionId: string; copies?: number; format?: string }[];
  recipients: {
    employeeId?: string;
    externalName?: string;
    externalOrg?: string;
    externalMail?: string;
    role?: string;
  }[];
  sentAt?: string;
  purpose?: string;
  medium?: string;
  note?: string;
};

export type AcknowledgeBody = { recipientId: string; acknowledgedAt?: string };
