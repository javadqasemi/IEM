import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { WorkflowState } from "@prisma/client";
import {
  Allow,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { ContentService } from "./content.service";
import {
  ClientIp,
  CurrentUser,
  Public,
  RequirePermissions,
  type AuthUser,
  type AuthedRequest,
} from "../common/decorators";

/* ---- DTOs -------------------------------------------------------- */

/**
 * `@Allow()` on `data` is load-bearing on both DTOs below.
 *
 * The global pipe runs with `whitelist: true`, which strips every property that
 * carries no class-validator decorator. Undecorated, `data` was removed from
 * the body before the service saw it, and **every save failed** — with a
 * message about the *downstream* content validator complaining that required
 * fields were missing, which points at the editor's input rather than at the
 * request that never carried it.
 *
 * It cannot be a real validator: `data` is an entry of an arbitrary content
 * type, and its shape is checked against `ContentType.schema` by
 * `validateEntry` in the service, which is the only thing that knows what shape
 * to expect. `@Allow` is the decorator whose whole purpose is surviving the
 * whitelist without asserting anything.
 *
 * The same trap caught the settings DTO — see the note there and
 * `settings.dto.test.ts`, which is the shape of the test this pair wants too.
 */
export class CreateEntryDto {
  @IsString() typeKey!: string;
  @IsOptional() @IsString() @MaxLength(120) key?: string;
  @Allow() data!: unknown;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

export class UpdateEntryDto {
  @Allow() data!: unknown;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * Takes an entry off the site, or puts it back.
 *
 * `@IsBoolean` and not `@IsOptional`: "hide it" and "show it" are the same call
 * with different values, so an absent flag is a malformed request rather than a
 * default. Sending `false` is how an entry comes back, and a stripped or
 * defaulted `false` would be indistinguishable from "no change".
 */
export class VisibilityDto {
  @IsBoolean() hidden!: boolean;
}

export class ReorderDto {
  @IsString() typeKey!: string;
  @IsArray() @IsString({ each: true }) ids!: string[];
}

export class SubmitDto {
  @IsOptional() @IsString() @MaxLength(1000) message?: string;
}

export class DecisionDto {
  @IsIn(["APPROVED", "REJECTED"]) decision!: "APPROVED" | "REJECTED";
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class PublishDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ListQuery {
  @IsOptional() @IsString() typeKey?: string;
  @IsOptional() @IsIn(Object.values(WorkflowState)) status?: WorkflowState;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) perPage?: number;
}

/* ---- Controller -------------------------------------------------- */

@Controller("content")
export class ContentController {
  constructor(private readonly content: ContentService) {}

  private ctx(req: AuthedRequest, ip: string | null) {
    return { ip, userAgent: req.headers["user-agent"] ?? null };
  }

  /* ---- The public endpoint ------------------------------------- */

  /**
   * The live site document.
   *
   * The **only** unauthenticated route in the CMS, and the one the public site
   * calls on every page load. It serves a single stored row: no joins, no
   * per-collection queries, and nothing an editor is working on.
   */
  @Public()
  @Get("published")
  published() {
    return this.content.published();
  }

  /* ---- Types --------------------------------------------------- */

  @Get("types")
  @RequirePermissions("contentType.read")
  listTypes() {
    return this.content.listTypes();
  }

  @Get("types/:key")
  @RequirePermissions("contentType.read")
  getType(@Param("key") key: string) {
    return this.content.getType(key);
  }

  /* ---- Entries ------------------------------------------------- */

  @Get("entries")
  @RequirePermissions("content.read")
  list(@Query() query: ListQuery) {
    return this.content.listEntries(query);
  }

  @Get("entries/:id")
  @RequirePermissions("content.read")
  get(@Param("id") id: string) {
    return this.content.getEntry(id);
  }

  @Post("entries")
  @RequirePermissions("content.create")
  create(
    @Body() dto: CreateEntryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.content.createEntry(dto, user, this.ctx(req, ip));
  }

  @Patch("entries/:id")
  @RequirePermissions("content.update")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateEntryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.content.updateEntry(id, dto, user, this.ctx(req, ip));
  }

  @Delete("entries/:id")
  @HttpCode(204)
  @RequirePermissions("content.delete")
  remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.content.deleteEntry(id, user, this.ctx(req, ip));
  }

  /**
   * Takes one entry off the site, or puts it back.
   *
   * A **draft change like any other**: the entry stays on the live site until
   * the next publish, and `GET /content/pending` reports it because that
   * compares built documents rather than counting approved rows.
   *
   * `content.update` rather than a permission of its own. Hiding is an
   * editorial act on an entry the holder may already edit outright, and a
   * separate key would be one more thing to grant that grants nothing anyone
   * lacks — the catalogue already has twelve of those.
   */
  @Patch("entries/:id/visibility")
  @RequirePermissions("content.update")
  setVisibility(
    @Param("id") id: string,
    @Body() dto: VisibilityDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.content.setEntryHidden(id, dto.hidden, user, this.ctx(req, ip));
  }

  @Post("entries/:id/restore")
  @RequirePermissions("content.archive")
  restore(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.content.restoreEntry(id, user, this.ctx(req, ip));
  }

  @Post("entries/:id/duplicate")
  @RequirePermissions("content.duplicate")
  duplicate(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.content.duplicateEntry(id, user, this.ctx(req, ip));
  }

  @Post("entries/reorder")
  @HttpCode(204)
  @RequirePermissions("content.reorder")
  reorder(
    @Body() dto: ReorderDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.content.reorder(dto.typeKey, dto.ids, user, this.ctx(req, ip));
  }

  /* ---- Versions ------------------------------------------------ */

  @Get("entries/:id/versions")
  @RequirePermissions("content.history")
  versions(@Param("id") id: string) {
    return this.content.listVersions(id);
  }

  @Get("entries/:id/diff")
  @RequirePermissions("content.history")
  diff(
    @Param("id") id: string,
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    return this.content.diff(id, Number(from), Number(to));
  }

  @Post("entries/:id/rollback/:version")
  @RequirePermissions("content.rollback")
  rollback(
    @Param("id") id: string,
    @Param("version") version: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.content.rollback(id, Number(version), user, this.ctx(req, ip));
  }

  /* ---- Workflow ------------------------------------------------ */

  /*
    These three take no `@Req` and no `@ClientIp` any more.

    They publish domain events rather than writing audit rows by hand, and
    `AuditListener` reads the IP and the user agent from the request context
    — so the two parameters were being collected, passed down two layers and
    read by nobody. See the note on `ContentService.submitForReview`.
  */
  @Post("entries/:id/submit")
  @HttpCode(204)
  @RequirePermissions("content.submit")
  submit(
    @Param("id") id: string,
    @Body() dto: SubmitDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.content.submitForReview(id, dto.message, user);
  }

  @Get("reviews")
  @RequirePermissions("content.read")
  reviews() {
    return this.content.listPendingReviews();
  }

  @Post("reviews/:id/decide")
  @HttpCode(204)
  @RequirePermissions("content.approve")
  decide(
    @Param("id") id: string,
    @Body() dto: DecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.content.decideReview(id, dto.decision, dto.note, user);
  }

  /* ---- Publishing ---------------------------------------------- */

  @Post("publish")
  @RequirePermissions("content.publish")
  publish(@Body() dto: PublishDto, @CurrentUser() user: AuthUser) {
    return this.content.publish(dto.note, user);
  }

  /**
   * What publishing now would change on the live site, and where.
   *
   * `content.read` rather than `content.publish`: this is the question "is the
   * site up to date?", which anyone working on the content has a reason to ask
   * and which the dashboard shows on the publish screen to people who cannot
   * press the button.
   *
   * It exists because counting `APPROVED` entries is not the same question and
   * gets it wrong in a way that matters. A deletion never reaches `APPROVED` —
   * the row is marked deleted and its status left alone — and neither does a
   * reordering or a hide, so the publish screen reported "nothing is approved"
   * and disabled its own button while a deleted team member was still live on
   * the site. This compares the stored document against the one the next
   * publish would build, which catches all four.
   */
  @Get("pending")
  @RequirePermissions("content.read")
  pending() {
    return this.content.pendingChanges();
  }

  /** The draft document, for the dashboard's live preview of the real page. */
  @Get("preview")
  @RequirePermissions("content.preview")
  preview() {
    return this.content.preview();
  }

  @Get("snapshots")
  @RequirePermissions("content.history")
  snapshots() {
    return this.content.listSnapshots();
  }

  @Post("snapshots/:version/restore")
  @RequirePermissions("content.rollback", "content.publish")
  restoreSnapshot(
    @Param("version") version: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.content.restoreSnapshot(Number(version), user, this.ctx(req, ip));
  }
}
