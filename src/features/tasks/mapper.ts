import type { Paginated } from "@/core/api";
import { PRIORITIES, type Priority } from "@/entities/project";
import {
  DEPENDENCY_TYPES,
  TASK_STATUSES,
  type ChecklistItem,
  type CommentDraft,
  type DependencyDraft,
  type DependencyType,
  type StatusChange,
  type SubtaskRef,
  type Task,
  type TaskComment,
  type TaskDetail,
  type TaskDraft,
  type TaskEdit,
  type TaskLink,
  type TaskMove,
  type TaskStats,
  type TaskStatus,
  type TaskVersion,
} from "@/entities/task";
import type {
  AddCommentBody,
  AddDependencyBody,
  ChangeTaskStatusBody,
  ChecklistItemDto,
  CreateTaskBody,
  MoveTaskBody,
  SubtaskDto,
  TaskCommentDto,
  TaskDetailDto,
  TaskDto,
  TaskLinkDto,
  TaskStatsDto,
  TaskVersionDto,
  UpdateTaskBody,
} from "./dto";

/**
 * DTO ⇄ entity. **The last file in which a DTO type is legal.**
 *
 * The layer that makes the split real rather than decorative: without it
 * `repository.ts` returns wire shapes straight into the hooks and the DTO
 * reaches the components anyway. `src/architecture.test.ts` enforces both
 * halves, and it caught the projects feature skipping the second one.
 *
 * Three translations happen here, and each is a bug that otherwise happens
 * somewhere else:
 *
 * | Wire | Entity | What goes wrong without it |
 * | --- | --- | --- |
 * | `"2026-09-30T…"` | `Date` | `"2026-09-30" < someDate` compares a string to an object and never throws |
 * | open `string` | closed union | a `switch` with no case for a value the server already sends |
 * | `null` date | `null` | `new Date(null)` is 1 January 1970, silently |
 *
 * **`estimateHours` is deliberately *not* converted.** It stays the decimal
 * string the server sent, for the reason `contractValue` does in the projects
 * mapper: parsing it is the first step toward adding it up, and `2.1 + 4.2` is
 * `6.300000000000001`. A column of hours that ends in eleven decimals is a
 * column nobody trusts.
 *
 * **`isOverdue` is passed through, never recomputed.** The server decided it
 * against one instant; a client that recomputed it would decide against the
 * reader's clock and their timezone, and a card that is red in Zürich and amber
 * in the browser of somebody travelling is a bug nobody can reproduce.
 */

/** `null` in, `null` out — `new Date(null)` is the epoch, which is not "unknown". */
function toDate(iso: string): Date;
function toDate(iso: string | null): Date | null;
function toDate(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}

/**
 * Narrows an open string from the server to a closed union.
 *
 * An unrecognised value falls back **and says so in the console**, which is the
 * least-bad of three options. Throwing would blank a board because one card came
 * from a newer server; leaving it a `string` would push the problem into every
 * `switch`; mapping it silently would hide a real deployment skew. The card
 * still renders, the badge falls through to the raw key, and the mismatch is
 * visible.
 */
function narrow<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T,
  field: string,
): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  console.warn(`[tasks] Unbekannter Wert „${value}“ für ${field} — erwartet: ${allowed.join(", ")}`);
  return fallback;
}

function narrowNullable<T extends string>(
  value: string | null,
  allowed: readonly T[],
  field: string,
): T | null {
  if (value === null) return null;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  console.warn(`[tasks] Unbekannter Wert „${value}“ für ${field} — erwartet: ${allowed.join(", ")}`);
  return null;
}

export function toTask(dto: TaskDto): Task {
  return {
    id: dto.id,
    title: dto.title,
    status: narrow<TaskStatus>(dto.status, TASK_STATUSES, "TODO", "status"),
    priority: narrow<Priority>(dto.priority, PRIORITIES, "MEDIUM", "priority"),
    startDate: toDate(dto.startDate),
    dueDate: toDate(dto.dueDate),
    completedAt: toDate(dto.completedAt),
    estimateHours: dto.estimateHours,
    spentHours: dto.spentHours,
    position: dto.position,
    blockedReason: dto.blockedReason,
    isOverdue: dto.isOverdue,
    version: dto.version,
    createdAt: toDate(dto.createdAt),
    updatedAt: toDate(dto.updatedAt),
    parentTaskId: dto.parentTaskId,
    // Copied rather than passed through: the DTO objects belong to the cache,
    // and an entity that shares one with its wire shape is one mutation away
    // from changing what another screen is reading.
    project: dto.project && { ...dto.project },
    assignee: dto.assignee && { ...dto.assignee },
    discipline: dto.discipline && { ...dto.discipline },
    milestone: dto.milestone && {
      id: dto.milestone.id,
      name: dto.milestone.name,
      dueDate: toDate(dto.milestone.dueDate),
    },
    counts: { ...dto.counts },
  };
}

