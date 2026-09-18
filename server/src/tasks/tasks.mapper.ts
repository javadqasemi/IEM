import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { deriveProgress, isOverdue } from "./tasks.rules";

/**
 * Prisma row → what the API returns. The server's DTO boundary, for Aufgaben.
 *
 * The same seam `projects.mapper.ts` establishes, and the same two things it is
 * there for: a `Decimal` stops being a `Decimal` here, and a `Date` stops being
 * a `Date` here. Without it both leak — `JSON.stringify` renders a Prisma
 * `Decimal` as `{"s":1,"e":6,"d":[…]}`, which reads in a network tab like a
 * server bug rather than a missing conversion.
 *
 * Hours are a **string**, like money and for a weaker version of the same
 * reason: `estimateHours` is `Decimal(7,2)`, and a client that receives a number
 * will sum a column of them in floating point. `2.1 + 4.2` is `6.300000000000001`
 * and a total of hours that ends in eleven decimals is a total nobody trusts.
 *
 * The `select` objects below are **exported and used by the repository**, which
 * is the coupling that stops a mapper reading a field the query did not fetch —
 * that compiles perfectly and returns `undefined` at runtime.
 */

/* ================================================================== */
/* What the queries select                                             */
/* ================================================================== */

/** A board card and a list row. Deliberately small — a column is fifty of these. */
export const TASK_LIST_SELECT = {
  id: true,
  title: true,
  status: true,
  priority: true,
  startDate: true,
  dueDate: true,
  completedAt: true,
  estimateHours: true,
  spentHours: true,
  position: true,
  blockedReason: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  parentTaskId: true,
  project: { select: { id: true, number: true, name: true } },
  assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
  discipline: { select: { id: true, code: true, name: true, defaultColour: true } },
  milestone: { select: { id: true, name: true, dueDate: true } },
  /**
   * Counts, not rows.
   *
   * A card shows "3/7" and a badge for its dependencies; fetching the subtask
   * and checklist rows for every card on a board is fifty extra joins to render
   * two numbers. The *detail* select below takes the rows, because that screen
   * lists them.
   */
  _count: { select: { subtasks: true, checklist: true, dependsOn: true } },
} satisfies Prisma.TaskSelect;

/**
 * The detail select — the card plus everything the drawer shows.
 *
 * One query rather than five round-trips, for the reason
 * `PROJECT_DETAIL_SELECT` gives: separate reads are separate points at which a
 * concurrent write makes the screen internally inconsistent — a progress figure
 * computed without the subtask that is listed beneath it.
 */
export const TASK_DETAIL_SELECT = {
  ...TASK_LIST_SELECT,
  description: true,
  blockedFrom: true,
  overdueNotifiedAt: true,
  createdById: true,
  updatedById: true,
  disciplineId: true,
  milestoneId: true,
  assigneeId: true,
  projectId: true,
  parentTask: { select: { id: true, title: true, status: true } },
  subtasks: {
    where: { deletedAt: null },
    orderBy: { position: "asc" } as Prisma.TaskOrderByWithRelationInput,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  },
  checklist: {
    orderBy: { position: "asc" } as Prisma.ChecklistItemOrderByWithRelationInput,
    select: { id: true, text: true, done: true, doneAt: true, doneById: true, position: true },
  },
  dependsOn: {
    select: {
      id: true,
      type: true,
      lagDays: true,
      predecessor: { select: { id: true, title: true, status: true, dueDate: true } },
    },
  },
  blocks: {
    select: {
      id: true,
      type: true,
      lagDays: true,
      successor: { select: { id: true, title: true, status: true, dueDate: true } },
    },
  },
} satisfies Prisma.TaskSelect;

export type TaskListRow = Prisma.TaskGetPayload<{ select: typeof TASK_LIST_SELECT }>;
export type TaskDetailRow = Prisma.TaskGetPayload<{ select: typeof TASK_DETAIL_SELECT }>;

