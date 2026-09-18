import { describe, expect, it } from "vitest";
import type { Milestone, ProjectDetail, ProjectDiscipline } from "@/entities/project";
import {
  daysUntil,
  disciplinesWithoutLead,
  hoursAllocated,
  isLive,
  isOverdue,
  isReadOnly,
  nextMilestone,
  overdueMilestones,
  scopedDisciplines,
  teamOf,
  totalFeeShare,
} from "../service";

/**
 * The domain layer: pure functions over entity types, no mocks at all.
 *
 * Everything here would otherwise be an inline expression in a tab, where it is
 * untestable and where the second tab that needs it writes its own slightly
 * different copy. That is the layer's whole argument, and these assertions are
 * what make it true rather than aspirational.
 *
 * **What is deliberately absent**: the status transitions and the two derived
 * figures. `allowedTransitions` arrives with the record because the server
 * decides it, and `progressPercent` and `health` are computed there and stored.
 * A test for a client-side copy of either would be a test proving the copy
 * exists, which is the thing to avoid.
 */

const milestone = (over: Partial<Milestone> = {}): Milestone => ({
  id: Math.random().toString(36).slice(2),
  name: "Meilenstein",
  dueDate: new Date(2026, 5, 1),
  metAt: null,
  status: "OPEN",
  phase: null,
  isBillingTrigger: false,
  ...over,
});

const scope = (over: Partial<ProjectDiscipline> = {}): ProjectDiscipline => ({
  id: Math.random().toString(36).slice(2),
  status: "ACTIVE",
  feeShare: null,
  feeShareOverride: false,
  budgetHours: null,
  budgetCost: null,
  hourlyRate: null,
  scopeNote: null,
  discipline: { id: "d1", code: "LFT", name: "Lüftung", colour: "disc-air" },
  leadEngineer: null,
  ...over,
});

const project = (over: Partial<ProjectDetail> = {}): ProjectDetail =>
  ({
    id: "p1",
    number: "P-2026-001",
    name: "Projekt",
    status: "ACTIVE",
    priority: "MEDIUM",
    health: "GREEN",
    progressPercent: 0,
    currentPhase: null,
    startDate: new Date(2026, 0, 1),
    plannedEndDate: new Date(2026, 11, 31),
    actualEndDate: null,
    contractValue: null,
    currency: "CHF",
    budgetHours: null,
    createdAt: null,
    updatedAt: null,
    archivedAt: null,
    customer: null,
    building: null,
    manager: null,
    office: null,
    description: null,
    notes: null,
    architect: null,
    members: [],
    disciplines: [],
    milestones: [],
    allowedTransitions: [],
    ...over,
  }) as ProjectDetail;

describe("isReadOnly and isLive", () => {
  it("treats only ARCHIVED as read-only", () => {
    expect(isReadOnly({ status: "ARCHIVED" })).toBe(true);
    // `CANCELLED` keeps its record and takes no more work, but it is not frozen:
    // it can still be archived, and the note field still matters.
    expect(isReadOnly({ status: "CANCELLED" })).toBe(false);
    expect(isReadOnly({ status: "COMPLETED" })).toBe(false);
  });

  it("counts the three working states as live", () => {
    expect(isLive("PLANNED")).toBe(true);
    expect(isLive("ACTIVE")).toBe(true);
    expect(isLive("ON_HOLD")).toBe(true);
    expect(isLive("COMPLETED")).toBe(false);
  });
});

describe("daysUntil", () => {
  const now = new Date(2026, 5, 15, 14, 30);

  it("counts whole days from midnight, not from now", () => {
    // Otherwise a millisecond decides between "today" and "yesterday", and the
    // badge flickers at lunchtime.
    expect(daysUntil(new Date(2026, 5, 15, 0, 1), now)).toBe(0);
    expect(daysUntil(new Date(2026, 5, 15, 23, 59), now)).toBe(0);
  });

  it("is negative once the date has passed", () => {
    expect(daysUntil(new Date(2026, 5, 10), now)).toBe(-5);
    expect(daysUntil(new Date(2026, 5, 20), now)).toBe(5);
  });

  it("is null without a date", () => {
    expect(daysUntil(null, now)).toBeNull();
  });
});

describe("isOverdue", () => {
  const now = new Date(2026, 5, 15);

  it("is true for a live project past its planned end", () => {
    expect(isOverdue({ plannedEndDate: new Date(2026, 4, 1), status: "ACTIVE" }, now)).toBe(true);
  });

  it("is false once the project is finished", () => {
    // A completed project cannot be overdue; reporting it so would fill the
    // archive with warnings about problems that are over.
    expect(isOverdue({ plannedEndDate: new Date(2026, 4, 1), status: "COMPLETED" }, now)).toBe(
      false,
    );
  });

  it("is false with no planned end", () => {
    expect(isOverdue({ plannedEndDate: null, status: "ACTIVE" }, now)).toBe(false);
  });
});

