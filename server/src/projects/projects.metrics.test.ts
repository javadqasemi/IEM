import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectsMetrics } from "./projects.metrics";

/**
 * Whether the declaration is still true.
 *
 * `projects.metrics.ts` is four lists and a count, and every one of them is a
 * fact about *other* files: the events the service raises, the entities it
 * audits, the prefix the controller is mounted at, the job the reconciler
 * enqueues. None of those is a type, and none of them fails when it drifts —
 * adding an eleventh event to `projects.service.ts` and forgetting this file
 * produces a report that is quietly missing a column, which reads as an event
 * that never happens.
 *
 * So the test reads the source. That is unusual and it is the point: this is
 * the only way to assert that a hand-written list matches something a compiler
 * cannot see.
 */

const here = (file: string) => readFileSync(join(__dirname, file), "utf8");

/** The declaration, constructed without Nest — it injects nothing it uses here. */
const declared = new ProjectsMetrics(null as never, null as never);

describe("the events it declares", () => {
  const service = here("projects.service.ts");
  const published = [...service.matchAll(/publish\(\s*"(\w+)"/g)].map((m) => m[1]);

  it("found the publishes", () => {
    // Guards the two assertions below against a regex that matched nothing —
    // which would make them pass by comparing an empty list with itself.
    expect(published.length).toBeGreaterThan(5);
  });

  it("includes every event the service raises", () => {
    const missing = [...new Set(published)].filter(
      (name) => !(declared.events as readonly string[]).includes(name),
    );
    expect(missing, "raised by projects.service.ts, absent from projects.metrics.ts").toEqual([]);
  });

  it("declares none the service does not raise", () => {
    /*
      The other direction, and the one that rots silently. A declared event that
      nothing raises reports 0 for ever, and 0 is indistinguishable from "this
      has not happened today" — so an event removed from the service leaves a
      column that looks like a quiet feature rather than a dead one.
    */
    const orphans = declared.events.filter((name) => !published.includes(name));
    expect(orphans, "declared in projects.metrics.ts, raised nowhere").toEqual([]);
  });
});

describe("the audit resources it declares", () => {
  const service = here("projects.service.ts");
  const entities = [...new Set([...service.matchAll(/entity:\s*"(\w+)"/g)].map((m) => m[1]))];

  it("found the entities", () => {
    expect(entities.length).toBeGreaterThan(1);
  });

  it("matches the entities the module's events carry", () => {
    /**
     * `AuditListener` writes `resource: event.entity`, so these two lists are
     * the same list seen from two files. The failure when they differ is the
     * one described in CLAUDE.md for `toAuditSnapshot`: nothing throws, the
     * figure is simply too small, and "Projekte had four audit rows this week"
     * is believable.
     */
    expect([...declared.auditResources].sort()).toEqual(entities.sort());
  });
});

describe("the route prefix", () => {
  it("matches what the controller is mounted at", () => {
    const mount = /@Controller\("([^"]*)"\)/.exec(here("projects.controller.ts"))?.[1];
    expect(mount, "projects.controller.ts has no @Controller path").toBeTruthy();
    expect(declared.routePrefix).toBe(`/${mount}`);
  });

  it("is written without the global prefix", () => {
    /*
      `main.ts` mounts everything under `/api/v1`, and `MetricsInterceptor`
      strips it before recording. A module writing `/api/v1/projects` here would
      match nothing and report zero requests — see the note on `normalise`.
    */
    expect(declared.routePrefix.startsWith("/api")).toBe(false);
  });
});

describe("the job it declares", () => {
  it("is the one the reconciler owns", () => {
    const reconcile = here("projects.reconcile.ts");
    for (const name of declared.jobs ?? []) {
      expect(reconcile, `projects.reconcile.ts does not mention ${name}`).toContain(name);
    }
    expect(declared.jobs?.length).toBeGreaterThan(0);
  });
});

describe("the key", () => {
  it("is the permission resource, so an operator reads one word everywhere", () => {
    // `project` in the rail, in `rbac/resources.ts`, in the audit log and here.
    // A module that answers to two names is a module an operator cannot follow
    // from an alert to a screen.
    expect(declared.key).toBe("project");
  });
});
