import { Module } from "@nestjs/common";
import { ContentController } from "./content.controller";
import { ContentService } from "./content.service";

/**
 * Content: types, entries, versions, review and publishing.
 *
 * `ContentService` is exported because `ScheduledTasks` publishes on a timer —
 * the one cross-module dependency here that an event cannot replace, since a
 * scheduled publish is a *command* rather than a reaction to a fact.
 */
@Module({
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}