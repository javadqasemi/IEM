import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDetailDto, TaskDto } from "../dto";
import {
  toCommentBody,
  toCreateBody,
  toDatePart,
  toDependencyBody,
  toMoveBody,
  toTask,
  toTaskDetail,
  toTaskStats,
  toUpdateBody,
} from "../mapper";

/**
 * DTO ⇄ entity, both directions.
 *
 * The outbound half is where a `Date` that stayed a string breaks a comparison
 * that never throws. The inbound half is where a `PATCH` that sent `undefined`
 * instead of `null` silently leaves a column alone and answers 200.
 */

const dto = (over: Partial<TaskDto> = {}): TaskDto => ({
  id: "t1",
  title: "Lüftungskonzept prüfen",
  status: "IN_PROGRESS",
  priority: "HIGH",
  startDate: "2026-09-01T00:00:00.000Z",
  dueDate: "2026-09-30T00:00:00.000Z",
  completedAt: null,
  estimateHours: "7.50",
  spentHours: "0.00",
  position: 1024,
  blockedReason: null,
  isOverdue: false,
  version: 3,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  parentTaskId: null,
  project: { id: "p1", number: "P-2026-014", name: "Guglera" },
  assignee: { id: "e1", name: "Anna Meier", email: "anna@iem.ch" },
  discipline: { id: "d1", code: "LFT", name: "Lüftung", colour: "disc-air" },
  milestone: { id: "m1", name: "Bauprojekt", dueDate: "2026-10-01T00:00:00.000Z" },
  counts: { subtasks: 2, checklist: 4, dependsOn: 1 },
  ...over,
});

const detailDto = (over: Partial<TaskDetailDto> = {}): TaskDetailDto => ({
  ...dto(),
  description: "Gegen SIA 382/1",
  blockedFrom: null,
  projectId: "p1",
  assigneeId: "e1",
  milestoneId: "m1",
  disciplineId: "d1",
  createdById: "u1",
  updatedById: "u2",
  parentTask: null,
  subtasks: [],
  checklist: [],
  dependsOn: [],
  blocks: [],
  progressPercent: 40,
  allowedTransitions: ["DONE", "BLOCKED"],
  ...over,
});

let warned: string[] = [];

beforeEach(() => {
  warned = [];
  vi.spyOn(console, "warn").mockImplementation((message: unknown) => {
    warned.push(String(message));
  });
});

afterEach(() => vi.restoreAllMocks());

describe("toTask", () => {
  it("turns every date into a Date", () => {
    // `"2026-09-30" < someDate` compares a string to an object and never
    // throws — it is simply always false.
    const task = toTask(dto());
    expect(task.dueDate).toBeInstanceOf(Date);
    expect(task.startDate).toBeInstanceOf(Date);
    expect(task.milestone!.dueDate).toBeInstanceOf(Date);
  });

  it("leaves a null date null rather than making it the epoch", () => {
    // `new Date(null)` is 1 January 1970, silently.
    expect(toTask(dto({ dueDate: null })).dueDate).toBeNull();
  });

  it("keeps hours as the string the server sent", () => {
    /**
     * Parsing it is the first step toward adding it up, and `2.1 + 4.2` is
     * `6.300000000000001`. `formatHours` renders it; nothing sums it.
     */
    const task = toTask(dto());
    expect(task.estimateHours).toBe("7.50");
    expect(typeof task.estimateHours).toBe("string");
  });

  it("passes isOverdue through rather than recomputing it", () => {
    // The server decided it against one instant. A client that recomputed it
    // would decide against the reader's clock and their timezone.
    expect(toTask(dto({ isOverdue: true, dueDate: null })).isOverdue).toBe(true);
  });

  it("falls back and warns on an unknown status", () => {
    /**
     * The least-bad of three options: throwing would blank a board because one
     * card came from a newer server, leaving it a `string` would push the
     * problem into every `switch`, and mapping it silently would hide a real
     * deployment skew.
     */
    const task = toTask(dto({ status: "ARCHIVED_SOMEHOW" }));
    expect(task.status).toBe("TODO");
    expect(warned.join(" ")).toContain("ARCHIVED_SOMEHOW");
  });

  it("copies the nested objects rather than sharing them", () => {
    // The DTO objects belong to the cache; an entity that shares one is a
    // mutation away from changing what another screen is reading.
    const source = dto();
    const task = toTask(source);
    expect(task.project).not.toBe(source.project);
    expect(task.counts).not.toBe(source.counts);
  });

  it("survives a task with no project, assignee, Gewerk or milestone", () => {
    // The firm-level to-do: the module's defining case, and the one a mapper
    // written against seeded data would never see.
    const task = toTask(dto({ project: null, assignee: null, discipline: null, milestone: null }));
    expect(task.project).toBeNull();
    expect(task.milestone).toBeNull();
  });
});

