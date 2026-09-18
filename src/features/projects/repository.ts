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
  AddMemberBody,
  BuildingOptionDto,
  ChangeStatusBody,
  CreateMilestoneBody,
  CreateProjectBody,
  CustomerOptionDto,
  DisciplineOptionDto,
  EmployeeOptionDto,
  MilestoneDto,
  ProjectDetailDto,
  ProjectDto,
  ProjectStatsDto,
  ProjectVersionDto,
  ScopeDisciplineBody,
  UpdateMilestoneBody,
  UpdateProjectBody,
} from "./dto";

/**
 * HTTP only. URLs, methods, DTOs — no React, no rules, no mapping.
 *
 * Everything this file knows is which path answers which question. It returns
 * wire shapes; `mapper.ts` turns them into entities. Keeping the two apart is
 * what makes an API change — a renamed field, one endpoint splitting in two —
 * land in two files with millisecond tests instead of in every screen that
 * reads a project.
 */

/**
 * The query the list screen speaks.
 *
 * **Domain words, not the wire's.** A screen asks for `customer: "gemeinde"`
 * and `discipline: "LFT"`; `toQuery` is the only thing that knows those become
 * `filter[customer]=like:gemeinde` and `filter[discipline]=eq:LFT`. That
 * indirection is what F11 bought: when the server's spelling changed, it
 * reached two functions in one file and no screen at all.
 */
export type ProjectQuery = {
  search?: string;
  status?: string;
  /** `in:` — several at once, which is what the status chips produce. */
  statuses?: string[];
  health?: string;
  priority?: string;
  phase?: string;
  customerId?: string;
  /** A name fragment. The id filter exists too; this is the shareable one. */
  customer?: string;
  managerId?: string;
  /** A Gewerk code — `LFT`. Filters across the join. */
  discipline?: string;
  /** ISO `yyyy-mm-dd`. Everything contractually due on or before that date. */
  dueBefore?: string;
  sort?: { field: string; dir: SortDirection };
  page?: number;
  perPage?: number;
};

function toQuery(query: ProjectQuery): Record<string, QueryValue> {
  const filters: Filter[] = [];

  // `in:` when several are selected, `eq:` for one. Both are the same chip
  // control on screen; sending `in:` with a single value would work, and
  // sending `eq:` with several would silently match none.
  if (query.statuses?.length) {
    filters.push({ field: "status", op: "in", value: query.statuses.join(",") });
  } else if (query.status) {
    filters.push({ field: "status", op: "eq", value: query.status });
  }

  if (query.health) filters.push({ field: "health", op: "eq", value: query.health });
  if (query.priority) filters.push({ field: "priority", op: "eq", value: query.priority });
  if (query.phase) filters.push({ field: "currentPhase", op: "eq", value: query.phase });
  if (query.customerId) filters.push({ field: "customerId", op: "eq", value: query.customerId });
  if (query.customer) filters.push({ field: "customer", op: "like", value: query.customer });
  if (query.managerId) filters.push({ field: "managerId", op: "eq", value: query.managerId });
  if (query.discipline) filters.push({ field: "discipline", op: "eq", value: query.discipline });
  if (query.dueBefore) {
    filters.push({ field: "plannedEndDate", op: "lte", value: query.dueBefore });
  }

  return listQuery({
    page: query.page,
    perPage: query.perPage,
    q: query.search,
    sort: query.sort,
    filters,
  });
}

