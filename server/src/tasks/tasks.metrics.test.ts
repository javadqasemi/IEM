import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JOB_NAMES } from "../core/jobs/catalogue";
import { TasksMetrics } from "./tasks.metrics";

/**
 * Whether the declaration is still true.
 *
 * `tasks.metrics.ts` is four lists and a count, and every one of them is a fact
 * about *other* files. None is a type, and none fails when it drifts — adding an
 * eleventh event to `tasks.service.ts` and forgetting this file produces a report
 * quietly missing a column, which reads as an event that never happens.
 *
 * So the test reads the source. That is unusual and it is the point: it is the
 * only way to assert that a hand-written list matches something a compiler
 * cannot see. `projects.metrics.test.ts` is the same test for the module this
 * one was derived from.
 */

const here = (file: string) => readFileSync(join(__dirname, file), "utf8");

const declared = new TasksMetrics(null as never, null as never);

describe("the events it declares", () => {
  /** Both files raise events: the service on a request, the sweep on a clock. */
  const sources = here("tasks.service.ts") + here("tasks.overdue.ts");
  const published = [...sources.matchAll(/publish\(\s*"(\w+)"/g)].map((m) => m[1]);

  it("found the publishes", () => {
    // Guards the two assertions below against a regex that matched nothing —
    // which would make them pass by comparing an empty list with itself.
    expect(published.length).toBeGreaterThan(5);
  });

  it("includes every event the module raises", () => {
    const missing = [...new Set(published)].filter(
      (name) => !(declared.events as readonly string[]).includes(name),
    );
    expect(missing, "raised by the module, absent from tasks.metrics.ts").toEqual([]);
  });

  it("declares none the module does not raise", () => {
    /*
      The direction that rots silently. A declared event that nothing raises
      reports 0 for ever, and 0 is indistinguishable from "this has not happened
      today" — so an event removed from the service leaves a column that looks
      like a quiet feature rather than a dead one.
    */
    const orphans = declared.events.filter((name) => !published.includes(name));
    expect(orphans, "declared in tasks.metrics.ts, raised nowhere").toEqual([]);
  });
});

describe("the audit resources it declares", () => {
  const sources = here("tasks.service.ts") + here("tasks.overdue.ts");
  const entities = [...new Set([...sources.matchAll(/entity:\s*"(\w+)"/g)].map((m) => m[1]))];

  it("found the entities", () => {
    expect(entities.length).toBeGreaterThan(0);
  });

  it("covers every entity the module's events carry", () => {
    /**
     * `AuditListener` writes `resource: event.entity`, so a resource missing
     * here means audit rows this module wrote are counted against nobody. The
     * figure is simply too small, and "Aufgaben had four audit rows this week"
     * is believable.
     */
    const uncounted = entities.filter(
      (entity) => !(declared.auditResources as readonly string[]).includes(entity),
    );
    expect(uncounted, "audited by the module, absent from auditResources").toEqual([]);
  });

  it("declares `comment`, which no event names as its entity", () => {
    /*
      The asymmetry, asserted rather than left to look like a mistake.
      `TaskCommented` carries `entity: "task"` — the thing that changed is the
      task's thread — so `comment` appears in no `entity:` literal. It is
      declared because `Comment` is a table this module writes, and an operator
      asking "how much is happening in Aufgaben" means the discussion too.
    */
    expect(declared.auditResources).toContain("comment");
    expect(entities).not.toContain("comment");
  });
});

describe("the route prefix", () => {
  it("matches what the controller is mounted at", () => {
    const mount = /@Controller\("([^"]*)"\)/.exec(here("tasks.controller.ts"))?.[1];
    expect(mount, "tasks.controller.ts has no @Controller path").toBeTruthy();
    expect(declared.routePrefix).toBe(`/${mount}`);
  });

  it("is written without the global prefix", () => {
    // `main.ts` mounts everything under `/api/v1` and `MetricsInterceptor`
    // strips it before recording. A module writing `/api/v1/tasks` here would
    // match nothing and report zero requests for ever.
    expect(declared.routePrefix.startsWith("/api")).toBe(false);
  });
});

describe("the job it declares", () => {
  it("is in the job catalogue", () => {
    // A name that is not in the catalogue can be enqueued and never filtered
    // for, which is how a job sits `QUEUED` for ever.
    for (const name of declared.jobs ?? []) {
      expect(JOB_NAMES as readonly string[], name).toContain(name);
    }
  });

  it("is the one the sweep registers a handler for", () => {
    const sweep = here("tasks.overdue.ts");
    for (const name of declared.jobs ?? []) {
      expect(sweep, `tasks.overdue.ts registers no handler for ${name}`).toContain(
        `register("${name}"`,
      );
    }
    expect(declared.jobs?.length).toBeGreaterThan(0);
  });
});

describe("the key", () => {
  it("is the permission resource, so an operator reads one word everywhere", () => {
    // `task` in the rail, in `rbac/resources.ts`, in the audit log and here. A
    // module answering to two names is one an operator cannot follow from an
    // alert to a screen.
    expect(declared.key).toBe("task");
  });

  it("does not collide with the module it was derived from", () => {
    // `MetricsService.register` replaces on a duplicate key and warns; two
    // modules answering to one key would silently combine their figures.
    expect(declared.key).not.toBe("project");
    expect(declared.routePrefix).not.toBe("/projects");
  });
});
