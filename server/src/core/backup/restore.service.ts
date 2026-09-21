import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  BackupArtifactKind,
  BackupStatus,
  BackupTrigger,
  BackupType,
  RestoreMode,
  RestoreStatus,
  VerificationStatus,
} from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import type { AuthUser } from "../../common/decorators";
import { AuditService } from "../audit/audit.service";
import { EventBus } from "../events/event-bus";
import { JobService } from "../jobs/job.service";
import { BACKUP_STORAGE, type BackupStorageProvider } from "./backup.storage";
import { PostgresTools, assertSafeDatabaseName } from "./backup.postgres";
import { BackupService } from "./backup.service";
import { MaintenanceService } from "./maintenance.service";
import { classifyBackupError } from "./backup.failure";
import {
  assessCompatibility,
  refuseConcurrent,
  refuseConfirmation,
  refuseRestore,
  type BackupOperation,
} from "./backup.rules";

/**
 * Reading a backup back into a database.
 *
 * Its own file, away from `backup.service.ts`, because one of those is routine
 * and this one **replaces a production database**. A module where both live is
 * a module where a reader stops noticing which is which, and this is the single
 * most dangerous operation in the application.
 *
 * ---
 *
 * ## Two modes, and only one of them is frightening
 *
 * | | |
 * | --- | --- |
 * | `DRILL` | Restores into a throwaway database, validates it, drops it. Touches nothing. This is the **recovery test** — the thing that turns a backup from an assumption into a recovery system |
 * | `IN_PLACE` | Restores over the live database. Everything below exists because of this one |
 *
 * The drill is the mode that should run often — monthly, ideally automatically
 * — because *a backup that has never been restored is an assumption*. It is
 * also the only mode this repository's tests exercise, deliberately: proving
 * recoverability does not require destroying the development database, and a
 * test suite that replaces its own database is a test suite nobody runs twice.
 *
 * ## The order of the guards, and why each is where it is
 *
 * ```
 * permission → re-authentication → typed confirmation → artifact verified
 *   → compatibility → no conflicting operation → pre-restore backup
 *   → write protection on → restore → validate → write protection off
 * ```
 *
 * The pre-restore backup is **last before the destructive step and blocking**:
 * if it fails, the restore does not happen. A pre-restore backup taken
 * optimistically and then ignored on failure is a comfort rather than a
 * control.
 */
@Injectable()
export class RestoreService {
  private readonly logger = new Logger(RestoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly postgres: PostgresTools,
    private readonly backups: BackupService,
    private readonly maintenance: MaintenanceService,
    @Inject(BACKUP_STORAGE) private readonly storage: BackupStorageProvider,
  ) {}

  /* ================================================================ */
  /* Requesting                                                        */
  /* ================================================================ */

