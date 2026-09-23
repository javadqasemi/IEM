import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS, SYSTEM_ROLES } from "./permissions.catalog";
import {
  PRIVILEGED_PERMISSIONS,
  SUPER_ADMIN_ROLE,
  added,
  permissionsOf,
  privilegeChangeNeedsReauth,
  refuseAdminister,
  refusePermissionGrant,
  refuseRoleEdit,
  refuseRoleGrant,
  type Principal,
  type RoleGrant,
} from "./privilege.rules";

/**
 * The privilege ceiling, tested against the **seeded** roles rather than
 * invented ones — the escalation the audit found (SEC-R1) was a property of
 * what `administrator` actually holds, and a test over made-up sets would
 * pass while the catalogue drifted into the same hole.
 */

const ALL = new Set(PERMISSION_KEYS);

function role(key: string): RoleGrant {
  const def = SYSTEM_ROLES.find((r) => r.key === key);
  if (!def) throw new Error(`no seeded role ${key}`);
  return {
    key: def.key,
    name: def.name,
    permissions: def.permissions === "*" ? [...ALL] : def.permissions,
  };
}

function holder(...keys: string[]): Principal {
  const roles = keys.map(role);
  return {
    isSuperAdmin: keys.includes(SUPER_ADMIN_ROLE),
    permissions: permissionsOf(roles),
  };
}

function custom(...permissions: string[]): Principal {
  return { isSuperAdmin: false, permissions: new Set(permissions) };
}

const superAdmin = holder(SUPER_ADMIN_ROLE);
const administrator = holder("administrator");
const management = holder("management");
const contentEditor = holder("content_editor");

describe("refuseRoleGrant — who may hand out a role", () => {
  it("refuses Super Admin to an Administrator (the audit's SEC-R1)", () => {
    expect(refuseRoleGrant(administrator, [role(SUPER_ADMIN_ROLE)])).toMatch(/nur ein Super Admin/);
  });

  it("refuses Super Admin to every seeded role that is not Super Admin", () => {
    for (const def of SYSTEM_ROLES) {
      if (def.key === SUPER_ADMIN_ROLE) continue;
      expect(refuseRoleGrant(holder(def.key), [role(SUPER_ADMIN_ROLE)]), def.key).not.toBeNull();
    }
  });

  it("refuses Super Admin by key even to someone holding every permission", () => {
    // The seed writes all 120 rows to the Super Admin role, so a subset test
    // alone would *allow* this for a custom role holding everything. The key
    // is what makes Super Admin omnipotent, and only its holder may pass it on.
    expect(refuseRoleGrant(custom(...ALL), [role(SUPER_ADMIN_ROLE)])).not.toBeNull();
  });

  it("refuses a role holding permissions the actor lacks", () => {
    // Geschäftsleitung holds organisation.updateLegal and office.delete, which
    // were withheld from Administrator on purpose — and the project write keys.
    const refusal = refuseRoleGrant(administrator, [role("management")]);
    expect(refusal).toMatch(/Geschäftsleitung/);
    expect(refusal).toMatch(/\d+ Berechtigungen/);
    expect(refuseRoleGrant(custom(...role("management").permissions.filter((k) => k !== "office.delete")), [role("management")])).toMatch(/office\.delete/);
  });

  it("allows a role the actor contains, including their own", () => {
    expect(refuseRoleGrant(administrator, [role("administrator")])).toBeNull();
    expect(refuseRoleGrant(administrator, [role("content_editor")])).toBeNull();
    expect(refuseRoleGrant(administrator, [role("viewer")])).toBeNull();
  });

  it("judges every role in the list, not only the first", () => {
    expect(refuseRoleGrant(administrator, [role("viewer"), role(SUPER_ADMIN_ROLE)])).not.toBeNull();
  });

  it("lets a Super Admin grant anything", () => {
    for (const def of SYSTEM_ROLES) {
      expect(refuseRoleGrant(superAdmin, [role(def.key)]), def.key).toBeNull();
    }
  });

  it("allows granting nothing", () => {
    expect(refuseRoleGrant(contentEditor, [])).toBeNull();
  });
});

