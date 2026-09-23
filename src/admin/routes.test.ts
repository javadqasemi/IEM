import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES, matchRoute } from "./routes";
import { DESTINATIONS, isOffered, ownerOf } from "./lib/navigation";
import { SEEDED_ROLES, canFor } from "./lib/seededRoles.testing";

/**
 * The route table, checked against the two things it has to agree with: the
 * menu, and the server's permission catalogue.
 *
 * `lib/navigation.ts` states the rule this enforces — "only add a menu entry
 * for a route `renderRoute` actually serves. A menu entry pointing at a route
 * the application does not serve is a broken link, and a navigation full of
 * them is worse than a short one." That was a comment asking to be obeyed;
 * this is the check.
 *
 * The permission keys matter for the same reason they matter on the server: a
 * typo produces a route nobody can open, and it fails by showing "you lack
 * permission" to someone who does not lack it, which is the hardest kind of
 * access bug to diagnose.
 */

/**
 * The catalogue, read out of the server's source.
 *
 * Parsed rather than imported: the API is a separate TypeScript program with
 * its own `node_modules` and CommonJS output, and pulling it into the site's
 * test run to read a list of strings would couple the two builds.
 *
 * It reads `rbac/resources.ts` now rather than `permissions.catalog.ts`, which
 * became a derivation of it in foundation stage F6. The move was caught by the
 * guard below rather than by review — the parser found nothing and thirteen
 * assertions would have passed against an empty set. That is exactly what the
 * guard is for, and it is why a parser of somebody else's file needs one.
 */
