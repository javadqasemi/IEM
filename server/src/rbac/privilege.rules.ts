/**
 * The privilege ceiling — who may hand out which authority.
 *
 * Pure: no Prisma, no Nest. Every write that changes what somebody else may do
 * — assigning roles, inviting with roles, creating or editing a role, and the
 * administrative acts on another account (suspend, delete, reset a factor,
 * end sessions, send a reset link) — asks one of the three questions below,
 * and nowhere else compares permission sets. `privilege.rules.test.ts` holds
 * the matrix.
 *
 * ---
 *
 * **The rule is containment, not rank.** An actor may grant a permission only
 * if they hold it themselves, and may administer an account only if they hold
 * every permission that account holds. `Role.rank` is *display order* (it says
 * so in `permissions.catalog.ts` and `roles.test.ts` asserts it is only
 * distinct, not ordered by authority): Geschäftsleitung sits at rank 5 above
 * Administrator at 10, and neither contains the other — Administrator manages
 * users and settings, Geschäftsleitung changes the legal identity and deletes
 * offices. A rank comparison would have let one of them escalate into the
 * other's authority whichever way it pointed. Containment answers "does this
 * make anyone stronger than the person doing it" directly.
 *
 * **Super Admin is outside the lattice.** It is marked by the role key, not by
 * holding every permission (the guard short-circuits on it for the reason
 * `permissions.catalog.ts` gives), so it is never "contained" by a permission
 * set and is therefore grantable and administrable by a Super Admin only. It
 * is named explicitly below rather than left to fall out of the subset check,
 * because the seed happens to write all 120 rows to the Super Admin role and
 * the check would pass or fail by that accident.
 *
 * **Before this existed** the only guards were "keep one Super Admin" and "a
 * Super Admin cannot drop their own role", so any holder of `user.assign` —
 * the seeded Administrator — could grant `super_admin` to anyone, themselves
 * included, and every decision to withhold restore, publishing and the legal
 * identity from that role was advisory. `docs/COMPLETE_APPLICATION_AUDIT.md`
 * SEC-R1.
 */

export const SUPER_ADMIN_ROLE = "super_admin";

/** What the rules need to know about whoever is acting, or being acted on. */
export type Principal = {
  isSuperAdmin: boolean;
  permissions: ReadonlySet<string>;
};

/** A role as the rules see it: its key, a name to put in a message, its keys. */
export type RoleGrant = {
  key: string;
  name: string;
  permissions: readonly string[];
};

/**
 * The permissions whose *grant* is a privilege change worth re-authenticating
 * for.
 *
 * Every key here confers authority over other people's access, over the
 * system's security controls, over what the public sees, or over bulk
 * personal data. Granting any of them — to an account through a role, or to a
 * role that people already hold — needs the actor's password again, through
 * the one `ReauthService` window every other security change uses.
 *
 * A list, not a flag on `resources.ts`, because it is a security judgement
 * about the catalogue rather than a property a module declares about itself —
 * the same reason `KNOWN_UNENFORCED` is a list in a test. It is checked
 * against the catalogue so a renamed key fails the build instead of silently
 * dropping out of the set.
 */
export const PRIVILEGED_PERMISSIONS: ReadonlySet<string> = new Set([
  // Other people's accounts
  "user.create",
  "user.update",
  "user.delete",
  "user.assign",
  "user.impersonate",
  "user.readSessions",
  "user.revokeSessions",
  "user.resetMfa",
  // The permission model itself
  "role.create",
  "role.update",
  "role.delete",
  // Security and system configuration
  "settings.update",
  "settings.secrets",
  "notification.configure",
  "system.backup",
  "system.restore",
  "system.api",
  "job.retry",
  "job.cancel",
  // The legal identity, and what the public sees
  "organisation.updateLegal",
  "content.publish",
  "content.unpublish",
  // Bulk personal data leaving the system
  "audit.export",
  "application.export",
  "application.download",
]);

/** A refusal is a sentence for the caller; `null` means allowed. */
export type Refusal = string | null;

/**
 * May `actor` hand out these roles?
 *
 * Used for `PUT /users/:id/roles` (the roles being *added*) and for an invite
 * (all of them). Only additions are judged here: taking a role away cannot
 * make anybody stronger, and whether the actor may touch the account at all is
 * `refuseAdminister`'s question, asked separately.
 */
export function refuseRoleGrant(actor: Principal, roles: readonly RoleGrant[]): Refusal {
  if (actor.isSuperAdmin) return null;

  for (const role of roles) {
    if (role.key === SUPER_ADMIN_ROLE) {
      return "Die Rolle „Super Admin“ kann nur ein Super Admin vergeben.";
    }
    const missing = role.permissions.filter((k) => !actor.permissions.has(k));
    if (missing.length) {
      return `Die Rolle „${role.name}“ enthält ${describe(missing)}, die Sie selbst nicht besitzen. Vergeben kann sie nur, wer diese Rechte hat.`;
    }
  }
  return null;
}

