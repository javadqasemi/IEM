import { TaskDependencyType, TaskStatus } from "@prisma/client";

/**
 * What a task is allowed to do, and where it sits on the board.
 *
 * **Pure.** No Prisma client, no Nest injection, nothing async — the same rule
 * `projects.rules.ts` states, and the reason it is the first file of the module
 * rather than the last: the transitions, the cycle check and the position
 * arithmetic are where this module's bugs will be, and every one of them is
 * reachable from a test with a constructed object.
 *
 * Derived from Projects rather than copied from it. The shape is the same — a
 * transition table, a `refuse*` per rule, a `derive*` per figure — and the
 * *content* is different in the three places a task differs from a project:
 * `BLOCKED` is a state it returns from, a task can depend on another task, and
 * a board has an order.
 */

/* ================================================================== */
/* The status machine                                                  */
/* ================================================================== */

/**
 * `TODO → IN_PROGRESS → IN_REVIEW → DONE`, with `BLOCKED` reachable from the
 * three active states and `CANCELLED` from anything unfinished.
 *
 * A table rather than a `switch`, for the reason Projects gives: it is data the
 * client needs too, so the status control offers exactly `transitionsFrom` and
 * never draws an option the server would refuse.
 *
 * Three entries are worth defending:
 *
 * **`IN_REVIEW → IN_PROGRESS` exists.** A review that finds something sends the
 * work back, and that is the normal outcome rather than the exception. Without
 * it the reviewer's only options are to accept or to cancel.
 *
 * **`DONE → IN_PROGRESS` exists too**, and it is the one place this machine is
 * more permissive than `PROJECT_TRANSITIONS`. Reopening a *project* silently
 * reuses a budget; reopening a **task** costs nothing and happens constantly —
 * somebody ticks the wrong card. Refusing it would mean the correction is a new
 * task, and the history of the work would split in two.
 *
 * **`CANCELLED` is terminal and `DONE` is not.** Cancelling is a decision about
 * whether the work should happen at all, and undoing that decision is a new
 * task with a new reason.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  TODO: ["IN_PROGRESS", "BLOCKED", "CANCELLED", "DONE"],
  IN_PROGRESS: ["IN_REVIEW", "DONE", "BLOCKED", "TODO", "CANCELLED"],
  IN_REVIEW: ["DONE", "IN_PROGRESS", "BLOCKED", "CANCELLED"],
  BLOCKED: ["TODO", "IN_PROGRESS", "IN_REVIEW", "CANCELLED"],
  DONE: ["IN_PROGRESS", "TODO"],
  CANCELLED: [],
};

export function transitionsFrom(status: TaskStatus): readonly TaskStatus[] {
  return TASK_TRANSITIONS[status];
}

/** `CANCELLED` takes no more work; everything else is still live. */
export function isTerminal(status: TaskStatus): boolean {
  return status === TaskStatus.CANCELLED;
}

/** Neither finished nor abandoned — what "open" means on every count in this module. */
export function isOpen(status: TaskStatus): boolean {
  return status !== TaskStatus.DONE && status !== TaskStatus.CANCELLED;
}

export type TransitionInput = {
  /** The statuses of this task's direct subtasks. */
  subtasks: readonly { status: TaskStatus }[];
  /**
   * The tasks this one waits for, with the relation type.
   *
   * Only `FS` and `FF` gate completion — see `refuseTransition`.
   */
  dependsOn: readonly { status: TaskStatus; type: TaskDependencyType; title: string }[];
};

/**
 * Why a transition is refused, or `null` if it is allowed.
 *
 * Returns the reason rather than throwing, and returns German: the service turns
 * it into a `BadRequestException`, and the *same* function backs the client's
 * disabled-control tooltip. A rule that can only express itself as an exception
 * cannot explain itself before the user presses the button.
 */
