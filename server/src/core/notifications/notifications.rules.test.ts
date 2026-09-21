import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "../../rbac/permissions.catalog";
import {
  NOTIFICATION_TYPES,
  notificationDef,
  suppressesActor,
  type NotificationDef,
} from "./catalogue";
import {
  badgeCount,
  bellLabel,
  isLocked,
  notificationEventKey,
  resolveChannels,
  resolveRecipients,
} from "./notifications.rules";

/**
 * The platform's arithmetic, exhaustively.
 *
 * Every decision here is silent when it is wrong. A resolution order that
 * lets a preference beat an invariant does not throw — it stops telling
 * somebody their second factor was removed, and nothing anywhere reports
 * that. A recipient list that forgets to deduplicate sends two e-mails, which
 * nobody files a bug about and everybody notices.
 *
 * So the three that matter are asserted at their boundaries rather than in
 * the middle: **the invariant against both layers below it**, **dedupe
 * against every way a duplicate arrives**, and **the actor rule in both
 * directions**, because the exception to it is the entire security argument.
 */

const def = (over: Partial<NotificationDef> = {}): NotificationDef => ({
  key: "content.approved",
  category: "Inhalte",
  label: "Test",
  description: "Test",
  severity: "INFO",
  recipients: { kind: "explicit" },
  defaults: { inApp: true, email: false },
  mandatory: false,
  ...over,
});

const mandatory = () =>
  def({
    key: "security.mfa_disabled",
    category: "Sicherheit",
    severity: "WARNING",
    recipients: { kind: "subject" },
    defaults: { inApp: true, email: true },
    mandatory: true,
  });

/* ================================================================== */
/* Channel resolution                                                  */
/* ================================================================== */

describe("resolveChannels — nothing configured", () => {
  it("uses the catalogue's defaults", () => {
    expect(resolveChannels(def(), null, null)).toEqual({
      inApp: true,
      email: false,
      reason: null,
    });
  });

  it("says why when both defaults are off", () => {
    const quiet = def({ defaults: { inApp: false, email: false } });
    expect(resolveChannels(quiet, null, null)).toEqual({
      inApp: false,
      email: false,
      reason: "Für diese Art standardmässig aus.",
    });
  });
});

describe("resolveChannels — the organisation's layer", () => {
  it("switches a type off entirely", () => {
    const result = resolveChannels(def(), { enabled: false, inApp: true, email: true }, null);
    expect(result.inApp).toBe(false);
    expect(result.email).toBe(false);
    expect(result.reason).toBe("Von der Organisation deaktiviert.");
  });

  it("overrides a default channel in both directions", () => {
    // On where the catalogue says off…
    expect(
      resolveChannels(def(), { enabled: true, inApp: true, email: true }, null).email,
    ).toBe(true);
    // …and off where it says on.
    expect(
      resolveChannels(def(), { enabled: true, inApp: false, email: false }, null).inApp,
    ).toBe(false);
  });

  it("bounds the personal layer rather than being overridden by it", () => {
    /*
      The direction that matters. A person cannot switch *on* a channel the
      firm has switched off — the organisation sits above the individual —
      and getting this backwards would let anybody opt back into a channel
      the firm had decided to stop using.
    */
    const rule = { enabled: true, inApp: true, email: false };
    const preference = { inApp: true, email: true };
    expect(resolveChannels(def(), rule, preference).email).toBe(false);
  });
});

describe("resolveChannels — the person's layer", () => {
  it("turns a channel off", () => {
    const rule = { enabled: true, inApp: true, email: true };
    const result = resolveChannels(def(), rule, { inApp: false, email: true });
    expect(result.inApp).toBe(false);
    expect(result.email).toBe(true);
  });

  it("says who silenced it when both are off", () => {
    const rule = { enabled: true, inApp: true, email: true };
    const result = resolveChannels(def(), rule, { inApp: false, email: false });
    expect(result.reason).toBe("Vom Empfänger abbestellt.");
  });
});

