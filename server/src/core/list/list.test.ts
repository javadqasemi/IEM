import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import {
  buildOrderBy,
  buildWhere,
  paginated,
  parseListQuery,
  readFilterParams,
  skipTake,
} from "./list";
import type { ListSpec } from "./list.spec-types";

/**
 * The list contract, tested without a database.
 *
 * Everything here is a rule — what is allowed, how an operator maps, whether
 * two filters narrow or widen — and every one of them was previously written
 * five times, once per resource. The bugs in that version were not in the SQL.
 */

const spec: ListSpec = {
  sortable: ["createdAt", "status", "lastName"],
  filterable: {
    status: { kind: "enum", values: ["NEW", "IN_REVIEW", "HIRED"] },
    createdAt: { kind: "date" },
    files: { kind: "number" },
    billable: { kind: "boolean" },
    actor: { kind: "string", path: "actor.email" },
    note: { kind: "string" },
  },
  searchable: ["firstName", "lastName", "email"],
  defaultSort: { field: "createdAt", dir: "desc" },
};

describe("reading filter parameters", () => {
  /**
   * Express 5 changed the default query parser from `extended` to `simple`, so
   * the bracket form arrives as a literal key. Both shapes are read, because a
   * list that silently stops filtering when a framework default changes is a
   * regression that reaches production.
   */
  it("reads the flat form Express 5 produces", () => {
    expect(readFilterParams({ "filter[status]": "eq:NEW" })).toEqual({ status: "eq:NEW" });
  });

  it("reads the nested form Express 4 produced", () => {
    expect(readFilterParams({ filter: { status: "eq:NEW" } })).toEqual({ status: "eq:NEW" });
  });

  it("ignores anything that is not a filter", () => {
    expect(readFilterParams({ page: 2, q: "meier" })).toEqual({});
  });
});

describe("paging", () => {
  it("defaults to page one", () => {
    expect(parseListQuery({}, spec).page).toBe(1);
  });

  it("clamps a page below one", () => {
    expect(parseListQuery({ page: 0 }, spec).page).toBe(1);
  });

  /**
   * A list without a ceiling is a denial of service with a query string:
   * `perPage=100000` reads the table into memory. The export route is how
   * somebody legitimately gets everything.
   */
  it("caps perPage at the spec's maximum", () => {
    expect(parseListQuery({ perPage: 100_000 }, { ...spec, maxPerPage: 50 }).perPage).toBe(50);
  });

  it("turns page and perPage into skip and take", () => {
    expect(skipTake(parseListQuery({ page: 3, perPage: 20 }, spec))).toEqual({
      skip: 40,
      take: 20,
    });
  });
});

describe("sorting", () => {
  it("falls back to the spec's default", () => {
    expect(parseListQuery({}, spec).sort).toEqual({ field: "createdAt", dir: "desc" });
  });

  it("accepts a listed field", () => {
    expect(parseListQuery({ sort: "status:asc" }, spec).sort).toEqual({
      field: "status",
      dir: "asc",
    });
  });

  /**
   * Refused, not ignored. An ignored sort looks exactly like a column that
   * will not sort, and the reader blames the data.
   */
  it("refuses a field that is not listed, and says what is", () => {
    expect(() => parseListQuery({ sort: "salary:asc" }, spec)).toThrow(BadRequestException);
    expect(() => parseListQuery({ sort: "salary:asc" }, spec)).toThrow(/createdAt, status/);
  });

  it("refuses a direction that is not a direction", () => {
    expect(() => parseListQuery({ sort: "status:sideways" }, spec)).toThrow(/asc, desc/);
  });

  it("nests a dotted path for Prisma", () => {
    const params = parseListQuery({ sort: "status:asc" }, spec);
    expect(buildOrderBy(params, spec)).toEqual({ status: "asc" });
  });
});

describe("filtering", () => {
  it("defaults to eq when no operator is given", () => {
    expect(parseListQuery({ "filter[status]": "NEW" }, spec).filters).toEqual([
      { field: "status", op: "eq", value: "NEW" },
    ]);
  });

  it("refuses a field that is not listed", () => {
    expect(() => parseListQuery({ "filter[salary]": "gt:100" }, spec)).toThrow(
      BadRequestException,
    );
  });

  it("refuses an operator that does not exist", () => {
    expect(() => parseListQuery({ "filter[status]": "sortof:NEW" }, spec)).toThrow(/Operator/);
  });

  it("refuses a value outside an enum", () => {
    expect(() => parseListQuery({ "filter[status]": "eq:PROMOTED" }, spec)).toThrow(
      /NEW, IN_REVIEW, HIRED/,
    );
  });

  it("coerces a number and refuses one that is not", () => {
    expect(parseListQuery({ "filter[files]": "gt:2" }, spec).filters[0].value).toBe(2);
    expect(() => parseListQuery({ "filter[files]": "gt:viele" }, spec)).toThrow(/keine Zahl/);
  });

  it("coerces a date and refuses one that is not", () => {
    const value = parseListQuery({ "filter[createdAt]": "gte:2026-03-01" }, spec).filters[0].value;
    expect(value).toBeInstanceOf(Date);
    expect(() => parseListQuery({ "filter[createdAt]": "gte:letzten Dienstag" }, spec)).toThrow(
      /kein Datum/,
    );
  });

  it("splits an `in` list", () => {
    expect(parseListQuery({ "filter[status]": "in:NEW,HIRED" }, spec).filters[0].value).toEqual([
      "NEW",
      "HIRED",
    ]);
  });

  it("wants exactly two values for `between`", () => {
    expect(() => parseListQuery({ "filter[files]": "between:1" }, spec)).toThrow(/zwei Werte/);
  });

  /**
   * Only the *first* colon separates. A `like` on a timestamp, or any value
   * containing one, would otherwise lose everything after it.
   */
  it("keeps a colon inside the value", () => {
    expect(parseListQuery({ "filter[note]": "like:14:30" }, spec).filters[0].value).toBe("14:30");
  });
});

