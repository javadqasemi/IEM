import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/decorators";

/**
 * Row-level visibility for meetings and decisions.
 *
 * **The same three-way union `tasks.scope.ts` needed, for the same reason and
 * with one addition.** `Meeting.projectId` is nullable — an internal
 * Geschäftsleitungssitzung is a meeting with minutes and no project — so a
 * predicate built only from project membership would hide every internal
 * meeting from everyone, including the person who called it.
 *
 * The addition is **attendance**: somebody who sat in a meeting may read its
 * minutes, whether or not they are on the project. That is not a convenience —
 * it is the only rule under which a protocol works. A Bausitzung has the
 * Bauherr's engineer and a specialist consultant in the room, and minutes they
 * cannot read are minutes they will ask for by e-mail, which is where the
 * record stops being the record.
 *
 * `meeting.readAll` widens it to the firm's whole book, exactly as
 * `project.readAll` and `task.readAll` do.
 *
 * ---
 *
 * **Decisions are scoped by their project and nothing else**, which is
 * deliberately *narrower* than the meeting rule above. A decision is always
 * about a project (`Decision.projectId` is required), it outlives the meeting
 * that recorded it, and it is cited by people who were never in that room — so
 * "I attended the meeting" is the wrong key for a record whose whole purpose is
 * to be found later by project. Somebody who needs a decision they cannot see
 * needs access to the project.
 */

export function seesAllMeetings(user: AuthUser): boolean {
  return user.isSuperAdmin || user.permissions.has("meeting.readAll");
}

/**
 * The `where` fragment for this caller, or `{}` when unrestricted.
 *
 * `employeeId` is the caller's `Employee` row and `userId` their login, and
 * **both are needed** — the trap `tasks.scope.ts` documents. An attendee is an
 * `Employee`; a `createdById` is a `User`. Passing one where the other belongs
 * compiles, matches nothing, and reads as "this person has no meetings".
 */
export function scopeFor(
  user: AuthUser,
  employeeId: string | null,
  userId: string,
): Prisma.MeetingWhereInput {
  if (seesAllMeetings(user)) return {};

  const reachable: Prisma.MeetingWhereInput[] = [{ createdById: userId }];

  if (employeeId) {
    reachable.push({ organiserId: employeeId });
    // Having been in the room. The rule that makes a protocol usable.
    reachable.push({ attendees: { some: { employeeId, deletedAt: null } } });
    reachable.push({
      project: {
        deletedAt: null,
        OR: [
          { managerId: employeeId },
          { members: { some: { employeeId, deletedAt: null } } },
        ],
      },
    });
  }

  return { OR: reachable };
}

export function seesAllDecisions(user: AuthUser): boolean {
  // Deliberately the *project* grant, not a `decision.readAll`.
  //
  // A decision is always about a project, so "which decisions may I see" is
  // already answered by "which projects may I see" — and a second widening key
  // would be one more row in the role editor that means the same thing. The
  // catalogue is meant to be readable; a key that duplicates another is noise.
  return user.isSuperAdmin || user.permissions.has("project.readAll");
}

/**
 * Decisions, scoped by the project they belong to.
 *
 * `{ projectId: "" }` for a restricted caller with no employee record — the
 * same shape `projects.scope.ts` uses, and correct for the same reason: a
 * caller who is legitimately on no project and a caller with no employee row
 * should get the same empty list, because a 403 would leak that the distinction
 * exists.
 */
export function decisionScopeFor(
  user: AuthUser,
  employeeId: string | null,
): Prisma.DecisionWhereInput {
  if (seesAllDecisions(user)) return {};
  if (!employeeId) return { projectId: "" };

  return {
    project: {
      deletedAt: null,
      OR: [{ managerId: employeeId }, { members: { some: { employeeId, deletedAt: null } } }],
    },
  };
}
