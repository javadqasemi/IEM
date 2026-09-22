import type { CheckResult, HealthState, JobPhase } from "@/entities/system";

/**
 * The System Control Center as the dashboard understands it.
 *
 * Mirrors the server's shapes rather than inventing a second vocabulary. The
 * three unions it needs — health, check result and job phase — come from
 * `entities/system`, which is the one place they are declared on this side.
 */

export type HealthSubject = {
  key: string;
  label: string;
  state: HealthState;
  /** Why it is not healthy, already prefixed with nothing — the screen groups. */
  reasons: string[];
  /** A dashboard hash route, or null when there is nowhere to go. */
  link: string | null;
};

export type HealthReport = {
  state: HealthState;
  /** Every unhealthy subject's reasons, each prefixed with its label. */
  reasons: string[];
  subjects: HealthSubject[];
};

export type BuildIdentity = {
  version: string | null;
  commit: string | null;
  builtAt: string | null;
  environment: string;
  source: "environment" | "stamp" | "none";
  /** Present exactly when the three above are absent. */
  reason: string | null;
};

export type MigrationState = {
  status: "current" | "mismatch" | "unknown";
  applied: number;
  pending: number;
  latest: string | null;
  latestAt: string | null;
};

/** A subsystem this application genuinely does not have. Never an empty list. */
export type SubsystemAbsence = {
  available: false;
  reason: string;
  alternative: string | null;
  link: string | null;
};

export type SystemOverview = {
  health: HealthReport;
  build: BuildIdentity;
  runtime: {
    node: string;
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    pid: number;
  };
  database: {
    connected: boolean;
    latencyMs: number;
    version: string | null;
    migrations: MigrationState;
  };
  jobs: {
    queued: number;
    running: number;
    dead: number;
    done24h: number;
    nextRunAt: string | null;
  };
  mail: {
    configured: boolean;
    host: string;
    from: string;
    lastVerifyAt: string | null;
    lastVerifyOk: boolean | null;
    lastDeliveredAt: string | null;
    failed: number;
    pending: number;
  };
  backups: {
    recoveryPoints: number;
    lastSuccessAt: string | null;
    lastVerifiedAt: string | null;
    lastVerifiedAgeDays: number | null;
    nextScheduledAt: string | null;
    failed: number;
    automatic: boolean;
    storageKind: string;
    freeBytes: number | null;
    usedBytes: number;
  };
  publishing: {
    approved: number;
    scheduled: number;
    nextScheduledAt: string | null;
    nextScheduledKey: string | null;
    liveVersion: number | null;
    livePublishedAt: string | null;
    recentFailures: number;
  };
  security: {
    activeUsers: number;
    withMfa: number;
    mfaAdoption: number | null;
    privilegedWithoutMfa: number;
    lockedAccounts: number;
    activeSessions: number;
    failedLogins24h: number;
  };
  storage: {
    driver: string;
    mediaAssets: number;
    mediaBytes: number;
    backupUsedBytes: number;
    freeBytes: number | null;
    freeBytesRoot: string;
    freeSharePercent: number | null;
  };
  cache: {
    configured: boolean;
    mode: string;
    note: string | null;
  };
  logs: SubsystemAbsence;
  updates: SubsystemAbsence;
};

/* ================================================================== */
/* Jobs                                                                */
/* ================================================================== */

/**
 * What an operator may do with a job.
 *
 * **Computed on the server and carried by the row.** The dashboard never
 * works this out: the rules live in `core/jobs/jobs.rules.ts`, a second copy
 * here would be one entry behind on the day it mattered, and the refusal
 * sentence is what the disabled button says rather than a shrug.
 */
export type JobCapabilities = {
  retryable: boolean;
  cancellable: boolean;
  retryRefusal: string | null;
  cancelRefusal: string | null;
};

export type JobRow = {
  id: string;
  name: string;
  /** The database status. `phase` is what the screen shows. */
  status: string;
  phase: JobPhase;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  runAfter: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  /** Already sanitized server-side. Never a raw transport error. */
  error: string | null;
  correlationId: string | null;
  actorEmail: string | null;
  lockedBy: string | null;
  capabilities: JobCapabilities;
};

export type JobDetail = JobRow & {
  payload: unknown;
  result: unknown;
  lockedAt: string | null;
  actorId: string | null;
  nextAttemptAt: string | null;
  backoffMs: number | null;
};

export type JobStats = {
  queued: number;
  running: number;
  dead: number;
  done24h: number;
  nextRunAt: string | null;
  /** The catalogue, so the filter offers real values rather than a second list. */
  names: readonly string[];
};

export type JobFilters = {
  status?: string;
  name?: string;
  failedOnly?: boolean;
  search?: string;
  page?: number;
  perPage?: number;
};

/* ================================================================== */
/* Diagnostics                                                         */
/* ================================================================== */

export type DiagnosticCheck = {
  key: string;
  label: string;
  result: CheckResult;
  durationMs: number;
  /** One actionable sentence. Sanitized server-side. */
  detail: string;
};

export type DiagnosticsRun = {
  startedAt: string;
  durationMs: number;
  result: CheckResult;
  checks: DiagnosticCheck[];
};
