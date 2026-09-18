/**
 * The wire shapes, exactly as the server sends and accepts them.
 *
 * **A DTO type may be named here and in `mapper.ts` and nowhere else.**
 * `src/architecture.test.ts` enforces it, and the rule is what makes the mapper
 * a seam rather than a decoration: the moment a hook or a screen names
 * `TaskDto`, an API rename reaches every file that renders a task instead of
 * two files with millisecond tests.
 *
 * Dates are ISO strings and hours are decimal strings, because that is what
 * arrives. Nothing here parses anything — that is the mapper's whole job.
 */

export type PersonDto = { id: string; name: string; email: string };
export type ProjectRefDto = { id: string; number: string; name: string };
export type MilestoneRefDto = { id: string; name: string; dueDate: string };
export type DisciplineRefDto = { id: string; code: string; name: string; colour: string };

export type TaskDto = {
  id: string;
  title: string;
  status: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  estimateHours: string | null;
  spentHours: string | null;
  position: number;
  blockedReason: string | null;
  isOverdue: boolean;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  parentTaskId: string | null;
  project: ProjectRefDto | null;
  assignee: PersonDto | null;
  discipline: DisciplineRefDto | null;
  milestone: MilestoneRefDto | null;
  counts: { subtasks: number; checklist: number; dependsOn: number };
};

export type ChecklistItemDto = {
  id: string;
  text: string;
  done: boolean;
  doneAt: string | null;
  doneById: string | null;
  position: number;
};

export type SubtaskDto = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignee: PersonDto | null;
};

export type TaskLinkDto = {
  id: string;
  type: string;
  lagDays: number;
  task: { id: string; title: string; status: string; dueDate: string | null };
};

export type TaskDetailDto = TaskDto & {
  description: string | null;
  blockedFrom: string | null;
  projectId: string | null;
  assigneeId: string | null;
  milestoneId: string | null;
  disciplineId: string | null;
  createdById: string | null;
  updatedById: string | null;
  parentTask: { id: string; title: string; status: string } | null;
  subtasks: SubtaskDto[];
  checklist: ChecklistItemDto[];
  dependsOn: TaskLinkDto[];
  blocks: TaskLinkDto[];
  progressPercent: number;
  allowedTransitions: string[];
};

export type TaskCommentDto = {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  parentId: string | null;
  mentionedIds: string[];
  editedAt: string | null;
  createdAt: string;
};

export type TaskStatsDto = {
  byStatus: Record<string, number>;
  total: number;
  open: number;
  overdue: number;
};

export type TaskVersionDto = {
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

export type CreateTaskBody = {
  title: string;
  description?: string | null;
  projectId?: string;
  milestoneId?: string;
  assigneeId?: string;
  disciplineId?: string;
  parentTaskId?: string;
  priority?: string;
  startDate?: string;
  dueDate?: string;
  estimateHours?: string;
};

/**
 * The edit body.
 *
 * **`expectedVersion` is required**, mirroring the server's DTO. An optional
 * lock is one every caller forgets exactly once, and the failure is the worst
 * kind: the second save wins silently and nothing records that the first
 * person's work existed.
 *
 * **`status` and `position` are absent.** Both have their own routes — a
 * transition has preconditions, and a position is meaningless without knowing
 * which column it is in and which cards it sits between.
 */
export type UpdateTaskBody = {
  expectedVersion: number;
  versionNote?: string;
  title?: string;
  description?: string | null;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  estimateHours?: string | null;
  projectId?: string | null;
  milestoneId?: string | null;
  disciplineId?: string | null;
  parentTaskId?: string | null;
  assigneeId?: string | null;
};

export type ChangeTaskStatusBody = { status: string; reason?: string };
export type AssignTaskBody = { assigneeId: string | null };
export type MoveTaskBody = { status?: string; afterId?: string | null; beforeId?: string | null };
export type AddDependencyBody = { predecessorId: string; type?: string; lagDays?: number };
export type AddChecklistItemBody = { text: string };
export type UpdateChecklistItemBody = { text?: string; done?: boolean };
export type AddCommentBody = { body: string; parentId?: string; mentionedIds?: string[] };
