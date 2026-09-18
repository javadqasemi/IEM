import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, PERMISSION_KEYS } from "./permissions.catalog";
import { RESOURCES } from "./resources";
import { SYSTEM_ROLES } from "./permissions.catalog";

/**
 * The catalogue against the guards, in both directions.
 *
 * Foundation stage F6, and it exists because weakness W7 is not hypothetical:
 * the audit of this repository found **twelve of fifty-one permissions
 * enforced on no route**. They are selectable in the role editor, an
 * administrator can grant them, and they grant nothing. Nothing detected that,
 * because a permission that is merely *declared* is syntactically perfect.
 *
 * Two failures are possible and both are silent without this:
 *
 * 1. A route guards a key the catalogue does not have. `PermissionsGuard`
 *    compares against the user's resolved set, so an unknown key matches
 *    nothing and the route is closed to everyone — including Super Admin only
 *    by luck, since that short-circuits on the role flag. It reads as "the
 *    permission system is broken", days later.
 * 2. A key exists and guards nothing. It reads as "I granted this and it did
 *    nothing", which is worse: an administrator believes they have given
 *    somebody an ability they have not.
 *
 * The second direction is why `KNOWN_UNENFORCED` is a list rather than a
 * comment. It has to shrink; a thirteenth entry fails the build.
 */

const SRC = resolve(__dirname, "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

const files = sources(SRC);
const rel = (file: string) => relative(SRC, file).replace(/\\/g, "/");

/**
 * Every key the server actually enforces, and there are two ways.
 *
 * **At the route**, with `@RequirePermissions`. The coarse question: may you
 * touch this kind of thing at all.
 *
 * **In the code**, with `permissions.has(…)`. The fine question: may you touch
 * *this one*, or see *this field*. `permissions.md` §4 calls these the `◐`
 * rules and they are deliberate — `settings.secrets` decides whether a
 * plaintext SMTP password is in the response body, which is a property of the
 * rows rather than of the route.
 *
 * The first draft of this test read only the decorator and reported
 * `settings.secrets` as dead. It is not; it is checked in
 * `settings.controller.ts` on the way into the service. A check that reported
 * a working permission as unenforced would have sent somebody to "fix" it by
 * adding a guard that broke the screen for everyone without the key.
 *
 * Read out of the source rather than out of Nest's metadata, because reading
 * the metadata means booting the application — which needs a database, and a
 * check that needs a database is a check that does not run in `verify`.
 */
const guarded = new Map<string, string[]>();

const PATTERNS = [
  /@RequirePermissions\(([^)]*)\)/g,
  /permissions\.has\(([^)]*)\)/g,
  /\bperm\(([^)]*)\)/g,
];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      for (const key of match[1].matchAll(/"([^"]+)"/g)) {
        const where = guarded.get(key[1]) ?? [];
        if (!where.includes(rel(file))) where.push(rel(file));
        guarded.set(key[1], where);
      }
    }
  }
}

/**
 * Declared, and guarding no route today.
 *
 * Each line is a promise the UI currently makes and the server does not keep.
 * They are listed with what they are waiting for, so the list reads as work
 * rather than as an exception.
 */
const KNOWN_UNENFORCED: Record<string, string> = {
  "content.export": "no export endpoint yet",
  "content.import": "no import endpoint yet",
  "content.schedule": "ContentEntry.scheduledAt is read by the cron job and set by nothing",
  "content.unpublish": "no unpublish endpoint; rollback is the closest thing",
  "contentType.update": "content types are code, not data — may never be enforced",
  "media.download": "the media library links originals directly; no guarded route",
  "seo.read": "no SEO module",
  "seo.update": "no SEO module",
  "system.api": "no API-key management",
  "system.backup": "no backup endpoint",
  "user.impersonate": "no impersonation flow",
  "application.export": "no export endpoint yet",
  // Added by F6 for the job runner, ahead of its controller (F10).
  "job.read": "the job runner ships before its screen",
  "job.retry": "the job runner ships before its screen",
  "job.cancel": "the job runner ships before its screen",
};

