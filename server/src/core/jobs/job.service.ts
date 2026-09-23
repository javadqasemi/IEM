import { Injectable, Logger } from "@nestjs/common";
import { JobStatus } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { currentActor, correlationId } from "../context/request-context";
import { backoffMs, type JobName, type JobPayloads } from "./catalogue";
import { NEVER_RETRYABLE, STALE_SINGLE_ATTEMPT_ERROR, isSingleAttempt } from "./jobs.rules";

export type JobHandler<N extends JobName = JobName> = (
  payload: JobPayloads[N],
) => Promise<unknown>;

/**
 * The queue: enqueue, claim, complete, fail.
 *
 * Foundation stage F10, and the one seam anything long-running goes through.
 * `JobRunner` does the polling; this owns the rows and the state machine, so
 * both are testable and neither knows about the other's timing.
 *
 * ```
 * QUEUED ──claim──> RUNNING ──ok────> DONE
 *    ^                  │
 *    └───retry──────────┤ (attempts < maxAttempts, after a backoff)
 *                       └──out of attempts──> DEAD
 * ```
 *
 * `FAILED` is the transient state between a failed attempt and the retry;
 * `DEAD` is terminal and means a human decides. The two are separate because
 * "it failed and will try again" and "it failed and never will" are the
 * difference between waiting and acting, and a single `FAILED` makes an
 * operator guess which one they are looking at.
 */
