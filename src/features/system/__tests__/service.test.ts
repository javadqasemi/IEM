import { describe, expect, it } from "vitest";
import { HEALTH_META, HEALTH_STATES, JOB_PHASE_META, jobLabel } from "@/entities/system";
import {
  describeBuild,
  describeMigrations,
  formatAttempts,
  formatDuration,
  formatUptime,
  severityOf,
  sortSubjects,
  summarise,
} from "../service";
import type { HealthReport } from "../types";

/**
 * The System screens' arithmetic, without a server.
 *
 * The rule the whole slice follows is that the screen renders the server's
 * answer rather than computing a second one — so what is left here is
 * presentation: an ordering, a sentence, a unit. Each of those is still a
 * decision, and two of them are decisions somebody would otherwise re-make
 * differently on the next screen.
 */

const report = (over: Partial<HealthReport> = {}): HealthReport => ({
  state: "healthy",
  reasons: [],
  subjects: [],
  ...over,
});

describe("the vocabulary", () => {
  it("gives every health state a label and a tone", () => {
    for (const state of HEALTH_STATES) {
      expect(HEALTH_META[state]?.label.length, state).toBeGreaterThan(3);
      expect(HEALTH_META[state]?.tone, state).toBeTruthy();
    }
  });

  /**
   * `unknown` means "configured and never tested". Drawing it green would be
   * the panel asserting something nobody has checked, which is the argument
   * the five-valued union exists for in the first place.
   */
  it("does not draw an unproven subsystem as healthy", () => {
    expect(HEALTH_META.unknown.tone).not.toBe(HEALTH_META.healthy.tone);
    expect(HEALTH_META.not_configured.tone).not.toBe(HEALTH_META.healthy.tone);
  });

  it("gives every job phase a label and a tone", () => {
    for (const phase of Object.keys(JOB_PHASE_META) as (keyof typeof JOB_PHASE_META)[]) {
      expect(JOB_PHASE_META[phase].label.length, phase).toBeGreaterThan(3);
    }
  });

  /**
   * A job type with no German name falls back to its key: visible, wrong
   * enough to notice, and better than a blank cell — the same failure mode
   * `disciplineColour` chooses for an unknown Gewerk.
   */
  it("falls back to the key for an unmapped job type", () => {
    expect(jobLabel("content.publishScheduled")).toBe("Zeitgesteuerte Veröffentlichung");
    expect(jobLabel("something.nobodyMapped")).toBe("something.nobodyMapped");
  });
});

describe("ordering the subject cards", () => {
  it("puts the worst first", () => {
    const sorted = sortSubjects([
      { state: "healthy" as const, key: "a" },
      { state: "critical" as const, key: "b" },
      { state: "warning" as const, key: "c" },
    ]);
    expect(sorted.map((s) => s.key)).toEqual(["b", "c", "a"]);
  });

  /**
   * A fixed grid looks tidier and buries the one tile that matters on the day
   * it matters.
   */
  it("ranks critical above everything and healthy below everything", () => {
    for (const state of HEALTH_STATES) {
      if (state !== "critical") {
        expect(severityOf("critical"), state).toBeLessThan(severityOf(state));
      }
      if (state !== "healthy") {
        expect(severityOf("healthy"), state).toBeGreaterThan(severityOf(state));
      }
    }
  });

  it("keeps ties in their original order, so a healthy grid does not shuffle", () => {
    const input = [
      { state: "healthy" as const, key: "a" },
      { state: "healthy" as const, key: "b" },
      { state: "healthy" as const, key: "c" },
    ];
    expect(sortSubjects(input).map((s) => s.key)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const input = [
      { state: "healthy" as const, key: "a" },
      { state: "critical" as const, key: "b" },
    ];
    sortSubjects(input);
    expect(input.map((s) => s.key)).toEqual(["a", "b"]);
  });
});

describe("the banner", () => {
  it("says everything is well when it is", () => {
    expect(summarise(report()).headline).toMatch(/betriebsbereit/i);
  });

  it("counts the reasons, in the singular and the plural", () => {
    expect(summarise(report({ state: "warning", reasons: ["x"] })).headline).toMatch(/^1 Punkt /);
    expect(summarise(report({ state: "warning", reasons: ["x", "y"] })).headline).toMatch(
      /^2 Punkte /,
    );
  });

  /**
   * Reachable: a subsystem can be `not_configured` with nothing to say about
   * it. A banner claiming a problem with no list under it would send somebody
   * looking for something that is not there.
   */
  it("handles an unhealthy state with no reasons", () => {
    const out = summarise(report({ state: "not_configured", reasons: [] }));
    expect(out.headline).toMatch(/eingerichtet/);
    expect(out.tone).toBe("not_configured");
  });

  /**
   * The assertion that keeps the design honest: no percentage, ever. A score
   * cannot be acted on without expanding it back into the list it came from.
   */
  it("never produces a percentage", () => {
    for (const state of HEALTH_STATES) {
      const out = summarise(report({ state, reasons: ["a", "b", "c"] }));
      expect(out.headline, state).not.toMatch(/%/);
    }
  });
});

describe("formatting", () => {
  it("reads weeks as days rather than as a five-digit hour count", () => {
    expect(formatUptime(0)).toBe("00:00");
    expect(formatUptime(3_661)).toBe("01:01");
    expect(formatUptime(3 * 86_400 + 3_661)).toBe("3 d 01:01");
  });

  it("refuses a nonsensical uptime rather than printing NaN", () => {
    expect(formatUptime(Number.NaN)).toBe("—");
    expect(formatUptime(-1)).toBe("—");
  });

  /**
   * A job that took `184000 ms` is a number nobody converts in their head
   * while scanning a table.
   */
  it("chooses the unit a reader can compare", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(120)).toBe("120 ms");
    expect(formatDuration(1_500)).toBe("1.5 s");
    expect(formatDuration(184_000)).toBe("3 min 4 s");
  });

  /**
   * Both numbers, always. "Versuch 2" alone does not say whether the next
   * failure is the last one, which is the only reason a reader is looking.
   */
  it("shows attempts against the ceiling", () => {
    expect(formatAttempts({ attempts: 2, maxAttempts: 3 })).toBe("2 von 3");
  });
});

