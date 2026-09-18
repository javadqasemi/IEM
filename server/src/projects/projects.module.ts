import { Module } from "@nestjs/common";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { ProjectsRepository } from "./projects.repository";
import { ProjectsReconciler } from "./projects.reconcile";
import { ProjectsMetrics } from "./projects.metrics";

/**
 * The reference module (roadmap Wave 1, module 4).
 *
 * Five providers, and the list is the architecture: a controller that speaks
 * HTTP, a service that decides, a repository that queries, a reconciler on the
 * job queue, a metrics source that declares what the module owns, and — not
 * listed, because it is neither a class nor injectable — `projects.rules.ts`,
 * which is pure and therefore needs no registration at all. That last one is
 * the part worth copying: the rules are testable without Nest because Nest
 * never touches them.
 *
 * `ProjectsMetrics` is a provider nothing injects, which looks like a mistake
 * and is not: it registers itself with `MetricsService` in `onModuleInit`, and
 * being in this list is what causes Nest to construct it at all. Deleting it
 * because "nothing uses it" removes the module from `/metrics/modules` without
 * breaking a single test — `projects.metrics.test.ts` is the guard.
 *
 * **Nothing cross-cutting is imported.** `EventBus` and `JobService` come from
 * the global `CoreModule` and `PrismaService` from the global `CommonModule`,
 * which is what those two are `@Global` for. A module that imported them would
 * be twenty-six lines of ceremony repeated, and the day one of them is
 * forgotten the failure is a runtime injection error rather than a compile one.
 *
 * `ProjectsService` is exported so that the modules embedded in the project
 * view (Tasks, Meetings, Drawings…) can ask *whether a caller may see a
 * project* without each reimplementing `projects.scope.ts`. That is a
 * cross-feature **query**, which the architecture allows; a cross-feature
 * *reaction* goes through `core/events` instead.
 */
@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository, ProjectsReconciler, ProjectsMetrics],
  exports: [ProjectsService],
})
export class ProjectsModule {}
