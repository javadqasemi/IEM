import { JobStatus } from "@prisma/client";
import { scrubBounded } from "../redaction/redact";
import type { HealthState } from "../health/health";
import type { JobName } from "./catalogue";

/**
 * Everything the Job Operations surface decides, without a database.
 *
 * The same split `auth.rules.ts`, `tasks.rules.ts`, `backup.rules.ts` and
 * `content.rules.ts` make. What it buys here specifically: **the UI must never
 * guess whether a job can be retried.** A button that is offered and then
 * refused is worse than no button, and a button that is *not* offered for
 * something that would have worked is a dead end an operator works around by
 * editing the database.
 *
 * So the capability travels with the row, computed here, and the route
 * re-checks it rather than trusting the client.
 */

/* ================================================================== */
/* The state model                                                     */
/* ================================================================== */

/**
 * **`JobStatus.FAILED` is written by nothing**, and that is a finding rather
 * than an oversight to paper over.
 *
 * `JobService.fail` writes `DEAD` when the attempts are exhausted and
 * `QUEUED` when they are not — there is no moment at which a row sits in
 * `FAILED`. The docstring on `JobService` describes `FAILED` as "the
 * transient state between a failed attempt and the retry", and that sentence
 * is a description of a design the implementation did not follow.
 *
 * It is left alone: removing an enum value is a migration, and the value is
 * inert either way. What must *not* happen is a filter chip labelled
 * "Fehlgeschlagen" that can only ever return an empty list — which is how an
 * operator concludes there are no failures. `jobs.rules.test.ts` asserts this
 * list is what the UI filters by.
 */
export const UNREACHABLE_STATUSES: readonly JobStatus[] = [JobStatus.FAILED] as const;

/**
 * What the screen calls a job, derived rather than stored.
 *
 * `RETRYING` is the brief's word and it is **not** a database state — it is
 * `QUEUED` with attempts already spent, which is a genuinely different thing
 * for a reader: "waiting to run for the first time" and "waiting to run again
 * after failing twice" are the same row and opposite news. Deriving it keeps
 * the storage honest and the screen legible, which is the trade
 * `publishEffect` makes in `content.rules.ts`.
 */
export type JobPhase = "QUEUED" | "RETRYING" | "RUNNING" | "DONE" | "DEAD" | "CANCELLED";

export function jobPhase(job: { status: JobStatus; attempts: number }): JobPhase {
  if (job.status === JobStatus.QUEUED) return job.attempts > 0 ? "RETRYING" : "QUEUED";
  if (job.status === JobStatus.FAILED) {
    // Unreachable today (see above). Mapped rather than crashed, because a row
    // that arrived from a migration or a hand-edit must still render.
    return "RETRYING";
  }
  return job.status as JobPhase;
}

/** A job that will not move again on its own. */
export function isTerminal(status: JobStatus): boolean {
  return status === JobStatus.DONE || status === JobStatus.DEAD || status === JobStatus.CANCELLED;
}

/* ================================================================== */
/* Capabilities                                                        */
/* ================================================================== */

/**
 * Job types that must never be re-run from an operator's button.
 *
 * ---
 *
 * ## Why this is a list and not a status check
 *
 * Retrying a dead job is normally safe **because the job did not finish** —
 * that is the whole point of a durable queue. `backup.restore` breaks the
 * assumption: it replaces a database, so "it died half way" does not mean
 * "nothing happened". Re-running it would apply a second restore over
 * whatever state the first one left, and the operator pressing the button
 * would have no way to know which.
 *
 * The recovery path for a failed restore is the one `RestoreService` already
 * documents — inspect the run, read the pre-restore backup, and start a new
 * restore deliberately, with its confirmation and its re-authentication. A
 * retry button would be a way around both.
 */
export const NEVER_RETRYABLE: readonly string[] = ["backup.restore"] as const;

export type JobCapabilities = {
  retryable: boolean;
  cancellable: boolean;
  /** Why not, when either is false. Shown as the button's tooltip. */
  retryRefusal: string | null;
  cancelRefusal: string | null;
};

type CapabilityInput = { name: string; status: JobStatus };

/**
 * What an operator may do with this job.
 *
 * Both answers are computed server-side and travel with the row, because the
 * client cannot know the rules and must not learn them: a second copy of
 * `NEVER_RETRYABLE` in the dashboard is a copy that will be one entry behind
 * on the day it matters.
 */
export function jobCapabilities(job: CapabilityInput): JobCapabilities {
  return {
    retryable: refuseRetry(job) === null,
    retryRefusal: refuseRetry(job),
    cancellable: refuseCancel(job) === null,
    cancelRefusal: refuseCancel(job),
  };
}

/**
 * Why this job may not be retried, or `null`.
 *
 * Only a job that has **stopped without succeeding** is retryable. That is
 * `DEAD` (out of attempts) and `CANCELLED` (stopped before it ever ran, so
 * re-queuing runs it for the first time).
 *
 * `DONE` is refused by name rather than by omission, because it is the one an
 * operator will actually try: "run the nightly purge again" is a reasonable
 * thing to want and a retry is the wrong mechanism for it — the job's result
 * is already recorded, and re-running it would overwrite a completed run's row
 * with a second outcome.
 */
