import { describe, expect, it } from "vitest";
import type { AuthUser } from "../common/decorators";
import { ownsTask, scopeFor, seesAllTasks } from "./tasks.scope";
import { whereOf } from "../core/scope/scope";
import { reachableProject } from "../core/scope/membership.scope";

/**
 * Row-level visibility, as a predicate.
 *
 * Tested here as a *shape* — `security.spec.ts` asserts the same rules against
 * the live API with real roles, and the two are both needed: this one proves the
 * fragment is right, that one proves it reaches Prisma. Neither can do the
 * other's job, and the failure mode they guard against is the same and is
 * silent. A wrong fragment returns a list; a right fragment that never arrives
 * also returns a list.
 */

const user = (permissions: string[], overrides: Partial<AuthUser> = {}): AuthUser =>
  ({
    id: "u1",
    email: "a@iem.ch",
    name: "A",
    isSuperAdmin: false,
    permissions: new Set(permissions),
    ...overrides,
  }) as AuthUser;

describe("seesAllTasks", () => {
  it("is true for a super admin", () => {
    // Short-circuits on the role, never on holding every permission — the rule
    // `rbac` already states, repeated as a check rather than as reasoning.
    expect(seesAllTasks(user([], { isSuperAdmin: true }))).toBe(true);
  });

  it("is true with task.readAll", () => {
    expect(seesAllTasks(user(["task.read", "task.readAll"]))).toBe(true);
  });

  it("is false with task.read alone", () => {
    // The whole point of the split: `read` opens the module, `readAll` widens
    // it. A role editor can see and grant the difference.
    expect(seesAllTasks(user(["task.read"]))).toBe(false);
  });
});

describe("scopeFor", () => {
  it("returns an empty fragment for the unrestricted", () => {
    expect(whereOf(scopeFor(user(["task.readAll"]), "e1", "u1"))).toEqual({});
  });

  it("is a union of three reachability rules", () => {
    /**
     * **Not the project rule with a different table name**, which is the whole
     * reason this file exists. `Task.projectId` is nullable, so a predicate
     * built only from project membership would make every firm-level task
     * invisible to everyone — including the person it is assigned to. The
     * failure is silent: an empty list looks like an empty backlog.
     */
    const where = whereOf(scopeFor(user(["task.read"]), "e1", "u1"));
    expect(where.OR).toHaveLength(3);
    expect(where.OR).toContainEqual({ createdById: "u1" });
    expect(where.OR).toContainEqual({ assigneeId: "e1" });
  });

  it("reaches a task through its project's team", () => {
    const where = whereOf(scopeFor(user(["task.read"]), "e1", "u1"));
    const viaProject = where.OR!.find((clause) => "project" in clause)!;
    // The shared predicate: managing it, or a membership that has not ended.
    expect(viaProject).toEqual({ project: reachableProject("e1") });
  });

  it("excludes a deleted project from the reachable set", () => {
    // Without `deletedAt: null` on the project, a soft-deleted project's tasks
    // would stay visible to its former team — which reads as the deletion having
    // silently failed.
    const where = whereOf(scopeFor(user(["task.read"]), "e1", "u1"));
    const viaProject = where.OR!.find((clause) => "project" in clause) as {
      project: { deletedAt: null };
    };
    expect(viaProject.project.deletedAt).toBeNull();
  });

  it("still shows a user with no employee record what they created", () => {
    /**
     * The case `projects.scope.ts` answers with `{ id: "" }` and this one must
     * not. There, somebody without an `Employee` row is on no project and the
     * empty answer is correct. Here an administrator without one legitimately
     * writes themselves a to-do, and hiding it the moment they saved it would be
     * the module's most confusing bug.
     */
    const where = whereOf(scopeFor(user(["task.read"]), null, "u1"));
    expect(where.OR).toEqual([{ createdById: "u1" }]);
  });

  it("does not confuse the employee id with the user id", () => {
    /**
     * The trap the three-argument signature exists to make visible. A task is
     * *assigned* to an `Employee` and *created by* a `User`, because
     * `Task.createdById` is a user id like every other `createdById` in the
     * schema while `Task.assigneeId` is an employee id like every other
     * assignment in the domain. Passing one where the other belongs compiles,
     * matches nothing, and reads as "this person has no tasks".
     */
    const where = whereOf(scopeFor(user(["task.read"]), "employee-1", "user-1"));
    expect(where.OR).toContainEqual({ assigneeId: "employee-1" });
    expect(where.OR).toContainEqual({ createdById: "user-1" });
    expect(where.OR).not.toContainEqual({ assigneeId: "user-1" });
    expect(where.OR).not.toContainEqual({ createdById: "employee-1" });
  });
});

describe("ownsTask", () => {
  it("is true for the assignee", () => {
    expect(ownsTask({ assigneeId: "e1", createdById: "u9" }, "e1", "u1")).toBe(true);
  });

  it("is true for the author", () => {
    expect(ownsTask({ assigneeId: "e9", createdById: "u1" }, "e1", "u1")).toBe(true);
  });

  it("is false for a colleague on the same project", () => {
    /**
     * **Narrower than the read scope, deliberately.** Seeing a project's board
     * does not make every card on it yours — writing this as "can read it" would
     * quietly grant every engineer edit rights over their whole project's
     * backlog, which is exactly the grant `task.updateOwn` was split out to
     * avoid.
     */
    expect(ownsTask({ assigneeId: "e9", createdById: "u9" }, "e1", "u1")).toBe(false);
  });

  it("is false for an unassigned task the caller did not create", () => {
    expect(ownsTask({ assigneeId: null, createdById: "u9" }, "e1", "u1")).toBe(false);
  });

  it("does not match a null assignee against a null employee id", () => {
    // A user with no `Employee` row must not own every unassigned task in the
    // firm, which is what a plain `task.assigneeId === employeeId` would do.
    expect(ownsTask({ assigneeId: null, createdById: "u9" }, null, "u1")).toBe(false);
  });
});
