import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { sendCsv } from "../common/csv";
import { CurrentUser, RequirePermissions, type AuthUser } from "../common/decorators";
import { ListQuery, type RawListQuery } from "../core/list/list.decorator";
import {
  AcknowledgeDto,
  ChangeDrawingStatusDto,
  CreateDrawingDto,
  CreateRevisionDto,
  CreateTransmittalDto,
  UpdateDrawingDto,
} from "./drawings.dto";
import { DrawingsService } from "./drawings.service";

/**
 * HTTP, DTOs and guards. No rules, no queries.
 *
 * **Route order is load-bearing.** `@Get("stats")`, `@Get("export")` and
 * `@Get("revisions")` are declared before `@Get(":id")`, because Nest matches in
 * declaration order and `:id` would otherwise swallow all three — producing a
 * 404 for a plan called "stats" rather than the statistics.
 *
 * **Four keys beyond CRUD, and each is a different person's authority.**
 * `check` says somebody other than the draftsman has looked at it, `release` is
 * internal sign-off, `issue` puts the plan in a contractor's hands, and
 * `withdraw` says it is wrong. `drawing.update` answers none of them.
 *
 * `drawing.readAll` appears on no route — it is a widening grant read by
 * `drawings.scope.ts`, not a second gate.
 *
 * ---
 *
 * **`PUT :id/status` carries three different permissions**, chosen from the
 * *target* status rather than declared once. `@RequirePermissions` is **AND**,
 * so naming all three on the route would demand a caller hold every one of
 * them — which would lock out the engineer who may check and release but not
 * issue. The check is therefore inside the handler, which is the documented
 * `◐` pattern from `docs/permissions.md` §4, and
 * `permissions.agreement.test.ts` counts a `permissions.has(...)` there as
 * enforcement.
 */
@Controller("drawings")
export class DrawingsController {
  constructor(private readonly drawings: DrawingsService) {}

  @Get()
  @RequirePermissions("drawing.read")
  list(@ListQuery() query: RawListQuery, @CurrentUser() user: AuthUser) {
    return this.drawings.list(query, user);
  }

  @Get("stats")
  @RequirePermissions("drawing.read")
  stats(@CurrentUser() user: AuthUser) {
    return this.drawings.stats(user);
  }

  /**
   * Revisions across every plan the caller may see.
   *
   * *"Was ist diese Woche freigegeben worden"* and *"welche Revisionen gingen
   * wegen eines Fehlers raus"* — neither is answerable from a list nested under
   * one drawing, which is why this is its own endpoint rather than
   * `:id/revisions`.
   */
  @Get("revisions")
  @RequirePermissions("drawing.read")
  revisions(@ListQuery() query: RawListQuery, @CurrentUser() user: AuthUser) {
    return this.drawings.listRevisions(query, user);
  }

  /**
   * CSV, with the same filters the list took.
   *
   * `@Res()` **without** `passthrough`, which bypasses `EnvelopeInterceptor` —
   * a CSV wrapped in `{ data: … }` is not a CSV.
   */
  @Get("export")
  @RequirePermissions("drawing.export")
  async export(
    @ListQuery() query: RawListQuery,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const rows = await this.drawings.exportRows(query, user);
    sendCsv(res, rows, ["Nummer", "Titel", "Status", "Revision"], "plaene");
  }

  @Get(":id")
  @RequirePermissions("drawing.read")
  detail(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.drawings.detail(id, user);
  }

  @Get(":id/versions")
  @RequirePermissions("drawing.read")
  history(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    // With the caller: the history is read through `require()` (SEC-R6).
    return this.drawings.history(id, user);
  }

  @Post()
  @RequirePermissions("drawing.create")
  create(@Body() dto: CreateDrawingDto, @CurrentUser() user: AuthUser) {
    return this.drawings.create(dto, user);
  }

