import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JobStatus, UserStatus, WorkflowState } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { buildInfo, type BuildInfo } from "../common/build-info";
import { MailStatusService } from "../mail/mail.status.service";
import { BackupStatusService } from "../core/backup/backup.status.service";
import { jobsHealth } from "../core/jobs/jobs.rules";
import {
  daysSince,
  overallHealth,
  type HealthReport,
  type HealthState,
  type HealthSubject,
} from "../core/health/health";

/**
 * The System Control Center's one read model.
 *
 * ---
 *
 * ## It aggregates; it does not recompute
 *
 * Mail's verdict comes from `MailStatusService`, backups' from
 * `BackupStatusService`, and the queue's from `jobsHealth` — each the same
 * function the module's own screen reads. A status derived twice is a status
 * that eventually disagrees with itself, and the disagreement always surfaces
 * at the worst moment: two screens, two colours, one subsystem.
 *
 * That is also why this is a *service* rather than more methods on
 * `DashboardController`. It has real logic now — precedence, thresholds,
 * reasons — and logic in a controller is logic no test can reach without HTTP.
 *
 * ## There is no percentage, and that is deliberate
 *
 * `overallHealth` returns the **worst** subsystem plus the reasons. A score —
 * *System Health: 93%* — is unactionable by construction: it cannot be used
 * without expanding it back into the list it came from, it moves when nothing
 * anybody cares about changed, and 93% reads as "fine" on the morning the
 * backups stopped.
 *
 * ## Nothing is claimed that was not measured
 *
 * The rule `missingMetrics` established on the executive dashboard, applied
 * to infrastructure: an integration that has never been tested is `unknown`,
 * not green; a subsystem this application cannot check says so.
 */
