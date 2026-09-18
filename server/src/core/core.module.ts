import { Global, Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { EventBus } from "./events/event-bus";
import { AuditListener } from "./events/audit.listener";
import { JobRunner } from "./jobs/job.runner";
import { ListPreferenceController } from "./list/list-preference.controller";
import { JobService } from "./jobs/job.service";

/**
 * The cross-cutting infrastructure every feature module depends on.
 *
 * `@Global`, and that is the right call for exactly these: the event bus, the
 * job queue and the audit listener are singletons that twenty-six modules will
 * each need, and importing `CoreModule` into all of them would be twenty-six
 * lines of ceremony that can only ever be forgotten, never varied.
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
  controllers: [ListPreferenceController],
  providers: [EventBus, AuditListener, JobService, JobRunner],
  exports: [EventBus, JobService],
})
export class CoreModule {}