  @Patch(":id")
  @RequirePermissions("drawing.update")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateDrawingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.drawings.update(id, dto, user);
  }

  /**
   * The status change, behind whichever key the *target* demands.
   *
   * See the note at the top of this class: the permission depends on a value in
   * the body, which a route decorator cannot express without becoming an AND of
   * all of them.
   */
  @Put(":id/status")
  @RequirePermissions("drawing.read")
  changeStatus(
    @Param("id") id: string,
    @Body() dto: ChangeDrawingStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    const gate = statusGate(user, dto.status);

    if (!user.isSuperAdmin && !gate.granted) {
      // The key by name, because "keine Berechtigung" sends somebody to ask an
      // administrator which one.
      throw new ForbiddenException(`Dafür fehlt die Berechtigung „${gate.key}“.`);
    }

    return this.drawings.changeStatus(id, dto, user);
  }

  /**
   * A new revision.
   *
   * `drawing.create` rather than `drawing.update`: uploading a revision is
   * making a new artefact, not editing the record that describes it. The person
   * who draws holds `create`; the person who corrects a title holds `update`,
   * and they are frequently not the same.
   */
  @Post(":id/revisions")
  @RequirePermissions("drawing.create")
  createRevision(
    @Param("id") id: string,
    @Body() dto: CreateRevisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.drawings.createRevision(id, dto, user);
  }

  @Delete(":id")
  @RequirePermissions("drawing.delete")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.drawings.remove(id, user);
  }
}

/**
 * Planversand, at its own path.
 *
 * A separate controller rather than routes under `/drawings`, because a
 * transmittal is found by its own number months later and nesting it would make
 * its URL depend on a plan it happens to contain several of.
 *
 * **There is no `PATCH` and no `DELETE`, and the absence is the design.** A
 * Planversand is a statement about the past; correcting one means issuing
 * another, the same reason `AuditLog` has no route to edit a row. Enforcing it
 * by there being no endpoint is the cheapest enforcement there is —
 * `architecture.test.ts` checks the same property for the audit log.
 */
@Controller("transmittals")
export class TransmittalsController {
  constructor(private readonly drawings: DrawingsService) {}

  @Get()
  @RequirePermissions("transmittal.read")
  list(@ListQuery() query: RawListQuery, @CurrentUser() user: AuthUser) {
    return this.drawings.listTransmittals(query, user);
  }

  @Get("export")
  @RequirePermissions("transmittal.export")
  async export(
    @ListQuery() query: RawListQuery,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const rows = await this.drawings.exportTransmittalRows(query, user);
    sendCsv(res, rows, ["Nummer", "Projekt", "Versandt"], "planversand");
  }

  @Get(":id")
  @RequirePermissions("transmittal.read")
  detail(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.drawings.transmittalDetail(id, user);
  }

  /**
   * Issuing plans.
   *
   * Two permissions would be the honest declaration — `transmittal.create` and
   * `drawing.issue` — and here the AND is exactly right: sending plans is both
   * acts at once, and somebody who may record a Planversand but may not issue a
   * plan should not be able to do it by this route either.
   */
  @Post()
  @RequirePermissions("transmittal.create", "drawing.issue")
  create(@Body() dto: CreateTransmittalDto, @CurrentUser() user: AuthUser) {
    return this.drawings.createTransmittal(dto, user);
  }

  @Post(":id/acknowledge")
  @RequirePermissions("transmittal.acknowledge")
  acknowledge(
    @Param("id") id: string,
    @Body() dto: AcknowledgeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.drawings.acknowledge(id, dto, user);
  }
}

/**
 * Which key a status change needs, and whether this caller holds it.
 *
 * **Each branch names its key twice, and that is deliberate — do not
 * "simplify" it.** `permissions.agreement.test.ts` finds in-handler checks by
 * scanning for a quoted string *inside* a `permissions.has(...)` call, which is
 * how the `◐` rules in `docs/permissions.md` §4 are counted as enforcement. The
 * first version of this function looked the obvious way up —
 *
 * ```ts
 * const needed = dto.status === "CHECKED" ? "drawing.check" : …;
 * if (!user.permissions.has(needed)) …
 * ```
 *
 * — and the agreement test reported `drawing.check`, `drawing.release` and
 * `drawing.withdraw` as **guarding no route at all**, because no literal
 * appears inside `has(`. They were enforced; the test could not see it, and the
 * honest repair is to be visible rather than to add three entries to
 * `KNOWN_UNENFORCED` describing a problem that does not exist.
 *
 * The key is returned as well as the verdict so the refusal can name it.
 */
function statusGate(user: AuthUser, status: string): { key: string; granted: boolean } {
  switch (status) {
    case "CHECKED":
      return { key: "drawing.check", granted: user.permissions.has("drawing.check") };
    case "RELEASED":
      return { key: "drawing.release", granted: user.permissions.has("drawing.release") };
    case "WITHDRAWN":
      return { key: "drawing.withdraw", granted: user.permissions.has("drawing.withdraw") };
    default:
      return { key: "drawing.update", granted: user.permissions.has("drawing.update") };
  }
}
