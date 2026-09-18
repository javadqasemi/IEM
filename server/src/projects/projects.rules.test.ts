import { MilestoneStatus, ProjectHealth, ProjectStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  PROJECT_TRANSITIONS,
  deriveHealth,
  deriveProgress,
  expectedProgress,
  formatProjectNumber,
  isTerminal,
  nextSequence,
  refuseDates,
  refuseFeeShares,
  refuseTransition,
  transitionsFrom,
} from "./projects.rules";

/**
 * The domain rules, with no database anywhere.
 *
 * That is the point of the file existing at all — every assertion below runs
 * against a constructed object in under a millisecond, which is what makes it
 * reasonable to test the *edges* rather than the happy path. The
 * reference-implementation gate asks for tests that fail if a layer is
 * bypassed; these fail if a rule is wrong, and the architecture test is what
 * fails if the rule moves somewhere it cannot be reached from here.
 */

const noMilestones: { status: MilestoneStatus }[] = [];

describe("the status machine", () => {
  it("covers every status", () => {
    // Guards the rest: a new status with no row would silently have no
    // transitions, and `refuseTransition` would refuse everything with a
    // message about an archived project.
    expect(Object.keys(PROJECT_TRANSITIONS).sort()).toEqual(Object.values(ProjectStatus).sort());
  });

  it("names no status that is not a status", () => {
    const known = new Set<string>(Object.values(ProjectStatus));
    for (const [from, targets] of Object.entries(PROJECT_TRANSITIONS)) {
      for (const target of targets) {
        expect(known.has(target), `${from} → ${target}`).toBe(true);
      }
    }
  });

  it("allows the documented path", () => {
    expect(transitionsFrom(ProjectStatus.PLANNED)).toContain(ProjectStatus.ACTIVE);
    expect(transitionsFrom(ProjectStatus.ACTIVE)).toContain(ProjectStatus.ON_HOLD);
    expect(transitionsFrom(ProjectStatus.ON_HOLD)).toContain(ProjectStatus.ACTIVE);
    expect(transitionsFrom(ProjectStatus.COMPLETED)).toEqual([ProjectStatus.ARCHIVED]);
  });

  it("refuses to reopen a completed project", () => {
    // The documented refusal: reopening is a new commission on the same
    // building, not a status walking backwards over the first one's budget.
    const refusal = refuseTransition(ProjectStatus.COMPLETED, ProjectStatus.ACTIVE, {
      managerId: "e1",
      startDate: new Date("2026-01-01"),
      milestones: noMilestones,
    });
    expect(refusal).toMatch(/COMPLETED/);
  });

  it("refuses everything once archived", () => {
    expect(transitionsFrom(ProjectStatus.ARCHIVED)).toEqual([]);
    expect(isTerminal(ProjectStatus.ARCHIVED)).toBe(true);
    expect(isTerminal(ProjectStatus.CANCELLED)).toBe(false);
    const refusal = refuseTransition(ProjectStatus.ARCHIVED, ProjectStatus.ACTIVE, {
      managerId: "e1",
      startDate: new Date(),
      milestones: noMilestones,
    });
    expect(refusal).toMatch(/archiviert/);
  });

  it("allows a no-op", () => {
    // `PUT :id/status` with the status it already has is idempotent, not an
    // error — a double-click must not produce a 400.
    expect(
      refuseTransition(ProjectStatus.ACTIVE, ProjectStatus.ACTIVE, {
        managerId: null,
        startDate: null,
        milestones: noMilestones,
      }),
    ).toBeNull();
  });
});

describe("the preconditions on going ACTIVE", () => {
  it("needs a manager", () => {
    expect(
      refuseTransition(ProjectStatus.PLANNED, ProjectStatus.ACTIVE, {
        managerId: null,
        startDate: new Date("2026-01-01"),
        milestones: noMilestones,
      }),
    ).toMatch(/Projektleitung/);
  });

  it("needs a start date", () => {
    expect(
      refuseTransition(ProjectStatus.PLANNED, ProjectStatus.ACTIVE, {
        managerId: "e1",
        startDate: null,
        milestones: noMilestones,
      }),
    ).toMatch(/Startdatum/);
  });

  it("passes with both", () => {
    expect(
      refuseTransition(ProjectStatus.PLANNED, ProjectStatus.ACTIVE, {
        managerId: "e1",
        startDate: new Date("2026-01-01"),
        milestones: noMilestones,
      }),
    ).toBeNull();
  });
});

