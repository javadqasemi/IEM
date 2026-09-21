import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { WorkflowState } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { RedisService } from "../common/redis";
import { AuditService } from "../core/audit/audit.service";
import { EventBus } from "../core/events/event-bus";
import { JobService } from "../core/jobs/job.service";
import { ApplicationsService } from "../applications/applications.service";
import { ContentService } from "../content/content.service";

/**
 * Recurring work: the timer, and the handlers behind it.
 *
 * **What changed in foundation stage F10.** The four jobs used to *be* the cron
 * methods — the work ran inside the timer, in the process, with no record that
 * it had happened. A publish that failed at 03:00 was a line in a log file, and
 * "did the retention purge run last night" had no answer at all.
 *
 * Now the timer **enqueues** and `JobRunner` executes. What that buys, and none
 * of it was available before:
 *
 * | | |
 * | --- | --- |
 * | Durable | a restart mid-purge resumes instead of skipping a night |
 * | Retried | a publish that failed on a locked table tries again in 10 s, not in 5 min |
 * | Visible | a row an operator can read, with its duration and its error |
 * | Attributable | the audit rows it writes carry the run's correlation id |
 *
 * The two cheap housekeeping deletes stay inline. They are single `deleteMany`
 * statements with no failure mode worth recording, and wrapping each in a job
 * row would be more bookkeeping than work.
 *
 * **Both mechanisms are still here and both are needed.** The Redis lock
 * serialises the *tick* — one worker decides to enqueue. `JobService.claim`
 * serialises the *row* — one worker runs it. Neither replaces the other.
 */
@Injectable()
export class ScheduledTasks implements OnModuleInit {
  private readonly logger = new Logger(ScheduledTasks.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly jobs: JobService,
    private readonly events: EventBus,
    private readonly applications: ApplicationsService,
    private readonly content: ContentService,
  ) {}

  /**
   * The handlers, registered once at boot.
   *
   * Registration is separate from enqueueing on purpose: a deploy that adds a
   * producer before its consumer is legitimate, and a job with no handler is
   * held as `DEAD` with a message rather than retried three times against
   * nothing.
   */
  onModuleInit(): void {
    this.jobs.register("content.publishScheduled", () => this.doPublishScheduled());
    this.jobs.register("applications.purgeExpired", () => this.doPurgeApplications());
  }

  /* ---- Timers: they enqueue, they do not work --------------------- */

