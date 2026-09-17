import { describe, expect, it } from "vitest";
import { canonical, diffDocuments, rowsForNextPublish } from "./snapshot.builder";

/**
 * The three functions the publish screen rests on.
 *
 * They are tested rather than trusted because all three fail *quietly* when
 * they are wrong: a broken `canonical` makes the screen claim there is always
 * something to publish, a broken `rowsForNextPublish` makes it claim there is
 * never anything, and a broken `diffDocuments` names the wrong area. None of
 * those throws, and none is visible in a typecheck.
 *
 * These were also reconstructed after their source was lost, so the tests carry
 * more weight than usual: they are the written-down form of the contract the
 * reconstruction was built against.
 */

type Row = {
  typeKey: string;
  key: string;
  position: number;
  data: unknown;
  publishedData: unknown;
  status: string;
  hidden?: boolean;
};

const row = (over: Partial<Row> = {}): Row => ({
  typeKey: "team",
  key: "a-person",
  position: 0,
  data: { name: "Neu" },
  publishedData: { name: "Live" },
  status: "PUBLISHED",
  ...over,
});

describe("canonical", () => {
  it("makes key order irrelevant", () => {
    /**
     * The whole reason it exists. The live document comes back out of a
     * Postgres `jsonb` column, which does not preserve key order, so comparing
     * it to a freshly built object with `JSON.stringify` reports almost every
     * object as changed.
     */
    const fromDb = { b: 1, a: 2 };
    const fresh = { a: 2, b: 1 };
    expect(JSON.stringify(canonical(fromDb))).toBe(JSON.stringify(canonical(fresh)));
    // And the naive comparison it replaces does not:
    expect(JSON.stringify(fromDb)).not.toBe(JSON.stringify(fresh));
  });

  it("sorts nested objects too", () => {
    const a = { outer: { z: 1, a: { y: 2, b: 3 } } };
    const b = { outer: { a: { b: 3, y: 2 }, z: 1 } };
    expect(JSON.stringify(canonical(a))).toBe(JSON.stringify(canonical(b)));
  });

  it("sorts objects inside arrays", () => {
    const a = [{ b: 1, a: 2 }];
    const b = [{ a: 2, b: 1 }];
    expect(JSON.stringify(canonical(a))).toBe(JSON.stringify(canonical(b)));
  });

  it("does NOT sort arrays, because order is meaning here", () => {
    // A collection is written in `position` order, so reordering it *is* a
    // change and has to be reported as one. Sorting arrays would hide exactly
    // the case the publish screen was rebuilt to catch.
    expect(JSON.stringify(canonical([1, 2]))).not.toBe(JSON.stringify(canonical([2, 1])));
  });

  it("leaves scalars and null alone", () => {
    expect(canonical("x")).toBe("x");
    expect(canonical(3)).toBe(3);
    expect(canonical(null)).toBe(null);
  });
});

describe("diffDocuments", () => {
  it("reports nothing when the documents agree apart from key order", () => {
    const live = { team: [{ name: "A", office: "Thun" }] };
    const next = { team: [{ office: "Thun", name: "A" }] };
    expect(diffDocuments(live, next)).toEqual([]);
  });

  it("reports an area whose contents changed, with both counts", () => {
    const live = { team: [{ name: "A" }, { name: "B" }] };
    const next = { team: [{ name: "A" }] };
    const changes = diffDocuments(live, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ key: "team", live: 2, next: 1 });
  });

  it("names the area the way the editor knows it", () => {
    // From the content model, not the raw key — the publish screen says "Team",
    // not "team".
    const changes = diffDocuments({ team: [] }, { team: [{ name: "A" }] });
    expect(changes[0].label).toBe("Team");
  });

  it("reports a reordering, which never becomes APPROVED and so was invisible before", () => {
    const live = { team: [{ name: "A" }, { name: "B" }] };
    const next = { team: [{ name: "B" }, { name: "A" }] };
    expect(diffDocuments(live, next)).toHaveLength(1);
  });

  it("reports an area that is new", () => {
    const changes = diffDocuments({}, { team: [{ name: "A" }] });
    expect(changes[0]).toMatchObject({ key: "team", live: null, next: 1 });
  });

  it("reports an area that has gone", () => {
    const changes = diffDocuments({ team: [{ name: "A" }] }, {});
    expect(changes[0]).toMatchObject({ key: "team", live: 1, next: null });
  });

  it("treats a never-published site as entirely new", () => {
    const changes = diffDocuments(null, { team: [{ name: "A" }], hero: { title: "x" } });
    expect(changes.map((c) => c.key).sort()).toEqual(["hero", "team"]);
    expect(changes.every((c) => c.live === null)).toBe(true);
  });

  it("gives a singleton no count, because a field tally is not information", () => {
    const changes = diffDocuments({ hero: { title: "alt" } }, { hero: { title: "neu" } });
    expect(changes[0]).toMatchObject({ key: "hero", live: 1, next: 1 });
  });

  it("reports a changed loose string with null counts", () => {
    const changes = diffDocuments({ jobSchluss: "a" }, { jobSchluss: "b" });
    expect(changes[0]).toMatchObject({ key: "jobSchluss", live: null, next: null });
  });
});

describe("rowsForNextPublish", () => {
  it("promotes an approved row's draft into the published slot", () => {
    // Step one of what `publish()` does in its transaction.
    const [out] = rowsForNextPublish([
      row({ status: "APPROVED", data: { name: "Neu" }, publishedData: { name: "Alt" } }),
    ]);
    expect(out.publishedData).toEqual({ name: "Neu" });
  });

  it("leaves a published row exactly as it is", () => {
    const [out] = rowsForNextPublish([
      row({ status: "PUBLISHED", data: { name: "Entwurf" }, publishedData: { name: "Live" } }),
    ]);
    expect(out.publishedData).toEqual({ name: "Live" });
  });

  it("drops a draft that has never been published", () => {
    // Step two: `publishedData: { not: DbNull }`. A draft is not on the site.
    expect(rowsForNextPublish([row({ status: "DRAFT", publishedData: null })])).toEqual([]);
  });

  it("keeps a draft edit of something already live, at its live value", () => {
    // The property that lets an editor work on next month's copy without it
    // reaching a visitor.
    const [out] = rowsForNextPublish([
      row({ status: "DRAFT", data: { name: "Entwurf" }, publishedData: { name: "Live" } }),
    ]);
    expect(out.publishedData).toEqual({ name: "Live" });
  });

  it("includes an approved row that has never been published before", () => {
    const out = rowsForNextPublish([
      row({ status: "APPROVED", data: { name: "Erstmals" }, publishedData: null }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].publishedData).toEqual({ name: "Erstmals" });
  });

  it("does not mutate the rows it was given", () => {
    // It models a transaction without performing one; mutating the caller's
    // rows would make `GET /content/pending` a write in disguise.
    const rows = [row({ status: "APPROVED", data: { name: "Neu" }, publishedData: { name: "Alt" } })];
    rowsForNextPublish(rows);
    expect(rows[0].publishedData).toEqual({ name: "Alt" });
  });
});
