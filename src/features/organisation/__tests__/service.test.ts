import { describe, expect, it } from "vitest";
import type { Office, Organisation, Setting } from "@/entities/organisation";
import {
  DEFAULT_SECTION,
  SETTINGS_SECTIONS,
  dangerousEdits,
  pendingSettingUpdates,
  publicOffices,
  sectionFor,
  sectionGroups,
  settingsFor,
  validateOffice,
  validateOrganisation,
  visibleSections,
} from "../service";

/**
 * The workspace's rules.
 *
 * Pure, so they are tested here rather than through a renderer — the same
 * argument `features/applications/__tests__/service.test.ts` makes. What is in
 * this file is everything that can be *wrong* about the settings screen
 * without anything failing: a section that shows for the wrong permission, a
 * confirmation that fires on a value nobody changed, an office register that
 * disagrees with the website about which offices are on it.
 */

const org = (over: Partial<Organisation> = {}): Organisation => ({
  name: "IEM AG",
  shortName: "IEM",
  description: null,
  foundedYear: 1994,
  organisationType: "Aktiengesellschaft",
  defaultLocale: "de-CH",
  defaultTimezone: "Europe/Zurich",
  defaultCurrency: "CHF",
  status: "ACTIVE",
  legalName: null,
  legalForm: null,
  uid: null,
  vatId: null,
  commercialRegister: null,
  registerOffice: null,
  legalStreet: null,
  legalZip: null,
  legalCity: null,
  legalCountry: "CH",
  invoiceAddress: null,
  legalContactName: null,
  legalContactEmail: null,
  dataProtectionContactName: null,
  dataProtectionContactEmail: null,
  copyright: null,
  legalNotice: null,
  mainEmail: null,
  mainPhone: null,
  recruitmentEmail: null,
  supportEmail: null,
  billingEmail: null,
  website: null,
  seoTitlePattern: null,
  seoDescription: null,
  ogImageUrl: null,
  faviconUrl: null,
  version: 1,
  updatedAt: new Date("2026-09-19T10:00:00Z"),
  updatedBy: null,
  ...over,
});

const office = (over: Partial<Office> = {}): Office => ({
  id: "o1",
  name: "Thun",
  kind: "Hauptsitz",
  street: "Uttigenstrasse 49",
  zip: "3600",
  city: "Thun",
  canton: "BE",
  country: "CH",
  phone: "+41 33 227 40 20",
  email: null,
  latitude: null,
  longitude: null,
  mapsUrl: null,
  openingHours: null,
  isHeadquarters: true,
  isPublic: true,
  position: 0,
  archivedAt: null,
  version: 1,
  ...over,
});

const setting = (over: Partial<Setting> = {}): Setting => ({
  key: "a.key",
  group: "Test",
  label: "Ein Wert",
  value: "alt",
  type: "string",
  secret: false,
  hasValue: true,
  pending: false,
  lockedBecause: null,
  ...over,
});

/* ================================================================== */
/* Sections                                                            */
/* ================================================================== */

describe("the section catalogue", () => {
  it("gives every section a unique slug", () => {
    // Two sections on one slug means the second is unreachable, and the
    // sub-navigation would show a row that opens the other one.
    const slugs = SETTINGS_SECTIONS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("gives every section at least one permission", () => {
    // A section with none would open for any signed-in user. The route table
    // uses the same any-of rule, and an empty list there means "anyone".
    const open = SETTINGS_SECTIONS.filter((s) => s.permissions.length === 0);
    expect(open.map((s) => s.slug)).toEqual([]);
  });

  it("names a settings group that a section actually reads", () => {
    // The groups are the server's own `Setting.group` values. A typo here
    // renders an empty section rather than failing, which reads as a feature
    // that has no settings.
    const named = SETTINGS_SECTIONS.flatMap((s) =>
      s.source.kind === "settings" ? [...s.source.groups] : [],
    );
    expect(named).toContain("E-Mail");
    expect(named).toContain("Bewerbungen");
    expect(named).toContain("Sicherheit");
    expect(named).toContain("Freigabe");
    expect(new Set(named).size).toBe(named.length);
  });

  it("assigns every organisation field to exactly one section", () => {
    /*
      A field in no section is not editable and nothing says so; a field in two
      is edited from two forms with two optimistic locks, and the second save
      is a 409 the reader cannot explain.
    */
    const fields = SETTINGS_SECTIONS.flatMap((s) =>
      s.source.kind === "organisation" ? [...s.source.fields] : [],
    );
    expect(new Set(fields).size).toBe(fields.length);

    const editable = new Set(fields as string[]);
    const skip = new Set(["version", "updatedAt", "updatedBy"]);
    const orphans = Object.keys(org()).filter((key) => !skip.has(key) && !editable.has(key));
    expect(orphans, "organisation fields no section edits").toEqual([]);
  });

  it("defaults to the first section", () => {
    expect(sectionFor(undefined)?.slug).toBe(DEFAULT_SECTION);
  });

  it("returns null for a slug it does not know", () => {
    // Answered rather than redirected — see the note in the workspace.
    expect(sectionFor("gibtsnicht")).toBeNull();
  });
});

describe("visibleSections", () => {
  it("shows a section when any one of its permissions is held", () => {
    const only = visibleSections((p) => p === "office.read");
    expect(only.map((s) => s.slug)).toEqual(["standorte"]);
  });

  it("shows everything to somebody holding everything", () => {
    expect(visibleSections(() => true)).toHaveLength(SETTINGS_SECTIONS.length);
  });

  it("shows nothing rather than an empty shell to somebody holding nothing", () => {
    expect(visibleSections(() => false)).toEqual([]);
  });

  it("keeps the System panel behind system.health rather than settings.read", () => {
    // They are different questions: reading the SMTP host is not the same as
    // reading the database's latency and migration state.
    const settingsOnly = visibleSections((p) => p === "settings.read").map((s) => s.slug);
    expect(settingsOnly).not.toContain("system");
    expect(settingsOnly).toContain("email");
  });
});

describe("sectionGroups", () => {
  it("keeps the declaration order and starts an unlabelled block", () => {
    const groups = sectionGroups(visibleSections(() => true));
    expect(groups[0].label).toBeNull();
    expect(groups[1].label).toBe("Betrieb");
  });

  it("drops a zone whose sections are all hidden", () => {
    const groups = sectionGroups(visibleSections((p) => p === "office.read"));
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.slug)).toEqual(["standorte"]);
  });
});

