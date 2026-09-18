import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { buildOrderBy, buildWhere, parseListQuery } from "../core/list/list";
import { DECISION_LIST, MEETING_ITEM_LIST, MEETING_LIST } from "./meetings.list";

/**
 * The list contract, as this module declares it.
 *
 * `core/list/list.test.ts` proves the parser is correct. What it cannot prove
 * is that *these* specs say what the module meant — an allowlist is data, and
 * data with a typo in it fails by refusing something that should work, which
 * looks like a broken screen rather than a wrong constant.
 */

describe("MEETING_LIST", () => {
  it("opens on the meeting that just happened", () => {
    /**
     * The one place this list disagrees with both of the others. A project list
     * opens on what you were last working on and a task list on what is due; a
     * meeting list opens on the last Bausitzung, because that is what somebody
     * is writing up or reading. Ascending would show the Kickoff from 2024.
     */
    expect(parseListQuery({}, MEETING_LIST).sort).toEqual({ field: "startsAt", dir: "desc" });
  });

  it("filters by series number, the way it is asked for", () => {
    // "Bausitzung 14" is how a meeting is referred to out loud.
    const params = parseListQuery({ "filter[seriesNumber]": "eq:14" }, MEETING_LIST);
    expect(buildWhere(params, MEETING_LIST)).toEqual({ seriesNumber: { equals: 14 } });
  });

  it("expresses the minutes queue with the contract's own operator", () => {
    /**
     * Held, minutes not sent — the queue a Projektleiter works through on a
     * Friday. Two filters rather than a dedicated `pending` key, for the reason
     * `TASK_LIST` gives about `overdue`: a second definition is one that can
     * disagree with the first.
     */
    const params = parseListQuery(
      { "filter[status]": "eq:HELD", "filter[minutesSentAt]": "isnull:true" },
      MEETING_LIST,
    );
    const where = buildWhere(params, MEETING_LIST) as { AND: Record<string, unknown>[] };
    expect(where.AND).toContainEqual({ status: { equals: "HELD" } });
    expect(where.AND).toContainEqual({ minutesSentAt: { equals: null } });
  });

  it("filters a project by name, not only by id", () => {
    const params = parseListQuery({ "filter[project]": "like:guglera" }, MEETING_LIST);
    expect(buildWhere(params, MEETING_LIST)).toEqual({
      project: { name: { contains: "guglera", mode: "insensitive" } },
    });
  });

  it("refuses a type that is not one", () => {
    expect(() => parseListQuery({ "filter[type]": "eq:STAMMTISCH" }, MEETING_LIST)).toThrow(
      BadRequestException,
    );
  });

  it("searches the title and the location and nothing else", () => {
    // Not the protocol: a meeting list that matched on the text of its lines
    // would return a Bausitzung because somebody once mentioned a word in it.
    // `/meetings/items` is the search over lines.
    expect([...MEETING_LIST.searchable]).toEqual(["title", "location"]);
  });
});

describe("MEETING_ITEM_LIST", () => {
  it("answers the question the module was asked for", () => {
    /**
     * *"Alle offenen Pendenzen für Lüftung über alle Bausitzungen"* —
     * `data-model.md` §3.11 names it, and it is the reason `disciplineId` sits
     * on the line rather than being reached through the project.
     */
    const params = parseListQuery(
      { "filter[kind]": "eq:PENDENZ", "filter[discipline]": "eq:LFT" },
      MEETING_ITEM_LIST,
    );
    const where = buildWhere(params, MEETING_ITEM_LIST) as { AND: Record<string, unknown>[] };
    expect(where.AND).toContainEqual({ kind: { equals: "PENDENZ" } });
    expect(where.AND).toContainEqual({ discipline: { code: { equals: "LFT" } } });
  });

  it("orders a protocol by its own numbering", () => {
    const params = parseListQuery({}, MEETING_ITEM_LIST);
    expect(buildOrderBy(params, MEETING_ITEM_LIST)).toEqual({ order: "asc" });
  });

  it("filters the lines that became tasks", () => {
    // `isnull:false` — every Pendenz that has work behind it.
    const params = parseListQuery({ "filter[taskId]": "isnull:false" }, MEETING_ITEM_LIST);
    expect(buildWhere(params, MEETING_ITEM_LIST)).toEqual({ taskId: { not: null } });
  });

  it("is its own spec rather than a share of the meeting's", () => {
    // "What a protocol's lines may be filtered by" and "what meetings may be
    // filtered by" have nothing in common but the word list.
    expect(() => parseListQuery({ "filter[type]": "eq:BAUSITZUNG" }, MEETING_ITEM_LIST)).toThrow();
  });
});

describe("DECISION_LIST", () => {
  it("opens on the most recent decision", () => {
    expect(parseListQuery({}, DECISION_LIST).sort).toEqual({ field: "decidedAt", dir: "desc" });
  });

  it("searches the rationale, which is the point of requiring it", () => {
    /**
     * "Warum haben wir damals die Lüftung umgebaut" is answered by searching
     * the *reasons*, not the titles — a title says what was decided and the
     * rationale says why, and only one of them contains the word somebody
     * remembers.
     */
    expect([...DECISION_LIST.searchable]).toContain("rationale");

    const params = parseListQuery({ q: "Zugerscheinungen" }, DECISION_LIST);
    const where = buildWhere(params, DECISION_LIST) as { OR: Record<string, unknown>[] };
    expect(where.OR).toContainEqual({
      rationale: { contains: "Zugerscheinungen", mode: "insensitive" },
    });
  });

  it("finds every decision that reversed another", () => {
    // The shortest possible answer to "was haben wir zurückgenommen", and it
    // needs no key of its own.
    const params = parseListQuery({ "filter[supersedesId]": "isnull:false" }, DECISION_LIST);
    expect(buildWhere(params, DECISION_LIST)).toEqual({ supersedesId: { not: null } });
  });

  it("filters by what a decision cost", () => {
    // The figure Finance looks for.
    const params = parseListQuery({ "filter[costImpact]": "gte:10000" }, DECISION_LIST);
    expect(buildWhere(params, DECISION_LIST)).toEqual({ costImpact: { gte: 10000 } });
  });

  it("sorts by number, so a project's decisions read in order", () => {
    const params = parseListQuery({ sort: "number:asc" }, DECISION_LIST);
    expect(buildOrderBy(params, DECISION_LIST)).toEqual({ number: "asc" });
  });

  it("refuses a status that is not one", () => {
    expect(() => parseListQuery({ "filter[status]": "eq:VIELLEICHT" }, DECISION_LIST)).toThrow(
      BadRequestException,
    );
  });
});
