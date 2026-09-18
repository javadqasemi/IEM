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
  AddAgendaItemBody,
  AddAttendeeBody,
  AddItemBody,
  ApproveMinutesBody,
  ChangeDecisionStatusBody,
  ChangeMeetingStatusBody,
  CreateDecisionBody,
  CreateMeetingBody,
  DecisionDetailDto,
  DecisionDto,
  DecisionStatsDto,
  MeetingDetailDto,
  MeetingDto,
  MeetingStatsDto,
  ProtocolLineDto,
  RecordAttendanceBody,
  ReorderItemsBody,
  SupersedeDecisionBody,
  UpdateAgendaItemBody,
  UpdateDecisionBody,
  UpdateItemBody,
  UpdateMeetingBody,
  VersionDto,
} from "./dto";

/**
 * HTTP only. URLs, methods, DTOs — no React, no rules, no mapping.
 *
 * Two resources, one repository, mirroring the server: `/meetings` and
 * `/decisions` are one module, and a second repository would be a second place
 * that knows how this feature talks to the API.
 */

/** The query the meeting list speaks — domain words, not the wire's. */
export type MeetingQuery = {
  search?: string;
  status?: string;
  statuses?: string[];
  type?: string;
  projectId?: string;
  project?: string;
  organiserId?: string;
  seriesNumber?: number;
  /**
   * Held, minutes not sent — the Friday queue.
   *
   * A flag on this side rather than a server filter, because the server has no
   * `pending` key: it is `status=HELD` plus `minutesSentAt` being null, and
   * `toQuery` is the only thing that needs to know that. A second definition
   * on the server would be one that can disagree with this one.
   */
  minutesPending?: boolean;
  sort?: { field: string; dir: SortDirection };
  page?: number;
  perPage?: number;
};

function toQuery(query: MeetingQuery): Record<string, QueryValue> {
  const filters: Filter[] = [];

  if (query.minutesPending) {
    filters.push({ field: "status", op: "eq", value: "HELD" });
    filters.push({ field: "minutesSentAt", op: "isnull", value: "true" });
  } else if (query.statuses?.length) {
    filters.push({ field: "status", op: "in", value: query.statuses.join(",") });
  } else if (query.status) {
    filters.push({ field: "status", op: "eq", value: query.status });
  }

  if (query.type) filters.push({ field: "type", op: "eq", value: query.type });
  if (query.projectId) filters.push({ field: "projectId", op: "eq", value: query.projectId });
  if (query.project) filters.push({ field: "project", op: "like", value: query.project });
  if (query.organiserId) filters.push({ field: "organiserId", op: "eq", value: query.organiserId });
  if (query.seriesNumber !== undefined) {
    filters.push({ field: "seriesNumber", op: "eq", value: query.seriesNumber });
  }

  return listQuery({
    page: query.page,
    perPage: query.perPage,
    q: query.search,
    sort: query.sort,
    filters,
  });
}

/** The query the cross-meeting protocol view speaks. */
export type ProtocolQuery = {
  search?: string;
  kind?: string;
  disciplineId?: string;
  discipline?: string;
  responsibleId?: string;
  /** `true` for lines that became tasks, `false` for those that did not. */
  hasTask?: boolean;
  dueBefore?: string;
  sort?: { field: string; dir: SortDirection };
  page?: number;
  perPage?: number;
};

function toProtocolQuery(query: ProtocolQuery): Record<string, QueryValue> {
  const filters: Filter[] = [];
  if (query.kind) filters.push({ field: "kind", op: "eq", value: query.kind });
  if (query.disciplineId) filters.push({ field: "disciplineId", op: "eq", value: query.disciplineId });
  if (query.discipline) filters.push({ field: "discipline", op: "eq", value: query.discipline });
  if (query.responsibleId) {
    filters.push({ field: "responsibleId", op: "eq", value: query.responsibleId });
  }
  if (query.hasTask !== undefined) {
    filters.push({ field: "taskId", op: "isnull", value: query.hasTask ? "false" : "true" });
  }
  if (query.dueBefore) filters.push({ field: "dueDate", op: "lte", value: query.dueBefore });

  return listQuery({
    page: query.page,
    perPage: query.perPage,
    q: query.search,
    sort: query.sort,
    filters,
  });
}

