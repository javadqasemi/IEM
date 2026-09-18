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
  AddChecklistItemBody,
  AddCommentBody,
  AddDependencyBody,
  AssignTaskBody,
  ChangeTaskStatusBody,
  ChecklistItemDto,
  CreateTaskBody,
  MoveTaskBody,
  TaskCommentDto,
  TaskDetailDto,
  TaskDto,
  TaskStatsDto,
  TaskVersionDto,
  UpdateChecklistItemBody,
  UpdateTaskBody,
} from "./dto";

/**
 * HTTP only. URLs, methods, DTOs — no React, no rules, no mapping.
 *
 * Everything this file knows is which path answers which question. It returns
 * wire shapes; `mapper.ts` turns them into entities. Keeping the two apart is
 * what makes an API change land in two files with millisecond tests instead of
 * in every screen that renders a task.
 */

/**
 * The query the list and the board speak.
 *
 * **Domain words, not the wire's.** A screen asks for `assignee: "meier"` and
 * `discipline: "LFT"`; `toQuery` is the only thing that knows those become
 * `filter[assignee]=like:meier` and `filter[discipline]=eq:LFT`.
 */
export type TaskQuery = {
  search?: string;
  status?: string;
  /** `in:` — several at once, which is what the status chips produce. */
  statuses?: string[];
  priority?: string;
  projectId?: string;
  /** A name fragment. The id filter exists too; this is the shareable one. */
  project?: string;
  assigneeId?: string;
  assignee?: string;
  milestoneId?: string;
  /** A Gewerk code — `LFT`. */
  discipline?: string;
  /**
   * `"root"` for the top level of the tree, an id for one task's children.
   *
   * A board must show top-level cards only, or every subtask appears as a card
   * beside its parent. The sentinel is a *word* rather than `null`, because
   * `undefined` already means "do not filter" and a third state needs a third
   * value that survives a URL.
   */
  parent?: "root" | (string & {});
  /** ISO `yyyy-mm-dd`. Everything due on or before that date. */
  dueBefore?: string;
  sort?: { field: string; dir: SortDirection };
  page?: number;
  perPage?: number;
};

function toQuery(query: TaskQuery): Record<string, QueryValue> {
  const filters: Filter[] = [];

  // `in:` when several are selected, `eq:` for one. Both are the same chip
  // control on screen; sending `in:` with a single value would work, and
  // sending `eq:` with several would silently match none.
  if (query.statuses?.length) {
    filters.push({ field: "status", op: "in", value: query.statuses.join(",") });
  } else if (query.status) {
    filters.push({ field: "status", op: "eq", value: query.status });
  }

  if (query.priority) filters.push({ field: "priority", op: "eq", value: query.priority });
  if (query.projectId) filters.push({ field: "projectId", op: "eq", value: query.projectId });
  if (query.project) filters.push({ field: "project", op: "like", value: query.project });
  if (query.assigneeId) filters.push({ field: "assigneeId", op: "eq", value: query.assigneeId });
  if (query.assignee) filters.push({ field: "assignee", op: "like", value: query.assignee });
  if (query.milestoneId) filters.push({ field: "milestoneId", op: "eq", value: query.milestoneId });
  if (query.discipline) filters.push({ field: "discipline", op: "eq", value: query.discipline });
  if (query.dueBefore) filters.push({ field: "dueDate", op: "lte", value: query.dueBefore });

  if (query.parent === "root") {
    filters.push({ field: "parentTaskId", op: "isnull", value: "true" });
  } else if (query.parent) {
    filters.push({ field: "parentTaskId", op: "eq", value: query.parent });
  }

  return listQuery({
    page: query.page,
    perPage: query.perPage,
    q: query.search,
    sort: query.sort,
    filters,
  });
}

