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
  Res,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { ApplicationStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
import type { Response } from "express";
import { ApplicationsService } from "./applications.service";
import {
  ClientIp,
  CurrentUser,
  Public,
  RequirePermissions,
  type AuthUser,
  type AuthedRequest,
} from "../common/decorators";

export class UpdateApplicationDto {
  @IsOptional() @IsIn(Object.values(ApplicationStatus)) status?: ApplicationStatus;
  @IsOptional() @IsString() @MaxLength(4000) note?: string;
}

export class ListApplicationsQuery {
  @IsOptional() @IsIn(Object.values(ApplicationStatus)) status?: ApplicationStatus;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) perPage?: number;
}

@Controller("applications")
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  private ctx(req: AuthedRequest, ip: string | null) {
    return { ip, userAgent: req.headers["user-agent"] ?? null };
  }

  /**
   * The site's application form posts here.
   *
   * Public, because an applicant has no account — which makes it the one
   * write endpoint in the system reachable without authentication, and
   * therefore the one that needs its own defences: a rate limit per IP, a
   * honeypot field, hard caps on count and size enforced by Multer before the
   * body is buffered, and magic-byte checks in the service.
   *
   * Field names match `BewerbungDialog` exactly (`dateien` for the files), so
   * the site needs no change beyond setting `VITE_BEWERBUNG_ENDPOINT`.
   */
  @Public()
  @Post()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @UseInterceptors(
    FilesInterceptor("dateien", 5, { limits: { fileSize: 10 * 1024 * 1024, files: 5 } }),
  )
  async submit(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: Record<string, string>,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    // Honeypot. A field no human sees and no real browser fills; a bot that
    // completes every input trips it. Answering 202 rather than an error means
    // the bot cannot learn what gave it away.
    if (body.website || body.url_) {
      return { id: null, received: 0, skipped: 0 };
    }
    return this.applications.receive(body, files ?? [], this.ctx(req, ip));
  }

  /* ---- Administration -------------------------------------------- */

  @Get()
  @RequirePermissions("application.read")
  list(@Query() query: ListApplicationsQuery) {
    return this.applications.list(query);
  }

  @Get("stats")
  @RequirePermissions("application.read")
  stats() {
    return this.applications.stats();
  }

  @Get(":id")
  @RequirePermissions("application.read")
  get(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.applications.get(id, user, this.ctx(req, ip));
  }

  @Patch(":id")
  @RequirePermissions("application.update")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateApplicationDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.applications.update(id, dto, user, this.ctx(req, ip));
  }

  @Get(":id/files/:index")
  @RequirePermissions("application.download")
  async download(
    @Param("id") id: string,
    @Param("index") index: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
    @Res() res: Response,
  ) {
    const { file, stream } = await this.applications.file(
      id,
      Number(index),
      user,
      this.ctx(req, ip),
    );
    // `attachment`, always: a dossier is a PDF or a Word file from an unknown
    // sender, and rendering one inline in the admin's browser is exactly the
    // path this download route exists to avoid.
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    stream.pipe(res);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("application.delete")
  remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.applications.remove(id, user, this.ctx(req, ip));
  }
}
