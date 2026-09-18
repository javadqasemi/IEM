import { describe, expect, it } from "vitest";
import type { Task, TaskDetail } from "@/entities/task";
import {
  blockingLinks,
  checklistProgress,
  daysOverdue,
  daysUntil,
  dueSoon,
  formatHours,
  isOpen,
  isReadOnly,
  neighboursAt,
  openSubtasks,
  toBoard,
  whyNotDone,
} from "../service";

/**
 * The domain layer, with no mocks at all.
 *
 * That is the property the layer exists for: every function here is pure over
 * entity types, so a test needs neither a fetch stub nor a React renderer.
 * Anything that needed one would belong somewhere else.
 */

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Lüftungskonzept prüfen",
  status: "TODO",
  priority: "MEDIUM",
  startDate: null,
  dueDate: null,
  completedAt: null,
  estimateHours: null,
  spentHours: "0.00",
  position: 1024,
  blockedReason: null,
  isOverdue: false,
  version: 1,
  createdAt: null,
  updatedAt: null,
  parentTaskId: null,
  project: null,
  assignee: null,
  discipline: null,
  milestone: null,
  counts: { subtasks: 0, checklist: 0, dependsOn: 0 },
  ...over,
});

const detail = (over: Partial<TaskDetail> = {}): TaskDetail => ({
  ...task(),
  description: null,
  blockedFrom: null,
  projectId: null,
  assigneeId: null,
  milestoneId: null,
  disciplineId: null,
  createdById: null,
  updatedById: null,
  parentTask: null,
  subtasks: [],
  checklist: [],
  dependsOn: [],
  blocks: [],
  progressPercent: 0,
  allowedTransitions: [],
  ...over,
});

const link = (
  status: TaskDetail["dependsOn"][number]["task"]["status"],
  type: TaskDetail["dependsOn"][number]["type"] = "FS",
  title = "Vorgänger",
  id = "d1",
) => ({ id, type, lagDays: 0, task: { id: `x-${id}`, title, status, dueDate: null } });

describe("isOpen and isReadOnly", () => {
  it("counts everything unfinished as open", () => {
    expect(isOpen("TODO")).toBe(true);
    expect(isOpen("BLOCKED")).toBe(true);
    expect(isOpen("DONE")).toBe(false);
    expect(isOpen("CANCELLED")).toBe(false);
  });

  it("makes only a cancelled task read-only", () => {
    // `DONE` is not read-only: reopening a task costs nothing and happens
    // constantly — somebody ticks the wrong card. The server's transition table
    // agrees, which is what this mirrors.
    expect(isReadOnly({ status: "CANCELLED" })).toBe(true);
    expect(isReadOnly({ status: "DONE" })).toBe(false);
  });
});

describe("daysUntil", () => {
  const now = new Date("2026-09-18T15:00:00");

  it("counts whole days from midnight, not from now", () => {
    /**
     * "in 0 Tagen" has to mean today all day. Counting from *now* makes a
     * millisecond decide between "today" and "yesterday", which is how a
     * deadline badge flickers at lunchtime.
     */
    expect(daysUntil(new Date("2026-09-18T08:00:00"), now)).toBe(0);
    expect(daysUntil(new Date("2026-09-18T23:00:00"), now)).toBe(0);
  });

  it("is negative once the date has passed", () => {
    expect(daysUntil(new Date("2026-09-15T12:00:00"), now)).toBe(-3);
  });

  it("is null without a date", () => {
    expect(daysUntil(null, now)).toBeNull();
  });
});

describe("daysOverdue", () => {
  const now = new Date("2026-09-18T12:00:00");

  it("reads the server's verdict rather than deciding it", () => {
    /**
     * The whole point: `isOverdue` is computed once on the server against one
     * instant. A client that decided it would decide against the reader's clock
     * and their timezone, and a card that is red in Zürich and amber in the
     * browser of somebody travelling is a bug nobody can reproduce.
     */
    const past = task({ dueDate: new Date("2026-09-10T12:00:00"), isOverdue: false });
    expect(daysOverdue(past, now)).toBeNull();
  });

  it("says by how much once the answer is already yes", () => {
    const late = task({ dueDate: new Date("2026-09-10T12:00:00"), isOverdue: true });
    expect(daysOverdue(late, now)).toBe(8);
  });

  it("never reports a negative figure", () => {
    const odd = task({ dueDate: new Date("2026-09-25T12:00:00"), isOverdue: true });
    expect(daysOverdue(odd, now)).toBe(0);
  });
});

