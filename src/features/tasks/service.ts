import {
  BOARD_COLUMNS,
  OPEN_STATUSES,
  type BoardColumn,
  type ChecklistItem,
  type Task,
  type TaskDetail,
  type TaskLink,
  type TaskStatus,
} from "@/entities/task";

/**
 * Domain only. Pure functions over entity types — no React, no fetch, and
 * therefore testable with no mocks at all.
 *
 * This is the layer that matters most and the one easiest to skip. Everything
 * here would otherwise be an inline expression in a screen, where it is
 * untestable and where the second screen that needs it writes its own slightly
 * different copy.
 *
 * **What is deliberately not here**, and the list is longer than the projects
 * feature's because this module put more on the server on purpose:
 *
 * | Not here | Where it is | Why |
 * | --- | --- | --- |
 * | The transition table | `allowedTransitions`, with the record | A second copy goes stale and nothing fails when it does |
 * | `isOverdue` | a field on the row | Recomputing it would decide against the reader's clock and timezone |
 * | `progressPercent` | a field on the detail | The server has the subtasks and the checklist; the board has counts |
 * | The position arithmetic | the server | A client copy cannot perform the renumber, and two draggers would compute the same value |
 *
 * What follows is presentation logic the server has no reason to compute and
 * the screens have every reason not to duplicate.
 */

/** Neither finished nor abandoned. The default filter, and the `open` count. */
export function isOpen(status: TaskStatus): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

/** `CANCELLED` takes no more work; the server refuses every write to one. */
export function isReadOnly(task: Pick<Task, "status">): boolean {
  return task.status === "CANCELLED";
}

/**
 * Days until the date — negative once it has passed.
 *
 * Whole days from midnight, not from *now*: "in 0 Tagen" has to mean today all
 * day, and a millisecond difference deciding between "today" and "yesterday" is
 * how a deadline badge flickers at lunchtime. The same function
 * `features/projects/service.ts` has, and duplicated rather than shared
 * deliberately — a `shared/` date helper that both features imported would be
 * the first thread of the utility module `features/README.md` forbids, and it is
 * six lines.
 */
export function daysUntil(date: Date | null, now: Date = new Date()): number | null {
  if (!date) return null;
  const start = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((start - today) / 86_400_000);
}

/**
 * How many days overdue, for the badge beside the marker.
 *
 * Reads `isOverdue` rather than deciding it: the server owns that verdict, and
 * this only says by how much once the answer is already yes. Returns `null`
 * when the task is not overdue, so the badge renders nothing rather than
 * "0 Tage".
 */
export function daysOverdue(task: Pick<Task, "isOverdue" | "dueDate">, now?: Date): number | null {
  if (!task.isOverdue) return null;
  const days = daysUntil(task.dueDate, now);
  return days === null ? null : Math.max(0, -days);
}

/**
 * Due today or in the next `within` days, and still open.
 *
 * The "what is coming" query a person actually has. Overdue tasks are
 * deliberately **excluded** — they are their own, louder category, and mixing
 * them in makes a "diese Woche" list that is mostly last month.
 */
export function dueSoon(tasks: readonly Task[], within = 7, now?: Date): Task[] {
  return tasks.filter((task) => {
    if (!isOpen(task.status) || task.isOverdue) return false;
    const days = daysUntil(task.dueDate, now);
    return days !== null && days >= 0 && days <= within;
  });
}

/* ================================================================== */
/* The board                                                           */
/* ================================================================== */

export type Board = { column: BoardColumn; tasks: Task[] }[];

/**
 * Cards into columns, in the board's own order.
 *
 * **Every column is present, including the empty ones.** A board assembled by
 * grouping would omit a column nobody has a card in, so the first task ever
 * created would produce a one-column board — and a column that is missing
 * cannot be dropped into, which reads as the board being broken rather than
 * empty.
 *
 * `CANCELLED` cards are dropped rather than given a column: a board is what is
 * being worked on, and a column of abandoned cards grows for ever and is
 * scrolled past daily. They are reachable from the list with a filter.
 *
 * Sorted by `position`, which is the server's own arithmetic. Sorting by
 * anything else here would mean a drag appears to work and then jumps back on
 * the next fetch.
 */
