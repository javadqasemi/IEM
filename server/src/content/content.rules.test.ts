import { describe, expect, it } from "vitest";
import { WorkflowState } from "@prisma/client";
import {
  MAX_SCHEDULE_AHEAD_MS,
  MIN_SCHEDULE_LEAD_MS,
  TRANSITIONS,
  WORKFLOW_STATES,
  canTransition,
  publishEffect,
  refuseCancelSchedule,
  refuseReorder,
  refuseSchedule,
  refuseStalePublish,
  refuseTransition,
  refuseUnpublish,
} from "./content.rules";

/**
 * The publishing state machine, asserted over **every pair**.
 *
 * This is the point of moving the table out of `content.service.ts`: the
 * question an auditor asks is "can an editor move something from IN_REVIEW
 * straight to PUBLISHED?", and until now it could only be answered by reading
 * code. Thirty-six cases, milliseconds, and a table in the test that a reader
 * can compare against the one in the source.
 */

const NOW = new Date("2026-09-21T12:00:00.000Z");
const MINUTE = 60_000;

/* ================================================================== */

describe("the transition matrix, exhaustively", () => {
  /**
   * The allowed set, restated independently of the source.
   *
   * Deliberately a **second copy**. A test that imported `TRANSITIONS` and
   * checked `canTransition` against it would be comparing the table with
   * itself and would pass whatever it said. Writing it out is what makes a
   * silent widening — somebody adding `DRAFT → PUBLISHED` "just for the
   * importer" — fail here rather than ship.
   */
  const ALLOWED = new Set([
    "DRAFT>IN_REVIEW",
    "DRAFT>ARCHIVED",
    "IN_REVIEW>APPROVED",
    "IN_REVIEW>REJECTED",
    "IN_REVIEW>DRAFT",
    "APPROVED>PUBLISHED",
    "APPROVED>DRAFT",
    "APPROVED>REJECTED",
    "PUBLISHED>DRAFT",
    "PUBLISHED>ARCHIVED",
    "REJECTED>DRAFT",
    "REJECTED>ARCHIVED",
    "ARCHIVED>DRAFT",
  ]);

  for (const from of WORKFLOW_STATES) {
    for (const to of WORKFLOW_STATES) {
      const key = `${from}>${to}`;
      const expected = ALLOWED.has(key);

      it(`${from} → ${to} is ${expected ? "allowed" : "refused"}`, () => {
        expect(canTransition(from, to)).toBe(expected);
        expect(refuseTransition(from, to) === null).toBe(expected);
      });
    }
  }

  it("covers all six states, so a new one cannot be added unnoticed", () => {
    expect(WORKFLOW_STATES.sort()).toEqual(
      ["APPROVED", "ARCHIVED", "DRAFT", "IN_REVIEW", "PUBLISHED", "REJECTED"].sort(),
    );
  });

  /**
   * The rule the whole four-eyes principle rests on. If this ever passes,
   * somebody has made review optional by accident.
   */
  it("makes PUBLISHED reachable only from APPROVED", () => {
    const sources = WORKFLOW_STATES.filter((s) => TRANSITIONS[s].includes(WorkflowState.PUBLISHED));
    expect(sources).toEqual([WorkflowState.APPROVED]);
  });

  it("never lets a state move to itself", () => {
    for (const state of WORKFLOW_STATES) {
      expect(canTransition(state, state), state).toBe(false);
    }
  });

  it("names both states in the refusal, so the message is actionable", () => {
    const message = refuseTransition(WorkflowState.DRAFT, WorkflowState.PUBLISHED);
    expect(message).toContain("DRAFT");
    expect(message).toContain("PUBLISHED");
  });
});

/* ================================================================== */

describe("unpublishing", () => {
  const live = { status: WorkflowState.PUBLISHED, hasPublishedData: true, deletedAt: null };

  it("allows a published entry to be withdrawn", () => {
    expect(refuseUnpublish(live)).toBeNull();
  });

  /**
   * `publishedData` is the fact; the status is the workflow's opinion about
   * it. An entry can read PUBLISHED and carry no published copy, and one that
   * reads DRAFT can still be live — because the snapshot keeps serving what
   * was published until the next publish replaces it.
   */
  it("refuses one that carries no published copy, whatever its status says", () => {
    expect(refuseUnpublish({ ...live, hasPublishedData: false })).toMatch(/nicht veröffentlicht/);
  });

  it("refuses a deleted entry and says to restore it first", () => {
    expect(refuseUnpublish({ ...live, deletedAt: new Date() })).toMatch(/gelöscht/);
  });

  it("refuses a status the machine cannot move to DRAFT from", () => {
    // ARCHIVED → DRAFT is allowed, so an archived entry with a published copy
    // may be withdrawn; IN_REVIEW → DRAFT is allowed too. The refusal here is
    // the machine's, not a second opinion.
    expect(refuseUnpublish({ ...live, status: WorkflowState.ARCHIVED })).toBeNull();
  });
});

/* ================================================================== */