export function toTaskPage(page: Paginated<TaskDto>): Paginated<Task> {
  return { ...page, items: page.items.map(toTask) };
}

export function toChecklistItem(dto: ChecklistItemDto): ChecklistItem {
  return {
    id: dto.id,
    text: dto.text,
    done: dto.done,
    doneAt: toDate(dto.doneAt),
    doneById: dto.doneById,
    position: dto.position,
  };
}

export function toSubtask(dto: SubtaskDto): SubtaskRef {
  return {
    id: dto.id,
    title: dto.title,
    status: narrow<TaskStatus>(dto.status, TASK_STATUSES, "TODO", "Teilaufgabe-Status"),
    priority: narrow<Priority>(dto.priority, PRIORITIES, "MEDIUM", "Teilaufgabe-Priorität"),
    dueDate: toDate(dto.dueDate),
    assignee: dto.assignee && { ...dto.assignee },
  };
}

export function toTaskLink(dto: TaskLinkDto): TaskLink {
  return {
    id: dto.id,
    type: narrow<DependencyType>(dto.type, DEPENDENCY_TYPES, "FS", "Abhängigkeitstyp"),
    lagDays: dto.lagDays,
    task: {
      id: dto.task.id,
      title: dto.task.title,
      status: narrow<TaskStatus>(dto.task.status, TASK_STATUSES, "TODO", "verknüpfter Status"),
      dueDate: toDate(dto.task.dueDate),
    },
  };
}

export function toTaskDetail(dto: TaskDetailDto): TaskDetail {
  return {
    ...toTask(dto),
    description: dto.description,
    blockedFrom: narrowNullable<TaskStatus>(dto.blockedFrom, TASK_STATUSES, "blockedFrom"),
    projectId: dto.projectId,
    assigneeId: dto.assigneeId,
    milestoneId: dto.milestoneId,
    disciplineId: dto.disciplineId,
    createdById: dto.createdById,
    updatedById: dto.updatedById,
    parentTask: dto.parentTask && {
      id: dto.parentTask.id,
      title: dto.parentTask.title,
      status: narrow<TaskStatus>(dto.parentTask.status, TASK_STATUSES, "TODO", "Elternstatus"),
    },
    subtasks: dto.subtasks.map(toSubtask),
    checklist: dto.checklist.map(toChecklistItem),
    dependsOn: dto.dependsOn.map(toTaskLink),
    blocks: dto.blocks.map(toTaskLink),
    progressPercent: dto.progressPercent,
    /**
     * Filtered rather than narrowed with a fallback.
     *
     * A transition the client does not recognise must **disappear**, not become
     * `TODO` — offering the wrong button is worse than offering one fewer. This
     * is the one place the fallback strategy above is the wrong one, and it is
     * worth the exception.
     */
    allowedTransitions: dto.allowedTransitions.filter((value): value is TaskStatus =>
      (TASK_STATUSES as readonly string[]).includes(value),
    ),
  };
}

export function toTaskComment(dto: TaskCommentDto): TaskComment {
  return {
    id: dto.id,
    body: dto.body,
    authorId: dto.authorId,
    authorName: dto.authorName,
    parentId: dto.parentId,
    mentionedIds: [...dto.mentionedIds],
    editedAt: toDate(dto.editedAt),
    createdAt: new Date(dto.createdAt),
  };
}

/**
 * Fills every status, including the ones the server left out.
 *
 * `/tasks/stats` groups by status, so it returns only statuses that have at
 * least one row: a fresh database sends `{ TODO: 1 }`. The board's column
 * headings read this map directly, and `undefined` renders as nothing where `0`
 * is the truthful answer — an empty column that says nothing looks broken.
 */