describe("the precondition on COMPLETED", () => {
  const complete = (milestones: { status: MilestoneStatus }[]) =>
    refuseTransition(ProjectStatus.ACTIVE, ProjectStatus.COMPLETED, {
      managerId: "e1",
      startDate: new Date("2026-01-01"),
      milestones,
    });

  it("refuses while a milestone is open", () => {
    expect(complete([{ status: MilestoneStatus.OPEN }])).toMatch(/Meilenstein/);
  });

  it("counts WAIVED as settled and MISSED as not", () => {
    // The distinction the enum exists for: a waiver was a decision, a miss is
    // outstanding work.
    expect(complete([{ status: MilestoneStatus.WAIVED }])).toBeNull();
    expect(complete([{ status: MilestoneStatus.MISSED }])).toMatch(/Meilenstein/);
  });

  it("allows a project with none at all", () => {
    expect(complete([])).toBeNull();
  });
});

describe("deriveProgress", () => {
  it("is 0 for a project with no milestones, not 100", () => {
    // An empty plan is the start of a project. The other answer marks every
    // new project finished on the day it is created.
    expect(deriveProgress([])).toBe(0);
  });

  it("counts MET and WAIVED", () => {
    expect(
      deriveProgress([
        { status: MilestoneStatus.MET },
        { status: MilestoneStatus.WAIVED },
        { status: MilestoneStatus.OPEN },
        { status: MilestoneStatus.MISSED },
      ]),
    ).toBe(50);
  });

  it("rounds rather than truncating", () => {
    expect(
      deriveProgress([
        { status: MilestoneStatus.MET },
        { status: MilestoneStatus.OPEN },
        { status: MilestoneStatus.OPEN },
      ]),
    ).toBe(33);
  });
});

describe("expectedProgress", () => {
  it("is null without both dates", () => {
    expect(expectedProgress(null, new Date(), new Date())).toBeNull();
    expect(expectedProgress(new Date(), null, new Date())).toBeNull();
  });

  it("is null when the end is not after the start", () => {
    const day = new Date("2026-06-01");
    expect(expectedProgress(day, day, day)).toBeNull();
  });

  it("is the elapsed share, clamped", () => {
    const start = new Date("2026-01-01");
    const end = new Date("2026-12-31");
    expect(expectedProgress(start, end, new Date("2026-01-01"))).toBe(0);
    expect(expectedProgress(start, end, new Date("2026-07-01"))).toBeGreaterThan(45);
    expect(expectedProgress(start, end, new Date("2027-06-01"))).toBe(100);
    expect(expectedProgress(start, end, new Date("2025-06-01"))).toBe(0);
  });
});

