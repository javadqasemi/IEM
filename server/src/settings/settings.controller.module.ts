import { Module } from "@nestjs/common";
import { SettingsController } from "./settings.controller";

/**
 * The settings *screen*.
 *
 * Separate from `SettingsModule`, which is `@Global` and exists so any service
 * can read a setting. Merging them would make every module that reads
 * `mail.smtpHost` also import a controller, and a global module carrying a
 * route is a route that is hard to find.
 */
@Module({
  controllers: [SettingsController],
})
export class SettingsRoutesModule {}