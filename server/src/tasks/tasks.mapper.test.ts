import { BadRequestException } from "@nestjs/common";
import { Prisma, TaskStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  TASK_DETAIL_SELECT,
  TASK_LIST_SELECT,
  toAuditSnapshot,
  toChecklistItem,
  toDate,
  toHours,
  toHoursNumber,
  toTaskCreateData,
  toTaskDetail,
  toTaskExportRow,
  toTaskListItem,
  toTaskUpdateData,
} from "./tasks.mapper";

/**
 * The DTO boundary, both directions.
 *
 * Outbound first, because a `Decimal` that escapes it renders as
 * `{"s":1,"e":6,"d":[…]}` — which reads in a network tab like a server bug
 * rather than a missing conversion. Inbound second, because that half is where
 * the *silent* failures are: a conversion that writes `undefined` leaves a
 * column alone and the endpoint answers 200.
 */

const NOW = new Date("2026-09-18T12:00:00Z");

const listRow = (over: Record<string, unknown> = {}) =>
  ({
    id: "t1",
    title: "Lüftungskonzept prüfen",
    status: TaskStatus.IN_PROGRESS,
    priority: "HIGH",
    startDate: new Date("2026-09-01T00:00:00Z"),
    dueDate: new Date("2026-09-30T00:00:00Z"),
    completedAt: null,
    estimateHours: new Prisma.Decimal("7.5"),
    spentHours: new Prisma.Decimal("0"),
    position: 1024,
    blockedReason: null,
    version: 3,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-09-10T00:00:00Z"),
    parentTaskId: null,
    project: { id: "p1", number: "P-2026-014", name: "Schulhaus Guglera" },
    assignee: { id: "e1", firstName: "Anna", lastName: "Meier", email: "anna@iem.ch" },
    discipline: { id: "d1", code: "LFT", name: "Lüftung", defaultColour: "disc-air" },
    milestone: { id: "m1", name: "Bauprojekt", dueDate: new Date("2026-10-01T00:00:00Z") },
    _count: { subtasks: 2, checklist: 4, dependsOn: 1 },
    ...over,
  }) as never;

const detailRow = (over: Record<string, unknown> = {}) =>
  ({
    ...(listRow() as unknown as Record<string, unknown>),
    description: "Gegen SIA 382/1",
    blockedFrom: null,
    overdueNotifiedAt: null,
    createdById: "u1",
    updatedById: "u2",
    disciplineId: "d1",
    milestoneId: "m1",
    assigneeId: "e1",
    projectId: "p1",
    parentTask: null,
    subtasks: [],
    checklist: [],
    dependsOn: [],
    blocks: [],
    ...over,
  }) as never;

/* ================================================================== */
/* The selects                                                         */
/* ================================================================== */

describe("the selects", () => {
  it("make the detail a superset of the list", () => {
    // The mapper spreads `toTaskListItem` into `toTaskDetail`, so a field the
    // list select has and the detail select lacks would be `undefined` on the
    // detail — which compiles and is invisible until somebody opens a card.
    for (const key of Object.keys(TASK_LIST_SELECT)) {
      expect(TASK_DETAIL_SELECT, key).toHaveProperty(key);
    }
  });

  it("fetches counts and not rows on the list", () => {
    /**
     * A card shows "3/7" and a dependency badge. Fetching the subtask and
     * checklist rows for every card would be fifty extra joins to render two
     * numbers — and the moment somebody adds them here, a board gets slow with
     * nothing pointing at the cause.
     */
    expect(TASK_LIST_SELECT).toHaveProperty("_count");
    expect(TASK_LIST_SELECT).not.toHaveProperty("subtasks");
    expect(TASK_LIST_SELECT).not.toHaveProperty("checklist");
  });
});

/* ================================================================== */
/* Outbound                                                            */
/* ================================================================== */

