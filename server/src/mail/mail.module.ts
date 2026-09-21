import { Global, Module } from "@nestjs/common";
import { MailService } from "./mail.service";
import { MailStatusService } from "./mail.status.service";

/**
 * Global because four unrelated modules send mail (auth, users, applications,
 * content review) and threading one stateless service through each of their
 * imports buys nothing.
 *
 * `MailStatusService` is here rather than beside the settings screen because
 * it has two readers — the settings workspace's E-Mail section and
 * `/dashboard/system` — and a status that is computed twice is a status that
 * eventually disagrees with itself. It is the same argument that moved
 * `SettingsService` and `OrganisationService` into `core/`: a service with a
 * second caller belongs where both can reach it, *before* the second caller
 * appears rather than after.
 */
@Global()
@Module({
  providers: [MailService, MailStatusService],
  exports: [MailService, MailStatusService],
})
export class MailModule {}