export function refuseTransition(
  from: TaskStatus,
  to: TaskStatus,
  input: TransitionInput,
): string | null {
  if (from === to) return null;

  if (!TASK_TRANSITIONS[from].includes(to)) {
    const allowed = TASK_TRANSITIONS[from];
    if (!allowed.length) return "Eine abgebrochene Aufgabe kann nicht mehr geändert werden.";
    const list =
      allowed.length === 1
        ? allowed[0]
        : `${allowed.slice(0, -1).join(", ")} oder ${allowed[allowed.length - 1]}`;
    return `Eine Aufgabe im Status ${from} kann nur nach ${list} wechseln.`;
  }

  if (to !== TaskStatus.DONE) return null;

  /*
    The two completion preconditions from `docs/data-model.md` §3.9.

    Both are checked here and neither can be a database constraint: one counts
    rows in the same table through a self-relation, the other counts rows in a
    join table. A CHECK cannot see either, and a trigger that could would put
    the rule somewhere no test can reach it.
  */
  const openSubtasks = input.subtasks.filter((task) => isOpen(task.status)).length;
  if (openSubtasks) {
    return `${openSubtasks} Teilaufgabe(n) sind noch offen.`;
  }

  /**
   * `FS` and `FF` block completion; `SS` and `SF` do not.
   *
   * The distinction is what the four types are *for*, and collapsing them would
   * make the other two decorative. A start-to-start relation says "these begin
   * together" — it has nothing to say about finishing, so a predecessor that
   * has started is satisfied whatever its status. Treating every dependency as
   * `FS` is the shortcut that makes a Bauprogramm unrepresentable.
   */
  const blocking = input.dependsOn.filter(
    (dep) =>
      (dep.type === TaskDependencyType.FS || dep.type === TaskDependencyType.FF) &&
      isOpen(dep.status),
  );
  if (blocking.length) {
    const names = blocking.slice(0, 3).map((dep) => `„${dep.title}“`).join(", ");
    const rest = blocking.length > 3 ? ` und ${blocking.length - 3} weitere` : "";
    return `Wartet noch auf ${names}${rest}.`;
  }

  return null;
}

/**
 * Which status a task returns to when it stops being blocked.
 *
 * `blockedFrom` when it is known, `TODO` otherwise. Storing where it came from
 * is what makes unblocking a *return* rather than a reset: a task that was in
 * review when the client went quiet should not reappear in the backlog three
 * weeks later as though nobody had done anything.
 */
export function unblockTo(blockedFrom: TaskStatus | null): TaskStatus {
  if (!blockedFrom || blockedFrom === TaskStatus.BLOCKED) return TaskStatus.TODO;
  return blockedFrom;
}

/* ================================================================== */
/* Dependencies                                                        */
/* ================================================================== */

export type Edge = { predecessorId: string; successorId: string };

/**
 * Whether adding `predecessor → successor` would close a cycle.
 *
 * **The rule the database cannot express.** A foreign key stops a dependency
 * pointing at nothing; nothing stops A waiting for B waiting for C waiting for
 * A. The consequence is not an error — it is a board on which three tasks can
 * never be completed and nobody can say why, because each one individually
 * looks fine.
 *
 * A depth-first walk forward from `successorId`: if it can reach
 * `predecessorId`, the new edge closes the loop. Iterative rather than
 * recursive, because the stack depth is the chain length and a Bauprogramm
 * legitimately has hundreds of links.
 *
 * Self-dependency is the degenerate case and is checked first — it is also the
 * one somebody actually triggers, by picking the task they are looking at.
 */
export function wouldCycle(edges: readonly Edge[], predecessorId: string, successorId: string): boolean {
  if (predecessorId === successorId) return true;

  const forward = new Map<string, string[]>();
  for (const edge of edges) {
    const list = forward.get(edge.predecessorId);
    if (list) list.push(edge.successorId);
    else forward.set(edge.predecessorId, [edge.successorId]);
  }

  const seen = new Set<string>();
  const stack = [successorId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === predecessorId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of forward.get(current) ?? []) stack.push(next);
  }
  return false;
}

/**
 * Whether a parent link would close a cycle in the subtask tree.
 *
 * The same failure in a different shape, and it needs its own function because
 * the tree is stored as a single `parentTaskId` rather than as edge rows: the
 * walk is upward from the proposed parent, and it terminates at a root.
 *
 * `parents` maps a task to its parent. A map that is itself already cyclic
 * would loop for ever, so the walk counts its own steps — the guard costs
 * nothing and turns "the request hung" into a refusal.
 */
export function wouldCycleParent(
  parents: ReadonlyMap<string, string | null>,
  childId: string,
  newParentId: string,
): boolean {
  if (childId === newParentId) return true;

  let current: string | null = newParentId;
  let steps = 0;
  while (current && steps < parents.size + 1) {
    if (current === childId) return true;
    current = parents.get(current) ?? null;
    steps += 1;
  }
  return false;
}

/* ================================================================== */
/* The board                                                           */
/* ================================================================== */

/**
 * The gap between two freshly numbered cards.
 *
 * 1024 rather than 1: a column numbered 0, 1, 2 has nowhere to put a card
 * between the first two, so every drop rewrites the column. With a gap of 1024
 * a card can be inserted between two neighbours ten times before the space runs
 * out, and `positionBetween` reports when it has.
 */
export const POSITION_GAP = 1024;

/** The next position at the end of a column. */
export function nextPosition(positions: readonly number[]): number {
  if (!positions.length) return POSITION_GAP;
  return Math.max(...positions) + POSITION_GAP;
}

