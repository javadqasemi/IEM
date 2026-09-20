import { describe, expect, it } from "vitest";
import { describeDevice, refuseRevoke, toSessionViews } from "./sessions.rules";

/**
 * The two things a session list can get wrong without failing.
 *
 * It can **leak** — a `tokenHash` in a response body is a credential
 * equivalent, and nothing about shipping one looks wrong on screen. And it
 * can **mislabel the current session**, which matters because that is the row
 * whose revoke button behaves differently; getting it backwards means the
 * reader signs themselves out while trying to sign out a laptop they left at
 * home.
 */

const NOW = new Date("2026-09-20T10:00:00.000Z");

const row = (over: Partial<Parameters<typeof toSessionViews>[0][number]> = {}) => ({
  id: "s1",
  ip: "10.0.0.1",
  userAgent: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
  createdAt: new Date("2026-09-20T09:00:00.000Z"),
  expiresAt: new Date("2026-10-20T09:00:00.000Z"),
  tokenHash: "hash-1",
  ...over,
});

describe("describeDevice", () => {
  /**
   * Order is the whole correctness of the table.
   *
   * Edge announces itself as Chrome *and* as Edge; Chrome announces itself as
   * Safari. A table checked in the obvious order labels every Chrome session
   * "Safari", which is wrong on the majority of rows and looks deliberate.
   */
  it("prefers the most specific claim in a user agent that makes several", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0",
      ),
    ).toBe("Edge auf Windows");

    expect(
      describeDevice("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"),
    ).toBe("Chrome auf Windows");

    // Real Safari: no `Chrome/` token at all.
    expect(
      describeDevice("Mozilla/5.0 (Macintosh; Mac OS X 10_15_7) AppleWebKit/605.1 Safari/605.1"),
    ).toBe("Safari auf macOS");
  });

  it("names the platforms this office actually uses", () => {
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1")).toBe(
      "Safari auf iOS",
    );
    expect(describeDevice("Mozilla/5.0 (X11; Linux x86_64) Firefox/133.0")).toBe(
      "Firefox auf Linux",
    );
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14) Chrome/131.0")).toBe(
      "Chrome auf Android",
    );
  });

  it("says it does not know rather than guessing", () => {
    expect(describeDevice(null)).toBe("Unbekanntes Gerät");
    expect(describeDevice("   ")).toBe("Unbekanntes Gerät");
  });

  it("shows a prefix of something real it cannot classify", () => {
    // More use to somebody deciding whether to revoke than the word
    // "Unbekannt" — a health checker or a CLI is recognisable from its name.
    expect(describeDevice("curl/8.4.0")).toBe("curl/8.4.0");
  });

  it("truncates, so a hostile agent string cannot own the table cell", () => {
    const long = "x".repeat(500);
    expect(describeDevice(long).length).toBe(40);
  });
});

describe("toSessionViews", () => {
  it("never returns the token hash or anything derived from it", () => {
    /*
      The leak this file exists for. `tokenHash` is exactly what the server
      compares a presented cookie against, so a response carrying one hands
      out a credential equivalent — and the response would look completely
      normal.
    */
    const [view] = toSessionViews([row()], "hash-1", NOW);
    expect(Object.keys(view).sort()).toEqual([
      "current",
      "device",
      "expiresAt",
      "id",
      "ip",
      "lastActiveAt",
    ]);
    expect(JSON.stringify(view)).not.toContain("hash-1");
  });

  it("marks the caller's own session and no other", () => {
    const views = toSessionViews(
      [row({ id: "a", tokenHash: "hash-a" }), row({ id: "b", tokenHash: "hash-b" })],
      "hash-b",
      NOW,
    );
    expect(views.find((v) => v.id === "b")!.current).toBe(true);
    expect(views.find((v) => v.id === "a")!.current).toBe(false);
  });

  it("marks nothing current when the request carried no cookie", () => {
    // An access-token-only request genuinely has no session of its own here,
    // and guessing one would put the dangerous button on an arbitrary row.
    const views = toSessionViews([row({ tokenHash: "hash-a" })], null, NOW);
    expect(views.every((v) => !v.current)).toBe(true);
  });

  it("drops an expired row even though it was never revoked", () => {
    // Expiry is not revocation: nothing writes `revokedAt` when a token runs
    // out, so a query filtering only on that would list dead sessions for
    // thirty days and invite somebody to revoke what is already gone.
    const views = toSessionViews(
      [row({ id: "live" }), row({ id: "dead", expiresAt: new Date("2026-09-19T00:00:00.000Z") })],
      null,
      NOW,
    );
    expect(views.map((v) => v.id)).toEqual(["live"]);
  });

  it("puts the most recent activity first", () => {
    const views = toSessionViews(
      [
        row({ id: "old", createdAt: new Date("2026-09-18T08:00:00.000Z") }),
        row({ id: "new", createdAt: new Date("2026-09-20T09:30:00.000Z") }),
      ],
      null,
      NOW,
    );
    expect(views.map((v) => v.id)).toEqual(["new", "old"]);
  });

  it("reports the rotation as last activity, in ISO", () => {
    const [view] = toSessionViews([row()], null, NOW);
    expect(view.lastActiveAt).toBe("2026-09-20T09:00:00.000Z");
  });
});

describe("refuseRevoke", () => {
  it("allows a caller to end their own session, current or not", () => {
    // Signing yourself out of the device in front of you is a real thing to
    // want. The rule makes it deliberate rather than impossible; the
    // confirmation is the screen's job.
    expect(refuseRevoke({ id: "s1", userId: "u1" }, "u1")).toBeNull();
  });

  it("refuses somebody else's", () => {
    expect(refuseRevoke({ id: "s1", userId: "u2" }, "u1")).toMatch(/anderen Konto/);
  });

  it("refuses one that is not there", () => {
    // Already revoked, or never existed. The same answer either way: telling
    // the two apart would say whether a session id is real.
    expect(refuseRevoke(null, "u1")).toMatch(/gibt es nicht/);
  });
});
