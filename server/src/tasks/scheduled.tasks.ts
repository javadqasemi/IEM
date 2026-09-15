import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { WorkflowState } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { RedisService } from "../common/redis";
import { AuditService } from "../audit/audit.service";
import { ApplicationsService } from "../applications/applications.service";
import { ContentService } from "../content/content.service";

/**
 * Background work.
 *
 * Four jobs, each of which exists because something in the UI would otherwise
 * be a promise nothing keeps: scheduled publishing, dossier retention, session
 * cleanup and reset-token cleanup.
 *
 * **In-process `@Cron`, guarded by a Redis lock.** These are timers inside the
 * API process, so with PM2 running several workers every worker fires every
 * job. Three of the four are idempotent and would only do redundant work; the
 * publish job is **not** — four workers would produce four snapshots of the
 * site. `RedisService.withLock` means exactly one worker runs each tick.
 *
 * Each lock's TTL has to exceed the longest plausible run of its job, because
 * that TTL is what releases the lock when a worker is killed mid-run. They are
 * generous for that reason, not arbitrary.
 *
 * Without `REDIS_URL` the lock is a no-op and the work simply runs — correct
 * for one process, wrong for several, which is why `main.ts` refuses to start
 * clustered without Redis rather than degrading quietly.
 */
@Injectable()
export class ScheduledTasks {
  private readonly logger = new Logger(ScheduledTasks.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly applications: ApplicationsService,
    private readonly content: ContentService,
  ) {}

  /**
   * Publishes entries whose scheduled time has passed.
   *
   * Only ones already APPROVED — scheduling is a delay on publication, not a
   * way around the review step. An entry scheduled while still in draft simply
   * waits, which is the safe failure.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  publishScheduled() {
    // 240 s: shorter than the 5-minute interval, so a stuck worker's lock has
    // expired before the next tick, and long enough for a publish that has to
    // assemble and validate the whole site document.
    return this.redis.withLock("cron:publish-scheduled", 240, () => this.doPublishScheduled());
  }

  private async doPublishScheduled() {
    const due = await this.prisma.contentEntry.findMany({
      where: {
        scheduledAt: { lte: new Date() },
        status: WorkflowState.APPROVED,
        deletedAt: null,
      },
      select: { id: true, key: true },
    });
    if (!due.length) return;

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
    } catch (err) {
      // A scheduled publish that fails validation must not retry silently
      // every five minutes forever — but nor should it be dropped. It is
      // logged and audited, and the entries stay APPROVED for a person to
      // publish by hand.
      this.logger.error(`Zeitgesteuerte Veröffentlichung fehlgeschlagen: ${(err as Error).message}`);
      await this.audit.writeSync({
        action: "content.scheduled_publish_failed",
        resource: "content_snapshot",
        outcome: "FAILURE",
        message: (err as Error).message,
      });
    }
  }

  /**
   * Deletes applications past their retention date, files included.
   *
   * 30 minutes: this deletes files from storage one by one, and a backlog
   * after an outage could genuinely take a while.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  purgeApplications() {
    return this.redis.withLock("cron:purge-applications", 1800, async () => {
      const n = await this.applications.purgeExpired();
      if (n) this.logger.log(`${n} Bewerbung(en) nach Ablauf der Frist gelöscht.`);
    });
  }

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
}
