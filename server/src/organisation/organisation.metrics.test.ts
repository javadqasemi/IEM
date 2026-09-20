import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DOMAIN_EVENT_NAMES } from "../core/events/catalogue";
import type { ModuleMetricsSource } from "../core/metrics/metrics.types";
import { OrganisationMetrics } from "./organisation.metrics";

/**
 * Whether the declaration is still true.
 *
 * Same shape as `drawings.metrics.test.ts`, and for the same reason: this file
 * is four lists and a count, every one of them a fact about *other* files, none
 * of them a type. A sixth event added to the service and forgotten here
 * produces a report quietly missing a column, which reads as an event that
 * never happens.
 *
 * This module is the awkward one for the source-reading trick, because its
 * service lives in `core/organisation/` while its metrics live here — two
 * folders, which is precisely the arrangement where a list drifts. The paths
 * below are the answer.
 */

const CORE = resolve(__dirname, "..", "core", "organisation");
const here = (file: string) => readFileSync(join(__dirname, file), "utf8");
const core = (file: string) => readFileSync(join(CORE, file), "utf8");

/** Typed as the interface, not the class — `jobs` is optional on the former. */
const declared: ModuleMetricsSource = new OrganisationMetrics(null as never, null as never);

describe("the events it declares", () => {
  const published = [
    // The organisation's own writes …
    ...[...core("organisation.service.ts").matchAll(/publish\(\s*"(\w+)"/g)].map((m) => m[1]),
    // … plus the archive/restore pair, which is published through a ternary
    // rather than a literal because it is one decision read two ways.
    "OfficeArchived",
    "OfficeRestored",
    // … plus the mail probe, which is raised by the settings controller. It is
    // declared here rather than there because `settings/` has no metrics source
    // of its own (`WITHOUT_METRICS`: routes only, the service is core
    // infrastructure) and an event nobody claims is an event nobody counts.
    "MailTested",
  ];

  it("found the publishes", () => {
    // Guards the assertions below against a regex that matched nothing — which
    // would make them pass by comparing an empty list with itself.
    expect(published.length).toBeGreaterThan(5);
  });

  it("includes every event the module raises", () => {
    const missing = [...new Set(published)].filter(
      (name) => !(declared.events as readonly string[]).includes(name),
    );
    expect(missing, "raised by the module, absent from organisation.metrics.ts").toEqual([]);
  });

  it("declares none the module does not raise", () => {
    const unraised = (declared.events as readonly string[]).filter(
      (name) => !published.includes(name),
    );
    expect(unraised, "declared in organisation.metrics.ts, raised nowhere").toEqual([]);
  });

  it("names only events the catalogue knows", () => {
    const unknown = (declared.events as readonly string[]).filter(
      (name) => !(DOMAIN_EVENT_NAMES as readonly string[]).includes(name),
    );
    expect(unknown, "not in core/events/catalogue.ts").toEqual([]);
  });
});

describe("the module it describes", () => {
  it("keys itself after the resource, so the report and the catalogue agree", () => {
    expect(declared.key).toBe("organisation");
  });

  it("names a route prefix the controller actually serves", () => {
    const controller = here("organisation.controller.ts");
    expect(controller).toContain(`@Controller("organisation")`);
    expect(declared.routePrefix).toBe("/organisation");
  });

  /**
   * The module owns two controllers and declares one prefix, which is a real
   * limitation stated rather than discovered: `/offices` latency is not in the
   * report. `MetricsInterceptor` matches one prefix per source, and splitting
   * this into two sources would report one feature twice and make every figure
   * per-controller rather than per-module — the comparison `/metrics/modules`
   * exists to allow.
   */
  it("serves a second controller the prefix does not cover", () => {
    expect(here("organisation.controller.ts")).toContain(`@Controller("offices")`);
    expect(declared.routePrefix).not.toBe("/offices");
  });

  it("declares no jobs, because nothing here runs on a clock", () => {
    expect(declared.jobs ?? []).toEqual([]);
  });

  it("audits the resources its events name", () => {
    // `entity` on each envelope, which is what the audit row records and what
    // the report counts against.
    expect(declared.auditResources).toContain("organisation");
    expect(declared.auditResources).toContain("office");
    // The settings rows — `settings.updated`, `settings.rejected` and the mail
    // probe all write `resource: "setting"`, and `settings/` reports nothing.
    expect(declared.auditResources).toContain("setting");
  });
});

describe("records", () => {
  /**
   * The stub answers **every** call `records` makes, not every one it awaits:
   * the queries are built before `$transaction` receives them, so a missing
   * `organisation.count` throws while assembling the array.
   */
  function prismaStub(organisations: number, offices: number[]) {
    let call = 0;
    return {
      organisation: { count: vi.fn(() => organisations) },
      office: { count: vi.fn(() => offices[call++] ?? 0) },
      $transaction: (queries: unknown[]) => Promise.resolve(queries),
    } as never;
  }

  it("counts the singleton alongside the offices", async () => {
    // total, active, archived, deleted — offices
    const metrics = new OrganisationMetrics(prismaStub(1, [4, 2, 1, 1]), null as never);
    expect(await metrics.records()).toEqual({
      total: 5,
      active: 3,
      archived: 1,
      deleted: 1,
    });
  });

  it("keeps the three parts adding up to the whole", async () => {
    // The property that makes the four figures readable side by side, and the
    // one the singleton could have broken by being counted into `total` and
    // not into `active`.
    const metrics = new OrganisationMetrics(prismaStub(1, [10, 7, 2, 1]), null as never);
    const records = await metrics.records();
    expect(records.active + (records.archived ?? 0) + records.deleted).toBe(records.total);
  });

  it("reports the organisation even before any office exists", async () => {
    const metrics = new OrganisationMetrics(prismaStub(1, [0, 0, 0, 0]), null as never);
    expect((await metrics.records()).total).toBe(1);
  });

  it("registers itself on init rather than being injected", async () => {
    const register = vi.fn();
    const metrics = new OrganisationMetrics(null as never, { register } as never);
    metrics.onModuleInit();
    expect(register).toHaveBeenCalledWith(metrics);
  });
});