export function toTaskStats(dto: TaskStatsDto): TaskStats {
  const byStatus = Object.fromEntries(
    TASK_STATUSES.map((status) => [status, dto.byStatus[status] ?? 0]),
  ) as Record<TaskStatus, number>;
  return { byStatus, total: dto.total, open: dto.open, overdue: dto.overdue };
}

export function toTaskVersion(dto: TaskVersionDto): TaskVersion {
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
 * The half of the DTO boundary that is easy to skip, and `architecture.test.ts`
 * caught the projects feature skipping it: the hooks took `CreateProjectBody`
 * and passed it through, so a screen named a wire type. It compiles, it works,
 * and it is the exact point at which the layering stops being real.
 *
 * Two rules run through everything below.
 *
 * **`undefined` means "not supplied"; `null` means "clear it".** A naive
 * `{ ...values }` destroys the distinction, and it is the whole reason `PATCH`
 * works.
 *
 * **A date crosses as a plain `yyyy-mm-dd` in local time.** `toISOString()`
 * would shift a date typed in Zürich back a day for most of the year, and the
 * day it lands on is a deadline somebody is measured against.
 */

/** `Date` → `yyyy-mm-dd`, in **local** time. Preserves `undefined` and `null`. */
export function toDatePart(value: Date | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Drops the keys that were not supplied, so `PATCH` stays a patch. */
function defined<T extends Record<string, unknown>>(body: T): T {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as T;
}

export function toCreateBody(draft: TaskDraft): CreateTaskBody {
  return defined({
    title: draft.title,
    // `?? undefined`: the create endpoint has no "clear it" case — a field that
    // is absent is simply absent — so a `null` from a form control becomes
    // omission rather than an explicit null the DTO would reject.
    description: draft.description ?? undefined,
    projectId: draft.projectId ?? undefined,
    milestoneId: draft.milestoneId ?? undefined,
    assigneeId: draft.assigneeId ?? undefined,
    disciplineId: draft.disciplineId ?? undefined,
    parentTaskId: draft.parentTaskId ?? undefined,
    priority: draft.priority,
    startDate: toDatePart(draft.startDate) ?? undefined,
    dueDate: toDatePart(draft.dueDate) ?? undefined,
    estimateHours: draft.estimateHours ?? undefined,
  });
}

export function toUpdateBody(edit: TaskEdit): UpdateTaskBody {
  return defined({
    // Never dropped by `defined`, because it is never `undefined`: the type
    // requires it and the server refuses a body without it.
    expectedVersion: edit.expectedVersion,
    versionNote: edit.versionNote,
    title: edit.title,
    description: edit.description,
    priority: edit.priority,
    startDate: toDatePart(edit.startDate),
    dueDate: toDatePart(edit.dueDate),
    estimateHours: edit.estimateHours,
    projectId: edit.projectId,
    milestoneId: edit.milestoneId,
    disciplineId: edit.disciplineId,
    parentTaskId: edit.parentTaskId,
    assigneeId: edit.assigneeId,
  });
}

export function toStatusBody(change: StatusChange): ChangeTaskStatusBody {
  return defined({ status: change.status, reason: change.reason });
}

/**
 * A drag.
 *
 * `afterId` and `beforeId` are sent as `null` rather than dropped when the card
 * lands at an edge of the column, and that is not the `defined` rule leaking: a
 * missing `beforeId` means "the bottom" and an explicit `null` means the same,
 * so either works — but the server distinguishes a *named* neighbour that has
 * since moved, and sending the key makes the intent readable in a network tab.
 */
export function toMoveBody(move: TaskMove): MoveTaskBody {
  return defined({
    status: move.status,
    afterId: move.afterId,
    beforeId: move.beforeId,
  });
}

export function toDependencyBody(draft: DependencyDraft): AddDependencyBody {
  return defined({
    predecessorId: draft.predecessorId,
    type: draft.type,
    lagDays: draft.lagDays,
  });
}

export function toCommentBody(draft: CommentDraft): AddCommentBody {
  return defined({
    body: draft.body,
    parentId: draft.parentId,
    // An empty array is dropped: sending `mentionedIds: []` is the same as
    // sending nothing, and the shorter body is the one a reader can scan.
    mentionedIds: draft.mentionedIds?.length ? draft.mentionedIds : undefined,
  });
}