describe("the Prisma where", () => {
  it("is empty when nothing was asked for", () => {
    expect(buildWhere(parseListQuery({}, spec), spec)).toEqual({});
  });

  it("maps each operator", () => {
    const cases: [string, string, unknown][] = [
      ["status", "eq:NEW", { status: { equals: "NEW" } }],
      ["status", "ne:NEW", { status: { not: "NEW" } }],
      ["status", "in:NEW,HIRED", { status: { in: ["NEW", "HIRED"] } }],
      // `like` on a *string* field. An enum's values are coerced against its
      // allowlist, so a substring of one is refused — which is correct, and
      // which the first draft of this test got wrong by asking for `like:ne`
      // on `status` and expecting it through.
      ["note", "like:termin", { note: { contains: "termin", mode: "insensitive" } }],
    ];
    for (const [field, expression, expected] of cases) {
      const params = parseListQuery({ [`filter[${field}]`]: expression }, spec);
      expect(buildWhere(params, spec)).toEqual(expected);
    }
  });

  it("refuses a substring of an enum value, because it is not one of them", () => {
    expect(() => parseListQuery({ "filter[status]": "like:ne" }, spec)).toThrow(
      /kein gültiger Wert/,
    );
  });

  it("turns between into gte plus lte", () => {
    const params = parseListQuery({ "filter[files]": "between:1,5" }, spec);
    expect(buildWhere(params, spec)).toEqual({ files: { gte: 1, lte: 5 } });
  });

  it("handles isnull in both directions", () => {
    expect(buildWhere(parseListQuery({ "filter[note]": "isnull:true" }, spec), spec)).toEqual({
      note: { equals: null },
    });
    expect(buildWhere(parseListQuery({ "filter[note]": "isnull:false" }, spec), spec)).toEqual({
      note: { not: null },
    });
  });

  it("nests a dotted path", () => {
    // `actor` is what a caller writes; `actor.email` is where it lives.
    const params = parseListQuery({ "filter[actor]": "like:anna" }, spec);
    expect(buildWhere(params, spec)).toEqual({
      actor: { email: { contains: "anna", mode: "insensitive" } },
    });
  });

  /**
   * The combination a hand-rolled implementation gets subtly wrong: two
   * filters NARROW and two search fields WIDEN.
   */
  it("ANDs the filters and ORs the search", () => {
    const params = parseListQuery(
      { "filter[status]": "eq:NEW", "filter[files]": "gt:0", q: "meier" },
      spec,
    );
    const where = buildWhere(params, spec) as { AND: unknown[] };
    expect(where.AND).toHaveLength(3);
    expect(where.AND[2]).toEqual({
      OR: [
        { firstName: { contains: "meier", mode: "insensitive" } },
        { lastName: { contains: "meier", mode: "insensitive" } },
        { email: { contains: "meier", mode: "insensitive" } },
      ],
    });
  });

  it("keeps a base condition the caller supplies", () => {
    // Row-level scoping — "only this user's entries" — is the service's, and
    // it must survive whatever the caller filtered by.
    const params = parseListQuery({ "filter[status]": "eq:NEW" }, spec);
    const where = buildWhere(params, spec, { deletedAt: null }) as { AND: unknown[] };
    expect(where.AND[0]).toEqual({ deletedAt: null });
  });

  it("does not wrap a single condition in an AND", () => {
    expect(buildWhere(parseListQuery({ "filter[status]": "eq:NEW" }, spec), spec)).toEqual({
      status: { equals: "NEW" },
    });
  });
});

describe("the response", () => {
  it("reports the page count", () => {
    expect(paginated([1, 2], 45, parseListQuery({ perPage: 20 }, spec))).toEqual({
      items: [1, 2],
      total: 45,
      page: 1,
      perPage: 20,
      pages: 3,
    });
  });

  /**
   * `0`, not `1`. The client reads `pages <= 1` as "one page of results", and
   * no results is not one page of them — it is an empty state.
   */
  it("reports no pages for no results", () => {
    expect(paginated([], 0, parseListQuery({}, spec)).pages).toBe(0);
  });
});
