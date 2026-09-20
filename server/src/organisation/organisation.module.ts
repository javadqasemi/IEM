import { Module } from "@nestjs/common";
import { OfficesController, OrganisationController } from "./organisation.controller";
import { OrganisationMetrics } from "./organisation.metrics";

/**
 * The routes for Unternehmen and Standorte.
 *
 * **Routes only.** `OrganisationService` and `OrganisationRepository` are
 * provided by the global `core/organisation` module, because `MailService` and
 * `ContentService` inject the service too — the same split
 * `settings/settings.controller.module.ts` is named for, and the rule CLAUDE.md
 * states: a service with more than one caller belongs in `core/` before the
 * second caller appears.
 *
 * The class is `OrganisationRoutesModule` rather than `OrganisationModule`
 * precisely so the two cannot be confused in an import list. Nest would
 * happily accept both names in one file's imports and construct two different
 * things.
 *
 * `OrganisationMetrics` is a provider nothing injects, which looks like a
 * mistake and is not: it registers itself with `MetricsService` in
 * `onModuleInit`, and being in this list is what causes Nest to construct it.
 */
@Module({
  controllers: [OrganisationController, OfficesController],
  providers: [OrganisationMetrics],
})
export class OrganisationRoutesModule {}
