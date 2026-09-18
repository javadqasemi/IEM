import { Module } from "@nestjs/common";
import { ApplicationsController } from "./applications.controller";
import { ApplicationsService } from "./applications.service";

/**
 * Job applications.
 *
 * The reference feature — five layers on the client, events instead of audit
 * calls on the server, and the first resource on the shared list contract.
 *
 * Exported for `ScheduledTasks`, which registers the retention purge as a job
 * handler.
 */
@Module({
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}