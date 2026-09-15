import { Controller, Get } from "@nestjs/common";
import { WorkflowState } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { Public, RequirePermissions } from "../common/decorators";
import { PERMISSIONS } from "../rbac/permissions.catalog";
import { CONTENT_TYPES } from "../content/content-types";

/**
 * The executive dashboard's figures, and the system health panel.
 *
 * Everything here is **counted from this database**. There is no analytics
 * integration, so there are no visitor counts, no conversion rates and no
 * revenue — the spec lists them, and inventing plausible-looking numbers for
 * a page whose entire argument is that its figures are checkable would be the
 * worst thing this file could do. The gaps are reported explicitly in
 * `missingMetrics` so the dashboard can say what it does not know rather than
 * showing an empty tile.
 */
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("overview")
  @RequirePermissions("system.health")
  async overview() {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      entriesTotal,
      entriesDraft,
      entriesPending,
      entriesApproved,
      entriesPublished,
      mediaCount,
      mediaBytes,
      users,
      applicationsTotal,
      applicationsNew,
      openings,
      projects,
      team,
      lastSnapshot,
      recentActivity,
      recentEdits,
    ] = await this.prisma.$transaction([
      this.prisma.contentEntry.count({ where: { deletedAt: null } }),
      this.prisma.contentEntry.count({ where: { deletedAt: null, status: WorkflowState.DRAFT } }),
      this.prisma.contentEntry.count({ where: { deletedAt: null, status: WorkflowState.IN_REVIEW } }),
      this.prisma.contentEntry.count({ where: { deletedAt: null, status: WorkflowState.APPROVED } }),
      this.prisma.contentEntry.count({ where: { deletedAt: null, status: WorkflowState.PUBLISHED } }),
      this.prisma.mediaAsset.count({ where: { deletedAt: null } }),
      this.prisma.mediaAsset.aggregate({ where: { deletedAt: null }, _sum: { size: true } }),
      this.prisma.user.count({ where: { deletedAt: null, status: "ACTIVE" } }),
      this.prisma.jobApplication.count(),
      this.prisma.jobApplication.count({ where: { status: "NEW" } }),
      this.prisma.contentEntry.count({ where: { typeKey: "openings", deletedAt: null } }),
      this.prisma.contentEntry.count({ where: { typeKey: "projects", deletedAt: null } }),
      this.prisma.contentEntry.count({ where: { typeKey: "team", deletedAt: null } }),
      this.prisma.contentSnapshot.findFirst({
        orderBy: { version: "desc" },
        select: {
          version: true,
          publishedAt: true,
          note: true,
          publishedBy: { select: { name: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          action: true,
          resource: true,
          resourceId: true,
          actorEmail: true,
          message: true,
          outcome: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      }),
      this.prisma.contentEntry.findMany({
        where: { deletedAt: null, updatedAt: { gte: weekAgo } },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: {
          id: true,
          key: true,
          typeKey: true,
          status: true,
          updatedAt: true,
          updatedBy: { select: { name: true } },
        },
      }),
    ]);

    return {
      kpis: {
        projects,
        team,
        openings,
        applications: applicationsTotal,
        applicationsNew,
        mediaCount,
        mediaBytes: mediaBytes._sum.size ?? 0,
        users,
      },
      content: {
        total: entriesTotal,
        draft: entriesDraft,
        inReview: entriesPending,
        approved: entriesApproved,
        published: entriesPublished,
        /** Entries approved and waiting for someone to press Publish. */
        readyToPublish: entriesApproved,
      },
      lastPublish: lastSnapshot,
      recentActivity,
      recentEdits,
      /**
       * Figures the spec asks for that this system genuinely cannot produce.
       * Named rather than omitted, so the dashboard shows an honest "no data
       * source" tile instead of a zero that reads as a real measurement.
       */
      missingMetrics: [
        { key: "visitors", label: "Website-Besucher", reason: "Keine Analytics-Anbindung konfiguriert." },
        { key: "conversions", label: "Konversionen", reason: "Kein Zielereignis definiert." },
        { key: "revenue", label: "Umsatz", reason: "Keine Anbindung an die Buchhaltung." },
        { key: "customers", label: "Kunden", reason: "Kein CRM angebunden." },
      ],
    };
  }

  /**
   * System health.
   *
   * The catalogue counts are a real check, not decoration: they compare what
   * the code declares against what the database holds, which is how a
   * half-applied seed shows up here rather than as a mysterious 403 later.
   */
  @Get("health")
  @RequirePermissions("system.health")
  async health() {
    const started = Date.now();
    let database: "ok" | "error" = "ok";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "error";
    }
    const latencyMs = Date.now() - started;

    const [permissionRows, typeRows, snapshots, auditRows] = await this.prisma.$transaction([
      this.prisma.permission.count(),
      this.prisma.contentType.count(),
      this.prisma.contentSnapshot.count(),
      this.prisma.auditLog.count(),
    ]);

    return {
      status: database === "ok" ? "ok" : "degraded",
      database: { status: database, latencyMs },
      seed: {
        permissions: { expected: PERMISSIONS.length, actual: permissionRows },
        contentTypes: { expected: CONTENT_TYPES.length, actual: typeRows },
        inSync:
          permissionRows === PERMISSIONS.length && typeRows === CONTENT_TYPES.length,
      },
      snapshots,
      auditRows,
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rssBytes: process.memoryUsage().rss,
        heapUsedBytes: process.memoryUsage().heapUsed,
      },
      node: process.version,
    };
  }

  /** Liveness, for a load balancer. No auth, no database. */
  @Public()
  @Get("ping")
  ping() {
    return { status: "ok", time: new Date().toISOString() };
  }
}
