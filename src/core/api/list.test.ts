import { describe, expect, it } from "vitest";
import { emptyPage, listKey, listQuery } from "./list";

describe("listQuery", () => {
  it("passes page and perPage through", () => {
    expect(listQuery({ page: 2, perPage: 50 })).toEqual({ page: 2, perPage: 50 });
  });

  it("leaves an empty search out entirely", () => {
    // Not `q: ""`. The client drops empty values when it builds the URL, but a
    // key that is present here also reaches the cache key, and `q=` and no `q`
    // would be two entries for one request.
    expect(listQuery({ q: "" })).toEqual({});
  });

  it("serialises sort as field:direction", () => {
    expect(listQuery({ sort: { field: "updatedAt", dir: "desc" } })).toEqual({
      sort: "updatedAt:desc",
    });
  });

  it("serialises a filter as filter[field]=op:value", () => {
    expect(listQuery({ filters: [{ field: "status", op: "eq", value: "NEW" }] })).toEqual({
      "filter[status]": "eq:NEW",
    });
  });

  it("joins an `in` filter with commas", () => {
    expect(
      listQuery({ filters: [{ field: "status", op: "in", value: ["NEW", "IN_REVIEW"] }] }),
    ).toEqual({ "filter[status]": "in:NEW,IN_REVIEW" });
  });

  it("keeps several filters apart", () => {
    expect(
      listQuery({
        filters: [
          { field: "status", op: "eq", value: "NEW" },
          { field: "createdAt", op: "gte", value: "2026-01-01" },
        ],
      }),
    ).toEqual({ "filter[status]": "eq:NEW", "filter[createdAt]": "gte:2026-01-01" });
  });
});

describe("listKey", () => {
  /**
   * The one that matters.
   *
   * Object key order is insertion order in JavaScript, so without the sort the
   * cache key would depend on which branch of a screen happened to set `q`
   * first — two entries for one request, and a list that refetches when it
   * should not.
   */
  it("is the same whatever order the parameters were built in", () => {
    expect(listKey({ page: 1, q: "meier" })).toBe(listKey({ q: "meier", page: 1 }));
  });

  it("differs when a parameter differs", () => {
    expect(listKey({ page: 1 })).not.toBe(listKey({ page: 2 }));
  });

  it("is empty for no parameters", () => {
    expect(listKey({})).toBe("");
  });
});

describe("emptyPage", () => {
  it("has no items and no pages, so a list renders its empty state", () => {
    // `pages: 0` rather than 1: the pagination bar reads `pages <= 1` as "one
    // page of results", and an unfetched list has none.
    expect(emptyPage()).toEqual({ items: [], total: 0, page: 1, perPage: 20, pages: 0 });
  });
});
