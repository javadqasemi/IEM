import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../../common/decorators";
import { reachableProject } from "./membership.scope";
import { nothing, restrictedTo, unrestricted, type Scope } from "./scope";

/**
 * "Which projects can this caller reach" — the rule every project-owned module
 * asks, in one place.
 *
 * It lived only in `projects/projects.scope.ts`, and the modules that hang off
 * a project (tasks, meetings, decisions, drawings, transmittals) rebuilt their
 * *read* scopes from it but never asked it on **create**: `POST /tasks`,
 * `/meetings`, `/decisions` and `/drawings` accepted any `projectId`, so a
 * holder of the create key could write into a project they could not see, and
 * the error text told them whether the id existed
 * (`docs/COMPLETE_APPLICATION_AUDIT.md` SEC-R7). A feature may not import a
 * sibling feature, so the rule moved down to `core/` where all of them can
 * reach it; `projects.scope.ts` re-exports it and keeps the argument.
 */

export type ProjectScope = Scope<Prisma.ProjectWhereInput>;

/** Super Admin by role, or `project.readAll` — never by holding every key. */
export function seesAllProjects(user: AuthUser): boolean {
  return user.isSuperAdmin || user.permissions.has("project.readAll");
}

/**
 * The projects this caller can reach: all of them, the ones they manage or are
 * currently a member of, or none (no employee record).
 */
export function projectScopeFor(user: AuthUser, employeeId: string | null): ProjectScope {
  if (seesAllProjects(user)) {
    return unrestricted(user.isSuperAdmin ? "Super Admin" : "project.readAll");
  }
  // `nothing()` rather than an error: a caller legitimately on no project and a
  // caller with no employee row get the same answer, because a 403 would leak
  // that the distinction exists.
  if (!employeeId) return nothing();
  return restrictedTo(reachableProject(employeeId));
}

/**
 * The sentence for "you cannot put this there", identical for a project that
 * does not exist and one the caller cannot reach — the anti-enumeration
 * convention every `require()` in this codebase already follows with its 404.
 */
export const PROJECT_NOT_FOUND = "Projekt nicht gefunden.";
