import type { Prisma } from "@prisma/client";

/**
 * "The projects this employee is on", as one predicate every module shares.
 *
 * It was written out six times — in the project, task, meeting, decision,
 * drawing and transmittal scopes — and all six had the same gap: membership
 * was `members.some({ employeeId, deletedAt: null })`, which **ignored
 * `ProjectMember.to`**. Somebody whose time on a project had ended kept
 * reading it, its tasks, its protocols, its decisions and its plans until the
 * membership row was deleted by hand (`docs/COMPLETE_APPLICATION_AUDIT.md`
 * Part 8, R9). `drawings.scope.ts` names "seeing a plan after leaving the
 * project" as precisely the leak its scope exists to close.
 *
 * ## The validity rule
 *
 * A membership grants access **while it has not ended**: `to` is empty, or
 * `to` is today or later. The end date is inclusive — somebody whose last day
 * is the 30th still works on the 30th — so the comparison is against the
 * start of the current UTC day, which is how the dashboard's date pickers
 * store a date.
 *
 * **`from` is deliberately not enforced.** Staffing is planned ahead: a person
 * joining next month is added now and needs to read the project to prepare for
 * it. Refusing them until the first day would push the planning into e-mail.
 * That is a business rule, written here so it is a decision rather than an
 * omission; `membership.scope.test.ts` pins both halves.
 *
 * Being the project's **manager** is not a membership and has no end date: a
 * manager changes by editing the project, which takes effect at once.
 */
export function activeMembership(
  employeeId: string,
  now: Date = new Date(),
): Prisma.ProjectMemberWhereInput {
  return {
    employeeId,
    deletedAt: null,
    OR: [{ to: null }, { to: { gte: startOfUtcDay(now) } }],
  };
}

/** The projects an employee manages or is currently a member of. */
export function reachableProject(
  employeeId: string,
  now: Date = new Date(),
): Prisma.ProjectWhereInput {
  return {
    deletedAt: null,
    OR: [{ managerId: employeeId }, { members: { some: activeMembership(employeeId, now) } }],
  };
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
