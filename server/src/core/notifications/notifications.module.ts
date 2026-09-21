import { Module } from "@nestjs/common";
import { MailModule } from "../../mail/mail.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsListener } from "./notifications.listener";
import { NotificationsMetrics } from "./notifications.metrics";
import { NotificationsService } from "./notifications.service";

/**
 * The notification platform.
 *
 * ---
 *
 * **Not `@Global`, unlike its neighbours in `core/`.** `SettingsModule`,
 * `OrganisationModule` and `CryptoModule` are global because features inject
 * them; **nothing injects this one**, and that is the design rather than an
 * omission. A module that wanted to send a notification would be a module
 * coupled to the platform — it announces a domain event instead, and
 * `NotificationsListener` is the only thing on the other side of the bus.
 *
 * The day something genuinely needs to notify without an event to hang it
 * on, the honest fix is an event for that fact, not an export from here.
 *
 * **It imports `MailModule`** because the e-mail channel is one shared
 * abstraction — `MailService.sendNotification` — rather than a second SMTP
 * client. That is the one dependency, and it points the way round it should:
 * the platform uses mail; mail knows nothing about notifications.
 *
 * The controller is declared here rather than in a feature folder, following
 * `core/list/list-preference.controller.ts`. See the note on the controller.
 */
@Module({
  imports: [MailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsListener, NotificationsMetrics],
  /*
    `NotificationsService` is exported for the tests and for nothing else
    today. It is not global on purpose — see above — so an import of this
    module is a visible decision somebody has to write down.
  */
  exports: [NotificationsService],
})
export class NotificationsModule {}