describe("the build identity", () => {
  it("reports the server's reason rather than inventing a version", () => {
    const out = describeBuild({
      version: null,
      commit: null,
      builtAt: null,
      environment: "development",
      source: "none",
      reason: "Kein Build-Stempel.",
    });
    expect(out.known).toBe(false);
    expect(out.version).toBe("Unbekannt");
    expect(out.detail).toBe("Kein Build-Stempel.");
  });

  it("names the commit, the date and where it came from", () => {
    const out = describeBuild({
      version: "1.4.0",
      commit: "c0a8efa06dbc",
      builtAt: "2026-09-22T10:00:00.000Z",
      environment: "production",
      source: "environment",
      reason: null,
    });
    expect(out.known).toBe(true);
    expect(out.version).toBe("1.4.0");
    expect(out.detail).toContain("c0a8efa06dbc");
    expect(out.detail).toContain("2026-09-22");
    expect(out.detail).toMatch(/Umgebung/);
  });

  /**
   * A stamp can carry a commit and no version — `package.json` may be absent
   * or unreadable — and the row still has something worth saying.
   */
  it("handles a commit without a version", () => {
    const out = describeBuild({
      version: null,
      commit: "abc123",
      builtAt: null,
      environment: "development",
      source: "stamp",
      reason: null,
    });
    expect(out.known).toBe(true);
    expect(out.version).toMatch(/ohne Versionsnummer/);
  });
});

describe("the migration row", () => {
  /**
   * The one database condition where continuing to write is worse than
   * stopping, so it is `critical` rather than a warning.
   */
  it("treats a half-applied schema as critical", () => {
    const out = describeMigrations({
      status: "mismatch",
      applied: 40,
      pending: 2,
      latest: null,
      latestAt: null,
    });
    expect(out.state).toBe("critical");
    expect(out.detail).toContain("2");
  });

  it("treats a missing migration table as unknown rather than as broken", () => {
    const out = describeMigrations({
      status: "unknown",
      applied: 0,
      pending: 0,
      latest: null,
      latestAt: null,
    });
    expect(out.state).toBe("unknown");
    expect(out.detail).toMatch(/db push/);
  });

  it("names the latest migration when the schema is current", () => {
    const out = describeMigrations({
      status: "current",
      applied: 42,
      pending: 0,
      latest: "20260921074026_backup_recovery",
      latestAt: "2026-09-21T07:40:26.000Z",
    });
    expect(out.state).toBe("healthy");
    expect(out.detail).toContain("42");
    expect(out.detail).toContain("20260921074026_backup_recovery");
  });
});
