import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser, RequirePermissions, type AuthUser } from "../common/decorators";
import { ListQuery, type RawListQuery } from "../core/list/list.decorator";
import { TasksService } from "./tasks.service";
import {
  AddChecklistItemDto,
  AddCommentDto,
  AddDependencyDto,
  AssignTaskDto,
  BulkTasksDto,
  ChangeTaskStatusDto,
  CreateTaskDto,
  MoveTaskDto,
  UpdateChecklistItemDto,
  UpdateTaskDto,
} from "./tasks.dto";

/**
 * HTTP, DTOs and guards. No rules, no queries.
 *
 * **Route order is load-bearing.** `@Get("stats")` and `@Get("export")` are
 * declared before `@Get(":id")`, because Nest matches in declaration order and
 * `:id` would otherwise swallow both — producing a 404 for a task called
 * "stats" rather than the statistics. The bug is invisible in review and obvious
 * in a browser, and it is why Projects' controller carries the same note.
 *
 * ---
 *
 * **The write routes carry `task.read`, and the real check is in the service.**
 * That looks like a missing guard and is the opposite of one — it is the
 * `◐` pattern `docs/permissions.md` §4 describes, and the reason is written on
 * `RequirePermissions` itself: *"AND rather than OR … the cases that genuinely
 * want 'either' are rare enough to be worth writing out in the service."*
 *
 * A write here is allowed by `task.update` **or** by `task.updateOwn` on a row
 * the caller owns. A decorator naming both would require *both* and lock out
 * every engineer; naming either one alone would lock out the other role. And
 * `updateOwn` cannot be decided at the route at all, because it depends on the
 * row — which the guard has not read. So `TasksService.requireWritable` is the
 * single gate, every write passes through it, and
 * `permissions.agreement.test.ts` counts the `permissions.has(...)` inside it as
 * enforcement precisely so that these two keys do not read as dead.
 *
 * `task.readAll` appears on no route, exactly as `project.readAll` does: it is a
 * widening grant read by `tasks.scope.ts`, not a second gate.
 */
