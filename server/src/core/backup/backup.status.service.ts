import { Inject, Injectable } from "@nestjs/common";
import { BackupStatus, BackupType, RestoreStatus, VerificationStatus } from "@prisma/client";
import type { Readable } from "node:stream";
import { PrismaService } from "../../common/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { BACKUP_STORAGE, type BackupStorageProvider } from "./backup.storage";
import { PostgresTools } from "./backup.postgres";
import { nextScheduledRun } from "./backup.rules";

/**
 * What an operator is told about backups, and **nothing that was not measured**.
 *
 * The same discipline P2-4 established for mail: every figure is read from
 * something that already records it — `BackupRun`, `RestoreRun`, the storage
 * provider, the settings. There is no `BackupHealth` table, because a status
 * table is a second record of facts the system already holds and the day its
 * writer misses one it reports a stale success indefinitely.
 *
 * ## Five states, and `unknown` earns its place again
 *
 * `not_configured` → `unknown` → `healthy` / `warning` / `critical`.
 *
 * **`unknown` is "there are no backups yet"**, which on a fresh installation is
 * the truth and is not a fault. What it must never be is `healthy`: a green
 * light on an installation that has never taken a backup is the single most
 * dangerous thing this panel could say.
 */
@Injectable()
export class BackupStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly postgres: PostgresTools,
    @Inject(BACKUP_STORAGE) private readonly storage: BackupStorageProvider,
  ) {}

  async status(): Promise<BackupOverview> {
    const [lastSuccess, lastVerified, lastFailure, recoveryPoints, counts, lastRestore] =
      await Promise.all([
        this.prisma.backupRun.findFirst({
          where: { status: BackupStatus.SUCCESS },
          orderBy: { completedAt: "desc" },
          select: { completedAt: true, type: true, sizeBytes: true },
        }),
        this.prisma.backupRun.findFirst({
          where: { verification: VerificationStatus.PASSED },
          orderBy: { verifiedAt: "desc" },
          select: { verifiedAt: true },
        }),
        this.prisma.backupRun.findFirst({
          where: { status: BackupStatus.FAILED },
          orderBy: { completedAt: "desc" },
          select: { completedAt: true, failureCategory: true, failureDetail: true },
        }),
        this.prisma.backupRun.count({
          where: { status: BackupStatus.SUCCESS, verification: VerificationStatus.PASSED },
        }),
        this.prisma.backupRun.groupBy({ by: ["status"], _count: { _all: true } }),
        this.prisma.restoreRun.findFirst({
          orderBy: { createdAt: "desc" },
          select: { mode: true, status: true, completedAt: true, createdAt: true },
        }),
      ]);

    const automatic = await this.settings.flag("backup.automatic", false);
    const hour = await this.settings.number("backup.hour", 2, 0, 23);
    const offset = await this.settings.number("backup.timezoneOffsetMinutes", 60, -720, 840);
    const tools = await this.postgres.available();
    const free = await this.storage.freeBytes();
    const store = this.storage.describe();

    const totalBytes = await this.prisma.backupRun.aggregate({
      where: { status: BackupStatus.SUCCESS },
      _sum: { sizeBytes: true },
    });

    const count = (status: BackupStatus) =>
      counts.find((c) => c.status === status)?._count._all ?? 0;

    const state = this.overall({
      toolsOk: tools.ok,
      recoveryPoints,
      lastSuccessAt: lastSuccess?.completedAt ?? null,
      lastFailureAt: lastFailure?.completedAt ?? null,
      automatic,
    });

    return {
      state,
      automatic,
      toolsAvailable: tools.ok,
      toolVersion: tools.version,
      storage: {
        kind: store.kind,
        /*
          The location is shown because an operator needs it to find the files
          in an emergency, and it is a path on a machine they already
          administer. It is not a credential.
        */
        location: store.location,
        offSite: store.offSite,
        freeBytes: free,
        usedBytes: totalBytes._sum.sizeBytes ? Number(totalBytes._sum.sizeBytes) : 0,
      },
      recoveryPoints,
      lastSuccessAt: lastSuccess?.completedAt?.toISOString() ?? null,
      lastSuccessType: lastSuccess?.type ?? null,
      lastVerifiedAt: lastVerified?.verifiedAt?.toISOString() ?? null,
      lastFailureAt: lastFailure?.completedAt?.toISOString() ?? null,
      lastFailureCategory: lastFailure?.failureCategory ?? null,
      lastFailureDetail: lastFailure?.failureDetail ?? null,
      nextScheduledAt: automatic ? nextScheduledRun(hour, new Date(), offset).toISOString() : null,
      runs: {
        queued: count(BackupStatus.QUEUED),
        running: count(BackupStatus.RUNNING),
        verifying: count(BackupStatus.VERIFYING),
        success: count(BackupStatus.SUCCESS),
        failed: count(BackupStatus.FAILED),
        expired: count(BackupStatus.EXPIRED),
      },
      lastRestore: lastRestore
        ? {
            mode: lastRestore.mode,
            status: lastRestore.status,
            at: (lastRestore.completedAt ?? lastRestore.createdAt).toISOString(),
          }
        : null,
      /*
        The sentence the brief asks for in as many words, carried by the API so
        the UI cannot forget it and a future client gets it too.
      */
      offSiteWarning: store.offSite
        ? null
        : "Diese Sicherungen liegen auf demselben Server wie die Datenbank. Das schützt vor " +
          "Fehlbedienung und fehlerhaften Migrationen — nicht vor Ausfall der Festplatte, des " +
          "Servers oder des Standorts. Für eine echte Katastrophenvorsorge muss eine Kopie ausser Haus liegen.",
    };
  }

  /**
   * One word for the whole thing.
   *
   * Ordered by severity, and each rung is a different thing an operator does
   * next — the only justification a status word ever has.
   */
  private overall(input: {
    toolsOk: boolean;
    recoveryPoints: number;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
    automatic: boolean;
  }): BackupState {
    // Without the tools nothing can be backed up at all, whatever the history.
    if (!input.toolsOk) return "critical";

    // Never taken one. Not a fault, and emphatically not healthy.
    if (input.recoveryPoints === 0 && !input.lastFailureAt) return "unknown";

    if (input.recoveryPoints === 0) return "critical";

    // A failure more recent than the last success is an unresolved failure.
    if (
      input.lastFailureAt &&
      (!input.lastSuccessAt || input.lastFailureAt > input.lastSuccessAt)
    ) {
      return "critical";
    }

    if (!input.automatic) return "warning";

    /*
      Stale: automatic backups are on and the newest recovery point is more
      than two days old. One day would false-alarm on a machine that was off
      overnight; a week is long enough to lose a week.
    */
    if (input.lastSuccessAt && Date.now() - input.lastSuccessAt.getTime() > 48 * 3_600_000) {
      return "warning";
    }
    return "healthy";
  }

  /** Opens an artifact for the download route. */
  readArtifact(storageKey: string): Promise<Readable> {
    return this.storage.readStream(storageKey);
  }

  /** The one-word verdict for `/dashboard/system`, computed in one place. */
  async healthWord(): Promise<BackupState> {
    return (await this.status()).state;
  }
}

export type BackupState = "healthy" | "warning" | "critical" | "not_configured" | "unknown";

export type BackupOverview = {
  state: BackupState;
  automatic: boolean;
  toolsAvailable: boolean;
  toolVersion: string | null;
  storage: {
    kind: string;
    location: string;
    offSite: boolean;
    freeBytes: number | null;
    usedBytes: number;
  };
  recoveryPoints: number;
  lastSuccessAt: string | null;
  lastSuccessType: BackupType | null;
  lastVerifiedAt: string | null;
  lastFailureAt: string | null;
  lastFailureCategory: string | null;
  lastFailureDetail: string | null;
  nextScheduledAt: string | null;
  runs: {
    queued: number;
    running: number;
    verifying: number;
    success: number;
    failed: number;
    expired: number;
  };
  lastRestore: { mode: string; status: RestoreStatus; at: string } | null;
  offSiteWarning: string | null;
};

