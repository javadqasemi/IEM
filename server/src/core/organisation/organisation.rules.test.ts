import { describe, expect, it } from "vitest";
import {
  officeWarnings,
  refuseArchiveOffice,
  refuseDeleteOffice,
  refuseHeadquartersChange,
  refuseUid,
  refuseVatId,
  telHref,
  toSiteOffice,
  uidCheckDigit,
  uidMismatchWarning,
  type OfficeFacts,
} from "./organisation.rules";

/**
 * The rules, exhaustively — which is possible because they are pure, and
 * necessary because most of their failures are silent.
 *
 * Archiving the only public office does not throw. It makes the *next
 * publish* fail with "offices is empty", two screens and possibly two days
 * away from the click that caused it. A wrong `phoneHref` dials the wrong
 * number from a page that looks perfect. A wrong UID is correct-shaped and
 * appears on every invoice. None of these is a crash, so none of them is
 * caught by anything except a test that asks.
 */

const office = (over: Partial<OfficeFacts> = {}): OfficeFacts => ({
  id: "o1",
  name: "Thun",
  isHeadquarters: false,
  isPublic: true,
  archivedAt: null,
  ...over,
});

/* ================================================================== */
/* Swiss identifiers                                                   */
/* ================================================================== */

describe("uidCheckDigit", () => {
  it("accepts IEM's own UID", () => {
    // CHE-107.625.851. The algorithm is worth nothing if it rejects the
    // company it was written for, so this is the first assertion in the file.
    expect(uidCheckDigit("10762585")).toBe(1);
  });

  it("returns null for a remainder of one, which has no valid check digit", () => {
    // Such a prefix cannot be the start of any valid UID. Returning `10` here
    // — the naive `11 - 1` — would accept a number that does not exist.
    const impossible = [...Array(100).keys()]
      .map((n) => String(n).padStart(8, "0"))
      .filter((digits) => uidCheckDigit(digits) === null);
    expect(impossible.length).toBeGreaterThan(0);
  });

  it("refuses anything that is not eight digits", () => {
    expect(uidCheckDigit("1076258")).toBeNull();
    expect(uidCheckDigit("107625851")).toBeNull();
    expect(uidCheckDigit("abcdefgh")).toBeNull();
  });
});

describe("refuseUid", () => {
  it("accepts IEM's UID", () => {
    expect(refuseUid("CHE-107.625.851")).toBeNull();
  });

  it("accepts blank — a firm may not have entered it yet", () => {
    expect(refuseUid(null)).toBeNull();
    expect(refuseUid("")).toBeNull();
    expect(refuseUid("   ")).toBeNull();
  });

  it("refuses the wrong shape", () => {
    expect(refuseUid("CHE107625851")).toMatch(/Form/);
    expect(refuseUid("107.625.851")).toMatch(/Form/);
  });

  it("refuses a correctly shaped number with a wrong check digit", () => {
    // The half a regex cannot do, and the half that matters: this is what a
    // transposed pair of digits looks like.
    expect(refuseUid("CHE-107.625.852")).toMatch(/Prüfziffer/);
    expect(refuseUid("CHE-123.456.789")).toMatch(/Prüfziffer/);
  });

  it("tolerates surrounding whitespace", () => {
    expect(refuseUid("  CHE-107.625.851  ")).toBeNull();
  });
});

describe("refuseVatId", () => {
  it("accepts the three language suffixes", () => {
    expect(refuseVatId("CHE-107.625.851 MWST")).toBeNull();
    expect(refuseVatId("CHE-107.625.851 TVA")).toBeNull();
    expect(refuseVatId("CHE-107.625.851 IVA")).toBeNull();
  });

  it("refuses the bare UID — a VAT number carries its suffix", () => {
    expect(refuseVatId("CHE-107.625.851")).toMatch(/Form/);
  });

  it("checks the digit too", () => {
    expect(refuseVatId("CHE-107.625.852 MWST")).toMatch(/Prüfziffer/);
  });
});

