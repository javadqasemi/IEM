import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS, SYSTEM_ROLES } from "./permissions.catalog";

/**
 * The seeded roles, checked against the catalogue they draw from.
 *
 * `permissions.agreement.test.ts` already compares the catalogue against the
 * guards — what a permission *guards*. This is the other half: what a role
 * *holds*. A role naming a key that does not exist is a grant that silently
 * does nothing, and it survives every other test in the repository, because
 * the seeder skips unknown keys rather than failing on them.
 *
 * It is cheap and it has a specific occasion: the operational roles arrived
 * with eleven new keys typed by hand, and a `project.manageTeams` for
 * `project.manageTeam` would have produced a Projektleiter who cannot compose
 * a team and no error anywhere.
 */
describe("the seeded roles", () => {
  it("names only permissions that exist", () => {
    const known = new Set(PERMISSION_KEYS);
    const unknown: string[] = [];

    for (const role of SYSTEM_ROLES) {
      if (role.permissions === "*") continue;
      for (const key of role.permissions) {
        if (!known.has(key)) unknown.push(`${role.key} → ${key}`);
      }
    }

    expect(unknown, "roles naming permissions that are not in the catalogue").toEqual([]);
  });

  it("names each permission at most once per role", () => {
    // A duplicate is harmless at the database — the seeder upserts — and is a
    // reliable sign that a list was edited in two places and merged badly.
    const duplicated: string[] = [];
    for (const role of SYSTEM_ROLES) {
      if (role.permissions === "*") continue;
      const seen = new Set<string>();
      for (const key of role.permissions) {
        if (seen.has(key)) duplicated.push(`${role.key} → ${key}`);
        seen.add(key);
      }
    }
    expect(duplicated).toEqual([]);
  });

  it("gives every role a distinct key and rank", () => {
    // `rank` is not unique in the schema — it is display order — so two roles
    // sharing one sort arbitrarily in the role editor and swap places between
    // reloads. That reads as a bug in the list rather than as a wrong constant.
    const keys = SYSTEM_ROLES.map((r) => r.key);
    expect(new Set(keys).size, `duplicate role keys in ${keys.join(", ")}`).toBe(keys.length);

    const ranks = SYSTEM_ROLES.map((r) => r.rank);
    expect(new Set(ranks).size, `duplicate ranks: ${ranks.sort((a, b) => a - b).join(", ")}`).toBe(
      ranks.length,
    );
  });

  it("gives exactly one role the wildcard", () => {
    const wildcards = SYSTEM_ROLES.filter((r) => r.permissions === "*").map((r) => r.key);
    expect(wildcards).toEqual(["super_admin"]);
  });

  it("keeps publishing with the owner", () => {
    // The spec's approval workflow, asserted rather than only described: an
    // editor submits, a manager approves, and publishing stays with Super
    // Admin. A role that quietly gained `content.publish` would collapse the
    // whole workflow into one step.
    const publishers = SYSTEM_ROLES.filter(
      (r) => r.permissions !== "*" && r.permissions.includes("content.publish"),
    );
    expect(publishers.map((r) => r.key)).toEqual([]);
  });
});

/**
 * The row-level rule, expressed as a property of the *catalogue* rather than of
 * a service.
 *
 * `projects.scope.ts` narrows a caller's rows unless they hold
 * `project.readAll`. Which roles hold it is therefore a security decision, and
 * it is one that can be changed by editing a list — so it is asserted here
 * exhaustively, by name. Adding a role to this set is then a deliberate act
 * that shows up in a diff as a failing test, which is exactly the visibility
 * "who can see the firm's whole book of work" deserves.
 */
describe("who sees every project", () => {
  const holders = SYSTEM_ROLES.filter(
    (r) => r.permissions !== "*" && r.permissions.includes("project.readAll"),
  ).map((r) => r.key);

  it("is exactly these four, plus Super Admin by flag", () => {
    expect(holders.sort()).toEqual(["administrator", "finance", "hr", "management"]);
  });

  it("does not include the Projektleitung or an engineer", () => {
    // The `◐` in `docs/permissions.md` §3.3 and §3.4. If either of these ever
    // passes, the scope has been widened by a role edit rather than by a
    // decision, and every project in the firm is on their list.
    expect(holders).not.toContain("project_manager");
    expect(holders).not.toContain("engineer");
  });

  it("gives every project writer the master data its pickers need", () => {
    /*
      **Writers, not readers**, and the distinction is one this test got wrong
      on its first run — usefully.

      A project *row* renders its customer's name without `customer.read`,
      because the name arrives denormalised inside the project payload;
      `customer.read` guards the `/customers` module, not a nested object. So
      HR reading projects with no access to the customer list is coherent, and
      the assertion that it was not would have forced a grant the matrix
      deliberately withholds (§3.6: HR Customers `○`).

      What genuinely needs the lists is the **create and edit form**: its
      pickers call `/customers`, `/buildings` and `/employees`, and a role that
      can create a project but not search for a Bauherrschaft gets a dialog it
      cannot complete.
    */
    const writers = SYSTEM_ROLES.filter(
      (r) =>
        r.permissions !== "*" &&
        (r.permissions.includes("project.create") || r.permissions.includes("project.update")),
    );
    expect(writers.length).toBeGreaterThan(1);

    for (const role of writers) {
      const held = role.permissions as string[];
      for (const key of ["customer.read", "building.read", "employee.read"]) {
        expect(held, `${role.key} writes projects but its pickers cannot call ${key}`).toContain(
          key,
        );
      }
    }
  });

  it("grants nobody a write it cannot reach", () => {
    // Every `project.*` write implies `project.read`. A role with
    // `project.update` and no `read` could PATCH a record it cannot fetch —
    // which is not a vulnerability, but it is an incoherent grant, and it is
    // the shape a copy-pasted role list produces.
    const writes = ["create", "update", "archive", "delete", "export"].map((a) => `project.${a}`);
    for (const role of SYSTEM_ROLES) {
      if (role.permissions === "*") continue;
      const held = role.permissions;
      if (writes.some((w) => held.includes(w))) {
        expect(held, `${role.key} writes projects without reading them`).toContain("project.read");
      }
    }
  });
});
