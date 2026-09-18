import { describe, expect, it } from "vitest";
import { buildFilterChips } from "./FilterBar";

/**
 * The chip list is derived from the filter object so a screen cannot forget to
 * add a chip when it adds a control. What can still be wrong is *which* values
 * count as filtering, and the answer is not "truthy".
 */
describe("buildFilterChips", () => {
  it("names a set filter", () => {
    expect(buildFilterChips({ status: "NEW" }, { status: "Status" })).toEqual([
      { id: "status", label: "Status", value: "NEW" },
    ]);
  });

  it("falls back to the key when no label is given", () => {
    expect(buildFilterChips({ status: "NEW" }, {})[0].label).toBe("status");
  });

  it("formats a value that is not its own label", () => {
    const chips = buildFilterChips(
      { status: "NEW" },
      { status: "Status" },
      { status: (v) => (v === "NEW" ? "Neu" : String(v)) },
    );
    expect(chips[0].value).toBe("Neu");
  });

  describe("what counts as not filtering", () => {
    it("drops an empty string", () => {
      expect(buildFilterChips({ search: "" }, {})).toEqual([]);
    });

    it("drops null and undefined", () => {
      expect(buildFilterChips({ a: null, b: undefined }, {})).toEqual([]);
    });

    it("drops an empty array", () => {
      expect(buildFilterChips({ tags: [] }, {})).toEqual([]);
    });

    /**
     * The two a `if (value)` test gets wrong.
     *
     * "Nur unbezahlte" is `false` and "Stunden = 0" is `0`; both are choices
     * somebody made, and a chip row that silently omits them is a list the
     * reader cannot explain.
     */
    it("keeps a false", () => {
      expect(buildFilterChips({ billable: false }, { billable: "Verrechenbar" })).toEqual([
        { id: "billable", label: "Verrechenbar", value: "false" },
      ]);
    });

    it("keeps a zero", () => {
      expect(buildFilterChips({ hours: 0 }, { hours: "Stunden" })[0].value).toBe("0");
    });

    /**
     * A formatter that returns nothing means "this object is not a filter yet"
     * — an empty date range is `{ from: "", to: "" }`, which is neither null
     * nor empty as an object.
     */
    it("drops a value its formatter renders as empty", () => {
      const chips = buildFilterChips(
        { range: { from: "", to: "" } },
        { range: "Zeitraum" },
        { range: () => "" },
      );
      expect(chips).toEqual([]);
    });
  });

  it("keeps the declaration order of the filter object", () => {
    // The chips read back in the order the controls sit in, which is what
    // makes the row scannable against them.
    const chips = buildFilterChips({ search: "a", status: "NEW", outcome: "SUCCESS" }, {});
    expect(chips.map((c) => c.id)).toEqual(["search", "status", "outcome"]);
  });
});
