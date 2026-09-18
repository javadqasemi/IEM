import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/decorators";

/**
 * Row-level visibility for tasks — and it is **not** the project rule with a
 * different table name.
 *
 * `projects.scope.ts` narrows to "the projects I manage or sit on", which works
 * because every project has a team. A task does not: `Task.projectId` is
 * nullable by design (the firm's own to-dos have no project), so a predicate
 * built only from project membership would make every firm-level task invisible
 * to everyone including the person it is assigned to. That is the failure this
 * file exists to avoid, and it is silent — an empty list looks like an empty
 * backlog.
 *
 * So the scope is a **union of three reachability rules**, and each one is a
 * separate answer to "why may this person see this task":
 *
 * | | |
 * | --- | --- |
 * | It is on a project I am on | the project rule, reached through the relation |
 * | It is assigned to me | including when it has no project at all |
 * | I created it | a firm-level to-do somebody wrote for themselves |
 *
 * `task.readAll` is the separate grant that removes the narrowing, exactly as
 * `project.readAll` does — the same argument applies, and stating it as a
 * permission rather than as a role check keeps it in the catalogue where it is
 * grantable and auditable.
 *
 * ---
 *
 * **Why a `where` fragment and not a filter over results.** The same three
 * reasons `projects.scope.ts` gives: a post-filter produces a page of eleven
 * rows out of twenty-five, a `total` that counts rows nobody can open, and a
 * leak in any query that forgot it. The repository takes the fragment as an
 * argument and **defaults to the narrow case**, so a query that forgets it
 * returns the caller's own tasks rather than the firm's.
 *
 * **The asymmetry, stated rather than discovered.** This narrows *reads*.
 * Writes are guarded by `task.update` and friends, which are firm-wide — and
 * the one exception is deliberate: `task.updateOwn` lets an engineer move their
 * own card without being able to edit anybody else's. That is checked in the
 * service, because it depends on the row.
 */

/** Whether the caller sees every task in the firm. */
export function seesAllTasks(user: AuthUser): boolean {
  return user.isSuperAdmin || user.permissions.has("task.readAll");
}

/**
 * The `where` fragment for this caller, or `{}` when unrestricted.
 *
 * `employeeId` is the caller's `Employee` row and `userId` their login, and
 * **both are needed** — which is the trap this signature exists to make
 * impossible to fall into. A task is *assigned* to an employee and *created by*
 * a user, because `Task.createdById` is a user id like every other
 * `createdById` in the schema while `Task.assigneeId` is an employee id like
 * every other assignment in the domain. Passing one where the other belongs
 * compiles, matches nothing, and reads as "this person has no tasks".
 *
 * A user with no employee record still sees what they created. That is the case
 * `projects.scope.ts` answers with `{ id: "" }` — there, somebody with no
 * employee row is on no project and the empty answer is correct. Here it is
 * not: an administrator without an `Employee` row legitimately writes
 * themselves a to-do, and hiding it the moment they saved it would be the
 * module's most confusing bug.
 */
export function scopeFor(
  user: AuthUser,
  employeeId: string | null,
  userId: string,
): Prisma.TaskWhereInput {
  if (seesAllTasks(user)) return {};

  const reachable: Prisma.TaskWhereInput[] = [{ createdById: userId }];

  if (employeeId) {
    reachable.push({ assigneeId: employeeId });
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

/**
 * Whether this caller may write *this* task, given they hold `task.updateOwn`
 * and not `task.update`.
 *
 * The narrow grant, and it is narrow on purpose: an engineer moves their own
 * card across the board and ticks their own checklist. It is **not** the read
 * scope — being able to see a project's board does not make every card on it
 * yours — so it is a smaller test than `scopeFor` rather than the same one, and
 * writing it as "can read it" would quietly grant every engineer edit rights to
 * their whole project's backlog.
 */
export function ownsTask(
  task: { assigneeId: string | null; createdById: string | null },
  employeeId: string | null,
  userId: string,
): boolean {
  if (employeeId && task.assigneeId === employeeId) return true;
  return task.createdById === userId;
}
