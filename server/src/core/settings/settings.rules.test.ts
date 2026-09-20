import { describe, expect, it } from "vitest";
import {
  REDACTED,
  planSettingUpdates,
  refuseSettingValue,
  type SettingDef,
} from "./settings.rules";
import { DEFAULT_SETTINGS } from "./settings.service";

/**
 * The guard for a P0.
 *
 * Settings were stored as free-form JSON with nothing checking the shape —
 * `settings.controller.ts` claimed in a comment that the service checked it
 * against the setting's own definition, and no such check existed anywhere.
 * `applications.retentionDays` was then read raw and multiplied into
 * `retainUntil`, which the 03:00 purge deletes against. A `0` removed every
 * applicant dossier received that day; a string produced `new Date(NaN)` and
 * took the public application form down with a 500.
 *
 * These are pure functions, so this test can be exhaustive over every declared
 * type — and it is deliberately exhaustive *over the catalogue itself* at the
 * bottom, because the failure mode that matters is not a broken validator but
 * a setting that was added without one.
 */

const def = (over: Partial<SettingDef> = {}): SettingDef => ({
  key: "test.key",
  group: "Test",
  type: "string",
  value: "",
  description: "Ein Wert",
  ...over,
});

describe("refuseSettingValue", () => {
  describe("boolean", () => {
    const boolean = def({ type: "boolean", value: false });

    it("accepts both booleans, false included", () => {
      expect(refuseSettingValue(boolean, true)).toBeNull();
      // `false` is the value somebody picks when switching a governance
      // control off, and a rejected `false` is indistinguishable from "no
      // change" one layer down.
      expect(refuseSettingValue(boolean, false)).toBeNull();
    });

    it("refuses the string 'false', which is what a form sends when it is wrong", () => {
      expect(refuseSettingValue(boolean, "false")).toMatch(/Ja\/Nein/);
    });

    it("refuses 0 and 1", () => {
      expect(refuseSettingValue(boolean, 0)).not.toBeNull();
      expect(refuseSettingValue(boolean, 1)).not.toBeNull();
    });
  });

  describe("number", () => {
    const retention = def({
      key: "applications.retentionDays",
      type: "number",
      value: 180,
      description: "Aufbewahrungsfrist für Bewerbungen",
      unit: "Tage",
      min: 30,
      max: 3650,
    });

    it("accepts a value inside the range", () => {
      expect(refuseSettingValue(retention, 180)).toBeNull();
      expect(refuseSettingValue(retention, 30)).toBeNull();
      expect(refuseSettingValue(retention, 3650)).toBeNull();
    });

    /** The one that deleted the dossiers. */
    it("refuses zero", () => {
      expect(refuseSettingValue(retention, 0)).toMatch(/nicht kleiner als 30 Tage/);
    });

    it("refuses a negative retention", () => {
      expect(refuseSettingValue(retention, -1)).not.toBeNull();
    });

    it("refuses above the maximum", () => {
      expect(refuseSettingValue(retention, 3651)).toMatch(/nicht grösser als 3650 Tage/);
    });

    /** The one that 500'd the public application form. */
    it("refuses a non-numeric value", () => {
      expect(refuseSettingValue(retention, "180")).toMatch(/erwartet eine Zahl/);
      expect(refuseSettingValue(retention, "bald")).toMatch(/erwartet eine Zahl/);
    });

    it("refuses NaN and Infinity, which are numbers and are not values", () => {
      expect(refuseSettingValue(retention, Number.NaN)).not.toBeNull();
      expect(refuseSettingValue(retention, Number.POSITIVE_INFINITY)).not.toBeNull();
    });

    it("names the unit in the message", () => {
      // "nicht kleiner als 30" reads as thirty of something unstated. The unit
      // is the difference between a message and a riddle.
      expect(refuseSettingValue(retention, 1)).toContain("Tage");
    });
  });

  describe("email", () => {
    const email = def({ type: "email", value: "" });

    it("accepts an address", () => {
      expect(refuseSettingValue(email, "info@iem.ch")).toBeNull();
    });

    it("accepts blank, which is how an address is cleared", () => {
      expect(refuseSettingValue(email, "")).toBeNull();
      expect(refuseSettingValue(email, "   ")).toBeNull();
    });

    it("refuses something that is not an address", () => {
      expect(refuseSettingValue(email, "info@iem")).not.toBeNull();
      expect(refuseSettingValue(email, "iem.ch")).not.toBeNull();
    });
  });

  describe("url", () => {
    const url = def({ type: "url", value: "" });

    it("accepts http and https", () => {
      expect(refuseSettingValue(url, "https://www.iem.ch")).toBeNull();
      expect(refuseSettingValue(url, "http://localhost:5173")).toBeNull();
    });

    it("refuses a scheme that is not the web", () => {
      // `javascript:` in a setting that ends up in an `href` is the whole
      // reason the protocol is checked rather than only the parse.
      expect(refuseSettingValue(url, "javascript:alert(1)")).not.toBeNull();
      expect(refuseSettingValue(url, "file:///etc/passwd")).not.toBeNull();
    });

    it("refuses something unparseable", () => {
      expect(refuseSettingValue(url, "www.iem.ch")).not.toBeNull();
    });
  });

  describe("stringList", () => {
    const list = def({ type: "stringList", value: [] });

    it("accepts a list of strings and an empty list", () => {
      expect(refuseSettingValue(list, ["https://a.example"])).toBeNull();
      expect(refuseSettingValue(list, [])).toBeNull();
    });

    it("refuses a bare string", () => {
      expect(refuseSettingValue(list, "https://a.example")).toMatch(/Liste/);
    });

    it("refuses a list with a non-string in it", () => {
      expect(refuseSettingValue(list, ["a", 2])).not.toBeNull();
    });
  });

  describe("select", () => {
    const select = def({
      type: "select",
      value: "a",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    });

    it("accepts a declared option", () => {
      expect(refuseSettingValue(select, "b")).toBeNull();
    });

    it("refuses anything else and lists what is allowed", () => {
      expect(refuseSettingValue(select, "c")).toContain("a, b");
    });
  });
});