/* ================================================================== */
/* The conversions                                                     */
/* ================================================================== */

/** `Decimal | null` → `string | null`, at the column's scale. */
function hours(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function person(
  employee: { id: string; firstName: string; lastName: string; email: string } | null,
) {
  if (!employee) return null;
  return { id: employee.id, name: `${employee.firstName} ${employee.lastName}`, email: employee.email };
}

/**
 * `now` is a parameter, not `new Date()` inside.
 *
 * `isOverdue` is time-dependent, and a mapper that read the clock itself could
 * render two cards in one response against two different instants. It never
 * matters by a millisecond and it matters at midnight — and, more practically,
 * a parameter is what makes the mapper testable without freezing time.
 */
export function toTaskListItem(row: TaskListRow, now: Date = new Date()) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    startDate: iso(row.startDate),
    dueDate: iso(row.dueDate),
    completedAt: iso(row.completedAt),
    estimateHours: hours(row.estimateHours),
    spentHours: hours(row.spentHours),
    position: row.position,
    blockedReason: row.blockedReason,
    /**
     * Computed here, sent with every row, stored nowhere.
     *
     * The client must not recompute it: "overdue" would then be decided by the
     * reader's clock and their timezone, and a card that is red in Zürich and
     * amber in the browser of somebody travelling is a bug nobody can
     * reproduce. `tasks.rules.ts` explains why there is no column.
     */
    isOverdue: isOverdue(row.dueDate, row.status, now),
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    parentTaskId: row.parentTaskId,
    project: row.project && { id: row.project.id, number: row.project.number, name: row.project.name },
    assignee: person(row.assignee),
    discipline: row.discipline && {
      id: row.discipline.id,
      code: row.discipline.code,
      name: row.discipline.name,
      colour: row.discipline.defaultColour,
    },
    milestone: row.milestone && {
      id: row.milestone.id,
      name: row.milestone.name,
      dueDate: row.milestone.dueDate.toISOString(),
    },
    counts: {
      subtasks: row._count.subtasks,
      checklist: row._count.checklist,
      dependsOn: row._count.dependsOn,
    },
  };
}

export function toTaskDetail(row: TaskDetailRow, now: Date = new Date()) {
  return {
    ...toTaskListItem(row, now),
    description: row.description,
    blockedFrom: row.blockedFrom,
    projectId: row.projectId,
    assigneeId: row.assigneeId,
    milestoneId: row.milestoneId,
    disciplineId: row.disciplineId,
    createdById: row.createdById,
    updatedById: row.updatedById,
    parentTask: row.parentTask && {
      id: row.parentTask.id,
      title: row.parentTask.title,
      status: row.parentTask.status,
    },
    subtasks: row.subtasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueDate: iso(task.dueDate),
      assignee: person(task.assignee),
    })),
    checklist: row.checklist.map(toChecklistItem),
    dependsOn: row.dependsOn.map((dep) => ({
      id: dep.id,
      type: dep.type,
      lagDays: dep.lagDays,
      task: {
        id: dep.predecessor.id,
        title: dep.predecessor.title,
        status: dep.predecessor.status,
        dueDate: iso(dep.predecessor.dueDate),
      },
    })),
    blocks: row.blocks.map((dep) => ({
      id: dep.id,
      type: dep.type,
      lagDays: dep.lagDays,
      task: {
        id: dep.successor.id,
        title: dep.successor.title,
        status: dep.successor.status,
        dueDate: iso(dep.successor.dueDate),
      },
    })),
    /**
     * Computed from the rows this select already fetched.
     *
     * Unlike `Project.progressPercent` it is **not** a column — `tasks.rules.ts`
     * explains the difference: a project list sorts by progress, a task list
     * does not, and a stored figure that nothing sorts by is a figure that goes
     * stale for free.
     */
    progressPercent: deriveProgress({
      status: row.status,
      subtasks: row.subtasks,
      checklist: row.checklist,
    }),
  };
}

