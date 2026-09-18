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
 *
 * ---
 *
 * **It was `tasks/` until Wave 2, and the rename is not cosmetic.**
 *
 * The first business module of Wave 2 is Aufgaben — tasks, the domain kind that
 * belongs to a project and has an assignee and a due date. Two folders called
 * `tasks/`, one of them infrastructure and one of them a feature, is precisely
 * the confusion CLAUDE.md records for `audit/` and `settings/`: "a folder under
 * `server/src/` is either infrastructure or a feature, never both", and the
 * damage there was an import that read as a violation and was legitimate. Here
 * it would be worse in a smaller way — every `../tasks/…` would resolve, and a
 * reader would have to open the file to find out which of the two it meant.
 *
 * So this one takes the name that describes it. It runs a clock; it owns no
 * records, publishes no events and has no screen.
 */
@Module({
  imports: [ApplicationsModule, ContentModule],
  providers: [ScheduledTasks],
})
export class SchedulerModule {}