  /**
   * Checks everything that can be checked cheaply, then queues the work.
   *
   * The permission and the re-authentication window are the controller's job —
   * they are about *who is asking*. What this decides is whether the **artifact
   * is fit to restore**, which no permission can settle.
   */
  async request(input: {
    backupRunId: string;
    mode: RestoreMode;
    confirmation: string;
    actor: AuthUser;
    ctx: Ctx;
  }): Promise<{ id: string }> {
    const run = await this.prisma.backupRun.findUnique({
      where: { id: input.backupRunId },
      include: { artifacts: true },
    });
    if (!run) throw new NotFoundException("Diese Sicherung gibt es nicht.");

    /*
      The typed word, required for both modes.

      A drill destroys nothing, so the friction looks unnecessary — and it is
      the reason it is here. The muscle memory an operator builds on drills is
      the muscle memory they bring to the real thing at 03:00, and a
      confirmation that appears only in the dangerous case is one nobody has
      practised.
    */
    const badConfirmation = refuseConfirmation(input.confirmation);
    if (badConfirmation) throw new BadRequestException(badConfirmation);

    const compatibility = await this.compatibility(run.migrationVersion);
    const refusal = refuseRestore({
      status: run.status,
      verification: run.verification,
      type: run.type,
      compatibility: compatibility.result,
      hasDatabaseArtifact: run.artifacts.some((a) => a.kind === BackupArtifactKind.DATABASE_DUMP),
    });
    if (refusal) throw new BadRequestException(refusal);

    const conflict = refuseConcurrent("RESTORE", await this.runningOperations());
    if (conflict) throw new ConflictException(conflict);

    const target =
      input.mode === RestoreMode.DRILL ? this.drillDatabaseName() : this.postgres.connection().database;

    const restore = await this.prisma.restoreRun.create({
      data: {
        backupRunId: run.id,
        mode: input.mode,
        status: RestoreStatus.REQUESTED,
        requestedById: input.actor.id,
        targetDatabase: target,
      },
      select: { id: true },
    });

    this.audit.record({
      actor: input.actor,
      action: "backup.restore_requested",
      resource: "restore_run",
      resourceId: restore.id,
      after: {
        backupRunId: run.id,
        mode: input.mode,
        targetDatabase: target,
        compatibility: compatibility.result,
      },
      message: `Wiederherstellung angefordert (${input.mode}) aus Sicherung vom ${run.createdAt.toISOString()}.`,
      ...input.ctx,
    });

    await this.jobs.enqueue("backup.restore", { restoreRunId: restore.id });
    return { id: restore.id };
  }

  /* ================================================================ */
  /* Running                                                           */
  /* ================================================================ */

  /** The job handler. Branches once, on the mode, and shares everything else. */
  async run(restoreRunId: string): Promise<{ status: RestoreStatus }> {
    const restore = await this.prisma.restoreRun.findUnique({
      where: { id: restoreRunId },
      include: { source: { include: { artifacts: true } } },
    });
    if (!restore) throw new NotFoundException(`Unbekannte Wiederherstellung ${restoreRunId}.`);
    if (restore.status === RestoreStatus.SUCCESS) return { status: restore.status };

    const startedAt = new Date();
    await this.prisma.restoreRun.update({
      where: { id: restoreRunId },
      data: { status: RestoreStatus.RUNNING, startedAt },
    });

    this.events.publish("RestoreStarted", {
      entity: "restore_run",
      entityId: restoreRunId,
      payload: { mode: restore.mode, backupRunId: restore.backupRunId },
      after: { mode: restore.mode, target: restore.targetDatabase },
      message: `Wiederherstellung gestartet (${restore.mode}).`,
    });

    const archive = restore.source.artifacts.find(
      (a) => a.kind === BackupArtifactKind.DATABASE_DUMP,
    );
    if (!archive) throw new BadRequestException("Zu dieser Sicherung gibt es keinen Datenbank-Abzug.");
    const archivePath = this.storage.localPath(archive.storageKey);
    if (!archivePath) throw new Error("Provider has no local path for the dump.");

    try {
      const result =
        restore.mode === RestoreMode.DRILL
          ? await this.runDrill(restoreRunId, restore.targetDatabase, archivePath)
          : await this.runInPlace(restoreRunId, restore.targetDatabase, archivePath, restore.requestedById);

      await this.prisma.restoreRun.update({
        where: { id: restoreRunId },
        data: {
          status: RestoreStatus.SUCCESS,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          validation: result as never,
        },
      });

      this.events.publish("RestoreCompleted", {
        entity: "restore_run",
        entityId: restoreRunId,
        payload: { mode: restore.mode, backupRunId: restore.backupRunId },
        after: { mode: restore.mode, validation: result },
        message: `Wiederherstellung abgeschlossen (${restore.mode}).`,
      });
      return { status: RestoreStatus.SUCCESS };
    } catch (err) {
      const failure = classifyBackupError(err, "RESTORE_FAILED");
      await this.prisma.restoreRun.update({
        where: { id: restoreRunId },
        data: {
          status: RestoreStatus.FAILED,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          failureCategory: failure.category,
          failureDetail: failure.message,
        },
      });
      this.events.publish("RestoreFailed", {
        entity: "restore_run",
        entityId: restoreRunId,
        payload: { mode: restore.mode, category: failure.category },
        after: { mode: restore.mode, category: failure.category },
        message: failure.message,
      });
      throw err;
    } finally {
      // Whatever happened, the application must not be left refusing writes.
      if (restore.mode === RestoreMode.IN_PLACE) this.maintenance.end();
    }
  }