export function toChecklistItem(row: {
  id: string;
  text: string;
  done: boolean;
  doneAt: Date | null;
  doneById: string | null;
  position: number;
}) {
  return {
    id: row.id,
    text: row.text,
    done: row.done,
    doneAt: iso(row.doneAt),
    doneById: row.doneById,
    position: row.position,
  };
}

export type TaskListItem = ReturnType<typeof toTaskListItem>;
export type TaskDetail = ReturnType<typeof toTaskDetail>;

/**
 * What an audit row records about a task. A diff, not a dump.
 *
 * It takes the assignee, the project and the milestone **either way** — the
 * scalar column from the rule read, the relation from the detail read — and
 * that is not defensive typing. It is the bug `toAuditSnapshot` in
 * `projects.mapper.ts` documents: reading only the column meant every `after`
 * came back without it, and the log recorded a manager being removed on every
 * edit. Nothing threw. Here the same two selects exist for the same reason, so
 * the same guard is needed before the bug rather than after it.
 */
export function toAuditSnapshot(row: {
  title: string;
  status: string;
  priority?: string;
  assigneeId?: string | null;
  assignee?: { id: string } | null;
  projectId?: string | null;
  project?: { id: string } | null;
  dueDate: Date | null;
}) {
  return {
    title: row.title,
    status: row.status,
    priority: row.priority ?? null,
    assigneeId: row.assigneeId ?? row.assignee?.id ?? null,
    projectId: row.projectId ?? row.project?.id ?? null,
    dueDate: iso(row.dueDate),
  };
}

/* ================================================================== */
/* Inbound: DTO → what Prisma writes                                   */
/* ================================================================== */

/**
 * `"4.25"` → `Decimal`. Throws with the field named, never silently zero.
 *
 * Hours rather than money, so the pattern allows fewer digits — but the
 * refusal is the same one `toMoney` makes and for the same reason: a person
 * types `4,25` or `4:15`, and accepting either as `NaN` and storing `null`
 * turns a typo into a missing estimate that nobody notices until a report is
 * short.
 */
export function toHours(value: string | null | undefined, field: string): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(value)) {
    throw new BadRequestException(
      `„${value}“ ist kein gültiger Stundenwert für ${field}. Erwartet: 4.25`,
    );
  }
  return new Prisma.Decimal(value);
}

/**
 * The same validation, as a plain number.
 *
 * `tasks.rules.ts` checks the *magnitude* of an estimate and is pure — it takes
 * a number and must never learn what a `Decimal` is. `tasks.service.ts` imports
 * no `Prisma` either. So the conversion happens here, which is the whole job of
 * this half of the file, and both sides stay able to read each other.
 */
export function toHoursNumber(value: string | null | undefined, field: string): number | null {
  const decimal = toHours(value, field);
  return decimal === null ? null : decimal.toNumber();
}

/** `"2026-09-18"` or a full ISO timestamp → `Date`. The DTO has checked the shape. */
export function toDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  return new Date(value);
}

export type TaskWriteInput = {
  title?: string;
  description?: string | null;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  estimateHours?: string | null;
  projectId?: string | null;
  milestoneId?: string | null;
  assigneeId?: string | null;
  disciplineId?: string | null;
  parentTaskId?: string | null;
};

/**
 * The edit body → a Prisma update.
 *
 * **Scalar foreign keys, never `connect`/`disconnect`.** Not a style choice —
 * it is what `updateMany` accepts, and the optimistic lock needs the version
 * inside the `where`, which only `updateMany` allows.
 * `TaskUncheckedUpdateInput` has no relation operations at all: a body carrying
 * `assignee: { connect: … }` is rejected at runtime with *Unknown argument
 * `assignee`* while typechecking perfectly, because the object is spread into
 * the call. That exact 500 shipped in Projects and is written up on
 * `toProjectUpdateData`; this module starts on the right side of it.
 *
 * `status` is absent, and deliberately: a transition has preconditions, its own
 * route and its own event. See `UpdateTaskDto`.
 */