@Injectable()
export class SystemOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailStatus: MailStatusService,
    private readonly backupStatus: BackupStatusService,
  ) {}

  async overview(): Promise<SystemOverview> {
    const [database, jobs, mail, backups, publishing, security, storage, cache] =
      await Promise.all([
        this.database(),
        this.jobs(),
        this.mail(),
        this.backups(),
        this.publishing(),
        this.security(),
        this.storage(),
        Promise.resolve(this.cache()),
      ]);

    const subjects: HealthSubject[] = [
      database.subject,
      jobs.subject,
      mail.subject,
      backups.subject,
      publishing.subject,
      security.subject,
      storage.subject,
      cache.subject,
    ];

    return {
      health: overallHealth(subjects),
      build: buildInfo(),
      runtime: {
        node: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        rssBytes: process.memoryUsage().rss,
        heapUsedBytes: process.memoryUsage().heapUsed,
        pid: process.pid,
      },
      database: database.detail,
      jobs: jobs.detail,
      mail: mail.detail,
      backups: backups.detail,
      publishing: publishing.detail,
      security: security.detail,
      storage: storage.detail,
      cache: cache.detail,
      logs: this.logs(),
      updates: this.updates(),
    };
  }

  /* ================================================================ */
  /* Database                                                          */
  /* ================================================================ */

  /**
   * Connectivity, latency and — the question nothing else can answer —
   * **whether the last deploy's migration actually applied here**.
   *
   * `_prisma_migrations` is Prisma's own table and has no client, so this is
   * raw SQL. A migration that failed leaves `finished_at` null, which is why
   * unfinished rows are counted separately from applied ones rather than
   * summed into a single "N migrations" that would read as success.
   */
  private async database() {
    const started = Date.now();
    let connected = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      connected = false;
    }
    const latencyMs = Date.now() - started;

    let migrations: MigrationState = {
      status: "unknown",
      applied: 0,
      pending: 0,
      latest: null,
      latestAt: null,
    };
    let version: string | null = null;

    if (connected) {
      try {
        const rows = await this.prisma.$queryRaw<
          { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
        >`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at DESC`;
        const finished = rows.filter((r) => r.finished_at && !r.rolled_back_at);
        const unfinished = rows.length - finished.length;
        migrations = {
          /*
            Three answers, not two.

            `pending` here means a row that *started and did not finish* — a
            migration that failed or was rolled back — which is a different
            and worse condition than "there are newer migration files on disk
            that this database has not seen". The second is not answerable
            from inside the running application: the files live in the build,
            the deployment may not ship them, and claiming to know would be a
            guess presented as a check.
          */
          status: unfinished > 0 ? "mismatch" : "current",
          applied: finished.length,
          pending: unfinished,
          latest: finished[0]?.migration_name ?? null,
          latestAt: finished[0]?.finished_at?.toISOString() ?? null,
        };
      } catch {
        // No table: a `db push` deployment rather than a migrated one.
        // Reporting zero would claim nothing had ever been applied.
        migrations = { status: "unknown", applied: 0, pending: 0, latest: null, latestAt: null };
      }

      try {
        const rows = await this.prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
        // `version()` returns the build string, which names the platform and
        // the compiler. Only the product and its number are shown: the rest
        // tells an attacker more than it tells an operator.
        version = /PostgreSQL\s+([\d.]+)/.exec(rows[0]?.version ?? "")?.[0] ?? null;
      } catch {
        version = null;
      }
    }

    const reasons: string[] = [];
    let state: HealthState = "healthy";
    if (!connected) {
      state = "critical";
      reasons.push("Keine Verbindung zur Datenbank");
    } else if (migrations.status === "mismatch") {
      state = "critical";
      reasons.push(
        `${migrations.pending} Migration(en) begonnen und nicht abgeschlossen — das Schema ist unvollständig`,
      );
    } else if (migrations.status === "unknown") {
      state = "warning";
      reasons.push("Migrationsstand unbekannt (keine `_prisma_migrations`-Tabelle)");
    } else if (latencyMs > SLOW_QUERY_MS) {
      state = "warning";
      reasons.push(`Antwortzeit ${latencyMs} ms`);
    }

    return {
      subject: subject("database", "Datenbank", state, reasons, "#/einstellungen/system"),
      detail: { connected, latencyMs, version, migrations },
    };
  }

  /* ================================================================ */
  /* Jobs                                                              */
  /* ================================================================ */

  private async jobs() {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [queued, running, dead, done24h, oldest] = await this.prisma.$transaction([
      this.prisma.job.count({ where: { status: JobStatus.QUEUED } }),
      this.prisma.job.count({ where: { status: JobStatus.RUNNING } }),
      this.prisma.job.count({ where: { status: JobStatus.DEAD } }),
      this.prisma.job.count({ where: { status: JobStatus.DONE, finishedAt: { gte: dayAgo } } }),
      this.prisma.job.findFirst({
        where: { status: JobStatus.QUEUED },
        orderBy: { runAfter: "asc" },
        select: { runAfter: true },
      }),
    ]);

    const counts = { queued, running, dead, done24h };
    const { state, reasons } = jobsHealth(counts);

    return {
      /*
        `#/system/aufgaben`, and the first version of this line said
        `#/aufgabenverwaltung` — a route that does not exist.

        Found by the e2e run rather than by review, which is the argument for
        checking every link a card offers: a dead link on an operations page
        is worst exactly when somebody is following it in a hurry.
      */
      subject: subject("jobs", "Hintergrundaufgaben", state, reasons, "#/system/aufgaben"),
      detail: { ...counts, nextRunAt: oldest?.runAfter.toISOString() ?? null },
    };
  }

  /* ================================================================ */
  /* Aggregated from the modules that own them                         */
  /* ================================================================ */

  /** `MailStatusService`'s verdict, unchanged. See the note at the top. */
  private async mail() {
    const status = await this.mailStatus.status();
    const reasons: string[] = [];
    if (status.state === "not_configured") reasons.push("Kein SMTP-Server hinterlegt");
    if (status.state === "unknown") reasons.push("Verbindung wurde nie getestet");
    if (status.deliveries.failed > 0) {
      reasons.push(`${status.deliveries.failed} Zustellung(en) fehlgeschlagen`);
    }
    if (!status.secretsReadable) reasons.push("Zugangsdaten sind nicht entschlüsselbar");

    return {
      subject: subject("mail", "E-Mail", status.state, reasons, "#/einstellungen/email"),
      detail: {
        configured: status.configured,
        host: status.provider.host,
        from: status.provider.from,
        lastVerifyAt: status.lastVerify?.at ?? null,
        lastVerifyOk: status.lastVerify?.ok ?? null,
        lastDeliveredAt: status.deliveries.lastDeliveredAt,
        failed: status.deliveries.failed,
        pending: status.deliveries.pending,
      },
    };
  }

  /** `BackupStatusService`'s verdict, unchanged. */
  private async backups() {
    const status = await this.backupStatus.status();
    const ageDays = daysSince(status.lastVerifiedAt);
    const reasons: string[] = [];

    if (status.state === "not_configured") reasons.push("Keine automatischen Sicherungen");
    if (status.recoveryPoints === 0) reasons.push("Kein Wiederherstellungspunkt vorhanden");
    if (ageDays !== null && ageDays > BACKUP_STALE_DAYS) {
      reasons.push(`Letzte geprüfte Sicherung ist ${ageDays} Tage alt`);
    }
    if (!status.toolsAvailable) reasons.push("pg_dump/pg_restore nicht auffindbar");
    if (status.offSiteWarning) reasons.push(status.offSiteWarning);

    return {
      subject: subject("backups", "Sicherungen", status.state, reasons, "#/sicherungen"),
      detail: {
        recoveryPoints: status.recoveryPoints,
        lastSuccessAt: status.lastSuccessAt,
        lastVerifiedAt: status.lastVerifiedAt,
        lastVerifiedAgeDays: ageDays,
        nextScheduledAt: status.nextScheduledAt,
        failed: status.runs.failed,
        automatic: status.automatic,
        storageKind: status.storage.kind,
        freeBytes: status.storage.freeBytes,
        usedBytes: status.storage.usedBytes,
      },
    };
  }

  /* ================================================================ */
  /* Publishing                                                        */
  /* ================================================================ */

  /**
   * What is waiting to go live, and what failed to.
   *
   * The failure count comes from the **audit log** rather than from a job
   * row, because a scheduled publish that failed writes
   * `content.scheduled_publish_failed` with `outcome: FAILURE` and the job it
   * ran in may since have succeeded on retry. The audit row is the record of
   * the fact; the job row is the record of an attempt.
   */
  private async publishing() {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [approved, scheduled, nextScheduled, lastSnapshot, failures] =
      await this.prisma.$transaction([
        this.prisma.contentEntry.count({
          where: { deletedAt: null, status: WorkflowState.APPROVED },
        }),
        this.prisma.contentEntry.count({ where: { deletedAt: null, scheduledAt: { not: null } } }),
        this.prisma.contentEntry.findFirst({
          where: { deletedAt: null, scheduledAt: { not: null } },
          orderBy: { scheduledAt: "asc" },
          select: { scheduledAt: true, key: true },
        }),
        this.prisma.contentSnapshot.findFirst({
          orderBy: { version: "desc" },
          select: { version: true, publishedAt: true },
        }),
        this.prisma.auditLog.count({
          where: {
            resource: "content_snapshot",
            outcome: "FAILURE",
            createdAt: { gte: weekAgo },
          },
        }),
      ]);

    const reasons: string[] = [];
    let state: HealthState = "healthy";
    if (failures > 0) {
      state = "warning";
      reasons.push(
        failures === 1
          ? "1 zeitgesteuerte Veröffentlichung ist in den letzten 7 Tagen fehlgeschlagen"
          : `${failures} zeitgesteuerte Veröffentlichungen sind in den letzten 7 Tagen fehlgeschlagen`,
      );
    }
    if (!lastSnapshot) {
      state = "unknown";
      reasons.push("Es wurde noch nie veröffentlicht");
    }

    return {
      subject: subject("publishing", "Veröffentlichung", state, reasons, "#/veroeffentlichen"),
      detail: {
        approved,
        scheduled,
        nextScheduledAt: nextScheduled?.scheduledAt?.toISOString() ?? null,
        nextScheduledKey: nextScheduled?.key ?? null,
        liveVersion: lastSnapshot?.version ?? null,
        livePublishedAt: lastSnapshot?.publishedAt?.toISOString() ?? null,
        recentFailures: failures,
      },
    };
  }

  /* ================================================================ */
  /* Security                                                          */
  /* ================================================================ */

  /**
   * Counts, never people.
   *
   * ---
   *
   * ## The privacy line, drawn deliberately
   *
   * Everything here is an **aggregate**. No name, no address, no device, no
   * working hours — those exist in `/users/:id/sessions` behind
   * `user.readSessions`, and reproducing any of it under `system.health`
   * would make the System overview a way around that permission. `P2-9` split
   * reading somebody's sessions from revoking them for the same reason.
   *
   * The one figure that names a *group* rather than a person is privileged
   * accounts without a second factor, and it is the whole point of the card:
   * it is actionable, it is what an auditor asks, and a count cannot identify
   * anybody.
   */
  private async security() {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [activeUsers, withMfa, locked, sessions, failedLogins, privileged] =
      await this.prisma.$transaction([
        this.prisma.user.count({ where: { deletedAt: null, status: UserStatus.ACTIVE } }),
        this.prisma.user.count({
          where: { deletedAt: null, status: UserStatus.ACTIVE, mfaEnabled: true },
        }),
        this.prisma.user.count({ where: { deletedAt: null, lockedUntil: { gt: new Date() } } }),
        this.prisma.refreshToken.count({
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
        }),
        this.prisma.auditLog.count({
          where: { action: "auth.login_failed", createdAt: { gte: dayAgo } },
        }),
        this.prisma.user.count({
          where: {
            deletedAt: null,
            status: UserStatus.ACTIVE,
            mfaEnabled: false,
            roles: { some: { role: { key: { in: PRIVILEGED_ROLES } } } },
          },
        }),
      ]);

    const reasons: string[] = [];
    let state: HealthState = "healthy";

    if (privileged > 0) {
      state = "warning";
      reasons.push(
        privileged === 1
          ? "1 Konto mit erweiterten Rechten hat keinen zweiten Faktor"
          : `${privileged} Konten mit erweiterten Rechten haben keinen zweiten Faktor`,
      );
    }
    if (locked > 0) {
      reasons.push(locked === 1 ? "1 Konto ist gesperrt" : `${locked} Konten sind gesperrt`);
      if (state === "healthy") state = "warning";
    }
    if (failedLogins >= FAILED_LOGIN_WARNING) {
      state = "warning";
      reasons.push(`${failedLogins} fehlgeschlagene Anmeldungen in 24 Stunden`);
    }

    return {
      subject: subject("security", "Sicherheit", state, reasons, "#/einstellungen/sicherheit"),
      detail: {
        activeUsers,
        withMfa,
        /** A share rather than a list. Null when there is nobody to divide by. */
        mfaAdoption: activeUsers > 0 ? Math.round((withMfa / activeUsers) * 100) : null,
        privilegedWithoutMfa: privileged,
        lockedAccounts: locked,
        activeSessions: sessions,
        failedLogins24h: failedLogins,
      },
    };
  }

  /* ================================================================ */
  /* Storage                                                           */
  /* ================================================================ */

  /**
   * Media consumption, and free disk **where it can actually be measured**.
   *
   * `BackupStorageProvider` has `freeBytes()` (a `statfs` on the backup root);
   * the media adapter has no such method. Rather than inventing one and
   * reporting the wrong volume, the card says which root the figure belongs
   * to. On the default deployment they are the same disk, and saying so is
   * cheaper than a second `statfs` that would usually agree.
   */
  private async storage() {
    const backup = await this.backupStatus.status();
    const [assets, bytes] = await this.prisma.$transaction([
      this.prisma.mediaAsset.count({ where: { deletedAt: null } }),
      this.prisma.mediaAsset.aggregate({ where: { deletedAt: null }, _sum: { size: true } }),
    ]);

    const free = backup.storage.freeBytes;
    const used = backup.storage.usedBytes;
    const total = free !== null ? free + used : null;
    const freeShare = free !== null && total && total > 0 ? free / total : null;

    const reasons: string[] = [];
    let state: HealthState = "healthy";
    if (free === null) {
      state = "unknown";
      reasons.push("Freier Speicherplatz lässt sich auf dieser Plattform nicht ermitteln");
    } else if (freeShare !== null && freeShare < DISK_CRITICAL_SHARE) {
      state = "critical";
      reasons.push(`Weniger als ${Math.round(DISK_CRITICAL_SHARE * 100)} % freier Speicherplatz`);
    } else if (freeShare !== null && freeShare < DISK_WARNING_SHARE) {
      state = "warning";
      reasons.push(`Weniger als ${Math.round(DISK_WARNING_SHARE * 100)} % freier Speicherplatz`);
    }

    return {
      subject: subject("storage", "Dateiablage", state, reasons, "#/medien"),
      detail: {
        driver: this.config.get<string>("STORAGE_DRIVER") ?? "local",
        mediaAssets: assets,
        mediaBytes: bytes._sum.size ?? 0,
        backupUsedBytes: used,
        freeBytes: free,
        /** Which root `freeBytes` was measured on — see the note above. */
        freeBytesRoot: backup.storage.location,
        freeSharePercent: freeShare === null ? null : Math.round(freeShare * 100),
      },
    };
  }

  /* ================================================================ */
  /* Cache                                                             */
  /* ================================================================ */

  /**
   * Redis, or the documented single-process fallback.
   *
   * **The fallback is not a fault**, and reporting it as one would be the
   * card crying wolf on every development machine and on the firm's own
   * single-instance deployment. It is `not_configured` with a sentence saying
   * what it costs — every instance counting rate limits for itself, and the
   * scheduler running unlocked — which is exactly what the bootstrap log
   * already says once, at a moment nobody is reading.
   *
   * What this cannot do is detect a *second* instance. An application cannot
   * see its siblings without the very coordination it is reporting the
   * absence of, so the card states the condition rather than claiming to have
   * checked for it.
   */
  private cache() {
    const url = this.config.get<string>("REDIS_URL");
    const configured = Boolean(url?.trim());

    return {
      subject: subject(
        "cache",
        "Redis",
        configured ? "healthy" : "not_configured",
        configured ? [] : ["Einzelprozess-Betrieb — Ratenbegrenzung und Sperren gelten je Instanz"],
        "#/einstellungen/system",
      ),
      detail: {
        configured,
        mode: configured ? "redis" : "single-process",
        note: configured
          ? null
          : "Ohne Redis zählt jede Instanz für sich und die Zeitsteuerung läuft ungesperrt. " +
            "Für den Betrieb mit mehreren Prozessen ist Redis erforderlich.",
      },
    };
  }

  /* ================================================================ */
  /* The two that are honestly absent                                  */
  /* ================================================================ */

  /**
   * Application logs, reported as **not built** rather than as empty.
   *
   * There is no log store in this application: no `LogEntry` table, no
   * winston, no pino — Nest's `Logger` writes to stdout and the process's
   * supervisor keeps it or does not. A "Logs" screen listing nothing would be
   * indistinguishable from a quiet system, which is the single most
   * misleading thing an operations page can do.
   *
   * It is also deliberately **not** the audit log wearing a different hat.
   * Audit answers *who changed what*; logs answer *what happened
   * technically*. Merging them produces a table that is bad at both and a
   * retention policy that cannot be right for either.
   */
  private logs(): SubsystemAbsence {
    return {
      available: false,
      reason:
        "Anwendungsprotokolle werden nach stdout geschrieben und nicht gespeichert. " +
        "Es gibt keinen Verlauf, den dieses Dashboard zeigen könnte — dafür wäre ein " +
        "eigener Protokollspeicher nötig.",
      alternative: "Für nachvollziehbare Änderungen: Audit-Log.",
      link: "#/audit",
    };
  }

  /** No updater exists, and a fake button would be worse than this sentence. */
  private updates(): SubsystemAbsence {
    return {
      available: false,
      reason:
        "Es gibt keinen Aktualisierungsmechanismus in dieser Anwendung. Aktualisierungen " +
        "erfolgen über das Deployment.",
      alternative: null,
      link: null,
    };
  }
}

