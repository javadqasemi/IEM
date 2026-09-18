import { Priority, TaskDependencyType, TaskStatus } from "@prisma/client";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/**
 * What the module accepts over HTTP.
 *
 * **Every field carries a decorator, and that is not style.** The global pipe
 * runs with `whitelist: true`: a property with no validator is *stripped* on the
 * way in, the service receives `undefined`, Prisma reads that as "leave the
 * column alone", and the endpoint answers 200 having changed nothing. It has
 * happened twice in this codebase and both times the symptom was a save that
 * silently did nothing. `tasks.dto.test.ts` runs the real pipe with the real
 * options against every field here.
 *
 * Dates are `@IsISO8601()` strings, not `@IsDate()` — a JSON body has no `Date`,
 * and `@IsDate` would accept an Invalid Date, which Prisma stores as `null`.
 */

/* ================================================================== */
/* The task                                                            */
/* ================================================================== */

export class CreateTaskDto {
  @IsString() @MinLength(2) @MaxLength(300) title!: string;
  @IsOptional() @IsString() @MaxLength(8000) description?: string;

  /**
   * **Optional, and that is the module's defining decision.**
   *
   * A task with no project is the firm's own to-do — chase an offer, renew a
   * certificate. Requiring a project would push those into a dummy "Sonstiges"
   * project that pollutes every project list, or out of the system entirely.
   * The consequence for visibility is in `tasks.scope.ts`.
   */
  @IsOptional() @IsString() projectId?: string;

  @IsOptional() @IsString() milestoneId?: string;
  @IsOptional() @IsString() assigneeId?: string;
  @IsOptional() @IsString() disciplineId?: string;
  @IsOptional() @IsString() parentTaskId?: string;

  @IsOptional() @IsIn(Object.values(Priority)) priority?: Priority;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() dueDate?: string;

  /**
   * Hours as a string, for the same reason money is one.
   *
   * `@IsNumber()` would accept `4.257` and let the column round it, and an
   * estimate that changes between the form and the record is a number nobody
   * trusts afterwards. The service parses it once through `toHours`, which
   * refuses anything else with the field named.
   */
  @IsOptional() @IsString() @MaxLength(10) estimateHours?: string;
}

/**
 * The edit body.
 *
 * **`status` is deliberately absent.** A status change is a transition with
 * preconditions — open subtasks, unfinished `FS` dependencies — its own
 * permission path and its own event. Folding it into the general update would
 * make `PATCH /tasks/:id { status: "DONE" }` walk straight past
 * `refuseTransition` the first time somebody forgot to check, and it is what
 * makes `task.status_changed` a meaningful audit row rather than one of a
 * hundred `task.updated`.
 *
 * **`position` is absent too**, and for a sharper reason: a position is
 * meaningless without knowing which column it is in and which cards it sits
 * between. `PUT /tasks/:id/position` takes the neighbours, which is what a drag
 * actually produces.
 */
export class UpdateTaskDto {
  /**
   * The version the caller read before editing. **Required** (F13).
   *
   * Required rather than optional, and the reasoning is `UpdateProjectDto`'s: an
   * optional lock is one every caller forgets exactly once, and the failure is
   * the worst kind — the second save wins silently and nothing records that the
   * first person's work existed. Projects set the precedent as the reference
   * module; this is the first module to inherit it rather than argue it again.
   */
  @IsInt() @Min(1) expectedVersion!: number;

  /** Why, for the version history. Free text, optional. */
  @IsOptional() @IsString() @MaxLength(500) versionNote?: string;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(8000) description?: string | null;
  @IsOptional() @IsIn(Object.values(Priority)) priority?: Priority;
  @IsOptional() @IsISO8601() startDate?: string | null;
  @IsOptional() @IsISO8601() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(10) estimateHours?: string | null;
  @IsOptional() @IsString() projectId?: string | null;
  @IsOptional() @IsString() milestoneId?: string | null;
  @IsOptional() @IsString() disciplineId?: string | null;
  @IsOptional() @IsString() parentTaskId?: string | null;

