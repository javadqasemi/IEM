import { afterEach, describe, expect, it, vi } from "vitest";
import {
  toCreateBody,
  toDatePart,
  toMemberBody,
  toMilestone,
  toMilestoneUpdateBody,
  toProject,
  toProjectDetail,
  toProjectStats,
  toScopeBody,
  toStatusBody,
  toUpdateBody,
} from "../mapper";
import type { ProjectDetailDto, ProjectDto } from "../dto";

/**
 * The mapper, both directions.
 *
 * The two halves fail differently, which is why both are covered. Outbound, a
 * missed conversion leaks a wire shape into a component — visible, and caught
 * the first time somebody sorts by a date. Inbound, a missed conversion sends
 * the wrong body and the request *succeeds*, having changed the wrong thing.
 */

const dto: ProjectDto = {
  id: "p1",
  number: "P-2026-014",
  name: "Schulhaus Guglera",
  status: "ACTIVE",
  priority: "HIGH",
  health: "AMBER",
  progressPercent: 40,
  currentPhase: "P41",
  startDate: "2026-01-15T00:00:00.000Z",
  plannedEndDate: "2026-12-31T00:00:00.000Z",
  actualEndDate: null,
  contractValue: "1450000.00",
  currency: "CHF",
  budgetHours: 2400,
  version: 3,
  createdAt: "2026-01-02T06:00:00.000Z",
  updatedAt: "2026-09-18T06:00:00.000Z",
  archivedAt: null,
  customer: { id: "c1", number: "K-00123", name: "Gemeinde Giffers" },
  building: { id: "b1", number: "G-00412", name: "Schulhaus Guglera", city: "Giffers" },
  manager: { id: "e1", name: "Anna Meier", email: "anna@iem.ch" },
  office: { id: "o1", name: "Thun" },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("outbound: DTO → entity", () => {
  it("parses every date into a Date", () => {
    const project = toProject(dto);
    expect(project.startDate).toBeInstanceOf(Date);
    expect(project.plannedEndDate?.getUTCFullYear()).toBe(2026);
    // `new Date(null)` is 1 January 1970, which is not "unknown".
    expect(project.actualEndDate).toBeNull();
    expect(project.archivedAt).toBeNull();
  });

  it("leaves money as the string it arrived as", () => {
    // The one field that is *not* converted, and the reason: parsing it is the
    // first step toward adding it up, and float arithmetic on Rappen is the
    // error this codebase refuses to make.
    const project = toProject(dto);
    expect(project.contractValue).toBe("1450000.00");
    expect(typeof project.contractValue).toBe("string");
  });

  it("narrows the open strings to the closed unions", () => {
    const project = toProject(dto);
    expect(project.status).toBe("ACTIVE");
    expect(project.health).toBe("AMBER");
    expect(project.currentPhase).toBe("P41");
  });

  it("falls back on an unknown value and says so", () => {
    // Throwing would blank a list because one row came from a newer server;
    // leaving it a string would push the problem into every switch.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const project = toProject({ ...dto, status: "FERTIG" });
    expect(project.status).toBe("PLANNED");
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain("FERTIG");
  });

  it("treats an unknown nullable as absent rather than as a wrong value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(toProject({ ...dto, currentPhase: "P99" }).currentPhase).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("copies the nested records rather than sharing them with the cache", () => {
    // An entity that shares an object with its wire shape is one mutation away
    // from changing what another screen is reading.
    const project = toProject(dto);
    expect(project.customer).not.toBe(dto.customer);
    expect(project.customer).toEqual(dto.customer);
  });

  it("drops a transition it does not recognise instead of substituting one", () => {
    // The one place the fallback strategy is wrong: offering the wrong button
    // is worse than offering one fewer.
    const detail: ProjectDetailDto = {
      ...dto,
      description: null,
      notes: null,
      architect: null,
      members: [],
      disciplines: [],
      milestones: [],
      allowedTransitions: ["ON_HOLD", "VERSCHOBEN", "COMPLETED"],
    };
    expect(toProjectDetail(detail).allowedTransitions).toEqual(["ON_HOLD", "COMPLETED"]);
  });

  it("fills every status in the stats, including the ones with no rows", () => {
    // `/projects/stats` groups by status, so a fresh database sends one key.
    // The chips read this map directly and `undefined` renders as nothing where
    // 0 is the truthful answer.
    const stats = toProjectStats({ total: 2, byStatus: { ACTIVE: 2 } });
    expect(stats.byStatus.ACTIVE).toBe(2);
    expect(stats.byStatus.ARCHIVED).toBe(0);
    expect(Object.keys(stats.byStatus)).toHaveLength(6);
  });

  it("maps a milestone's dates", () => {
    const milestone = toMilestone({
      id: "s1",
      name: "Abgabe",
      dueDate: "2026-05-01T00:00:00.000Z",
      metAt: null,
      status: "AT_RISK",
      phase: "P32",
      isBillingTrigger: true,
    });
    expect(milestone.dueDate).toBeInstanceOf(Date);
    expect(milestone.metAt).toBeNull();
    expect(milestone.status).toBe("AT_RISK");
  });
});

