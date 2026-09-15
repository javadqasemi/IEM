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
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { MediaService } from "./media.service";
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthUser,
  type AuthedRequest,
} from "../common/decorators";

export class UpdateAssetDto {
  @IsOptional() @IsString() @MaxLength(300) alt?: string;
  @IsOptional() @IsBoolean() altDecorative?: boolean;
  @IsOptional() @IsString() @MaxLength(500) caption?: string | null;
  @IsOptional() @IsString() @MaxLength(300) copyright?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() folderId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) filename?: string;
}

export class CreateFolderDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() parentId?: string | null;
}

export class BulkDeleteDto {
  @IsArray() @IsString({ each: true }) ids!: string[];
}

export class ListMediaQuery {
  @IsOptional() @IsString() folderId?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() mimeType?: string;
  @IsOptional() @IsString() tag?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) perPage?: number;
}

@Controller("media")
export class MediaController {
  constructor(private readonly media: MediaService) {}

  private ctx(req: AuthedRequest, ip: string | null) {
    return { ip, userAgent: req.headers["user-agent"] ?? null };
  }

  @Get()
  @RequirePermissions("media.read")
  list(@Query() query: ListMediaQuery) {
    return this.media.list(query);
  }

  @Get("stats")
  @RequirePermissions("media.read")
  stats() {
    return this.media.stats();
  }

  @Get("folders")
  @RequirePermissions("media.read")
  folders() {
    return this.media.listFolders();
  }

  @Post("folders")
  @RequirePermissions("media.folder")
  createFolder(
    @Body() dto: CreateFolderDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.media.createFolder(dto.name, dto.parentId ?? null, user, this.ctx(req, ip));
  }

  @Delete("folders/:id")
  @HttpCode(204)
  @RequirePermissions("media.folder")
  deleteFolder(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.media.deleteFolder(id, user, this.ctx(req, ip));
  }

  @Get(":id")
  @RequirePermissions("media.read")
  get(@Param("id") id: string) {
    return this.media.get(id);
  }

  /**
   * Upload.
   *
   * `memoryStorage` — the default — rather than writing to a temp directory:
   * the service has to hash and re-encode the bytes anyway, so a disk round
   * trip buys nothing, and the 25 MB cap keeps the footprint bounded. Multer's
   * own limit is set here as well as in the service so an oversized body is
   * rejected while it streams rather than after it has all arrived.
   */
  @Post("upload")
  @RequirePermissions("media.upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024 } }))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, string>,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.media.upload(
      file,
      {
        folderId: body.folderId || undefined,
        alt: body.alt,
        altDecorative: body.altDecorative === "true",
        caption: body.caption,
        copyright: body.copyright,
        tags: body.tags ? body.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      },
      user,
      this.ctx(req, ip),
    );
  }

  @Post(":id/replace")
  @RequirePermissions("media.replace")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024 } }))
  replace(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, string>,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.media.replace(id, file, body.note, user, this.ctx(req, ip));
  }

  @Patch(":id")
  @RequirePermissions("media.update")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.media.update(id, dto, user, this.ctx(req, ip));
  }

  @Delete("bulk")
  @HttpCode(204)
  @RequirePermissions("media.delete")
  bulkRemove(
    @Body() dto: BulkDeleteDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.media.bulkRemove(dto.ids, user, this.ctx(req, ip));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("media.delete")
  remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.media.remove(id, user, this.ctx(req, ip));
  }
}