describe("uidMismatchWarning", () => {
  it("is silent when they are the same number", () => {
    expect(uidMismatchWarning("CHE-107.625.851", "CHE-107.625.851 MWST")).toBeNull();
  });

  it("is silent when either is missing", () => {
    expect(uidMismatchWarning("CHE-107.625.851", null)).toBeNull();
    expect(uidMismatchWarning(null, "CHE-107.625.851 MWST")).toBeNull();
  });

  it("warns — never refuses — when they differ", () => {
    // A warning, because the day a firm genuinely has one and not the other,
    // refusing the save makes the correct data impossible to enter.
    const warning = uidMismatchWarning("CHE-107.625.851", "CHE-116.281.277 MWST");
    expect(warning).toContain("CHE-107.625.851");
    expect(warning).toContain("CHE-116.281.277");
  });
});

/* ================================================================== */
/* Offices                                                             */
/* ================================================================== */

describe("refuseArchiveOffice", () => {
  it("allows archiving a branch while another public office remains", () => {
    const bern = office({ id: "o2", name: "Bern" });
    const thun = office({ isHeadquarters: true });
    expect(refuseArchiveOffice(bern, [thun, bern])).toBeNull();
  });

  it("refuses the headquarters, and says what to do instead", () => {
    const thun = office({ isHeadquarters: true });
    const bern = office({ id: "o2", name: "Bern" });
    const message = refuseArchiveOffice(thun, [thun, bern]);
    expect(message).toContain("Hauptsitz");
    // A refusal that does not name the repair sends somebody looking for a
    // missing button. Same reasoning as `refuseTransition` in Pläne.
    expect(message).toMatch(/zuerst/);
  });

  it("refuses the last public office", () => {
    // The quiet one: this does not fail here, it fails at the next publish,
    // for somebody else, with a message about a content key.
    const only = office({ isHeadquarters: false });
    expect(refuseArchiveOffice(only, [only])).toMatch(/letzte öffentliche/);
  });

  it("allows archiving a non-public office even when it is the last row", () => {
    // It was never on the website, so removing it cannot empty the site's
    // address band.
    const internal = office({ isPublic: false });
    expect(refuseArchiveOffice(internal, [internal])).toBeNull();
  });

  it("refuses archiving something already archived", () => {
    const archived = office({ archivedAt: new Date() });
    expect(refuseArchiveOffice(archived, [archived, office({ id: "o2" })])).toMatch(
      /bereits archiviert/,
    );
  });

  it("does not count an archived sibling as a remaining public office", () => {
    const bern = office({ id: "o2", name: "Bern", archivedAt: new Date() });
    const thun = office();
    expect(refuseArchiveOffice(thun, [thun, bern])).toMatch(/letzte öffentliche/);
  });
});

describe("refuseDeleteOffice", () => {
  const none = { employees: 0, projects: 0, buildings: 0 };

  it("allows deleting an unused branch", () => {
    const bern = office({ id: "o2", name: "Bern" });
    expect(refuseDeleteOffice(bern, none, [office({ isHeadquarters: true }), bern])).toBeNull();
  });

  it("refuses when anything points at it, and names what", () => {
    const bern = office({ id: "o2", name: "Bern" });
    const message = refuseDeleteOffice(
      bern,
      { employees: 3, projects: 12, buildings: 0 },
      [office(), bern],
    );
    expect(message).toContain("3 Mitarbeitende");
    expect(message).toContain("12 Projekte");
    expect(message).not.toContain("Gebäude");
    expect(message).toMatch(/archiviert, nicht gelöscht/);
  });

  it("refuses the headquarters", () => {
    const thun = office({ isHeadquarters: true });
    expect(refuseDeleteOffice(thun, none, [thun, office({ id: "o2" })])).toMatch(/Hauptsitz/);
  });

  it("refuses the last one", () => {
    const only = office();
    expect(refuseDeleteOffice(only, none, [only])).toMatch(/einzige/);
  });

  it("puts the references first when several rules would refuse", () => {
    // "It is the headquarters" is true and unhelpful when the real obstacle is
    // forty employees; the reader would promote another office and hit the
    // second refusal.
    const thun = office({ isHeadquarters: true });
    const message = refuseDeleteOffice(thun, { employees: 40, projects: 0, buildings: 0 }, [thun]);
    expect(message).toContain("40 Mitarbeitende");
  });
});

