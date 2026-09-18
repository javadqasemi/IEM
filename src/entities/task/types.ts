import type { PersonRef, Priority } from "@/entities/project";

/**
 * What a task *is*, on the client.
 *
 * `entities/` and not `features/tasks/`, for the reason the folder's README
 * gives and which applies harder here than it did to projects: Meetings turn a
 * Pendenz into a task, Time Tracking books against one, Calendar draws them, and
 * the project detail embeds a board of them. Every one of those will want to
 * render a task's status badge and its overdue marker. If that lived in
 * `features/tasks` they would each import a feature's internals, which
 * `architecture.test.ts` forbids — correctly.
 *
 * **`Priority` is imported from `entities/project` rather than redeclared.**
 * The schema shares one `Priority` enum across the domain, deliberately — "two
 * parallel scales get used inconsistently" is written on the enum itself — and a
 * second copy here would be exactly that, one rename away from a dropdown that
 * offers a value the badge has no label for.
 *
 * Dates are `Date`, hours are `string`. The server sends ISO strings and decimal
 * strings; `features/tasks/mapper.ts` is the only place either is converted, and
 * the hours stay a string for the reason money does — a number invites
 * arithmetic, and `2.1 + 4.2` is `6.300000000000001`.
 */

export const TASK_STATUSES = [
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "DONE",
  "BLOCKED",
  "CANCELLED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * The columns a board draws, in order, and **not** the same list as
 * `TASK_STATUSES`.
 *
 * `CANCELLED` has no column: a board is what is being worked on, and a column
 * of abandoned cards would grow for ever and be scrolled past daily. Cancelled
 * tasks are reachable from the list with a filter, which is where a record you
 * are looking *for* belongs.
 */
export const BOARD_COLUMNS = ["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const DEPENDENCY_TYPES = ["FS", "SS", "FF", "SF"] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export type ProjectRef = { id: string; number: string; name: string };
export type MilestoneRef = { id: string; name: string; dueDate: Date };
export type DisciplineRef = { id: string; code: string; name: string; colour: string };

/** What a board card and a list row show. */
export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  /** A decimal string, e.g. `"7.50"`. Format it; do not add it up. */
  estimateHours: string | null;
  /** Derived from time entries — Wave 2 module 14. `"0.00"` until then. */
  spentHours: string | null;
  /** Kanban order within one column. Sparse; the server owns the arithmetic. */
  position: number;
  blockedReason: string | null;
  /**
   * **Computed by the server, never here.**
   *
   * The client must not recompute it: "overdue" would then be decided by the
   * reader's clock and their timezone, and a card that is red in Zürich and
   * amber in the browser of somebody travelling is a bug nobody can reproduce.
   */
  isOverdue: boolean;
  /**
   * The record's own revision (F13).
   *
   * On every row, not only the detail, because an edit has to send back the
   * version it read — and a version available only on the detail would make
   * every inline edit fetch the record first, which is the window the lock
   * exists to close.
   */
  version: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  parentTaskId: string | null;
  /** `null` for a firm-level to-do. The module's defining case. */
  project: ProjectRef | null;
  assignee: PersonRef | null;
  discipline: DisciplineRef | null;
  milestone: MilestoneRef | null;
  /** Counts, not rows — a board of fifty cards does not fetch their children. */
  counts: { subtasks: number; checklist: number; dependsOn: number };
};

export type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
  doneAt: Date | null;
  doneById: string | null;
  position: number;
};

export type SubtaskRef = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: Date | null;
  assignee: PersonRef | null;
};

/**
 * One edge, from whichever end the reader is standing at.
 *
 * `task` is the *other* task — the predecessor under `dependsOn`, the successor
 * under `blocks`. The server flattens both to this one shape, so the drawer has
 * one renderer rather than two; a second renderer is one reuse away from showing
 * the wrong end.
 */
export type TaskLink = {
  id: string;
  type: DependencyType;
  lagDays: number;
  task: { id: string; title: string; status: TaskStatus; dueDate: Date | null };
};

export type TaskDetail = Task & {
  description: string | null;
  blockedFrom: TaskStatus | null;
  projectId: string | null;
  assigneeId: string | null;
  milestoneId: string | null;
  disciplineId: string | null;
  createdById: string | null;
  updatedById: string | null;
  parentTask: { id: string; title: string; status: TaskStatus } | null;
  subtasks: SubtaskRef[];
  checklist: ChecklistItem[];
  dependsOn: TaskLink[];
  blocks: TaskLink[];
  /** Computed by the server from the rows it fetched. Not a column. */
  progressPercent: number;
  /**
   * What this task may become *right now*, decided by the server.
   *
   * Sent with the record so the status control offers exactly what would be
   * accepted. A second copy of the transition table on the client is one that
   * goes stale, because nothing fails when it does.
   */
  allowedTransitions: TaskStatus[];
};

export type TaskComment = {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  parentId: string | null;
  mentionedIds: string[];
  editedAt: Date | null;
  createdAt: Date;
};

export type TaskStats = {
  byStatus: Record<string, number>;
  total: number;
  open: number;
  overdue: number;
};

export type TaskVersion = {
  version: number;
  label: string;
  changed: string[];
  note: string | null;
  changedByName: string | null;
  createdAt: Date;
};

/* ================================================================== */
/* What a form produces                                                */
/* ================================================================== */

/**
 * **Entity-shaped drafts, not request bodies.**
 *
 * A hook naming `CreateTaskBody` would put a DTO type in the layer above the
 * mapper, which is the boundary `architecture.test.ts` enforces: a DTO may be
 * named in `repository.ts` and `mapper.ts` and nowhere else. The drafts are what
 * a *form* has; the mapper turns them into what the wire wants.
 */
export type TaskDraft = {
  title: string;
  description?: string | null;
  projectId?: string | null;
  milestoneId?: string | null;
  assigneeId?: string | null;
  disciplineId?: string | null;
  parentTaskId?: string | null;
  priority?: Priority;
  startDate?: Date | null;
  dueDate?: Date | null;
  estimateHours?: string | null;
};

/**
 * An edit, which **must** carry the version it read.
 *
 * Required rather than optional here as well as on the wire: a draft that could
 * omit it is one a new screen omits, and the failure is a save that silently
 * overwrites somebody else's.
 */
export type TaskEdit = Partial<Omit<TaskDraft, "title">> & {
  title?: string;
  expectedVersion: number;
  versionNote?: string;
};

export type StatusChange = { status: TaskStatus; reason?: string };

/** A drag: the neighbours, never a number. The server owns the arithmetic. */
export type TaskMove = {
  status?: TaskStatus;
  afterId?: string | null;
  beforeId?: string | null;
};

export type DependencyDraft = {
  predecessorId: string;
  type?: DependencyType;
  lagDays?: number;
};

export type CommentDraft = {
  body: string;
  parentId?: string;
  mentionedIds?: string[];
};
