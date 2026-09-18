import { Global, Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { AuditService } from "../audit/audit.service";
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
 * `AuditService` is provided here rather than in a module of its own because
 * the listener needs it and the two are now one mechanism: events in, rows out
 * (`docs/enterprise-architecture.md` §7.5).
 */
@Global()
@Module({
  imports: [CommonModule],
  controllers: [ListPreferenceController],
  providers: [EventBus, AuditService, AuditListener, JobService, JobRunner],
  exports: [EventBus, AuditService, JobService],
})
export class CoreModule {}