@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);
  private readonly handlers = new Map<string, JobHandler>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers the function that does the work.
   *
   * Called from a module's `onModuleInit`. A name with no handler is not an
   * error at enqueue time — the deploy that adds the producer and the one that
   * adds the consumer may legitimately differ — but it *is* an error at claim
   * time, and the job goes `DEAD` with a message saying so rather than being
   * retried three times against a handler that is still missing.
   */
  register<N extends JobName>(name: N, handler: JobHandler<N>): void {
    if (this.handlers.has(name)) {
      throw new Error(`Job-Handler "${name}" ist bereits registriert.`);
    }
    this.handlers.set(name, handler as JobHandler);
  }

  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Runs one handler.
   *
   * Public so `JobRunner` does not have to reach into the map, and so a test
   * can drive a handler without the polling around it. It deliberately does
   * **not** touch the row: state transitions are `claim`/`complete`/`fail`, and
   * a method that did both would make "did the work run" and "does the row say
   * so" one fact when they are two.
   */
  run(name: string, payload: unknown): Promise<unknown> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Kein Handler für "${name}" registriert.`);
    return handler(payload as never);
  }

  /**
   * Queues work and returns immediately.
   *
   * The actor and the correlation id come from the ambient request context, so
   * the job's audit rows group with the click that caused it — which is the
   * property that makes "why did this export run" answerable.
   *
   * `runAfter` schedules it; `maxAttempts` overrides the default for work that
   * is known to be flaky (a network sync) or known not to be (a PDF render,
   * where a second attempt fails the same way).
   */
  async enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options: { runAfter?: Date; maxAttempts?: number } = {},
  ): Promise<string> {
    const actor = currentActor();
    const job = await this.prisma.job.create({
      data: {
        name,
        payload: payload as object,
        runAfter: options.runAfter ?? new Date(),
        // A single-attempt job cannot be given more, whatever the caller
        // asks for — see `NEVER_RETRYABLE`.
        maxAttempts: isSingleAttempt(name) ? 1 : (options.maxAttempts ?? 3),
        correlationId: correlationId(),
        actorId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
      },
      select: { id: true },
    });
    return job.id;
  }

  /**
   * Queues it only if one of the same name is not already waiting or running.
   *
   * What recurring work needs. A cron that enqueues every five minutes while
   * the runner is behind produces a backlog of identical jobs, and for
   * `content.publishScheduled` that is not merely wasteful — it is four
   * snapshots of the site, which is the exact failure the Redis lock was added
   * to prevent.
   *
   * Returns the existing job's id when it skipped, so a caller can log which.
   * There is a race — two workers can both find nothing and both insert — and
   * it is left open deliberately: closing it needs a partial unique index on a
   * condition Prisma cannot express, and the cost of the rare duplicate is one
   * redundant run of an idempotent job. The one job that is *not* idempotent
   * keeps its Redis lock as well.
   */
  async enqueueUnique<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options: { runAfter?: Date; maxAttempts?: number } = {},
  ): Promise<{ id: string; created: boolean }> {
    const pending = await this.prisma.job.findFirst({
      where: { name, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
      select: { id: true },
    });
    if (pending) return { id: pending.id, created: false };
    return { id: await this.enqueue(name, payload, options), created: true };
  }

  /**
   * Takes the next due job, atomically.
   *
   * `updateMany` with the id from a prior `findFirst` **and** a `status:
   * QUEUED` condition in the same statement: two workers polling at once both
   * read the same row, and without the condition in the write both would run
   * it. The one whose update reports `count: 1` has it; the other gets 0 and
   * asks again. That is the whole concurrency story, and it needs no lock.
   *
   * This is also why the Redis lock in `ScheduledTasks` is not enough on its
   * own — that serialises the *tick*, and this serialises the *row*.
   */
  async claim(worker: string): Promise<ClaimedJob | null> {
    const candidate = await this.prisma.job.findFirst({
      where: { status: JobStatus.QUEUED, runAfter: { lte: new Date() } },
      orderBy: [{ runAfter: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (!candidate) return null;

    const { count } = await this.prisma.job.updateMany({
      where: { id: candidate.id, status: JobStatus.QUEUED },
      data: {
        status: JobStatus.RUNNING,
        startedAt: new Date(),
        lockedBy: worker,
        lockedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (count !== 1) return null;

    const job = await this.prisma.job.findUnique({ where: { id: candidate.id } });
    if (!job) return null;
    return {
      id: job.id,
      name: job.name,
      payload: (job.payload ?? {}) as Record<string, unknown>,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      correlationId: job.correlationId,
      actorId: job.actorId,
      actorEmail: job.actorEmail,
    };
  }

  async complete(id: string, result: unknown, durationMs: number): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: {
        status: JobStatus.DONE,
        finishedAt: new Date(),
        durationMs,
        result: (result ?? undefined) as object | undefined,
        error: null,
        lockedBy: null,
        lockedAt: null,
      },
    });
  }

  /**
   * Records a failed attempt and decides what happens next.
   *
   * Returns the status it landed in, so the caller can log the difference
   * between "will retry" and "gave up" without re-deriving the rule.
   */
  async fail(
    job: ClaimedJob,
    error: unknown,
    durationMs: number,
    options: { permanent?: boolean } = {},
  ): Promise<JobStatus> {
    const message = error instanceof Error ? error.message : String(error);
    // The name as well as the count: a restore enqueued before single-attempt
    // jobs existed still carries `maxAttempts: 3` in its row.
    const exhausted =
      options.permanent || isSingleAttempt(job.name) || job.attempts >= job.maxAttempts;

    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: exhausted ? JobStatus.DEAD : JobStatus.QUEUED,
        finishedAt: exhausted ? new Date() : null,
        durationMs,
        // Truncated: a stack trace from a malformed IFC can be megabytes, and
        // a job table nobody can query is a job table nobody reads.
        error: message.slice(0, 2000),
        runAfter: exhausted ? undefined : new Date(Date.now() + backoffMs(job.attempts)),
        lockedBy: null,
        lockedAt: null,
      },
    });

    return exhausted ? JobStatus.DEAD : JobStatus.QUEUED;
  }

  /**
   * Puts a dead job back in the queue, with its attempt count reset.
   *
   * The operator's half of `DEAD`. Without it the terminal state is a dead end
   * and the only recovery is editing the database by hand, which is how
   * "temporarily" becomes permanent.
   */
  async retry(id: string): Promise<void> {
    /*
      The single-attempt rule in the `where`, not only in the route's
      `refuseRetry`: this is the method that re-queues, and a second caller
      that forgot to ask first must still be unable to re-run a restore.
    */
    const { count } = await this.prisma.job.updateMany({
      where: { id, name: { notIn: [...NEVER_RETRYABLE] } },
      data: {
        status: JobStatus.QUEUED,
        attempts: 0,
        runAfter: new Date(),
        error: null,
        finishedAt: null,
        lockedBy: null,
      },
    });
    if (count !== 1) {
      throw new Error(`Aufgabe ${id} lässt sich nicht wiederholen.`);
    }
  }

  async cancel(id: string): Promise<void> {
    // Only a job that has not started: cancelling a `RUNNING` one would leave
    // the worker writing to a row that says it was cancelled, and the honest
    // answer to "can I stop this" is no once it is in flight.
    await this.prisma.job.updateMany({
      where: { id, status: JobStatus.QUEUED },
      data: { status: JobStatus.CANCELLED, finishedAt: new Date() },
    });
  }

  /**
   * Returns jobs stuck in `RUNNING` to the queue.
   *
   * A worker killed mid-job leaves its row claimed forever — `lockedAt` is what
   * makes that recoverable. The timeout has to exceed the longest plausible
   * run, for the same reason `RedisService.withLock`'s TTL does, or a slow BIM
   * import is reclaimed while it is still working and runs twice.
   */
  async reclaimStale(olderThanMs = 30 * 60_000): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    /*
      A stale single-attempt job is ended, not re-queued. "The worker stopped
      reporting" does not mean "nothing happened" for a restore any more than
      a failure does, and a restore that simply takes longer than thirty
      minutes would otherwise be started a second time over itself.
    */
    const ended = await this.prisma.job.updateMany({
      where: {
        status: JobStatus.RUNNING,
        lockedAt: { lt: cutoff },
        name: { in: [...NEVER_RETRYABLE] },
      },
      data: {
        status: JobStatus.DEAD,
        finishedAt: new Date(),
        error: STALE_SINGLE_ATTEMPT_ERROR,
        lockedBy: null,
        lockedAt: null,
      },
    });
    if (ended.count) {
      this.logger.error(
        `${ended.count} hängengebliebene, nicht wiederholbare Aufgabe(n) beendet — manuelle Prüfung nötig.`,
      );
    }

    const { count } = await this.prisma.job.updateMany({
      where: {
        status: JobStatus.RUNNING,
        lockedAt: { lt: cutoff },
        name: { notIn: [...NEVER_RETRYABLE] },
      },
      data: { status: JobStatus.QUEUED, lockedBy: null, lockedAt: null, startedAt: null },
    });
    if (count) this.logger.warn(`${count} hängengebliebene Aufgabe(n) zurück in die Warteschlange.`);
    return count;
  }
}

export type ClaimedJob = {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
  actorId: string | null;
  actorEmail: string | null;
};