describe("toTaskListItem", () => {
  it("turns hours into a string at the column's scale", () => {
    // `.toFixed(2)`: a Decimal stored as `7.50` prints `7.5` from `.toString()`,
    // and an estimate that renders as "7.5 h" on one screen and "7.50 h" on
    // another reads as two different numbers.
    expect(toTaskListItem(listRow(), NOW).estimateHours).toBe("7.50");
    expect(toTaskListItem(listRow(), NOW).spentHours).toBe("0.00");
  });

  it("returns null for a missing estimate rather than zero", () => {
    // Zero hours is an estimate somebody made. Null is one nobody made, and a
    // report that sums them must be able to tell.
    expect(toTaskListItem(listRow({ estimateHours: null }), NOW).estimateHours).toBeNull();
  });

  it("turns dates into ISO strings with the timezone", () => {
    // `2026-09-30` read in Zürich and in UTC are different days, and the
    // difference lands on a deadline.
    expect(toTaskListItem(listRow(), NOW).dueDate).toBe("2026-09-30T00:00:00.000Z");
  });

  it("computes isOverdue against the instant it is given", () => {
    /**
     * `now` is a parameter, not `new Date()` inside — otherwise two cards in one
     * response could be rendered against two different instants, and the mapper
     * could not be tested without freezing time.
     */
    const past = new Date("2026-10-05T00:00:00Z");
    expect(toTaskListItem(listRow(), NOW).isOverdue).toBe(false);
    expect(toTaskListItem(listRow(), past).isOverdue).toBe(true);
  });

  it("sends the version on every row", () => {
    /**
     * On the list as well as the detail, so a caller holding a row holds what an
     * edit needs. A version available only on the detail would mean every inline
     * edit fetching the record first — and that fetch is exactly the window the
     * lock exists to close.
     */
    expect(toTaskListItem(listRow(), NOW).version).toBe(3);
  });

  it("flattens a person to one name", () => {
    expect(toTaskListItem(listRow(), NOW).assignee).toEqual({
      id: "e1",
      name: "Anna Meier",
      email: "anna@iem.ch",
    });
  });

  it("renames defaultColour to colour, keeping the token", () => {
    // A token name, never a hex literal — the closed set of six. The rename is
    // because `default` means nothing to a card that is rendering one Gewerk.
    expect(toTaskListItem(listRow(), NOW).discipline).toMatchObject({ colour: "disc-air" });
  });

  it("survives a task with no project, assignee, Gewerk or milestone", () => {
    // The firm-level to-do: the module's defining case, and the one a mapper
    // written against seeded data would never see.
    const out = toTaskListItem(
      listRow({ project: null, assignee: null, discipline: null, milestone: null }),
      NOW,
    );
    expect(out.project).toBeNull();
    expect(out.assignee).toBeNull();
    expect(out.discipline).toBeNull();
    expect(out.milestone).toBeNull();
  });
});

describe("toTaskDetail", () => {
  it("includes everything the list item has", () => {
    const list = toTaskListItem(listRow(), NOW);
    const detail = toTaskDetail(detailRow(), NOW);
    for (const key of Object.keys(list)) {
      expect(detail, key).toHaveProperty(key);
    }
  });

  it("computes progress from the rows it already fetched", () => {
    /**
     * Computed, not stored — unlike `Project.progressPercent`. A project list
     * sorts by progress, a task list does not, and a stored figure that nothing
     * sorts by is a figure that goes stale for free.
     */
    const out = toTaskDetail(
      detailRow({
        subtasks: [
          { id: "s1", title: "A", status: TaskStatus.DONE, priority: "LOW", dueDate: null, assignee: null },
          { id: "s2", title: "B", status: TaskStatus.TODO, priority: "LOW", dueDate: null, assignee: null },
        ],
        checklist: [
          { id: "c1", text: "x", done: true, doneAt: null, doneById: null, position: 1 },
          { id: "c2", text: "y", done: true, doneAt: null, doneById: null, position: 2 },
        ],
      }),
      NOW,
    );
    expect(out.progressPercent).toBe(75);
  });

  it("presents both dependency directions with the same shape", () => {
    /*
      `dependsOn` names its predecessor and `blocks` names its successor, and
      both are flattened to `task`. Without that the client would need two
      renderers for one list, and the day somebody reuses the first for the
      second the card silently shows the wrong task.
    */
    const out = toTaskDetail(
      detailRow({
        dependsOn: [
          {
            id: "d1",
            type: "FS",
            lagDays: 0,
            predecessor: { id: "t9", title: "Vorher", status: TaskStatus.DONE, dueDate: null },
          },
        ],
        blocks: [
          {
            id: "d2",
            type: "SS",
            lagDays: -2,
            successor: { id: "t8", title: "Nachher", status: TaskStatus.TODO, dueDate: null },
          },
        ],
      }),
      NOW,
    );
    expect(out.dependsOn[0].task).toMatchObject({ id: "t9", title: "Vorher" });
    expect(out.blocks[0].task).toMatchObject({ id: "t8", title: "Nachher" });
    expect(out.blocks[0].lagDays).toBe(-2);
  });
});

