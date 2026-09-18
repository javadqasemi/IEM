import { describe, expect, it } from "vitest";
import { MetricsService } from "./metrics.service";
import type { ModuleMetrics, ModuleMetricsSource } from "./metrics.types";

/**
 * The parts of the metrics service that can be wrong without failing.
 *
 * Latency attribution, the error rate and the quantiles are all figures that
 * *look* plausible whatever they are: a p95 of 4 ms and a p95 of 400 ms are
 * equally believable to a reader who was not there, and an operator has no way
 * to tell a module that is quiet from a module whose routes are being counted
 * against its neighbour. Nothing here throws, so nothing here is caught except
 * by assertions.
 *
 * No database: `modules()` is exercised against the API surface only in
 * `metrics.spec.ts`, which asks the running server. What is tested here is the
 * arithmetic and the attribution, which are pure.
 */

const source = (over: Partial<ModuleMetricsSource> & { key: string; routePrefix: string }) =>
  ({
    label: over.key,
    events: [],
    auditResources: [],
    records: async () => ({ total: 0, deleted: 0 }),
    ...over,
  }) as ModuleMetricsSource;

/**
 * `apiFor` and `eventsFor` are private, and stay private.
 *
 * Reaching through the cast rather than widening them, because the *report* is
 * the contract this service offers and these two are how it is assembled. A
 * public method is one another module can call, and a module reading another's
 * latency is the coupling the event bus exists to prevent.
 */
const apiFor = (service: MetricsService, prefix: string): ModuleMetrics["api"] =>
  (service as unknown as { apiFor(p: string): ModuleMetrics["api"] }).apiFor(prefix);

const eventsFor = (service: MetricsService, names: readonly string[]): ModuleMetrics["events"] =>
  (service as unknown as { eventsFor(n: readonly string[]): ModuleMetrics["events"] }).eventsFor(names);

function service(): MetricsService {
  return new MetricsService(null as never);
}

describe("registration", () => {
  it("lists what registered, sorted", () => {
    const metrics = service();
    metrics.register(source({ key: "task", routePrefix: "/tasks" }));
    metrics.register(source({ key: "project", routePrefix: "/projects" }));
    expect(metrics.registered()).toEqual(["project", "task"]);
  });

  it("replaces rather than merges a duplicate key", () => {
    /*
      Two sources answering to one key would add their figures together, and the
      report would be wrong with nothing to notice — every number simply larger.
      Replacing keeps it wrong in one module instead of silently wrong in the
      arithmetic, and the service logs a warning.
    */
    const metrics = service();
    metrics.register(source({ key: "project", routePrefix: "/projects" }));
    metrics.register(source({ key: "project", routePrefix: "/andere" }));
    expect(metrics.registered()).toEqual(["project"]);
  });
});

describe("attribution", () => {
  it("counts only the routes under a module's prefix", () => {
    const metrics = service();
    metrics.register(source({ key: "project", routePrefix: "/projects" }));
    metrics.register(source({ key: "content", routePrefix: "/content" }));

    metrics.recordRequest("GET", "/projects", 10, false);
    metrics.recordRequest("GET", "/projects/:id", 20, false);
    metrics.recordRequest("GET", "/content/entries", 30, false);

    expect(apiFor(metrics, "/projects").requests).toBe(2);
    expect(apiFor(metrics, "/content").requests).toBe(1);
  });

  it("gives a nested route to the deeper module", () => {
    /**
     * The case that made attribution a function rather than a `startsWith`.
     *
     * `/projects/:id/tasks` belongs to Tasks. With a plain prefix test it
     * belongs to both, so its latency is added to Projects as well — and the
     * first thing an operator would conclude from Projects' p95 tripling is
     * that the project detail query regressed.
     */
    const metrics = service();
    metrics.register(source({ key: "project", routePrefix: "/projects" }));
    metrics.register(source({ key: "task", routePrefix: "/projects/:id/tasks" }));

    metrics.recordRequest("GET", "/projects/:id", 10, false);
    metrics.recordRequest("GET", "/projects/:id/tasks", 90, false);

    expect(apiFor(metrics, "/projects").requests).toBe(1);
    expect(apiFor(metrics, "/projects").p95Ms).toBe(10);
    expect(apiFor(metrics, "/projects/:id/tasks").requests).toBe(1);
  });

  it("names the slowest route, not the busiest", () => {
    const metrics = service();
    metrics.register(source({ key: "project", routePrefix: "/projects" }));
    for (let i = 0; i < 50; i += 1) metrics.recordRequest("GET", "/projects", 5, false);
    metrics.recordRequest("GET", "/projects/:id/export", 900, false);

    expect(apiFor(metrics, "/projects").slowest).toEqual({
      route: "GET /projects/:id/export",
      p95Ms: 900,
    });
  });

  it("separates methods on one path", () => {
    // `GET /projects` and `POST /projects` are different work with different
    // costs; one bucket would hide a slow create behind a fast list.
    const metrics = service();
    metrics.register(source({ key: "project", routePrefix: "/projects" }));
    metrics.recordRequest("GET", "/projects", 5, false);
    metrics.recordRequest("POST", "/projects", 500, false);

    expect(apiFor(metrics, "/projects").slowest?.route).toBe("POST /projects");
  });
});

