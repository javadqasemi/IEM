import { describe, expect, it } from "vitest";
import type { AuthUser } from "../common/decorators";
import { scopeFor, seesAllDrawings, transmittalScopeFor } from "./drawings.scope";

/**
 * Row-level visibility, as a `where` fragment.
 *
 * **Never a filter over results**, which is the rule `projects.scope.ts` states
 * and the reason this is a pure function with a test rather than a branch in a
 * service: filtering after the fetch gives a page of eleven rows out of
 * twenty-five, a total that counts rows nobody can open, and a leak in any
 * query that forgot the post-filter.
 */

function user(over: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1",
    email: "a@b.ch",
    isSuperAdmin: false,
    permissions: new Set<string>(),
    ...over,
  } as AuthUser;
}

describe("seesAllDrawings", () => {
  it("is true for a super admin", () => {
    expect(seesAllDrawings(user({ isSuperAdmin: true }))).toBe(true);
  });

  it("is true for the widening grant", () => {
    expect(seesAllDrawings(user({ permissions: new Set(["drawing.readAll"]) }))).toBe(true);
  });

  /**
   * The asymmetry worth asserting: `drawing.read` **opens the module** and
   * narrows nothing. Somebody who confuses the two writes a guard that lets
   * `read` see everything.
   */
  it("is false for drawing.read alone", () => {
    expect(seesAllDrawings(user({ permissions: new Set(["drawing.read"]) }))).toBe(false);
  });
});

describe("scopeFor", () => {
  it("is unrestricted for a caller who sees everything", () => {
    expect(scopeFor(user({ isSuperAdmin: true }), "e1")).toEqual({});
  });

  /**
   * A single clause, and the simplification is the module's decision.
   *
   * `Drawing.projectId` is **required** — unlike a task or an internal meeting
   * — so the union of three or four reachability rules the two modules before
   * this one needed collapses to one. Copying their shape would have been
   * deriving the pattern rather than the reasoning, and a `createdById` clause
   * would let somebody keep seeing a plan after leaving the project.
   */
  it("narrows to the caller's projects and nothing else", () => {
    const where = scopeFor(user({ permissions: new Set(["drawing.read"]) }), "e1");

    expect(where).toEqual({
      project: {
        deletedAt: null,
        OR: [{ managerId: "e1" }, { members: { some: { employeeId: "e1", deletedAt: null } } }],
      },
    });
  });

  it("has no createdBy clause, so leaving a project ends access", () => {
    const where = scopeFor(user({ permissions: new Set(["drawing.read"]) }), "e1");
    expect(JSON.stringify(where)).not.toContain("createdById");
  });

  /**
   * A caller with no employee row gets an empty list rather than an error.
   *
   * `{ projectId: "" }` matches nothing. A 403 would leak that the distinction
   * between "on no project" and "has no employee record" exists.
   */
  it("matches nothing when the caller has no employee record", () => {
    expect(scopeFor(user({ permissions: new Set(["drawing.read"]) }), null)).toEqual({
      projectId: "",
    });
  });

  it("excludes deleted projects", () => {
    const where = scopeFor(user(), "e1") as { project?: { deletedAt?: unknown } };
    expect(where.project?.deletedAt).toBeNull();
  });
});

describe("transmittalScopeFor", () => {
  /**
   * **Reads `project.readAll`, not a `transmittal.readAll`.**
   *
   * A Planversand is always about a project, so which ones a caller may see is
   * already answered by which projects they may see. A second widening key
   * would be one more row in the role editor meaning the same thing — the
   * argument `seesAllDecisions` makes one module earlier.
   */
  it("widens on the project grant", () => {
    expect(transmittalScopeFor(user({ permissions: new Set(["project.readAll"]) }), "e1")).toEqual(
      {},
    );
  });

  it("does not widen on drawing.readAll", () => {
    // Deliberate: seeing every plan is not the same as seeing every Planversand,
    // which carries who received what.
    const where = transmittalScopeFor(user({ permissions: new Set(["drawing.readAll"]) }), "e1");
    expect(where).not.toEqual({});
  });

  it("narrows to the caller's projects", () => {
    expect(transmittalScopeFor(user(), "e1")).toEqual({
      project: {
        deletedAt: null,
        OR: [{ managerId: "e1" }, { members: { some: { employeeId: "e1", deletedAt: null } } }],
      },
    });
  });

  it("matches nothing without an employee record", () => {
    expect(transmittalScopeFor(user(), null)).toEqual({ projectId: "" });
  });

  /**
   * The two functions return structurally similar objects, and assigning one
   * where the other belongs compiles. That is how a scope silently stops
   * narrowing — `updateMany` taught this codebase the lesson once already — so
   * they are separate functions rather than one with a cast.
   */
  it("is a separate function from the drawing scope, not a cast", () => {
    expect(transmittalScopeFor).not.toBe(scopeFor);
  });
});
