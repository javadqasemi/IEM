import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import type { ModuleMetrics, ModuleMetricsSource } from "./metrics.types";

/**
 * The registry, the in-memory counters, and the read that assembles both.
 *
 * Three jobs, and they are together because they are one number three ways: a
 * module's key is what registers it, what the interceptor attributes a request
 * to, and what the report groups by. Splitting them would mean three places
 * that have to agree on a string.
 */

/**
 * How many durations to keep per route.
 *
 * A ring rather than a total, because a mean hides exactly what an operator is
 * looking for: one request in two hundred taking four seconds is invisible in
 * an average and obvious in a p95. Five hundred is a few kilobytes per route
 * and covers the recent past, which is the only part anybody acts on.
 */
const WINDOW = 500;

type RouteStats = {
  durations: number[];
  /** Write position in the ring. */
  at: number;
  requests: number;
  errors: number;
};

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  private readonly sources = new Map<string, ModuleMetricsSource>();
  /** `GET /projects/:id` → its stats. Keyed by method and *route*, not URL. */
  private readonly routes = new Map<string, RouteStats>();
  /** Raised event counts, by name. Reset with the process, like the rest. */
  private readonly events = new Map<string, number>();

  readonly startedAt = new Date();

  constructor(private readonly prisma: PrismaService) {}

  /* ---- Registration ------------------------------------------------ */

  /**
   * A module declares itself, from its own `onModuleInit`.
   *
   * Registering twice is a mistake rather than a merge: two modules answering
   * to one key would silently combine their figures, and the report would be
   * wrong in a way nobody could see. It replaces and warns.
   */
  register(source: ModuleMetricsSource): void {
    if (this.sources.has(source.key)) {
      this.logger.warn(`Metrik-Quelle „${source.key}“ war bereits registriert und wurde ersetzt.`);
    }
    this.sources.set(source.key, source);
  }

  /** Every registered key, for the architecture test that counts them. */
  registered(): string[] {
    return [...this.sources.keys()].sort();
  }

  /* ---- Recording --------------------------------------------------- */

  /**
   * One finished request.
   *
   * `route` is the **pattern** — `/projects/:id` — not the URL. Recording URLs
   * would produce one bucket per project and a report nobody can read, and it
   * is also how an id ends up in a metrics label and then in a log aggregator
   * that was never meant to hold one.
   */
  recordRequest(method: string, route: string, ms: number, failed: boolean): void {
    const key = `${method} ${route}`;
    let stats = this.routes.get(key);
    if (!stats) {
      stats = { durations: [], at: 0, requests: 0, errors: 0 };
      this.routes.set(key, stats);
    }

    stats.requests += 1;
    if (failed) stats.errors += 1;

    if (stats.durations.length < WINDOW) stats.durations.push(ms);
    else {
      stats.durations[stats.at] = ms;
      stats.at = (stats.at + 1) % WINDOW;
    }
  }

  /** One raised domain event. Called by the bus, so no module has to remember. */
  recordEvent(name: string): void {
    this.events.set(name, (this.events.get(name) ?? 0) + 1);
  }

  /* ---- Reading ----------------------------------------------------- */

  /**
   * Every registered module's figures.
   *
   * The counts are read per module rather than in one grouped query, and that
   * is the honest trade: a module owns its own soft-delete predicate, and a
   * generic `groupBy` across twenty-six tables would either duplicate those
   * predicates here or quietly count rows the module considers gone. At
   * twenty-six modules this is twenty-six cheap `count`s behind a route only an
   * operator opens.
   */
  async modules(): Promise<ModuleMetrics[]> {
    const [auditTotals, auditRecent, jobRows] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ["resource"], _count: { _all: true } }),
      this.prisma.auditLog.groupBy({
        by: ["resource"],
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        _count: { _all: true },
      }),
      this.prisma.job.findMany({
        select: { name: true, status: true, durationMs: true },
        where: { OR: [{ status: { in: ["QUEUED", "RUNNING", "DEAD"] } }, { durationMs: { not: null } }] },
        take: 5_000,
      }),
    ]);

    const auditBy = new Map(auditTotals.map((row) => [row.resource, row._count._all]));
    const audit24By = new Map(auditRecent.map((row) => [row.resource, row._count._all]));

    const out: ModuleMetrics[] = [];
    for (const source of this.sources.values()) {
      const records = await source.records();
      out.push({
        key: source.key,
        label: source.label,
        records,
        api: this.apiFor(source.routePrefix),
        events: this.eventsFor(source.events),
        audit: {
          total: sum(source.auditResources.map((r) => auditBy.get(r) ?? 0)),
          last24h: sum(source.auditResources.map((r) => audit24By.get(r) ?? 0)),
        },
        jobs: jobsFor(jobRows, source.jobs ?? []),
      });
    }

    return out.sort((a, b) => a.label.localeCompare(b.label, "de-CH"));
  }

  /**
   * Requests attributed to a prefix.
   *
   * **Longest prefix wins**, which matters the day a module's routes nest
   * inside another's: `/projects/:id/tasks` belongs to Tasks and not to
   * Projects, and a plain `startsWith` over an unordered map would give it to
   * whichever registered first.
   */
  private apiFor(prefix: string): ModuleMetrics["api"] {
    const mine = [...this.routes.entries()].filter(([key]) => {
      const route = key.slice(key.indexOf(" ") + 1);
      if (!route.startsWith(prefix)) return false;
      const better = [...this.sources.values()]
        .map((s) => s.routePrefix)
        .filter((p) => route.startsWith(p));
      return better.every((p) => p.length <= prefix.length);
    });

    const all: number[] = [];
    let requests = 0;
    let errors = 0;
    let slowest: { route: string; p95Ms: number } | null = null;

    for (const [key, stats] of mine) {
      requests += stats.requests;
      errors += stats.errors;
      all.push(...stats.durations);
      const p95 = quantile(stats.durations, 0.95);
      if (p95 !== null && (!slowest || p95 > slowest.p95Ms)) slowest = { route: key, p95Ms: p95 };
    }

    return {
      requests,
      errors,
      // 0 rather than NaN for a module nobody has called. An alert on NaN fires
      // once and is muted for ever after.
      errorRate: requests ? Number((errors / requests).toFixed(4)) : 0,
      /*
        The mean over the same ring the percentiles use, not over every request
        since boot.

        Otherwise the three figures would describe different populations — a
        mean from a week ago beside a p95 from the last five hundred requests —
        and an operator comparing them would be comparing nothing.
      */
      meanMs: mean(all),
      p50Ms: quantile(all, 0.5),
      p95Ms: quantile(all, 0.95),
      slowest,
    };
  }

  private eventsFor(names: readonly string[]): ModuleMetrics["events"] {
    const byName: Record<string, number> = {};
    for (const name of names) byName[name] = this.events.get(name) ?? 0;
    return { total: sum(Object.values(byName)), byName };
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** `null` for an empty sample — a quantile of nothing is not zero. */
function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

/**
 * `null` for an empty sample, for the same reason `quantile` is.
 *
 * Rounded to a whole millisecond: a mean of `12.833333333333334` implies a
 * precision the sample does not have, and it is the figure most likely to end
 * up pasted into a report.
 */
function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round(sum(values) / values.length);
}

function jobsFor(
  rows: { name: string; status: string; durationMs: number | null }[],
  names: readonly string[],
): ModuleMetrics["jobs"] {
  const mine = rows.filter((row) => (names as readonly string[]).includes(row.name));
  const durations = mine
    .map((row) => row.durationMs)
    .filter((ms): ms is number => typeof ms === "number");

  return {
    /*
      What the sample saw, not what the table holds.

      `modules()` reads at most 5'000 job rows, so on a busy installation this
      is a floor rather than a count — which is the honest figure to report
      beside three status counts drawn from the same rows. A separate
      `COUNT(*)` would be exact and would disagree with them.
    */
    total: mine.length,
    queued: mine.filter((row) => row.status === "QUEUED").length,
    running: mine.filter((row) => row.status === "RUNNING").length,
    // The one an operator is paged for: a job that has exhausted its retries.
    dead: mine.filter((row) => row.status === "DEAD").length,
    // Both, and for the reason `api.meanMs` gives: the mean is the comparable
    // figure and the median is the one that survives a single pathological run.
    meanDurationMs: mean(durations),
    p50DurationMs: quantile(durations, 0.5),
  };
}
