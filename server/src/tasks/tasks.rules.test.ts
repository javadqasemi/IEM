import { describe, expect, it } from "vitest";
import { TaskDependencyType, TaskStatus } from "@prisma/client";
import {
  POSITION_GAP,
  TASK_TRANSITIONS,
  deriveProgress,
  isOpen,
  isOverdue,
  isTerminal,
  nextPosition,
  positionBetween,
  refuseDates,
  refuseEstimate,
  refuseParentProject,
  refuseTransition,
  renumber,
  transitionsFrom,
  unblockTo,
  wouldCycle,
  wouldCycleParent,
} from "./tasks.rules";

/**
 * The module's rules, exhaustively.
 *
 * Exhaustively because they *can* be: the file is pure, so every case is
 * reachable with a constructed object and there is no reason to test a sample.
 * This is the property `projects.rules.ts` was written to have and the reason
 * the rules are a file rather than methods on a service — a rule that needed a
 * database to reach would be tested once and then not again.
 */

const task = (status: TaskStatus) => ({ status });
const dep = (status: TaskStatus, type: TaskDependencyType = "FS", title = "Vorgänger") => ({
  status,
  type,
  title,
});
const nothing = { subtasks: [], dependsOn: [] };

/* ================================================================== */
/* The status machine                                                  */
/* ================================================================== */

describe("the transition table", () => {
  it("covers every status", () => {
    // A status added to the enum without a row here would return `undefined`
    // from `TASK_TRANSITIONS[from]`, and `refuseTransition` would throw on
    // `.includes` rather than refusing — a 500 where a 400 belongs.
    expect(Object.keys(TASK_TRANSITIONS).sort()).toEqual(Object.values(TaskStatus).sort());
  });

  it("names only real statuses as targets", () => {
    const valid = new Set<string>(Object.values(TaskStatus));
    for (const [from, targets] of Object.entries(TASK_TRANSITIONS)) {
      for (const to of targets) {
        expect(valid.has(to), `${from} → ${to} is not a status`).toBe(true);
      }
    }
  });

  it("never lists a status as a target of itself", () => {
    for (const [from, targets] of Object.entries(TASK_TRANSITIONS)) {
      expect(targets, `${from} lists itself`).not.toContain(from);
    }
  });

  it("makes CANCELLED terminal and DONE not", () => {
    /**
     * The one place this machine is more permissive than `PROJECT_TRANSITIONS`,
     * and it is deliberate: reopening a *project* silently reuses a budget,
     * while reopening a **task** costs nothing and happens constantly —
     * somebody ticks the wrong card. Cancelling is a decision about whether the
     * work should happen at all, and undoing it is a new task with a new reason.
     */
    expect(TASK_TRANSITIONS.CANCELLED).toEqual([]);
    expect(TASK_TRANSITIONS.DONE.length).toBeGreaterThan(0);
    expect(isTerminal(TaskStatus.CANCELLED)).toBe(true);
    expect(isTerminal(TaskStatus.DONE)).toBe(false);
  });

  it("lets a review send work back", () => {
    // The normal outcome of a review that finds something, not the exception.
    expect(transitionsFrom(TaskStatus.IN_REVIEW)).toContain(TaskStatus.IN_PROGRESS);
  });

  it("reaches BLOCKED from every active state and from no finished one", () => {
    for (const status of [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW]) {
      expect(transitionsFrom(status), status).toContain(TaskStatus.BLOCKED);
    }
    expect(transitionsFrom(TaskStatus.DONE)).not.toContain(TaskStatus.BLOCKED);
    expect(transitionsFrom(TaskStatus.CANCELLED)).not.toContain(TaskStatus.BLOCKED);
  });
});

