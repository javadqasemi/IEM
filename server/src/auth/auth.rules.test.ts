import { describe, expect, it } from "vitest";
import {
  LOCKOUT_MS,
  MAX_FAILED_LOGINS,
  REFRESH_GRACE_MS,
  afterFailedLogin,
  isLockedOut,
  judgeRefresh,
  type PresentedRefreshToken,
} from "./auth.rules";

/**
 * The refresh decision, exhaustively — which is possible only because it is
 * pure.
 *
 * Every branch here stood for a real failure. The two that matter most are the
 * pair the old inline version could not tell apart: a token rotated a moment ago
 * by a second tab, and the same token replayed by somebody who stole it. One of
 * those must be served and the other must end every session the account has, and
 * getting it wrong in either direction is serious — the first way signs
 * legitimate users out at random, the second way leaves a thief signed in.
 */

const NOW = new Date("2026-09-18T12:00:00.000Z");

/** A live token, which each test then breaks in exactly one way. */
function token(overrides: Partial<PresentedRefreshToken> = {}): PresentedRefreshToken {
  return {
    revokedAt: null,
    expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
    replacedById: null,
    ...overrides,
  };
}

/** `ms` before `NOW`. */
function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe("isLockedOut", () => {
  it("is false for an account that has never been locked", () => {
    expect(isLockedOut({ failedLogins: 0, lockedUntil: null }, NOW)).toBe(false);
  });

  it("is true while the lockout is running", () => {
    expect(
      isLockedOut({ failedLogins: 5, lockedUntil: new Date(NOW.getTime() + 1) }, NOW),
    ).toBe(true);
  });

  it("is false at the instant it expires", () => {
    expect(isLockedOut({ failedLogins: 5, lockedUntil: NOW }, NOW)).toBe(false);
  });
});

describe("afterFailedLogin", () => {
  it("counts up without locking below the threshold", () => {
    const next = afterFailedLogin({ failedLogins: 0, lockedUntil: null }, NOW);
    expect(next).toEqual({ failedLogins: 1, lockedUntil: null });
  });

  it("locks on the attempt that reaches the threshold", () => {
    const next = afterFailedLogin({ failedLogins: MAX_FAILED_LOGINS - 1, lockedUntil: null }, NOW);
    expect(next.failedLogins).toBe(MAX_FAILED_LOGINS);
    expect(next.lockedUntil).toEqual(new Date(NOW.getTime() + LOCKOUT_MS));
  });

  /**
   * **The defect.**
   *
   * The counter was cleared only by a *successful* sign-in, so an account that
   * had been locked once came back holding five. One mistype took it to six,
   * six is still over the threshold, and it locked for another quarter of an
   * hour — for ever, until somebody happened to type the password right first
   * time. The symptom was an account that "locks at random and stays locked".
   */
  it("starts the streak again once the lockout has been served", () => {
    const served = { failedLogins: MAX_FAILED_LOGINS, lockedUntil: ago(1) };
    const next = afterFailedLogin(served, NOW);

    expect(next.failedLogins, "a served lockout must not carry its count forward").toBe(1);
    expect(next.lockedUntil, "one mistype after the wait must not lock the account again").toBeNull();
  });

  it("gives the full quota again after a served lockout", () => {
    // Four more mistypes are allowed before the next lock, not zero.
    let state = afterFailedLogin({ failedLogins: MAX_FAILED_LOGINS, lockedUntil: ago(1) }, NOW);
    for (let i = 1; i < MAX_FAILED_LOGINS - 1; i++) {
      expect(state.lockedUntil).toBeNull();
      state = afterFailedLogin(state, NOW);
    }
    expect(state.failedLogins).toBe(MAX_FAILED_LOGINS - 1);
    expect(state.lockedUntil).toBeNull();

    expect(afterFailedLogin(state, NOW).lockedUntil).not.toBeNull();
  });

  /**
   * A failure *during* a lockout still counts.
   *
   * It is not reachable through `login`, which refuses before checking the
   * password — but the rule has to be right on its own, and extending the
   * penalty of somebody still serving it is the safe direction.
   */
  it("keeps counting while a lockout is still running", () => {
    const running = { failedLogins: MAX_FAILED_LOGINS, lockedUntil: new Date(NOW.getTime() + 60_000) };
    const next = afterFailedLogin(running, NOW);
    expect(next.failedLogins).toBe(MAX_FAILED_LOGINS + 1);
    expect(next.lockedUntil).toEqual(new Date(NOW.getTime() + LOCKOUT_MS));
  });
});

/**
 * The window itself, pinned.
 *
 * Every other assertion in this file is written against `REFRESH_GRACE_MS`
 * rather than against thirty seconds, which keeps them honest when the number is
 * tuned — and would keep them green if somebody set it to a day. That is the one
 * change here that would silently disable replay detection altogether, so the
 * bound is asserted rather than left to the comment.
 */
it("keeps the grace window short enough for the detection to mean anything", () => {
  expect(REFRESH_GRACE_MS).toBeGreaterThan(0);
  expect(REFRESH_GRACE_MS).toBeLessThanOrEqual(60_000);
});

