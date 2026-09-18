import { describe, expect, it } from "vitest";
import { buildTrail, type CrumbRoute } from "./breadcrumbs";
import { fillPattern, match } from "./router";

/**
 * The derived trail (foundation stage F4, weakness W11).
 *
 * Worth its own tests because the failure is quiet: a wrong parent produces a
 * link to a page that exists, just the wrong one, and a missing parameter
 * produces a link containing `:type` that 404s only when someone clicks it.
 */

const ROUTES: CrumbRoute[] = [
  { pattern: "/inhalte", label: "Website bearbeiten" },
  {
    pattern: "/inhalte/:type",
    label: "Inhalte",
    parent: "/inhalte",
    crumb: ({ type }, labels) => labels[type] ?? type,
  },
  { pattern: "/inhalte/:type/:id", label: "Inhalt bearbeiten", parent: "/inhalte/:type" },
  { pattern: "/medien", label: "Medien" },
];

describe("fillPattern", () => {
  it("substitutes the parameters", () => {
    expect(fillPattern("/inhalte/:type", { type: "projects" })).toBe("/inhalte/projects");
  });

  it("ignores parameters the pattern does not use", () => {
    expect(fillPattern("/inhalte/:type", { type: "team", id: "abc" })).toBe("/inhalte/team");
  });

  /**
   * `null`, not a half-filled path. A trail containing `/inhalte/:type` is a
   * link that 404s when somebody clicks it, which is worse than one fewer step.
   */
  it("refuses a pattern it cannot fill", () => {
    expect(fillPattern("/inhalte/:type", {})).toBeNull();
  });

  it("encodes a value that would otherwise break the path", () => {
    expect(fillPattern("/inhalte/:type", { type: "a/b" })).toBe("/inhalte/a%2Fb");
  });

  it("round-trips with match", () => {
    const path = fillPattern("/inhalte/:type/:id", { type: "projects", id: "x1" })!;
    expect(match("/inhalte/:type/:id", path)).toEqual({ type: "projects", id: "x1" });
  });
});

describe("buildTrail", () => {
  it("is a single crumb for a top-level route", () => {
    expect(buildTrail(ROUTES, "/medien", {})).toEqual([{ label: "Medien", to: undefined }]);
  });

  it("walks the parents, root first", () => {
    const trail = buildTrail(ROUTES, "/inhalte/:type/:id", { type: "projects", id: "x1" });
    expect(trail.map((c) => c.label)).toEqual([
      "Website bearbeiten",
      "projects",
      "Inhalt bearbeiten",
    ]);
  });

  it("links every crumb but the last", () => {
    const trail = buildTrail(ROUTES, "/inhalte/:type/:id", { type: "projects", id: "x1" });
    expect(trail.map((c) => c.to)).toEqual(["/inhalte", "/inhalte/projects", undefined]);
  });

  it("uses the shell's label dictionary for the middle crumb", () => {
    // The one crumb no screen can publish for itself: the editor knows its
    // entry's title, not the *list's* German name.
    const trail = buildTrail(
      ROUTES,
      "/inhalte/:type/:id",
      { type: "projects", id: "x1" },
      { labels: { projects: "Projekte" } },
    );
    expect(trail[1].label).toBe("Projekte");
  });

  it("falls back to the raw segment when the dictionary has no entry", () => {
    // The types are fetched; before they land, a slug beats an empty crumb.
    const trail = buildTrail(ROUTES, "/inhalte/:type", { type: "team" });
    expect(trail[1].label).toBe("team");
  });

  it("puts the published title in the last crumb only", () => {
    const trail = buildTrail(
      ROUTES,
      "/inhalte/:type/:id",
      { type: "projects", id: "x1" },
      { title: "Schulhaus Guglera", labels: { projects: "Projekte" } },
    );
    expect(trail.map((c) => c.label)).toEqual(["Website bearbeiten", "Projekte", "Schulhaus Guglera"]);
  });

  it("returns nothing for a pattern that is not in the table", () => {
    expect(buildTrail(ROUTES, "/nirgendwo", {})).toEqual([]);
  });

  /**
   * A route table is hand-written, so a typo in `parent` is reachable. Left
   * unbounded it is a hang — the worst failure mode for a shell component,
   * because nothing renders and there is no error to read.
   */
  it("survives a parent cycle instead of hanging", () => {
    const cyclic: CrumbRoute[] = [
      { pattern: "/a", label: "A", parent: "/b" },
      { pattern: "/b", label: "B", parent: "/a" },
    ];
    const trail = buildTrail(cyclic, "/a", {});
    expect(trail.length).toBeLessThanOrEqual(2);
    expect(trail.map((c) => c.label)).toEqual(["B", "A"]);
  });

  it("drops a parent link it cannot fill rather than emitting a pattern", () => {
    const trail = buildTrail(ROUTES, "/inhalte/:type/:id", { id: "x1" });
    expect(trail.some((c) => c.to?.includes(":"))).toBe(false);
  });
});