describe("refuseTransition", () => {
  it("allows a no-op", () => {
    expect(refuseTransition(TaskStatus.TODO, TaskStatus.TODO, nothing)).toBeNull();
  });

  it("refuses a move the table does not list, and names what is allowed", () => {
    const refusal = refuseTransition(TaskStatus.DONE, TaskStatus.CANCELLED, nothing);
    expect(refusal).toContain("DONE");
    // "A, B oder C", not "A oder B oder C" — the message is read by a person.
    expect(refusal).toMatch(/oder/);
  });

  it("says a cancelled task is finished with, rather than listing nothing", () => {
    const refusal = refuseTransition(TaskStatus.CANCELLED, TaskStatus.TODO, nothing);
    expect(refusal).toBe("Eine abgebrochene Aufgabe kann nicht mehr geändert werden.");
  });

  it("allows DONE with no subtasks and no dependencies", () => {
    expect(refuseTransition(TaskStatus.IN_PROGRESS, TaskStatus.DONE, nothing)).toBeNull();
  });

  it("refuses DONE while a subtask is open, and counts them", () => {
    const refusal = refuseTransition(TaskStatus.IN_PROGRESS, TaskStatus.DONE, {
      subtasks: [task(TaskStatus.DONE), task(TaskStatus.TODO), task(TaskStatus.BLOCKED)],
      dependsOn: [],
    });
    expect(refusal).toBe("2 Teilaufgabe(n) sind noch offen.");
  });

  it("counts a cancelled subtask as closed", () => {
    // Cancelled is a decision that the work will not happen. Treating it as open
    // would make a parent permanently uncompletable because of work somebody
    // deliberately dropped.
    expect(
      refuseTransition(TaskStatus.IN_PROGRESS, TaskStatus.DONE, {
        subtasks: [task(TaskStatus.CANCELLED), task(TaskStatus.DONE)],
        dependsOn: [],
      }),
    ).toBeNull();
  });

  it("refuses DONE while an FS predecessor is open", () => {
    const refusal = refuseTransition(TaskStatus.IN_PROGRESS, TaskStatus.DONE, {
      subtasks: [],
      dependsOn: [dep(TaskStatus.TODO, "FS", "Grundriss freigeben")],
    });
    expect(refusal).toContain("Grundriss freigeben");
  });

  it("refuses DONE while an FF predecessor is open", () => {
    expect(
      refuseTransition(TaskStatus.IN_PROGRESS, TaskStatus.DONE, {
        subtasks: [],
        dependsOn: [dep(TaskStatus.IN_PROGRESS, "FF")],
      }),
    ).not.toBeNull();
  });

  it("allows DONE despite an open SS or SF predecessor", () => {
    /**
     * The distinction the four types exist for. A start-to-start relation says
     * "these begin together" and has nothing to say about finishing; treating
     * every dependency as `FS` is the shortcut that makes a Bauprogramm
     * unrepresentable and the other two types decorative.
     */
    for (const type of ["SS", "SF"] as const) {
      expect(
        refuseTransition(TaskStatus.IN_PROGRESS, TaskStatus.DONE, {
          subtasks: [],
          dependsOn: [dep(TaskStatus.TODO, type)],
        }),
        type,
      ).toBeNull();
    }
  });

  it("names at most three blockers and counts the rest", () => {
    const refusal = refuseTransition(TaskStatus.IN_PROGRESS, TaskStatus.DONE, {
      subtasks: [],
      dependsOn: [
        dep(TaskStatus.TODO, "FS", "A"),
        dep(TaskStatus.TODO, "FS", "B"),
        dep(TaskStatus.TODO, "FS", "C"),
        dep(TaskStatus.TODO, "FS", "D"),
        dep(TaskStatus.TODO, "FS", "E"),
      ],
    });
    // A refusal listing forty task titles is a refusal nobody reads.
    expect(refusal).toContain("und 2 weitere");
    expect(refusal).not.toContain("„D“");
  });

  it("does not check completion preconditions for any other target", () => {
    // Blocking a task with open subtasks is exactly what blocking is for.
    expect(
      refuseTransition(TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED, {
        subtasks: [task(TaskStatus.TODO)],
        dependsOn: [dep(TaskStatus.TODO)],
      }),
    ).toBeNull();
  });
});

