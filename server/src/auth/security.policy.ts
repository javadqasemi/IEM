/**
 * Where each security number lives, and why it lives there.
 *
 * The roadmap said "lockout threshold, lockout duration and password length
 * are constants in `auth.rules.ts`, so an incident cannot be responded to
 * without a deploy". True — and the obvious repair, moving all three into the
 * settings table, is wrong in a way that is worth writing down: it turns
 * every security property into something an operator can switch off, and an
 * attacker who reaches a Super Admin session can then switch them off before
 * doing anything else.
 *
 * So the numbers are sorted into four kinds, and only one of them is
 * configurable from a form.
 *
 * ---
 *
 * ## 1. Invariants — compile time, never configurable
 *
 * Properties the system's correctness rests on. Changing one is a code change
 * with a review, because the reasoning behind it does not fit in a help text.
 *
 * | | |
 * | --- | --- |
 * | `REFRESH_GRACE_MS` | Thirty seconds, chosen against two specific failures. Widening it widens the window in which a stolen token is indistinguishable from a tab race; it is the *detector's* tolerance, not a preference. |
 * | `PASSWORD_MAX_LENGTH` | A denial-of-service guard on Argon2, not a policy. |
 * | `PASSWORD_FLOOR` | The shortest password the system will ever accept, whatever the policy says. |
 * | `OBVIOUS_PASSWORDS` | A safety net. Editable, it would be emptied. |
 * | Rotation on use, family revocation, deny-by-default | Structural. |
 * | The `@Throttle` limits | Rate limits are the control that survives everything else failing. |
 *
 * ## 2. Environment — deployment topology and secrets
 *
 * `JWT_ACCESS_SECRET`, `REFRESH_TTL_DAYS`, `CORS_ORIGINS`, `REDIS_URL`,
 * `SMTP_*`, `STORAGE_DRIVER`. These belong to the *deployment*, not to the
 * firm, and several are secrets. **None of them is ever readable or writable
 * through the API** — a settings screen that can print `JWT_ACCESS_SECRET` is
 * a settings screen that has already lost.
 *
 * ## 3. Organisation policy — Super Admin, validated, audited
 *
 * The handful of numbers a firm legitimately sets for itself, and the only
 * kind this file makes configurable. Every one is **bounded so that it can
 * only tighten an invariant, never loosen it** — see `resolvePasswordPolicy`,
 * where the configured minimum is clamped up to `PASSWORD_FLOOR` and cannot
 * go below it however the row is edited or however it got into the database.
 *
 * ## 4. User settings — the person's own
 *
 * Their password, their sessions, their MFA enrolment. Not in this file; they
 * are operations on a user, not configuration of the system.
 *
 * ---
 *
 * ## Where the second factor's numbers went, and the one that is missing
 *
 * P2-2 added seven and every one of them is an **invariant**, declared in
 * `mfa.rules.ts` rather than here: the TOTP algorithm, digit count and period
 * are interoperability constraints (an authenticator that shows a code the
 * server rejects is indistinguishable from a broken enrolment); the drift
 * window is a *detector's* tolerance in the same sense `REFRESH_GRACE_MS` is;
 * and the enrolment lifetime, the challenge lifetime and the per-challenge
 * attempt ceiling are brute-force bounds. None of the seven is a preference,
 * and a form that could widen the drift window to ten minutes would be a form
 * that can switch the factor off without saying so.
 *
 * `MFA_ENCRYPTION_KEY` is **environment** — a secret belonging to the
 * deployment, never readable or writable through the API.
 *
 * **What is deliberately not here is an organisation policy**, and the
 * omission is the interesting part. The obvious third-category setting is
 * `security.mfaRequirement` — *optional* / *required for privileged roles* /
 * *required for everyone* — and it is not implemented because the enforcement
 * it promises does not exist yet. Making it *true* means refusing a session to
 * somebody who has not enrolled, which means a **forced-enrolment flow** at
 * sign-in: a screen that appears instead of the dashboard, that cannot be
 * skipped, and that has to survive an account whose authenticator is broken
 * without locking the firm out of its own system.
 *
 * Shipping the setting without that flow would produce a row saying "MFA is
 * required for everyone" while everyone without it carries on signing in — a
 * security property an operator can read, believe, and not have. That is
 * precisely the failure this file was written against, so it waits for the
 * flow rather than arriving before it (`docs/ENTERPRISE_ROADMAP.md` → P2-2b).
 *
 * Nothing in the MFA module has to change to add it. The seam is
 * `AuthService.login`, which already branches on `MfaService.requiresFactor`
 * and already has a shape for "the password was right and you are not signed
 * in yet".
 *
 * ---
 *
 * **The rule that makes the third kind safe: a policy may tighten an
 * invariant and may not loosen it.** That is what lets the lockout threshold
 * be answerable to an incident without letting it be answerable to an
 * attacker, and it is enforced here rather than in a validator, because a
 * validator guards the API and this guards the *read* — including a row
 * written by a migration, by hand, or by a release before the bound existed.
 */

