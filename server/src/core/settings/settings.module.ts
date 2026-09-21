import { Global, Module } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { SecretSettingsService } from "./settings.secrets";

/**
 * Settings, made reachable from anywhere.
 *
 * `SettingsService` used to be a bare provider on `AppModule`, which meant only
 * things `AppModule` constructs could read it — and that is a large part of why
 * 24 of the 26 settings were write-only. `MailService` could not read
 * `mail.smtpHost` because `MailModule` had no way to inject it, so it read the
 * environment instead and the dashboard's SMTP form configured nothing.
 *
 * `@Global` is the exception this project otherwise avoids (see
 * `CommonModule`), and it earns it on the same grounds: settings are
 * infrastructure every feature eventually reads, and the alternative is
 * importing this into every feature module and re-importing it whenever a new
 * setting finds a consumer.
 */
/**
 * `SecretSettingsService` is provided here and exported, but almost nothing
 * should inject it: `SettingsService` is the seam, and a caller that reaches
 * past it to the cipher is a caller deciding for itself what counts as a
 * credential. It is exported because the mail diagnostics ask whether secrets
 * are *readable at all* — a question about the deployment, not about a value.
 */
@Global()
@Module({
  providers: [SettingsService, SecretSettingsService],
  exports: [SettingsService, SecretSettingsService],
})
export class SettingsModule {}
