import { Global, Module } from "@nestjs/common";
import { OrganisationRepository } from "./organisation.repository";
import { OrganisationService } from "./organisation.service";

/**
 * The firm's own record, reachable from anywhere.
 *
 * `@Global` for the same reason `SettingsModule` is, and the reason is
 * concrete rather than convenient: `MailService` reads the company name for
 * the sender, `ContentService` reads the offices while building a published
 * snapshot, and `OrganisationController` in the feature folder serves the
 * routes. Three modules that would otherwise each import this one — and the
 * fourth, when it arrives, would be the one somebody forgets, with the failure
 * showing up as a runtime injection error rather than a compile one. F12 broke
 * the application twice exactly that way.
 *
 * The controller is **not** here. It lives in `organisation/` with its
 * class-validator DTOs, which is the split `settings/` is named for: the
 * routes are a feature, the service is infrastructure.
 */
@Global()
@Module({
  providers: [OrganisationRepository, OrganisationService],
  exports: [OrganisationService],
})
export class OrganisationModule {}
