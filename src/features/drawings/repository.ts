import {
  download,
  listQuery,
  request,
  type Filter,
  type Paginated,
  type QueryValue,
  type SortDirection,
} from "@/core/api";
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
  RevisionDto,
  TransmittalDetailDto,
  TransmittalDto,
  TransmittalResultDto,
  UpdateDrawingBody,
  VersionDto,
} from "./dto";

/**
 * Every request this feature makes, and the only place a URL appears.
 *
 * **One repository for two resources**, as Sitzungen has: `/drawings` and
 * `/transmittals` are one module, and a second repository would be a second
 * place that knows how this feature talks to the API.
 *
 * The screen's vocabulary becomes the contract's here and nowhere else — a
 * screen asks for `{ discipline: "LFT" }` and never learns that it becomes
 * `filter[discipline]=eq:LFT`.
 */

/** The query the plan register speaks — domain words, not the wire's. */
export type DrawingQuery = {
  search?: string;
  status?: string;
  statuses?: string[];
  type?: string;
  format?: string;
  phase?: string;
  projectId?: string;
  project?: string;
  disciplineId?: string;
  discipline?: string;
  buildingId?: string;
  drawnById?: string;
  checkedById?: string;
  /**
   * Everything still in play — `WIP` through `ISSUED`.
   *
   * A flag on this side rather than a server filter, because the server has no
   * `live` key: it is an `in` over five statuses, and `toQuery` is the only
   * thing that needs to know which five. A second definition on the server
   * would be one that can disagree with this one.
   */
  live?: boolean;
  sort?: { field: string; dir: SortDirection };
  page?: number;
  perPage?: number;
};

const LIVE = ["WIP", "IN_CHECK", "CHECKED", "RELEASED", "ISSUED"];

function toQuery(query: DrawingQuery): Record<string, QueryValue> {
  const filters: Filter[] = [];

  if (query.live) {
    filters.push({ field: "status", op: "in", value: LIVE.join(",") });
  } else if (query.statuses?.length) {
    filters.push({ field: "status", op: "in", value: query.statuses.join(",") });
  } else if (query.status) {
    filters.push({ field: "status", op: "eq", value: query.status });
  }

  if (query.type) filters.push({ field: "type", op: "eq", value: query.type });
  if (query.format) filters.push({ field: "format", op: "eq", value: query.format });
  if (query.phase) filters.push({ field: "phase", op: "eq", value: query.phase });
  if (query.projectId) filters.push({ field: "projectId", op: "eq", value: query.projectId });
  if (query.project) filters.push({ field: "project", op: "like", value: query.project });
  if (query.disciplineId) filters.push({ field: "disciplineId", op: "eq", value: query.disciplineId });
  // `eq`, not `like`: a Gewerk code is `LFT`, and a substring match would make
  // a search for `EL` return Elektro and Lüftung alike.
  if (query.discipline) filters.push({ field: "discipline", op: "eq", value: query.discipline });
  if (query.buildingId) filters.push({ field: "buildingId", op: "eq", value: query.buildingId });
  if (query.drawnById) filters.push({ field: "drawnById", op: "eq", value: query.drawnById });
  if (query.checkedById) filters.push({ field: "checkedById", op: "eq", value: query.checkedById });

  return listQuery({
    page: query.page,
    perPage: query.perPage,
    q: query.search,
    sort: query.sort,
    filters,
  });
}

/** The query the cross-plan revision view speaks. */
export type RevisionQuery = {
  search?: string;
  drawingId?: string;
  projectId?: string;
  reason?: string;
  discipline?: string;
  drawnById?: string;
  /** `true` for revisions that have been released, `false` for those not. */
  released?: boolean;
  /** `false` hides history — the default a reader wants. */
  superseded?: boolean;
  sort?: { field: string; dir: SortDirection };
  page?: number;
  perPage?: number;
};

function toRevisionQuery(query: RevisionQuery): Record<string, QueryValue> {
  const filters: Filter[] = [];

  if (query.drawingId) filters.push({ field: "drawingId", op: "eq", value: query.drawingId });
  if (query.projectId) filters.push({ field: "projectId", op: "eq", value: query.projectId });
  if (query.reason) filters.push({ field: "reason", op: "eq", value: query.reason });
  if (query.discipline) filters.push({ field: "discipline", op: "eq", value: query.discipline });
  if (query.drawnById) filters.push({ field: "drawnById", op: "eq", value: query.drawnById });

  // Both are `isnull` against a timestamp, and both invert — the shape that is
  // right once and then quietly wrong after a refactor, which is why
  // `__tests__/repository.test.ts` asserts each in both directions.
  if (query.released !== undefined) {
    filters.push({ field: "releasedAt", op: "isnull", value: query.released ? "false" : "true" });
  }
  if (query.superseded !== undefined) {
    filters.push({ field: "supersededAt", op: "isnull", value: query.superseded ? "false" : "true" });
  }

  return listQuery({
    page: query.page,
    perPage: query.perPage,
    q: query.search,
    sort: query.sort,
    filters,
  });
}

