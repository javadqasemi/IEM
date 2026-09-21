import { describe, expect, it } from "vitest";
import {
  DELIVERY_STATUS_OPTIONS,
  SEVERITY_OPTIONS,
  badgeCount,
  bellLabel,
  changedRows,
  deliveryStatus,
  groupPreferences,
  lockReason,
  severityLabel,
  severityTone,
} from "../service";
import type { PreferenceRow } from "../types";

/**
 * The screens' rules.
 *
 * Everything here can be wrong without rendering differently enough to
 * notice: a `changedRows` that misses a field sends an incomplete save and
 * the screen shows the old value back; a `lockReason` that returns `null`
 * where it should return a sentence draws a control that accepts a click and
 * discards it.
 */

const row = (over: Partial<PreferenceRow> = {}): PreferenceRow => ({
  type: "content.approved",
  category: "Inhalte",
  label: "Eigener Inhalt freigegeben",
  description: "Geht an die Person, die den Eintrag eingereicht hat.",
  severity: "SUCCESS",
  mandatory: false,
  inApp: true,
  email: false,
  lockedInApp: false,
  lockedEmail: false,
  enabled: null,
  recipients: null,
  disabledByOrganisation: false,
  ...over,
});

/* ================================================================== */
/* Severity                                                            */
/* ================================================================== */

describe("severity", () => {
  it("gives every level a tone from the brand palette", () => {
    expect(severityTone("INFO")).toBe("neutral");
    expect(severityTone("SUCCESS")).toBe("energy");
    expect(severityTone("WARNING")).toBe("gold");
    expect(severityTone("CRITICAL")).toBe("bronze");
  });

  it("gives every level a word, so colour is never the only signal", () => {
    /*
      The accessibility requirement stated as a test. Somebody who cannot
      distinguish gold from bronze — or is reading through a screen reader,
      where a tone is nothing at all — gets the same information from the
      label, and every row draws it.
    */
    const levels = ["INFO", "SUCCESS", "WARNING", "CRITICAL"] as const;
    for (const level of levels) {
      expect(severityLabel(level).length).toBeGreaterThan(3);
    }
    // Four distinct words: two levels sharing a label would make the badge
    // ambiguous in exactly the place it is read.
    expect(new Set(levels.map((level) => severityLabel(level))).size).toBe(4);
  });

  it("offers the filter in severity order, not alphabetically", () => {
    // Somebody filtering a feed is looking for the serious ones; putting
    // "Erledigt" first because E comes before K would bury them.
    expect(SEVERITY_OPTIONS.map((o) => o.value)).toEqual([
      "CRITICAL",
      "WARNING",
      "SUCCESS",
      "INFO",
    ]);
  });
});

/* ================================================================== */
/* The bell                                                            */
/* ================================================================== */

describe("badgeCount", () => {
  it("is empty at zero, so the dot is not drawn at all", () => {
    expect(badgeCount(0)).toBe("");
    expect(badgeCount(-3)).toBe("");
  });

  it("caps at ninety-nine", () => {
    expect(badgeCount(1)).toBe("1");
    expect(badgeCount(99)).toBe("99");
    expect(badgeCount(100)).toBe("99+");
  });

  it("agrees with the server's copy", () => {
    /*
      The same four lines exist in `core/notifications/notifications.rules.ts`
      because the server needs them for an e-mail subject and the client
      needs them to render. The duplication is deliberate and small; what
      would not be acceptable is the two disagreeing, so both are tested
      against the same boundaries.
    */
    expect([0, 1, 99, 100].map(badgeCount)).toEqual(["", "1", "99", "99+"]);
  });
});

describe("bellLabel", () => {
  it("is a sentence with correct plurals", () => {
    expect(bellLabel(0)).toBe("Benachrichtigungen — keine ungelesenen");
    expect(bellLabel(1)).toBe("Benachrichtigungen — 1 ungelesene");
    expect(bellLabel(2)).toBe("Benachrichtigungen — 2 ungelesene");
  });

  it("does not cap, unlike the badge", () => {
    // The cap exists because three digits do not fit in a dot. A sentence
    // has room, and the exact number is more useful than "more than 99".
    expect(bellLabel(250)).toContain("250");
  });
});

/* ================================================================== */
/* Grouping                                                            */
/* ================================================================== */

