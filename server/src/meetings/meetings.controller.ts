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
import { MeetingsService } from "./meetings.service";
import {
  AddAgendaItemDto,
  AddAttendeeDto,
  AddMeetingItemDto,
  ApproveMinutesDto,
  BulkItemsDto,
  ChangeDecisionStatusDto,
  ChangeMeetingStatusDto,
  CreateDecisionDto,
  CreateMeetingDto,
  RecordAttendanceDto,
  ReorderItemsDto,
  SupersedeDecisionDto,
  UpdateAgendaItemDto,
  UpdateDecisionDto,
  UpdateMeetingDto,
  UpdateMeetingItemDto,
} from "./meetings.dto";

/**
 * HTTP, DTOs and guards. No rules, no queries.
 *
 * **Route order is load-bearing.** `@Get("stats")`, `@Get("export")` and
 * `@Get("items")` are declared before `@Get(":id")`, because Nest matches in
 * declaration order and `:id` would otherwise swallow all three — producing a
 * 404 for a meeting called "stats" rather than the statistics.
 *
 * **`meeting.hold`, `meeting.approve` and `meeting.sendMinutes` are their own
 * keys**, and each is a different question: may you declare that a meeting took
 * place, may you decide that this is what was said, and may you put it in front
 * of the Bauherrschaft. `meeting.update` answers none of them.
 *
 * `meeting.readAll` appears on no route — it is a widening grant read by
 * `meetings.scope.ts`, not a second gate.
 */