const catalogue = (() => {
  const src = readFileSync(resolve(__dirname, "../../server/src/rbac/resources.ts"), "utf8");
  const keys = new Set<string>();
  // `resource("content", "Inhalte", "Inhalte", { read: "…", create: "…" })`.
  // The actions run to the closing brace of the object literal, and none of
  // the descriptions contain one.
  for (const block of src.matchAll(/resource\(\s*"([a-zA-Z]+)"[^{]*\{([^}]*)\}/g)) {
    for (const action of block[2].matchAll(/^\s*([a-zA-Z]+):/gm)) {
      keys.add(`${block[1]}.${action[1]}`);
    }
  }
  return keys;
})();

describe("the permission catalogue could be read", () => {
  it("found a plausible number of permissions", () => {
    // Guards the regex above: if the catalogue's shape changes, every other
    // test in this file would silently pass against an empty set.
    expect(catalogue.size).toBeGreaterThan(40);
    expect(catalogue.has("content.publish")).toBe(true);
    expect(catalogue.has("system.health")).toBe(true);
  });
});

describe("every route names real permissions", () => {
  it.each(ROUTES.filter((r) => r.permissions.length > 0))(
    "$pattern",
    ({ permissions }) => {
      for (const key of permissions) {
        expect(catalogue.has(key), `"${key}" is not in permissions.catalog.ts`).toBe(true);
      }
    },
  );

  /**
   * The routes open to any signed-in user, named one at a time.
   *
   * It used to be exactly one — `/profil` — with a note saying a second
   * would want justifying. Three of them now, and the justification is the
   * same sentence for all three: **they are the reader's own account.**
   * None takes an id, every one resolves the person from the verified token
   * on the server, and a permission key that every role had to be granted
   * for the dashboard to work would be a key that means nothing. It is the
   * argument `/auth/sessions`, `/auth/mfa` and `/notifications` all make on
   * the other side.
   *
   * The list stays explicit rather than becoming a rule, because the next
   * open route added without thinking about it is the one that should have
   * had a permission. The firm's *configuration* of notifications is a
   * different screen — `/einstellungen/benachrichtigungen`, behind
   * `notification.configure` — and its absence from this list is the check
   * that the two were not merged.
   */
  it("opens only the reader's own account to every signed-in user", () => {
    const open = ROUTES.filter((r) => r.permissions.length === 0);
    expect(open.map((r) => r.pattern)).toEqual([
      "/benachrichtigungen/einstellungen",
      "/benachrichtigungen",
      "/profil",
    ]);
  });
});

describe("route matching", () => {
  it("matches the entry editor before the entry list", () => {
    // Both patterns start `/inhalte/`, and `match()` is exact-length, so this
    // is really asserting that neither pattern was written in a way that
    // shadows the other.
    expect(matchRoute("/inhalte/team/abc")?.route.pattern).toBe("/inhalte/:type/:id");
    expect(matchRoute("/inhalte/team")?.route.pattern).toBe("/inhalte/:type");
    expect(matchRoute("/inhalte")?.route.pattern).toBe("/inhalte");
  });

  it("treats an empty path as the root", () => {
    expect(matchRoute("")?.route.pattern).toBe("/");
    expect(matchRoute("/")?.route.pattern).toBe("/");
  });

  it("returns null for an unknown path rather than guessing", () => {
    expect(matchRoute("/nicht-vorhanden")).toBeNull();
    expect(matchRoute("/inhalte/team/abc/zuviel")).toBeNull();
  });

  it("hands the editor its params under the names the component wants", () => {
    const hit = matchRoute("/inhalte/projects/xyz")!;
    expect(hit.params).toEqual({ type: "projects", id: "xyz" });
    expect(hit.route.props!(hit.params)).toEqual({ typeKey: "projects", entryId: "xyz" });
  });
});

describe("the menu and the route table agree", () => {
  it("has a registry worth checking", () => {
    expect(DESTINATIONS.length).toBeGreaterThan(20);
  });

  it.each(DESTINATIONS)("$label → $to is a route the app serves", ({ to }) => {
    expect(matchRoute(to), `the menu points at "${to}" and nothing renders it`).not.toBeNull();
  });

  /**
   * A row shown to somebody must open for them.
   *
   * The rail's rules are predicates now (`visibleWhen` plus the workspace's
   * audience), so the old check — "the menu's keys are a subset of the
   * route's" — has no keys to compare. It is asked of every seeded role
   * instead: for each destination the role is offered, the route has to let
   * that role in. A row that answers "Dafür fehlt Ihnen die Berechtigung" is
   * the dead end the route guard was added to avoid.
   */
  it.each(SEEDED_ROLES.map((r) => r.key))("every destination offered to %s opens for it", (key) => {
    const can = canFor(key);
    const dead = DESTINATIONS.filter((d) => isOffered(d, can))
      .map((d) => ({ d, hit: matchRoute(d.to)! }))
      .filter(({ hit }) => hit.route.permissions.length > 0 && !hit.route.permissions.some(can))
      .map(({ d, hit }) => `${d.label} → ${hit.route.pattern}`);
    expect(dead).toEqual([]);
  });

  it("read the seeded roles, so the check above is checking something", () => {
    expect(SEEDED_ROLES.length).toBeGreaterThanOrEqual(15);
    expect(SEEDED_ROLES.find((r) => r.key === "super_admin")?.permissions).toBe("*");
    expect(canFor("project_manager")("project.read")).toBe(true);
    expect(canFor("guest")("project.read")).toBe(false);
  });

  it("every route in the table has at most one workspace owner", () => {
    /*
      `ownerOf` resolves by longest match, so a single answer is guaranteed
      per path; what this catches is a route no destination claims at all
      (other than the reader's own account pages), which would render with no
      workspace in the bar and nothing lit in the rail.
    */
    // A real value for the parameters that select a section; an id elsewhere.
    const example = (pattern: string) =>
      pattern.startsWith("/einstellungen/")
        ? "/einstellungen/unternehmen"
        : pattern.startsWith("/system/")
          ? "/system/aufgaben"
          : pattern.replace(/:[a-z]+/g, "x");
    const unowned = ROUTES.map((r) => r.pattern)
      .filter((p) => !["/profil", "/benachrichtigungen", "/benachrichtigungen/einstellungen"].includes(p))
      .filter((p) => !ownerOf(example(p))?.workspace);
    expect(unowned).toEqual([]);
  });
});


/**
 * The `parent` links added in foundation stage F4.
 *
 * A typo there does not throw — `buildTrail` simply stops walking and the
 * trail is short, which reads as "this screen has no parent" rather than as a
 * mistake. That is exactly the failure this catches.
 */
describe("the breadcrumb chain", () => {
  const patterns = new Set(ROUTES.map((r) => r.pattern));

  it("names a parent that exists", () => {
    const broken = ROUTES.filter((r) => r.parent && !patterns.has(r.parent)).map(
      (r) => `${r.pattern} -> ${r.parent}`,
    );
    expect(broken).toEqual([]);
  });

  it("never cycles", () => {
    const byPattern = new Map(ROUTES.map((r) => [r.pattern, r]));
    for (const route of ROUTES) {
      const seen = new Set<string>();
      let current: (typeof ROUTES)[number] | undefined = route;
      while (current) {
        expect(seen.has(current.pattern), `cycle through ${current.pattern}`).toBe(false);
        seen.add(current.pattern);
        current = current.parent ? byPattern.get(current.parent) : undefined;
      }
    }
  });

  it("gives every trail a resolvable chain from the child's own parameters", () => {
    /**
     * A parent needing a parameter the child does not carry would be dropped
     * from the trail silently. `/inhalte/:type/:id` -> `/inhalte/:type` works
     * because the child's params are a superset; the reverse would not.
     */
    const byPattern = new Map(ROUTES.map((r) => [r.pattern, r]));
    const paramsOf = (pattern: string) =>
      pattern.split("/").filter((s) => s.startsWith(":")).map((s) => s.slice(1));

    for (const route of ROUTES) {
      if (!route.parent) continue;
      const child = new Set(paramsOf(route.pattern));
      const parent = byPattern.get(route.parent)!;
      const missing = paramsOf(parent.pattern).filter((name) => !child.has(name));
      expect(
        missing,
        `${route.pattern} cannot fill ${parent.pattern}: missing ${missing.join(", ")}`,
      ).toEqual([]);
    }
  });
});