/* ================================================================== */
/* 1. Invariants                                                       */
/* ================================================================== */

/**
 * The shortest password the system accepts, whatever the organisation policy
 * says.
 *
 * Twelve characters with no composition rules produces better passwords than
 * eight with four character classes — the second reliably yields
 * `Passwort1!`. A policy may raise this; nothing can lower it.
 */
export const PASSWORD_FLOOR = 12;

/** A denial-of-service guard on Argon2, not a policy. */
export const PASSWORD_MAX_LENGTH = 256;

/* ================================================================== */
/* 3. Organisation policy                                              */
/* ================================================================== */

/**
 * The bounds each configurable number is clamped to on read.
 *
 * Stated as data so the settings catalogue, the resolver and the tests all
 * read the same numbers. The **lower** bound of each is the security-relevant
 * end: it is what an operator cannot go below.
 */
export const POLICY_BOUNDS = {
  /** Access-token lifetime. Short is safer; four hours is the indulgent end. */
  sessionTimeoutMinutes: { min: 1, max: 240, fallback: 15 },
  /**
   * Failed sign-ins before an account locks.
   *
   * Three is tight enough to annoy a legitimate typist; ten is where online
   * guessing starts to be worth an attacker's time. Below three the support
   * cost exceeds the benefit, which is why the floor is a floor and not a
   * warning.
   */
  maxFailedLogins: { min: 3, max: 10, fallback: 5 },
  /**
   * How long that lock lasts.
   *
   * Five minutes is the shortest that still makes guessing pointless; a day
   * is the longest that is a lockout rather than a deactivation.
   */
  lockoutMinutes: { min: 5, max: 1440, fallback: 15 },
  /** Minimum password length. Clamped **up** to `PASSWORD_FLOOR`. */
  passwordMinLength: { min: PASSWORD_FLOOR, max: 128, fallback: PASSWORD_FLOOR },
} as const;

export type PolicyKey = keyof typeof POLICY_BOUNDS;

/** The settings key each bound is stored under. */
export const POLICY_SETTING_KEYS: Record<PolicyKey, string> = {
  sessionTimeoutMinutes: "security.sessionTimeoutMinutes",
  maxFailedLogins: "security.maxFailedLogins",
  lockoutMinutes: "security.lockoutMinutes",
  passwordMinLength: "security.passwordMinLength",
};

/**
 * One configured number, clamped into its bounds.
 *
 * Anything that is not a finite number falls back — a `null`, a string left
 * by an older release, a `NaN`. The clamp is deliberately applied on **read**
 * rather than trusted from the write path: `settings.rules.ts` refuses a bad
 * value through the API, and this covers every other way a row can come to
 * hold one.
 */
export function clampPolicy(key: PolicyKey, value: unknown): number {
  const { min, max, fallback } = POLICY_BOUNDS[key];

  /*
    `Number(x)` is not the coercion to reach for here, and a test caught why:
    `Number(null)`, `Number("")` and `Number([])` are all **0**, which is
    finite — so an unset row resolved to the *minimum* rather than to the
    documented fallback. That failed safe for every key (the minimum is the
    strict end) and was still wrong: an operator who cleared the session
    timeout would have got one-minute sessions rather than the default
    fifteen, and nothing would have said so.

    Only a real number, or a string that actually contains one, counts.
  */
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export type LockoutPolicy = { maxFailedLogins: number; lockoutMs: number };

export function resolveLockoutPolicy(raw: {
  maxFailedLogins?: unknown;
  lockoutMinutes?: unknown;
}): LockoutPolicy {
  return {
    maxFailedLogins: clampPolicy("maxFailedLogins", raw.maxFailedLogins),
    lockoutMs: clampPolicy("lockoutMinutes", raw.lockoutMinutes) * 60_000,
  };
}

export type PasswordPolicy = { minLength: number; maxLength: number };

/**
 * The password policy, which **cannot be weakened below the invariant**.
 *
 * `clampPolicy` bounds the configured value at `PASSWORD_FLOOR` on the low
 * side, so a row saying `4` resolves to `12` rather than to `4`. That is the
 * whole point of the split: the number is answerable to the firm upwards and
 * to nobody downwards.
 */
export function resolvePasswordPolicy(raw: { passwordMinLength?: unknown }): PasswordPolicy {
  return {
    minLength: clampPolicy("passwordMinLength", raw.passwordMinLength),
    maxLength: PASSWORD_MAX_LENGTH,
  };
}
