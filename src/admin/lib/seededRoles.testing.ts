import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Can } from "./navigation";

/**
 * The seeded roles and their permission keys, read out of the server's source.
 *
 * Test-only (it reads the file system). Parsed rather than imported for the
 * reason `routes.test.ts` gives: the API is a separate TypeScript program, and
 * pulling it into the site's test run to read a list of strings would couple
 * the two builds.
 *
 * Navigation must not be written against role names, and it is not — these
 * are the *personas* the navigation tests check it against. Reading them from
 * `permissions.catalog.ts` means a change to a role's grants shows up here as a
 * changed menu, which is the point.
 */
export type SeededRole = { key: string; name: string; permissions: string[] | "*" };

export const SEEDED_ROLES: SeededRole[] = (() => {
  const raw = readFileSync(
    resolve(__dirname, "../../../server/src/rbac/permissions.catalog.ts"),
    "utf8",
  );
  // Comments first: several arrays carry prose between their keys.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const start = src.indexOf("SYSTEM_ROLES");
  const body = src.slice(start);

  const roles: SeededRole[] = [];
  const block = /key:\s*"([a-z_]+)",\s*name:\s*"([^"]+)"[\s\S]*?permissions:\s*("\*"|\[[\s\S]*?\])/g;
  for (const match of body.matchAll(block)) {
    const [, key, name, list] = match;
    if (list === '"*"') {
      roles.push({ key, name, permissions: "*" });
      continue;
    }
    const keys = [...list.matchAll(/"([a-zA-Z]+\.[a-zA-Z]+)"/g)].map((m) => m[1]);
    roles.push({ key, name, permissions: keys });
  }
  return roles;
})();

/** `can` for one seeded role — Super Admin holds everything, as on the server. */
export function canFor(roleKey: string): Can {
  const role = SEEDED_ROLES.find((r) => r.key === roleKey);
  if (!role) throw new Error(`no seeded role "${roleKey}"`);
  if (role.permissions === "*") return () => true;
  const held = new Set(role.permissions);
  return (permission) => held.has(permission);
}
