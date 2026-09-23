import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/decorators";
import { reachableProject } from "../core/scope/membership.scope";
import { nothing, restrictedTo, unrestricted, type Scope } from "../core/scope/scope";

export type DrawingScope = Scope<Prisma.DrawingWhereInput>;
export type TransmittalScope = Scope<Prisma.TransmittalWhereInput>;

/**
 * Row-level visibility for Pläne and Planversand.
 *
 * **Simpler than the meeting rule, and the simplification is the decision.**
 * `Drawing.projectId` is *required* — there is no such thing as a plan without a
 * project, unlike a task or an internal meeting — so the union collapses to one
 * clause: the projects this caller can reach.
 *
 * That is worth stating because the two modules before it both needed a union of
 * three or four reachability rules, and copying that shape here would have been
 * deriving the pattern rather than the reasoning. A `createdById` clause would
 * let somebody keep seeing a plan after leaving the project, which is precisely
 * the leak the scope exists to close.
 *
 * ---
 *
 * **There is no attendance-style widening, and the absence is deliberate.**
 * `meetings.scope.ts` lets somebody read minutes of a meeting they sat in, on
 * the grounds that a protocol nobody can read is a protocol people ask for by
 * e-mail. A plan is the opposite case: having *received* a plan is exactly the
 * situation where continued access has to be a decision somebody made, because
 * the recipients are contractors and consultants. `TransmittalRecipient` is a
 * record of what was sent, not a grant.
 *
 * `drawing.readAll` widens to the firm's whole book, as the three modules before
 * it do.
 */

export function seesAllDrawings(user: AuthUser): boolean {
  return user.isSuperAdmin || user.permissions.has("drawing.readAll");
}

/**
 * The `where` fragment for this caller, or `{}` when unrestricted.
 *
 * `{ projectId: "" }` for a restricted caller with no employee record — the same
 * shape `projects.scope.ts` and `meetings.scope.ts` use, and correct for the
 * same reason: a caller legitimately on no project and a caller with no employee
 * row get the same empty list, because a 403 would leak that the distinction
 * exists.
 */
export function scopeFor(user: AuthUser, employeeId: string | null): DrawingScope {
  if (seesAllDrawings(user)) {
    return unrestricted(user.isSuperAdmin ? "Super Admin" : "drawing.readAll");
  }
  if (!employeeId) return nothing();
  // Managing the project, or a membership that has not ended — so the leak
  // this file names (a plan still visible after leaving the project) is now
  // closed for an *ended* membership as well as a removed one.
  return restrictedTo({ project: reachableProject(employeeId) });
}

/**
 * Planversand, scoped by the same projects.
 *
 * A separate function rather than a cast, because the two `WhereInput` types are
 * structurally similar and assigning one to the other compiles — which is how a
 * scope silently stops narrowing. `updateMany` taught this codebase that lesson
 * once already.
 *
 * **`transmittal.readAll` does not exist.** A Planversand is always about a
 * project, so which ones a caller may see is already answered by which projects
 * they may see — the same argument `seesAllDecisions` makes for reading
 * `project.readAll` rather than minting a key that means the same thing.
 */
export function transmittalScopeFor(user: AuthUser, employeeId: string | null): TransmittalScope {
  if (user.isSuperAdmin || user.permissions.has("project.readAll")) {
    return unrestricted(user.isSuperAdmin ? "Super Admin" : "project.readAll");
  }
  if (!employeeId) return nothing();
  return restrictedTo({ project: reachableProject(employeeId) });
}
