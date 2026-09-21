import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";
import type { Response } from "express";
import {
  BackupArtifactKind,
  BackupStatus,
  BackupTrigger,
  BackupType,
  RestoreMode,
} from "@prisma/client";
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthUser,
  type AuthedRequest,
} from "../common/decorators";
import { AuditService } from "../core/audit/audit.service";
import { ReauthService } from "../auth/reauth.service";
import { BackupService } from "../core/backup/backup.service";
import { RestoreService } from "../core/backup/restore.service";
import { MaintenanceService } from "../core/backup/maintenance.service";
import { BackupStatusService } from "../core/backup/backup.status.service";

/* ---- DTOs -------------------------------------------------------- */
/*
  Every field carries a decorator, including the booleans. `whitelist: true`
  strips a property with none — it does not reject it, it makes it **vanish** —
  and the trap is recorded twice in CLAUDE.md against the content and settings
  DTOs. On this module the field that would vanish is `confirmation`, which is
  the one standing between a click and a replaced database.
*/

export class CreateBackupDto {
  @IsIn(Object.values(BackupType)) type!: BackupType;
}

export class ProtectBackupDto {
  @IsBoolean() protected!: boolean;
}

export class RestoreDto {
  @IsIn(Object.values(RestoreMode)) mode!: RestoreMode;

  /**
   * The typed word. Validated here *and* in `refuseConfirmation`.
   *
   * Twice on purpose: the decorator keeps an empty body from reaching the
   * service, and the rule is what the service is tested against. A DTO-only
   * check would be a guard that the unit suite cannot see.
   */
  @IsString() @MaxLength(64) confirmation!: string;

  /**
   * The re-authentication window, in the **body**.
   *
   * Not a header, for the reason `ReauthService` records: a custom header
   * would mean widening `allowedHeaders` in `main.ts` for one feature.
   */
  @IsString() @MaxLength(256) reauthToken!: string;
}

export class ListBackupsQuery {
  @IsOptional() @IsIn(Object.values(BackupStatus)) status?: BackupStatus;
  @IsOptional() @IsIn(Object.values(BackupType)) type?: BackupType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage?: number;
}

/* ---- Controller -------------------------------------------------- */

/**
 * Backups and restores over HTTP.
 *
 * ---
 *
 * ## Two permissions, and the line between them
 *
 * `system.backup` opens everything that adds or inspects a recovery point.
 * **`system.restore` opens the two operations that hand over the production
 * data** — applying a backup, and downloading one. Splitting them is the
 * brief's own requirement and the reason is worth restating: an operator who
 * checks nightly backups is a different person from the one who may roll the
 * firm back to last Tuesday.
 *
 * ## Nothing here does the work
 *
 * Every write enqueues and returns. A `pg_dump` inside a request is a request
 * that times out on a database worth backing up, and the screen would have
 * nothing to poll.
 */
@Controller("backups")
export class BackupController {
  constructor(
    private readonly backups: BackupService,
    private readonly restores: RestoreService,
    private readonly status: BackupStatusService,
    private readonly maintenance: MaintenanceService,
    private readonly reauth: ReauthService,
    private readonly audit: AuditService,
  ) {}

  /* ---- Reading --------------------------------------------------- */

  /**
   * The operational picture. `system.backup` — it discloses no data, only
   * whether there is any and whether it is healthy.
   */
  @Get("status")
  @RequirePermissions("system.backup")
  overview() {
    return this.status.status();
  }

  @Get()
  @RequirePermissions("system.backup")
  list(@Query() query: ListBackupsQuery) {
    return this.backups.list(query);
  }

  /** Whether this backup could be restored, and why not where it could not. */
  @Get(":id/restorability")
  @RequirePermissions("system.backup")
  restorability(@Param("id") id: string) {
    return this.restores.assess(id);
  }

  @Get("retention/preview")
  @RequirePermissions("system.backup")
  retentionPreview() {
    return this.backups.previewRetention();
  }

  /* ---- Creating --------------------------------------------------- */

  /**
   * Queues a backup and answers immediately.
   *
   * Throttled **per minute, not per hour**, and the window matters more than
   * the number.
   *
   * It was six an hour, which expressed the wrong thing. What this limit
   * exists to stop is a runaway button — a double-click, a retry loop, a
   * script — filling the disk in seconds. That is a *rate* problem and a
   * per-minute ceiling answers it exactly. A per-hour budget additionally
   * punishes legitimate work spread across an afternoon: an operator taking a
   * backup before each of several risky changes is doing precisely what this
   * feature is for, and being refused on the seventh is the tool arguing with
   * them.
   *
   * It also made the suite unrunnable. `e2e/backup.spec.ts` creates a backup,
   * and a budget that does not reset for an hour meant the second run of the
   * day failed on a rate limit rather than on anything it was testing — and a
   * test that cannot be run twice is a test people stop running.
   *
   * What actually prevents the dangerous cases is elsewhere and is exact:
   * `refuseConcurrent` for overlapping operations, and `assertCapacity` for
   * the disk.
   */
  @Post()
  @RequirePermissions("system.backup")
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async create(@Body() dto: CreateBackupDto, @CurrentUser() user: AuthUser) {
    const conflict = await this.restores.runningOperations();
    if (conflict.includes("RESTORE")) {
      throw new BadRequestException(
        "Während einer Wiederherstellung kann keine Sicherung erstellt werden.",
      );
    }
    return this.backups.request({
      type: dto.type,
      trigger: BackupTrigger.MANUAL,
      actor: user,
    });
  }