export function refuseRetry(job: CapabilityInput): string | null {
  if (NEVER_RETRYABLE.includes(job.name)) {
    return (
      `„${job.name}“ lässt sich nicht per Knopfdruck wiederholen: die Aufgabe verändert ` +
      "Produktivdaten, und ein abgebrochener Lauf bedeutet nicht, dass nichts geschehen ist. " +
      "Starten Sie eine neue Wiederherstellung bewusst — mit Bestätigung und erneuter Anmeldung."
    );
  }
  if (job.status === JobStatus.RUNNING) {
    return "Die Aufgabe läuft gerade. Warten Sie ab, was dabei herauskommt.";
  }
  if (job.status === JobStatus.QUEUED || job.status === JobStatus.FAILED) {
    return "Die Aufgabe wartet ohnehin auf ihren nächsten Versuch.";
  }
  if (job.status === JobStatus.DONE) {
    return (
      "Diese Aufgabe ist erfolgreich durchgelaufen. Ein erneuter Lauf würde das Ergebnis " +
      "überschreiben — lösen Sie die Arbeit dort aus, wo sie hingehört."
    );
  }
  return null;
}

/**
 * Why this job may not be cancelled, or `null`.
 *
 * `QUEUED` only, which is the same condition `JobService.cancel` enforces in
 * its `where` clause. The two agreeing is not redundancy: the `where` is what
 * makes it race-free — two operators pressing cancel at the moment a worker
 * claims the row — and this is what makes the button honest before they press
 * it.
 *
 * A `RUNNING` job is refused with the real reason rather than a shrug. There
 * is no cancellation token in this queue, so "stop it" would mean marking a
 * row cancelled while the worker carries on writing to it — a status that
 * says something the system cannot deliver.
 */
export function refuseCancel(job: CapabilityInput): string | null {
  if (job.status === JobStatus.QUEUED) return null;
  if (job.status === JobStatus.RUNNING) {
    return (
      "Die Aufgabe läuft bereits. Sie lässt sich nicht anhalten — der Arbeitsprozess kennt " +
      "keinen Abbruch, und ein Abbruchvermerk auf einer laufenden Aufgabe wäre schlicht falsch."
    );
  }
  return "Nur wartende Aufgaben lassen sich abbrechen.";
}

/* ================================================================== */
/* The queue's own health                                              */
/* ================================================================== */

export type JobCounts = {
  queued: number;
  running: number;
  dead: number;
  done24h: number;
};

/**
 * How the job queue reports itself to the System overview.
 *
 * ---
 *
 * ## Why `dead > 0` is a warning and not a failure
 *
 * A dead job is work that did not happen and that **nobody is going to retry
 * on its own** — that is the definition of the state. It is not, however, the
 * queue being broken: the queue did exactly what it promised, three times.
 * Reserving `critical` for the queue itself being stuck keeps the two apart,
 * and an operator who sees `critical` on this card knows it means something
 * other than "look at the dead letters".
 *
 * ## Why a large backlog is a warning rather than a number nobody reads
 *
 * `QUEUE_BACKLOG_WARNING` is a threshold and therefore a decision, so it is
 * named here rather than buried in a comparison. Fifty is chosen from the
 * shape of this system's own work: the recurring jobs are four, the bursty
 * ones are notification deliveries, and fifty waiting at once means either the
 * runner has stopped or something is enqueueing in a loop. Both are worth a
 * look and neither is an emergency.
 */
export const QUEUE_BACKLOG_WARNING = 50;

export function jobsHealth(counts: JobCounts): { state: HealthState; reasons: string[] } {
  const reasons: string[] = [];
  if (counts.dead > 0) {
    reasons.push(
      counts.dead === 1
        ? "1 Aufgabe hat endgültig aufgegeben"
        : `${counts.dead} Aufgaben haben endgültig aufgegeben`,
    );
  }
  if (counts.queued >= QUEUE_BACKLOG_WARNING) {
    reasons.push(`${counts.queued} Aufgaben warten — läuft der Arbeitsprozess?`);
  }
  return { state: reasons.length ? "warning" : "healthy", reasons };
}

/* ================================================================== */
/* What a row may say                                                  */
/* ================================================================== */

/**
 * The payload, safe to send to a browser.
 *
 * Two guarantees, and the second is the one that is easy to forget: secrets
 * are removed by key name (`core/redaction/redact.ts`, the same denylist the
 * audit log uses), **and the whole thing is bounded**, because a job payload
 * is `Json` and as large as whoever enqueued it made it.
 */
export function safePayload(payload: unknown): unknown {
  return scrubBounded(payload, 2_000);
}

/**
 * A job's error, safe to send to a browser.
 *
 * `Job.error` is already truncated to 2'000 characters by `JobService.fail`,
 * and it is a *message* rather than structured data — so the key-name denylist
 * cannot reach into it. `redactToolOutput` in `core/backup/backup.failure.ts`
 * is what strips a connection string out of a tool's own output, and it is
 * applied here for the same reason it is applied there: `pg_dump` builds its
 * error text by echoing the connection it attempted.
 */
export function safeError(error: string | null, redactor: (t: string) => string): string | null {
  if (!error) return null;
  return redactor(error);
}

/** The catalogue name, narrowed when it is one we know, for the filter list. */
export function isKnownJobName(name: string, known: readonly string[]): name is JobName {
  return known.includes(name);
}
