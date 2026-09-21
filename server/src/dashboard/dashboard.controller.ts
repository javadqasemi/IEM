import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WorkflowState } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { SettingsService } from "../core/settings/settings.service";
import { MailStatusService } from "../mail/mail.status.service";
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    /** One source for the mail verdict — see `health` on the integration row. */
    private readonly mailStatus: MailStatusService,
  ) {}

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

  /**
   * The operational read-out behind Einstellungen → System.
   *
   * **Every figure here is measured, and nothing that cannot be measured is
   * invented.** That is the same rule `missingMetrics` above follows and it is
   * what makes the panel worth opening: an integration whose status is
   * "konfiguriert" because somebody filled in a form is not a status, and a
   * backup panel showing "letzte Sicherung: —" beside a green tick is worse
   * than no panel.
   *
   * Three things the brief asks for are therefore reported as **absent** with
   * a reason rather than faked:
   *
   * - **The application version.** Nothing stamps a build here — there is no
   *   commit hash and no build time in the artefact — so reporting
   *   `package.json`'s `0.0.1` would be a number that never changes and looks
   *   like one that does. `docs/ENTERPRISE_ROADMAP.md` → P1-3 carries it.
   * - **Backups.** There is no backup system (roadmap P2-5). The panel says so.
   * - **Analytics and maps.** No integration exists, which is also why
   *   `missingMetrics` above reports no visitor figures.
   *
   * No secret is exposed: an integration reports *whether* it is configured
   * and from where — a setting or the environment — never the value.
   */
  @Get("system")
  @RequirePermissions("system.health")
  async system() {
    const mail = await this.settings.values([
      "mail.smtpHost",
      "mail.smtpPassword",
      "mail.from",
    ]);
    const smtpFromSettings = typeof mail["mail.smtpHost"] === "string" && mail["mail.smtpHost"].trim();
    const smtpFromEnv = Boolean(this.config.get("SMTP_HOST"));
    const mailStatus = await this.mailStatus.status();

    const started = Date.now();
    let database: "ok" | "error" = "ok";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "error";
    }
    const latencyMs = Date.now() - started;

    /*
      The migration table, read directly.

      Prisma owns `_prisma_migrations` and exposes no client for it, so this is
      raw SQL — and it is the one question an operator asks that nothing else
      can answer: "did the last deploy's migration actually apply here?" A
      failed migration leaves `finished_at` null, which is why the count of
      unfinished rows is reported separately from the total.
    */
    let migrations: {
      applied: number;
      pending: number;
      latest: string | null;
      latestAt: string | null;
    } = { applied: 0, pending: 0, latest: null, latestAt: null };
    try {
      const rows = await this.prisma.$queryRaw<
        { migration_name: string; finished_at: Date | null }[]
      >`SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at DESC`;
      const finished = rows.filter((r) => r.finished_at);
      migrations = {
        applied: finished.length,
        pending: rows.length - finished.length,
        latest: finished[0]?.migration_name ?? null,
        latestAt: finished[0]?.finished_at?.toISOString() ?? null,
      };
    } catch {
      // A database without the table is a `db push` deployment rather than a
      // migrated one. Reporting zero would claim nothing had ever been
      // applied; leaving the default and saying nothing is the honest answer.
    }

    /*
      The `groupBy` is awaited on its own rather than inside the
      `$transaction([…])` below.

      Not a consistency decision — these are six independent counts for a
      read-only panel. It is a typing one: Prisma's `_count` is a union of
      `true`, a per-field object and `undefined`, and putting the query in a
      batch array widens the element type until the discriminant is lost.
      Awaited directly, the inference is exact and the loop needs no cast.
    */
    const jobRows = await this.prisma.job.groupBy({
      by: ["status"],
      _count: { _all: true },
      orderBy: undefined,
    });

    const [mediaCount, mediaBytes, snapshots, auditRows, offices] =
      await this.prisma.$transaction([
        this.prisma.mediaAsset.count({ where: { deletedAt: null } }),
        this.prisma.mediaAsset.aggregate({ where: { deletedAt: null }, _sum: { size: true } }),
        this.prisma.contentSnapshot.count(),
        this.prisma.auditLog.count(),
        this.prisma.office.count({ where: { deletedAt: null, archivedAt: null } }),
      ]);

    const jobs: Record<string, number> = {};
    for (const row of jobRows) jobs[row.status] = row._count._all;

    const storageDriver = this.config.get<string>("STORAGE_DRIVER") ?? "local";

    return {
      runtime: {
        node: process.version,
        environment: this.config.get<string>("NODE_ENV") ?? "development",
        uptimeSeconds: Math.round(process.uptime()),
        rssBytes: process.memoryUsage().rss,
        heapUsedBytes: process.memoryUsage().heapUsed,
        /** See the note above: nothing stamps a build, so nothing is claimed. */
        version: null as string | null,
        versionReason: "Kein Build-Stempel — Version und Commit werden nicht mitgeliefert.",
      },
      database: {
        status: database,
        latencyMs,
        migrations,
        snapshots,
        auditRows,
      },
      jobs,
      storage: {
        driver: storageDriver,
        assets: mediaCount,
        bytes: mediaBytes._sum.size ?? 0,
      },
      seed: {
        permissions: PERMISSIONS.length,
        contentTypes: CONTENT_TYPES.length,
        offices,
      },
      /**
       * Configured or not, and from where. Never the value.
       *
       * `state` is deliberately three-valued. "Nicht konfiguriert" and "nicht
       * gebaut" are different answers — the first is a form somebody can fill
       * in, the second is work in `docs/ENTERPRISE_ROADMAP.md` — and showing
       * them as the same grey dot is how a missing feature gets mistaken for a
       * missing setting and waited on for ever.
       */
      integrations: [
        {
          key: "mail",
          label: "E-Mail-Versand (SMTP)",
          state: smtpFromSettings || smtpFromEnv ? "configured" : "unconfigured",
          source: smtpFromSettings ? "Einstellungen" : smtpFromEnv ? "Umgebung" : null,
          detail: smtpFromSettings || smtpFromEnv
            ? `Absender ${String(mail["mail.from"] ?? "—")}`
            : "Ohne SMTP-Server werden E-Mails nur ins Protokoll geschrieben.",
          /**
           * The operational state beside the configuration state, from the one
           * service that computes it (P2-4).
           *
           * These are two different questions and the panel was only ever
           * answering the first. "Configured" is a claim about a form;
           * `health` is `MailStatusService`'s five-valued verdict, which is
           * `unknown` until somebody has actually tested the connection —
           * because a green light that means "the fields are filled in"
           * teaches an operator that green means nothing.
           *
           * Read from the same service the settings screen uses rather than
           * recomputed here: a status derived twice is a status that
           * eventually disagrees with itself, and the brief's instruction is
           * not to duplicate system-health endpoints.
           */
          health: mailStatus.state,
        },
        {
          key: "storage",
          label: "Dateiablage",
          state: "configured",
          source: storageDriver === "local" ? "Lokale Festplatte" : storageDriver,
          detail:
            storageDriver === "local"
              ? "Lokales Verzeichnis. Für mehrere Instanzen ist ein Objektspeicher nötig."
              : null,
        },
        {
          key: "cache",
          label: "Redis (Ratenbegrenzung, Sperren)",
          state: this.config.get("REDIS_URL") ? "configured" : "unconfigured",
          source: this.config.get("REDIS_URL") ? "Umgebung" : null,
          detail: this.config.get("REDIS_URL")
            ? null
            : "Ohne Redis zählt jede Instanz für sich — bei mehreren Prozessen vervielfacht sich jedes Limit.",
        },
        {
          key: "analytics",
          label: "Analytics",
          state: "unbuilt",
          source: null,
          detail: "Nicht angebunden — deshalb gibt es auf der Übersicht keine Besucherzahlen.",
        },
        {
          key: "maps",
          label: "Karten",
          state: "unbuilt",
          source: null,
          detail: "Standorte speichern Koordinaten und einen Kartenlink, es wird keine Karte eingebettet.",
        },
        {
          key: "backup",
          label: "Sicherung",
          state: "unbuilt",
          source: null,
          detail:
            "Es gibt keine Sicherungsautomatik in dieser Anwendung. Sicherungen laufen ausserhalb " +
            "(Datenbank und Medienverzeichnis). Siehe docs/ENTERPRISE_ROADMAP.md → P2-5.",
        },
      ],
    };
  }

  /** Liveness, for a load balancer. No auth, no database. */
  @Public()
  @Get("ping")
  ping() {
    return { status: "ok", time: new Date().toISOString() };
  }
}
