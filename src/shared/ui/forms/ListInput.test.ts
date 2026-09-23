import { describe, expect, it } from "vitest";
import { formatList, parseList } from "./ListInput";

/**
 * UX-41: a comma could not be typed into a list field, because the field
 * re-rendered from the parsed list on every keystroke. The component fix is
 * to keep the text; what it relies on is that parsing the text it keeps gives
 * back the list the parent already has — which is what these pin.
 */
describe("parseList", () => {
  it("splits, trims and drops blanks", () => {
    expect(parseList(" Lüftung ,Heizung,, Sanitär ")).toEqual(["Lüftung", "Heizung", "Sanitär"]);
  });

  it("a trailing comma parses to the same list — so the comma can stand while typing", () => {
    expect(parseList("Lüftung,")).toEqual(parseList("Lüftung"));
    expect(parseList("Lüftung, ")).toEqual(["Lüftung"]);
  });

  it("the empty text is the empty list", () => {
    expect(parseList("")).toEqual([]);
  });
});

describe("formatList", () => {
  it("round-trips through parseList", () => {
    const items = ["https://a.example", "https://b.example"];
    expect(parseList(formatList(items))).toEqual(items);
  });
});
