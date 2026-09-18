/**
 * What every module reports about itself, for operations.
 *
 * Set by the firm before Wave 2: *"Ab jetzt würde ich keine Module mehr ohne
 * Metriken akzeptieren."* Six figures — records, API latency, events, audit
 * rows, job runtimes, error rate — and explicitly **not for users**. Nobody in
 * the firm opens a screen to find out a module's p95; somebody on call does.
 *
 * ---
 *
 * **Why this is in `core/` and not in the first module that needs it.**
 *
 * The same argument that put events, audit and jobs before the modules rather
 * than after them. Built inside Tasks, the second module writes its own
 * slightly different version and the tenth has ten; and the figures would not
 * be comparable, which is the only property that makes a fleet of them useful.
 * Five of the six are already centralised — `AuditLog`, `Job`, `EventBus` and
 * the list contract all know their own totals — so this is mostly a *reader*
 * plus one interceptor for the two that nothing was recording.
 *
 * **The arrow points from the feature to core.** A module registers itself in
 * its own `onModuleInit`; `core` imports no feature. The alternative — a
 * registry in `core` listing twenty-six modules — is the root-module problem
 * F12 spent a commit removing.
 */

import type { DomainEventName } from "../events/catalogue";
import type { JobName } from "../jobs/catalogue";

/**
 * One module's declaration of what it is.
 *
 * Deliberately small. A module that had to describe *how* to measure itself
 * would be a module that could measure itself differently from its neighbours,
 * which is the thing this exists to prevent. It names what it owns; the service
 * does the counting.
 */
export type ModuleMetricsSource = {
  /** Matches the feature folder and the permission resource — `task`, `project`. */
  key: string;
  /** What an operator reads. German, like every other label in this system. */
  label: string;

  /**
   * How many records it holds, and how many are soft-deleted.
   *
   * A callback rather than a table name, because only the module knows its own
   * soft-delete predicate and whether a row belongs to it — `ProjectMember` is
   * the project module's, not a module of its own.
   */
  records(): Promise<{ total: number; deleted: number }>;

  /**
   * The path prefix its routes share — `/projects`, `/tasks`.
   *
   * Used to attribute a request to a module. A module whose routes do not share
   * one is a module with two names, and that is worth finding out.
   */
  routePrefix: string;

  /** The events it raises. Names, so the catalogue stays the source of truth. */
  events: readonly DomainEventName[];

  /** The background jobs it owns, if any. */
  jobs?: readonly JobName[];

  /**
   * The audit `resource` values its rows carry.
   *
   * Usually one, occasionally more: the project module writes `project`,
   * `project_member`, `project_discipline` and `milestone`, and an operator
   * asking "how much is happening in Projekte" means all four.
   */
  auditResources: readonly string[];
};

/** What `GET /metrics/modules` answers with, per module. */
export type ModuleMetrics = {
  key: string;
  label: string;
  records: { total: number; deleted: number };
  api: {
    /** Since the process started. Says so, because a restart resets it. */
    requests: number;
    errors: number;
    /** 0–1. The figure an alert is actually set on. */
    errorRate: number;
    p50Ms: number | null;
    p95Ms: number | null;
    slowest: { route: string; p95Ms: number } | null;
  };
  events: { total: number; byName: Record<string, number> };
  audit: { total: number; last24h: number };
  jobs: { queued: number; running: number; dead: number; p50DurationMs: number | null };
};