describe("resolveChannels — the invariant, which nothing below may undo", () => {
  /*
    Four assertions for one rule, because the rule has four ways to be
    broken and each of them is a different line of the function.
  */
  it("keeps the in-app copy when the person switches it off", () => {
    const result = resolveChannels(mandatory(), null, { inApp: false, email: false });
    expect(result.inApp).toBe(true);
  });

  it("keeps it when the firm switches the channel off", () => {
    const result = resolveChannels(mandatory(), { enabled: true, inApp: false, email: true }, null);
    expect(result.inApp).toBe(true);
  });

  it("keeps it when the firm switches the whole type off", () => {
    /*
      The row this defends against cannot be written through the API — the
      service refuses it — but it can arrive from a migration or a hand-edit,
      which is exactly why the clamp is applied on **read**. Same argument as
      `clampPolicy`.
    */
    const result = resolveChannels(mandatory(), { enabled: false, inApp: false, email: false }, null);
    expect(result.inApp).toBe(true);
  });

  it("keeps it when both layers say no at once", () => {
    const result = resolveChannels(
      mandatory(),
      { enabled: false, inApp: false, email: false },
      { inApp: false, email: false },
    );
    expect(result.inApp).toBe(true);
  });

  it("still lets the e-mail copy be switched off", () => {
    // The half that stays configurable, and deliberately: somebody who reads
    // every notification in the dashboard may reasonably not want a second
    // copy, and refusing that is how people stop reading either.
    const result = resolveChannels(mandatory(), null, { inApp: true, email: false });
    expect(result).toEqual({ inApp: true, email: false, reason: null });
  });
});

describe("isLocked", () => {
  it("locks the in-app channel of a mandatory type and nothing else", () => {
    expect(isLocked(mandatory(), "inApp")).toBe(true);
    expect(isLocked(mandatory(), "email")).toBe(false);
    expect(isLocked(def(), "inApp")).toBe(false);
    expect(isLocked(def(), "email")).toBe(false);
  });
});

/* ================================================================== */
/* Recipients                                                          */
/* ================================================================== */

describe("resolveRecipients", () => {
  const alive = (id: string) => ({ id, active: true });

  it("deduplicates the same person arriving twice", () => {
    // Two roles both granting `content.approve` is the ordinary way this
    // happens, and two rows would be two e-mails.
    expect(resolveRecipients(def(), [alive("a"), alive("a"), alive("b")], null)).toEqual([
      "a",
      "b",
    ]);
  });

  it("drops suspended and deleted accounts", () => {
    const result = resolveRecipients(
      def(),
      [alive("a"), { id: "gone", active: false }],
      null,
    );
    expect(result).toEqual(["a"]);
  });

  it("removes the actor from an ordinary notification", () => {
    // Telling somebody what they just did is noise.
    expect(resolveRecipients(def(), [alive("a"), alive("b")], "a")).toEqual(["b"]);
  });

  it("keeps the actor on a security notification about their own account", () => {
    /*
      **The exception that is the whole point.**

      If somebody with your session disables your second factor, they *are*
      you as far as the system can tell. Suppressing the message because
      "the actor already knows" would suppress precisely the case the
      notification exists for.
    */
    expect(resolveRecipients(mandatory(), [alive("a")], "a")).toEqual(["a"]);
  });

  it("returns nothing when the only candidate was the actor", () => {
    expect(resolveRecipients(def(), [alive("a")], "a")).toEqual([]);
  });

  it("returns nothing for an empty candidate list", () => {
    expect(resolveRecipients(def(), [], null)).toEqual([]);
  });
});

describe("suppressesActor", () => {
  it("is false only for the subject strategy", () => {
    expect(suppressesActor(def({ recipients: { kind: "subject" } }))).toBe(false);
    expect(suppressesActor(def({ recipients: { kind: "explicit" } }))).toBe(true);
    expect(
      suppressesActor(def({ recipients: { kind: "permission", permission: "x" } })),
    ).toBe(true);
  });
});

/* ================================================================== */
/* Idempotency                                                         */
/* ================================================================== */