/* ================================================================== */
/* Validation                                                          */
/* ================================================================== */

describe("validateOrganisation", () => {
  it("accepts a plausible record", () => {
    expect(validateOrganisation(org())).toEqual({});
  });

  it("refuses an empty name", () => {
    expect(validateOrganisation(org({ name: "  " })).name).toBeTruthy();
  });

  it("checks the UID's shape and leaves the check digit to the server", () => {
    // Deliberately weaker than the server's rule so the two cannot disagree —
    // anything the server accepts passes here. See the note in `service.ts`.
    expect(validateOrganisation(org({ uid: "CHE107625851" })).uid).toBeTruthy();
    expect(validateOrganisation(org({ uid: "CHE-107.625.851" })).uid).toBeUndefined();
    // A wrong check digit is correctly *shaped*, so this layer passes it.
    expect(validateOrganisation(org({ uid: "CHE-123.456.789" })).uid).toBeUndefined();
  });

  it("wants the MWST suffix on the VAT number", () => {
    expect(validateOrganisation(org({ vatId: "CHE-107.625.851" })).vatId).toBeTruthy();
    expect(validateOrganisation(org({ vatId: "CHE-107.625.851 MWST" })).vatId).toBeUndefined();
  });

  it("checks every address field, not only the first", () => {
    const errors = validateOrganisation(
      org({ mainEmail: "kaputt", billingEmail: "auch@kaputt", supportEmail: "ok@iem.ch" }),
    );
    expect(errors.mainEmail).toBeTruthy();
    expect(errors.billingEmail).toBeTruthy();
    expect(errors.supportEmail).toBeUndefined();
  });

  it("wants a scheme on the website", () => {
    expect(validateOrganisation(org({ website: "www.iem.ch" })).website).toBeTruthy();
    expect(validateOrganisation(org({ website: "https://www.iem.ch" })).website).toBeUndefined();
  });

  it("treats a cleared optional field as fine", () => {
    // `null` is "cleared" and must not be validated as a malformed value —
    // otherwise an address can be entered and never removed.
    expect(validateOrganisation(org({ mainEmail: null, website: null }))).toEqual({});
  });

  it("refuses an implausible founding year", () => {
    expect(validateOrganisation(org({ foundedYear: 1200 })).foundedYear).toBeTruthy();
    expect(validateOrganisation(org({ foundedYear: null })).foundedYear).toBeUndefined();
  });
});

describe("validateOffice", () => {
  it("accepts a complete office", () => {
    expect(validateOffice(office())).toEqual({});
  });

  it("refuses an empty name", () => {
    expect(validateOffice(office({ name: " " })).name).toBeTruthy();
  });

  it("refuses half a coordinate", () => {
    /*
      The silent one: a map link built from a latitude and an empty longitude
      points at the Gulf of Guinea rather than at Thun, and nothing throws.
    */
    expect(validateOffice(office({ latitude: 46.75, longitude: null })).longitude).toBeTruthy();
    expect(validateOffice(office({ latitude: null, longitude: 7.62 })).latitude).toBeTruthy();
  });

  it("accepts both or neither", () => {
    expect(validateOffice(office({ latitude: 46.75, longitude: 7.62 }))).toEqual({});
    expect(validateOffice(office({ latitude: null, longitude: null }))).toEqual({});
  });

  it("wants a two-letter country", () => {
    expect(validateOffice(office({ country: "CHE" })).country).toBeTruthy();
  });
});

