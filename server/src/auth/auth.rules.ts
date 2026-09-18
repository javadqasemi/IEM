/**
 * The two sign-in decisions that are arithmetic rather than I/O: **how a failed
 * attempt moves the lockout**, and **what a presented refresh token means.**
 * Pure, and therefore the only part of authentication that can be tested
 * exhaustively.
 *
 * Both lived inline in `AuthService` as a handful of `if`s, and both were wrong
 * in the same way — not wrong about a case somebody forgot, but wrong about a
 * case that is invisible unless the decision is written down on its own:
 *
 * - A token that had merely been **rotated a moment ago** was indistinguishable
 *   from a stolen one being replayed, so an ordinary two-tab race was answered
 *   by revoking every session the account had.
 * - A lockout that had **already been served** still carried its count, so the
 *   first mistype after the wait locked the account again, and went on doing so
 *   for ever.
 *
 * Each is a function of a few columns and a clock — no database, no request, no
 * framework — which is what lets `auth.rules.test.ts` cover every branch and
 * every boundary.
 */

/**
 * How long after a rotation the *old* token may still be presented without
 * being treated as theft.
 *
 * It exists because rotation has a gap that no client can close on its own. The
 * server revokes `R0` and issues `R1` in one transaction, but `R1` reaches the
 * browser in a `Set-Cookie` on the response — and anything that was already in
 * flight when that response was written is still carrying `R0`. Two tabs
 * restoring a session in the same instant is the ordinary case; a response lost
 * on the way back is the other one, and there the client is *holding* a token
 * the server has already replaced through no fault of anybody's.
 *
 * Thirty seconds, and the number is chosen against both failures it has to
 * survive rather than picked round. The tab race is milliseconds — a lock in
 * `core/api/client.ts` now serialises it, and this is what covers the case that
 * lock cannot reach, a request whose reply never arrived and is retried by hand.
 * The ceiling is what keeps the detection worth having: a stolen token is
 * replayed at a time of the attacker's choosing, which is almost never inside
 * the half-minute after the victim's own browser last refreshed.
 *
 * **It does not weaken the alarm it sits in front of.** Outside this window the
 * family is still revoked on sight, and every use of the grace is audited, so an
 * operator reading the log sees a `auth.refresh_concurrent` burst rather than
 * nothing at all.
 */
export const REFRESH_GRACE_MS = 30_000;

/* ------------------------------------------------------------------ */
/* Lockout                                                             */
/* ------------------------------------------------------------------ */

/**
 * How long a failed-login streak locks an account, and at what count.
 *
 * Fifteen minutes after five attempts is slow enough to make online guessing
 * pointless and short enough that a person who mistyped their password twice
 * and then went to look it up is not calling support.
 */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

export type LockoutState = {
  failedLogins: number;
  lockedUntil: Date | null;
};

/** Whether a sign-in must be refused before the password is even checked. */
export function isLockedOut(state: LockoutState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/**
 * What the counter becomes after a wrong password.
 *
 * **An expired lockout is spent, and forgetting that was a real defect** — the
 * kind that is invisible in the code and unmistakable to the person it happens
 * to. The counter was only ever cleared by a *successful* sign-in, so an account
 * that had been locked once came back with `failedLogins` still at five: the
 * first mistype after the wait took it to six, six is still at or over the
 * threshold, and the account locked for another quarter of an hour. And again.
 * And again — for ever, until somebody happened to type it right first time.
 *
 * What it looked like from the outside was an account that locked "at random"
 * and stayed that way, which is exactly the report that gets filed as *"the
 * login is broken again"*. Clearing the streak when the penalty has been served
 * is what makes five attempts mean five attempts every time rather than only the
 * first time.
 */
export function afterFailedLogin(state: LockoutState, now: Date): LockoutState {
  const served = state.lockedUntil !== null && !isLockedOut(state, now);
  const failedLogins = (served ? 0 : state.failedLogins) + 1;
  return {
    failedLogins,
    lockedUntil:
      failedLogins >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCKOUT_MS) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Refresh                                                             */
/* ------------------------------------------------------------------ */

/** The three columns the decision reads, and nothing more. */
export type PresentedRefreshToken = {
  revokedAt: Date | null;
  expiresAt: Date;
  /**
   * The hash of the token that replaced this one, set only by rotation.
   *
   * Its **absence on a revoked row is load-bearing**: `logout`, `logout-all`,
   * a password change and a completed reset all revoke without writing one, so
   * a revoked row with no successor was ended on purpose by somebody. That is
   * not evidence of theft and must not raise the alarm as though it were — the
   * first version did, and signing out everywhere and then leaving a stale tab
   * to retry wrote `auth.refresh_reuse_detected` into the log, which is the row
   * an incident review would start from.
   */
  replacedById: string | null;
};

export type RefreshVerdict =
  /** Live and unrotated. Issue the next pair. */
  | "renew"
  /** Past `expiresAt`. The session is over; nothing is wrong. */
  | "expired"
  /** Rotated within the grace window. A race, not an attack — issue a pair. */
  | "concurrent"
  /** Revoked by a deliberate act. Refuse, and do not cry theft. */
  | "ended"
  /** Rotated long ago and presented again. Revoke the family. */
  | "replayed";

/**
 * Reads a presented token.
 *
 * Order matters and is the argument: revocation is checked before expiry,
 * because a token that was rotated and has *since* passed its expiry is still a
 * replay if somebody presents it, and reporting it as merely expired would hide
 * the one thing worth seeing.
 */
export function judgeRefresh(token: PresentedRefreshToken, now: Date): RefreshVerdict {
  if (token.revokedAt) {
    if (!token.replacedById) return "ended";
    const since = now.getTime() - token.revokedAt.getTime();
    // `since < 0` is a clock that moved backwards, not a token from the future.
    // Treating it as concurrent would hand out a session on a skewed clock, so
    // it falls through to the strict answer.
    return since >= 0 && since <= REFRESH_GRACE_MS ? "concurrent" : "replayed";
  }
  if (token.expiresAt.getTime() <= now.getTime()) return "expired";
  return "renew";
}
