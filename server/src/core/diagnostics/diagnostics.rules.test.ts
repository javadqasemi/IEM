import { describe, expect, it } from "vitest";
import {
  SLOW_CHECK_MS,
  overallResult,
  passOrSlow,
  rankOf,
  runCheck,
  type CheckResult,
  type DiagnosticCheck,
} from "./diagnostics.rules";

const RESULTS: CheckResult[] = ["PASS", "WARNING", "FAIL", "NOT_CONFIGURED"];

const check = (over: Partial<DiagnosticCheck> = {}): DiagnosticCheck => ({
  key: "x",
  label: "X",
  result: "PASS",
  durationMs: 1,
  detail: "ok",
  ...over,
});

describe("the run's verdict", () => {
  /**
   * The assertion this file exists for.
   *
   * A diagnostics page that checked nothing must not report the same green a
   * full pass does — that is the failure mode of every health page which
   * quietly stopped running its checks, and it is indistinguishable from
   * health right up until somebody needs it.
   */
  it("is a warning over no checks, never a pass", () => {
    expect(overallResult([])).toBe("WARNING");
  });

  it("is the single result when there is one", () => {
    for (const result of RESULTS) {
      expect(overallResult([check({ result })]), result).toBe(result);
    }
  });

  it("takes the worst, whatever the order", () => {
    expect(overallResult([check(), check({ result: "FAIL" })])).toBe("FAIL");
    expect(overallResult([check({ result: "FAIL" }), check()])).toBe("FAIL");
    expect(overallResult([check({ result: "WARNING" }), check({ result: "NOT_CONFIGURED" })])).toBe(
      "WARNING",
    );
  });

  it("is order-independent over every pair", () => {
    for (const a of RESULTS) {
      for (const b of RESULTS) {
        expect(overallResult([check({ result: a }), check({ result: b })]), `${a},${b}`).toBe(
          overallResult([check({ result: b }), check({ result: a })]),
        );
      }
    }
  });

  /**
   * A deliberate absence is not a fault. Ranking it above one would make an
   * installation that has consciously not enabled Redis report worse than one
   * whose database is struggling.
   */
  it("ranks a deliberate absence below a warning", () => {
    expect(rankOf("NOT_CONFIGURED")).toBeLessThan(rankOf("WARNING"));
    expect(rankOf("NOT_CONFIGURED")).toBeGreaterThan(rankOf("PASS"));
    expect(overallResult([check({ result: "NOT_CONFIGURED" }), check()])).toBe("NOT_CONFIGURED");
  });

  it("gives every result a distinct rank", () => {
    expect(new Set(RESULTS.map(rankOf)).size).toBe(RESULTS.length);
  });
});

describe("passOrSlow", () => {
  it("passes a quick check with its own words", () => {
    expect(passOrSlow(10, "schnell", "langsam")).toEqual({ result: "PASS", detail: "schnell" });
  });

  it("warns past the threshold rather than at it", () => {
    expect(passOrSlow(SLOW_CHECK_MS, "schnell", "langsam").result).toBe("PASS");
    expect(passOrSlow(SLOW_CHECK_MS + 1, "schnell", "langsam").result).toBe("WARNING");
  });
});

describe("runCheck", () => {
  it("records what the check returned, plus a duration", async () => {
    const out = await runCheck("db", "Datenbank", () => "x", async () => ({
      result: "PASS",
      detail: "gut",
    }));
    expect(out).toMatchObject({ key: "db", label: "Datenbank", result: "PASS", detail: "gut" });
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });

  /**
   * The containment that makes a diagnostics page useful at the moment it is
   * needed: one broken subsystem must produce one failing row, not a 500 over
   * seven passing ones.
   */
  it("turns a throw into a FAIL row rather than propagating it", async () => {
    const out = await runCheck("db", "Datenbank", () => "bereinigt", async () => {
      throw new Error("connect postgresql://user:hunter2@host/db refused");
    });
    expect(out.result).toBe("FAIL");
    expect(out.detail).toBe("bereinigt");
  });

  /**
   * The sanitizer is a required argument for this reason: what is caught here
   * is arbitrary, and a default would be a way to forget it.
   */
  it("never lets the raw error reach the row", async () => {
    const out = await runCheck("db", "Datenbank", (err) => `Fehler: ${String(err).slice(0, 5)}`, async () => {
      throw new Error("hunter2 should not appear");
    });
    expect(out.detail).not.toContain("hunter2");
  });

  it("still measures a check that failed", async () => {
    const out = await runCheck("x", "X", () => "x", async () => {
      await new Promise((r) => setTimeout(r, 5));
      throw new Error("nope");
    });
    expect(out.durationMs).toBeGreaterThanOrEqual(4);
  });
});