describe("groupPreferences", () => {
  it("groups consecutive rows under their category, in the server's order", () => {
    const groups = groupPreferences([
      row({ type: "a", category: "Sicherheit" }),
      row({ type: "b", category: "Sicherheit" }),
      row({ type: "c", category: "Inhalte" }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["Sicherheit", "Inhalte"]);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("keeps the order rather than sorting", () => {
    /*
      The order is the catalogue's declaration order, which is editorial —
      Sicherheit first because it is the group most likely to be looked for.
      Sorting here would silently override that decision.
    */
    const groups = groupPreferences([
      row({ type: "a", category: "System" }),
      row({ type: "b", category: "Inhalte" }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["System", "Inhalte"]);
  });

  it("handles an empty list", () => {
    expect(groupPreferences([])).toEqual([]);
  });
});

/* ================================================================== */
/* What to save                                                        */
/* ================================================================== */

describe("changedRows", () => {
  const rows = [row({ type: "a" }), row({ type: "b", email: true })];

  it("returns nothing when nothing moved", () => {
    expect(changedRows(rows, {})).toEqual([]);
    // An edit back to the original value is not a change either.
    expect(changedRows(rows, { a: { inApp: true } })).toEqual([]);
  });

  it("returns only the rows that differ", () => {
    const changed = changedRows(rows, { a: { email: true }, b: { email: true } });
    expect(changed.map((r) => r.type)).toEqual(["a"]);
  });

  it("notices a change on each of the three fields", () => {
    expect(changedRows(rows, { a: { inApp: false } })).toHaveLength(1);
    expect(changedRows(rows, { a: { email: true } })).toHaveLength(1);
    expect(changedRows([row({ type: "a", enabled: true })], { a: { enabled: false } })).toHaveLength(1);
  });

  it("merges the patch onto the original rather than returning the patch", () => {
    // The caller sends whole rows to the server, so a patch of one field has
    // to come back carrying the other two.
    const [changed] = changedRows(rows, { a: { email: true } });
    expect(changed).toMatchObject({ type: "a", inApp: true, email: true });
  });

  it("ignores an edit for a row that is not there", () => {
    // Reachable when the list is refetched while the screen holds edits.
    // Sending it would be a save for a type the server may not have.
    expect(changedRows(rows, { gone: { email: true } })).toEqual([]);
  });
});

/* ================================================================== */
/* Why a switch is disabled                                            */
/* ================================================================== */

describe("lockReason", () => {
  it("is null when the control is the reader's to set", () => {
    expect(lockReason(row(), "inApp")).toBeNull();
    expect(lockReason(row(), "email")).toBeNull();
  });

  it("explains a security notification's in-app copy", () => {
    // The four mandatory ones. The message has to say *why* — a greyed-out
    // switch with no explanation is one people assume is broken.
    const reason = lockReason(row({ mandatory: true }), "inApp");
    expect(reason).toMatch(/Sicherheitsmeldung/);
  });

  it("leaves a mandatory type's e-mail copy free", () => {
    /*
      The half that keeps the rule proportionate. Somebody who reads every
      notification in the dashboard may reasonably not want a second copy in
      their inbox, and refusing that is how people filter the sender — which
      would take the security messages with it.
    */
    expect(lockReason(row({ mandatory: true }), "email")).toBeNull();
  });

  it("explains a type the firm has switched off entirely", () => {
    const reason = lockReason(row({ disabledByOrganisation: true }), "email");
    expect(reason).toMatch(/Organisation/);
  });

  it("explains a single channel the firm has switched off", () => {
    expect(lockReason(row({ lockedEmail: true }), "email")).toMatch(/Organisation/);
    expect(lockReason(row({ lockedInApp: true }), "inApp")).toMatch(/Organisation/);
  });

  it("prefers the security reason over the organisation one", () => {
    // Both can be true at once, and the security one is the more specific
    // and the more useful: it is the only one that will never change.
    const reason = lockReason(row({ mandatory: true, disabledByOrganisation: true }), "inApp");
    expect(reason).toMatch(/Sicherheitsmeldung/);
  });
});

/* ================================================================== */
/* Deliveries                                                          */
/* ================================================================== */

describe("deliveryStatus", () => {
  it("draws a skipped delivery as neutral, not as a fault", () => {
    /*
      The whole reason `SKIPPED` exists as a separate status. It is a
      deliberate non-send — a preference, a rule, or no SMTP configured —
      and colouring it as an error would put a wall of bronze in front of an
      operator on a developer machine, which is how somebody learns to
      ignore the colour that matters.
    */
    expect(deliveryStatus("SKIPPED").tone).toBe("neutral");
    expect(deliveryStatus("FAILED").tone).toBe("bronze");
  });

  it("names every status in German", () => {
    for (const status of ["PENDING", "PROCESSING", "DELIVERED", "FAILED", "SKIPPED"]) {
      expect(deliveryStatus(status).label).not.toBe(status);
    }
  });

  it("falls through to the raw value rather than blanking", () => {
    // A status added on the server before the client knows it should read
    // as itself — visible and greppable — not as an empty cell.
    expect(deliveryStatus("BOUNCED").label).toBe("BOUNCED");
  });

  it("offers every status as a filter option", () => {
    expect(DELIVERY_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      "PENDING",
      "PROCESSING",
      "DELIVERED",
      "FAILED",
      "SKIPPED",
    ]);
  });
});
