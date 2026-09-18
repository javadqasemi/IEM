import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { buildOrderBy, buildWhere, parseListQuery } from "../core/list/list";
import { CHECKLIST_LIST, TASK_LIST } from "./tasks.list";

/**
 * The list contract, as this module declares it.
 *
 * `core/list/list.test.ts` proves the parser and the where-builder are correct.
 * What it cannot prove is that *this* spec says what the module meant — an
 * allowlist is data, and data with a typo in it fails by refusing something that
 * should work, which looks like a broken screen rather than a wrong constant.
 */

describe("TASK_LIST", () => {
  it("opens on what is due, not on what was last touched", () => {
    /**
     * The one place this list deliberately disagrees with `PROJECT_LIST`. A
     * project list opens on "what you were last working on" because a project is
     * a thing you return to. A task list is a queue, and `updatedAt` would put
     * the card somebody just dragged at the top — the one card they have already
     * dealt with.
     */
    const params = parseListQuery({}, TASK_LIST);
    expect(params.sort).toEqual({ field: "dueDate", dir: "asc" });
  });

  it("filters an assignee by surname, not only by id", () => {
    const params = parseListQuery({ "filter[assignee]": "like:meier" }, TASK_LIST);
    expect(buildWhere(params, TASK_LIST)).toEqual({
      assignee: { lastName: { contains: "meier", mode: "insensitive" } },
    });
  });

  it("filters by Gewerk code", () => {
    // "Alle offenen Lüftungs-Aufgaben" across projects — the question the firm
    // asks weekly, and the reason `disciplineId` is on `Task` rather than being
    // reached through the project.
    const params = parseListQuery({ "filter[discipline]": "eq:LFT" }, TASK_LIST);
    expect(buildWhere(params, TASK_LIST)).toEqual({
      discipline: { code: { equals: "LFT" } },
    });
  });

  it("expresses a board column as a filter and a sort", () => {
    /**
     * One list contract, not a second board endpoint. `position` is sortable
     * although a flat list sorted by it across statuses is meaningless — it is
     * here because this is exactly how the board fetches one column.
     */
    const params = parseListQuery(
      { "filter[status]": "eq:TODO", "filter[projectId]": "eq:p1", sort: "position:asc" },
      TASK_LIST,
    );
    expect(buildOrderBy(params, TASK_LIST)).toEqual({ position: "asc" });
    // Two filters are ANDed, which is the narrowing the contract promises — a
    // board column is the *intersection* of a project and a status, and an
    // implicit OR here would show every TODO in the firm beside it.
    const where = buildWhere(params, TASK_LIST) as { AND: Record<string, unknown>[] };
    expect(where.AND).toContainEqual({ status: { equals: "TODO" } });
    expect(where.AND).toContainEqual({ projectId: { equals: "p1" } });
  });

  it("expresses the top level of the tree with isnull", () => {
    // A board must show top-level cards only, or every checklist-sized subtask
    // appears beside its parent.
    const params = parseListQuery({ "filter[parentTaskId]": "isnull:true" }, TASK_LIST);
    expect(buildWhere(params, TASK_LIST)).toEqual({ parentTaskId: { equals: null } });
  });

  it("expresses the subtasks of one parent", () => {
    const params = parseListQuery({ "filter[parentTaskId]": "eq:t1" }, TASK_LIST);
    expect(buildWhere(params, TASK_LIST)).toEqual({ parentTaskId: { equals: "t1" } });
  });

  it("expresses overdue with two filters and no dedicated key", () => {
    /**
     * `overdue` is deliberately not a filter field. A dedicated key would be a
     * *third* place the definition lives, beside `isOverdue` in the rules and
     * the sweep in `tasks.overdue.ts`, and the day they disagree the list and
     * the notification would be about different tasks.
     */
    const params = parseListQuery(
      {
        "filter[dueDate]": "lt:2026-09-18",
        "filter[status]": "in:TODO,IN_PROGRESS,IN_REVIEW,BLOCKED",
      },
      TASK_LIST,
    );
    const where = buildWhere(params, TASK_LIST) as { AND: Record<string, Record<string, unknown>>[] };
    const due = where.AND.find((clause) => "dueDate" in clause)!;
    const status = where.AND.find((clause) => "status" in clause)!;
    // A `date` filter is parsed to a real `Date`, not left as the string —
    // otherwise Postgres compares a timestamp against text and the answer
    // depends on the locale rather than on the calendar.
    expect(due.dueDate.lt).toBeInstanceOf(Date);
    expect(status.status.in).toEqual(["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED"]);
  });

  it("refuses a status that is not a status", () => {
    // An allowlist in both directions: a filter that is silently dropped shows
    // the reader a list that does not match the filter they set.
    expect(() => parseListQuery({ "filter[status]": "eq:FERTIG" }, TASK_LIST)).toThrow(
      BadRequestException,
    );
  });

  it("refuses a field that is not on the list", () => {
    expect(() => parseListQuery({ "filter[spentHours]": "gt:5" }, TASK_LIST)).toThrow(
      BadRequestException,
    );
    expect(() => parseListQuery({ sort: "geheim:asc" }, TASK_LIST)).toThrow(BadRequestException);
  });

  it("narrows with AND and widens with OR", () => {
    const params = parseListQuery(
      { "filter[status]": "eq:TODO", "filter[priority]": "eq:URGENT", q: "lüftung" },
      TASK_LIST,
    );
    const where = buildWhere(params, TASK_LIST, { deletedAt: null }) as {
      AND: Record<string, unknown>[];
    };
    const or = where.AND.find((clause) => "OR" in clause) as { OR: unknown[] };
    expect(or.OR).toHaveLength(TASK_LIST.searchable.length);
  });

  it("searches the title and the description and nothing else", () => {
    /**
     * A task has no `notes` field to exclude, which is why this list is wider
     * than `PROJECT_LIST`'s: everything on a task is what the work is, and the
     * discussion lives in `Comment`, a separate resource with its own
     * permission.
     */
    expect([...TASK_LIST.searchable]).toEqual(["title", "description"]);
  });
});

describe("CHECKLIST_LIST", () => {
  it("is its own spec rather than a share of the task's", () => {
    // "What a task's checklist may be filtered by" and "what tasks may be
    // filtered by" have nothing in common but the word list.
    expect(parseListQuery({}, CHECKLIST_LIST).sort).toEqual({ field: "position", dir: "asc" });
    expect(() => parseListQuery({ "filter[status]": "eq:TODO" }, CHECKLIST_LIST)).toThrow();
  });

  it("filters the outstanding points", () => {
    const params = parseListQuery({ "filter[done]": "eq:false" }, CHECKLIST_LIST);
    expect(buildWhere(params, CHECKLIST_LIST)).toEqual({ done: { equals: false } });
  });
});