describe("toChecklistItem", () => {
  it("converts doneAt and keeps the tick", () => {
    expect(
      toChecklistItem({
        id: "c1",
        text: "Messung dokumentiert",
        done: true,
        doneAt: new Date("2026-09-10T08:00:00Z"),
        doneById: "e1",
        position: 2,
      }),
    ).toEqual({
      id: "c1",
      text: "Messung dokumentiert",
      done: true,
      doneAt: "2026-09-10T08:00:00.000Z",
      doneById: "e1",
      position: 2,
    });
  });
});

describe("toAuditSnapshot", () => {
  it("reads the assignee and project from the scalar column", () => {
    expect(
      toAuditSnapshot({
        title: "A",
        status: "TODO",
        assigneeId: "e1",
        projectId: "p1",
        dueDate: null,
      }),
    ).toMatchObject({ assigneeId: "e1", projectId: "p1" });
  });

  it("reads them from the relation too", () => {
    /**
     * **The bug this module starts on the right side of.** `projects.mapper.ts`
     * documents it: the first version read only the scalar, the detail select
     * has no such column, so every `after` came back without it and the audit
     * log recorded a manager being removed on every edit. Nothing threw. Here
     * `findForRules` selects the columns and the detail select carries the
     * relations, so the same two shapes exist for the same reason.
     */
    expect(
      toAuditSnapshot({
        title: "A",
        status: "TODO",
        assignee: { id: "e1" },
        project: { id: "p1" },
        dueDate: null,
      }),
    ).toMatchObject({ assigneeId: "e1", projectId: "p1" });
  });

  it("records an unassigned firm-level task as null on both", () => {
    const out = toAuditSnapshot({ title: "A", status: "TODO", dueDate: null });
    expect(out.assigneeId).toBeNull();
    expect(out.projectId).toBeNull();
  });
});

describe("toTaskExportRow", () => {
  it("names its own columns", () => {
    const row = toTaskExportRow(listRow(), NOW);
    expect(Object.keys(row)).toContain("Aufgabe");
    expect(row.Projektnummer).toBe("P-2026-014");
    expect(row.Zuständig).toBe("Anna Meier");
    expect(row.Gewerk).toBe("LFT");
  });

  it("writes empty strings rather than nulls", () => {
    // A CSV cell holding `null` renders the four letters. Excel then sorts it
    // among the names.
    const row = toTaskExportRow(listRow({ project: null, assignee: null, discipline: null, milestone: null }), NOW);
    expect(row.Projekt).toBe("");
    expect(row.Zuständig).toBe("");
  });

  it("answers the overdue column in German", () => {
    expect(toTaskExportRow(listRow(), new Date("2026-10-05T00:00:00Z")).Überfällig).toBe("ja");
    expect(toTaskExportRow(listRow(), NOW).Überfällig).toBe("nein");
  });
});

/* ================================================================== */
/* Inbound                                                             */
/* ================================================================== */

describe("toHours", () => {
  it("accepts a plain figure and a quarter hour", () => {
    expect(toHours("4", "Aufwand")!.toFixed(2)).toBe("4.00");
    expect(toHours("4.25", "Aufwand")!.toFixed(2)).toBe("4.25");
  });

  it("reads nothing as no estimate", () => {
    expect(toHours(null, "Aufwand")).toBeNull();
    expect(toHours(undefined, "Aufwand")).toBeNull();
    expect(toHours("", "Aufwand")).toBeNull();
  });

  it("refuses a comma decimal with the field named", () => {
    // What a person types. Accepting it as NaN and storing null turns a typo
    // into a missing estimate nobody notices until a report is short.
    expect(() => toHours("4,25", "Aufwand")).toThrow(BadRequestException);
    try {
      toHours("4,25", "Aufwand");
    } catch (error) {
      expect((error as Error).message).toContain("Aufwand");
    }
  });

  it("refuses a negative figure, a time and a word", () => {
    for (const bad of ["-1", "4:15", "vier", "1e3"]) {
      expect(() => toHours(bad, "Aufwand"), bad).toThrow(BadRequestException);
    }
  });

  it("refuses more than two decimals", () => {
    expect(() => toHours("4.256", "Aufwand")).toThrow(BadRequestException);
  });
});