/** The query the decision list speaks. */
export type DecisionQuery = {
  search?: string;
  status?: string;
  statuses?: string[];
  type?: string;
  impact?: string;
  projectId?: string;
  project?: string;
  meetingId?: string;
  disciplineId?: string;
  discipline?: string;
  /** `true` for decisions that reversed another. */
  isReversal?: boolean;
  sort?: { field: string; dir: SortDirection };
  page?: number;
  perPage?: number;
};

function toDecisionQuery(query: DecisionQuery): Record<string, QueryValue> {
  const filters: Filter[] = [];

  if (query.statuses?.length) {
    filters.push({ field: "status", op: "in", value: query.statuses.join(",") });
  } else if (query.status) {
    filters.push({ field: "status", op: "eq", value: query.status });
  }

  if (query.type) filters.push({ field: "type", op: "eq", value: query.type });
  if (query.impact) filters.push({ field: "impact", op: "eq", value: query.impact });
  if (query.projectId) filters.push({ field: "projectId", op: "eq", value: query.projectId });
  if (query.project) filters.push({ field: "project", op: "like", value: query.project });
  if (query.meetingId) filters.push({ field: "meetingId", op: "eq", value: query.meetingId });
  if (query.disciplineId) filters.push({ field: "disciplineId", op: "eq", value: query.disciplineId });
  if (query.discipline) filters.push({ field: "discipline", op: "eq", value: query.discipline });
  if (query.isReversal !== undefined) {
    filters.push({ field: "supersedesId", op: "isnull", value: query.isReversal ? "false" : "true" });
  }

  return listQuery({
    page: query.page,
    perPage: query.perPage,
    q: query.search,
    sort: query.sort,
    filters,
  });
}

