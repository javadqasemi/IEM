import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { promises as fs } from "node:fs";
import {
  BackupArtifactKind,
  BackupStatus,
  BackupTrigger,
  BackupType,
  Prisma,
  VerificationStatus,
} from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import type { AuthUser } from "../../common/decorators";
import { AuditService } from "../audit/audit.service";
import { EventBus } from "../events/event-bus";
import { JobService } from "../jobs/job.service";
import { SettingsService } from "../settings/settings.service";
import { OrganisationService } from "../organisation/organisation.service";
import { BACKUP_STORAGE, type BackupStorageProvider } from "./backup.storage";
import { PostgresTools } from "./backup.postgres";
import { MediaArchiver } from "./backup.media";
import {
  CONSISTENCY_NOTE,
  checksumFile,
  findSecretLikeKeys,
  refuseManifest,
  type BackupManifest,
} from "./backup.manifest";
import {
  backupFailure,
  classifyBackupError,
  redactToolOutput,
  type BackupFailure,
} from "./backup.failure";
import {
  occurrenceKeyFor,
  planRetention,
  refuseDelete,
  type RetentionPolicy,
} from "./backup.rules";

/**
 * Creating, verifying, listing and expiring backups.
 *
 * Restore lives in `restore.service.ts` — the two are separated because one is
 * routine and the other replaces a production database, and a file where both
 * live is a file where the reader stops noticing which is which.
 *
 * ---
 *
 * ## Everything slow is a job
 *
 * `request()` writes a `BackupRun` row and enqueues; it does not dump anything.
 * A `pg_dump` inside an HTTP request is a request that times out on a database
 * worth backing up, and a backup with no durable record is one nobody can ask
 * about afterwards. `core/jobs` already gives durability, retry, attribution
 * and visibility — this adds none of its own.
 *
 * ## Artifacts are finalised, not written in place
 *
 * Each artifact is written to `<key>.partial` and renamed only once its
 * checksum has been computed. A process that dies mid-dump therefore leaves a
 * `.partial` file and a `RUNNING` row, which is exactly what it is; it cannot
 * leave a short file under the real name, which would verify as present, pass a
 * size check and fail at the one moment it is needed.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly settings: SettingsService,
    private readonly organisation: OrganisationService,
    private readonly postgres: PostgresTools,
    private readonly media: MediaArchiver,
    private readonly config: ConfigService,
    @Inject(BACKUP_STORAGE) private readonly storage: BackupStorageProvider,
  ) {}

  /* ================================================================ */
  /* Requesting                                                        */
  /* ================================================================ */

  /**
   * Records the intent and queues the work.
   *
   * Returns as soon as the row exists, which is what lets the button answer
   * immediately and the screen poll a status. `occurrenceKey` is set only for
   * a scheduled run — see `occurrenceKeyFor` for why a manual one deliberately
   * has none.
   */
  async request(input: {
    type: BackupType;
    trigger: BackupTrigger;
    actor: AuthUser | null;
    occurrenceKey?: string;
  }): Promise<{ id: string; created: boolean }> {
    if (input.occurrenceKey) {
      /*
        The insert is attempted and the unique violation is the answer — the
        shape `notificationEventKey` uses. A read-then-write would let two
        workers both find nothing and both create a full backup of the same
        night.
      */
      const existing = await this.prisma.backupRun.findUnique({
        where: { occurrenceKey: input.occurrenceKey },
        select: { id: true },
      });
      if (existing) return { id: existing.id, created: false };
    }

    try {
      const run = await this.prisma.backupRun.create({
        data: {
          type: input.type,
          trigger: input.trigger,
          status: BackupStatus.QUEUED,
          triggeredById: input.actor?.id ?? null,
          occurrenceKey: input.occurrenceKey ?? null,
        },
        select: { id: true },
      });

      await this.jobs.enqueue("backup.create", { backupRunId: run.id });

      this.audit.record({
        actor: input.actor,
        action: "backup.started",
        resource: "backup_run",
        resourceId: run.id,
        after: { type: input.type, trigger: input.trigger },
        message: `Sicherung (${input.type}) eingereiht.`,
      });

      return { id: run.id, created: true };
    } catch (err) {
      if ((err as { code?: string }).code === "P2002" && input.occurrenceKey) {
        const existing = await this.prisma.backupRun.findUnique({
          where: { occurrenceKey: input.occurrenceKey },
          select: { id: true },
        });
        if (existing) return { id: existing.id, created: false };
      }
      throw err;
    }
  }

  /* ================================================================ */
  /* Running                                                           */
  /* ================================================================ */

  /**
   * The job handler: dump, archive, manifest, checksum, then queue verification.
   *
   * Registered by `backup.jobs.ts`. Everything that can fail is caught and
   * turned into a **classified** failure on the row — the job still throws, so
   * `core/jobs` retries and eventually marks the row `DEAD`, but the operator's
   * answer is on the backup row where they are looking.
   */
  async run(backupRunId: string): Promise<{ status: BackupStatus }> {
    const run = await this.prisma.backupRun.findUnique({ where: { id: backupRunId } });
    if (!run) throw new NotFoundException(`Unbekannte Sicherung ${backupRunId}.`);
    if (run.status === BackupStatus.SUCCESS) return { status: run.status };

    const startedAt = new Date();
    await this.prisma.backupRun.update({
      where: { id: backupRunId },
      data: { status: BackupStatus.RUNNING, startedAt },
    });

    try {
      await this.assertCapacity(run.type);

      const conn = this.postgres.connection();
      const artifacts: { kind: BackupArtifactKind; key: string; contentType: string }[] = [];
      const manifestArtifacts: BackupManifest["artifacts"] = [];
      let databaseAt: string | null = null;
      let mediaAt: string | null = null;

      if (run.type === BackupType.DATABASE || run.type === BackupType.FULL) {
        const key = this.keyFor(run.id, run.createdAt, `${run.id}.dump`);
        await this.writeArtifact(key, async (path) => {
          await this.postgres.dump(conn, path);
        });
        databaseAt = new Date().toISOString();
        artifacts.push({ kind: BackupArtifactKind.DATABASE_DUMP, key, contentType: "application/octet-stream" });
      }

      if (run.type === BackupType.MEDIA || run.type === BackupType.FULL) {
        const key = this.keyFor(run.id, run.createdAt, `${run.id}-media.tar.gz`);
        await this.writeArtifact(key, async (path) => {
          await this.media.archive(path);
        });
        mediaAt = new Date().toISOString();
        artifacts.push({ kind: BackupArtifactKind.MEDIA_ARCHIVE, key, contentType: "application/gzip" });
      }

      // Checksums first, because the manifest records them.
      let total = 0;
      const rows: Prisma.BackupArtifactCreateManyInput[] = [];
      for (const artifact of artifacts) {
        const path = this.storage.localPath(artifact.key)!;
        const { sha256, bytes } = await checksumFile(path);
        total += bytes;
        rows.push({
          backupRunId: run.id,
          kind: artifact.kind,
          storageKey: artifact.key,
          sizeBytes: BigInt(bytes),
          checksum: sha256,
          contentType: artifact.contentType,
        });
        manifestArtifacts.push({
          kind: artifact.kind,
          file: artifact.key.split("/").pop() ?? artifact.key,
          sizeBytes: bytes,
          sha256,
        });
      }

      const schema = await this.schemaState();
      const manifest: BackupManifest = {
        manifestVersion: 1,
        backupId: run.id,
        type: run.type,
        createdAt: run.createdAt.toISOString(),
        organisation: await this.organisationName(),
        application: { version: this.appVersion(), migration: schema.migration },
        database: { serverVersion: await this.postgres.serverVersion(conn), name: conn.database },
        artifacts: manifestArtifacts,
        consistency: { databaseAt, mediaAt, note: CONSISTENCY_NOTE },
      };

      /*
        The runtime half of "a manifest carries no secret".

        The type already has nowhere to put one; this catches the case a type
        cannot — a future field whose *name* is innocent and whose value is not,
        or an object widened somewhere upstream. It fails the backup rather
        than writing the file, because a credential in an artifact somebody may
        e-mail is worse than a missing backup they will notice.
      */
      const leaked = findSecretLikeKeys(manifest);
      if (leaked.length) {
        throw new Error(`Manifest would carry secret-like keys: ${leaked.join(", ")}`);
      }

      const manifestKey = this.keyFor(run.id, run.createdAt, `${run.id}.manifest.json`);
      const manifestPath = this.storage.localPath(manifestKey)!;
      await fs.mkdir(manifestPath.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
      const manifestSum = await checksumFile(manifestPath);
      total += manifestSum.bytes;
      rows.push({
        backupRunId: run.id,
        kind: BackupArtifactKind.MANIFEST,
        storageKey: manifestKey,
        sizeBytes: BigInt(manifestSum.bytes),
        checksum: manifestSum.sha256,
        contentType: "application/json",
      });

      await this.prisma.$transaction([
        this.prisma.backupArtifact.deleteMany({ where: { backupRunId: run.id } }),
        this.prisma.backupArtifact.createMany({ data: rows }),
        this.prisma.backupRun.update({
          where: { id: run.id },
          data: {
            status: BackupStatus.VERIFYING,
            completedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
            sizeBytes: BigInt(total),
            appVersion: manifest.application.version,
            databaseVersion: manifest.database.serverVersion,
            migrationVersion: schema.migration,
          },
        }),
      ]);

      // Verification is its own job, so a slow `pg_restore --list` over a large
      // archive does not sit inside the create job's retry budget.
      await this.jobs.enqueue("backup.verify", { backupRunId: run.id });
      return { status: BackupStatus.VERIFYING };
    } catch (err) {
      const failure = classifyBackupError(err, "DUMP_FAILED");
      await this.fail(run.id, failure, startedAt);
      throw err;
    }
  }

  /**
   * Proves the artifacts are readable, which is a different claim from written.
   *
   * Three checks, and the first is the one most systems stop at:
   *
   * 1. the file is there and its **checksum still matches** what was recorded;
   * 2. the dump's table of contents parses (`pg_restore --list`);
   * 3. the media archive's headers parse (`tar -tzf`).
   *
   * (2) and (3) are what turn "a file exists" into "a tool can read it". What
   * none of them proves is that the data restores cleanly into a schema — that
   * is the drill, and `restore.service.ts` owns it.
   */
  async verify(backupRunId: string): Promise<{ verification: VerificationStatus }> {
    const run = await this.prisma.backupRun.findUnique({
      where: { id: backupRunId },
      include: { artifacts: true },
    });
    if (!run) throw new NotFoundException(`Unbekannte Sicherung ${backupRunId}.`);

    try {
      const notes: string[] = [];

      for (const artifact of run.artifacts) {
        const path = this.storage.localPath(artifact.storageKey);
        if (!path) throw new Error(`No local path for ${artifact.storageKey}`);

        const { sha256, bytes } = await checksumFile(path);
        if (sha256 !== artifact.checksum) {
          await this.settleVerification(
            run.id,
            VerificationStatus.FAILED,
            backupFailure("CHECKSUM_FAILED", `(${artifact.kind})`).message,
          );
          return { verification: VerificationStatus.FAILED };
        }
        if (BigInt(bytes) !== artifact.sizeBytes) notes.push(`${artifact.kind}: Grösse abweichend`);

        if (artifact.kind === BackupArtifactKind.DATABASE_DUMP) {
          const toc = await this.postgres.listArchive(path);
          const entries = toc.split(/\r?\n/).filter((l) => l && !l.startsWith(";")).length;
          if (entries === 0) throw new Error("pg_restore --list returned no entries");
          notes.push(`Datenbank: ${entries} Objekte lesbar`);
        }
        if (artifact.kind === BackupArtifactKind.MEDIA_ARCHIVE) {
          const entries = await this.media.listArchive(path);
          notes.push(`Medien: ${entries.length} Einträge lesbar`);
        }
        if (artifact.kind === BackupArtifactKind.MANIFEST) {
          const parsed = JSON.parse(await fs.readFile(path, "utf8")) as unknown;
          const bad = refuseManifest(parsed);
          if (bad) throw new Error(bad);
          const leaked = findSecretLikeKeys(parsed);
          if (leaked.length) throw new Error(`Manifest carries secret-like keys: ${leaked.join(", ")}`);
        }
      }

      await this.settleVerification(run.id, VerificationStatus.PASSED, notes.join(" · ") || null);
      this.events.publish("BackupVerified", {
        entity: "backup_run",
        entityId: run.id,
        payload: { type: run.type, ok: true },
        after: { type: run.type, ok: true, detail: notes.join(" · ") },
        message: `Sicherung geprüft: ${notes.join(" · ")}`,
      });
      return { verification: VerificationStatus.PASSED };
    } catch (err) {
      const failure = classifyBackupError(err, "VERIFICATION_FAILED");
      await this.settleVerification(run.id, VerificationStatus.FAILED, failure.message);
      this.events.publish("BackupVerificationFailed", {
        entity: "backup_run",
        entityId: run.id,
        payload: { type: run.type, category: failure.category },
        after: { type: run.type, category: failure.category },
        message: failure.message,
      });
      throw err;
    }
  }

  /* ================================================================ */
  /* Reading                                                           */
  /* ================================================================ */

  /**
   * The history, paginated and mapped.
   *
   * Here rather than in the controller because `architecture.test.ts` forbids a
   * controller injecting `PrismaService` — and it caught this file's first
   * version doing exactly that. The rule is not ceremony: a controller with a
   * database client in scope grows one convenient `findFirst`, then a second,
   * and within a release the module's behaviour cannot be reasoned about from
   * its service.
   *
   * `BigInt` is converted here too. It does not survive `JSON.stringify`, and
   * the one place that must be handled is the one place the shape is built.
   */
  async list(query: { status?: BackupStatus; type?: BackupType; page?: number; perPage?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.min(100, Math.max(1, query.perPage ?? 25));
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.backupRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          artifacts: { select: { kind: true, sizeBytes: true, checksum: true } },
          triggeredBy: { select: { name: true } },
        },
      }),
      this.prisma.backupRun.count({ where }),
    ]);

    return {
      items: items.map((run) => ({
        id: run.id,
        type: run.type,
        status: run.status,
        trigger: run.trigger,
        triggeredBy: run.triggeredBy?.name ?? null,
        createdAt: run.createdAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
        durationMs: run.durationMs,
        sizeBytes: run.sizeBytes === null ? null : Number(run.sizeBytes),
        verification: run.verification,
        verifiedAt: run.verifiedAt?.toISOString() ?? null,
        verificationDetail: run.verificationDetail,
        failureCategory: run.failureCategory,
        failureDetail: run.failureDetail,
        protected: run.protected,
        appVersion: run.appVersion,
        migrationVersion: run.migrationVersion,
        artifacts: run.artifacts.map((a) => ({
          kind: a.kind,
          sizeBytes: Number(a.sizeBytes),
          /*
            The checksum is shown, and that is safe: it is a hash of data this
            caller already holds `system.backup` over, and it is the operator's
            only way to confirm a file they copied elsewhere is the file that
            was verified.
          */
          checksum: a.checksum,
        })),
      })),
      total,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /** One artifact's storage key and size, for the download route. */
  async artifactFor(backupRunId: string, kind: BackupArtifactKind) {
    return this.prisma.backupArtifact.findFirst({
      where: { backupRunId, kind },
      select: { storageKey: true, sizeBytes: true, contentType: true, kind: true },
    });
  }

  /* ================================================================ */
  /* Retention                                                         */
  /* ================================================================ */

  /** The configured policy, clamped on read the way every number here is. */
  async policy(): Promise<RetentionPolicy> {
    return {
      keepDatabase: await this.settings.number("backup.keepDatabase", 14, 0, 365),
      keepMedia: await this.settings.number("backup.keepMedia", 8, 0, 365),
      keepFull: await this.settings.number("backup.keepFull", 12, 0, 365),
      minimumAgeHours: await this.settings.number("backup.minimumAgeHours", 24, 1, 8760),
    };
  }

  /**
   * What retention *would* do. The screen and the job call the same function.
   *
   * A preview computed differently from the deletion it previews is a preview
   * that lies exactly when somebody is relying on it — so `planRetention` is
   * pure and both callers pass it the same rows.
   */
  async previewRetention(): Promise<{
    policy: RetentionPolicy;
    total: number;
    keep: number;
    remove: number;
    spared: { id: string; reason: string }[];
  }> {
    const policy = await this.policy();
    const runs = await this.retainableRows();
    const plan = planRetention(runs, policy, new Date());
    return {
      policy,
      total: runs.length,
      keep: plan.keep.length,
      remove: plan.deleteIds.length,
      spared: plan.spared,
    };
  }

  /** Applies retention. Called by the job, never by a request. */
  async applyRetention(): Promise<{ removed: number }> {
    const policy = await this.policy();
    const runs = await this.retainableRows();
    const plan = planRetention(runs, policy, new Date());

    let removed = 0;
    for (const id of plan.deleteIds) {
      try {
        await this.removeArtifacts(id);
        await this.prisma.backupRun.update({
          where: { id },
          data: { status: BackupStatus.EXPIRED, expiresAt: new Date() },
        });
        removed += 1;
      } catch (err) {
        // One failure does not abandon the rest, and the row stays as it was
        // rather than being marked gone with its file still on disk.
        this.logger.warn(`Aufräumen von ${id} fehlgeschlagen: ${(err as Error).message}`);
      }
    }
    if (removed) this.logger.log(`${removed} Sicherung(en) nach Aufbewahrungsregel entfernt.`);
    return { removed };
  }

  /** Deletes one by hand, refusing the cases `refuseDelete` names. */
  async remove(id: string, actor: AuthUser, ctx: Ctx): Promise<void> {
    const run = await this.prisma.backupRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException("Diese Sicherung gibt es nicht.");

    const lastVerified = await this.prisma.backupRun.findFirst({
      where: { type: run.type, status: BackupStatus.SUCCESS, verification: VerificationStatus.PASSED },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const refusal = refuseDelete(run, lastVerified?.id === run.id);
    if (refusal) throw new BadRequestException(refusal);

    await this.removeArtifacts(id);
    await this.prisma.backupRun.update({
      where: { id },
      data: { status: BackupStatus.DELETED },
    });

    this.audit.record({
      actor,
      action: "backup.deleted",
      resource: "backup_run",
      resourceId: id,
      before: { type: run.type, createdAt: run.createdAt.toISOString() },
      message: `Sicherung (${run.type}) gelöscht.`,
      ...ctx,
    });
  }

  /** Marks a run exempt from retention, or lifts that. */
  async setProtected(id: string, value: boolean, actor: AuthUser, ctx: Ctx) {
    const run = await this.prisma.backupRun.update({
      where: { id },
      data: { protected: value },
      select: { id: true, type: true, protected: true },
    });
    this.audit.record({
      actor,
      action: "backup.protection_changed",
      resource: "backup_run",
      resourceId: id,
      after: { protected: value },
      message: value ? "Sicherung vor Löschung geschützt." : "Löschschutz aufgehoben.",
      ...ctx,
    });
    return run;
  }

  /* ================================================================ */
  /* Helpers                                                           */
  /* ================================================================ */

  /**
   * Refuses before starting when the disk clearly cannot take it.
   *
   * Sized from what is actually there — the media tree is measured and the
   * database dump is estimated from the last successful one of its type,
   * falling back to a floor when there is no history. **Failing early is the
   * whole point**: filling the disk under a running PostgreSQL is how a backup
   * job takes the database down, which is the opposite of what it is for.
   *
   * A provider that cannot report free space is not treated as full. Refusing
   * every backup because `statfs` is unavailable would be a worse failure than
   * the one being guarded against.
   */
  private async assertCapacity(type: BackupType): Promise<void> {
    const free = await this.storage.freeBytes();
    if (free === null) return;

    let needed = 64 * 1024 * 1024; // floor, for the manifest and slack
    if (type !== BackupType.DATABASE) needed += (await this.media.measure()).bytes;
    if (type !== BackupType.MEDIA) {
      const last = await this.prisma.backupRun.findFirst({
        where: { type: { in: [BackupType.DATABASE, BackupType.FULL] }, status: BackupStatus.SUCCESS },
        orderBy: { createdAt: "desc" },
        select: { sizeBytes: true },
      });
      needed += last?.sizeBytes ? Number(last.sizeBytes) : 256 * 1024 * 1024;
    }

    // Twice, because a dump is written and then read back to be checksummed,
    // and because a disk at 100% is a problem for PostgreSQL long before it is
    // a problem for this job.
    if (free < needed * 2) {
      throw Object.assign(new Error("insufficient disk space"), { code: "ENOSPC" });
    }
  }

  /**
   * Writes one artifact, finalising it only once it is whole.
   *
   * The `.partial` rename is what makes a crash mid-dump recoverable rather
   * than deceptive: a short file under the real name would be present, would
   * have a plausible size, and would fail at the moment it was needed.
   */
  private async writeArtifact(key: string, produce: (path: string) => Promise<void>): Promise<void> {
    const finalPath = this.storage.localPath(key);
    if (!finalPath) throw new Error(`Provider has no local path for ${key}`);
    const partial = `${finalPath}.partial`;

    await fs.mkdir(finalPath.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
    await fs.rm(partial, { force: true });
    await produce(partial);
    await fs.rename(partial, finalPath);
  }

  /** `2026/09/<id>/<file>` — sortable, and one directory per run. */
  private keyFor(id: string, at: Date, file: string): string {
    const year = at.getUTCFullYear();
    const month = String(at.getUTCMonth() + 1).padStart(2, "0");
    return `${year}/${month}/${id}/${file}`;
  }

  private async removeArtifacts(backupRunId: string): Promise<void> {
    const artifacts = await this.prisma.backupArtifact.findMany({
      where: { backupRunId },
      select: { storageKey: true },
    });
    for (const artifact of artifacts) await this.storage.delete(artifact.storageKey);
    /*
      The rows go with the files, in that order.

      "Do not allow deleting an artifact whose database record remains claiming
      it exists" — so the record is removed after the file, and a failure
      between the two leaves a row pointing at nothing, which verification
      catches, rather than a file nothing points at, which nothing ever finds.
    */
    await this.prisma.backupArtifact.deleteMany({ where: { backupRunId } });
  }

  private async settleVerification(
    id: string,
    verification: VerificationStatus,
    detail: string | null,
  ): Promise<void> {
    await this.prisma.backupRun.update({
      where: { id },
      data: {
        verification,
        verifiedAt: new Date(),
        verificationDetail: detail?.slice(0, 500) ?? null,
        // `SUCCESS` means written *and* readable. A failed verification leaves
        // the run `FAILED`, so nothing downstream treats it as a recovery point.
        status: verification === VerificationStatus.PASSED ? BackupStatus.SUCCESS : BackupStatus.FAILED,
      },
    });
  }

  private async fail(id: string, failure: BackupFailure, startedAt: Date): Promise<void> {
    await this.prisma.backupRun.update({
      where: { id },
      data: {
        status: BackupStatus.FAILED,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        failureCategory: failure.category,
        failureDetail: failure.message,
      },
    });
    this.events.publish("BackupFailed", {
      entity: "backup_run",
      entityId: id,
      payload: { category: failure.category },
      after: { category: failure.category },
      message: failure.message,
    });
  }

  /** The Prisma migration the database is at, read from Prisma's own table. */
  async schemaState(): Promise<{ migration: string | null; applied: number }> {
    try {
      const rows = await this.prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NOT NULL
        ORDER BY finished_at DESC LIMIT 1`;
      const count = await this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
      return { migration: rows[0]?.migration_name ?? null, applied: Number(count[0]?.n ?? 0) };
    } catch {
      return { migration: null, applied: 0 };
    }
  }

  private appVersion(): string | null {
    // Null rather than `package.json`'s `0.0.1`: a number that never changes
    // looks like one that does. The same choice `/dashboard/system` makes.
    return this.config.get<string>("APP_VERSION") ?? null;
  }

  private async organisationName(): Promise<string | null> {
    try {
      return (await this.organisation.identity()).name;
    } catch {
      return null;
    }
  }

  private async retainableRows() {
    return this.prisma.backupRun.findMany({
      where: { status: { notIn: [BackupStatus.EXPIRED, BackupStatus.DELETED] } },
      select: {
        id: true,
        type: true,
        status: true,
        trigger: true,
        verification: true,
        protected: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /** The key for tonight's scheduled run of this type. */
  occurrenceKey(type: BackupType, at: Date): string {
    return occurrenceKeyFor(type, at);
  }

  /** Redacts a tool's own text before it reaches a log. Re-exported for the jobs. */
  redact(text: string): string {
    return redactToolOutput(text);
  }
}

type Ctx = { ip?: string | null; userAgent?: string | null };

