import { describe, expect, it } from "vitest";
import type { AuthUser } from "../common/decorators";
import { scopeFor, seesAllProjects } from "./projects.scope";

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
  it("is empty for someone unrestricted", () => {
    expect(scopeFor(user(["project.readAll"]), "e1")).toEqual({});
    expect(scopeFor(user([], true), null)).toEqual({});
  });

  it("narrows to managed or member projects", () => {
    expect(scopeFor(user(["project.read"]), "e1")).toEqual({
      OR: [{ managerId: "e1" }, { members: { some: { employeeId: "e1", deletedAt: null } } }],
    });
  });

  it("excludes a membership that has been removed", () => {
    // `deletedAt: null` inside the `some`. Without it, taking somebody off a
    // project would leave them able to read it — which is precisely the kind of
    // omission a soft delete invites and which no screen would ever reveal.
    const scope = scopeFor(user(["project.read"]), "e1") as {
      OR: [unknown, { members: { some: { deletedAt: null } } }];
    };
    expect(scope.OR[1].members.some.deletedAt).toBeNull();
  });

  it("shows nothing to a restricted user with no employee record", () => {
    // An empty result, not a 403: a user who is on no projects and a user who
    // has no employee row should get the same answer, or the difference leaks.
    expect(scopeFor(user(["project.read"]), null)).toEqual({ id: "" });
  });

  it("never returns an empty object for a restricted user", () => {
    // The assertion that matters most in the file. `{}` means *no filter*, so a
    // bug that returned it would hand the whole firm's book to everyone, and
    // the symptom — more rows than expected — is one nobody reports.
    for (const employeeId of ["e1", null]) {
      expect(scopeFor(user(["project.read"]), employeeId)).not.toEqual({});
    }
  });
});