describe("toHoursNumber", () => {
  it("returns a plain number, so the rules never meet a Decimal", () => {
    // `tasks.rules.ts` is pure and `tasks.service.ts` imports no `Prisma`. The
    // conversion happens in the mapper, which is the whole job of this half.
    const value = toHoursNumber("7.50", "Aufwand");
    expect(typeof value).toBe("number");
    expect(value).toBe(7.5);
  });

  it("passes null through", () => {
    expect(toHoursNumber(null, "Aufwand")).toBeNull();
  });
});

describe("toDate", () => {
  it("parses a date and a timestamp", () => {
    expect(toDate("2026-09-18")!.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(toDate("2026-09-18T10:30:00Z")!.toISOString()).toBe("2026-09-18T10:30:00.000Z");
  });

  it("reads nothing as no date", () => {
    expect(toDate(null)).toBeNull();
    expect(toDate("")).toBeNull();
    expect(toDate(undefined)).toBeNull();
  });
});

describe("toTaskUpdateData", () => {
  it("writes only what the body named", () => {
    /**
     * `undefined` means "not supplied"; `null` means "clear it". The distinction
     * is the whole reason `PATCH` works, and it is what a naive `{ ...dto }`
     * destroys.
     */
    const data = toTaskUpdateData({ title: "Neu" }, "u1");
    expect(data).toEqual({ updatedById: "u1", title: "Neu" });
    expect(data).not.toHaveProperty("dueDate");
    expect(data).not.toHaveProperty("assigneeId");
  });

  it("clears a relation with null rather than disconnecting", () => {
    /**
     * **Scalar foreign keys, never `connect`/`disconnect`.** Not style — it is
     * what `updateMany` accepts, and the optimistic lock needs the version in
     * the `where`, which only `updateMany` allows. A body carrying
     * `assignee: { connect: … }` is a runtime 500 that typechecks. That exact
     * failure shipped in Projects.
     */
    const data = toTaskUpdateData({ assigneeId: null, projectId: null }, "u1");
    expect(data.assigneeId).toBeNull();
    expect(data.projectId).toBeNull();
    expect(JSON.stringify(data)).not.toContain("connect");
  });

  it("uses no relation operations at all", () => {
    const data = toTaskUpdateData(
      { assigneeId: "e1", projectId: "p1", milestoneId: "m1", disciplineId: "d1", parentTaskId: "t9" },
      "u1",
    );
    const json = JSON.stringify(data);
    expect(json).not.toContain("connect");
    expect(json).not.toContain("disconnect");
    expect(data).toMatchObject({ assigneeId: "e1", projectId: "p1", parentTaskId: "t9" });
  });

  it("clears the overdue announcement when the date moves", () => {
    /**
     * Without this a task announced overdue, then rescheduled, then missed again
     * is never announced a second time — `overdueNotifiedAt` is still set from
     * the first date. It lives here rather than in the service because it is a
     * property of the *column pair*, and a service that has to remember it
     * forgets it on the second route that writes a due date.
     */
    expect(toTaskUpdateData({ dueDate: "2026-12-01" }, "u1").overdueNotifiedAt).toBeNull();
    expect(toTaskUpdateData({ dueDate: null }, "u1").overdueNotifiedAt).toBeNull();
  });

  it("leaves the announcement alone when the date is untouched", () => {
    expect(toTaskUpdateData({ title: "Neu" }, "u1")).not.toHaveProperty("overdueNotifiedAt");
  });

  it("refuses a malformed estimate rather than writing zero", () => {
    expect(() => toTaskUpdateData({ estimateHours: "acht" }, "u1")).toThrow(BadRequestException);
  });
});

describe("toTaskCreateData", () => {
  it("writes scalar foreign keys, like the update does", () => {
    // One shape for both directions, so the two functions can be read against
    // each other and there is no second syntax to get wrong.
    const data = toTaskCreateData({ title: "A", position: 1024, projectId: "p1" }, "u1");
    expect(data.projectId).toBe("p1");
    expect(JSON.stringify(data)).not.toContain("connect");
  });

  it("nulls every relation the body omitted", () => {
    const data = toTaskCreateData({ title: "A", position: 1024 }, "u1");
    expect(data.projectId).toBeNull();
    expect(data.assigneeId).toBeNull();
    expect(data.parentTaskId).toBeNull();
  });

  it("records the author as the first editor too", () => {
    // So `updatedById` is never null on a fresh row, which is what the conflict
    // message reads to say who saved first.
    const data = toTaskCreateData({ title: "A", position: 1024 }, "u1");
    expect(data.createdById).toBe("u1");
    expect(data.updatedById).toBe("u1");
  });
});
