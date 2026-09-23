import { describe, expect, it } from "vitest";
import type { AuthUser } from "../common/decorators";
import { scopeFor, seesAllProjects } from "./projects.scope";
import { whereOf } from "../core/scope/scope";

/**
 * Row-level visibility — the `◐` rules `permissions.md` states and nothing has
 * been able to test until now.
 *
 * The gate asks for them tested, and this is why they were made a pure function
 * of `(user, employeeId)`: a rule expressed as a `where` fragment can be
 * asserted exactly, without a database and without a request. A rule expressed
 * as a post-filter over results could only have been tested by fetching some.
 */

const user = (permissions: string[], isSuperAdmin = false): AuthUser => ({
  id: "u1",
  email: "a@iem.ch",
  name: "A",
  roles: [],
  permissions: new Set(permissions),
  isSuperAdmin,
});

describe("seesAllProjects", () => {
  it("is true for a Super Admin, by role", () => {
    // Never by "holds every permission" — that is the rule rbac already states,
    // and a Super Admin with a permission revoked must not silently narrow.
    expect(seesAllProjects(user([], true))).toBe(true);
  });

  it("is true with project.readAll", () => {
    expect(seesAllProjects(user(["project.read", "project.readAll"]))).toBe(true);
  });

  it("is false with project.read alone", () => {
    // The distinction the two permissions exist for: `read` opens the module,
    // `readAll` opens the firm's book.
    expect(seesAllProjects(user(["project.read"]))).toBe(false);
  });
});

describe("scopeFor", () => {
  it("is unrestricted — by name, with a reason — for someone who sees all", () => {
    for (const [u, because] of [
      [user(["project.readAll"]), "project.readAll"],
      [user([], true), "Super Admin"],
    ] as const) {
      const scope = scopeFor(u, "e1");
      expect(scope.kind).toBe("unrestricted");
      expect(scope.because).toBe(because);
      expect(whereOf(scope)).toEqual({});
    }
  });

  it("narrows to managed projects or memberships that have not ended", () => {
    const scope = scopeFor(user(["project.read"]), "e1");
    expect(scope.kind).toBe("restricted");
    const where = whereOf(scope) as {
      deletedAt: null;
      OR: [{ managerId: string }, { members: { some: Record<string, unknown> } }];
    };
    expect(where.OR[0]).toEqual({ managerId: "e1" });
    const membership = where.OR[1].members.some;
    expect(membership.employeeId).toBe("e1");
    // Removed memberships (soft delete) and ended ones (`to` in the past) both
    // grant nothing — the second was missing until P0 (Part 8, R9).
    expect(membership.deletedAt).toBeNull();
    expect(membership.OR).toEqual([{ to: null }, { to: { gte: expect.any(Date) } }]);
  });

  it("shows nothing to a restricted user with no employee record", () => {
    // An empty result, not a 403: a user who is on no projects and a user who
    // has no employee row should get the same answer, or the difference leaks.
    const scope = scopeFor(user(["project.read"]), null);
    expect(scope.kind).toBe("nothing");
    expect(whereOf(scope)).toEqual({ id: "" });
  });

  it("never gives a restricted user an empty predicate", () => {
    // The assertion that matters most in the file. `{}` means *no filter*, so a
    // bug that returned it would hand the whole firm's book to everyone, and
    // the symptom — more rows than expected — is one nobody reports.
    for (const employeeId of ["e1", null]) {
      expect(whereOf(scopeFor(user(["project.read"]), employeeId))).not.toEqual({});
    }
  });
});

/**
 * Write reach is firm-wide over *read* reach — documented, not fixed, in P0.
 *
 * `docs/COMPLETE_APPLICATION_AUDIT.md` Part 8 R10: any member of a project who
 * holds `project.update` may edit it; the scope decides reach, the key decides
 * the verb. Narrowing writes to *managed* projects is a business-model change
 * for a later phase. This pins today's boundary so a change in either direction
 * shows up here as a decision.
 */
describe("write reach (current boundary, pinned)", () => {
  it("is exactly the read scope — there is no separate write predicate", async () => {
    const mod = await import("./projects.scope");
    expect(Object.keys(mod).sort()).toEqual(["scopeFor", "seesAllProjects"]);
  });
});
