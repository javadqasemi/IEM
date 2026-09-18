import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DOMAIN_EVENT_NAMES } from "../core/events/catalogue";
import type { ModuleMetricsSource } from "../core/metrics/metrics.types";
import { DrawingsMetrics } from "./drawings.metrics";

/**
 * Whether the declaration is still true.
 *
 * `drawings.metrics.ts` is four lists and a count, and every one of them is a
 * fact about *other* files. None is a type, and none fails when it drifts —
 * adding a twelfth event and forgetting this file produces a report quietly
 * missing a column, which reads as an event that never happens.
 *
 * So the test reads the source. That is unusual and it is the point: it is the
 * only way to assert that a hand-written list matches something a compiler
 * cannot see.
 */

const here = (file: string) => readFileSync(join(__dirname, file), "utf8");

/**
 * Typed as the **interface**, not as the class — `jobs` is optional on
 * `ModuleMetricsSource` and this module declares none, so `declared.jobs` is a
 * compile error on the class while being exactly what the metrics service
 * reads. That mistake cost a red `nest build` on the module before this one,
 * with `tsc --noEmit` passing.
 */
const declared: ModuleMetricsSource = new DrawingsMetrics(null as never, null as never);

describe("the events it declares", () => {
  const source = here("drawings.service.ts");
  const published = [...source.matchAll(/publish\(\s*"(\w+)"/g)].map((m) => m[1]);

  it("found the publishes", () => {
    // Guards the assertions below against a regex that matched nothing — which
    // would make them pass by comparing an empty list with itself.
    expect(published.length).toBeGreaterThan(8);
  });

  it("includes every event the module raises", () => {
    const missing = [...new Set(published)].filter(
      (name) => !(declared.events as readonly string[]).includes(name),
    );
    expect(missing, "raised by the module, absent from drawings.metrics.ts").toEqual([]);
  });

  it("declares none the module does not raise", () => {
    // The direction that rots silently: a declared event nothing raises reports
    // 0 for ever, and 0 is indistinguishable from "this has not happened today".
    const unraised = (declared.events as readonly string[]).filter(
      (name) => !published.includes(name),
    );
    expect(unraised, "declared in drawings.metrics.ts, raised nowhere").toEqual([]);
  });

  /**
   * Three of these were declared during F7, before the module existed. The
   * assertion is that the module was built **to** the catalogue rather than
   * beside it — a `RevisionReleased` invented here while `DrawingReleased` sat
   * unused in the catalogue would have been two names for one fact.
   */
  it("names only events the catalogue knows", () => {
    const unknown = (declared.events as readonly string[]).filter(
      (name) => !(DOMAIN_EVENT_NAMES as readonly string[]).includes(name),
    );
    expect(unknown, "not in core/events/catalogue.ts").toEqual([]);
  });

  it("uses the three F7 names rather than parallel ones", () => {
    expect(declared.events).toContain("DrawingReleased");
    expect(declared.events).toContain("DrawingIssued");
    expect(declared.events).toContain("DrawingWithdrawn");
  });
});

describe("the module it describes", () => {
  it("keys itself after the resource, so the report and the catalogue agree", () => {
    expect(declared.key).toBe("drawing");
  });

  it("names the route prefix the controller actually serves", () => {
    expect(here("drawings.controller.ts")).toContain(`@Controller("drawings")`);
    expect(declared.routePrefix).toBe("/drawings");
  });

  it("declares no jobs, because the module has none", () => {
    // Nothing here runs on a clock. When a plan-expiry sweep arrives it gets a
    // line, and this assertion is what makes forgetting it fail.
    expect(declared.jobs ?? []).toEqual([]);
  });

  it("audits the two aggregates it owns", () => {
    expect(declared.auditResources).toContain("drawing");
    expect(declared.auditResources).toContain("transmittal");
  });
});

describe("records", () => {
  /**
   * The stub has to answer **every** call `records` makes, not every call it
   * awaits: the queries are built before `$transaction` receives them, so a
   * missing `drawing.count` throws while assembling the array rather than
   * inside the transaction. That distinction cost a red run on the module
   * before this one.
   */
  function prismaStub(counts: number[]) {
    let call = 0;
    const count = vi.fn(() => counts[call++] ?? 0);
    return {
      drawing: { count },
      $transaction: (queries: unknown[]) => Promise.resolve(queries),
    } as never;
  }

  it("reports the four states without double-counting", async () => {
    // total, active, archived (withdrawn), deleted
    const metrics = new DrawingsMetrics(prismaStub([100, 82, 12, 6]), null as never);
    const records = await metrics.records();

    expect(records).toEqual({ total: 100, active: 82, archived: 12, deleted: 6 });
    // The three parts add up to the whole, which is the property that makes the
    // figures readable side by side.
    expect(records.active + (records.archived ?? 0) + records.deleted).toBe(records.total);
  });

  /**
   * **The first module where `archived` is not null**, and the reason the slot
   * was added at the review: a withdrawn plan is precisely "kept, finished
   * with". It is not deleted — people hold printed copies and the record of
   * what they were given has to survive — and it is not live.
   */
  it("counts withdrawn plans as archived rather than as nothing", async () => {
    const metrics = new DrawingsMetrics(prismaStub([10, 7, 3, 0]), null as never);
    expect((await metrics.records()).archived).toBe(3);
  });

  it("registers itself on init rather than being injected", async () => {
    const register = vi.fn();
    const metrics = new DrawingsMetrics(null as never, { register } as never);
    metrics.onModuleInit();
    expect(register).toHaveBeenCalledWith(metrics);
  });
});
