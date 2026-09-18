import { describe, expect, it } from "vitest";
import { alphaValue, nextRevisionLabel, revisionLabel } from "./revision";

/**
 * The revision sequence, exhaustively.
 *
 * Exhaustive is affordable here — it is arithmetic — and it is the reason the
 * numbering is a pure module rather than a method on a service. The whole class
 * of bug in this file lives at a boundary (`Z → AA`, `ZZ → AAA`), and a test
 * that needed a database would have covered `A → B` and stopped.
 */

describe("numeric revisions", () => {
  it("labels from one", () => {
    expect(revisionLabel("NUMERIC", 1)).toBe("v1");
    expect(revisionLabel("NUMERIC", 12)).toBe("v12");
  });

  it("counts from one, not from zero", () => {
    // The first version of a record is "v1" to every person who will read it.
    // Storing it 0-based would mean one conversion somewhere, and that
    // conversion is the bug.
    expect(() => revisionLabel("NUMERIC", 0)).toThrow(/ab 1/);
    expect(() => revisionLabel("NUMERIC", -1)).toThrow();
    expect(() => revisionLabel("NUMERIC", 1.5)).toThrow();
  });

  it("advances", () => {
    expect(nextRevisionLabel("NUMERIC", "v1")).toBe("v2");
    expect(nextRevisionLabel("NUMERIC", "v9")).toBe("v10");
    // The `v` is optional on the way in: a caller may hold the number.
    expect(nextRevisionLabel("NUMERIC", "41")).toBe("v42");
  });

  it("refuses something that is not a version", () => {
    expect(() => nextRevisionLabel("NUMERIC", "Rev C")).toThrow();
  });
});

describe("alphabetic revisions", () => {
  it("labels the first twenty-six", () => {
    expect(revisionLabel("ALPHA", 1)).toBe("A");
    expect(revisionLabel("ALPHA", 3)).toBe("C");
    expect(revisionLabel("ALPHA", 26)).toBe("Z");
  });

  it("carries after Z", () => {
    // The assertion this file exists for. A naive `String.fromCharCode(65 + n)`
    // produces `[` here, and it produces it in a title block on a drawing that
    // has been issued to a contractor.
    expect(revisionLabel("ALPHA", 27)).toBe("AA");
    expect(revisionLabel("ALPHA", 28)).toBe("AB");
    expect(revisionLabel("ALPHA", 52)).toBe("AZ");
    expect(revisionLabel("ALPHA", 53)).toBe("BA");
  });

  it("carries twice", () => {
    expect(revisionLabel("ALPHA", 702)).toBe("ZZ");
    expect(revisionLabel("ALPHA", 703)).toBe("AAA");
  });

  it("is bijective base-26, which has no zero digit", () => {
    // `AA` is 27 and not 26, because `A` means one rather than nought. Plain
    // base-26 would make `A` and `AA` the same number.
    expect(alphaValue("A")).toBe(1);
    expect(alphaValue("Z")).toBe(26);
    expect(alphaValue("AA")).toBe(27);
    expect(alphaValue("AAA")).toBe(703);
  });

  it("round-trips for the first thousand revisions", () => {
    // Nobody will issue a drawing at revision 1000. The point is that the pair
    // agrees everywhere rather than at the handful of values somebody thought
    // to write down.
    for (let n = 1; n <= 1000; n++) {
      expect(alphaValue(revisionLabel("ALPHA", n)), `Revision ${n}`).toBe(n);
    }
  });

  it("advances from a label", () => {
    expect(nextRevisionLabel("ALPHA", "A")).toBe("B");
    expect(nextRevisionLabel("ALPHA", "Z")).toBe("AA");
    expect(nextRevisionLabel("ALPHA", "AZ")).toBe("BA");
    expect(nextRevisionLabel("ALPHA", "ZZ")).toBe("AAA");
  });

  it("refuses a label it did not produce", () => {
    expect(() => alphaValue("a")).toThrow();
    expect(() => alphaValue("A1")).toThrow();
    expect(() => alphaValue("")).toThrow();
  });
});
