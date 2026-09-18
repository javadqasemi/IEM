import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../common/prisma.service";
import { RedisService } from "../common/redis";
import { JobService } from "../core/jobs/job.service";
import { ProjectsService } from "./projects.service";

/**
 * The other half of "derived, but stored".
 *
 * `ProjectsService.recompute` runs after every write that can move
 * `progressPercent` or `health`. That is necessary and it is **not
 * sufficient**, because two of the inputs to `deriveHealth` are *time*: a
 * project nobody touches drifts toward its deadline on its own, and a milestone
 * becomes overdue at midnight with no write anywhere. Without this job the red
 * projects on a dashboard would be the ones somebody happened to edit.
 *
 * This is the discipline `docs/data-model.md` §3.8 asks for, written out:
 * recomputed on write, reconciled nightly, and a test that the two agree.
 *
 * It follows the F10 shape rather than doing the work in the timer — the timer
 * enqueues, `JobRunner` executes. What that buys is on `ScheduledTasks`:
 * durable across a restart, retried on a locked table, visible as a row with a
 * duration, and attributable, because the audit rows the recomputation writes
 * carry the run's correlation id.
 */
@Injectable()
export class ProjectsReconciler implements OnModuleInit {
  private readonly logger = new Logger(ProjectsReconciler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jobs: JobService,
    private readonly projects: ProjectsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register("projects.reconcileDerived", () => this.run());
  }

  /**
   * 02:00, before the 03:00 purge and the 04:00 housekeeping.
   *
   * Early enough that a Geschäftsleitung member opening the dashboard at seven
   * sees figures computed against today's date rather than yesterday's.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  nightly() {
    return this.redis.withLock("cron:reconcile-projects", 30, async () => {
      await this.jobs.enqueueUnique("projects.reconcileDerived", {});
    });
  }

  /**
   * Live projects only.
   *
   * `deriveHealth` returns GREEN for every terminal status, so reconciling a
   * completed project can only ever write the value it already holds — and the
   * write would move `updatedAt`, which sorts the archive to the top of a list
   * whose promise is "what you were last working on". Skipping them is
   * correctness, not an optimisation.
   */
  private async run(): Promise<{ checked: number; changed: number }> {
    const ids = await this.prisma.project.findMany({
      where: { deletedAt: null, status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] } },
      select: { id: true },
    });

    // `recompute` reports whether it wrote, so the count costs nothing. One
    // project at a time rather than in parallel: this runs at two in the
    // morning against no contention, and a hundred concurrent transactions
    // would be the one thing capable of making it a problem.
    let changed = 0;
    for (const project of ids) {
      if (await this.projects.recompute(project.id)) changed += 1;
    }

    if (changed) this.logger.log(`${changed} von ${ids.length} Projekten neu bewertet.`);
    return { checked: ids.length, changed };
  }
}
