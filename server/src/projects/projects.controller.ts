import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser, RequirePermissions, type AuthUser } from "../common/decorators";
import { ListQuery, type RawListQuery } from "../core/list/list.decorator";
import { ProjectsService } from "./projects.service";
import {
  AddMemberDto,
  BulkProjectsDto,
  ChangeStatusDto,
  CreateMilestoneDto,
  CreateProjectDto,
  ScopeDisciplineDto,
  UpdateMilestoneDto,
  UpdateProjectDto,
} from "./projects.dto";

/**
 * HTTP, DTOs and guards. No rules, no queries.
 *
 * **Route order is load-bearing.** `@Get("stats")` and `@Get("export")` are
 * declared before `@Get(":id")`, because Nest matches in declaration order and
 * `:id` would otherwise swallow both — producing a 404 for a project called
 * "stats" rather than the statistics. It is the kind of bug that is invisible
 * in review and obvious in a browser.
 *
 * **Every route names its permission.** `JwtAuthGuard` is global and denies by
 * default, so a route without `@Public()` requires a session; `@RequirePermissions`
 * is what makes it require the *right* one. The read routes take `project.read`
 * and the service narrows the rows — `project.readAll` is a widening grant, not
 * a second gate, which is why it appears on no route here. `projects.scope.ts`
 * explains the split.
 */
@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermissions("project.read")
  list(@ListQuery() query: RawListQuery, @CurrentUser() user: AuthUser) {
    return this.projects.list(query, user);
  }

  @Get("stats")
  @RequirePermissions("project.read")
  stats(@CurrentUser() user: AuthUser) {
    return this.projects.stats(user);
  }

  /**
   * CSV, with the same filters the list took.
   *
   * `@Res()` **without** `passthrough`, which bypasses `EnvelopeInterceptor`
   * entirely — a CSV wrapped in `{ data: … }` is not a CSV. The BOM is what
   * makes Excel read UTF-8 instead of the system codepage; without it every
   * `ü` in a project name arrives as mojibake, which `/audit/export` learned
   * first.
   */
  @Get("export")
  @RequirePermissions("project.export")
  async export(
    @ListQuery() query: RawListQuery,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const rows = await this.projects.exportRows(query, user);
    const headers = rows.length ? Object.keys(rows[0]) : ["Nummer", "Projekt"];
    const csv = [
      headers.join(";"),
      ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(";")),
    ].join("\r\n");

    res
      .status(200)
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="projekte-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      })
      .send("﻿" + csv);
  }

  @Post()
  @RequirePermissions("project.create")
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthUser) {
    return this.projects.create(dto, user);
  }

  @Post("bulk/priority")
  @RequirePermissions("project.update")
  bulkPriority(@Body() dto: BulkProjectsDto, @CurrentUser() user: AuthUser) {
    return this.projects.bulkPriority(dto, user);
  }

  @Get(":id")
  @RequirePermissions("project.read")
  detail(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.projects.detail(id, user);
  }

  @Patch(":id")
  @RequirePermissions("project.update")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projects.update(id, dto, user);
  }

  /**
   * The transition, on its own route.
   *
   * `PATCH /projects/:id` cannot change a status — see `UpdateProjectDto`. The
   * separation is what keeps `refuseTransition` on the only path that reaches
   * the column, and it is what makes `project.status_changed` a meaningful row
   * in the audit log rather than one of a hundred `project.updated`.
   *
   * `project.update` opens the route; the two **terminal** transitions need
   * `project.archive` as well, and that second check is in the service because
   * one route serves every transition and only two of them are terminal. A
   * route-level decorator could only have required it for all six.
   */
  @Put(":id/status")
  @RequirePermissions("project.update")
  changeStatus(
    @Param("id") id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projects.changeStatus(id, dto, user);
  }

  @Delete(":id")
  @RequirePermissions("project.delete")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.projects.remove(id, user);
  }

  /* ---- Team -------------------------------------------------------- */

  @Post(":id/members")
  @RequirePermissions("project.manageTeam")
  addMember(
    @Param("id") id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projects.addMember(id, dto, user);
  }

  @Delete(":id/members/:memberId")
  @RequirePermissions("project.manageTeam")
  removeMember(
    @Param("id") id: string,
    @Param("memberId") memberId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projects.removeMember(id, memberId, user);
  }

  /* ---- Gewerke ----------------------------------------------------- */

  /**
   * `PUT`, not `POST`, and it upserts.
   *
   * A Gewerk is either in scope on a project or it is not; the screen is a set
   * of toggles rather than a list somebody appends to, and `PUT` is what
   * "make this the state" means. A `POST` would fail the second time a user
   * corrects a budget, which is the commonest thing they do here.
   */
  @Put(":id/disciplines")
  @RequirePermissions("project.manageDisciplines")
  scopeDiscipline(
    @Param("id") id: string,
    @Body() dto: ScopeDisciplineDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projects.scopeDiscipline(id, dto, user);
  }

  /* ---- Meilensteine ------------------------------------------------ */

  @Get(":id/milestones")
  @RequirePermissions("project.read")
  listMilestones(
    @Param("id") id: string,
    @ListQuery() query: RawListQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projects.listMilestones(id, query, user);
  }

  @Post(":id/milestones")
  @RequirePermissions("project.manageMilestones")
  createMilestone(
    @Param("id") id: string,
    @Body() dto: CreateMilestoneDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projects.createMilestone(id, dto, user);
  }

  @Patch(":id/milestones/:milestoneId")
  @RequirePermissions("project.manageMilestones")
  updateMilestone(
    @Param("id") id: string,
    @Param("milestoneId") milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projects.updateMilestone(id, milestoneId, dto, user);
  }
}

/**
 * One CSV cell.
 *
 * The leading apostrophe on `=`, `+`, `-` and `@` is not formatting — it is
 * what stops Excel treating a project name as a formula. A field beginning `=`
 * is executed on open, and a project name is text somebody typed. `/audit/export`
 * carries the same guard and the same reason.
 */
function csvCell(value: string): string {
  const escaped = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${escaped.replace(/"/g, '""')}"`;
}