/**
 * May `actor` put these permissions into a role?
 *
 * For `POST /roles` and `PATCH /roles/:id`. The same containment rule as a
 * grant to a person, because adding a key to a role *is* granting it — to
 * everyone who holds the role, the actor possibly included. That is the route
 * the audit named: a custom role holding `role.update` adding `user.assign` to
 * itself, and then `super_admin` to its holder.
 */
export function refusePermissionGrant(actor: Principal, keys: readonly string[]): Refusal {
  if (actor.isSuperAdmin) return null;
  const missing = keys.filter((k) => !actor.permissions.has(k));
  if (missing.length) {
    return `Sie können nur Berechtigungen vergeben, die Sie selbst besitzen. Fehlend: ${missing
      .slice(0, 5)
      .join(", ")}${missing.length > 5 ? ` und ${missing.length - 5} weitere` : ""}.`;
  }
  return null;
}

/**
 * May `actor` edit or delete this role at all?
 *
 * A role that holds more than the actor is a role above them: changing its
 * name is harmless, but changing its permissions would let a lower role
 * narrow — or, combined with a later grant, reshape — a higher one. Super
 * Admin's own role is refused outright; its list is already locked in
 * `RbacService` and its authority does not come from the list anyway.
 */
export function refuseRoleEdit(actor: Principal, role: RoleGrant): Refusal {
  if (actor.isSuperAdmin) return null;
  if (role.key === SUPER_ADMIN_ROLE) {
    return "Die Rolle „Super Admin“ kann nur ein Super Admin ändern.";
  }
  const missing = role.permissions.filter((k) => !actor.permissions.has(k));
  if (missing.length) {
    return `Die Rolle „${role.name}“ enthält ${describe(missing)}, die Sie selbst nicht besitzen, und kann deshalb nur von jemandem mit diesen Rechten geändert werden.`;
  }
  return null;
}

/**
 * May `actor` act administratively on the account `target`?
 *
 * Asked before changing its roles, its status, deleting it, clearing its
 * second factor, ending its sessions or sending it a reset link. An account
 * that holds a permission the actor lacks is **above** them, and none of those
 * acts may be aimed upwards: suspending every Super Admin, or stripping
 * Geschäftsleitung's roles, is a lock-out even when it is not an escalation.
 *
 * Peers are allowed — one Administrator may suspend another — because the
 * question is containment, and an equal set contains itself. Acting on one's
 * own account is not this function's business: the self-demotion and
 * last-Super-Admin checks in `UsersService` cover it.
 */
export function refuseAdminister(actor: Principal, target: Principal): Refusal {
  if (actor.isSuperAdmin) return null;
  if (target.isSuperAdmin) {
    return "Ein Super-Admin-Konto kann nur von einem Super Admin verwaltet werden.";
  }
  const missing = [...target.permissions].filter((k) => !actor.permissions.has(k));
  if (missing.length) {
    return `Dieses Konto hat ${describe(missing)}, die Sie selbst nicht besitzen. Verwalten kann es nur, wer mindestens dieselben Rechte hat.`;
  }
  return null;
}

/**
 * Does this change need the actor's password again?
 *
 * `added` is the set of permissions the change *gives* to somebody who did
 * not have them — for a role assignment, the target's permissions after minus
 * before; for a role edit, the role's after minus before; for an invite,
 * everything. Anything touching Super Admin always does.
 *
 * Conditional rather than always, so that inviting a Content Editor or giving
 * somebody Viewer costs no prompt, and granting user administration always
 * does. The client does not have to know the rule: the server answers
 * `reauth_required` and the dialog appears.
 */
export function privilegeChangeNeedsReauth(
  added: Iterable<string>,
  touchesSuperAdmin: boolean,
): boolean {
  if (touchesSuperAdmin) return true;
  for (const key of added) if (PRIVILEGED_PERMISSIONS.has(key)) return true;
  return false;
}

/** The permissions a set of roles confers, as one set. */
export function permissionsOf(roles: readonly RoleGrant[]): Set<string> {
  const out = new Set<string>();
  for (const role of roles) for (const key of role.permissions) out.add(key);
  return out;
}

/** `after` minus `before`. */
export function added(before: ReadonlySet<string>, after: ReadonlySet<string>): string[] {
  return [...after].filter((k) => !before.has(k));
}

function describe(missing: readonly string[]): string {
  const shown = missing.slice(0, 3).join(", ");
  const rest = missing.length > 3 ? ` und ${missing.length - 3} weitere` : "";
  return missing.length === 1
    ? `die Berechtigung ${shown}`
    : `${missing.length} Berechtigungen (${shown}${rest})`;
}