describe("refuseHeadquartersChange", () => {
  it("allows promoting a branch", () => {
    const bern = office({ id: "o2", name: "Bern" });
    expect(refuseHeadquartersChange(bern, true, [office({ isHeadquarters: true }), bern])).toBeNull();
  });

  it("refuses promoting an archived office", () => {
    const closed = office({ archivedAt: new Date() });
    expect(refuseHeadquartersChange(closed, true, [closed])).toMatch(/archiviert/);
  });

  it("refuses clearing the only headquarters", () => {
    const thun = office({ isHeadquarters: true });
    expect(refuseHeadquartersChange(thun, false, [thun, office({ id: "o2" })])).toMatch(
      /genau einen Hauptsitz/,
    );
  });

  it("is a no-op when the value is unchanged", () => {
    const thun = office({ isHeadquarters: true });
    expect(refuseHeadquartersChange(thun, true, [thun])).toBeNull();
  });
});

/* ================================================================== */
/* What the website reads                                              */
/* ================================================================== */

describe("telHref", () => {
  it("keeps an international number and strips its spacing", () => {
    expect(telHref("+41 33 227 40 20")).toBe("tel:+41332274020");
  });

  it("promotes a national number to international", () => {
    // The site is read on phones abroad; `tel:0332274020` does not connect
    // from one.
    expect(telHref("033 227 40 20")).toBe("tel:+41332274020");
  });

  it("normalises the 00 prefix", () => {
    expect(telHref("0041 33 227 40 20")).toBe("tel:+41332274020");
  });

  it("returns empty for empty", () => {
    expect(telHref("")).toBe("");
    expect(telHref("—")).toBe("");
  });
});

describe("toSiteOffice", () => {
  it("produces the shape the published document carries", () => {
    expect(
      toSiteOffice({
        city: "Thun",
        street: "Uttigenstrasse 49",
        zip: "3600",
        phone: "+41 33 227 40 20",
        kind: "Hauptsitz",
      }),
    ).toEqual({
      city: "Thun",
      street: "Uttigenstrasse 49",
      // "PLZ und Ort" on one line, which is how a Swiss address is printed and
      // what `OfficeEntry.zip` has always meant on the site.
      zip: "3600 Thun",
      phone: "+41 33 227 40 20",
      phoneHref: "tel:+41332274020",
      kind: "Hauptsitz",
    });
  });

  it("does not leave a leading space when the postcode is missing", () => {
    const out = toSiteOffice({
      city: "Thun",
      street: null,
      zip: null,
      phone: null,
      kind: "Zweigbüro",
    });
    expect(out.zip).toBe("Thun");
    expect(out.street).toBe("");
    expect(out.phoneHref).toBe("");
  });
});

describe("officeWarnings", () => {
  const complete = {
    city: "Thun",
    street: "Uttigenstrasse 49",
    zip: "3600 Thun",
    phone: "+41 33 227 40 20",
    phoneHref: "tel:+41332274020",
    kind: "Hauptsitz",
  };

  it("is silent when every office is complete", () => {
    expect(officeWarnings([complete])).toEqual([]);
  });

  it("warns about no public office at all", () => {
    expect(officeWarnings([])).toHaveLength(1);
    expect(officeWarnings([])[0]).toMatch(/Keine? (öffentlicher|Adresse)/i);
  });

  it("names each missing field", () => {
    const warnings = officeWarnings([{ ...complete, phone: "", street: "" }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Strasse");
    expect(warnings[0]).toContain("Telefon");
  });
});