export function toBoard(tasks: readonly Task[]): Board {
  return BOARD_COLUMNS.map((column) => ({
    column,
    tasks: tasks
      .filter((task) => task.status === column)
      .sort((a, b) => a.position - b.position),
  }));
}

/**
 * The neighbours a card lands between, from the column it is dropped into.
 *
 * **This is the whole client half of the drag**, and it is deliberately the only
 * arithmetic here: `index` is where the card is being dropped, and the answer is
 * the two ids either side of that slot. The server computes the position.
 *
 * The card being moved is excluded first, because dropping a card two places
 * down its own column means the slots below it have shifted up by one — and an
 * index counted against a list that still contains the card is off by one in
 * exactly the direction nobody notices until they try it.
 */
export function neighboursAt(
  column: readonly Task[],
  index: number,
  movingId: string,
): { afterId: string | null; beforeId: string | null } {
  const others = column.filter((task) => task.id !== movingId);
  const at = Math.max(0, Math.min(index, others.length));
  return {
    afterId: others[at - 1]?.id ?? null,
    beforeId: others[at]?.id ?? null,
  };
}

/* ================================================================== */
/* The detail                                                          */
/* ================================================================== */

/**
 * The dependencies that are actually holding this task up.
 *
 * `FS` and `FF` gate completion and `SS`/`SF` do not — the same rule the server
 * enforces — and a task is only *held* by one that is still open. Four
 * dependencies of which one is blocking is the normal case, and a drawer that
 * listed all four equally would make the reader work out which to chase.
 *
 * It is **not** the rule. The server's `refuseTransition` is; this returns the
 * rows so a screen can point at them, and deliberately returns a list rather
 * than a verdict so it cannot drift into being a second, kinder copy.
 */
export function blockingLinks(task: Pick<TaskDetail, "dependsOn">): TaskLink[] {
  return task.dependsOn.filter(
    (link) =>
      (link.type === "FS" || link.type === "FF") &&
      link.task.status !== "DONE" &&
      link.task.status !== "CANCELLED",
  );
}

/** Subtasks that would refuse a parent's completion. */
export function openSubtasks(task: Pick<TaskDetail, "subtasks">): TaskDetail["subtasks"] {
  return task.subtasks.filter((sub) => isOpen(sub.status));
}

/**
 * Why `DONE` is unavailable, in a sentence, or `null` when it is available.
 *
 * For a **disabled control's tooltip**, which is the case an exception cannot
 * serve: the server's refusal explains itself after the click, and a button that
 * is greyed with no reason is the commonest way a rule becomes invisible. The
 * wording is deliberately close to the server's own message so the two do not
 * read as different rules.
 */
export function whyNotDone(task: TaskDetail): string | null {
  const open = openSubtasks(task);
  if (open.length) return `${open.length} Teilaufgabe(n) sind noch offen.`;

  const blocking = blockingLinks(task);
  if (blocking.length) {
    const names = blocking.slice(0, 3).map((link) => `„${link.task.title}“`).join(", ");
    const rest = blocking.length > 3 ? ` und ${blocking.length - 3} weitere` : "";
    return `Wartet noch auf ${names}${rest}.`;
  }
  return null;
}

/**
 * The checklist, as the sentence a card shows.
 *
 * `null` for an empty checklist rather than "0/0" — an empty checklist is one
 * nobody has written, and a counter on it is noise on every card that has none.
 */
export function checklistProgress(
  items: readonly ChecklistItem[],
): { done: number; total: number; label: string } | null {
  if (!items.length) return null;
  const done = items.filter((item) => item.done).length;
  return { done, total: items.length, label: `${done}/${items.length}` };
}

/**
 * Hours, formatted the way the firm writes them.
 *
 * Takes the decimal **string** and never parses it into arithmetic — `"7.50"`
 * becomes `7.5 h`. The trailing zero goes because a plan reads "7.5 h" and not
 * "7.50 h"; the value itself is untouched.
 */
export function formatHours(value: string | null): string {
  if (value === null || value === "") return "—";
  const trimmed = value.replace(/\.?0+$/, "");
  return `${trimmed || "0"} h`;
}
