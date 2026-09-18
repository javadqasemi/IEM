import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MeetingsMetrics } from "./meetings.metrics";
import type { ModuleMetricsSource } from "../core/metrics/metrics.types";

/**
 * Whether the declaration is still true.
 *
 * `meetings.metrics.ts` is four lists and a count, and every one of them is a
 * fact about *other* files. None is a type, and none fails when it drifts —
 * adding a thirteenth event and forgetting this file produces a report quietly
 * missing a column, which reads as an event that never happens.
 *
 * So the test reads the source. That is unusual and it is the point: it is the
 * only way to assert that a hand-written list matches something a compiler
 * cannot see.
 */

const here = (file: string) => readFileSync(join(__dirname, file), "utf8");

/**
 * Typed as the **interface**, not as the class.
 *
 * `jobs` is optional on `ModuleMetricsSource` and this module declares none, so
 * `MeetingsMetrics` has no such property and `declared.jobs` is a compile error
 * on the class — which is the assertion the test below wants to make at
 * runtime. Reading it through the interface is what the metrics service does,
 * and it is therefore the right view to assert against.
 */
const declared: ModuleMetricsSource = new MeetingsMetrics(null as never, null as never);

describe("the events it declares", () => {
  const source = here("meetings.service.ts");
  const published = [...source.matchAll(/publish\(\s*"(\w+)"/g)].map((m) => m[1]);

  it("found the publishes", () => {
    // Guards the two assertions below against a regex that matched nothing —
    // which would make them pass by comparing an empty list with itself.
    expect(published.length).toBeGreaterThan(8);
  });

  it("includes every event the module raises", () => {
    const missing = [...new Set(published)].filter(
      (name) => !(declared.events as readonly string[]).includes(name),
    );
    expect(missing, "raised by the module, absent from meetings.metrics.ts").toEqual([]);
  });

  it("declares none the module does not raise", () => {
    /*
      The direction that rots silently. A declared event that nothing raises
      reports 0 for ever, and 0 is indistinguishable from "this has not happened
      today" — so an event removed from the service leaves a column that looks
      like a quiet feature rather than a dead one.
    */
    const orphans = declared.events.filter((name) => !published.includes(name));
    expect(orphans, "declared in meetings.metrics.ts, raised nowhere").toEqual([]);
  });

  it("covers both aggregates", () => {
    // Two aggregates, one module: a source that declared only the meeting
    // events would report a module where decisions never happen.
    expect(declared.events.some((n) => n.startsWith("Meeting"))).toBe(true);
    expect(declared.events.some((n) => n.startsWith("Decision"))).toBe(true);
  });
});

describe("the audit resources it declares", () => {
  const source = here("meetings.service.ts");
  const entities = [...new Set([...source.matchAll(/entity:\s*"(\w+)"/g)].map((m) => m[1]))];

  it("found the entities", () => {
    expect(entities.length).toBeGreaterThan(1);
  });

  it("covers every entity the module's events carry", () => {
    /**
     * `AuditListener` writes `resource: event.entity`, so a resource missing
     * here means audit rows this module wrote are counted against nobody — and
     * "Sitzungen had four audit rows this week" is believable.
     */
    const uncounted = entities.filter(
      (entity) => !(declared.auditResources as readonly string[]).includes(entity),
    );
    expect(uncounted, "audited by the module, absent from auditResources").toEqual([]);
  });

  it("declares `meeting_item`, which is the Pendenz seam", () => {
    // "Wann wurde aus dieser Zeile eine Aufgabe" is a question about the line,
    // so `MeetingItemToTask` is audited under its own entity.
    expect(declared.auditResources).toContain("meeting_item");
    expect(entities).toContain("meeting_item");
  });
});

describe("the route prefix", () => {
  it("matches what the meetings controller is mounted at", () => {
    const mount = /@Controller\("([^"]*)"\)/.exec(here("meetings.controller.ts"))?.[1];
    expect(mount, "meetings.controller.ts has no @Controller path").toBeTruthy();
    expect(declared.routePrefix).toBe(`/${mount}`);
  });

  it("is written without the global prefix", () => {
    // `main.ts` mounts everything under `/api/v1` and `MetricsInterceptor`
    // strips it before recording. A module writing `/api/v1/meetings` here
    // would match nothing and report zero requests for ever.
    expect(declared.routePrefix.startsWith("/api")).toBe(false);
  });

  it("does not claim the decisions prefix", () => {
    /**
     * Stated rather than left to look like an oversight: `/decisions` is a
     * second controller of the same module, and its requests are therefore
     * **not** attributed to Sitzungen. A module may declare one prefix, and
     * claiming `/decisions` would need a second source keyed `decision` —
     * which would split figures that are read together. The honest consequence
     * is that decision traffic is unattributed, and this test says so.
     */
    expect(declared.routePrefix).toBe("/meetings");
  });
});

describe("the key and the jobs", () => {
  it("is the permission resource, so an operator reads one word everywhere", () => {
    expect(declared.key).toBe("meeting");
  });

  it("owns no background job", () => {
    // Nothing in this module is slow or time-triggered. A `jobs: []` would
    // report the same thing; leaving it undefined says the module never
    // considered itself to have one.
    expect(declared.jobs).toBeUndefined();
  });

  it("reports no archive, because a meeting has none", async () => {
    /**
     * `CANCELLED` is a meeting that did not happen, not one that is filed away,
     * and `rbac/resources.ts` gives `meeting` no `archive` action. `null` says
     * "no such concept"; `0` would invite an operator to ask why nothing is
     * ever archived.
     *
     * The stub needs `meeting.count` as well as `$transaction`, because
     * `records()` *builds* the three queries before handing them over — which
     * is the whole point of the `$transaction` array form and the reason the
     * four figures cannot disagree with each other.
     */
    const prisma = {
      meeting: { count: () => Promise.resolve(0) },
      $transaction: async () => [3, 3, 0],
    } as never;

    await expect(new MeetingsMetrics(prisma, null as never).records()).resolves.toEqual({
      total: 3,
      active: 3,
      archived: null,
      deleted: 0,
    });
  });
});