describe("the error rate", () => {
  it("is 0 and not NaN for a module nobody has called", () => {
    // An alert set on NaN fires once and is muted for ever after.
    const metrics = service();
    metrics.register(source({ key: "project", routePrefix: "/projects" }));
    const api = apiFor(metrics, "/projects");
    expect(api.errorRate).toBe(0);
    expect(api.requests).toBe(0);
  });

  it("is a share of the module's own requests", () => {
    const metrics = service();
    metrics.register(source({ key: "project", routePrefix: "/projects" }));
    metrics.register(source({ key: "content", routePrefix: "/content" }));

    metrics.recordRequest("GET", "/projects", 5, false);
    metrics.recordRequest("GET", "/projects", 5, false);
    metrics.recordRequest("GET", "/projects", 5, true);
    metrics.recordRequest("GET", "/projects", 5, true);
    // Somebody else's failure must not appear in Projects' rate.
    metrics.recordRequest("GET", "/content", 5, true);

    expect(apiFor(metrics, "/projects").errorRate).toBe(0.5);
    expect(apiFor(metrics, "/content").errorRate).toBe(1);
  });
});

describe("the quantiles", () => {
  it("are null for an empty sample", () => {
    // Not 0: a p95 of nothing is not a fast module, and reporting 0 would make
    // a module that has never been called look like the healthiest one.
    const metrics = service();
    metrics.register(source({ key: "project", routePrefix: "/projects" }));
    const api = apiFor(metrics, "/projects");
    expect(api.p50Ms).toBeNull();
    expect(api.p95Ms).toBeNull();
  });

  it("report the tail rather than the mean", () => {
    /**
     * The whole reason a ring of samples is kept instead of a running total.
     *
     * Ninety requests at 10 ms and ten at 2 s have a mean of 209 ms, which is
     * a number nobody would act on and which describes no request that actually
     * happened — every one was either fast or terrible. The p50 has to stay at
     * the fast group and the p95 has to land in the slow one, because "one user
     * in ten waits two seconds" is the fact and the mean cannot express it.
     */
    const metrics = service();
    metrics.register(source({ key: "project", routePrefix: "/projects" }));
    for (let i = 0; i < 90; i += 1) metrics.recordRequest("GET", "/projects", 10, false);
    for (let i = 0; i < 10; i += 1) metrics.recordRequest("GET", "/projects", 2_000, false);

    const api = apiFor(metrics, "/projects");
    expect(api.p50Ms).toBe(10);
    expect(api.p95Ms).toBe(2_000);
  });

  it("does not surface a one-in-a-hundred spike, and that is what p95 means", () => {
    /*
      Written down because it looks like a bug the first time somebody meets it.
      A single 2 s request among ninety-nine fast ones leaves the p95 at 10 ms —
      correctly: it is the 95th percentile, not the maximum. An operator
      chasing a rare spike wants `slowest` and the route breakdown, and the day
      a p99 is wanted it is a line in `quantile`, not a different design.
    */
    const metrics = service();
    metrics.register(source({ key: "project", routePrefix: "/projects" }));
    for (let i = 0; i < 99; i += 1) metrics.recordRequest("GET", "/projects", 10, false);
    metrics.recordRequest("GET", "/projects", 2_000, false);

    expect(apiFor(metrics, "/projects").p95Ms).toBe(10);
  });

  it("keeps only the recent past", () => {
    /*
      The ring is 500 wide. A module that was slow this morning and is fast now
      must read as fast — the figure exists to answer "what is happening", and a
      total from process start answers "what has ever happened", which is a
      different question and the wrong one to page somebody on.
    */
    const metrics = service();
    metrics.register(source({ key: "project", routePrefix: "/projects" }));
    for (let i = 0; i < 600; i += 1) metrics.recordRequest("GET", "/projects", 1_000, false);
    for (let i = 0; i < 500; i += 1) metrics.recordRequest("GET", "/projects", 5, false);

    const api = apiFor(metrics, "/projects");
    expect(api.p95Ms).toBe(5);
    // The counters are not a window, though: the request total is every one.
    expect(api.requests).toBe(1_100);
  });
});

describe("events", () => {
  it("reports a declared event that has not happened as 0", () => {
    // Absent and zero are different, and only one of them is a fact. A module
    // that declares `MilestoneMissed` and never raises it should say so.
    const metrics = service();
    metrics.recordEvent("ProjectCreated");
    metrics.recordEvent("ProjectCreated");

    expect(eventsFor(metrics, ["ProjectCreated", "MilestoneMissed"])).toEqual({
      total: 2,
      byName: { ProjectCreated: 2, MilestoneMissed: 0 },
    });
  });

  it("counts nobody else's events", () => {
    const metrics = service();
    metrics.recordEvent("ProjectCreated");
    metrics.recordEvent("ContentEntryPublished");

    expect(eventsFor(metrics, ["ProjectCreated"]).total).toBe(1);
  });
});