describe("planSettingUpdates", () => {
  const defs = new Map<string, SettingDef>([
    ["a.flag", def({ key: "a.flag", type: "boolean", value: true })],
    ["a.host", def({ key: "a.host", type: "string", value: "" })],
    ["a.secret", def({ key: "a.secret", type: "string", value: "", secret: true })],
    ["a.count", def({ key: "a.count", type: "number", value: 5, min: 1, max: 10 })],
  ]);

  it("passes a valid batch through", () => {
    const plan = planSettingUpdates(defs, [
      { key: "a.flag", value: false },
      { key: "a.count", value: 7 },
    ]);
    expect(plan.errors).toEqual([]);
    expect(plan.unknown).toEqual([]);
    expect(plan.apply).toEqual([
      { key: "a.flag", value: false },
      { key: "a.count", value: 7 },
    ]);
  });

  it("drops a secret written back as the mask", () => {
    // Saving the SMTP form without retyping the password must not blank it,
    // and must not store the mask itself as the password.
    const plan = planSettingUpdates(defs, [{ key: "a.secret", value: REDACTED }]);
    expect(plan.apply).toEqual([]);
    expect(plan.errors).toEqual([]);
  });

  it("still writes a secret the caller actually typed", () => {
    const plan = planSettingUpdates(defs, [{ key: "a.secret", value: "hunter2" }]);
    expect(plan.apply).toEqual([{ key: "a.secret", value: "hunter2" }]);
  });

  it("reports an unknown key separately from an invalid value", () => {
    // They are different HTTP answers — 404 against 400 — and collapsing them
    // would tell an operator their value was wrong when the key was.
    const plan = planSettingUpdates(defs, [
      { key: "a.nope", value: 1 },
      { key: "a.count", value: 99 },
    ]);
    expect(plan.unknown).toEqual(["a.nope"]);
    expect(plan.errors).toHaveLength(1);
  });

  it("collects every error rather than stopping at the first", () => {
    // A settings form saves several fields at once; reporting one error per
    // save makes fixing three fields take three round trips.
    const plan = planSettingUpdates(defs, [
      { key: "a.flag", value: "yes" },
      { key: "a.count", value: 0 },
    ]);
    expect(plan.errors).toHaveLength(2);
    expect(plan.apply).toEqual([]);
  });

  it("refuses an absent value rather than writing undefined", () => {
    // Prisma reads `undefined` as "do not touch this column", so this used to
    // answer 200 and change nothing. See the note in `planSettingUpdates`.
    const plan = planSettingUpdates(defs, [{ key: "a.host", value: undefined }]);
    expect(plan.errors[0]).toContain("kein Wert");
  });

  it("trims a string, because a trailing space in a hostname is always a typo", () => {
    const plan = planSettingUpdates(defs, [{ key: "a.host", value: " smtp.iem.ch " }]);
    expect(plan.apply[0].value).toBe("smtp.iem.ch");
  });
});

/**
 * The catalogue itself.
 *
 * The validators above are only worth having if every setting is covered by
 * one, and the way that stops being true is somebody adding a setting and not
 * a type. These assertions fail on that rather than on a broken rule.
 */
describe("DEFAULT_SETTINGS", () => {
  it("declares a type for every setting", () => {
    const untyped = DEFAULT_SETTINGS.filter((s) => !s.type);
    expect(untyped.map((s) => s.key)).toEqual([]);
  });

  it("gives every setting a default its own validator accepts", () => {
    // A default the rules would refuse is a fresh install that cannot save its
    // own settings page — and the seed writes these values directly, so the
    // database would hold something the API rejects.
    const bad = DEFAULT_SETTINGS.map((s) => [s.key, refuseSettingValue(s, s.value)] as const)
      .filter(([, error]) => error !== null)
      .map(([key, error]) => `${key}: ${error}`);
    expect(bad).toEqual([]);
  });

  it("bounds every number", () => {
    // An unbounded number is the shape the P0 had: valid as a type, ruinous as
    // a value.
    const unbounded = DEFAULT_SETTINGS.filter(
      (s) => s.type === "number" && (s.min === undefined || s.max === undefined),
    );
    expect(unbounded.map((s) => s.key)).toEqual([]);
  });

  it("gives every select its options", () => {
    const optionless = DEFAULT_SETTINGS.filter(
      (s) => s.type === "select" && !s.options?.length,
    );
    expect(optionless.map((s) => s.key)).toEqual([]);
  });

  it("no longer declares the keys that became Organisation columns", () => {
    // The nine that moved. A re-declaration here would recreate the duplication
    // the move existed to remove — two places holding the company's e-mail
    // address, one of which nothing reads.
    const moved = [
      "company.name",
      "company.legalName",
      "company.email",
      "company.website",
      "brand.logoUrl",
      "brand.faviconUrl",
      "brand.primaryColor",
      "site.baseUrl",
      "site.defaultLocale",
    ];
    const keys = new Set(DEFAULT_SETTINGS.map((s) => s.key));
    expect(moved.filter((k) => keys.has(k))).toEqual([]);
  });
});
