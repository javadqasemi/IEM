import { Module } from "@nestjs/common";
import { DrawingsController, TransmittalsController } from "./drawings.controller";
import { DrawingsMetrics } from "./drawings.metrics";
import { DrawingsRepository } from "./drawings.repository";
import { DrawingsService } from "./drawings.service";

/**
 * Pläne und Planversand — Wave 2, module 3.
 *
 * **Two controllers, one service, one repository**, the shape Sitzungen
 * established and the shape this domain has: a Planversand is what moves a plan
 * from `RELEASED` to `ISSUED`, so the interesting write touches both aggregates
 * in one transaction — but a transmittal is found by its own number months
 * later, so it gets a top-level `/transmittals` route rather than a nested one.
 *
 * Splitting them into two feature folders would mean one importing the other's
 * service, which `architecture.test.ts` forbids and is right to.
 *
 * **Nothing cross-cutting is imported.** `EventBus`, `VersioningService` and
 * `MetricsService` come from the global `CoreModule`, `PrismaService` from the
 * global `CommonModule`. That is not an omission — F12 broke the application
 * twice by leaving a module out of an `imports` array, and the check is
 * `node dist/main.js` rather than a test, because vitest's esbuild transform
 * emits no `design:paramtypes` and fails every provider regardless.
 *
 * `DrawingsMetrics` is a provider nothing injects — it registers itself in
 * `onModuleInit`, and being in this list is what causes Nest to construct it.
 */
@Module({
  controllers: [DrawingsController, TransmittalsController],
  providers: [DrawingsService, DrawingsRepository, DrawingsMetrics],
  exports: [DrawingsService],
})
export class DrawingsModule {}
