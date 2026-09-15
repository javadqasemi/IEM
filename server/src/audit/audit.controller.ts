import { Controller, Get, Query, Res } from "@nestjs/common";
import { AuditOutcome, Prisma } from "@prisma/client";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Min } from "class-validator";
import type { Response } from "express";
import { PrismaService } from "../common/prisma.service";
import { RequirePermissions } from "../common/decorators";

export class AuditQuery {
  @IsOptional() @IsString() actorId?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() resource?: string;
  @IsOptional() @IsString() resourceId?: string;
  @IsOptional() @IsIn(Object.values(AuditOutcome)) outcome?: AuditOutcome;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) perPage?: number;
}

/**
 * Read-only by construction.
 *
 * There is no create, update or delete route here and there is not meant to
 * be: rows are written by `AuditService` from inside the services that perform
 * the actions, and a log that the application can edit is not evidence of
 * anything. Retention is a database job, not an API call.
 */
@Controller("audit")
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  private where(q: AuditQuery): Prisma.AuditLogWhereInput {
    return {
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { contains: q.action } } : {}),
      ...(q.resource ? { resource: q.resource } : {}),
      ...(q.resourceId ? { resourceId: q.resourceId } : {}),
      ...(q.outcome ? { outcome: q.outcome } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { actorEmail: { contains: q.search, mode: "insensitive" } },
              { message: { contains: q.search, mode: "insensitive" } },
              { action: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
  }

  @Get()
  @RequirePermissions("audit.read")
  async list(@Query() q: AuditQuery) {
    const page = Math.max(1, q.page ?? 1);
    const perPage = Math.min(200, Math.max(1, q.perPage ?? 50));
    const where = this.where(q);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
  }

  /** The distinct actions present, so the filter offers real values. */
  @Get("actions")
  @RequirePermissions("audit.read")
  async actions() {
    const rows = await this.prisma.auditLog.groupBy({ by: ["action"], _count: true });
    return rows
      .map((r) => ({ action: r.action, count: r._count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * CSV export.
   *
   * Streamed in pages rather than loaded whole: an audit log is the one table
   * here that grows without bound, and `findMany` on a year of it would hold
   * the lot in memory before the first byte reached the client.
   */
  @Get("export")
  @RequirePermissions("audit.export")
  async export(@Query() q: AuditQuery, @Res() res: Response) {
    const where = this.where(q);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    // BOM, so Excel on Windows reads the umlauts as UTF-8 rather than as
    // mojibake — the default there is still the ANSI codepage.
    res.write("﻿");
    res.write("Zeitpunkt;Benutzer;Aktion;Objekt;Objekt-ID;Ergebnis;IP;Meldung\n");

    const pageSize = 500;
    for (let skip = 0; ; skip += pageSize) {
      const rows = await this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      });
      if (!rows.length) break;
      for (const r of rows) {
        res.write(
          [
            r.createdAt.toISOString(),
            r.actorEmail ?? "",
            r.action,
            r.resource,
            r.resourceId ?? "",
            r.outcome,
            r.ip ?? "",
            r.message ?? "",
          ]
            .map(csv)
            .join(";") + "\n",
        );
      }
      if (rows.length < pageSize) break;
    }
    res.end();
  }
}

/**
 * Quotes a CSV cell.
 *
 * The leading-character guard is not cosmetic: a cell beginning `=`, `+`, `-`
 * or `@` is executed as a formula when the file is opened in Excel, and this
 * log contains attacker-influenced strings (user agents, email addresses from
 * failed sign-ins). Prefixing an apostrophe neutralises that.
 */
function csv(value: string): string {
  const v = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${v.replace(/"/g, '""')}"`;
}
