import { describe, expect, it } from "vitest";
import { activeMembership, reachableProject, startOfUtcDay } from "./membership.scope";
import { isUnrestricted, nothing, restrictedTo, unrestricted, whereOf } from "./scope";

describe("Scope", () => {
  it("restrictedTo carries the caller's predicate", () => {
    const s = restrictedTo({ managerId: "e1" });
    expect(s.kind).toBe("restricted");
    expect(whereOf(s)).toEqual({ managerId: "e1" });
    expect(isUnrestricted(s)).toBe(false);
  });

  it("nothing() matches no row", () => {
    expect(whereOf(nothing())).toEqual({ id: "" });
    expect(isUnrestricted(nothing())).toBe(false);
  });

  it("unrestricted() is the only way to every row, and it wants a reason", () => {
    const s = unrestricted("nightly reconciler");
    expect(whereOf(s)).toEqual({});
    expect(s.because).toBe("nightly reconciler");
    expect(isUnrestricted(s)).toBe(true);
    expect(() => unrestricted("  ")).toThrow(/Begründung/);
  });
});

/**
 * Membership validity — `docs/COMPLETE_APPLICATION_AUDIT.md` Part 8, R9.
 *
 * An ended membership (`to` in the past) no longer grants access; one that
 * ends today still does; `from` is deliberately not enforced, so somebody
 * staffed ahead can prepare. The predicate is asserted exactly, because the
 * failure it guards is a query that returns *more*, which nobody reports.
 */
describe("activeMembership", () => {
  const now = new Date("2026-09-23T15:30:00Z");

  it("requires a live row for the employee", () => {
    const where = activeMembership("e1", now);
    expect(where.employeeId).toBe("e1");
    expect(where.deletedAt).toBeNull();
  });

  it("accepts no end date, or an end date today or later (inclusive)", () => {
    expect(activeMembership("e1", now).OR).toEqual([
      { to: null },
      { to: { gte: new Date("2026-09-23T00:00:00Z") } },
    ]);
  });

  it("does not look at `from` — staffing ahead is allowed to read", () => {
    expect(JSON.stringify(activeMembership("e1", now))).not.toContain("from");
  });

  it("is what reachableProject uses", () => {
    expect(reachableProject("e1", now)).toEqual({
      deletedAt: null,
      OR: [{ managerId: "e1" }, { members: { some: activeMembership("e1", now) } }],
    });
  });

  it("measures the day in UTC, the way the date pickers store it", () => {
    expect(startOfUtcDay(new Date("2026-09-23T23:59:59Z")).toISOString()).toBe(
      "2026-09-23T00:00:00.000Z",
    );
  });
});