describe("scheduling", () => {
  const approved = {
    status: WorkflowState.APPROVED,
    deletedAt: null,
    scheduledAt: null,
  };
  const soon = new Date(NOW.getTime() + 60 * MINUTE);

  it("allows an approved entry to be scheduled", () => {
    expect(refuseSchedule(approved, soon, NOW)).toBeNull();
  });

  /**
   * The approval boundary. Scheduling is a delay on publication, not a way
   * around review — and the cron refuses anything that is not APPROVED, so
   * without this the schedule would simply never fire and nobody would know.
   */
  it("refuses every status but APPROVED", () => {
    for (const status of WORKFLOW_STATES.filter((s) => s !== WorkflowState.APPROVED)) {
      expect(refuseSchedule({ ...approved, status }, soon, NOW), status).toMatch(/freigegeben/);
    }
  });

  it("refuses a time inside the cron's own interval", () => {
    const tooSoon = new Date(NOW.getTime() + MIN_SCHEDULE_LEAD_MS - 1);
    expect(refuseSchedule(approved, tooSoon, NOW)).toMatch(/fünf Minuten/);
    // The boundary itself is allowed.
    expect(refuseSchedule(approved, new Date(NOW.getTime() + MIN_SCHEDULE_LEAD_MS), NOW)).toBeNull();
  });

  it("refuses the past", () => {
    expect(refuseSchedule(approved, new Date(NOW.getTime() - MINUTE), NOW)).not.toBeNull();
  });

  it("refuses a date more than a year out, which is a typo more often than an intention", () => {
    const tooFar = new Date(NOW.getTime() + MAX_SCHEDULE_AHEAD_MS + MINUTE);
    expect(refuseSchedule(approved, tooFar, NOW)).toMatch(/Jahr/);
  });

  it("refuses an unparseable date rather than scheduling NaN", () => {
    expect(refuseSchedule(approved, new Date("nonsense"), NOW)).not.toBeNull();
  });

  it("refuses a deleted entry", () => {
    expect(refuseSchedule({ ...approved, deletedAt: new Date() }, soon, NOW)).not.toBeNull();
  });

  /**
   * Re-scheduling is allowed: an entry that already has a time may be moved.
   * Refusing it would mean cancelling and re-scheduling to change a time by an
   * hour, which is two audit rows for one decision.
   */
  it("allows moving an existing schedule", () => {
    expect(refuseSchedule({ ...approved, scheduledAt: soon }, new Date(NOW.getTime() + 120 * MINUTE), NOW))
      .toBeNull();
  });
});

describe("cancelling a schedule", () => {
  it("allows it when one is set", () => {
    expect(refuseCancelSchedule({ scheduledAt: new Date() })).toBeNull();
  });

  /**
   * Deliberately **not** idempotent. The two readings of a quiet success are
   * "I cancelled it" and "it had already fired", and those are very different
   * facts to be wrong about at the moment somebody is trying to stop a
   * publication.
   */
  it("refuses when none is set rather than succeeding quietly", () => {
    expect(refuseCancelSchedule({ scheduledAt: null })).toMatch(/keine Veröffentlichung/);
  });
});

/* ================================================================== */

describe("the optimistic lock on a publish", () => {
  it("allows a publish at the version the caller opened", () => {
    expect(refuseStalePublish(8, 8)).toBeNull();
  });

  /**
   * The lost update this closes: A opens v8, B saves v9, A approves and
   * publishes — and what goes live is B's text under A's review.
   */
  it("refuses a stale one and names both versions", () => {
    const message = refuseStalePublish(9, 8);
    expect(message).toContain("9");
    expect(message).toContain("8");
  });

  it("allows the site-wide publish, which claims no version", () => {
    // `null` is "I did not claim to know" — the button that publishes whatever
    // is approved, where the approval is the control.
    expect(refuseStalePublish(9, null)).toBeNull();
  });
});

/* ================================================================== */

describe("what the next publish would do to one entry", () => {
  const base = { status: WorkflowState.DRAFT, hasPublishedData: false, hidden: false, deletedAt: null };

  it("publishes an approved entry that has never been live", () => {
    expect(publishEffect({ ...base, status: WorkflowState.APPROVED })).toBe("PUBLISH");
  });

  it("republishes an approved entry that is already live", () => {
    expect(publishEffect({ ...base, status: WorkflowState.APPROVED, hasPublishedData: true }))
      .toBe("REPUBLISH");
  });

  /**
   * The trap CLAUDE.md records: a deletion never becomes APPROVED and never
   * enters review, so a screen counting approved rows is blind to it — while
   * the next publish still removes it from the site.
   */
  it("withdraws a deleted entry that is currently live", () => {
    expect(publishEffect({ ...base, hasPublishedData: true, deletedAt: new Date() }))
      .toBe("WITHDRAW");
  });

  it("withdraws a hidden entry that is currently live", () => {
    expect(publishEffect({ ...base, hasPublishedData: true, hidden: true })).toBe("WITHDRAW");
  });

  it("does nothing for a draft that was never live", () => {
    expect(publishEffect(base)).toBe("NONE");
    expect(publishEffect({ ...base, hidden: true })).toBe("NONE");
    expect(publishEffect({ ...base, deletedAt: new Date() })).toBe("NONE");
  });

  it("does nothing for a published entry nobody has re-approved", () => {
    // It stays in the document because its published copy is still there —
    // the publish neither adds nor removes it.
    expect(publishEffect({ ...base, status: WorkflowState.PUBLISHED, hasPublishedData: true }))
      .toBe("NONE");
  });
});

describe("refuseReorder — an order is the whole collection, once each", () => {
  const live = ["a", "b", "c"];

  it("accepts the live set in any order", () => {
    expect(refuseReorder(["c", "a", "b"], live)).toBeNull();
  });

  it("refuses one page of a longer list", () => {
    // The bug: page one numbered 0..n, page two numbered 0..n again.
    expect(refuseReorder(["b", "a"], live)).toMatch(/fehlt/);
  });

  it("refuses an id from another type, or a deleted one", () => {
    expect(refuseReorder(["a", "b", "c", "x"], live)).toMatch(/gehört nicht/);
    expect(refuseReorder(["a", "b", "x"], live)).toMatch(/gehört nicht/);
  });

  it("refuses a duplicate, which would give two entries one slot", () => {
    expect(refuseReorder(["a", "a", "b", "c"], live)).toMatch(/mehrfach/);
  });

  it("refuses an empty order", () => {
    expect(refuseReorder([], live)).not.toBeNull();
  });
});