export const projectRepository = {
  list: (query: ProjectQuery) =>
    request<Paginated<ProjectDto>>("/projects", { query: toQuery(query) }),

  get: (id: string) => request<ProjectDetailDto>(`/projects/${id}`),

  stats: () => request<ProjectStatsDto>("/projects/stats"),

  create: (body: CreateProjectBody) =>
    request<ProjectDetailDto>("/projects", { method: "POST", body }),

  update: (id: string, body: UpdateProjectBody) =>
    request<ProjectDetailDto>(`/projects/${id}`, { method: "PATCH", body }),

  /**
   * The transition, on its own route — see the note on `UpdateProjectBody`.
   *
   * `PUT` rather than `PATCH`, because it sets a state rather than merging a
   * change, and the server's own route says so.
   */
  changeStatus: (id: string, body: ChangeStatusBody) =>
    request<ProjectDetailDto>(`/projects/${id}/status`, { method: "PUT", body }),

  /**
   * The record's history, newest first.
   *
   * Without payloads — the server sends the summaries and `versionAt` fetches
   * one in full. Twenty rows of several kilobytes each, so that one might be
   * opened, is the same mistake as an unpaginated list.
   */
  history: (id: string) => request<ProjectVersionDto[]>(`/projects/${id}/versions`),

  versionAt: (id: string, version: number) =>
    request<ProjectVersionDto & { data: unknown }>(`/projects/${id}/versions/${version}`),

  remove: (id: string) => request<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),

  bulkPriority: (ids: string[], priority: string) =>
    request<{ changed: number; requested: number }>("/projects/bulk/priority", {
      method: "POST",
      body: { ids, priority },
    }),

  /**
   * The CSV, for **the same query** the list is showing.
   *
   * Passing the query rather than nothing is the contract, not a convenience:
   * an export that quietly contains more than the filtered view is a document
   * somebody will act on (architecture §7.2).
   */
  exportCsv: (query: ProjectQuery) =>
    download("/projects/export", {
      query: toQuery(query),
      fallbackName: `projekte-${new Date().toISOString().slice(0, 10)}.csv`,
    }),

  /* ---- Sub-resources ---------------------------------------------- */

  addMember: (id: string, body: AddMemberBody) =>
    request<ProjectDetailDto>(`/projects/${id}/members`, { method: "POST", body }),

  removeMember: (id: string, memberId: string) =>
    request<ProjectDetailDto>(`/projects/${id}/members/${memberId}`, { method: "DELETE" }),

  scopeDiscipline: (id: string, body: ScopeDisciplineBody) =>
    request<ProjectDetailDto>(`/projects/${id}/disciplines`, { method: "PUT", body }),

  listMilestones: (id: string, query: { page?: number; perPage?: number } = {}) =>
    request<Paginated<MilestoneDto>>(`/projects/${id}/milestones`, {
      query: listQuery({ page: query.page, perPage: query.perPage }),
    }),

  createMilestone: (id: string, body: CreateMilestoneBody) =>
    request<ProjectDetailDto>(`/projects/${id}/milestones`, { method: "POST", body }),

  updateMilestone: (id: string, milestoneId: string, body: UpdateMilestoneBody) =>
    request<ProjectDetailDto>(`/projects/${id}/milestones/${milestoneId}`, {
      method: "PATCH",
      body,
    }),

  /* ---- The master-data pickers -------------------------------------- */

  /**
   * Four read-only lists this feature does not own.
   *
   * They belong to `customers/`, `buildings/`, `employees/` and `disciplines/`
   * on the server, and each becomes its own client feature in Wave 1 modules
   * 1–3. Calling them from *this* repository is the right place for now, and
   * not a shortcut: a repository is allowed to know any endpoint. What would be
   * wrong is a screen in this feature importing another feature's hooks, which
   * `architecture.test.ts` forbids and which is the thing that actually
   * entangles two modules.
   */
  customerOptions: (search?: string) =>
    request<Paginated<CustomerOptionDto>>("/customers", {
      query: listQuery({ q: search, perPage: 50, sort: { field: "name", dir: "asc" } }),
    }),

  buildingOptions: (search?: string, customerId?: string) =>
    request<Paginated<BuildingOptionDto>>("/buildings", {
      query: listQuery({
        q: search,
        perPage: 50,
        sort: { field: "name", dir: "asc" },
        filters: customerId ? [{ field: "customerId", op: "eq", value: customerId }] : [],
      }),
    }),

  /**
   * Active people only, and the filter is **sent** rather than defaulted on the
   * server. A list that hides rows by default is a list that cannot show a
   * record which exists; the picker states what it wants.
   */
  employeeOptions: (search?: string) =>
    request<Paginated<EmployeeOptionDto>>("/employees", {
      query: listQuery({
        q: search,
        perPage: 50,
        sort: { field: "lastName", dir: "asc" },
        filters: [{ field: "status", op: "eq", value: "ACTIVE" }],
      }),
    }),

  /** Eight rows, so no pagination — see the note on the server's repository. */
  disciplineOptions: () => request<DisciplineOptionDto[]>("/disciplines"),
};

export type ProjectRepository = typeof projectRepository;
