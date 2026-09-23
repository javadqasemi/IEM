import type { AuthUser } from "../common/decorators";
import {
  projectScopeFor,
  seesAllProjects as seesAll,
  type ProjectScope,
} from "../core/scope/project.scope";

export type { ProjectScope };

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
 * The rule itself now lives in `core/scope/project.scope.ts`, because the
 * modules that hang off a project need it too — on **create**, to refuse a
 * `projectId` the caller cannot reach (SEC-R7) — and a feature may not import
 * a sibling. This file keeps the argument and the names.
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
 * the `where` cannot be forgotten halfway: the repository **requires** it as a
 * `Scope` with no default, so omitting it does not compile, and "every project"
 * has to be asked for by name with `unrestricted(because)`. (This paragraph used
 * to say the repository defaulted to the narrow case. It defaulted to `{}` —
 * every row — which is SEC-R6; see `core/scope/scope.ts`.)
 *
 * **The one asymmetry, stated rather than discovered.** `scopeFor` narrows
 * reads. Writes are guarded by `project.update` and friends, which are
 * firm-wide — a Projektleiter with `project.update` may edit any project they
 * can *reach*, and reach is what this narrows. That is the intended model
 * (permissions.md §4), and it is worth being explicit because the alternative
 * reading — that the scope also restricts writes — is a reasonable thing to
 * assume and is not true. P0 leaves it so deliberately: narrowing writes to
 * the *managed* projects is a business-model change, recorded in
 * `docs/COMPLETE_APPLICATION_AUDIT.md` Part 8 (R10) and pinned by
 * `projects.scope.test.ts` so it cannot drift unnoticed either way.
 */

/**
 * Whether the caller sees everything.
 *
 * Super Admin short-circuits on the role, never on holding every permission:
 * that is the rule `rbac` already states, and repeating the *check* here rather
 * than the reasoning keeps one answer to "who is unrestricted".
 */
export function seesAllProjects(user: AuthUser): boolean {
  return seesAll(user);
}

/**
 * The scope for this caller.
 *
 * `employeeId` is the caller's `Employee` row, not their `User` id, and the two
 * are different keys — see the note on `Employee` in the schema. A user with no
 * employee record (an external auditor's account, a service login) and no
 * `readAll` sees **nothing**, which is the correct answer and not an error: the
 * scope is "projects I am on", and they are on none.
 *
 * "On" means managing it, or a membership that **has not ended** — see
 * `reachableProject` in `core/scope/membership.scope.ts`.
 */
export function scopeFor(user: AuthUser, employeeId: string | null): ProjectScope {
  return projectScopeFor(user, employeeId);
}