  /**
   * The recovery drill: restore into a throwaway database and read it back.
   *
   * **This is what proves recoverability.** Everything before it proves a file
   * exists and parses; this proves the bytes become a database an application
   * can read. It is safe to run at any time, which is the point — a recovery
   * test nobody dares run is a recovery test that never runs.
   *
   * The target is dropped and recreated first, so a previous drill's leftovers
   * cannot make this one look better than it is.
   */
  private async runDrill(
    restoreRunId: string,
    target: string,
    archivePath: string,
  ): Promise<ValidationReport> {
    assertSafeDatabaseName(target);
    const admin = this.postgres.connection();

    if (target === admin.database) {
      // The guard that stops a misconfiguration turning a drill into a restore.
      throw new Error("Drill target resolved to the live database; refusing.");
    }

    await this.postgres.dropDatabase(admin, target);
    await this.postgres.createDatabase(admin, target);

    await this.prisma.restoreRun.update({
      where: { id: restoreRunId },
      data: { status: RestoreStatus.RUNNING },
    });

    await this.postgres.restore({ ...admin, database: target }, archivePath);

    await this.prisma.restoreRun.update({
      where: { id: restoreRunId },
      data: { status: RestoreStatus.VALIDATING },
    });

    const report = await this.validate({ ...admin, database: target });

    /*
      The drill database is kept, not dropped.

      Dropping it immediately would make the one artefact an operator wants to
      look at — the restored database — disappear at the moment the drill
      reports success. It is dropped at the *start* of the next drill instead,
      so there is always exactly one to inspect and never a growing pile.
    */
    return report;
  }

  /**
   * The real thing.
   *
   * Every step here is a guard that has a reason, and the order is the reason:
   * the pre-restore backup happens **before** write protection so that a
   * failure to take it costs nothing, and write protection goes on **before**
   * the restore so no request can write into a database that is being replaced.
   */
  private async runInPlace(
    restoreRunId: string,
    target: string,
    archivePath: string,
    requestedById: string | null,
  ): Promise<ValidationReport> {
    const conn = this.postgres.connection();
    if (conn.database !== target) {
      // "Never restore blindly into an unknown database."
      throw new Error(`Target mismatch: run says ${target}, configuration says ${conn.database}.`);
    }

    /* ---- The safety net, and it blocks ---------------------------- */
    const pre = await this.backups.request({
      type: BackupType.FULL,
      trigger: BackupTrigger.PRE_RESTORE,
      actor: requestedById ? ({ id: requestedById } as AuthUser) : null,
    });
    await this.prisma.restoreRun.update({
      where: { id: restoreRunId },
      data: { preRestoreBackupId: pre.id },
    });

    const ok = await this.awaitBackup(pre.id);
    if (!ok) {
      /*
        ABORT. Not "proceed with a warning".

        The pre-restore backup is the only way back if the restore turns out to
        have been a mistake, and a restore without one is a one-way door. This
        is the branch that makes the difference between a safety net and a
        gesture.
      */
      await this.prisma.restoreRun.update({
        where: { id: restoreRunId },
        data: {
          status: RestoreStatus.ABORTED,
          failureCategory: "RESTORE_FAILED",
          failureDetail:
            "Die Sicherung des aktuellen Standes ist fehlgeschlagen — die Wiederherstellung wurde abgebrochen, " +
            "bevor irgendetwas überschrieben wurde.",
        },
      });
      throw new Error("Pre-restore backup failed; restore aborted.");
    }

    /* ---- Doors closed --------------------------------------------- */
    this.maintenance.begin(`Wiederherstellung ${restoreRunId}`);

    await this.postgres.restore(conn, archivePath);

    await this.prisma.restoreRun.update({
      where: { id: restoreRunId },
      data: { status: RestoreStatus.VALIDATING },
    });
    return this.validate(conn);
  }