describe("inbound: entity → request body", () => {
  it("formats a date in local time, not UTC", () => {
    // `toISOString().slice(0, 10)` would shift a date created in Zürich back a
    // day for most of the year, and the day it lands on is a deadline.
    const first = new Date(2026, 2, 1); // 1 March, local
    expect(toDatePart(first)).toBe("2026-03-01");
  });

  it("keeps undefined and null apart", () => {
    // The whole reason PATCH works. `undefined` is "not supplied", `null` is
    // "clear it", and a naive spread destroys the distinction.
    expect(toDatePart(undefined)).toBeUndefined();
    expect(toDatePart(null)).toBeNull();
  });

  it("omits every key that was not supplied, but never the version", () => {
    const body = toUpdateBody({ expectedVersion: 3, name: "Anders" });
    expect(body).toEqual({ expectedVersion: 3, name: "Anders" });
    expect("managerId" in body).toBe(false);
    expect("startDate" in body).toBe(false);
  });

  it("always carries the version the screen read", () => {
    // The optimistic lock (F13). `defined()` drops `undefined` keys and this one
    // is never undefined, because the type requires it — which is the whole
    // reason it is required rather than optional: a lock a caller may omit is
    // one every caller omits exactly once, and the failure is a silent
    // overwrite nobody can detect afterwards.
    expect(toUpdateBody({ expectedVersion: 7 }).expectedVersion).toBe(7);
    expect(toUpdateBody({ expectedVersion: 1, versionNote: "Baustopp" }).versionNote).toBe(
      "Baustopp",
    );
    // An absent note is omitted rather than sent as an empty string.
    expect("versionNote" in toUpdateBody({ expectedVersion: 1 })).toBe(false);
  });

  it("sends an explicit null to clear a link", () => {
    const body = toUpdateBody({ expectedVersion: 3, managerId: null, plannedEndDate: null });
    expect(body.managerId).toBeNull();
    expect(body.plannedEndDate).toBeNull();
  });

  it("turns a null into omission on create, where there is nothing to clear", () => {
    const body = toCreateBody({ name: "Neu", customerId: "c1", buildingId: null });
    expect(body).toEqual({ name: "Neu", customerId: "c1" });
  });

  it("converts the dates on create", () => {
    const body = toCreateBody({
      name: "Neu",
      customerId: "c1",
      startDate: new Date(2026, 3, 1),
      plannedEndDate: new Date(2026, 9, 1),
    });
    expect(body.startDate).toBe("2026-04-01");
    expect(body.plannedEndDate).toBe("2026-10-01");
  });

  it("passes money through as the string it is", () => {
    const body = toCreateBody({ name: "Neu", customerId: "c1", contractValue: "250000.00" });
    expect(body.contractValue).toBe("250000.00");
  });

  it("drops an absent reason from a status change", () => {
    expect(toStatusBody({ status: "ON_HOLD" })).toEqual({ status: "ON_HOLD" });
    expect(toStatusBody({ status: "ON_HOLD", reason: "Baustopp" })).toEqual({
      status: "ON_HOLD",
      reason: "Baustopp",
    });
  });

  it("keeps a fee share of 0 and an override of false", () => {
    // Both are falsy and both are real states. A Gewerk carrying no fee is not
    // the same as one whose fee was not supplied.
    const body = toScopeBody({ disciplineId: "d1", feeShare: 0, feeShareOverride: false });
    expect(body.feeShare).toBe(0);
    expect(body.feeShareOverride).toBe(false);
  });

  it("converts a member's start date and omits an absent one", () => {
    expect(toMemberBody({ employeeId: "e1" })).toEqual({ employeeId: "e1" });
    expect(toMemberBody({ employeeId: "e1", from: new Date(2026, 1, 1) }).from).toBe("2026-02-01");
  });

  it("sends null to take a milestone out of a phase", () => {
    // `""` is how a select says "none"; the domain says `null`, and the two are
    // not the same value — the empty string would fail the enum check.
    expect(toMilestoneUpdateBody({ phase: null }).phase).toBeNull();
    expect("phase" in toMilestoneUpdateBody({ status: "MET" })).toBe(false);
  });
});