export function toTaskUpdateData(
  input: TaskWriteInput,
  updatedById: string | null,
): Prisma.TaskUncheckedUpdateInput {
  const data: Prisma.TaskUncheckedUpdateInput = { updatedById };

  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.priority !== undefined) {
    data.priority = input.priority as Prisma.TaskUpdateInput["priority"];
  }

  if (input.startDate !== undefined) data.startDate = toDate(input.startDate);
  if (input.dueDate !== undefined) {
    data.dueDate = toDate(input.dueDate);
    /*
      Moving the date resets the overdue announcement.

      Without this a task that was announced overdue, then rescheduled, then
      missed again is never announced a second time — `overdueNotifiedAt` is
      still set from the first date. The clearing belongs here rather than in
      the service because it is a property of *the column pair*, and a service
      that has to remember it is a service that forgets it on the second route
      that writes a due date.
    */
    data.overdueNotifiedAt = null;
  }
  if (input.estimateHours !== undefined) {
    data.estimateHours = input.estimateHours === null
      ? null
      : toHours(input.estimateHours, "Aufwand");
  }

  if (input.projectId !== undefined) data.projectId = input.projectId;
  if (input.milestoneId !== undefined) data.milestoneId = input.milestoneId;
  if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId;
  if (input.disciplineId !== undefined) data.disciplineId = input.disciplineId;
  if (input.parentTaskId !== undefined) data.parentTaskId = input.parentTaskId;

  return data;
}

export type TaskCreateInput = TaskWriteInput & { title: string; position: number };

/**
 * The create body → a Prisma create.
 *
 * `Unchecked`, so the foreign keys are scalars here too. Projects uses the
 * checked form with `connect` on create because it was written before the
 * `updateMany` lesson; using one shape for both directions means the two
 * functions can be read against each other, and there is no second syntax to
 * get wrong.
 */
export function toTaskCreateData(
  input: TaskCreateInput,
  createdById: string | null,
): Prisma.TaskUncheckedCreateInput {
  return {
    title: input.title,
    description: input.description ?? null,
    priority: input.priority as Prisma.TaskUncheckedCreateInput["priority"],
    position: input.position,
    startDate: toDate(input.startDate),
    dueDate: toDate(input.dueDate),
    estimateHours: toHours(input.estimateHours, "Aufwand"),
    projectId: input.projectId ?? null,
    milestoneId: input.milestoneId ?? null,
    assigneeId: input.assigneeId ?? null,
    disciplineId: input.disciplineId ?? null,
    parentTaskId: input.parentTaskId ?? null,
    createdById,
    updatedById: createdById,
  };
}

/**
 * The flat shape the CSV export writes.
 *
 * Separate from `toTaskListItem` for the reason `toProjectExportRow` gives: an
 * export is read by Excel, and nesting `assignee.name` means the column header
 * is decided by whoever writes the CSV loop rather than by this module.
 */
export function toTaskExportRow(row: TaskListRow, now: Date = new Date()): Record<string, string> {
  return {
    Aufgabe: row.title,
    Status: row.status,
    Priorität: row.priority,
    Projekt: row.project?.name ?? "",
    Projektnummer: row.project?.number ?? "",
    Gewerk: row.discipline?.code ?? "",
    Zuständig: row.assignee ? `${row.assignee.firstName} ${row.assignee.lastName}` : "",
    Meilenstein: row.milestone?.name ?? "",
    Start: row.startDate?.toISOString().slice(0, 10) ?? "",
    Fällig: row.dueDate?.toISOString().slice(0, 10) ?? "",
    Überfällig: isOverdue(row.dueDate, row.status, now) ? "ja" : "nein",
    Erledigt: row.completedAt?.toISOString().slice(0, 10) ?? "",
    Aufwand: hours(row.estimateHours) ?? "",
    Teilaufgaben: String(row._count.subtasks),
    Checkliste: String(row._count.checklist),
  };
}