describe("toTaskDetail", () => {
  it("filters an unknown transition instead of falling back", () => {
    /**
     * The one place the fallback strategy is the wrong one, and it is worth the
     * exception: a transition the client does not recognise must **disappear**,
     * not become `TODO`. Offering the wrong button is worse than offering one
     * fewer.
     */
    const detail = toTaskDetail(detailDto({ allowedTransitions: ["DONE", "ERLEDIGT"] }));
    expect(detail.allowedTransitions).toEqual(["DONE"]);
    // And silently: this is not a deployment-skew warning, it is the intended
    // behaviour of a narrower client.
    expect(warned.join(" ")).not.toContain("ERLEDIGT");
  });

  it("flattens both dependency directions to one shape", () => {
    const detail = toTaskDetail(
      detailDto({
        dependsOn: [
          {
            id: "d1",
            type: "FS",
            lagDays: 0,
            task: { id: "t9", title: "Vorher", status: "DONE", dueDate: null },
          },
        ],
        blocks: [
          {
            id: "d2",
            type: "SS",
            lagDays: -2,
            task: { id: "t8", title: "Nachher", status: "TODO", dueDate: null },
          },
        ],
      }),
    );
    // One renderer for both lists; a second is one reuse away from showing the
    // wrong end of the edge.
    expect(detail.dependsOn[0].task.title).toBe("Vorher");
    expect(detail.blocks[0].task.title).toBe("Nachher");
    expect(detail.blocks[0].lagDays).toBe(-2);
  });

  it("takes progressPercent from the server", () => {
    // Computed there from the rows it fetched — unlike `Project.progressPercent`
    // it is not a column, and unlike a client copy it cannot disagree with the
    // subtask list beneath it.
    expect(toTaskDetail(detailDto()).progressPercent).toBe(40);
  });
});

describe("toTaskStats", () => {
  it("fills every status the endpoint left out", () => {
    /**
     * `/tasks/stats` groups by status, so a fresh database sends `{ TODO: 1 }`.
     * The board's headings read this map directly, and `undefined` renders as
     * nothing where `0` is the truthful answer.
     */
    const stats = toTaskStats({ byStatus: { TODO: 1 }, total: 1, open: 1, overdue: 0 });
    expect(stats.byStatus.DONE).toBe(0);
    expect(stats.byStatus.BLOCKED).toBe(0);
    expect(stats.byStatus.TODO).toBe(1);
  });
});

describe("toDatePart", () => {
  it("writes a plain yyyy-mm-dd in local time", () => {
    /**
     * `toISOString()` would shift a date typed in Zürich back a day for most of
     * the year, and the day it lands on is a deadline somebody is measured
     * against.
     */
    expect(toDatePart(new Date(2026, 8, 18))).toBe("2026-09-18");
    expect(toDatePart(new Date(2026, 0, 1))).toBe("2026-01-01");
  });

  it("preserves the difference between undefined and null", () => {
    expect(toDatePart(undefined)).toBeUndefined();
    expect(toDatePart(null)).toBeNull();
  });
});

describe("toCreateBody", () => {
  it("omits what the form left empty rather than sending null", () => {
    // The create endpoint has no "clear it" case — a field that is absent is
    // simply absent — and the DTO rejects an explicit null.
    const body = toCreateBody({ title: "Neu", projectId: null, dueDate: null });
    expect(body).toEqual({ title: "Neu" });
  });

  it("sends what it was given", () => {
    const body = toCreateBody({
      title: "Neu",
      projectId: "p1",
      assigneeId: "e1",
      dueDate: new Date(2026, 11, 1),
      estimateHours: "3.50",
    });
    expect(body).toEqual({
      title: "Neu",
      projectId: "p1",
      assigneeId: "e1",
      dueDate: "2026-12-01",
      estimateHours: "3.50",
    });
  });
});

describe("toUpdateBody", () => {
  it("keeps the version and drops what was not supplied", () => {
    /**
     * `undefined` means "not supplied"; `null` means "clear it". A naive
     * `{ ...values }` destroys the distinction, which is the whole reason
     * `PATCH` works.
     */
    const body = toUpdateBody({ expectedVersion: 4, title: "Anders" });
    expect(body).toEqual({ expectedVersion: 4, title: "Anders" });
  });

  it("sends an explicit null to clear a relation", () => {
    const body = toUpdateBody({ expectedVersion: 4, assigneeId: null, dueDate: null });
    expect(body.assigneeId).toBeNull();
    expect(body.dueDate).toBeNull();
    expect("projectId" in body).toBe(false);
  });

  it("never drops expectedVersion", () => {
    // The type requires it and the server refuses a body without it, so
    // `defined` must not be able to strip it.
    expect(toUpdateBody({ expectedVersion: 1 })).toEqual({ expectedVersion: 1 });
  });
});

describe("toMoveBody", () => {
  it("sends the neighbours, including the nulls", () => {
    // A `null` neighbour means an edge of the column, and sending the key makes
    // the intent readable in a network tab.
    expect(toMoveBody({ status: "DONE", afterId: "a", beforeId: null })).toEqual({
      status: "DONE",
      afterId: "a",
      beforeId: null,
    });
  });

  it("omits the status for a reorder within a column", () => {
    // Otherwise the audit log carries a status change that did not happen.
    expect(toMoveBody({ afterId: "a" })).toEqual({ afterId: "a" });
  });
});

describe("toDependencyBody and toCommentBody", () => {
  it("lets the server choose the default relation type", () => {
    expect(toDependencyBody({ predecessorId: "t2" })).toEqual({ predecessorId: "t2" });
  });

  it("keeps a negative lag", () => {
    // −2 on `FS` means the successor may start two days before the predecessor
    // finishes, which is how a Bauprogramm overlaps trades.
    expect(toDependencyBody({ predecessorId: "t2", lagDays: -2 }).lagDays).toBe(-2);
  });

  it("drops an empty mention list", () => {
    // Sending `mentionedIds: []` is the same as sending nothing, and the
    // shorter body is the one a reader can scan.
    expect(toCommentBody({ body: "Hallo", mentionedIds: [] })).toEqual({ body: "Hallo" });
    expect(toCommentBody({ body: "Hallo", mentionedIds: ["e1"] }).mentionedIds).toEqual(["e1"]);
  });
});
