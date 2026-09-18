import { describe, expect, it } from "vitest";
import { buildOrderBy, buildWhere, parseListQuery } from "../core/list/list";
import { MILESTONE_LIST, PROJECT_LIST } from "./projects.list";

/**
 * The list contract, as this module declares it.
 *
 * `core/list/list.test.ts` already proves the parser and the where-builder are
 * correct. What it cannot prove is that *this* spec says what the module meant —
 * an allowlist is data, and data with a typo in it fails by refusing something
 * that should work, which looks like a broken screen rather than a wrong
 * constant.
 */

describe("PROJECT_LIST", () => {
  it("sorts by what was last touched", () => {
    const params = parseListQuery({}, PROJECT_LIST);
    expect(params.sort).toEqual({ field: "updatedAt", dir: "desc" });
  });

  it("filters a customer by name, not only by id", () => {
    // `filter[customerId]=eq:cm9x…` is a cuid nobody can read in a shared URL.
    const params = parseListQuery({ "filter[customer]": "like:gemeinde" }, PROJECT_LIST);
    const where = buildWhere(params, PROJECT_LIST);
    expect(where).toEqual({
      customer: { name: { contains: "gemeinde", mode: "insensitive" } },
    });
  });

  it("filters by discipline code across the join", () => {
    const params = parseListQuery({ "filter[discipline]": "eq:LFT" }, PROJECT_LIST);
    expect(buildWhere(params, PROJECT_LIST)).toEqual({
      disciplines: { some: { discipline: { code: { equals: "LFT" } } } },
    });
  });

  it("narrows with AND and widens with OR", () => {
    // The combination a hand-rolled list usually gets subtly wrong: two filters
    // narrow, two search fields widen.
    const params = parseListQuery(
      { "filter[status]": "eq:ACTIVE", "filter[health]": "eq:RED", q: "guglera" },
      PROJECT_LIST,
    );
    const where = buildWhere(params, PROJECT_LIST, { deletedAt: null }) as {
      AND: Record<string, unknown>[];
    };
    expect(where.AND).toHaveLength(4);
    expect(where.AND[0]).toEqual({ deletedAt: null });
    expect(where.AND[3]).toHaveProperty("OR");
  });

  it("answers the question the contract exists for", () => {
    // "What is contractually due this year and not finished" — rows that are
    // never on the first page.
    const params = parseListQuery(
      { "filter[plannedEndDate]": "lte:2026-12-31", "filter[status]": "in:ACTIVE,ON_HOLD" },
      PROJECT_LIST,
    );
    const where = buildWhere(params, PROJECT_LIST) as { AND: Record<string, unknown>[] };
    expect(where.AND[0]).toEqual({ plannedEndDate: { lte: new Date("2026-12-31") } });
    expect(where.AND[1]).toEqual({ status: { in: ["ACTIVE", "ON_HOLD"] } });
  });

  it("refuses a status that is not one", () => {
    expect(() => parseListQuery({ "filter[status]": "eq:FERTIG" }, PROJECT_LIST)).toThrow(
      /FERTIG/,
    );
  });

  it("refuses to filter or sort by the internal notes", () => {
    // A filter is a URL somebody shares, and a project note is where a problem
    // with a client gets recorded.
    expect(() => parseListQuery({ "filter[notes]": "like:heikel" }, PROJECT_LIST)).toThrow();
    expect(() => parseListQuery({ sort: "notes:asc" }, PROJECT_LIST)).toThrow();
    expect(PROJECT_LIST.searchable).not.toContain("notes");
  });

  it("sorts through a path when the field has one", () => {
    const params = parseListQuery({ sort: "name:asc" }, PROJECT_LIST);
    expect(buildOrderBy(params, PROJECT_LIST)).toEqual({ name: "asc" });
  });

  it("declares every sortable field on the row it sorts", () => {
    // A sort field that is not a scalar column throws at Prisma, in production,
    // on the one click nobody tested.
    const scalars = new Set([
      "number",
      "name",
      "status",
      "priority",
      "health",
      "progressPercent",
      "startDate",
      "plannedEndDate",
      "contractValue",
      "updatedAt",
      "createdAt",
    ]);
    for (const field of PROJECT_LIST.sortable) {
      expect(scalars.has(field), `${field} is not a scalar on Project`).toBe(true);
    }
  });
});

describe("MILESTONE_LIST", () => {
  it("is its own spec, not the project one", () => {
    // "What a project's milestones may be filtered by" and "what projects may
    // be filtered by" have nothing in common but the word list; sharing one is
    // the mistake W5 names.
    expect(MILESTONE_LIST.defaultSort).toEqual({ field: "dueDate", dir: "asc" });
    expect(() => parseListQuery({ "filter[health]": "eq:RED" }, MILESTONE_LIST)).toThrow();
  });

  it("filters the billing triggers", () => {
    const params = parseListQuery({ "filter[isBillingTrigger]": "eq:true" }, MILESTONE_LIST);
    expect(buildWhere(params, MILESTONE_LIST)).toEqual({ isBillingTrigger: { equals: true } });
  });
});
