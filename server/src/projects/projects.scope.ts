import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/decorators";

/**
 * Row-level visibility: the `◐` in `docs/permissions.md`.
 *
 * `project.read` lets someone into the module. **It does not mean the firm's
 * whole book of work** — a Projektleiter sees the projects they manage or sit
 * on, and `project.readAll` is the separate grant that widens it. Expressing
 * that as a second permission rather than as a role check is what keeps the
 * rule in the catalogue, where it is grantable, auditable, and visible in the
 * role editor, instead of buried in a service where nobody can ask who has it.
 *
 * ---
 *
 * **Why this is a `where` fragment and not a filter over results.**
 *
 * Fetching a page and then removing the rows the caller may not see produces a
 * page of eleven rows out of twenty-five, a `total` that counts rows nobody can
 * open, and a paginator that skips. Worse, it is a rule applied *after* the
 * database — so any query that forgets the post-filter leaks, silently, and
 * looks exactly like a query that had nothing to hide. A predicate merged into
 * the `where` cannot be forgotten halfway: the repository takes it as an
 * argument and defaults to the *narrow* case, so a caller who omits it sees
 * their own projects rather than everyone's.
 *
 * **The one asymmetry, stated rather than discovered.** `scopeFor` narrows
 * reads. Writes are guarded by `project.update` and friends, which are
 * firm-wide — a Projektleiter with `project.update` may edit any project they
 * can *reach*, and reach is what this narrows. That is the intended model
 * (permissions.md §4), and it is worth being explicit because the alternative
 * reading — that the scope also restricts writes — is a reasonable thing to
 * assume and is not true.
 */

/**
 * Whether the caller sees everything.
 *
 * Super Admin short-circuits on the role, never on holding every permission:
 * that is the rule `rbac` already states, and repeating the *check* here rather
 * than the reasoning keeps one answer to "who is unrestricted".
 */
export function seesAllProjects(user: AuthUser): boolean {
  return user.isSuperAdmin || user.permissions.has("project.readAll");
}

/**
 * The `where` fragment for this caller, or `{}` when unrestricted.
 *
 * `employeeId` is the caller's `Employee` row, not their `User` id, and the two
 * are different keys — see the note on `Employee` in the schema. A user with no
 * employee record (an external auditor's account, a service login) and no
 * `readAll` sees **nothing**, which is the correct answer and not an error: the
 * scope is "projects I am on", and they are on none.
 */
export function scopeFor(user: AuthUser, employeeId: string | null): Prisma.ProjectWhereInput {
  if (seesAllProjects(user)) return {};
  if (!employeeId) {
    // `id: ""` rather than a thrown error. A caller who legitimately has no
    // projects and a caller who has no employee record should get the same
    // empty list; a 403 here would leak that the distinction exists.
    return { id: "" };
  }
  return {
    OR: [{ managerId: employeeId }, { members: { some: { employeeId, deletedAt: null } } }],
  };
}