  /**
   * On the edit body **and** on its own route, which is the one duplication in
   * this file worth having.
   *
   * Reassigning is usually part of editing a card, and forcing a second request
   * for it would make the drawer's save either two round-trips or two failure
   * modes. But reassignment also happens on its own — from a board card's menu,
   * from a bulk action — and it needs `task.assign` rather than `task.update`.
   * The service checks that permission whenever this field is present,
   * whichever route carried it, so the two paths cannot disagree.
   */
  @IsOptional() @IsString() assigneeId?: string | null;
}

/**
 * The transition.
 *
 * `blockedReason` is required-when-blocking, and that is checked in the service
 * rather than here: class-validator's conditional decorators can express it, and
 * doing so would put half the rule in the DTO and half in `refuseTransition`.
 * The rules file owns what a transition means.
 */
export class ChangeTaskStatusDto {
  @IsIn(Object.values(TaskStatus)) status!: TaskStatus;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

/** Reassignment on its own route — `null` returns the task to the backlog. */
export class AssignTaskDto {
  @IsOptional() @IsString() assigneeId?: string | null;
}

/* ================================================================== */
/* The board                                                           */
/* ================================================================== */

/**
 * A drag, as the board actually produces it.
 *
 * **The neighbours, not a number.** A client that computed the position itself
 * would hold a second copy of `positionBetween` — including the renumber case,
 * which it cannot perform — and two clients dragging into the same gap would
 * both compute the same value. Naming the neighbours lets the server decide,
 * which is also what makes the gap-exhausted path invisible to the caller.
 *
 * `status` is optional because a drag *within* a column does not change it; when
 * it is present the move is also a transition and goes through
 * `refuseTransition` like any other.
 */
export class MoveTaskDto {
  @IsOptional() @IsIn(Object.values(TaskStatus)) status?: TaskStatus;
  /** The card it lands after. Absent means the top of the column. */
  @IsOptional() @IsString() afterId?: string | null;
  /** The card it lands before. Absent means the bottom. */
  @IsOptional() @IsString() beforeId?: string | null;
}

/* ================================================================== */
/* Dependencies                                                        */
/* ================================================================== */

export class AddDependencyDto {
  /** The task that has to happen first. */
  @IsString() predecessorId!: string;
  @IsOptional() @IsIn(Object.values(TaskDependencyType)) type?: TaskDependencyType;
  /**
   * Days between the two ends. **Negative is legitimate** — a lag of −2 on `FS`
   * means the successor may start two days before the predecessor finishes,
   * which is how a Bauprogramm overlaps trades. The bound is a fortnight either
   * way; beyond that it is a date, not a lag.
   */
  @IsOptional() @IsInt() @Min(-365) @Max(365) lagDays?: number;
}

/* ================================================================== */
/* Checklist                                                           */
/* ================================================================== */

export class AddChecklistItemDto {
  @IsString() @MinLength(1) @MaxLength(500) text!: string;
}

export class UpdateChecklistItemDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) text?: string;
  @IsOptional() @IsBoolean() done?: boolean;
}

/* ================================================================== */
/* Comments                                                            */
/* ================================================================== */

export class AddCommentDto {
  @IsString() @MinLength(1) @MaxLength(8000) body!: string;
  /** A reply to another comment. One level; a thread is not a forum. */
  @IsOptional() @IsString() parentId?: string;
  /**
   * Who was named with `@`, as ids.
   *
   * Sent by the client rather than parsed out of the body here, because the
   * client is what resolved the names in its picker — and re-parsing `@Anna`
   * server-side would have to guess which Anna. The ids are validated against
   * the employee table before the event is raised, so a fabricated id notifies
   * nobody.
   */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) mentionedIds?: string[];
}

/* ================================================================== */
/* Bulk                                                                */
/* ================================================================== */

/**
 * The list contract's bulk actions.
 *
 * Two fields, both optional, at least one required — checked in the service.
 * **Priority and assignee, and deliberately not status**: a bulk status change
 * would run `refuseTransition` two hundred times and either fail the whole
 * request on one bad row or half-apply it, and "half of what you selected
 * changed" is the worst possible answer. The argument `BulkProjectsDto` makes,
 * and assignment qualifies for the same reason priority does — it has no
 * preconditions.
 */
export class BulkTasksDto {
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) ids!: string[];
  @IsOptional() @IsIn(Object.values(Priority)) priority?: Priority;
  @IsOptional() @IsString() assigneeId?: string | null;
}