describe("dueSoon", () => {
  const now = new Date("2026-09-18T12:00:00");
  const at = (iso: string, over: Partial<Task> = {}) =>
    task({ dueDate: new Date(iso), ...over });

  it("takes what is due today and in the next week", () => {
    const rows = dueSoon(
      [at("2026-09-18T00:00:00"), at("2026-09-24T00:00:00"), at("2026-10-01T00:00:00")],
      7,
      now,
    );
    expect(rows).toHaveLength(2);
  });

  it("excludes what is already overdue", () => {
    /**
     * Overdue is its own, louder category. Mixing it in makes a "diese Woche"
     * list that is mostly last month, which is exactly the list somebody stops
     * opening.
     */
    const rows = dueSoon([at("2026-09-10T00:00:00", { isOverdue: true })], 7, now);
    expect(rows).toEqual([]);
  });

  it("excludes finished work and undated tasks", () => {
    const rows = dueSoon(
      [at("2026-09-19T00:00:00", { status: "DONE" }), task({ dueDate: null })],
      7,
      now,
    );
    expect(rows).toEqual([]);
  });
});

describe("toBoard", () => {
  it("returns every column, including the empty ones", () => {
    /**
     * A board assembled by grouping would omit a column nobody has a card in,
     * so the first task ever created produces a one-column board — and a column
     * that is missing cannot be dropped into, which reads as the board being
     * broken rather than empty.
     */
    const board = toBoard([]);
    expect(board.map((c) => c.column)).toEqual([
      "TODO",
      "IN_PROGRESS",
      "IN_REVIEW",
      "BLOCKED",
      "DONE",
    ]);
  });

  it("drops cancelled cards rather than giving them a column", () => {
    // A board is what is being worked on. A column of abandoned cards grows for
    // ever and is scrolled past daily; the list has a filter for them.
    const board = toBoard([task({ id: "a", status: "CANCELLED" }), task({ id: "b" })]);
    expect(board.flatMap((c) => c.tasks).map((t) => t.id)).toEqual(["b"]);
  });

  it("sorts each column by position, not by anything else", () => {
    // Sorting by anything else means a drag appears to work and then jumps back
    // on the next fetch.
    const board = toBoard([
      task({ id: "c", position: 3072 }),
      task({ id: "a", position: 1024 }),
      task({ id: "b", position: 2048 }),
    ]);
    expect(board[0].tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("puts a card in the column its status names", () => {
    const board = toBoard([task({ id: "a", status: "IN_REVIEW" })]);
    expect(board.find((c) => c.column === "IN_REVIEW")!.tasks).toHaveLength(1);
    expect(board.find((c) => c.column === "TODO")!.tasks).toHaveLength(0);
  });
});

describe("neighboursAt", () => {
  const column = [task({ id: "a" }), task({ id: "b" }), task({ id: "c" })];

  it("names the two ids either side of the slot", () => {
    expect(neighboursAt(column, 1, "zzz")).toEqual({ afterId: "a", beforeId: "b" });
  });

  it("returns null at the top and at the bottom", () => {
    expect(neighboursAt(column, 0, "zzz")).toEqual({ afterId: null, beforeId: "a" });
    expect(neighboursAt(column, 3, "zzz")).toEqual({ afterId: "c", beforeId: null });
  });

  it("excludes the card being moved before counting", () => {
    /**
     * **The off-by-one this function exists for.** Dropping a card two places
     * down its own column means the slots below it have shifted up by one, and
     * an index counted against a list that still contains the card is wrong in
     * exactly the direction nobody notices until they try it.
     */
    // Moving `b` down one: [a, c] with b between c and the end.
    expect(neighboursAt(column, 2, "b")).toEqual({ afterId: "c", beforeId: null });
    // Moving `b` up one: before `a`.
    expect(neighboursAt(column, 0, "b")).toEqual({ afterId: null, beforeId: "a" });
  });

  it("clamps an index past either end", () => {
    // A drop below the last card reports an index of `length`, and a board that
    // re-renders mid-drag can report more.
    expect(neighboursAt(column, 99, "zzz")).toEqual({ afterId: "c", beforeId: null });
    expect(neighboursAt(column, -5, "zzz")).toEqual({ afterId: null, beforeId: "a" });
  });

  it("handles an empty column", () => {
    expect(neighboursAt([], 0, "a")).toEqual({ afterId: null, beforeId: null });
  });
});

describe("blockingLinks", () => {
  it("takes FS and FF and leaves SS and SF", () => {
    /**
     * The same rule the server enforces. A start-to-start relation says "these
     * begin together" and has nothing to say about finishing; treating every
     * dependency as `FS` makes the other two types decorative.
     */
    const rows = blockingLinks(
      detail({
        dependsOn: [
          link("TODO", "FS", "A", "1"),
          link("TODO", "SS", "B", "2"),
          link("IN_PROGRESS", "FF", "C", "3"),
          link("TODO", "SF", "D", "4"),
        ],
      }),
    );
    expect(rows.map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("ignores a predecessor that is finished or cancelled", () => {
    const rows = blockingLinks(
      detail({ dependsOn: [link("DONE", "FS", "A", "1"), link("CANCELLED", "FS", "B", "2")] }),
    );
    expect(rows).toEqual([]);
  });
});

describe("openSubtasks and whyNotDone", () => {
  const sub = (status: Task["status"], id = "s1") => ({
    id,
    title: `Teil ${id}`,
    status,
    priority: "MEDIUM" as const,
    dueDate: null,
    assignee: null,
  });

  it("finds the subtasks that would refuse completion", () => {
    const rows = openSubtasks(detail({ subtasks: [sub("DONE", "a"), sub("TODO", "b")] }));
    expect(rows.map((r) => r.id)).toEqual(["b"]);
  });

  it("reports subtasks before dependencies", () => {
    // One reason, not a list of two — and the nearer one first, because a
    // subtask is this task's own work while a dependency is somebody else's.
    const why = whyNotDone(
      detail({ subtasks: [sub("TODO")], dependsOn: [link("TODO", "FS", "Plan")] }),
    );
    expect(why).toBe("1 Teilaufgabe(n) sind noch offen.");
  });

  it("names the blocking tasks when there are no open subtasks", () => {
    const why = whyNotDone(detail({ dependsOn: [link("TODO", "FS", "Grundriss freigeben")] }));
    expect(why).toContain("Grundriss freigeben");
  });

  it("names at most three and counts the rest", () => {
    // A tooltip listing forty task titles is one nobody reads. The wording
    // matches the server's refusal so the two do not read as different rules.
    const why = whyNotDone(
      detail({
        dependsOn: ["1", "2", "3", "4", "5"].map((id) => link("TODO", "FS", `T${id}`, id)),
      }),
    );
    expect(why).toContain("und 2 weitere");
  });

  it("is null when nothing is in the way", () => {
    // `null` and not an empty string: the control is enabled on `null`, and a
    // falsy empty string would work by accident until somebody rendered it.
    expect(whyNotDone(detail())).toBeNull();
  });
});

describe("checklistProgress", () => {
  const point = (done: boolean, id: string) => ({
    id,
    text: id,
    done,
    doneAt: null,
    doneById: null,
    position: 1,
  });

  it("is null for an empty checklist", () => {
    // An empty checklist is one nobody has written, and a "0/0" counter on
    // every card that has none is noise.
    expect(checklistProgress([])).toBeNull();
  });

  it("counts the ticked points", () => {
    expect(checklistProgress([point(true, "a"), point(false, "b"), point(true, "c")])).toEqual({
      done: 2,
      total: 3,
      label: "2/3",
    });
  });
});

describe("formatHours", () => {
  it("takes the decimal string and never does arithmetic on it", () => {
    // `2.1 + 4.2` is `6.300000000000001`. A column of hours that ends in eleven
    // decimals is a column nobody trusts.
    expect(formatHours("7.50")).toBe("7.5 h");
    expect(formatHours("4.25")).toBe("4.25 h");
    expect(formatHours("12.00")).toBe("12 h");
  });

  it("renders no estimate as a dash", () => {
    expect(formatHours(null)).toBe("—");
    expect(formatHours("")).toBe("—");
  });

  it("keeps a zero estimate as zero", () => {
    // Zero hours is an estimate somebody made; `null` is one nobody made. The
    // trailing-zero trim must not turn "0.00" into an empty string.
    expect(formatHours("0.00")).toBe("0 h");
  });
});