describe("notificationEventKey", () => {
  const base = {
    eventName: "ContentApproved",
    entity: "content_entry",
    entityId: "e1",
    correlationId: "c1",
  };

  it("is the same for the same event", () => {
    expect(notificationEventKey(base)).toBe(notificationEventKey({ ...base }));
  });

  it.each([
    ["eventName", { ...base, eventName: "ContentRejected" }],
    ["entity", { ...base, entity: "content_snapshot" }],
    ["entityId", { ...base, entityId: "e2" }],
    ["correlationId", { ...base, correlationId: "c2" }],
  ])("changes when %s changes", (_field, changed) => {
    expect(notificationEventKey(changed)).not.toBe(notificationEventKey(base));
  });

  it("separates two genuine occurrences by their request", () => {
    /*
      Submitting the same entry twice is two facts and the reader should see
      both. Leaving the correlation id out would collapse them for ever —
      a far worse failure than a duplicate, because it is silent and
      permanent.
    */
    const first = notificationEventKey({ ...base, correlationId: "req-1" });
    const second = notificationEventKey({ ...base, correlationId: "req-2" });
    expect(first).not.toBe(second);
  });

  it("does not contain the recipient", () => {
    // The recipient is the other half of the unique index, which is what
    // makes one fact reaching three people three rows rather than one.
    expect(notificationEventKey(base)).not.toContain("user");
  });
});

/* ================================================================== */
/* The bell                                                            */
/* ================================================================== */

describe("badgeCount", () => {
  it("is empty at zero, so the dot is not drawn", () => {
    expect(badgeCount(0)).toBe("");
    expect(badgeCount(-1)).toBe("");
  });

  it("counts up to ninety-nine and caps after it", () => {
    expect(badgeCount(1)).toBe("1");
    expect(badgeCount(99)).toBe("99");
    expect(badgeCount(100)).toBe("99+");
    expect(badgeCount(4_000)).toBe("99+");
  });
});

describe("bellLabel", () => {
  it("is a sentence, not a glyph", () => {
    // `99+` is useless to a screen reader, and so is a bare number with no
    // indication of what it counts.
    expect(bellLabel(0)).toBe("Benachrichtigungen — keine ungelesenen");
    expect(bellLabel(1)).toBe("Benachrichtigungen — 1 ungelesene");
    expect(bellLabel(120)).toBe("Benachrichtigungen — 120 ungelesene");
  });

  it("does not cap, unlike the badge", () => {
    // The visual cap exists because three digits do not fit in a dot. A
    // sentence has room, and "120" is more useful than "more than 99".
    expect(bellLabel(120)).toContain("120");
  });
});

/* ================================================================== */
/* The catalogue itself                                                */
/* ================================================================== */

describe("the catalogue", () => {
  it("has no duplicate keys", () => {
    const keys = NOTIFICATION_TYPES.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every type a label and a description somebody can decide from", () => {
    // The settings screen renders from these. A type with a thin description
    // is a switch an administrator flips without knowing what it does.
    for (const entry of NOTIFICATION_TYPES) {
      expect(entry.label.length, entry.key).toBeGreaterThan(5);
      expect(entry.description.length, entry.key).toBeGreaterThan(30);
    }
  });

  it("spells every key as category.event", () => {
    for (const entry of NOTIFICATION_TYPES) {
      expect(entry.key, entry.key).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it("makes every mandatory type default to both channels on", () => {
    /*
      `mandatory` binds the in-app channel, so a mandatory entry that
      defaulted in-app off would be a contradiction resolved silently on
      read. Defaulting e-mail on as well is the editorial half: these are the
      four you want to reach somebody who is not looking at the dashboard.
    */
    for (const entry of NOTIFICATION_TYPES.filter((d) => d.mandatory)) {
      expect(entry.defaults, entry.key).toEqual({ inApp: true, email: true });
    }
  });

  it("addresses every mandatory type to the person it is about", () => {
    // A security message about your account that went to a permission group
    // would tell everybody but you.
    for (const entry of NOTIFICATION_TYPES.filter((d) => d.mandatory)) {
      expect(entry.recipients.kind, entry.key).toBe("subject");
    }
  });

  it("names a real permission on every permission strategy", () => {
    // Not the catalogue's own list — the RBAC one, so a renamed permission
    // fails here rather than resolving to nobody at run time.
    for (const entry of NOTIFICATION_TYPES) {
      if (entry.recipients.kind !== "permission") continue;
      expect(PERMISSION_KEYS as string[], entry.key).toContain(entry.recipients.permission);
    }
  });

  it("resolves a def for every key and null for anything else", () => {
    for (const entry of NOTIFICATION_TYPES) {
      expect(notificationDef(entry.key)).toBe(entry);
    }
    expect(notificationDef("does.not_exist")).toBeNull();
  });
});