describe("unblockTo", () => {
  it("returns to where it came from", () => {
    expect(unblockTo(TaskStatus.IN_REVIEW)).toBe(TaskStatus.IN_REVIEW);
  });

  it("falls back to TODO when nothing was recorded", () => {
    expect(unblockTo(null)).toBe(TaskStatus.TODO);
  });

  it("never returns BLOCKED", () => {
    // A row whose `blockedFrom` is somehow `BLOCKED` would otherwise unblock to
    // itself, and the card would be stuck with no error anywhere.
    expect(unblockTo(TaskStatus.BLOCKED)).toBe(TaskStatus.TODO);
  });
});

describe("isOpen", () => {
  it("counts everything unfinished", () => {
    expect(isOpen(TaskStatus.TODO)).toBe(true);
    expect(isOpen(TaskStatus.BLOCKED)).toBe(true);
    expect(isOpen(TaskStatus.IN_REVIEW)).toBe(true);
    expect(isOpen(TaskStatus.DONE)).toBe(false);
    expect(isOpen(TaskStatus.CANCELLED)).toBe(false);
  });
});

/* ================================================================== */
/* Cycles                                                              */
/* ================================================================== */

describe("wouldCycle", () => {
  it("refuses a task depending on itself", () => {
    // The degenerate case, and the one somebody actually triggers — by picking
    // the task they are looking at out of the picker.
    expect(wouldCycle([], "a", "a")).toBe(true);
  });

  it("allows an edge into an empty graph", () => {
    expect(wouldCycle([], "a", "b")).toBe(false);
  });

  it("refuses a two-task loop", () => {
    expect(wouldCycle([{ predecessorId: "a", successorId: "b" }], "b", "a")).toBe(true);
  });

  it("refuses a loop three hops away", () => {
    /**
     * The case a neighbourhood check would pass. A→B→C exists; adding C→A
     * closes it, and nothing about A's own edges says so. The consequence is
     * not an error — it is three tasks that can never be completed, each of
     * which looks fine on its own.
     */
    const edges = [
      { predecessorId: "a", successorId: "b" },
      { predecessorId: "b", successorId: "c" },
    ];
    expect(wouldCycle(edges, "c", "a")).toBe(true);
  });

  it("allows a diamond", () => {
    // A→B, A→C, B→D, C→D. Two paths to the same task is not a cycle, and a
    // check that walked without a `seen` set would either loop or refuse it.
    const edges = [
      { predecessorId: "a", successorId: "b" },
      { predecessorId: "a", successorId: "c" },
      { predecessorId: "b", successorId: "d" },
    ];
    expect(wouldCycle(edges, "c", "d")).toBe(false);
  });

  it("terminates on a graph that is already cyclic", () => {
    // Should not happen — and if a bad migration or a direct SQL write ever
    // makes it happen, the answer has to be an error message rather than a
    // request that never returns.
    const edges = [
      { predecessorId: "a", successorId: "b" },
      { predecessorId: "b", successorId: "a" },
    ];
    expect(wouldCycle(edges, "a", "b")).toBe(true);
  });

  it("ignores an unrelated component", () => {
    const edges = [
      { predecessorId: "x", successorId: "y" },
      { predecessorId: "y", successorId: "z" },
    ];
    expect(wouldCycle(edges, "a", "b")).toBe(false);
  });
});

describe("wouldCycleParent", () => {
  const tree = (pairs: [string, string | null][]) => new Map(pairs);

  it("refuses a task as its own parent", () => {
    expect(wouldCycleParent(tree([["a", null]]), "a", "a")).toBe(true);
  });

  it("allows a root as a parent", () => {
    expect(wouldCycleParent(tree([["a", null], ["b", null]]), "a", "b")).toBe(false);
  });

  it("refuses making a task the child of its own descendant", () => {
    // a → b → c. Setting a's parent to c closes the loop.
    const parents = tree([["a", null], ["b", "a"], ["c", "b"]]);
    expect(wouldCycleParent(parents, "a", "c")).toBe(true);
  });

  it("allows a deeper but acyclic move", () => {
    const parents = tree([["a", null], ["b", null], ["c", "b"]]);
    expect(wouldCycleParent(parents, "a", "c")).toBe(false);
  });

  it("terminates on a map that is already cyclic", () => {
    // The step counter, which costs nothing and turns "the request hung" into a
    // refusal.
    const parents = tree([["a", "b"], ["b", "a"]]);
    expect(() => wouldCycleParent(parents, "z", "a")).not.toThrow();
  });
});

