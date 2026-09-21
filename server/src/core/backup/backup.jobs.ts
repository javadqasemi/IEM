import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { BackupTrigger, BackupType } from "@prisma/client";
import { RedisService } from "../../common/redis";
import { JobService } from "../jobs/job.service";
import { SettingsService } from "../settings/settings.service";
import { BackupService } from "./backup.service";
import { RestoreService } from "./restore.service";
import { refuseConcurrent } from "./backup.rules";

/**
 * The timers and the handlers, in the shape `scheduled.tasks.ts` established.
 *
 * ---
 *
 * ## Nothing here is a second scheduler
 *
 * `@Cron` for the tick, `RedisService.withLock` so one worker decides, and
 * `JobService` so the work is durable, retried, attributable and visible. The
 * brief asks for scheduling, retention and idempotency; all three already
 * exist in this repository and this file is where backup uses them rather than
 * where it reinvents them.
 *
 * **Two mechanisms, both needed**, as `ScheduledTasks` records: the Redis lock
 * serialises the *tick* — one process decides to enqueue — and the unique
 * `occurrenceKey` serialises the *night*, which is what survives a restart,
 * a deploy at 01:59 and a worker retry. Either alone leaks a duplicate backup
 * in a case the other covers.
 *
 * ## Why the cron is hourly and the decision is in the handler
 *
 * The hour is configurable, so the timer cannot be. An hourly tick that asks
 * "is it the configured hour, and has tonight's run already happened" is one
 * cheap query an hour and it needs no restart when somebody moves the schedule
 * from 02:00 to 04:00 — which a `@Cron("0 2 * * *")` would.
 */
@Injectable()
export class BackupJobs implements OnModuleInit {
  private readonly logger = new Logger(BackupJobs.name);

  constructor(
    private readonly jobs: JobService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly backups: BackupService,
    private readonly restores: RestoreService,
  ) {}

  onModuleInit(): void {
    this.jobs.register("backup.create", async (payload) => {
      const { status } = await this.backups.run(payload.backupRunId);
      return { status };
    });

    this.jobs.register("backup.verify", async (payload) => {
      const { verification } = await this.backups.verify(payload.backupRunId);
      return { verification };
    });

    this.jobs.register("backup.retention", async () => {
      const { removed } = await this.backups.applyRetention();
      return { removed };
    });

    this.jobs.register("backup.restore", async (payload) => {
      const { status } = await this.restores.run(payload.restoreRunId);
      return { status };
    });
  }

  /* ---- Timers: they enqueue, they do not work --------------------- */

  /**
   * The nightly backup, decided hourly.
   *
   * `enqueueUnique` on the job *and* a unique `occurrenceKey` on the run. The
   * first stops two jobs for one row; the second stops two rows for one night,
   * which is the failure a job-level guard alone does not cover because a
   * restart clears the queue and not the calendar.
   */
  @Cron("0 * * * *")
  nightlyBackup() {
    return this.redis.withLock("cron:backup", 30, async () => {
      if (!(await this.settings.flag("backup.automatic", false))) return;

      const hour = await this.settings.number("backup.hour", 2, 0, 23);
      const offset = await this.settings.number("backup.timezoneOffsetMinutes", 60, -720, 840);
      const local = new Date(Date.now() + offset * 60_000);
      if (local.getUTCHours() !== hour) return;

      const conflict = refuseConcurrent("BACKUP", await this.restores.runningOperations());
      if (conflict) {
        this.logger.warn(`Geplante Sicherung übersprungen: ${conflict}`);
        return;
      }

      const type = (await this.settings.text("backup.scheduledType", "FULL")) as BackupType;
      const key = this.backups.occurrenceKey(type, local);
      const { created } = await this.backups.request({
        type: BackupType[type] ? type : BackupType.FULL,
        trigger: BackupTrigger.SCHEDULED,
        actor: null,
        occurrenceKey: key,
      });
      if (created) this.logger.log(`Geplante Sicherung ${key} eingereiht.`);
    });
  }

  /**
   * Retention, an hour after the backup window.
   *
   * Deliberately not immediately after: the night's backup has to be *verified*
   * before retention counts it as a recovery point, and retention that ran
   * first would evaluate the policy one backup short — which on a tight
   * `keep` setting is the difference between deleting the right one and
   * deleting the last good one.
   */
  @Cron("30 * * * *")
  retention() {
    return this.redis.withLock("cron:backup-retention", 30, async () => {
      if (!(await this.settings.flag("backup.automatic", false))) return;

      const hour = await this.settings.number("backup.hour", 2, 0, 23);
      const offset = await this.settings.number("backup.timezoneOffsetMinutes", 60, -720, 840);
      const local = new Date(Date.now() + offset * 60_000);
      if (local.getUTCHours() !== (hour + 1) % 24) return;

      const conflict = refuseConcurrent("RETENTION", await this.restores.runningOperations());
      if (conflict) {
        this.logger.warn(`Aufräumen übersprungen: ${conflict}`);
        return;
      }
      await this.jobs.enqueueUnique("backup.retention", {});
    });
  }
}