@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermissions("task.read")
  list(@ListQuery() query: RawListQuery, @CurrentUser() user: AuthUser) {
    return this.tasks.list(query, user);
  }

  @Get("stats")
  @RequirePermissions("task.read")
  stats(@CurrentUser() user: AuthUser) {
    return this.tasks.stats(user);
  }

  /**
   * CSV, with the same filters the list took.
   *
   * `@Res()` **without** `passthrough`, which bypasses `EnvelopeInterceptor`
   * entirely — a CSV wrapped in `{ data: … }` is not a CSV. The BOM is what
   * makes Excel read UTF-8 instead of the system codepage; without it every `ü`
   * in a task title arrives as mojibake.
   */
  @Get("export")
  @RequirePermissions("task.export")
  async export(
    @ListQuery() query: RawListQuery,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const rows = await this.tasks.exportRows(query, user);
    const headers = rows.length ? Object.keys(rows[0]) : ["Aufgabe", "Status"];
    const csv = [
      headers.join(";"),
      ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(";")),
    ].join("\r\n");

    res
      .status(200)
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="aufgaben-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      })
      .send("﻿" + csv);
  }

  @Post()
  @RequirePermissions("task.create")
  create(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthUser) {
    return this.tasks.create(dto, user);
  }

  @Post("bulk")
  @RequirePermissions("task.read")
  bulk(@Body() dto: BulkTasksDto, @CurrentUser() user: AuthUser) {
    return this.tasks.bulk(dto, user);
  }

  @Get(":id")
  @RequirePermissions("task.read")
  detail(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.detail(id, user);
  }

  @Patch(":id")
  @RequirePermissions("task.read")
  update(@Param("id") id: string, @Body() dto: UpdateTaskDto, @CurrentUser() user: AuthUser) {
    return this.tasks.update(id, dto, user);
  }

  @Delete(":id")
  @RequirePermissions("task.delete")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.remove(id, user);
  }

  /**
   * The transition, on its own route.
   *
   * `PATCH /tasks/:id` cannot change a status — see `UpdateTaskDto`. The
   * separation keeps `refuseTransition` on the only path that reaches the
   * column, and it is what makes `task.status_changed` a meaningful audit row
   * rather than one of a hundred `task.updated`.
   */
  @Put(":id/status")
  @RequirePermissions("task.read")
  changeStatus(
    @Param("id") id: string,
    @Body() dto: ChangeTaskStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.changeStatus(id, dto, user);
  }

  /** What `BLOCKED` returns to, named rather than left for the client to work out. */
  @Post(":id/unblock")
  @RequirePermissions("task.read")
  unblock(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.unblock(id, user);
  }

  /**
   * A drag on the board.
   *
   * `PUT`, because a position is a state rather than an event: dropping the same
   * card in the same place twice must be the same board, and a `POST` would read
   * as "record another move".
   */
  @Put(":id/position")
  @RequirePermissions("task.read")
  move(@Param("id") id: string, @Body() dto: MoveTaskDto, @CurrentUser() user: AuthUser) {
    return this.tasks.move(id, dto, user);
  }

  @Put(":id/assignee")
  @RequirePermissions("task.assign")
  assign(@Param("id") id: string, @Body() dto: AssignTaskDto, @CurrentUser() user: AuthUser) {
    return this.tasks.assign(id, dto, user);
  }

  /* ---- Abhängigkeiten ---------------------------------------------- */

  @Post(":id/dependencies")
  @RequirePermissions("task.read")
  addDependency(
    @Param("id") id: string,
    @Body() dto: AddDependencyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.addDependency(id, dto, user);
  }

  @Delete(":id/dependencies/:dependencyId")
  @RequirePermissions("task.read")
  removeDependency(
    @Param("id") id: string,
    @Param("dependencyId") dependencyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.removeDependency(id, dependencyId, user);
  }

  /* ---- Checkliste --------------------------------------------------- */

  @Get(":id/checklist")
  @RequirePermissions("task.read")
  checklist(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.checklist(id, user);
  }

  @Post(":id/checklist")
  @RequirePermissions("task.read")
  addChecklistItem(
    @Param("id") id: string,
    @Body() dto: AddChecklistItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.addChecklistItem(id, dto, user);
  }

  @Patch(":id/checklist/:itemId")
  @RequirePermissions("task.read")
  updateChecklistItem(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateChecklistItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.updateChecklistItem(id, itemId, dto, user);
  }

  @Delete(":id/checklist/:itemId")
  @RequirePermissions("task.read")
  removeChecklistItem(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.removeChecklistItem(id, itemId, user);
  }

  /* ---- Kommentare --------------------------------------------------- */

  @Get(":id/comments")
  @RequirePermissions("task.read")
  comments(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.comments(id, user);
  }

  /**
   * `task.comment`, not `task.update`.
   *
   * Asking a question on somebody else's card is the point of a thread;
   * requiring write access to comment would mean an engineer can see a blocked
   * card and not ask why.
   */
  @Post(":id/comments")
  @RequirePermissions("task.comment")
  addComment(@Param("id") id: string, @Body() dto: AddCommentDto, @CurrentUser() user: AuthUser) {
    return this.tasks.addComment(id, dto, user);
  }

  /**
   * The author, or `task.delete` — checked in the service, because it depends on
   * the row. `task.comment` opens the route so that an author who may comment
   * may also retract.
   */
  @Delete(":id/comments/:commentId")
  @RequirePermissions("task.comment")
  removeComment(
    @Param("id") id: string,
    @Param("commentId") commentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.removeComment(id, commentId, user);
  }

  /* ---- Versionsverlauf ---------------------------------------------- */

  /**
   * `task.read` and not a permission of its own — the argument Projects makes:
   * a version history is the record's own contents over time, so anyone who may
   * read the record may read what it used to say. The **row-level** rules still
   * apply, because `TasksService.history` goes through the same `require`.
   */
  @Get(":id/versions")
  @RequirePermissions("task.read")
  history(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.history(id, user);
  }

  @Get(":id/versions/:version")
  @RequirePermissions("task.read")
  versionAt(
    @Param("id") id: string,
    @Param("version") version: string,
    @CurrentUser() user: AuthUser,
  ) {
    const n = Number(version);
    if (!Number.isInteger(n) || n < 1) {
      throw new BadRequestException(`„${version}“ ist keine Versionsnummer.`);
    }
    return this.tasks.versionAt(id, n, user);
  }
}

/**
 * One CSV cell.
 *
 * The leading apostrophe on `=`, `+`, `-` and `@` is not formatting — it is what
 * stops Excel treating a task title as a formula. A field beginning `=` is
 * executed on open, and a task title is text somebody typed.
 */
function csvCell(value: string): string {
  const escaped = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${escaped.replace(/"/g, '""')}"`;
}