export const meetingRepository = {
  /* ---- Meetings ---------------------------------------------------- */

  list: (query: MeetingQuery) =>
    request<Paginated<MeetingDto>>("/meetings", { query: toQuery(query) }),

  get: (id: string) => request<MeetingDetailDto>(`/meetings/${id}`),

  stats: () => request<MeetingStatsDto>("/meetings/stats"),

  create: (body: CreateMeetingBody) =>
    request<MeetingDetailDto>("/meetings", { method: "POST", body }),

  update: (id: string, body: UpdateMeetingBody) =>
    request<MeetingDetailDto>(`/meetings/${id}`, { method: "PATCH", body }),

  /** `PUT`, because it sets a state rather than merging a change. */
  changeStatus: (id: string, body: ChangeMeetingStatusBody) =>
    request<MeetingDetailDto>(`/meetings/${id}/status`, { method: "PUT", body }),

  remove: (id: string) => request<{ ok: boolean }>(`/meetings/${id}`, { method: "DELETE" }),

  exportCsv: (query: MeetingQuery) =>
    download("/meetings/export", {
      query: toQuery(query),
      fallbackName: `sitzungen-${new Date().toISOString().slice(0, 10)}.csv`,
    }),

  /* ---- Attendees ---------------------------------------------------- */

  addAttendee: (id: string, body: AddAttendeeBody) =>
    request<MeetingDetailDto>(`/meetings/${id}/attendees`, { method: "POST", body }),

  removeAttendee: (id: string, attendeeId: string) =>
    request<MeetingDetailDto>(`/meetings/${id}/attendees/${attendeeId}`, { method: "DELETE" }),

  /**
   * The whole room at once.
   *
   * `PUT`, because recording attendance twice must be the same room rather than
   * two rooms — and one request rather than twelve, so one act makes one audit
   * row.
   */
  recordAttendance: (id: string, body: RecordAttendanceBody) =>
    request<MeetingDetailDto>(`/meetings/${id}/attendance`, { method: "PUT", body }),

  /* ---- Agenda -------------------------------------------------------- */

  addAgendaItem: (id: string, body: AddAgendaItemBody) =>
    request<MeetingDetailDto>(`/meetings/${id}/agenda`, { method: "POST", body }),

  updateAgendaItem: (id: string, itemId: string, body: UpdateAgendaItemBody) =>
    request<MeetingDetailDto>(`/meetings/${id}/agenda/${itemId}`, { method: "PATCH", body }),

  removeAgendaItem: (id: string, itemId: string) =>
    request<MeetingDetailDto>(`/meetings/${id}/agenda/${itemId}`, { method: "DELETE" }),

  /* ---- Protocol ------------------------------------------------------ */

  addItem: (id: string, body: AddItemBody) =>
    request<MeetingDetailDto>(`/meetings/${id}/items`, { method: "POST", body }),

  updateItem: (id: string, itemId: string, body: UpdateItemBody) =>
    request<MeetingDetailDto>(`/meetings/${id}/items/${itemId}`, { method: "PATCH", body }),

  removeItem: (id: string, itemId: string) =>
    request<MeetingDetailDto>(`/meetings/${id}/items/${itemId}`, { method: "DELETE" }),

  /** The whole protocol or nothing — a partial order is refused. */
  reorderItems: (id: string, body: ReorderItemsBody) =>
    request<MeetingDetailDto>(`/meetings/${id}/items/order`, { method: "PUT", body }),

  /**
   * Protocol lines across every meeting the caller may see.
   *
   * *"Alle offenen Pendenzen für Lüftung über alle Bausitzungen"* — a top-level
   * route rather than a per-meeting one, because the question is asked across
   * them.
   */
  protocolLines: (query: ProtocolQuery) =>
    request<Paginated<ProtocolLineDto>>("/meetings/items", { query: toProtocolQuery(query) }),

  bulkDiscipline: (ids: string[], disciplineId: string | null) =>
    request<{ changed: number; requested: number }>("/meetings/items/bulk", {
      method: "POST",
      body: { ids, disciplineId },
    }),

  /* ---- Approval and minutes ------------------------------------------ */

  approve: (id: string, body: ApproveMinutesBody) =>
    request<MeetingDetailDto>(`/meetings/${id}/approval`, { method: "POST", body }),

  sendMinutes: (id: string) =>
    request<MeetingDetailDto>(`/meetings/${id}/minutes/sent`, { method: "POST", body: {} }),

  history: (id: string) => request<VersionDto[]>(`/meetings/${id}/versions`),

  /* ---- Decisions ------------------------------------------------------ */

  listDecisions: (query: DecisionQuery) =>
    request<Paginated<DecisionDto>>("/decisions", { query: toDecisionQuery(query) }),

  getDecision: (id: string) => request<DecisionDetailDto>(`/decisions/${id}`),

  decisionStats: () => request<DecisionStatsDto>("/decisions/stats"),

  createDecision: (body: CreateDecisionBody) =>
    request<DecisionDetailDto>("/decisions", { method: "POST", body }),

  updateDecision: (id: string, body: UpdateDecisionBody) =>
    request<DecisionDetailDto>(`/decisions/${id}`, { method: "PATCH", body }),

  changeDecisionStatus: (id: string, body: ChangeDecisionStatusBody) =>
    request<DecisionDetailDto>(`/decisions/${id}/status`, { method: "PUT", body }),

  /**
   * Reversing a decision, sent to the **new** one and naming the old.
   *
   * The direction is what makes `AUFGEHOBEN` a verifiable fact rather than a
   * claim: the route always leaves a successor attached.
   */
  supersede: (id: string, body: SupersedeDecisionBody) =>
    request<DecisionDetailDto>(`/decisions/${id}/supersedes`, { method: "POST", body }),

  removeDecision: (id: string) => request<{ ok: boolean }>(`/decisions/${id}`, { method: "DELETE" }),

  decisionHistory: (id: string) => request<VersionDto[]>(`/decisions/${id}/versions`),

  exportDecisionsCsv: (query: DecisionQuery) =>
    download("/decisions/export", {
      query: toDecisionQuery(query),
      fallbackName: `entscheide-${new Date().toISOString().slice(0, 10)}.csv`,
    }),

  /* ---- The pickers ----------------------------------------------------- */

  /**
   * Three read-only lists this feature does not own.
   *
   * Called directly, like `tasks/repository.ts` does, and not through another
   * feature's repository: **a repository may know any endpoint**, and
   * `architecture.test.ts` refuses a feature importing a sibling. Two
   * repositories calling one endpoint is duplication; one feature reaching into
   * another is a mesh.
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
};

export type MeetingRepository = typeof meetingRepository;
