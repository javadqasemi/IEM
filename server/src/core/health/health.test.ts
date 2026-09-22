import { describe, expect, it } from "vitest";
import {
  HEALTH_STATES,
  type HealthSubject,
  daysSince,
  overallHealth,
  severityOf,
  worstOf,
} from "./health";

/**
 * The health vocabulary, asserted over every value.
 *
 * Five states is few enough to test exhaustively, and exhaustive is what this
 * needs to be: the whole reason the file exists is that four copies of the
 * union agreed by coincidence rather than by anything checking.
 */

const subject = (over: Partial<HealthSubject> = {}): HealthSubject => ({
  key: "x",
  label: "X",
  state: "healthy",
  reasons: [],
  link: null,
  ...over,
});

describe("the state vocabulary", () => {
  it("has exactly the five values, and no sixth has crept in", () => {
    expect([...HEALTH_STATES].sort()).toEqual(
      ["critical", "healthy", "not_configured", "unknown", "warning"].sort(),
    );
  });

  it("gives every state a distinct severity", () => {
    const ranks = HEALTH_STATES.map(severityOf);
    expect(new Set(ranks).size, "two states share a rank, so worstOf is ambiguous").toBe(
      HEALTH_STATES.length,
    );
  });

  it("ranks healthy lowest and critical highest", () => {
    for (const s of HEALTH_STATES) {
      if (s === "healthy") continue;
      expect(severityOf(s), s).toBeGreaterThan(severityOf("healthy"));
      if (s === "critical") continue;
      expect(severityOf(s), s).toBeLessThan(severityOf("critical"));
    }
  });

  /**
   * The ordering decision written up in the source, asserted so that reversing
   * it is a failing test rather than a judgement call somebody re-makes.
   */
  it("ranks a deliberate absence below an unproven configuration", () => {
    expect(severityOf("not_configured")).toBeLessThan(severityOf("unknown"));
  });
});

describe("worstOf", () => {
  it("returns unknown for nothing, never healthy", () => {
    // A system reporting on no subsystems has not established that anything
    // works. `healthy` there would be the most confident possible lie.
    expect(worstOf([])).toBe("unknown");
  });

  it("returns the single state when there is one", () => {
    for (const s of HEALTH_STATES) expect(worstOf([s]), s).toBe(s);
  });

  it("picks the worst, whatever the order", () => {
    expect(worstOf(["healthy", "critical", "warning"])).toBe("critical");
    expect(worstOf(["critical", "healthy"])).toBe("critical");
    expect(worstOf(["healthy", "warning", "unknown"])).toBe("warning");
    expect(worstOf(["healthy", "not_configured"])).toBe("not_configured");
    expect(worstOf(["healthy", "healthy"])).toBe("healthy");
  });

  it("is order-independent over every pair", () => {
    for (const a of HEALTH_STATES) {
      for (const b of HEALTH_STATES) {
        expect(worstOf([a, b]), `${a},${b}`).toBe(worstOf([b, a]));
      }
    }
  });
});

describe("overallHealth", () => {
  it("prefixes each reason with its subject, so a detached banner still reads", () => {
    const report = overallHealth([
      subject({ key: "jobs", label: "Aufgaben", state: "warning", reasons: ["1 Aufgabe aufgegeben"] }),
      subject({ key: "mail", label: "E-Mail", state: "healthy", reasons: [] }),
    ]);
    expect(report.state).toBe("warning");
    expect(report.reasons).toEqual(["Aufgaben: 1 Aufgabe aufgegeben"]);
  });

  /**
   * A healthy subject carrying a reason would put a sentence under a green
   * badge with nothing to do about it.
   */
  it("ignores reasons on a healthy subject", () => {
    const report = overallHealth([
      subject({ state: "healthy", reasons: ["sollte nicht erscheinen"] }),
    ]);
    expect(report.reasons).toEqual([]);
  });

  it("reports unknown over no subjects", () => {
    expect(overallHealth([]).state).toBe("unknown");
    expect(overallHealth([]).reasons).toEqual([]);
  });

  it("collects reasons from every unhealthy subject", () => {
    const report = overallHealth([
      subject({ key: "a", label: "A", state: "critical", reasons: ["eins", "zwei"] }),
      subject({ key: "b", label: "B", state: "unknown", reasons: ["drei"] }),
    ]);
    expect(report.state).toBe("critical");
    expect(report.reasons).toEqual(["A: eins", "A: zwei", "B: drei"]);
  });
});

describe("daysSince", () => {
  const now = new Date("2026-09-22T12:00:00.000Z");

  it("is null for something that never happened", () => {
    expect(daysSince(null, now)).toBeNull();
  });

  it("is null for an unparseable date rather than NaN days", () => {
    expect(daysSince("nonsense", now)).toBeNull();
  });

  it("counts whole days", () => {
    expect(daysSince(new Date("2026-09-22T11:00:00.000Z"), now)).toBe(0);
    expect(daysSince(new Date("2026-09-21T11:00:00.000Z"), now)).toBe(1);
    expect(daysSince("2026-09-12T12:00:00.000Z", now)).toBe(10);
  });

  it("does not go negative for a future date in a way that reads as fresh", () => {
    // A clock skew between the database and the process is real. -1 is
    // obviously wrong to a reader; 364 would not be.
    expect(daysSince(new Date("2026-09-23T12:00:00.000Z"), now)).toBe(-1);
  });
});
