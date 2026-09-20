import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module";
import { SettingsController } from "./settings.controller";

/**
 * The settings *screen*.
 *
 * Separate from `SettingsModule`, which is `@Global` and exists so any service
 * can read a setting. Merging them would make every module that reads
 * `mail.smtpHost` also import a controller, and a global module carrying a
 * route is a route that is hard to find.
 *
 * `MailModule` is imported because the controller sends the test message.
 * Explicitly, and not because `MailModule` happens to be constructed early:
 * the two times F12 broke the application were both a module injecting
 * something it had not imported, and neither failed at compile time. `node
 * dist/main.js` after a build is the check that catches it.
 */
@Module({
  imports: [MailModule],
  controllers: [SettingsController],
})
export class SettingsRoutesModule {}