  @Cron(CronExpression.EVERY_5_MINUTES)
  publishScheduled() {
    // 30 s now rather than 240: the lock only has to cover *enqueueing*, which
    // is one insert. It used to have to outlast a full site publish.
    return this.redis.withLock("cron:publish-scheduled", 30, async () => {
      const { created } = await this.jobs.enqueueUnique("content.publishScheduled", {});
      if (!created) this.logger.debug("Zeitgesteuerte Veröffentlichung läuft bereits.");
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  purgeApplications() {
    return this.redis.withLock("cron:purge-applications", 30, async () => {
      await this.jobs.enqueueUnique("applications.purgeExpired", {});
    });
  }

  /* ---- Handlers: the work ------------------------------------------ */

  /**
   * Publishes entries whose scheduled time has passed.
   *
   * Only ones already APPROVED — scheduling is a delay on publication, not a
   * way around the review step. An entry scheduled while still in draft simply
   * waits, which is the safe failure.
   */
  private async doPublishScheduled(): Promise<{ published: number; version?: number }> {
    const due = await this.prisma.contentEntry.findMany({
      where: {
        scheduledAt: { lte: new Date() },
        status: WorkflowState.APPROVED,
        deletedAt: null,
      },
      select: { id: true, key: true },
    });
    if (!due.length) return { published: 0 };

    // A system actor rather than a user: nobody pressed the button, and
    // attributing it to the person who scheduled it would misreport when the
    // decision was taken versus when it took effect.
    const system = {
      id: "system",
      email: "system@iem.local",
      name: "Zeitsteuerung",
      roles: ["super_admin"],
      permissions: new Set<string>(),
      isSuperAdmin: true,
    };

    try {
      const result = await this.content.publish(
        `Zeitgesteuert: ${due.length} Eintrag/Einträge`,
        system,
      );

      /*
        The schedule is cleared **after** the publish, and that ordering is the
        whole of a silent failure this used to have (P2-3).

        It used to be cleared first, one statement above the `try`. The
        reasoning was idempotency — a retry must not publish twice — and it
        worked, by making the retry find nothing: attempt 1 threw, attempt 2
        saw an empty due set, returned `{ published: 0 }`, and the runner
        marked the job **DONE**. So a scheduled publish that failed was
        recorded as a job that succeeded, `JobFailed` never fired because the
        job never reached `DEAD`, and the only trace was one audit row nobody
        was looking at. The entries kept their `APPROVED` status and their
        publication simply never happened.

        Clearing afterwards inverts that: a failure leaves the rows due, so
        the retry does the work rather than skipping it, and a genuinely
        broken publish exhausts its attempts and reaches `DEAD` — which is the
        state an operator is told about. Publishing twice is not a risk worth
        trading that for: the publish is a snapshot build, so a second run over
        the same entries produces the same document.
      */
      await this.prisma.contentEntry.updateMany({
        where: { id: { in: due.map((d) => d.id) } },
        data: { scheduledAt: null },
      });

      this.logger.log(`Zeitgesteuert veröffentlicht: Snapshot ${result.version}.`);
      return { published: due.length, version: result.version };
    } catch (err) {
      /*
        Announced, audited, then rethrown.

        The throw is what the job system needs: it records the failure on the
        row, backs off, and retries twice before giving up. The audit row stays
        because a failed scheduled publish is a fact about the *site*, not only
        about the job, and the entries remain APPROVED and still due.

        **The event has to be flushed here**, which is the one place in the
        codebase that does that by hand. `EventBus.publish` queues onto the
        ambient context, and the job runner calls `discard()` on a failed job —
        correctly, because an event describing work that did not finish is a
        lie. This event describes the *failure*, so it is the exception: it is
        true precisely because the job failed, and leaving it in the queue
        would throw away the only thing that tells anybody.

        Three attempts raise it three times and that is deliberate rather than
        tolerated: all three run under the job row's own correlation id, so
        `Notification`'s `@@unique([eventKey, userId])` collapses them into one
        row per recipient. The index does the de-duplication that a flag on
        this class would do worse.
      */
      this.events.publish("ContentPublishFailed", {
        entity: "content_snapshot",
        /*
          There is no snapshot, which is the point — `ContentPublished` names
          the version it created and this one has none to name. The literal is
          what the audit row's resource id reads as, and it is stable across
          the three attempts so the notification's idempotency key is too.
        */
        entityId: "scheduled",
        payload: {
          entries: due.length,
          keys: due.map((d) => d.key).slice(0, 20),
          error: (err as Error).message.slice(0, 500),
        },
        actor: null,
        message:
          `Zeitgesteuerte Veröffentlichung von ${due.length} Eintrag/Einträgen fehlgeschlagen. ` +
          "Die Einträge bleiben freigegeben und terminiert.",
      });
      await this.events.flush();

      await this.audit.writeSync({
        action: "content.scheduled_publish_failed",
        resource: "content_snapshot",
        outcome: "FAILURE",
        message: (err as Error).message,
      });
      throw err;
    }
  }

  private async doPurgeApplications(): Promise<{ deleted: number }> {
    const n = await this.applications.purgeExpired();
    if (n) this.logger.log(`${n} Bewerbung(en) nach Ablauf der Frist gelöscht.`);
    return { deleted: n };
  }

  /* ---- Inline housekeeping ------------------------------------------ */

  /**
   * Removes refresh tokens that are expired or long revoked.
   *
   * Revoked rows are kept for 30 days rather than deleted at once: reuse
   * detection works by finding a revoked token, and deleting it immediately
   * would turn a replayed token into "unknown token" and lose the signal.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  pruneTokens() {
    return this.redis.withLock("cron:prune-tokens", 300, async () => {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const { count } = await this.prisma.refreshToken.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
        },
      });
      if (count) this.logger.log(`${count} abgelaufene Sitzungstoken entfernt.`);
    });
  }

  /** Expired and used password-reset tokens. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  pruneResets() {
    return this.redis.withLock("cron:prune-resets", 300, async () => {
      const { count } = await this.prisma.passwordReset.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }],
        },
      });
      if (count) this.logger.log(`${count} Passwort-Token entfernt.`);
    });
  }

  /**
   * Keeps the job table readable.
   *
   * A `DONE` row from three months ago answers no question anybody asks, and
   * the table is on the path of every ten-second tick. Failures are kept
   * longer, because those are the rows somebody comes looking for.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  pruneJobs() {
    return this.redis.withLock("cron:prune-jobs", 300, async () => {
      const done = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const dead = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const { count } = await this.prisma.job.deleteMany({
        where: {
          OR: [
            { status: { in: ["DONE", "CANCELLED"] }, finishedAt: { lt: done } },
            { status: "DEAD", finishedAt: { lt: dead } },
          ],
        },
      });
      if (count) this.logger.log(`${count} alte Aufgaben entfernt.`);
    });
  }
}