/* ================================================================== */
/* Thresholds — named, because a number in a comparison is a decision   */
/* ================================================================== */

/**
 * Above this, the database round trip is worth mentioning.
 *
 * A `SELECT 1` on a healthy local Postgres is single-digit milliseconds; 250
 * is far enough above that to mean something without firing on a laptop
 * waking up. It is a *warning* and never a failure: a slow database is still
 * a working one.
 */
const SLOW_QUERY_MS = 250;

/**
 * A verified backup older than this is worth saying out loud.
 *
 * Eight rather than seven: the schedule is daily or weekly, and a threshold
 * equal to the interval fires every week on the morning before the run.
 */
const BACKUP_STALE_DAYS = 8;

/**
 * Failed sign-ins in 24 hours before the card mentions it.
 *
 * The account lockout is five attempts, so twenty is four locked-out people
 * or one person working through a list. Neither is an emergency and both are
 * worth knowing.
 */
const FAILED_LOGIN_WARNING = 20;

/**
 * Disk thresholds, as shares rather than absolute bytes.
 *
 * Absolute figures are wrong on both ends — 5 GB free is comfortable on a
 * laptop and alarming on a 4 TB backup volume. These two are the brief's own
 * numbers, stated here so that changing them is an edit to a named constant
 * rather than to a comparison somebody has to find.
 */
