import { Module } from "@nestjs/common";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";
import { TasksRepository } from "./tasks.repository";
import { TasksOverdueSweep } from "./tasks.overdue";
import { TasksMetrics } from "./tasks.metrics";

/**
 * Aufgaben — Wave 2, module 1.
 *
 * **The first module derived from the Projects reference**, and the list of
 * providers is the architecture: a controller that speaks HTTP, a service that
 * decides, a repository that queries, a sweep on the job queue, a metrics source
 * that declares what the module owns, and — not listed, because it is neither a
 * class nor injectable — `tasks.rules.ts`, which is pure and therefore needs no
 * registration at all. That last one is the part worth copying: the rules are
 * testable without Nest because Nest never touches them.
 *
 * **Nothing cross-cutting is imported.** `EventBus`, `JobService`,
 * `VersioningService` and `MetricsService` come from the global `CoreModule`,
 * `PrismaService` and `RedisService` from the global `CommonModule`. A module
 * that imported them would be twenty-six lines of ceremony repeated, and the day
 * one is forgotten the failure is a runtime injection error rather than a
 * compile one — which is exactly how F12 broke the application twice, and why
 * `node dist/main.js` after a build is the check.
 *
 * **`ProjectsModule` is not imported either**, although a task belongs to a
 * project, and that is the point of the event bus: this module reads the
 * project's *rows* through its own repository and announces facts about tasks.
 * It asks Projects nothing. `architecture.test.ts` forbids the import that would
 * make it a feature reaching into a sibling.
 *
 * `TasksMetrics` is a provider nothing injects, which looks like a mistake and
 * is not: it registers itself with `MetricsService` in `onModuleInit`, and being
 * in this list is what causes Nest to construct it at all.
 */
@Module({
  controllers: [TasksController],
  providers: [TasksService, TasksRepository, TasksOverdueSweep, TasksMetrics],
  exports: [TasksService],
})
export class TasksModule {}
