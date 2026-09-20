import { describe, expect, it } from "vitest";
import type { SessionDto } from "../dto";
import { toSession, toSessions } from "../mapper";

/**
 * The seam, and the one ordering decision the screen depends on.
 *
 * Almost nothing happens in this mapper, which is correct: the server
 * decided what a session is called and which one is current, because both
 * need the `tokenHash` this side must never see. What is decided *here* is
 * where the current session appears, and that is a safety property rather
 * than a preference — see the note on `toSessions`.
 */

const dto = (over: Partial<SessionDto> = {}): SessionDto => ({
  id: "s1",
  device: "Chrome auf Windows",
  ip: "10.0.0.1",
  lastActiveAt: "2026-09-20T09:00:00.000Z",
  expiresAt: "2026-10-20T09:00:00.000Z",
  current: false,
  ...over,
});

describe("toSession", () => {
  it("parses both timestamps", () => {
    const session = toSession(dto());
    expect(session.lastActiveAt).toBeInstanceOf(Date);
    expect(session.expiresAt).toBeInstanceOf(Date);
    expect(session.lastActiveAt.toISOString()).toBe("2026-09-20T09:00:00.000Z");
  });

  it("keeps a null IP as null rather than inventing a dash", () => {
    // "—" is a *rendering* choice and belongs in the cell, not in the data:
    // a screen that wants to filter or copy the address needs to know the
    // difference between "not recorded" and the string "—".
    expect(toSession(dto({ ip: null })).ip).toBeNull();
  });

  it("carries `current` through untouched", () => {
    expect(toSession(dto({ current: true })).current).toBe(true);
  });
});

describe("toSessions", () => {
  /**
   * The current session is pinned first.
   *
   * Not cosmetic. It is the row a reader is looking for in order to *avoid*
   * it, and this office's sessions are mostly "Chrome auf Windows" from the
   * same office IP — so twenty near-identical rows with the dangerous one
   * somewhere in the middle is how somebody ends the session they are using.
   */
  it("puts the caller's own session first", () => {
    const rows = toSessions([
      dto({ id: "a" }),
      dto({ id: "b" }),
      dto({ id: "mine", current: true }),
    ]);
    expect(rows[0].id).toBe("mine");
  });

  it("leaves the rest in the order the server sent them", () => {
    // The server sorts by most recent activity, which is the right order for
    // the others — re-sorting here would be a second opinion that drifts.
    const rows = toSessions([
      dto({ id: "newest" }),
      dto({ id: "mine", current: true }),
      dto({ id: "older" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["mine", "newest", "older"]);
  });

  it("copes with no current session at all", () => {
    // An access-token-only caller presents no refresh cookie, so the server
    // marks nothing current. The list is still complete and still ordered.
    const rows = toSessions([dto({ id: "a" }), dto({ id: "b" })]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows.every((r) => !r.current)).toBe(true);
  });

  it("is empty for an empty list rather than throwing", () => {
    expect(toSessions([])).toEqual([]);
  });
});
