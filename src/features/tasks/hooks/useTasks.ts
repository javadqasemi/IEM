import { useCallback } from "react";
import { invalidate, useQuery, type Paginated } from "@/core/api";
import type {
  ChecklistItem,
  CommentDraft,
  DependencyDraft,
  StatusChange,
  Task,
  TaskComment,
  TaskDetail,
  TaskDraft,
  TaskEdit,
  TaskMove,
  TaskStats,
  TaskVersion,
} from "@/entities/task";
import {
  toChecklistItem,
  toCommentBody,
  toCreateBody,
  toDependencyBody,
  toMoveBody,
  toStatusBody,
  toTaskComment,
  toTaskDetail,
  toTaskPage,
  toTaskStats,
  toTaskVersion,
  toUpdateBody,
} from "../mapper";
import { taskRepository, type TaskQuery } from "../repository";

/**
 * React only. Cache keys, loading state, invalidation.
 *
 * Every function here is `repository → mapper → cache`. That order is the whole
 * contract: nothing below this file knows about React, and nothing above it has
 * seen a DTO.
 */

/**
 * The cache prefix for everything in this feature.
 *
 * One constant rather than the string repeated at a dozen call sites, because
 * invalidation is a prefix match — a typo in one key produces an entry nothing
 * ever invalidates, which shows up weeks later as a board that will not refresh.
 */
const KEY = "tasks";

/**
 * Every part of the query that changes the answer, in the key.
 *
 * Written out rather than `JSON.stringify(query)`, which would be shorter and
 * wrong twice: key order in an object literal is not guaranteed across
 * construction sites, so the same query would produce two cache entries, and an
 * added field would silently join the key and evict everything.
 */
function listKey(query: TaskQuery): (string | number)[] {
  return [
    KEY,
    "list",
    query.search ?? "",
    (query.statuses ?? []).join(",") || (query.status ?? ""),
    query.priority ?? "",
    query.projectId ?? "",
    query.project ?? "",
    query.assigneeId ?? "",
    query.assignee ?? "",
    query.milestoneId ?? "",
    query.discipline ?? "",
    query.parent ?? "",
    query.dueBefore ?? "",
    `${query.sort?.field ?? ""}:${query.sort?.dir ?? ""}`,
    query.page ?? 1,
    query.perPage ?? 25,
  ];
}

export function useTaskList(query: TaskQuery) {
  return useQuery<Paginated<Task>>(listKey(query), () =>
    taskRepository.list(query).then(toTaskPage),
  );
}

/**
 * Every card of one board, in one request.
 *
 * `perPage: 200` — the list contract's ceiling — and **not** a request per
 * column. Five requests would give five pages that can straddle a write, so a
 * card dragged from `TODO` to `IN_PROGRESS` between the first and second
 * response appears in both columns or in neither. One page, split by
 * `toBoard`, cannot disagree with itself.
 *
 * A project with more than two hundred open top-level tasks would truncate, and
 * that is the right failure to leave visible rather than paper over: a board
 * nobody can read is a board that needs filtering, and the list screen is where
 * that happens.
 */
export function useTaskBoard(query: Omit<TaskQuery, "page" | "perPage" | "sort">) {
  const full: TaskQuery = {
    ...query,
    // Top level only, or every subtask appears as a card beside its parent.
    parent: query.parent ?? "root",
    perPage: 200,
    sort: { field: "position", dir: "asc" },
  };
  return useQuery<Paginated<Task>>(listKey(full), () => taskRepository.list(full).then(toTaskPage));
}

export function useTaskStats(enabled = true) {
  return useQuery<TaskStats>(enabled ? [KEY, "stats"] : null, () =>
    taskRepository.stats().then(toTaskStats),
  );
}