describe("nextMilestone", () => {
  it("is the earliest one still outstanding", () => {
    const next = nextMilestone([
      milestone({ name: "Spät", dueDate: new Date(2026, 8, 1) }),
      milestone({ name: "Früh", dueDate: new Date(2026, 2, 1) }),
    ]);
    expect(next?.name).toBe("Früh");
  });

  it("skips what is settled, and MISSED is not settled", () => {
    // The distinction the status enum exists for: a waiver was a decision, a
    // miss is still outstanding work.
    const next = nextMilestone([
      milestone({ name: "Erreicht", dueDate: new Date(2026, 1, 1), status: "MET" }),
      milestone({ name: "Erlassen", dueDate: new Date(2026, 1, 2), status: "WAIVED" }),
      milestone({ name: "Verpasst", dueDate: new Date(2026, 1, 3), status: "MISSED" }),
    ]);
    expect(next?.name).toBe("Verpasst");
  });

  it("is null when the plan is complete or empty", () => {
    expect(nextMilestone([])).toBeNull();
    expect(nextMilestone([milestone({ status: "MET" })])).toBeNull();
  });
});

describe("overdueMilestones", () => {
  const now = new Date(2026, 5, 15);

  it("finds the ones past due and not settled", () => {
    const rows = overdueMilestones(
      [
        milestone({ name: "A", dueDate: new Date(2026, 1, 1) }),
        milestone({ name: "B", dueDate: new Date(2026, 1, 1), status: "MET" }),
        milestone({ name: "C", dueDate: new Date(2026, 9, 1) }),
      ],
      now,
    );
    expect(rows.map((m) => m.name)).toEqual(["A"]);
  });
});

describe("totalFeeShare and scopedDisciplines", () => {
  it("sums the shares, treating null as nothing", () => {
    expect(totalFeeShare([scope({ feeShare: 40 }), scope({ feeShare: null })])).toBe(40);
  });

  it("counts a NOT_IN_SCOPE row in the total but not in the scope", () => {
    // The row exists to record the decision that a Gewerk is not part of this
    // project; it should not vanish, and it should not be counted as work.
    const rows = [scope({ feeShare: 40 }), scope({ status: "NOT_IN_SCOPE", feeShare: 10 })];
    expect(scopedDisciplines(rows)).toHaveLength(1);
    expect(totalFeeShare(rows)).toBe(50);
  });
});

describe("hoursAllocated", () => {
  it("reports planned and budget separately, not their difference", () => {
    // "480 von 2'400 h verplant" is the sentence a Projektleiter reads; a
    // single delta hides which of the two numbers moved.
    const result = hoursAllocated(
      project({
        budgetHours: 2400,
        disciplines: [scope({ budgetHours: 300 }), scope({ budgetHours: 180 })],
      }),
    );
    expect(result).toEqual({ planned: 480, budget: 2400, ratio: 0.2 });
  });

  it("gives no ratio when there is no budget", () => {
    // An unknown budget is not a budget of zero, and rendering "100% over" on
    // an empty field teaches people to ignore the indicator.
    expect(hoursAllocated(project({ disciplines: [scope({ budgetHours: 300 })] })).ratio).toBeNull();
  });

  it("ignores a Gewerk that is not in scope", () => {
    const result = hoursAllocated(
      project({
        budgetHours: 1000,
        disciplines: [scope({ budgetHours: 300 }), scope({ status: "NOT_IN_SCOPE", budgetHours: 999 })],
      }),
    );
    expect(result.planned).toBe(300);
  });
});

describe("disciplinesWithoutLead", () => {
  it("answers 'which Gewerke have nobody responsible'", () => {
    const rows = disciplinesWithoutLead(
      project({
        disciplines: [
          scope({ leadEngineer: { id: "e1", name: "Anna", email: "a@iem.ch" } }),
          scope(),
          // Not in scope, so not missing a lead — nobody owes it a person.
          scope({ status: "NOT_IN_SCOPE" }),
        ],
      }),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("teamOf", () => {
  it("keeps the manager separate, because they are not a member row", () => {
    // `Project.managerId`, not a `ProjectMember` — leaving them out of the team
    // because the schema keeps them elsewhere would be the data model leaking
    // onto the page.
    const manager = { id: "e1", name: "Anna Meier", email: "a@iem.ch" };
    const team = teamOf(project({ manager }));
    expect(team.manager).toEqual(manager);
    expect(team.members).toEqual([]);
  });

  it("sorts by role then by name, and does not mutate the input", () => {
    const members = [
      {
        id: "m1",
        role: "ENGINEER" as const,
        allocationPercent: 50,
        from: null,
        to: null,
        employee: { id: "e2", name: "Zoe", email: "z@iem.ch", position: null },
      },
      {
        id: "m2",
        role: "CONSULTANT" as const,
        allocationPercent: 20,
        from: null,
        to: null,
        employee: { id: "e3", name: "Beat", email: "b@iem.ch", position: null },
      },
    ];
    const input = project({ members });
    const team = teamOf(input);
    expect(team.members.map((m) => m.employee.name)).toEqual(["Beat", "Zoe"]);
    // The copy matters: sorting the array in place would reorder the cached
    // entity, and two screens reading it would disagree about what changed.
    expect(input.members.map((m) => m.employee.name)).toEqual(["Zoe", "Beat"]);
  });
});