describe("the catalogue is derived from the resources", () => {
  it("produces a key for every declared action", () => {
    const declared = RESOURCES.reduce((n, r) => n + Object.keys(r.actions).length, 0);
    expect(PERMISSIONS).toHaveLength(declared);
  });

  it("gives every permission a description an administrator can read", () => {
    // The role editor is otherwise a wall of `content.rollback`. A map from
    // action to description is what forces one to exist at all.
    const missing = PERMISSIONS.filter((p) => !p.description || p.description.length < 8);
    expect(missing.map((p) => p.key)).toEqual([]);
  });

  it("has no duplicate keys", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("spells every key as resource.action", () => {
    const wrong = PERMISSIONS.filter((p) => p.key !== `${p.resource}.${p.action}`);
    expect(wrong.map((p) => p.key)).toEqual([]);
  });

  /**
   * The keys that existed before the catalogue was generated.
   *
   * Pinned so the refactor is provably behaviour-preserving: a seeded database
   * holds rows for these, roles reference them, and a rename would orphan a
   * grant silently.
   */
  it("still contains every key the hand-written list had", () => {
    const before = [
      "content.read", "content.create", "content.update", "content.delete",
      "content.reorder", "content.submit", "content.approve", "content.publish",
      "content.unpublish", "content.archive", "content.schedule", "content.rollback",
      "content.duplicate", "content.preview", "content.history", "content.export",
      "content.import",
      "contentType.read", "contentType.update",
      "media.read", "media.upload", "media.update", "media.replace", "media.delete",
      "media.download", "media.folder",
      "user.read", "user.create", "user.update", "user.delete", "user.assign",
      "user.impersonate",
      "role.read", "role.create", "role.update", "role.delete",
      "application.read", "application.update", "application.download",
      "application.delete", "application.export",
      "settings.read", "settings.update", "settings.secrets",
      "seo.read", "seo.update",
      "audit.read", "audit.export",
      "system.health", "system.backup", "system.api",
    ];
    expect(before).toHaveLength(51);
    const missing = before.filter((k) => !PERMISSION_KEYS.includes(k));
    expect(missing).toEqual([]);
  });
});

describe("every guarded key exists", () => {
  it("finds the guards at all", () => {
    // Guards every assertion below: a regex that stopped matching would make
    // them all pass against an empty map.
    expect(guarded.size).toBeGreaterThan(20);
  });

  it.each([...guarded.keys()].sort())("%s is in the catalogue", (key) => {
    expect(
      PERMISSION_KEYS.includes(key),
      `guarded in ${guarded.get(key)!.join(", ")} but not declared in resources.ts`,
    ).toBe(true);
  });
});

describe("every declared key guards something", () => {
  it("has no unenforced permission that is not on the list", () => {
    const unenforced = PERMISSION_KEYS.filter((key) => !guarded.has(key));
    const unexpected = unenforced.filter((key) => !(key in KNOWN_UNENFORCED));
    expect(
      unexpected,
      "a new permission that guards no route. Either guard it or add it to KNOWN_UNENFORCED with a reason.",
    ).toEqual([]);
  });

  /**
   * The list must shrink, so an entry that has *started* being enforced has to
   * leave it — otherwise it grows stale and stops meaning anything.
   */
  it("has no stale entry on the list", () => {
    const stale = Object.keys(KNOWN_UNENFORCED).filter((key) => guarded.has(key));
    expect(stale, "now enforced — remove it from KNOWN_UNENFORCED").toEqual([]);
  });

  it("names a permission that actually exists on every line of the list", () => {
    const ghosts = Object.keys(KNOWN_UNENFORCED).filter((key) => !PERMISSION_KEYS.includes(key));
    expect(ghosts).toEqual([]);
  });
});

describe("the seeded roles", () => {
  it("grant only keys the catalogue has", () => {
    const bad: string[] = [];
    for (const role of SYSTEM_ROLES) {
      if (role.permissions === "*") continue;
      for (const key of role.permissions) {
        if (!PERMISSION_KEYS.includes(key)) bad.push(`${role.key} → ${key}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("leaves Super Admin as a flag rather than a list", () => {
    // A role that merely *listed* every key would stop being omnipotent the
    // moment a new one is added — precisely when the one account that can fix
    // things least wants to lose access.
    const superAdmin = SYSTEM_ROLES.find((r) => r.key === "super_admin");
    expect(superAdmin?.permissions).toBe("*");
  });

  it("gives publishing to nobody but Super Admin", () => {
    // The spec's approval workflow: an editor submits, a manager approves, and
    // publishing stays with the owner.
    const holders = SYSTEM_ROLES.filter(
      (r) => r.permissions !== "*" && (r.permissions as string[]).includes("content.publish"),
    );
    expect(holders.map((r) => r.key)).toEqual([]);
  });
});