describe("judgeRefresh", () => {
  it("renews a live, unrotated token", () => {
    expect(judgeRefresh(token(), NOW)).toBe("renew");
  });

  it("renews with one millisecond left", () => {
    expect(judgeRefresh(token({ expiresAt: new Date(NOW.getTime() + 1) }), NOW)).toBe("renew");
  });

  it("treats the expiry instant itself as expired", () => {
    // `<=`, not `<`: a token whose expiry is exactly now has no validity left,
    // and the pair of assertions is what stops that boundary drifting.
    expect(judgeRefresh(token({ expiresAt: NOW }), NOW)).toBe("expired");
  });

  it("expires a token past its expiry", () => {
    expect(judgeRefresh(token({ expiresAt: ago(1) }), NOW)).toBe("expired");
  });

  describe("a revoked token", () => {
    it("is a race when it was rotated just now", () => {
      expect(
        judgeRefresh(token({ revokedAt: ago(5), replacedById: "hash-of-successor" }), NOW),
      ).toBe("concurrent");
    });

    it("is still a race at the last millisecond of the grace window", () => {
      expect(
        judgeRefresh(
          token({ revokedAt: ago(REFRESH_GRACE_MS), replacedById: "hash-of-successor" }),
          NOW,
        ),
      ).toBe("concurrent");
    });

    it("is a replay one millisecond after the window closes", () => {
      expect(
        judgeRefresh(
          token({ revokedAt: ago(REFRESH_GRACE_MS + 1), replacedById: "hash-of-successor" }),
          NOW,
        ),
      ).toBe("replayed");
    });

    it("is a replay when it was rotated long ago", () => {
      expect(
        judgeRefresh(
          token({ revokedAt: ago(6 * 60 * 60 * 1000), replacedById: "hash-of-successor" }),
          NOW,
        ),
      ).toBe("replayed");
    });

    /**
     * The distinction the audit log depends on.
     *
     * Only rotation writes `replacedById`. A revoked row without one was ended
     * by a person — `logout`, `logout-all`, a password change, a completed
     * reset — so presenting it is a stale tab, not a stolen credential. Calling
     * that theft put `auth.refresh_reuse_detected` in the log for the most
     * ordinary act there is, which is precisely the row an incident review
     * would start from.
     */
    it("is a deliberate end when nothing replaced it", () => {
      expect(judgeRefresh(token({ revokedAt: ago(5), replacedById: null }), NOW)).toBe("ended");
    });

    it("is a deliberate end however long ago it was revoked", () => {
      expect(
        judgeRefresh(token({ revokedAt: ago(90 * 24 * 60 * 60 * 1000), replacedById: null }), NOW),
      ).toBe("ended");
    });

    /**
     * Revocation is read before expiry, deliberately.
     *
     * A rotated token that has since passed its own expiry is still a replay
     * when somebody presents it. Reporting it as merely expired would drop the
     * one fact worth seeing, and it is reachable: refresh tokens live thirty
     * days, so a copy taken early in a session outlives the session itself.
     */
    it("reports a replay rather than an expiry when it is both", () => {
      expect(
        judgeRefresh(
          token({
            revokedAt: ago(6 * 60 * 60 * 1000),
            expiresAt: ago(60 * 60 * 1000),
            replacedById: "hash-of-successor",
          }),
          NOW,
        ),
      ).toBe("replayed");
    });
  });

  /**
   * A clock that moved backwards must not open the window.
   *
   * `revokedAt` in the future makes the elapsed time negative, and a plain
   * `since <= GRACE` would read that as "rotated no time ago at all" and serve
   * a token to anybody holding it. The strict answer is the safe one.
   */
  it("refuses a rotation stamped in the future", () => {
    expect(
      judgeRefresh(
        token({ revokedAt: new Date(NOW.getTime() + 1_000), replacedById: "hash-of-successor" }),
        NOW,
      ),
    ).toBe("replayed");
  });
});

/**
 * The lockout numbers are the organisation's, and the rule still holds.
 *
 * `afterFailedLogin` takes a resolved policy rather than reading the
 * constants it used to, which is what let `security.policy.ts` make the
 * threshold answerable to an incident without making it answerable to an
 * attacker. These are the two things that could have broken in the move: the
 * default has to stay what it was, and a supplied policy has to be the one
 * that decides.
 */
describe("afterFailedLogin honours a configured policy", () => {
  const tighter = { maxFailedLogins: 3, lockoutMs: 5 * 60_000 };

  it("locks at the configured threshold rather than the default", () => {
    const next = afterFailedLogin({ failedLogins: 2, lockedUntil: null }, NOW, tighter);
    expect(next.failedLogins).toBe(3);
    expect(next.lockedUntil).toEqual(new Date(NOW.getTime() + tighter.lockoutMs));
  });

  it("does not lock below it", () => {
    const next = afterFailedLogin({ failedLogins: 1, lockedUntil: null }, NOW, tighter);
    expect(next.lockedUntil).toBeNull();
  });

  it("locks for the configured duration", () => {
    const longer = { maxFailedLogins: 5, lockoutMs: 60 * 60_000 };
    const next = afterFailedLogin({ failedLogins: 4, lockedUntil: null }, NOW, longer);
    expect(next.lockedUntil).toEqual(new Date(NOW.getTime() + longer.lockoutMs));
  });

  it("still behaves exactly as before when no policy is given", () => {
    // The default has to remain five attempts and fifteen minutes, or the
    // parameterisation quietly changed the product while refactoring it.
    const next = afterFailedLogin({ failedLogins: 4, lockedUntil: null }, NOW);
    expect(next.failedLogins).toBe(5);
    expect(next.lockedUntil).toEqual(new Date(NOW.getTime() + 15 * 60_000));
  });

  it("restarts a served streak against the configured threshold too", () => {
    // The bug this function exists for, re-checked on the configurable path:
    // an expired lockout must not carry its count forward.
    const served = { failedLogins: 3, lockedUntil: new Date(NOW.getTime() - 1_000) };
    const next = afterFailedLogin(served, NOW, tighter);
    expect(next.failedLogins).toBe(1);
    expect(next.lockedUntil).toBeNull();
  });
});
