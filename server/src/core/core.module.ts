import { Global, Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { EventBus } from "./events/event-bus";
import { AuditListener } from "./events/audit.listener";
import { JobRunner } from "./jobs/job.runner";
import { JobsController } from "./jobs/jobs.controller";
import { ListPreferenceController } from "./list/list-preference.controller";
import { JobService } from "./jobs/job.service";
import { VersioningService } from "./versioning/versioning.service";
import { MetricsService } from "./metrics/metrics.service";
import { MetricsController } from "./metrics/metrics.controller";
import { DiagnosticsService } from "./diagnostics/diagnostics.service";
import { DiagnosticsController } from "./diagnostics/diagnostics.controller";

/**
 * The cross-cutting infrastructure every feature module depends on.
 *
 * `@Global`, and that is the right call for exactly these: the event bus, the
 * job queue, the audit listener and the version history are singletons that
 * twenty-six modules will each need, and importing `CoreModule` into all of
 * them would be twenty-six lines of ceremony that can only ever be forgotten,
 * never varied.
 *
 * **`AuditService` is deliberately not listed.** It is provided by the global
 * `CommonModule`, and re-declaring it here would construct a *second*
 * instance: `AuditListener` would hold one and every feature service another.
 * Nothing would break — the service is stateless — which is precisely why it
 * would have gone unnoticed. `app.module.ts` carries the same note about
 * `SettingsService`, which is where this was learned the first time.
 */
@Global()
@Module({
  imports: [CommonModule],
  /*
    `JobsController` sits here rather than in a feature folder (P2-6).

    The same placement `MetricsController` has, for the same reason:
    infrastructure with an operator surface keeps the surface beside the thing
    it operates. A `system/` feature folder would have owed a `*.metrics.ts`
    that a module with no records of its own has nothing to fill in — which is
    the exemption `WITHOUT_METRICS` already grants `dashboard/`, and that list
    may only shrink.
  */
  controllers: [ListPreferenceController, MetricsController, JobsController, DiagnosticsController],
  providers: [
    EventBus,
    AuditListener,
    JobService,
    JobRunner,
    VersioningService,
    MetricsService,
    DiagnosticsService,
  ],
  exports: [EventBus, JobService, VersioningService, MetricsService],
})
export class CoreModule {}
