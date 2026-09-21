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
  /**
   * One backup run, by id (P2-5).
   *
   * Declared in F10 as `{ scope: "database" | "media" | "all" }` and enqueued
   * by nobody. The payload changed to an **id** when the module was built, for
   * the reason `notification.deliver` records: the row carries the type, the
   * trigger, the attempt state and the artifacts, so a job that runs twice
   * finds a run already past `QUEUED` instead of starting a second dump of the
   * same database. A payload describing the work rather than naming it is a
   * second copy of it, free to disagree with the row it belongs to.
   */
  "backup.create": { backupRunId: string };
  /** Proves the artifacts are readable. Separate so a slow check gets its own budget. */
  "backup.verify": { backupRunId: string };
  /** Applies the retention policy. Takes nothing: the policy is a setting. */
  "backup.retention": Record<string, never>;
  /** Reads a backup back into a database — a drill, or the real thing. */
  "backup.restore": { restoreRunId: string };
  "reminder.send": { kind: string; entity: string; entityId: string; dueAt: string };
  "report.run": { reportDefinitionId: string; parameters: Record<string, unknown> };
  "notification.digest": { userId: string; period: "DAILY" | "WEEKLY" };
  "sync.run": { integration: string };

  /* ---- Housekeeping ------------------------------------------------- */
  /**
   * One notification's e-mail, and the reason the payload is an **id** rather
   * than a message.
   *
   * This slot was declared as `mail.send`, taking `{ to, subject, template,
   * data }`, and nothing ever enqueued it. Renaming rather than adding beside
   * it was the point: two housekeeping jobs for getting a message out, one of
   * them live and one of them a shape somebody would eventually copy, is the
   * declared-but-dead problem this repository keeps closing elsewhere.
   *
   * The payload names a `NotificationDelivery` row and nothing else, which is
   * what makes the job **idempotent and safe to retry**: the row carries the
   * status, the attempt count and the recipient, so a job that runs twice
   * finds the second attempt already claimed. A payload carrying the message
   * itself would be a second copy of it — free to drift from the notification
   * it belongs to, and a subject line in a queue table that nobody can
   * correct.
   *
   * It also means **no address is ever written into the queue**: a `Job` row
   * is readable by anybody with database access, and the recipient is looked
   * up at send time from the row that owns it.
   */
  "notification.deliver": { deliveryId: string };
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
  "backup.verify",
  "backup.retention",
  "backup.restore",
  "reminder.send",
  "report.run",
  "notification.digest",
  "sync.run",
  "notification.deliver",
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
