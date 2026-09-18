import { Module } from "@nestjs/common";
import { DecisionsController, MeetingsController } from "./meetings.controller";
import { MeetingsService } from "./meetings.service";
import { MeetingsRepository } from "./meetings.repository";
import { MeetingsMetrics } from "./meetings.metrics";

/**
 * Sitzungen und Entscheide — Wave 2, module 2.
 *
 * **Two controllers, one service, one repository**, and that is the shape the
 * domain has rather than a compromise. A decision is taken *at* a meeting and a
 * protocol line *is* the citation, so every interesting write touches both — but
 * a decision outlives its meeting and is found by number months later, which is
 * why it has a top-level `/decisions` route rather than a nested one.
 *
 * Splitting them into two feature folders would mean one importing the other's
 * service, which `architecture.test.ts` forbids and which would be the right
 * thing to forbid.
 *
 * **Nothing cross-cutting is imported.** `EventBus`, `VersioningService` and
 * `MetricsService` come from the global `CoreModule`, `PrismaService` from the
 * global `CommonModule`. **`TasksModule` is not imported either**, although a
 * Pendenz becomes a task: the two statements that write it are in this module's
 * own repository, and the arithmetic they need is borrowed from
 * `tasks.rules.ts`, which is pure. A service import would be a feature reaching
 * into a sibling.
 *
 * `MeetingsMetrics` is a provider nothing injects — it registers itself in
 * `onModuleInit`, and being in this list is what causes Nest to construct it.
 */
@Module({
  controllers: [MeetingsController, DecisionsController],
  providers: [MeetingsService, MeetingsRepository, MeetingsMetrics],
  exports: [MeetingsService],
})
export class MeetingsModule {}