@Controller("meetings")
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  @RequirePermissions("meeting.read")
  list(@ListQuery() query: RawListQuery, @CurrentUser() user: AuthUser) {
    return this.meetings.list(query, user);
  }

  @Get("stats")
  @RequirePermissions("meeting.read")
  stats(@CurrentUser() user: AuthUser) {
    return this.meetings.stats(user);
  }

  /**
   * Protocol lines across every meeting the caller may see.
   *
   * *"Alle offenen Pendenzen für Lüftung über alle Bausitzungen"* — the query
   * `data-model.md` §3.11 names, and the reason `disciplineId` sits on the line
   * rather than being reached through the project.
   */
  @Get("items")
  @RequirePermissions("meeting.read")
  items(@ListQuery() query: RawListQuery, @CurrentUser() user: AuthUser) {
    return this.meetings.listItems(query, user);
  }

  /**
   * CSV, with the same filters the list took.
   *
   * `@Res()` **without** `passthrough`, which bypasses `EnvelopeInterceptor` —
   * a CSV wrapped in `{ data: … }` is not a CSV. The BOM is what makes Excel
   * read UTF-8 instead of the system codepage.
   */
  @Get("export")
  @RequirePermissions("meeting.export")
  async export(
    @ListQuery() query: RawListQuery,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const rows = await this.meetings.exportRows(query, user);
    sendCsv(res, rows, ["Sitzung", "Datum"], "sitzungen");
  }

  @Post()
  @RequirePermissions("meeting.create")
  create(@Body() dto: CreateMeetingDto, @CurrentUser() user: AuthUser) {
    return this.meetings.create(dto, user);
  }

  @Post("items/bulk")
  @RequirePermissions("meeting.update")
  bulkItems(@Body() dto: BulkItemsDto, @CurrentUser() user: AuthUser) {
    return this.meetings.bulkItems(dto, user);
  }

  @Get(":id")
  @RequirePermissions("meeting.read")
  detail(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.meetings.detail(id, user);
  }

  @Patch(":id")
  @RequirePermissions("meeting.update")
  update(@Param("id") id: string, @Body() dto: UpdateMeetingDto, @CurrentUser() user: AuthUser) {
    return this.meetings.update(id, dto, user);
  }

  @Delete(":id")
  @RequirePermissions("meeting.delete")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.meetings.remove(id, user);
  }

  /**
   * Holding or cancelling.
   *
   * `meeting.hold`, not `meeting.update`: marking a Bausitzung as held is what
   * turns a plan into a record, and after it the protocol is a document people
   * cite.
   */
  @Put(":id/status")
  @RequirePermissions("meeting.hold")
  changeStatus(
    @Param("id") id: string,
    @Body() dto: ChangeMeetingStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.changeStatus(id, dto, user);
  }

  /* ---- Teilnehmende -------------------------------------------------- */

  @Post(":id/attendees")
  @RequirePermissions("meeting.update")
  addAttendee(
    @Param("id") id: string,
    @Body() dto: AddAttendeeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.addAttendee(id, dto, user);
  }

  @Delete(":id/attendees/:attendeeId")
  @RequirePermissions("meeting.update")
  removeAttendee(
    @Param("id") id: string,
    @Param("attendeeId") attendeeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.removeAttendee(id, attendeeId, user);
  }

  /**
   * Who turned up, for the whole room at once.
   *
   * `PUT`, because it sets a state rather than appending: recording attendance
   * twice must be the same room, not two rooms.
   */
  @Put(":id/attendance")
  @RequirePermissions("meeting.update")
  recordAttendance(
    @Param("id") id: string,
    @Body() dto: RecordAttendanceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.recordAttendance(id, dto, user);
  }

  /* ---- Traktanden ----------------------------------------------------- */

  @Post(":id/agenda")
  @RequirePermissions("meeting.update")
  addAgendaItem(
    @Param("id") id: string,
    @Body() dto: AddAgendaItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.addAgendaItem(id, dto, user);
  }

  @Patch(":id/agenda/:itemId")
  @RequirePermissions("meeting.update")
  updateAgendaItem(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateAgendaItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.updateAgendaItem(id, itemId, dto, user);
  }

  @Delete(":id/agenda/:itemId")
  @RequirePermissions("meeting.update")
  removeAgendaItem(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.removeAgendaItem(id, itemId, user);
  }

  /* ---- Protokoll ------------------------------------------------------ */

  @Post(":id/items")
  @RequirePermissions("meeting.update")
  addItem(
    @Param("id") id: string,
    @Body() dto: AddMeetingItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.addItem(id, dto, user);
  }

  @Patch(":id/items/:itemId")
  @RequirePermissions("meeting.update")
  updateItem(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateMeetingItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.updateItem(id, itemId, dto, user);
  }

  @Delete(":id/items/:itemId")
  @RequirePermissions("meeting.update")
  removeItem(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.removeItem(id, itemId, user);
  }

  /** `PUT`, because an order is a state. The whole protocol or nothing. */
  @Put(":id/items/order")
  @RequirePermissions("meeting.update")
  reorderItems(
    @Param("id") id: string,
    @Body() dto: ReorderItemsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.reorderItems(id, dto, user);
  }

  /* ---- Genehmigung und Versand ---------------------------------------- */

  /**
   * Approving the minutes — the act that closes the record.
   *
   * Its own permission, and it is not "may edit more": it is "may decide that
   * this is what was said". After it, the protocol is closed to everybody.
   */
  @Post(":id/approval")
  @RequirePermissions("meeting.approve")
  approve(
    @Param("id") id: string,
    @Body() dto: ApproveMinutesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.approve(id, dto, user);
  }

  /** Outward-facing, so its own key: this puts a document in front of the client. */
  @Post(":id/minutes/sent")
  @RequirePermissions("meeting.sendMinutes")
  sendMinutes(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.meetings.sendMinutes(id, user);
  }

  /* ---- Versionsverlauf ------------------------------------------------ */

  /**
   * `meeting.read` and not a permission of its own: a version history is the
   * record's own contents over time, so anyone who may read the record may read
   * what it used to say. The row-level rules still apply — `history` goes
   * through the same `require`.
   */
  @Get(":id/versions")
  @RequirePermissions("meeting.read")
  history(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.meetings.history(id, user);
  }

  @Get(":id/versions/:version")
  @RequirePermissions("meeting.read")
  versionAt(
    @Param("id") id: string,
    @Param("version") version: string,
    @CurrentUser() user: AuthUser,
  ) {
    const n = Number(version);
    if (!Number.isInteger(n) || n < 1) {
      throw new BadRequestException(`„${version}“ ist keine Versionsnummer.`);
    }
    return this.meetings.versionAt(id, n, user);
  }
}