/** The query the Planversand list speaks. */
export type TransmittalQuery = {
  search?: string;
  projectId?: string;
  project?: string;
  purpose?: string;
  medium?: string;
  sentById?: string;
  recipient?: string;
  sentAfter?: string;
  sort?: { field: string; dir: SortDirection };
  page?: number;
  perPage?: number;
};

function toTransmittalQuery(query: TransmittalQuery): Record<string, QueryValue> {
  const filters: Filter[] = [];

  if (query.projectId) filters.push({ field: "projectId", op: "eq", value: query.projectId });
  if (query.project) filters.push({ field: "project", op: "like", value: query.project });
  if (query.purpose) filters.push({ field: "purpose", op: "eq", value: query.purpose });
  if (query.medium) filters.push({ field: "medium", op: "eq", value: query.medium });
  if (query.sentById) filters.push({ field: "sentById", op: "eq", value: query.sentById });
  if (query.recipient) filters.push({ field: "recipient", op: "like", value: query.recipient });
  if (query.sentAfter) filters.push({ field: "sentAt", op: "gte", value: query.sentAfter });

  return listQuery({
    page: query.page,
    perPage: query.perPage,
    q: query.search,
    sort: query.sort,
    filters,
  });
}

export const drawingRepository = {
  /* ---- Plans -------------------------------------------------------- */

  list: (query: DrawingQuery) =>
    request<Paginated<DrawingDto>>("/drawings", { query: toQuery(query) }),

  get: (id: string) => request<DrawingDetailDto>(`/drawings/${id}`),

  stats: () => request<DrawingStatsDto>("/drawings/stats"),

  create: (body: CreateDrawingBody) =>
    request<DrawingDetailDto>("/drawings", { method: "POST", body }),

  update: (id: string, body: UpdateDrawingBody) =>
    request<DrawingDetailDto>(`/drawings/${id}`, { method: "PATCH", body }),

  changeStatus: (id: string, body: ChangeDrawingStatusBody) =>
    request<DrawingDetailDto>(`/drawings/${id}/status`, { method: "PUT", body }),

  remove: (id: string) => request<{ ok: boolean }>(`/drawings/${id}`, { method: "DELETE" }),

  history: (id: string) => request<VersionDto[]>(`/drawings/${id}/versions`),

  exportCsv: (query: DrawingQuery) =>
    download("/drawings/export", {
      query: toQuery(query),
      fallbackName: `plaene-${new Date().toISOString().slice(0, 10)}.csv`,
    }),

  /* ---- Revisions ---------------------------------------------------- */

  revisions: (query: RevisionQuery) =>
    request<Paginated<ListedRevisionDto>>("/drawings/revisions", {
      query: toRevisionQuery(query),
    }),

  createRevision: (drawingId: string, body: CreateRevisionBody) =>
    request<RevisionDto>(`/drawings/${drawingId}/revisions`, { method: "POST", body }),

  /* ---- Planversand -------------------------------------------------- */

  listTransmittals: (query: TransmittalQuery) =>
    request<Paginated<TransmittalDto>>("/transmittals", { query: toTransmittalQuery(query) }),

  getTransmittal: (id: string) => request<TransmittalDetailDto>(`/transmittals/${id}`),

  /**
   * Issuing plans. The response carries the **record and the warnings**, which
   * is why it has a type of its own rather than being a `TransmittalDetailDto`.
   */
  createTransmittal: (body: CreateTransmittalBody) =>
    request<TransmittalResultDto>("/transmittals", { method: "POST", body }),

  acknowledge: (id: string, body: AcknowledgeBody) =>
    request<TransmittalDetailDto>(`/transmittals/${id}/acknowledge`, { method: "POST", body }),

  exportTransmittalsCsv: (query: TransmittalQuery) =>
    download("/transmittals/export", {
      query: toTransmittalQuery(query),
      fallbackName: `planversand-${new Date().toISOString().slice(0, 10)}.csv`,
    }),

  /* ---- The pickers --------------------------------------------------- */

  /**
   * Master data this feature does not own, called **directly**.
   *
   * A repository may know any endpoint; `architecture.test.ts` refuses a
   * feature importing a sibling's repository. Two repositories calling one
   * endpoint is duplication, one feature reaching into another is a mesh.
   */
  projectOptions: (search?: string) =>
    request<Paginated<{ id: string; number: string; name: string }>>("/projects", {
      query: listQuery({ q: search, perPage: 20, sort: { field: "name", dir: "asc" } }),
    }),

  employeeOptions: (search?: string) =>
    request<Paginated<{ id: string; name: string; email: string; position: string | null }>>(
      "/employees",
      {
        query: listQuery({
          q: search,
          perPage: 50,
          sort: { field: "lastName", dir: "asc" },
          filters: [{ field: "status", op: "eq", value: "ACTIVE" }],
        }),
      },
    ),

  disciplineOptions: () =>
    request<{ id: string; code: string; name: string; colour: string }[]>("/disciplines"),

  buildingOptions: (search?: string) =>
    request<Paginated<{ id: string; number: string; name: string }>>("/buildings", {
      query: listQuery({ q: search, perPage: 20, sort: { field: "name", dir: "asc" } }),
    }),
};

export type DrawingRepository = typeof drawingRepository;
