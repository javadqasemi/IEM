import { Injectable, OnModuleInit } from "@nestjs/common";
import { BackupStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { MetricsService } from "../core/metrics/metrics.service";
import type { ModuleMetricsSource, RecordCounts } from "../core/metrics/metrics.types";

/**
 * What Sicherung und Wiederherstellung reports about itself.
 *
 * The firm's rule since F14: no module ships without metrics. This declares
 * only what the module *owns* — latency, error rate and job durations are
 * measured centrally by `MetricsInterceptor` and the event bus, and need no
 * cooperation.
 */
@Injectable()
export class BackupMetrics implements OnModuleInit, ModuleMetricsSource {
  readonly key = "backup";
  readonly label = "Sicherung und Wiederherstellung";
  readonly routePrefix = "/backups";

  /** Only the events this module raises. `BackupCompleted` is not one — see the catalogue. */
  readonly events = [
    "BackupFailed",
    "BackupVerified",
    "BackupVerificationFailed",
    "RestoreStarted",
    "RestoreCompleted",
    "RestoreFailed",
  ] as const;

  readonly jobs = [
    "backup.create",
    "backup.verify",
    "backup.retention",
    "backup.restore",
  ] as const;

  /**
   * `backup_run` and `restore_run`, and **not** `backup_artifact`.
   *
   * An artifact is written and deleted only as part of the run that owns it,
   * so every audit row that would name one already names the run. A third
   * resource would report a count that is a constant multiple of the first and
   * tell an operator nothing they did not have.
   */
  readonly auditResources = ["backup_run", "restore_run"] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.metrics.register(this);
  }

  /**
   * `active` is **recovery points**, not live rows, and that is the one number
   * an operator actually wants from this module.
   *
   * A `BackupRun` that failed or expired is a row and is not a backup. Counting
   * it in `active` would let a week of failed nightly runs read as a healthy
   * figure, which is the specific lie this module exists to make impossible.
   *
   * `archived` is the expired ones — retention did its job — and `deleted` is
   * the ones somebody removed deliberately. Keeping those apart is the same
   * distinction the two statuses make: "who removed our only March backup" has
   * to be answerable.
   */
  async records(): Promise<RecordCounts> {
    const [total, active, expired, deleted] = await this.prisma.$transaction([
      this.prisma.backupRun.count(),
      this.prisma.backupRun.count({
        where: { status: BackupStatus.SUCCESS, verification: "PASSED" },
      }),
      this.prisma.backupRun.count({ where: { status: BackupStatus.EXPIRED } }),
      this.prisma.backupRun.count({ where: { status: BackupStatus.DELETED } }),
    ]);
    return { total, active, archived: expired, deleted };
  }
}

