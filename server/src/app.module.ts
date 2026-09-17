import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { CommonModule } from "./common/common.module";
import { SharedThrottlerStorage } from "./common/throttler.storage";
import { AllExceptionsFilter, EnvelopeInterceptor } from "./common/http";
import { JwtAuthGuard, PermissionsGuard } from "./auth/guards";

import { AuthModule } from "./auth/auth.module";
import { MailModule } from "./mail/mail.module";
import { MediaModule } from "./media/media.module";

import { ContentController } from "./content/content.controller";
import { ContentService } from "./content/content.service";
import { UsersController } from "./users/users.controller";
import { UsersService } from "./users/users.service";
import { RbacController } from "./rbac/rbac.controller";
import { RbacService } from "./rbac/rbac.service";
import { SettingsController } from "./settings/settings.controller";
import { SettingsService } from "./settings/settings.service";
import { AuditController } from "./audit/audit.controller";
import { ApplicationsController } from "./applications/applications.controller";
import { ApplicationsService } from "./applications/applications.service";
import { DashboardController } from "./dashboard/dashboard.controller";
import { ScheduledTasks } from "./tasks/scheduled.tasks";

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
    MailModule,
    AuthModule,
    MediaModule,
  ],
  controllers: [
    ContentController,
    UsersController,
    RbacController,
    SettingsController,
    AuditController,
    ApplicationsController,
    DashboardController,
  ],
  providers: [
    ContentService,
    UsersService,
    RbacService,
    SettingsService,
    ApplicationsService,
    ScheduledTasks,

    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule {}