  /**
   * Waits for a backup to reach a terminal state.
   *
   * Polls rather than subscribes, because the backup is executed by the job
   * runner in the same process and the thing being waited on is a row. The
   * ceiling is generous and finite: a pre-restore backup that has not finished
   * in fifteen minutes is one whose restore should not proceed unattended.
   */
  private async awaitBackup(backupRunId: string): Promise<boolean> {
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      const run = await this.prisma.backupRun.findUnique({
        where: { id: backupRunId },
        select: { status: true, verification: true },
      });
      if (run?.status === BackupStatus.SUCCESS && run.verification === VerificationStatus.PASSED) {
        return true;
      }
      if (run?.status === BackupStatus.FAILED) return false;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  /**
   * What the restored database actually contains.
   *
   * **`pg_restore` exiting 0 is not success.** It reports ownership notices as
   * errors, restores partially without complaint in some failure modes, and
   * says nothing at all about whether the result is an application's database
   * or an empty shell with the right table names.
   *
   * So the checks are the ones an operator would make by hand: can we connect,
   * is the migration table there and at a known state, did a Super Admin
   * survive, is there an organisation, are the content and settings tables
   * populated. Each is reported separately, because "restored but no Super
   * Admin" is a specific and recoverable situation and "restore failed" is not
   * the same statement.
   */
  private async validate(conn: ReturnType<PostgresTools["connection"]>): Promise<ValidationReport> {
    const q = async (sql: string): Promise<string | null> => {
      try {
        const out = await this.postgres.query(conn, sql);
        return out.trim();
      } catch {
        return null;
      }
    };

    const migration = await q(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1",
    );
    const migrations = Number(await q("SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")) || 0;
    const users = Number(await q('SELECT count(*) FROM "User"')) || 0;
    const superAdmins =
      Number(
        await q(
          'SELECT count(*) FROM "User" u JOIN "UserRole" ur ON ur."userId" = u.id JOIN "Role" r ON r.id = ur."roleId" WHERE r.key = \'super_admin\'',
        ),
      ) || 0;
    const organisations = Number(await q('SELECT count(*) FROM "Organisation"')) || 0;
    const settings = Number(await q('SELECT count(*) FROM "Setting"')) || 0;
    const contentEntries = Number(await q('SELECT count(*) FROM "ContentEntry"')) || 0;

    const checks: ValidationReport["checks"] = [
      { name: "Verbindung", ok: migration !== null || migrations > 0, detail: conn.database },
      { name: "Migrationsstand", ok: Boolean(migration), detail: migration ?? "unbekannt" },
      { name: "Super Admin vorhanden", ok: superAdmins > 0, detail: `${superAdmins}` },
      { name: "Unternehmensdatensatz", ok: organisations > 0, detail: `${organisations}` },
      { name: "Einstellungen", ok: settings > 0, detail: `${settings}` },
      { name: "Inhalte", ok: contentEntries > 0, detail: `${contentEntries}` },
    ];

    const report: ValidationReport = {
      database: conn.database,
      migration,
      migrations,
      counts: { users, superAdmins, organisations, settings, contentEntries },
      checks,
      ok: checks.every((c) => c.ok),
    };

    if (!report.ok) {
      const failed = checks.filter((c) => !c.ok).map((c) => c.name);
      throw new Error(`Post-restore validation failed: ${failed.join(", ")}`);
    }
    return report;
  }

  /* ================================================================ */
  /* Helpers                                                           */
  /* ================================================================ */

  /** Which destructive operations are in flight, for the concurrency table. */
  async runningOperations(): Promise<BackupOperation[]> {
    const running: BackupOperation[] = [];

    const restores = await this.prisma.restoreRun.count({
      where: { status: { in: [RestoreStatus.REQUESTED, RestoreStatus.RUNNING, RestoreStatus.VALIDATING] } },
    });
    if (restores > 0) running.push("RESTORE");

    const backups = await this.prisma.backupRun.count({
      where: { status: { in: [BackupStatus.QUEUED, BackupStatus.RUNNING, BackupStatus.VERIFYING] } },
    });
    if (backups > 0) running.push("BACKUP");

    return running;
  }

  /**
   * The restore history, mapped.
   *
   * In the service rather than the controller for the reason
   * `BackupService.list` records: `architecture.test.ts` forbids a controller
   * injecting `PrismaService`, and it caught the first version of this module
   * doing it.
   */
  async history(limit = 25) {
    const items = await this.prisma.restoreRun.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        requestedBy: { select: { name: true } },
        source: { select: { type: true, createdAt: true } },
      },
    });
    return {
      items: items.map((r) => ({
        id: r.id,
        mode: r.mode,
        status: r.status,
        targetDatabase: r.targetDatabase,
        requestedBy: r.requestedBy?.name ?? null,
        backupRunId: r.backupRunId,
        backupType: r.source.type,
        backupCreatedAt: r.source.createdAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        durationMs: r.durationMs,
        failureCategory: r.failureCategory,
        failureDetail: r.failureDetail,
        validation: r.validation,
      })),
    };
  }

  /** Whether this backup could be restored, and why not where it could not. */
  async assess(backupRunId: string) {
    const run = await this.prisma.backupRun.findUnique({
      where: { id: backupRunId },
      include: { artifacts: true },
    });
    if (!run) throw new NotFoundException("Diese Sicherung gibt es nicht.");

    const compatibility = await this.compatibility(run.migrationVersion);
    const refusal = refuseRestore({
      status: run.status,
      verification: run.verification,
      type: run.type,
      compatibility: compatibility.result,
      hasDatabaseArtifact: run.artifacts.some((a) => a.kind === BackupArtifactKind.DATABASE_DUMP),
    });
    const conflict = refuseConcurrent("RESTORE", await this.runningOperations());

    return {
      backupRunId,
      compatibility: compatibility.result,
      compatibilityReason: compatibility.reason,
      restorable: !refusal && !conflict,
      refusal: refusal ?? conflict,
      drillDatabase: this.drillDatabaseName(),
      liveDatabase: this.postgres.connection().database,
    };
  }

  private async compatibility(backupMigration: string | null) {
    const current = await this.backups.schemaState();
    const known = await this.knownMigrations();
    return assessCompatibility(backupMigration, current.migration, known);
  }

  private async knownMigrations(): Promise<string[]> {
    try {
      const rows = await this.prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NOT NULL ORDER BY finished_at ASC`;
      return rows.map((r) => r.migration_name);
    } catch {
      return [];
    }
  }

  /**
   * The drill target's name: the live database plus a fixed suffix.
   *
   * Derived rather than configured, so there is no setting through which
   * somebody could point a drill at a database that matters. `runDrill` also
   * refuses if it resolves to the live name, which is belt and braces for a
   * database literally called `…_restore_drill`.
   */
  drillDatabaseName(): string {
    const live = this.postgres.connection().database;
    const name = `${live}_restore_drill`.slice(0, 63);
    assertSafeDatabaseName(name);
    return name;
  }
}

export type ValidationReport = {
  database: string;
  migration: string | null;
  migrations: number;
  counts: {
    users: number;
    superAdmins: number;
    organisations: number;
    settings: number;
    contentEntries: number;
  };
  checks: { name: string; ok: boolean; detail: string }[];
  ok: boolean;
};

type Ctx = { ip?: string | null; userAgent?: string | null };