  @Post(":id/protect")
  @RequirePermissions("system.backup")
  protect(
    @Param("id") id: string,
    @Body() dto: ProtectBackupDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.backups.setProtected(id, dto.protected, user, {
      ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
  }

  @Delete(":id")
  @RequirePermissions("system.backup")
  remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.backups.remove(id, user, {
      ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
  }

  /* ---- The dangerous half ----------------------------------------- */

  /**
   * Restores a backup — a drill, or over the live database.
   *
   * Four gates, and none of them is redundant:
   *
   * 1. **`system.restore`**, which is not `system.backup`;
   * 2. **a re-authentication window**, so an unlocked laptop at a shared desk
   *    is not a way to roll the firm back — the same control MFA disable and
   *    the administrative reset use, and deliberately the same service rather
   *    than a second one;
   * 3. **a typed word**, which cannot be produced by selecting the thing on
   *    screen the way a pasted id can;
   * 4. **the artifact's own fitness**, which `refuseRestore` decides and no
   *    permission can.
   *
   * Throttled per minute, for the reason the create route is and one more.
   *
   * `ThrottlerGuard` counts every request **including the refused ones**, and
   * on this route the refusals are the common case — a mistyped confirmation,
   * an expired re-authentication window, a backup that turns out not to be
   * verified. A tight per-hour budget therefore meant an operator who fumbled
   * the word twice had no attempts left for the real one, in the middle of an
   * incident. That is the opposite of what a safety control should do.
   *
   * What actually prevents two overlapping restores is `refuseConcurrent`,
   * which asks what is in flight and is exact. This is defence-in-depth
   * against hammering, not the control.
   */
  @Post(":id/restore")
  @RequirePermissions("system.restore")
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async restore(
    @Param("id") id: string,
    @Body() dto: RestoreDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
  ) {
    await this.reauth.require(user.id, dto.reauthToken);

    return this.restores.request({
      backupRunId: id,
      mode: dto.mode,
      confirmation: dto.confirmation,
      actor: user,
      ctx: { ip, userAgent: req.headers["user-agent"] ?? null },
    });
  }

  @Get("restores")
  @RequirePermissions("system.backup")
  restoreHistory() {
    return this.restores.history();
  }

  /**
   * Streams one artifact.
   *
   * **`system.restore`, not `system.backup`** — the archive is the whole
   * database and every applicant dossier, so downloading it and restoring it
   * disclose the same thing.
   *
   * `@Res()` without `passthrough`, which bypasses `EnvelopeInterceptor`
   * entirely — the convention `/audit/export` and the dossier download already
   * follow. `Content-Disposition` is **omitted** and the type is
   * `application/octet-stream`, which is the workaround CLAUDE.md records for
   * the Chromium 153 fetch bug: the header plus a binary body reports
   * `MissingAllowOriginHeader` and, same-origin, a 204 with no body.
   */
  @Get(":id/artifacts/:kind/download")
  @RequirePermissions("system.restore")
  async download(
    @Param("id") id: string,
    @Param("kind") kind: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @ClientIp() ip: string | null,
    @Res() res: Response,
  ) {
    /*
      The kind is checked against the enum **before** it reaches Prisma.

      There is no filename parameter anywhere in this route, so there is
      nothing to traverse — the storage key comes from the row, and
      `LocalBackupStorage.pathFor` refuses one that escapes the root even then.
      What the first version got wrong was narrower and still real: it cast the
      segment with `as BackupArtifactKind` and handed it straight to a `where`,
      so `../../etc/passwd` reached Prisma as an invalid enum value and came
      back a **500**. A traversal attempt answering 500 rather than 400 is a
      probe that has learned the route exists and is reachable, and
      `e2e/backup.spec.ts` is what caught it.
    */
    if (!Object.values(BackupArtifactKind).includes(kind as BackupArtifactKind)) {
      throw new BadRequestException(`Unbekannte Artefaktart „${kind}“.`);
    }

    const artifact = await this.backups.artifactFor(id, kind as BackupArtifactKind);
    if (!artifact) throw new NotFoundException("Diese Datei gibt es nicht.");

    this.audit.record({
      actor: user,
      action: "backup.downloaded",
      resource: "backup_run",
      resourceId: id,
      after: { kind: artifact.kind, sizeBytes: Number(artifact.sizeBytes) },
      message: `Sicherungsdatei (${artifact.kind}) heruntergeladen.`,
      ip,
      userAgent: req.headers["user-agent"] ?? null,
    });

    const stream = await this.status.readArtifact(artifact.storageKey);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", String(artifact.sizeBytes));
    stream.pipe(res);
  }

  /** Whether writes are currently refused, and why. Read by the shell. */
  @Get("maintenance")
  @RequirePermissions("system.backup")
  maintenanceStatus() {
    return this.maintenance.status();
  }
}