/* ================================================================== */
/* Settings                                                            */
/* ================================================================== */

describe("settingsFor", () => {
  it("takes the named groups in the order the section declares them", () => {
    const groups = [
      { group: "Freigabe", settings: [setting({ key: "w.a" })] },
      { group: "Website", settings: [setting({ key: "s.a" })] },
    ];
    expect(settingsFor(groups, ["Website", "Freigabe"]).map((s) => s.key)).toEqual([
      "s.a",
      "w.a",
    ]);
  });

  it("ignores a group the server did not send", () => {
    // A retired group must render as absent rather than throwing — the server
    // skips rows it no longer declares, so this is a state that really occurs.
    expect(settingsFor([], ["E-Mail"])).toEqual([]);
  });
});

describe("pendingSettingUpdates", () => {
  it("sends only what actually differs", () => {
    const settings = [setting({ key: "a", value: "alt" }), setting({ key: "b", value: "alt" })];
    const updates = pendingSettingUpdates(settings, { a: "alt", b: "neu" });
    expect(updates).toEqual([{ key: "b", value: "neu" }]);
  });

  it("treats a list with the same entries as unchanged", () => {
    // Two arrays are never `===`. Without the value comparison, opening the
    // Sicherheit section would report an unsaved change on every render.
    const settings = [setting({ key: "o", type: "stringList", value: ["a", "b"] })];
    expect(pendingSettingUpdates(settings, { o: ["a", "b"] })).toEqual([]);
  });

  it("sends a false", () => {
    // The value somebody picks when switching a control *off*, and the one a
    // falsy check would drop.
    const settings = [setting({ key: "f", type: "boolean", value: true })];
    expect(pendingSettingUpdates(settings, { f: false })).toEqual([{ key: "f", value: false }]);
  });

  it("drops an edit for a key the group does not contain", () => {
    expect(pendingSettingUpdates([], { ghost: 1 })).toEqual([]);
  });
});

describe("dangerousEdits", () => {
  const settings = [
    setting({
      key: "workflow.requireApproval",
      type: "boolean",
      value: true,
      dangerous: "Das Vier-Augen-Prinzip entfällt.",
    }),
    setting({ key: "mail.from", value: "a@iem.ch" }),
  ];

  it("names a dangerous setting that was changed", () => {
    const found = dangerousEdits(settings, { "workflow.requireApproval": false });
    expect(found).toHaveLength(1);
    expect(found[0].warning).toContain("Vier-Augen");
  });

  it("stays silent when the dangerous setting was opened and left alone", () => {
    /*
      A confirmation that fires on an unchanged value teaches the reader to
      click through it, which is the failure mode of every dialog that appears
      too often — and this is the dialog that has to work.
    */
    expect(dangerousEdits(settings, { "workflow.requireApproval": true })).toEqual([]);
  });

  it("stays silent for an ordinary setting", () => {
    expect(dangerousEdits(settings, { "mail.from": "b@iem.ch" })).toEqual([]);
  });

  it("takes the warning from the server's own row", () => {
    // The list of which settings matter is the server's. A copy here would be
    // the one that goes out of date, silently.
    const [found] = dangerousEdits(settings, { "workflow.requireApproval": false });
    expect(found.warning).toBe(settings[0].dangerous);
  });
});

/* ================================================================== */
/* What the website shows                                              */
/* ================================================================== */

describe("publicOffices", () => {
  it("drops the internal and the archived", () => {
    const rows = [
      office({ id: "a", city: "Thun", position: 0 }),
      office({ id: "b", city: "Lager", isPublic: false, isHeadquarters: false, position: 1 }),
      office({ id: "c", city: "Alt", archivedAt: new Date(), isHeadquarters: false, position: 2 }),
    ];
    expect(publicOffices(rows).map((o) => o.id)).toEqual(["a"]);
  });

  it("orders by position, then by name", () => {
    const rows = [
      office({ id: "b", name: "Bern", position: 1, isHeadquarters: false }),
      office({ id: "a", name: "Thun", position: 0 }),
    ];
    expect(publicOffices(rows).map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("does not put the headquarters first by itself", () => {
    /*
      Mirrors the server's `toSiteOffices`: `position` decides, not
      `isHeadquarters`. An office can be the registered seat and not the one a
      visitor should be shown first, and the two rules disagreeing would make
      the register's "Auf der Website: …" line a lie.
    */
    const rows = [
      office({ id: "hq", name: "Thun", position: 5 }),
      office({ id: "br", name: "Bern", position: 1, isHeadquarters: false }),
    ];
    expect(publicOffices(rows).map((o) => o.id)).toEqual(["br", "hq"]);
  });
});
