import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { JobStatus } from "@prisma/client";
import { hostname } from "node:os";
import { RedisService } from "../../common/redis";
import { EventBus } from "../events/event-bus";
import { newContext, runWithContext } from "../context/request-context";
import { JobService, type ClaimedJob } from "./job.service";

/**
 * Polls the queue and runs what it finds.
 *
 * **A poller rather than a queue server**, and the trade is deliberate: one
 * table plus this file is ~150 lines, Redis is already a documented dependency
 * for the scheduler's lock, and `JobService.enqueue` is the seam — moving to
 * BullMQ later changes this file and nothing else. The day the queue needs
 * priorities, fan-out or a rate limit per handler is the day to revisit it.
 *
 * Every worker polls; the claim is what serialises them, not a lock
 * (`JobService.claim`). That is the opposite of `ScheduledTasks`, which uses the
 * Redis lock because a cron *tick* has no row to compete over — and it is why
 * both mechanisms exist rather than one.
 *
 * ---
 *
 * **A job runs inside its own context, carrying the correlation id of the
 * request that enqueued it.** So an export's audit rows group with the click
 * that asked for it, days later if the queue was backed up. That inheritance is
 * the whole reason `correlationId` is a column on `Job` rather than something
 * the handler passes along.
 */
@Injectable()
export class JobRunner {
  private readonly logger = new Logger(JobRunner.name);
  private readonly worker = `${hostname()}:${process.pid}`;

  /**
   * One tick at a time, per process.
   *
   * Without it a tick that runs longer than the interval overlaps itself, and
   * two ticks in one worker both claim — which is safe, because the claim is
   * atomic, but doubles the concurrency silently on exactly the jobs that are
   * slow enough to matter.
   */
  private ticking = false;

  constructor(
    private readonly jobs: JobService,
    private readonly bus: EventBus,
    private readonly redis: RedisService,
  ) {}

  /**
   * Every ten seconds.
   *
   * Fast enough that an export feels immediate and slow enough that an idle
   * system is not doing a query a second per worker. A job that needs to start
   * *now* is a job that should not be a job.
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // A bounded batch rather than "drain the queue": a backlog of 4'000
      // reminders must not monopolise the worker, and the next tick is ten
      // seconds away.
      for (let i = 0; i < 5; i++) {
        const job = await this.jobs.claim(this.worker);
        if (!job) break;
        await this.run(job);
      }
    } catch (err) {
      this.logger.error(`Job-Tick fehlgeschlagen: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Returns jobs abandoned by a killed worker.
   *
   * Locked behind Redis because it is a sweep rather than a claim — every
   * worker running it at once would be harmless but pointless.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  reclaim(): Promise<number | null> {
    return this.redis.withLock("cron:reclaim-jobs", 120, () => this.jobs.reclaimStale());
  }

  private async run(job: ClaimedJob): Promise<void> {
    const started = Date.now();

    /*
      The job's own context.

      It inherits the correlation id so its audit rows group with the request
      that enqueued it, and the actor so the rows say who asked rather than
      "System". A job with neither — a scheduled tick — gets a fresh id, which
      groups that one run.
    */
    const context = newContext({
      correlationId: job.correlationId ?? undefined,
      actor: job.actorId
        ? {
            id: job.actorId,
            email: job.actorEmail ?? "",
            name: job.actorEmail ?? "",
            roles: [],
            permissions: new Set<string>(),
            isSuperAdmin: false,
          }
        : null,
    });

    await runWithContext(context, async () => {
      if (!this.jobs.hasHandler(job.name)) {
        /*
          No handler is permanent, not transient.

          Retrying three times against a handler that is still missing only
          delays the same outcome and fills the log. `permanent` sends it
          straight to DEAD with a message that names the job, which is what an
          operator needs to see.
        */
        await this.jobs.fail(
          job,
          new Error(`Kein Handler für "${job.name}" registriert.`),
          Date.now() - started,
          { permanent: true },
        );
        this.logger.error(`Aufgabe ${job.name} (${job.id}) hat keinen Handler.`);
        return;
      }

      try {
        const result = await this.jobs.run(job.name, job.payload);
        // Flushed before the job is marked done: the events a handler raised
        // describe work that has now happened, and a crash between the two
        // should lose the "done" rather than the announcement.
        await this.bus.flush();
        await this.jobs.complete(job.id, result, Date.now() - started);
      } catch (err) {
        // Anything the handler queued describes work that did not finish.
        const dropped = this.bus.discard();
        const status = await this.jobs.fail(job, err, Date.now() - started);
        this.logger.error(
          `Aufgabe ${job.name} (${job.id}) fehlgeschlagen${
            status === JobStatus.DEAD ? " — endgültig" : `, Versuch ${job.attempts}`
          }: ${(err as Error).message}${dropped ? ` (${dropped} Ereignis(se) verworfen)` : ""}`,
        );
      }
    });
  }
}
