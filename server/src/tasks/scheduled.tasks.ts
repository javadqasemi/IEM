import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { WorkflowState } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { RedisService } from "../common/redis";
import { AuditService } from "../core/audit/audit.service";
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

    await this.prisma.contentEntry.updateMany({
      where: { id: { in: due.map((d) => d.id) } },
      data: { scheduledAt: null },
    });

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
        {},
      );
      this.logger.log(`Zeitgesteuert veröffentlicht: Snapshot ${result.version}.`);
      return { published: due.length, version: result.version };
    } catch (err) {
      /*
        Audited, then rethrown.

        The throw is what the job system needs: it records the failure on the
        row, backs off, and retries twice before giving up — which is strictly
        better than the old behaviour of swallowing the error and retrying
        blindly every five minutes forever. The audit row stays because a
        failed scheduled publish is a fact about the *site*, not only about the
        job, and the entries remain APPROVED for a person to publish by hand.
      */
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
