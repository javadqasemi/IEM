import { Global, Module } from "@nestjs/common";
import { BackupService } from "./backup.service";
import { BackupStatusService } from "./backup.status.service";
import { BackupJobs } from "./backup.jobs";
import { RestoreService } from "./restore.service";
import { MaintenanceService } from "./maintenance.service";
import { MediaArchiver } from "./backup.media";
import { PostgresTools } from "./backup.postgres";
import { BACKUP_STORAGE, LocalBackupStorage } from "./backup.storage";

/**
 * Sicherung und Wiederherstellung — the **services**.
 *
 * ---
 *
 * ## Why this is in `core/` and the controller is not
 *
 * The rule CLAUDE.md states and `architecture.test.ts` enforces: *a folder
 * under `server/src/` is either infrastructure or a feature, never both.*
 * `audit/` and `settings/` were both once, and it was invisible from either
 * half — each held a controller belonging to one feature and a service every
 * other feature injects.
 *
 * This module had the same shape and the test caught it within minutes:
 * `dashboard/dashboard.controller.ts → backup/backup.status.service` is a
 * feature reaching into a sibling, which is forbidden — and the import was
 * *legitimate*, because that service is infrastructure wearing a feature's
 * folder name. Two of these have readers outside the module:
 *
 * | | |
 * | --- | --- |
 * | `MaintenanceService` | `MaintenanceGuard`, registered globally on the root injector |
 * | `BackupStatusService` | `/dashboard/system`, which shows the one-word verdict |
 *
 * So the services live here and `backup/backup.controller.ts` — the routes —
 * stays a feature. The class names differ deliberately (`BackupModule` here,
 * `BackupRoutesModule` there), because Nest would happily accept both in one
 * import list and construct two different things. `SettingsModule` and
 * `SettingsRoutesModule` are named for the same split.
 *
 * `@Global` for the one reason `CryptoModule` and `SettingsModule` are: the
 * guard is on the root injector and has to reach `MaintenanceService`.
 */
@Global()
@Module({
  providers: [
    BackupService,
    BackupStatusService,
    RestoreService,
    MaintenanceService,
    BackupJobs,
    MediaArchiver,
    PostgresTools,
    { provide: BACKUP_STORAGE, useClass: LocalBackupStorage },
  ],
  exports: [BackupService, BackupStatusService, RestoreService, MaintenanceService],
})
export class BackupModule {}
