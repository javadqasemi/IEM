/**
 * Every background job, by name, with the shape of its payload.
 *
 * Foundation stage F10. Same argument as the event catalogue: a queue keyed by
 * free-text names is a queue where a typo produces a job nobody handles, which
 * sits in the table as `QUEUED` forever and is discovered by somebody asking
 * why an export never arrived.
 *
 * **Why now rather than when the first slow feature lands.** Every one of these
 * is already known to be coming — the firm named most of them — and the cost of
 * adding the seam afterwards is not the seam. It is the features that shipped
 * meanwhile, shaped around doing their work inside a request, which then have
 * to be turned inside out.
 *
 * The entities most of these name do not exist yet, exactly as with the event
 * catalogue. They are declared so that the module which needs one finds a
 * handler slot rather than inventing a mechanism.
 */

export type JobPayloads = {
  /* ---- Exists today, and moves here from `@Cron` ------------------- */
  /** Publishes entries whose scheduled time has passed. */
  "content.publishScheduled": Record<string, never>;
  /** Deletes applications past their retention date, files included. */
  "applications.purgeExpired": Record<string, never>;
  /**
   * Recomputes every live project's `progressPercent` and `health`.
   *
   * The nightly half of "derived, but stored" — two of the inputs are the
   * current date, so a project nobody touches still changes. See
   * `projects.reconcile.ts`.
   */
  "projects.reconcileDerived": Record<string, never>;
  /**
   * Raises `TaskOverdue` for tasks that have passed their date since the last
   * sweep.
   *
   * A job rather than a computed flag, and the distinction is worth stating
   * because the module deliberately does *not* store `isOverdue`: whether a
   * task is overdue is a `where` clause and needs nothing; **telling somebody**
   * is an event, and an event has to be raised by something. Time is the
   * trigger, so a clock is the only thing that can raise it.
   */
  "tasks.flagOverdue": Record<string, never>;

  /* ---- Named by the firm ------------------------------------------- */
  "export.csv": { resource: string; filter: Record<string, unknown>; requestedBy: string };
  "pdf.render": { template: string; entity: string; entityId: string };
  "bim.import": { modelFileId: string; storageKey: string };
  "bim.analyse": { modelFileId: string; kinds: string[] };
  "backup.create": { scope: "database" | "media" | "all" };
  "reminder.send": { kind: string; entity: string; entityId: string; dueAt: string };
  "report.run": { reportDefinitionId: string; parameters: Record<string, unknown> };
  "notification.digest": { userId: string; period: "DAILY" | "WEEKLY" };
  "sync.run": { integration: string };

  /* ---- Housekeeping ------------------------------------------------- */
  "mail.send": { to: string; subject: string; template: string; data: Record<string, unknown> };
};

export type JobName = keyof JobPayloads;

/**
 * The names, at runtime.
 *
 * Needed by the job screen's filter and by `jobs.test.ts`, which asserts this
 * matches the type — a missing line would otherwise produce a name that can be
 * enqueued and never filtered for.
 */
export const JOB_NAMES = [
  "content.publishScheduled",
  "applications.purgeExpired",
  "projects.reconcileDerived",
  "tasks.flagOverdue",
  "export.csv",
  "pdf.render",
  "bim.import",
  "bim.analyse",
  "backup.create",
  "reminder.send",
  "report.run",
  "notification.digest",
  "sync.run",
  "mail.send",
] as const satisfies readonly JobName[];

/**
 * How long to wait before attempt *n*.
 *
 * Exponential with a ceiling, and the ceiling is the point: an IFC import that
 * fails because the file is malformed will fail every time, and doubling
 * forever means the third attempt lands next week, long after anybody could
 * connect it to the upload. Ten minutes is long enough to ride out a restart or
 * a database failover and short enough that the last attempt is same-day.
 */
export function backoffMs(attempt: number): number {
  return Math.min(10 * 60_000, 2 ** attempt * 5_000);
}