describe("refusePermissionGrant — what may go into a role", () => {
  it("refuses a custom role adding user.assign to itself", () => {
    const roleEditor = custom("role.read", "role.update");
    expect(refusePermissionGrant(roleEditor, ["role.read", "role.update", "user.assign"])).toMatch(
      /user\.assign/,
    );
  });

  it("refuses any key the actor does not hold", () => {
    expect(refusePermissionGrant(administrator, ["system.restore"])).not.toBeNull();
    expect(refusePermissionGrant(administrator, ["organisation.updateLegal"])).not.toBeNull();
  });

  it("allows keys the actor holds", () => {
    expect(refusePermissionGrant(administrator, ["content.read", "user.assign"])).toBeNull();
  });

  it("lets a Super Admin put anything in a role", () => {
    expect(refusePermissionGrant(superAdmin, [...ALL])).toBeNull();
  });
});

describe("refuseRoleEdit — who may edit or delete a role", () => {
  it("refuses a lower role editing a higher one", () => {
    expect(refuseRoleEdit(contentEditor, role("administrator"))).not.toBeNull();
    expect(refuseRoleEdit(administrator, role("management"))).not.toBeNull();
  });

  it("refuses Super Admin's role to anybody else", () => {
    expect(refuseRoleEdit(custom(...ALL), role(SUPER_ADMIN_ROLE))).toMatch(/nur ein Super Admin/);
  });

  it("allows a role the actor contains", () => {
    expect(refuseRoleEdit(administrator, role("content_editor"))).toBeNull();
  });
});

describe("refuseAdminister — who may act on an account", () => {
  it("refuses an Administrator acting on a Super Admin", () => {
    expect(refuseAdminister(administrator, superAdmin)).toMatch(/Super Admin/);
  });

  it("refuses an Administrator acting on Geschäftsleitung", () => {
    expect(refuseAdminister(administrator, management)).not.toBeNull();
  });

  it("allows peers and those below", () => {
    expect(refuseAdminister(administrator, administrator)).toBeNull();
    expect(refuseAdminister(administrator, contentEditor)).toBeNull();
    expect(refuseAdminister(administrator, custom())).toBeNull();
  });

  it("treats a multi-role account as the union of its roles", () => {
    // Content editor + management together exceed the administrator even
    // though content editor alone does not.
    expect(refuseAdminister(administrator, holder("content_editor", "management"))).not.toBeNull();
  });

  it("lets a Super Admin act on anybody", () => {
    expect(refuseAdminister(superAdmin, superAdmin)).toBeNull();
    expect(refuseAdminister(superAdmin, management)).toBeNull();
  });
});

describe("privilegeChangeNeedsReauth", () => {
  it("always for anything touching Super Admin", () => {
    expect(privilegeChangeNeedsReauth([], true)).toBe(true);
  });

  it("for any privileged permission granted", () => {
    expect(privilegeChangeNeedsReauth(["content.read", "user.assign"], false)).toBe(true);
    expect(privilegeChangeNeedsReauth(permissionsOf([role("administrator")]), false)).toBe(true);
  });

  it("not for ordinary work", () => {
    expect(privilegeChangeNeedsReauth(permissionsOf([role("content_editor")]), false)).toBe(false);
    expect(privilegeChangeNeedsReauth(permissionsOf([role("viewer")]), false)).toBe(false);
    expect(privilegeChangeNeedsReauth([], false)).toBe(false);
  });

  it("names only keys that exist in the catalogue", () => {
    // A renamed key would silently drop out of the set and stop prompting.
    const unknown = [...PRIVILEGED_PERMISSIONS].filter((k) => !ALL.has(k));
    expect(unknown).toEqual([]);
  });

  it("covers every user- and role-administration key except the read ones", () => {
    const expected = PERMISSION_KEYS.filter(
      (k) => (k.startsWith("user.") || k.startsWith("role.")) && !k.endsWith(".read"),
    );
    const missing = expected.filter((k) => !PRIVILEGED_PERMISSIONS.has(k));
    expect(missing).toEqual([]);
  });
});

describe("added", () => {
  it("is after minus before", () => {
    expect(added(new Set(["a", "b"]), new Set(["b", "c"]))).toEqual(["c"]);
  });
});
