import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { EventBus } from "../core/events/event-bus";
import { JobService } from "../core/jobs/job.service";
import { RedisService } from "../common/redis";
import { TasksRepository } from "./tasks.repository";

/**
 * The nightly overdue sweep.
 *
 * **Why this exists although the module deliberately stores no `isOverdue`.**
 * Whether a task is overdue is `dueDate < now AND status open` — a `where`
 * clause, computed exactly, needing no column and no reconciler
 * (`tasks.rules.ts` argues the point against `Project.progressPercent`, which is
 * stored because a list sorts by it). **Telling somebody** is a different act:
 * an event has to be raised by something, and the trigger here is the passage of
 * time, so a clock is the only thing that can raise it.
 *
 * So this is not Projects' reconciler with a new name. It writes no derived
 * figure. It announces a fact, once, and `Task.overdueNotifiedAt` is what makes
 * "once" true — without it the same task is announced every night, and a
 * notification that arrives every night is one nobody reads.
 *
 * The timer **enqueues** and `JobRunner` executes, which is the shape F10
 * established and the reason is worth repeating: a sweep that ran inside the
 * `@Cron` method would be undurable (a restart at 06:00 skips a morning),
 * unretried, invisible and unattributable. As a job it is a row an operator can
 * read, with its duration and its error.
 */
@Injectable()
export class TasksOverdueSweep implements OnModuleInit {
  private readonly logger = new Logger(TasksOverdueSweep.name);

  constructor(
    private readonly repo: TasksRepository,
    private readonly events: EventBus,
    private readonly jobs: JobService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Registered once at boot, separately from anything enqueueing it.
   *
   * A deploy that adds a producer before its consumer is legitimate, and a job
   * with no handler is held as `DEAD` with a message rather than retried three
   * times against nothing.
   */
  onModuleInit(): void {
    this.jobs.register("tasks.flagOverdue", () => this.run());
  }

  /**
   * 06:00, not 02:00.
   *
   * `ProjectsReconciler` runs at 02:00 because nobody needs to see its result
   * until morning. This one *produces* the morning's notifications, and raising
   * them at two in the morning means a phone lighting up in the middle of the
   * night the day the notification module starts delivering them. Six is before
   * the office opens and after everyone has stopped working.
   *
   * The Redis lock serialises the **tick** — one worker decides to enqueue —
   * while `JobService.claim` serialises the **row**. Neither replaces the other,
   * and with four PM2 workers and no lock the sweep would enqueue four times.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  nightly() {
    return this.redis.withLock("cron:tasks-flag-overdue", 30, async () => {
      await this.jobs.enqueueUnique("tasks.flagOverdue", {});
    });
  }

  /**
   * One sweep.
   *
   * **The announcement and the mark are not in one transaction, and the order is
   * the whole design.** Events are queued on the request context and flushed
   * when the work succeeds, so the sequence is: read, publish, mark. If the
   * process dies between publishing and marking, the same tasks are announced
   * again tomorrow — a duplicate notification. If it were the other way round, a
   * crash would mark them announced and nobody would ever hear. Announcing twice
   * is a nuisance; announcing never is the bug the column exists to prevent.
   */
  async run(): Promise<{ announced: number }> {
    const now = new Date();
    const rows = await this.repo.overdueUnannounced(now);
    if (!rows.length) return { announced: 0 };

    for (const row of rows) {
      this.events.publish("TaskOverdue", {
        entity: "task",
        entityId: row.id,
        payload: {
          projectId: row.projectId,
          title: row.title,
          assigneeId: row.assigneeId,
          // Computed here rather than left to each listener. A notification that
          // escalates at seven days must not have to parse a date it was given
          // as a string and get the timezone wrong doing it.
          daysOverdue: daysBetween(row.dueDate!, now),
        },
      });
    }

    await this.repo.markOverdueAnnounced(rows.map((row) => row.id), now);
    this.logger.log(`${rows.length} überfällige Aufgabe(n) gemeldet.`);
    return { announced: rows.length };
  }
}

/**
 * Whole days between two instants.
 *
 * `Math.floor` on the millisecond difference, deliberately, rather than
 * comparing calendar dates: a task due at 17:00 yesterday is *one* day overdue
 * at 06:00 this morning by neither measure — it is 13 hours, which floors to 0 —
 * and reporting "1 day" would make the first escalation threshold fire half a
 * day early. The figure is elapsed time, and it says so.
 */
function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}