export const taskRepository = {
  list: (query: TaskQuery) => request<Paginated<TaskDto>>("/tasks", { query: toQuery(query) }),

  get: (id: string) => request<TaskDetailDto>(`/tasks/${id}`),

  stats: () => request<TaskStatsDto>("/tasks/stats"),

  create: (body: CreateTaskBody) => request<TaskDetailDto>("/tasks", { method: "POST", body }),

  update: (id: string, body: UpdateTaskBody) =>
    request<TaskDetailDto>(`/tasks/${id}`, { method: "PATCH", body }),

  /**
   * The transition, on its own route — see the note on `UpdateTaskBody`.
   *
   * `PUT` rather than `PATCH`, because it sets a state rather than merging a
   * change, and the server's own route says so.
   */
  changeStatus: (id: string, body: ChangeTaskStatusBody) =>
    request<TaskDetailDto>(`/tasks/${id}/status`, { method: "PUT", body }),

  unblock: (id: string) => request<TaskDetailDto>(`/tasks/${id}/unblock`, { method: "POST", body: {} }),

  /**
   * A drag, as the board produces it: **the neighbours, never a number**.
   *
   * A client that computed the position itself would hold a second copy of the
   * server's gap arithmetic — including the renumber case, which it cannot
   * perform — and two people dragging into the same gap would both compute the
   * same value.
   */
  move: (id: string, body: MoveTaskBody) =>
    request<TaskDetailDto>(`/tasks/${id}/position`, { method: "PUT", body }),

  assign: (id: string, body: AssignTaskBody) =>
    request<TaskDetailDto>(`/tasks/${id}/assignee`, { method: "PUT", body }),

  remove: (id: string) => request<{ ok: boolean }>(`/tasks/${id}`, { method: "DELETE" }),

  bulk: (ids: string[], change: { priority?: string; assigneeId?: string | null }) =>
    request<{ changed: number; requested: number }>("/tasks/bulk", {
      method: "POST",
      body: { ids, ...change },
    }),

  /**
   * The CSV, for **the same query** the list is showing.
   *
   * Passing the query rather than nothing is the contract, not a convenience:
   * an export that quietly contains more than the filtered view is a document
   * somebody will act on (architecture §7.2).
   */
  exportCsv: (query: TaskQuery) =>
    download("/tasks/export", {
      query: toQuery(query),
      fallbackName: `aufgaben-${new Date().toISOString().slice(0, 10)}.csv`,
    }),

  /* ---- Sub-resources ---------------------------------------------- */

  addDependency: (id: string, body: AddDependencyBody) =>
    request<TaskDetailDto>(`/tasks/${id}/dependencies`, { method: "POST", body }),

  removeDependency: (id: string, dependencyId: string) =>
    request<TaskDetailDto>(`/tasks/${id}/dependencies/${dependencyId}`, { method: "DELETE" }),

  checklist: (id: string) => request<ChecklistItemDto[]>(`/tasks/${id}/checklist`),

  addChecklistItem: (id: string, body: AddChecklistItemBody) =>
    request<ChecklistItemDto>(`/tasks/${id}/checklist`, { method: "POST", body }),

  updateChecklistItem: (id: string, itemId: string, body: UpdateChecklistItemBody) =>
    request<ChecklistItemDto>(`/tasks/${id}/checklist/${itemId}`, { method: "PATCH", body }),

  removeChecklistItem: (id: string, itemId: string) =>
    request<{ ok: boolean }>(`/tasks/${id}/checklist/${itemId}`, { method: "DELETE" }),

  comments: (id: string) => request<TaskCommentDto[]>(`/tasks/${id}/comments`),

  addComment: (id: string, body: AddCommentBody) =>
    request<TaskCommentDto>(`/tasks/${id}/comments`, { method: "POST", body }),

  removeComment: (id: string, commentId: string) =>
    request<{ ok: boolean }>(`/tasks/${id}/comments/${commentId}`, { method: "DELETE" }),

  /**
   * The record's history, newest first.
   *
   * Without payloads — the server sends the summaries and `versionAt` fetches
   * one in full. Twenty rows of several kilobytes each, so that one might be
   * opened, is the same mistake as an unpaginated list.
   */
  history: (id: string) => request<TaskVersionDto[]>(`/tasks/${id}/versions`),

  versionAt: (id: string, version: number) =>
    request<TaskVersionDto & { data: unknown }>(`/tasks/${id}/versions/${version}`),

  /* ---- The pickers -------------------------------------------------- */

  /**
   * Three read-only lists this feature does not own.
   *
   * They belong to `projects/`, `employees/` and `disciplines/` on the server,
   * and each becomes its own client feature in Wave 1 modules 1–3. Calling them
   * from *this* repository is the right place for now, and not a shortcut: **a
   * repository is allowed to know any endpoint.** What would be wrong — and what
   * `architecture.test.ts` refuses — is this feature importing another
   * feature's repository, which is what the first version of these dialogs did.
   * Two repositories calling one endpoint is duplication; one feature reaching
   * into another is a mesh.
   */
  projectOptions: (search?: string) =>
    request<Paginated<{ id: string; number: string; name: string }>>("/projects", {
      query: listQuery({ q: search, perPage: 20, sort: { field: "name", dir: "asc" } }),
    }),

  /**
   * Active people only, and the filter is **sent** rather than defaulted on the
   * server. A list that hides rows by default is a list that cannot show a
   * record which exists; the picker states what it wants.
   */
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

  /** Eight rows, so no pagination — the endpoint returns a plain array. */
  disciplineOptions: () =>
    request<{ id: string; code: string; name: string; colour: string }[]>("/disciplines"),
};

export type TaskRepository = typeof taskRepository;
