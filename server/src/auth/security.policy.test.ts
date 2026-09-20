import { describe, expect, it } from "vitest";
import {
  PASSWORD_FLOOR,
  PASSWORD_MAX_LENGTH,
  POLICY_BOUNDS,
  POLICY_SETTING_KEYS,
  clampPolicy,
  resolveLockoutPolicy,
  resolvePasswordPolicy,
} from "./security.policy";
import { DANGEROUS_SETTINGS, DEFAULT_SETTINGS } from "../core/settings/settings.service";

/**
 * The rule that makes a configurable security number safe: **a policy may
 * tighten an invariant and may not loosen it.**
 *
 * Everything below is one of two questions. Does a value out of bounds resolve
 * to something safe rather than to itself, and does the catalogue an operator
 * edits agree with the resolver that reads it? The second matters because the
 * two are enforced in different places for different reasons —
 * `settings.rules.ts` refuses a bad value at the API, and `clampPolicy` covers
 * every other way a row can come to hold one: a migration, a hand-edit in
 * psql, a release from before the bound existed.
 */

describe("clampPolicy", () => {
  it.each(Object.keys(POLICY_BOUNDS) as (keyof typeof POLICY_BOUNDS)[])(
    "%s falls back when the value is not a number",
    (key) => {
      const { fallback } = POLICY_BOUNDS[key];
      for (const junk of [null, undefined, "", "bald", Number.NaN, {}, []]) {
        expect(clampPolicy(key, junk), `${key} ← ${JSON.stringify(junk)}`).toBe(fallback);
      }
    },
  );

  it.each(Object.keys(POLICY_BOUNDS) as (keyof typeof POLICY_BOUNDS)[])(
    "%s never resolves outside its bounds",
    (key) => {
      const { min, max } = POLICY_BOUNDS[key];
      for (const value of [-1e9, -1, 0, min - 1, min, max, max + 1, 1e9]) {
        const resolved = clampPolicy(key, value);
        expect(resolved, `${key} ← ${value}`).toBeGreaterThanOrEqual(min);
        expect(resolved, `${key} ← ${value}`).toBeLessThanOrEqual(max);
      }
    },
  );

  it("rounds, so a fractional row cannot produce a fractional threshold", () => {
    // "4.6 failed attempts" is not a thing a comparison should be made against.
    expect(clampPolicy("maxFailedLogins", 4.6)).toBe(5);
  });
});

describe("the password policy cannot be weakened", () => {
  /**
   * The assertion the whole split exists for.
   *
   * An operator — or an attacker holding a Super Admin session — setting the
   * minimum to 4 must not get 4. Tightening is allowed; loosening is not.
   */
  it("clamps a shorter configured minimum up to the floor", () => {
    for (const weak of [1, 4, 8, 11, 0, -20]) {
      expect(resolvePasswordPolicy({ passwordMinLength: weak }).minLength).toBe(PASSWORD_FLOOR);
    }
  });

  it("honours a stricter one", () => {
    expect(resolvePasswordPolicy({ passwordMinLength: 20 }).minLength).toBe(20);
  });

  it("caps the maximum as an invariant, not a setting", () => {
    // The ceiling is an Argon2 denial-of-service guard rather than a policy,
    // so there is no key for it and nothing can move it.
    expect(resolvePasswordPolicy({ passwordMinLength: 999 }).maxLength).toBe(PASSWORD_MAX_LENGTH);
    expect(resolvePasswordPolicy({}).maxLength).toBe(PASSWORD_MAX_LENGTH);
  });

  it("falls back to the floor when nothing is configured", () => {
    expect(resolvePasswordPolicy({}).minLength).toBe(PASSWORD_FLOOR);
  });
});

describe("the lockout policy", () => {
  it("converts minutes to milliseconds", () => {
    expect(resolveLockoutPolicy({ maxFailedLogins: 5, lockoutMinutes: 15 })).toEqual({
      maxFailedLogins: 5,
      lockoutMs: 15 * 60_000,
    });
  });

  it("refuses to disable itself", () => {
    /*
      The direction that matters. `0` attempts would lock everybody out
      immediately and `0` minutes would make the lock expire before it was
      written — either way the brake is gone, and an unbounded read is how a
      single bad row turns into no lockout at all.
    */
    const off = resolveLockoutPolicy({ maxFailedLogins: 0, lockoutMinutes: 0 });
    expect(off.maxFailedLogins).toBe(POLICY_BOUNDS.maxFailedLogins.min);
    expect(off.lockoutMs).toBe(POLICY_BOUNDS.lockoutMinutes.min * 60_000);
  });

  it("falls back to the documented defaults when nothing is configured", () => {
    expect(resolveLockoutPolicy({})).toEqual({
      maxFailedLogins: POLICY_BOUNDS.maxFailedLogins.fallback,
      lockoutMs: POLICY_BOUNDS.lockoutMinutes.fallback * 60_000,
    });
  });
});

/**
 * The catalogue and the resolver are two declarations of one policy.
 *
 * They are separate on purpose — the catalogue is what an operator edits and
 * the resolver is what the server trusts — but they must not disagree, or the
 * form accepts a value the server silently overrides and the screen becomes a
 * lie.
 */
describe("the settings catalogue agrees with the bounds", () => {
  const byKey = new Map(DEFAULT_SETTINGS.map((s) => [s.key, s]));

  it.each(Object.entries(POLICY_SETTING_KEYS))("%s is declared as a setting", (_policy, key) => {
    expect(byKey.get(key), `${key} is resolved but never declared`).toBeTruthy();
  });

  it.each(Object.entries(POLICY_SETTING_KEYS))(
    "%s declares the same bounds the resolver clamps to",
    (policy, key) => {
      const setting = byKey.get(key)!;
      const bounds = POLICY_BOUNDS[policy as keyof typeof POLICY_BOUNDS];
      expect(setting.type).toBe("number");
      expect(setting.min, `${key} min`).toBe(bounds.min);
      expect(setting.max, `${key} max`).toBe(bounds.max);
    },
  );

  it.each(Object.entries(POLICY_SETTING_KEYS))(
    "%s ships a default the resolver leaves alone",
    (policy, key) => {
      // A seeded default that the clamp would move is a fresh install whose
      // stored value and effective value differ from the first day.
      const setting = byKey.get(key)!;
      expect(clampPolicy(policy as keyof typeof POLICY_BOUNDS, setting.value)).toBe(setting.value);
    },
  );

  it("warns before each of them is weakened", () => {
    // Every one of these makes the system easier to attack when it moves the
    // wrong way, so each carries a `dangerous` note the screen confirms on.
    for (const key of Object.values(POLICY_SETTING_KEYS)) {
      expect(DANGEROUS_SETTINGS[key], `${key} has no confirmation text`).toBeTruthy();
    }
  });
});
