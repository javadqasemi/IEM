import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES, matchRoute } from "./routes";
import { buildNavigation, flattenNavigation } from "./lib/navigation";

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
 * test run to read a list of strings would couple the two builds. The shape it
 * reads — `p("resource", "action", …)` — is stable and is the file's whole
 * content.
 */
const catalogue = (() => {
  const src = readFileSync(
    resolve(__dirname, "../../server/src/rbac/permissions.catalog.ts"),
    "utf8",
  );
  const keys = new Set<string>();
  for (const m of src.matchAll(/^\s*p\("([a-zA-Z]+)",\s*"([a-zA-Z]+)"/gm)) {
    keys.add(`${m[1]}.${m[2]}`);
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

  it("leaves exactly one route open to any signed-in user", () => {
    // One's own profile, which also hosts the appearance setting and so has to
    // stay reachable by every role. A second open route would want justifying.
    const open = ROUTES.filter((r) => r.permissions.length === 0);
    expect(open.map((r) => r.pattern)).toEqual(["/profil"]);
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
  /**
   * The fixed part of the menu, built for a user who can do everything.
   *
   * `types: []` leaves out the Website groups, which are generated from the
   * server's content types at runtime and all point at `/inhalte/:type` — a
   * pattern this table does serve, and one no static check can enumerate.
   */
  const sections = buildNavigation({ types: [], canAny: () => true });
  const destinations = flattenNavigation(sections);

  it("built a menu worth checking", () => {
    expect(destinations.length).toBeGreaterThan(5);
  });

  it.each(destinations)("$label → $to is a route the app serves", ({ to }) => {
    expect(matchRoute(to), `the menu points at "${to}" and nothing renders it`).not.toBeNull();
  });

  it("opens each menu entry to at least the permissions the menu requires", () => {
    /**
     * The menu shows a row when the user holds any of *its* keys; the route
     * opens when they hold any of *its* keys. If the route asked for something
     * the menu does not, a user would see a row that answers "no access" — the
     * exact dead end the route guard was added to avoid.
     */
    for (const item of destinations) {
      const hit = matchRoute(item.to);
      if (!hit || hit.route.permissions.length === 0) continue;
      if (item.permissions.length === 0) continue;
      const routeOpens = new Set(hit.route.permissions);
      const unmatched = item.permissions.filter((k) => !routeOpens.has(k));
      expect(
        unmatched,
        `menu entry "${item.label}" shows for ${unmatched.join(", ")} but ${hit.route.pattern} does not open for it`,
      ).toEqual([]);
    }
  });
});
