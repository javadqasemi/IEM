import { Module } from "@nestjs/common";
import { ApplicationsModule } from "../applications/applications.module";
import { ContentModule } from "../content/content.module";
import { ScheduledTasks } from "./scheduled.tasks";

/**
 * The timers, and the handlers they enqueue.
 *
 * The one module that imports two feature modules, and it is the honest place
 * for that: a scheduled publish is a *command* to the content module, not a
 * reaction to a fact, so the event bus is the wrong tool. Everything that is a
 * reaction goes through `core/events` instead, which is why this list is two
 * entries long rather than nine.
 */
@Module({
  imports: [ApplicationsModule, ContentModule],
  providers: [ScheduledTasks],
})
export class TasksModule {}