/**
 * Where a card dropped between two others belongs, or `null` when the column
 * has to be renumbered.
 *
 * **`null` is not a failure**, and the caller must handle it rather than
 * treating it as an error: it means the integers either side are adjacent, so
 * there is no value between them. The alternative designs are both worse — a
 * float position loses precision after about fifty drops in the same gap and
 * then silently stops ordering, and renumbering the whole column on every drop
 * writes two hundred rows to move one card.
 *
 * `before`/`after` are the neighbours' positions; `null` means the edge of the
 * column.
 */
export function positionBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return POSITION_GAP;
  if (before === null) return after! - POSITION_GAP;
  if (after === null) return before + POSITION_GAP;
  if (after - before < 2) return null;
  return Math.floor((before + after) / 2);
}

/**
 * A whole column, renumbered evenly.
 *
 * Run when `positionBetween` returns `null`. Takes the ids in their *intended*
 * order and returns the positions to write — the caller does one `updateMany`
 * per row inside the transaction that is already moving the card, so the
 * renumber and the move cannot half-apply.
 */
export function renumber(ids: readonly string[]): { id: string; position: number }[] {
  return ids.map((id, index) => ({ id, position: (index + 1) * POSITION_GAP }));
}

/* ================================================================== */
/* The derived figures                                                 */
/* ================================================================== */

/**
 * How far along a task is, from its subtasks and its checklist.
 *
 * **Computed, never stored**, and that is the difference from
 * `Project.progressPercent` rather than an inconsistency with it. A project's
 * progress is stored so that a list of two hundred projects can *sort* by it;
 * nobody sorts a task list by checklist completion, and the inputs are already
 * fetched for the detail view. A stored figure that nothing needs is a figure
 * that goes stale for free.
 *
 * Subtasks and checklist items count equally, and a task with neither is 0 or
 * 100 depending only on its own status — an empty checklist is the start of a
 * task, not the end of one.
 */
export function deriveProgress(input: {
  status: TaskStatus;
  subtasks: readonly { status: TaskStatus }[];
  checklist: readonly { done: boolean }[];
}): number {
  if (input.status === TaskStatus.DONE) return 100;

  const total = input.subtasks.length + input.checklist.length;
  if (!total) return input.status === TaskStatus.IN_REVIEW ? 90 : 0;

  const done =
    input.subtasks.filter((task) => task.status === TaskStatus.DONE).length +
    input.checklist.filter((item) => item.done).length;
  return Math.round((done / total) * 100);
}

/**
 * Overdue: past its date and still open.
 *
 * A **function, not a column**. `dueDate < now AND status NOT IN (DONE,
 * CANCELLED)` is expressible in a `where`, so the list can filter and count by
 * it without storing anything — and a stored `isOverdue` would need the nightly
 * reconciler `Project` needs, to answer for a figure the database can compute
 * exactly. Copying Projects' reconciler here because Projects has one would be
 * deriving the shape rather than the reasoning.
 *
 * The *notification* is a different matter and does need a job: see
 * `tasks.overdue.ts`.
 */
export function isOverdue(
  dueDate: Date | null,
  status: TaskStatus,
  now: Date = new Date(),
): boolean {
  if (!dueDate || !isOpen(status)) return false;
  return dueDate.getTime() < now.getTime();
}

/* ================================================================== */
/* Validation that is not a transition                                 */
/* ================================================================== */

/** `dueDate` on or after `startDate` — the one date rule the schema cannot hold. */
export function refuseDates(startDate: Date | null, dueDate: Date | null): string | null {
  if (!startDate || !dueDate) return null;
  return dueDate.getTime() >= startDate.getTime()
    ? null
    : "Das Fälligkeitsdatum muss am oder nach dem Startdatum liegen.";
}

/**
 * A subtask belongs to its parent's project, or to none.
 *
 * The rule exists because the alternative is invisible: a subtask quietly
 * attached to a different project would appear on that project's board, count
 * toward its open work, and be completed by somebody who has never seen the
 * parent. Nothing would report it.
 */
export function refuseParentProject(
  parentProjectId: string | null,
  childProjectId: string | null,
): string | null {
  if (parentProjectId === childProjectId) return null;
  return "Eine Teilaufgabe muss zum selben Projekt gehören wie ihre übergeordnete Aufgabe.";
}

/**
 * An estimate is hours, and a sane number of them.
 *
 * 2000 is roughly a person-year; a task estimated above it is a project, and
 * the refusal says so rather than storing a number that will make every report
 * that sums estimates meaningless.
 */
export function refuseEstimate(hours: number | null): string | null {
  if (hours === null) return null;
  if (hours < 0) return "Ein Aufwand kann nicht negativ sein.";
  if (hours > 2000) {
    return "Über 2000 Stunden ist keine Aufgabe mehr, sondern ein Projekt oder eine Phase.";
  }
  return null;
}