const DISK_WARNING_SHARE = 0.15;
const DISK_CRITICAL_SHARE = 0.05;

/**
 * Roles whose members carry enough authority that a missing second factor is
 * worth naming.
 *
 * Read from the seeded role keys rather than from a permission, because the
 * question is "who could do real damage with a stolen password", and that is
 * a property of the role as a whole rather than of any single key.
 */
const PRIVILEGED_ROLES = ["super_admin", "administrator", "management"];

/* ================================================================== */
/* Shapes                                                              */
/* ================================================================== */

function subject(
  key: string,
  label: string,
  state: HealthState,
  reasons: string[],
  link: string | null,
): HealthSubject {
  return { key, label, state, reasons, link };
}

export type MigrationState = {
  /** `current` · `mismatch` (started, never finished) · `unknown` (no table). */
  status: "current" | "mismatch" | "unknown";
  applied: number;
  pending: number;
  latest: string | null;
  latestAt: string | null;
};

export type SubsystemAbsence = {
  available: false;
  reason: string;
  alternative: string | null;
  link: string | null;
};

export type SystemOverview = {
  health: HealthReport;
  build: BuildInfo;
  runtime: {
    node: string;
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    pid: number;
  };
  database: { connected: boolean; latencyMs: number; version: string | null; migrations: MigrationState };
  jobs: { queued: number; running: number; dead: number; done24h: number; nextRunAt: string | null };
  mail: Record<string, unknown>;
  backups: Record<string, unknown>;
  publishing: Record<string, unknown>;
  security: Record<string, unknown>;
  storage: Record<string, unknown>;
  cache: Record<string, unknown>;
  logs: SubsystemAbsence;
  updates: SubsystemAbsence;
};
