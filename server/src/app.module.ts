import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { CommonModule } from "./common/common.module";
import { CoreModule } from "./core/core.module";
import { EventFlushInterceptor } from "./core/context/request-context.interceptor";
import { MetricsInterceptor } from "./core/metrics/metrics.interceptor";
import { RequestContextMiddleware } from "./core/context/request-context.middleware";
import { SharedThrottlerStorage } from "./common/throttler.storage";
import { AllExceptionsFilter, EnvelopeInterceptor } from "./common/http";
import { JwtAuthGuard, PermissionsGuard } from "./auth/guards";

import { AuthModule } from "./auth/auth.module";
import { MailModule } from "./mail/mail.module";
import { MediaModule } from "./media/media.module";

import { SettingsModule } from "./core/settings/settings.module";
import { SettingsRoutesModule } from "./settings/settings.controller.module";
import { ContentModule } from "./content/content.module";
import { UsersModule } from "./users/users.module";
import { RbacModule } from "./rbac/rbac.module";
import { AuditModule } from "./audit/audit.module";
import { ApplicationsModule } from "./applications/applications.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { MeetingsModule } from "./meetings/meetings.module";
import { DrawingsModule } from "./drawings/drawings.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { TasksModule } from "./tasks/tasks.module";

import { ProjectsModule } from "./projects/projects.module";
import { CustomersModule } from "./customers/customers.module";
import { BuildingsModule } from "./buildings/buildings.module";
import { EmployeesModule } from "./employees/employees.module";
import { DisciplinesModule } from "./disciplines/disciplines.module";

/**
 * The application root.
 *
 * Three things are registered globally, and the order they run in is the whole
 * security posture: `ThrottlerGuard` first (a rate limit has to apply before
 * anything expensive happens, including to unauthenticated routes), then
 * `JwtAuthGuard`, then `PermissionsGuard`. Nest runs `APP_GUARD` providers in
 * declaration order, so this list is load-bearing — do not reorder it.
 *
 * `JwtAuthGuard` denies by default; a route opts out with `@Public()`. That is
 * the right way round: a controller added by someone who has not read this
 * file is protected rather than exposed.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    ScheduleModule.forRoot(),
    /**
     * `forRootAsync` only so the storage can be injected.
     *
     * With the default in-memory store the limit is per **process**: four PM2
     * workers turn the ten sign-in attempts a minute below into forty, silently.
     * `SharedThrottlerStorage` puts the counters in Redis when `REDIS_URL` is
     * set and falls back to the same in-memory behaviour when it is not — so a
     * developer machine is unchanged and a clustered deployment gets the number
     * it configured.
     */
    ThrottlerModule.forRootAsync({
      imports: [CommonModule],
      inject: [SharedThrottlerStorage],
      useFactory: (storage: SharedThrottlerStorage) => ({
        // The default ceiling. Individual routes tighten it — sign-in, password
        // reset and the public application form all carry their own `@Throttle`.
        throttlers: [{ name: "default", ttl: 60_000, limit: 300 }],
        storage,
      }),
    }),
    CommonModule,
    /**
     * The event bus, the audit listener and the job queue.
     *
     * `@Global`, so twenty-six feature modules do not each import it — see the
     * note on the module. It comes before everything that raises events, which
     * is documentation rather than a requirement: Nest resolves by the graph.
     */
    CoreModule,
    // Before `MailModule` and `AuthModule` in the list because both now read
    // settings. Nest resolves providers by the graph rather than by this order,
    // so it is documentation rather than a requirement — but the graph is what
    // the reader is trying to reconstruct, and this is the shape of it.
    SettingsModule,
    MailModule,
    AuthModule,
    MediaModule,

    /**
     * The features (foundation stage F12, weakness W8).
     *
     * **This list is modules, and it will never be anything else.** Until now
     * seven controllers and five services were declared directly here, which
     * at twenty-six modules is a root module nobody can read and a boundary
     * nowhere. A feature now owns its controller, its service and what it
     * exports, and the only thing visible from here is that it exists.
     *
     * The order is alphabetical, deliberately: it carries no information, and
     * a list that looks ordered by dependency invites somebody to maintain an
     * order Nest resolves from the graph anyway.
     */
    ApplicationsModule,
    AuditModule,
    BuildingsModule,
    ContentModule,
    CustomersModule,
    DashboardModule,
    DisciplinesModule,
    EmployeesModule,
    MeetingsModule,
    DrawingsModule,
    ProjectsModule,
    RbacModule,
    SchedulerModule,
    SettingsRoutesModule,
    TasksModule,
    UsersModule,
  ],
  providers: [
    /*
      No feature providers here. `SettingsService` was the first to leave — it
      moved to the global `SettingsModule` so `MailService` and `AuthService`
      could inject it, and leaving a copy here would have constructed a second
      instance. F12 finished the job for the other five.
    */
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    /**
     * Interceptor order is load-bearing too, and the other way round from the
     * guards: Nest runs them outside-in on the way *in* and inside-out on the
     * way *out*. `EventFlushInterceptor` is listed first so it is the
     * outermost — the flush has to happen after everything else has finished,
     * and the actor has to be recorded before the handler runs.
     */
    { provide: APP_INTERCEPTOR, useClass: EventFlushInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    /**
     * Last, therefore **innermost**.
     *
     * Nest runs interceptors outside-in on the way in and inside-out on the way
     * out, so the timer starts closest to the handler and stops closest to it:
     * what is measured is the handler and its serialisation, not the envelope
     * and the event flush wrapped around them. That is the number a slow query
     * shows up in.
     */
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class AppModule implements NestModule {
  /**
   * The request context, opened for every route.
   *
   * A middleware rather than an interceptor, and the reason is written in
   * `request-context.middleware.ts`: an interceptor builds its observable
   * before Nest subscribes, so the handler runs outside the
   * `AsyncLocalStorage` scope and every `correlationId()` mints its own. The
   * symptom was an audit row that never appeared.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
