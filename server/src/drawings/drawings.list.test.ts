import { describe, expect, it } from "vitest";
import { buildOrderBy, buildWhere, parseListQuery } from "../core/list/list";
import { DRAWING_LIST, REVISION_LIST, TRANSMITTAL_LIST } from "./drawings.list";

/**
 * The list contract for Pläne — an **allowlist in both directions**.
 *
 * A filter field that is not listed is refused rather than ignored, because a
 * silently dropped filter shows the reader a list that does not match what they
 * set, which they read as wrong data rather than as a rejected parameter.
 *
 * The queries asserted here are the ones `docs/data-model.md` §3.13 names as the
 * module's reason to exist. Two of its four work today; the other two wait on
 * `Floor`, `Room` and `BuildingSystem`, and that is asserted too — a filter key
 * that quietly matched nothing would be worse than its absence.
 */

describe("DRAWING_LIST", () => {
  it("opens as a plan set, not as a feed", () => {
    // Disagrees with all three modules before it, deliberately: a register is
    // read in number order, the way the sheets hang on the wall. Sorting by
    // `updatedAt` would reshuffle it every time somebody fixed a title.
    expect(DRAWING_LIST.defaultSort).toEqual({ field: "number", dir: "asc" });
  });

  /** *Alle Lüftungspläne* — the query the Gewerk anchor exists for. */
  it("filters by Gewerk code as well as by id", () => {
    const params = parseListQuery({ "filter[discipline]": "eq:LFT" }, DRAWING_LIST);
    const where = buildWhere(params, DRAWING_LIST, {}) as Record<string, unknown>;

    expect(where).toMatchObject({ discipline: { code: { equals: "LFT" } } });
  });

  it("filters by building, so a plan set can be narrowed to one object", () => {
    const params = parseListQuery({ "filter[buildingId]": "eq:b1" }, DRAWING_LIST);
    expect(buildWhere(params, DRAWING_LIST, {})).toMatchObject({ buildingId: { equals: "b1" } });
  });

  /**
   * The two anchors that are **not** here, asserted so their absence is a
   * decision rather than an oversight.
   *
   * *"Jeder Plan, auf dem Raum 2.14 vorkommt"* and *"alles zur Anlage H1"* wait
   * for Wave 2 module 6. A `floor` key that matched nothing would answer the
   * question with an empty list, which reads as "there are none".
   */
  it("refuses floor, room and plant filters rather than matching nothing", () => {
    for (const field of ["floorId", "roomId", "buildingSystemId"]) {
      expect(() => parseListQuery({ [`filter[${field}]`]: "eq:x" }, DRAWING_LIST), field).toThrow();
    }
  });

  it("refuses a field nobody declared", () => {
    expect(() => parseListQuery({ "filter[secret]": "eq:1" }, DRAWING_LIST)).toThrow();
  });

  it("refuses a status outside the enum", () => {
    expect(() => parseListQuery({ "filter[status]": "eq:APPROVED" }, DRAWING_LIST)).toThrow();
  });

  it("accepts every real status", () => {
    for (const status of ["WIP", "IN_CHECK", "CHECKED", "RELEASED", "ISSUED", "SUPERSEDED"]) {
      expect(() =>
        parseListQuery({ "filter[status]": `eq:${status}` }, DRAWING_LIST),
      ).not.toThrow();
    }
  });

  it("searches the number and the title, and not a revision's note", () => {
    // A plan matching because of something written in revision B three years
    // ago is a result nobody expects. `/drawings/revisions` searches those.
    expect(DRAWING_LIST.searchable).toEqual(["number", "title"]);
  });

  it("sorts by the current revision", () => {
    const params = parseListQuery({ sort: "currentRevision:desc" }, DRAWING_LIST);
    expect(buildOrderBy(params, DRAWING_LIST)).toEqual({ currentRevision: "desc" });
  });

  it("refuses a sort field that is not listed", () => {
    expect(() => parseListQuery({ sort: "checksum:asc" }, DRAWING_LIST)).toThrow();
  });
});

describe("REVISION_LIST", () => {
  it("opens on what happened most recently", () => {
    expect(REVISION_LIST.defaultSort).toEqual({ field: "createdAt", dir: "desc" });
  });

  /**
   * *"Was ist diese Woche freigegeben worden"* — answered with `isnull` rather
   * than a second boolean column, the same trick `minutesSentAt` uses and the
   * reason `isnull` is one of the ten operators.
   */
  it("finds everything released without a second column", () => {
    const params = parseListQuery({ "filter[releasedAt]": "isnull:false" }, REVISION_LIST);
    expect(buildWhere(params, REVISION_LIST, {})).toMatchObject({ releasedAt: { not: null } });
  });

  /** *"Welche Revisionen gingen wegen eines Fehlers raus"*. */
  it("filters by the reason a revision was made", () => {
    const params = parseListQuery({ "filter[reason]": "eq:FEHLERKORREKTUR" }, REVISION_LIST);
    expect(buildWhere(params, REVISION_LIST, {})).toMatchObject({
      reason: { equals: "FEHLERKORREKTUR" },
    });
  });

  it("reaches the Gewerk through the drawing", () => {
    // A revision has no discipline of its own; the path is what makes "alle
    // Lüftungsrevisionen" a filter rather than two requests.
    const params = parseListQuery({ "filter[discipline]": "eq:LFT" }, REVISION_LIST);
    expect(buildWhere(params, REVISION_LIST, {})).toMatchObject({
      drawing: { discipline: { code: { equals: "LFT" } } },
    });
  });

  it("searches what changed", () => {
    expect(REVISION_LIST.searchable).toContain("changeNote");
  });
});

describe("TRANSMITTAL_LIST", () => {
  it("opens on what went out last", () => {
    expect(TRANSMITTAL_LIST.defaultSort).toEqual({ field: "sentAt", dir: "desc" });
  });

  /**
   * *"Alles was an Müller ging"* — a filter through the join rather than a
   * scan, which is the question the whole module exists to answer.
   */
  it("filters by recipient through the relation", () => {
    const params = parseListQuery({ "filter[recipient]": "like:Müller" }, TRANSMITTAL_LIST);
    expect(buildWhere(params, TRANSMITTAL_LIST, {})).toMatchObject({
      recipients: { some: { externalName: { contains: "Müller", mode: "insensitive" } } },
    });
  });

  it("filters by the date something was sent", () => {
    const params = parseListQuery({ "filter[sentAt]": "gte:2026-03-14" }, TRANSMITTAL_LIST);
    expect(buildWhere(params, TRANSMITTAL_LIST, {})).toHaveProperty("sentAt");
  });

  it("searches the number, which is how a Planversand is cited", () => {
    expect(TRANSMITTAL_LIST.searchable).toContain("number");
  });
});
