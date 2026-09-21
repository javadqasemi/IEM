import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BackupController } from "./backup.controller";
import { BackupMetrics } from "./backup.metrics";

/**
 * The backup **screens** — routes and metrics.
 *
 * Separate from `core/backup`'s `BackupModule`, which is `@Global` and holds
 * the services. The same split `settings/settings.controller.module.ts` is
 * named for, and forced by the same rule: `BackupStatusService` is read by
 * `/dashboard/system` and `MaintenanceService` by a global guard, so both are
 * infrastructure and belong in `core/` — while these routes belong to one
 * feature.
 *
 * `AuthModule` is imported explicitly because `BackupController` injects
 * `ReauthService` for the restore gate. Nest would construct it anyway if
 * something else had already, and relying on that is how F12 broke the
 * application twice, neither time failing at compile time.
 */
@Module({
  imports: [AuthModule],
  controllers: [BackupController],
  providers: [BackupMetrics],
})
export class BackupRoutesModule {}
