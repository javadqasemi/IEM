import { Module } from "@nestjs/common";
import { ApplicationsController } from "./applications.controller";
import { ApplicationsService } from "./applications.service";
import { MediaModule } from "../media/media.module";

/**
 * Job applications.
 *
 * The reference feature — five layers on the client, events instead of audit
 * calls on the server, and the first resource on the shared list contract.
 *
 * Exported for `ScheduledTasks`, which registers the retention purge as a job
 * handler.
 *
 * **`MediaModule` is imported for the `STORAGE` token**, and that import is the
 * one thing F12 could not have been finished without noticing. While every
 * provider lived on the root module, Nest resolved `STORAGE` from the same flat
 * scope and nothing declared the dependency; moving the service into its own
 * module made the dependency real, and the app refused to boot. The dossier
 * files are written through the same adapter as uploaded media — deliberately,
 * because there should be one thing that knows how to put a byte somewhere —
 * and `main.ts` guards the difference at the URL instead.
 */
@Module({
  imports: [MediaModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}