/**
 * The rail's badge: how many of my tasks are overdue.
 *
 * Overdue rather than open, and that is the whole choice. "Wie viele Aufgaben
 * habe ich" is a number nobody acts on — it is always some tens — while "wie
 * viele sind überfällig" is the one that should make somebody click. A badge
 * that is always lit is a badge people stop seeing.
 *
 * `undefined` when it has not loaded or the call failed. A missing badge is the
 * right failure: the rail still renders, and an error screen because a count is
 * unavailable would be worse than the count being unavailable.
 */
export function useOverdueTaskCount(enabled: boolean): number | undefined {
  const stats = useTaskStats(enabled).data;
  return stats?.overdue;
}

/** `null` disables the query — a drawer with no id fetches nothing. */
export function useTask(id: string | null) {
  return useQuery<TaskDetail>(id ? [KEY, "detail", id] : null, () =>
    taskRepository.get(id!).then(toTaskDetail),
  );
}

/**
 * The checklist, separately from the detail.
 *
 * It arrives *with* the detail too, and this exists for the one case that
 * differs: ticking a point returns only the point, so the panel that owns the
 * list needs its own entry to refresh rather than refetching the whole record
 * and its four joins on every tick.
 */
export function useChecklist(id: string | null) {
  return useQuery<ChecklistItem[]>(id ? [KEY, "checklist", id] : null, () =>
    taskRepository.checklist(id!).then((rows) => rows.map(toChecklistItem)),
  );
}

/**
 * The thread.
 *
 * `null` disables it, so a drawer fetches comments only when the tab is opened.
 * Most cards have none and most visits do not read them.
 */
export function useTaskComments(id: string | null) {
  return useQuery<TaskComment[]>(id ? [KEY, "comments", id] : null, () =>
    taskRepository.comments(id!).then((rows) => rows.map(toTaskComment)),
  );
}

/**
 * The record's version history (F13).
 *
 * `null` disables it, so the tab fetches nothing until it is opened. A history
 * is the one sub-resource nobody looks at on most visits.
 */
export function useTaskHistory(id: string | null) {
  return useQuery<TaskVersion[]>(id ? [KEY, "versions", id] : null, () =>
    taskRepository.history(id!).then((rows) => rows.map(toTaskVersion)),
  );
}

/* ---- The writes ---------------------------------------------------- */

export type TaskMutations = {
  create: (draft: TaskDraft) => Promise<TaskDetail>;
  update: (id: string, edit: TaskEdit) => Promise<TaskDetail>;
  changeStatus: (id: string, change: StatusChange) => Promise<TaskDetail>;
  unblock: (id: string) => Promise<TaskDetail>;
  move: (id: string, move: TaskMove) => Promise<TaskDetail>;
  assign: (id: string, assigneeId: string | null) => Promise<TaskDetail>;
  remove: (id: string) => Promise<void>;
  bulk: (ids: string[], change: { priority?: string; assigneeId?: string | null }) => Promise<number>;
  exportCsv: (query: TaskQuery) => Promise<void>;
  addDependency: (id: string, draft: DependencyDraft) => Promise<TaskDetail>;
  removeDependency: (id: string, dependencyId: string) => Promise<TaskDetail>;
  addChecklistItem: (id: string, text: string) => Promise<ChecklistItem>;
  setChecklistItem: (id: string, itemId: string, done: boolean) => Promise<ChecklistItem>;
  removeChecklistItem: (id: string, itemId: string) => Promise<void>;
  addComment: (id: string, draft: CommentDraft) => Promise<TaskComment>;
  removeComment: (id: string, commentId: string) => Promise<void>;
};

/**
 * The writes.
 *
 * Each one invalidates the whole feature rather than the key it touched.
 * Deliberate: **a status change moves a card between two columns and changes
 * three counts**, and a drag changes the order of two cards without touching
 * either one's own key. The set of affected entries is not knowable from the
 * mutation. Invalidating a dozen entries costs one round trip per mounted
 * screen; getting the set wrong costs a board that is quietly stale.
 *
 * Every write route returns the **whole task**, which is why each resolves to a
 * `TaskDetail`: the caller gets the recomputed progress and the new
 * `allowedTransitions` in the same round trip rather than racing the
 * invalidation.
 *
 * Errors are **not** swallowed. The screen wraps the call in `useMutation`,
 * which turns an `ApiError`'s per-field messages into messages beside the
 * inputs — a hook that caught them would throw that away, and the 409 the
 * optimistic lock raises is the one a screen most needs to see.
 */
