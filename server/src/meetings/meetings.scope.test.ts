import { describe, expect, it } from "vitest";
import type { AuthUser } from "../common/decorators";
import {
  decisionScopeFor,
  scopeFor,
  seesAllDecisions,
  seesAllMeetings,
} from "./meetings.scope";
import { whereOf } from "../core/scope/scope";
import { reachableProject } from "../core/scope/membership.scope";

/**
 * Row-level visibility, as a predicate.
 *
 * The two rules worth the file are the ones that differ from the modules
 * before it: **attendance** widens the meeting scope, and **decisions do not
 * use it**. Both are decisions rather than oversights, and both are invisible
 * from the code that calls them.
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

describe("seesAllMeetings", () => {
  it("is true for a super admin", () => {
    expect(seesAllMeetings(user([], { isSuperAdmin: true }))).toBe(true);
  });

  it("is true with meeting.readAll and false with meeting.read alone", () => {
    expect(seesAllMeetings(user(["meeting.read", "meeting.readAll"]))).toBe(true);
    expect(seesAllMeetings(user(["meeting.read"]))).toBe(false);
  });
});

describe("scopeFor", () => {
  it("returns an empty fragment for the unrestricted", () => {
    expect(whereOf(scopeFor(user(["meeting.readAll"]), "e1", "u1"))).toEqual({});
  });

  it("is a union of four reachability rules", () => {
    const where = whereOf(scopeFor(user(["meeting.read"]), "e1", "u1"));
    expect(where.OR).toHaveLength(4);
    expect(where.OR).toContainEqual({ createdById: "u1" });
    expect(where.OR).toContainEqual({ organiserId: "e1" });
  });

  it("lets somebody who sat in the room read the minutes", () => {
    /**
     * **The rule that makes a protocol work**, and the addition Tasks did not
     * need. A Bausitzung has a specialist consultant and the Bauherr's engineer
     * in the room; minutes they cannot read are minutes they will ask for by
     * e-mail, which is where the record stops being the record.
     */
    const where = whereOf(scopeFor(user(["meeting.read"]), "e1", "u1"));
    expect(where.OR).toContainEqual({
      attendees: { some: { employeeId: "e1", deletedAt: null } },
    });
  });

  it("reaches a meeting through its project's team", () => {
    const where = whereOf(scopeFor(user(["meeting.read"]), "e1", "u1"));
    // The shared predicate: managing it, or a membership that has not ended.
    expect(where.OR).toContainEqual({ project: reachableProject("e1") });
  });

  it("still shows a user with no employee record what they created", () => {
    /**
     * An internal meeting called by somebody with no `Employee` row — an
     * administrator — would otherwise vanish the moment they saved it.
     * `Meeting.projectId` is nullable, so the project rule cannot reach it.
     */
    const where = whereOf(scopeFor(user(["meeting.read"]), null, "u1"));
    expect(where.OR).toEqual([{ createdById: "u1" }]);
  });

  it("does not confuse the employee id with the user id", () => {
    /**
     * The trap the three-argument signature exists to make visible: an attendee
     * is an `Employee`, a `createdById` is a `User`. Passing one where the other
     * belongs compiles, matches nothing, and reads as "this person has no
     * meetings".
     */
    const where = whereOf(scopeFor(user(["meeting.read"]), "employee-1", "user-1"));
    expect(where.OR).toContainEqual({ organiserId: "employee-1" });
    expect(where.OR).toContainEqual({ createdById: "user-1" });
    expect(where.OR).not.toContainEqual({ organiserId: "user-1" });
    expect(where.OR).not.toContainEqual({ createdById: "employee-1" });
  });

  it("excludes a deleted project from the reachable set", () => {
    const where = whereOf(scopeFor(user(["meeting.read"]), "e1", "u1"));
    const viaProject = where.OR!.find((clause) => "project" in clause) as {
      project: { deletedAt: null };
    };
    expect(viaProject.project.deletedAt).toBeNull();
  });
});

describe("decisionScopeFor", () => {
  it("is widened by project.readAll rather than a key of its own", () => {
    /**
     * A decision is always about a project, so "which decisions may I see" is
     * already answered by "which projects may I see". A second widening key
     * would be one more row in the role editor meaning the same thing, and the
     * catalogue is meant to be readable.
     */
    expect(seesAllDecisions(user(["project.readAll"]))).toBe(true);
    expect(seesAllDecisions(user(["decision.read"]))).toBe(false);
    expect(whereOf(decisionScopeFor(user(["project.readAll"]), "e1"))).toEqual({});
  });

  it("is narrower than the meeting scope — attendance does not open a decision", () => {
    /**
     * **Deliberately not the same rule.** A decision outlives its meeting and is
     * cited by people who were never in that room, so "I attended" is the wrong
     * key for a record whose whole purpose is to be found later by project.
     * Somebody who needs a decision they cannot see needs access to the project.
     */
    const where = whereOf(decisionScopeFor(user(["decision.read"]), "e1"));
    expect(JSON.stringify(where)).not.toContain("attendees");
    expect(where).toEqual({ project: reachableProject("e1") });
  });

  it("returns nothing for a restricted caller with no employee record", () => {
    /**
     * `nothing()` rather than a thrown error — the shape `projects.scope.ts`
     * uses. A caller who is legitimately on no project and one with no
     * employee row get the same empty list; a 403 would leak that the
     * distinction exists.
     */
    expect(whereOf(decisionScopeFor(user(["decision.read"]), null))).toEqual({ id: "" });
  });
});