/* ================================================================== */
/* The board                                                           */
/* ================================================================== */

describe("nextPosition", () => {
  it("starts a column at the gap", () => {
    expect(nextPosition([])).toBe(POSITION_GAP);
  });

  it("appends past the largest, not past the last", () => {
    // The array is not guaranteed sorted, and a `positions[length-1]` would put
    // the new card in the middle of an unsorted column.
    expect(nextPosition([3072, 1024, 2048])).toBe(3072 + POSITION_GAP);
  });
});

describe("positionBetween", () => {
  it("places the first card of an empty column", () => {
    expect(positionBetween(null, null)).toBe(POSITION_GAP);
  });

  it("places above the top card", () => {
    expect(positionBetween(null, 1024)).toBe(0);
  });

  it("places below the bottom card", () => {
    expect(positionBetween(2048, null)).toBe(2048 + POSITION_GAP);
  });

  it("takes the midpoint between two cards", () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
  });

  it("returns null when the gap is exhausted", () => {
    /**
     * **`null` is not a failure** and the caller must not treat it as one: it
     * means the integers either side are adjacent, so there is no value between
     * them. `TasksService.move` renumbers the column and places the card again,
     * inside the same transaction.
     */
    expect(positionBetween(1024, 1025)).toBeNull();
    expect(positionBetween(1024, 1024)).toBeNull();
  });

  it("survives ten insertions into the same gap and then reports", () => {
    // With a gap of 1024 a card can be inserted between two neighbours ten
    // times before the space runs out. The eleventh is the renumber path, and
    // it has to work the first time it happens.
    let before = 0;
    const after = 1024;
    let inserted = 0;
    for (;;) {
      const next = positionBetween(before, after);
      if (next === null) break;
      before = next;
      inserted += 1;
      if (inserted > 50) throw new Error("gap never exhausted");
    }
    expect(inserted).toBe(10);
  });
});

describe("renumber", () => {
  it("spaces a column evenly from one gap", () => {
    expect(renumber(["a", "b", "c"])).toEqual([
      { id: "a", position: 1024 },
      { id: "b", position: 2048 },
      { id: "c", position: 3072 },
    ]);
  });

  it("keeps the given order", () => {
    const out = renumber(["c", "a", "b"]);
    expect(out.map((row) => row.id)).toEqual(["c", "a", "b"]);
    expect(out[0].position).toBeLessThan(out[1].position);
  });

  it("handles an empty column", () => {
    expect(renumber([])).toEqual([]);
  });
});

/* ================================================================== */
/* The derived figures                                                 */
/* ================================================================== */