/**
 * Entscheide, on their own controller.
 *
 * **A decision outlives the meeting that recorded it**, and the routes say so:
 * `/decisions` is a top-level resource found by number, by Gewerk and by what
 * it cost, months later. Nesting it under `/meetings/:id/decisions` would make
 * the URL claim the opposite — and would make "every decision on this project"
 * a route that does not exist.
 *
 * One service behind two controllers, for the reason `meetings.repository.ts`
 * gives: the interesting writes touch both aggregates.
 */
@Controller("decisions")
export class DecisionsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  @RequirePermissions("decision.read")
  list(@ListQuery() query: RawListQuery, @CurrentUser() user: AuthUser) {
    return this.meetings.listDecisions(query, user);
  }

  @Get("stats")
  @RequirePermissions("decision.read")
  stats(@CurrentUser() user: AuthUser) {
    return this.meetings.decisionStats(user);
  }

  @Get("export")
  @RequirePermissions("decision.export")
  async export(
    @ListQuery() query: RawListQuery,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const rows = await this.meetings.exportDecisionRows(query, user);
    sendCsv(res, rows, ["Nummer", "Entscheid"], "entscheide");
  }

  @Post()
  @RequirePermissions("decision.create")
  create(@Body() dto: CreateDecisionDto, @CurrentUser() user: AuthUser) {
    return this.meetings.createDecision(dto, user);
  }

  @Get(":id")
  @RequirePermissions("decision.read")
  detail(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.meetings.decision(id, user);
  }

  @Patch(":id")
  @RequirePermissions("decision.update")
  update(@Param("id") id: string, @Body() dto: UpdateDecisionDto, @CurrentUser() user: AuthUser) {
    return this.meetings.updateDecision(id, dto, user);
  }

  @Put(":id/status")
  @RequirePermissions("decision.update")
  changeStatus(
    @Param("id") id: string,
    @Body() dto: ChangeDecisionStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.changeDecisionStatus(id, dto, user);
  }

  /**
   * Reversing a decision, sent to the **new** one and naming the old.
   *
   * `decision.supersede`, not `decision.update` — `docs/permissions.md` §3.11:
   * *"`update` is corrections; reversing a decision is its own authority."*
   */
  @Post(":id/supersedes")
  @RequirePermissions("decision.supersede")
  supersede(
    @Param("id") id: string,
    @Body() dto: SupersedeDecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.supersede(id, dto, user);
  }

  @Delete(":id")
  @RequirePermissions("decision.delete")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.meetings.removeDecision(id, user);
  }

  @Get(":id/versions")
  @RequirePermissions("decision.read")
  history(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.meetings.decisionHistory(id, user);
  }
}

/**
 * One CSV, written the same way in both controllers.
 *
 * The leading apostrophe on `=`, `+`, `-` and `@` is not formatting — it is
 * what stops Excel treating a meeting title or a decision's rationale as a
 * formula. A field beginning `=` is executed on open.
 */
function sendCsv(
  res: Response,
  rows: Record<string, string>[],
  fallbackHeaders: string[],
  name: string,
): void {
  const headers = rows.length ? Object.keys(rows[0]) : fallbackHeaders;
  const csv = [
    headers.join(";"),
    ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(";")),
  ].join("\r\n");

  res
    .status(200)
    .set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    })
    .send("﻿" + csv);
}

function csvCell(value: string): string {
  const escaped = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${escaped.replace(/"/g, '""')}"`;
}