describe("deriveHealth", () => {
  const base = {
    status: ProjectStatus.ACTIVE,
    startDate: new Date("2026-01-01"),
    plannedEndDate: new Date("2026-12-31"),
    now: new Date("2026-07-01"),
  };

  it("is green for any finished project", () => {
    // Otherwise the archive is permanently full of red rows describing
    // problems that are over.
    for (const status of [
      ProjectStatus.COMPLETED,
      ProjectStatus.ARCHIVED,
      ProjectStatus.CANCELLED,
    ]) {
      expect(
        deriveHealth({ ...base, status, progressPercent: 0, milestones: [] }),
      ).toBe(ProjectHealth.GREEN);
    }
  });

  it("is red on a missed milestone regardless of schedule", () => {
    expect(
      deriveHealth({
        ...base,
        progressPercent: 100,
        milestones: [{ status: MilestoneStatus.MISSED, dueDate: new Date("2026-03-01") }],
      }),
    ).toBe(ProjectHealth.RED);
  });

  it("is green when progress tracks the calendar", () => {
    expect(deriveHealth({ ...base, progressPercent: 50, milestones: [] })).toBe(
      ProjectHealth.GREEN,
    );
  });

  it("is amber more than 15 points behind and red past 30", () => {
    expect(deriveHealth({ ...base, progressPercent: 30, milestones: [] })).toBe(
      ProjectHealth.AMBER,
    );
    expect(deriveHealth({ ...base, progressPercent: 5, milestones: [] })).toBe(ProjectHealth.RED);
  });

  it("is red on two overdue milestones", () => {
    const overdue = { status: MilestoneStatus.OPEN, dueDate: new Date("2026-02-01") };
    expect(
      deriveHealth({ ...base, progressPercent: 50, milestones: [overdue, { ...overdue }] }),
    ).toBe(ProjectHealth.RED);
  });

  it("is amber on one overdue milestone even when on schedule", () => {
    expect(
      deriveHealth({
        ...base,
        progressPercent: 50,
        milestones: [{ status: MilestoneStatus.OPEN, dueDate: new Date("2026-02-01") }],
      }),
    ).toBe(ProjectHealth.AMBER);
  });

  it("respects a hand-set AT_RISK", () => {
    expect(
      deriveHealth({
        ...base,
        progressPercent: 50,
        milestones: [{ status: MilestoneStatus.AT_RISK, dueDate: new Date("2026-11-01") }],
      }),
    ).toBe(ProjectHealth.AMBER);
  });

  it("does not go red on a dateless project", () => {
    // No dates means nothing to be behind; reporting red would make every
    // freshly created project look like a crisis.
    expect(
      deriveHealth({
        status: ProjectStatus.PLANNED,
        progressPercent: 0,
        startDate: null,
        plannedEndDate: null,
        milestones: [],
        now: base.now,
      }),
    ).toBe(ProjectHealth.GREEN);
  });
});

describe("refuseDates", () => {
  it("allows a missing date", () => {
    expect(refuseDates(null, new Date())).toBeNull();
    expect(refuseDates(new Date(), null)).toBeNull();
  });

  it("refuses an end on or before the start", () => {
    const day = new Date("2026-06-01");
    expect(refuseDates(day, day)).toMatch(/nach dem Start/);
    expect(refuseDates(day, new Date("2026-05-31"))).toMatch(/nach dem Start/);
    expect(refuseDates(day, new Date("2026-06-02"))).toBeNull();
  });
});

describe("refuseFeeShares", () => {
  it("allows exactly 100", () => {
    expect(
      refuseFeeShares([
        { feeShare: 60, feeShareOverride: false },
        { feeShare: 40, feeShareOverride: false },
      ]),
    ).toBeNull();
  });

  it("refuses more than 100 without an override", () => {
    expect(
      refuseFeeShares([
        { feeShare: 60, feeShareOverride: false },
        { feeShare: 50, feeShareOverride: false },
      ]),
    ).toMatch(/110/);
  });

  it("allows more than 100 with one", () => {
    // Subcontracted scope legitimately exceeds the fee; the flag makes it a
    // decision rather than a typo.
    expect(
      refuseFeeShares([
        { feeShare: 60, feeShareOverride: false },
        { feeShare: 50, feeShareOverride: true },
      ]),
    ).toBeNull();
  });

  it("treats a null share as nothing, not as an error", () => {
    expect(refuseFeeShares([{ feeShare: null, feeShareOverride: false }])).toBeNull();
  });
});

describe("the project number", () => {
  it("pads to three digits", () => {
    expect(formatProjectNumber(2026, 14)).toBe("P-2026-014");
    expect(formatProjectNumber(2026, 7)).toBe("P-2026-007");
    expect(formatProjectNumber(2026, 1234)).toBe("P-2026-1234");
  });

  it("starts a year at 1", () => {
    expect(nextSequence([], 2026)).toBe(1);
    expect(nextSequence(["P-2025-088"], 2026)).toBe(1);
  });

  it("continues from the maximum, not the count", () => {
    // A deleted project still consumed its number; counting rows would reissue
    // one that is already on drawings and invoices.
    expect(nextSequence(["P-2026-001", "P-2026-014"], 2026)).toBe(15);
  });

  it("ignores a number it cannot read", () => {
    expect(nextSequence(["P-2026-alt", "P-2026-003"], 2026)).toBe(4);
  });
});