describe("deriveProgress", () => {
  it("is 100 for a done task whatever its checklist says", () => {
    // The status is the fact. A completed task with an unticked point is a
    // checklist somebody did not finish filling in, not work that is unfinished.
    expect(
      deriveProgress({ status: TaskStatus.DONE, subtasks: [], checklist: [{ done: false }] }),
    ).toBe(100);
  });

  it("is 0 for a fresh task with nothing on it", () => {
    // An empty checklist is the start of a task, not the end of one.
    expect(deriveProgress({ status: TaskStatus.TODO, subtasks: [], checklist: [] })).toBe(0);
  });

  it("reports a task in review as nearly finished", () => {
    expect(deriveProgress({ status: TaskStatus.IN_REVIEW, subtasks: [], checklist: [] })).toBe(90);
  });

  it("counts subtasks and checklist points equally", () => {
    expect(
      deriveProgress({
        status: TaskStatus.IN_PROGRESS,
        subtasks: [task(TaskStatus.DONE), task(TaskStatus.TODO)],
        checklist: [{ done: true }, { done: false }],
      }),
    ).toBe(50);
  });

  it("counts a cancelled subtask as not done", () => {
    /*
      Different from `refuseTransition`, deliberately. Completion asks "is
      anything still outstanding", and a cancelled subtask is not. Progress asks
      "how much of the plan was carried out", and a cancelled subtask was not —
      counting it as done would show 100% for a task where half the work was
      dropped.
    */
    expect(
      deriveProgress({
        status: TaskStatus.IN_PROGRESS,
        subtasks: [task(TaskStatus.CANCELLED), task(TaskStatus.DONE)],
        checklist: [],
      }),
    ).toBe(50);
  });

  it("rounds rather than truncating", () => {
    expect(
      deriveProgress({
        status: TaskStatus.IN_PROGRESS,
        subtasks: [],
        checklist: [{ done: true }, { done: true }, { done: false }],
      }),
    ).toBe(67);
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  const yesterday = new Date("2026-09-17T12:00:00Z");
  const tomorrow = new Date("2026-09-19T12:00:00Z");

  it("is false without a date", () => {
    // A task nobody has dated cannot be late. Treating a missing date as
    // overdue would make every backlog red on the day the module ships.
    expect(isOverdue(null, TaskStatus.TODO, now)).toBe(false);
  });

  it("is true for an open task past its date", () => {
    expect(isOverdue(yesterday, TaskStatus.TODO, now)).toBe(true);
  });

  it("is true for a blocked task past its date", () => {
    // Blocked is open. A blocked card that is three weeks late is exactly the
    // one somebody needs to see.
    expect(isOverdue(yesterday, TaskStatus.BLOCKED, now)).toBe(true);
  });

  it("is false once the task is finished or cancelled", () => {
    expect(isOverdue(yesterday, TaskStatus.DONE, now)).toBe(false);
    expect(isOverdue(yesterday, TaskStatus.CANCELLED, now)).toBe(false);
  });

  it("is false for a future date", () => {
    expect(isOverdue(tomorrow, TaskStatus.TODO, now)).toBe(false);
  });

  it("is false at the exact instant it is due", () => {
    expect(isOverdue(now, TaskStatus.TODO, now)).toBe(false);
  });
});

/* ================================================================== */
/* Validation that is not a transition                                 */
/* ================================================================== */

describe("refuseDates", () => {
  const a = new Date("2026-03-01");
  const b = new Date("2026-03-10");

  it("allows either date missing", () => {
    expect(refuseDates(null, b)).toBeNull();
    expect(refuseDates(a, null)).toBeNull();
  });

  it("allows a due date after the start", () => {
    expect(refuseDates(a, b)).toBeNull();
  });

  it("allows the same day", () => {
    // Different from `refuseDates` on a *project*, which requires the end to be
    // strictly after the start. A task that starts and is due on the same day is
    // the commonest task there is.
    expect(refuseDates(a, a)).toBeNull();
  });

  it("refuses a due date before the start", () => {
    expect(refuseDates(b, a)).toContain("Startdatum");
  });
});

describe("refuseParentProject", () => {
  it("allows a subtask on the parent's project", () => {
    expect(refuseParentProject("p1", "p1")).toBeNull();
  });

  it("allows both with no project", () => {
    expect(refuseParentProject(null, null)).toBeNull();
  });

  it("refuses a subtask on a different project", () => {
    expect(refuseParentProject("p1", "p2")).not.toBeNull();
  });

  it("refuses a firm-level subtask under a project task", () => {
    // Silent otherwise: the subtask appears on no board and is still counted in
    // "what is assigned to me".
    expect(refuseParentProject("p1", null)).not.toBeNull();
  });
});

describe("refuseEstimate", () => {
  it("allows no estimate", () => {
    expect(refuseEstimate(null)).toBeNull();
  });

  it("allows zero and a normal figure", () => {
    expect(refuseEstimate(0)).toBeNull();
    expect(refuseEstimate(7.5)).toBeNull();
  });

  it("refuses a negative estimate", () => {
    expect(refuseEstimate(-1)).not.toBeNull();
  });

  it("refuses a figure that is a project rather than a task", () => {
    expect(refuseEstimate(2001)).toContain("Projekt");
    expect(refuseEstimate(2000)).toBeNull();
  });
});