export function useTaskMutations(): TaskMutations {
  const create = useCallback(async (draft: TaskDraft) => {
    const dto = await taskRepository.create(toCreateBody(draft));
    invalidate(KEY);
    return toTaskDetail(dto);
  }, []);

  const update = useCallback(async (id: string, edit: TaskEdit) => {
    const dto = await taskRepository.update(id, toUpdateBody(edit));
    invalidate(KEY);
    return toTaskDetail(dto);
  }, []);

  const changeStatus = useCallback(async (id: string, change: StatusChange) => {
    const dto = await taskRepository.changeStatus(id, toStatusBody(change));
    invalidate(KEY);
    return toTaskDetail(dto);
  }, []);

  const unblock = useCallback(async (id: string) => {
    const dto = await taskRepository.unblock(id);
    invalidate(KEY);
    return toTaskDetail(dto);
  }, []);

  const move = useCallback(async (id: string, payload: TaskMove) => {
    const dto = await taskRepository.move(id, toMoveBody(payload));
    invalidate(KEY);
    return toTaskDetail(dto);
  }, []);

  const assign = useCallback(async (id: string, assigneeId: string | null) => {
    const dto = await taskRepository.assign(id, { assigneeId });
    invalidate(KEY);
    return toTaskDetail(dto);
  }, []);

  const remove = useCallback(async (id: string) => {
    await taskRepository.remove(id);
    invalidate(KEY);
  }, []);

  const bulk = useCallback(
    async (ids: string[], change: { priority?: string; assigneeId?: string | null }) => {
      const result = await taskRepository.bulk(ids, change);
      invalidate(KEY);
      return result.changed;
    },
    [],
  );

  const exportCsv = useCallback((query: TaskQuery) => taskRepository.exportCsv(query), []);

  const addDependency = useCallback(async (id: string, draft: DependencyDraft) => {
    const dto = await taskRepository.addDependency(id, toDependencyBody(draft));
    invalidate(KEY);
    return toTaskDetail(dto);
  }, []);

  const removeDependency = useCallback(async (id: string, dependencyId: string) => {
    const dto = await taskRepository.removeDependency(id, dependencyId);
    invalidate(KEY);
    return toTaskDetail(dto);
  }, []);

  const addChecklistItem = useCallback(async (id: string, text: string) => {
    const dto = await taskRepository.addChecklistItem(id, { text });
    invalidate(KEY);
    return toChecklistItem(dto);
  }, []);

  const setChecklistItem = useCallback(async (id: string, itemId: string, done: boolean) => {
    const dto = await taskRepository.updateChecklistItem(id, itemId, { done });
    invalidate(KEY);
    return toChecklistItem(dto);
  }, []);

  const removeChecklistItem = useCallback(async (id: string, itemId: string) => {
    await taskRepository.removeChecklistItem(id, itemId);
    invalidate(KEY);
  }, []);

  const addComment = useCallback(async (id: string, draft: CommentDraft) => {
    const dto = await taskRepository.addComment(id, toCommentBody(draft));
    invalidate(KEY);
    return toTaskComment(dto);
  }, []);

  const removeComment = useCallback(async (id: string, commentId: string) => {
    await taskRepository.removeComment(id, commentId);
    invalidate(KEY);
  }, []);

  return {
    create,
    update,
    changeStatus,
    unblock,
    move,
    assign,
    remove,
    bulk,
    exportCsv,
    addDependency,
    removeDependency,
    addChecklistItem,
    setChecklistItem,
    removeChecklistItem,
    addComment,
    removeComment,
  };
}
