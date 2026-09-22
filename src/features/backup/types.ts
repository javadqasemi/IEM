import type { HealthState } from "@/entities/system";

/**
 * Backups as the dashboard understands them.
 *
 * Mirrors the server's vocabulary rather than inventing a second one — the
 * statuses and the failure categories are the server's closed sets, and a
 * client-side re-derivation would be a second answer that disagrees the day
 * somebody adds a value to one of them.
 *
 * There is no `dto.ts` and no `mapper.ts` here, for the reason
 * `features/mail/types.ts` records at length: the feature is operational and
 * read-mostly, the server computes the verdict and the counts, there is no
 * entity to assemble, and timestamps stay ISO strings because the formatters
 * take strings. A pass-through mapper is not a seam; it is a file that makes
 * the layer diagram look right.
 */

export type BackupType = "DATABASE" | "MEDIA" | "FULL";
export type BackupTrigger = "MANUAL" | "SCHEDULED" | "PRE_RESTORE";
export type BackupStatus =
  | "QUEUED"
  | "RUNNING"
  | "VERIFYING"
  | "SUCCESS"
  | "FAILED"
  | "EXPIRED"
  | "DELETED";
export type VerificationStatus = "PENDING" | "PASSED" | "FAILED";
export type RestoreMode = "DRILL" | "IN_PLACE";
export type RestoreStatus =
  | "REQUESTED"
  | "RUNNING"
  | "VALIDATING"
  | "SUCCESS"
  | "FAILED"
  | "ABORTED";

/**
 * Five states, and `unknown` means "never taken one" — never `healthy`.
 *
 * **Re-exported rather than re-declared** (P2-6). The same union was written
 * out here, in `features/mail/types.ts`, and twice more on the server. All
 * four agreed, and nothing compared them; `entities/system` is now the one
 * declaration on this side, together with the label and tone each state gets.
 */
export type BackupState = HealthState;

export type BackupArtifact = {
  kind: "DATABASE_DUMP" | "MEDIA_ARCHIVE" | "MANIFEST";
  sizeBytes: number;
  checksum: string;
};

export type BackupRun = {
  id: string;
  type: BackupType;
  status: BackupStatus;
  trigger: BackupTrigger;
  triggeredBy: string | null;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
  verification: VerificationStatus;
  verifiedAt: string | null;
  verificationDetail: string | null;
  failureCategory: string | null;
  failureDetail: string | null;
  protected: boolean;
  appVersion: string | null;
  migrationVersion: string | null;
  artifacts: BackupArtifact[];
};

export type BackupPage = {
  items: BackupRun[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
};

/**
 * The status panel's shape.
 *
 * **No field can hold a credential.** The same technique the server's
 * `BackupManifest` uses: the way to guarantee a page never renders a secret is
 * to give the page's type nowhere to put one. `storage.location` is a
 * filesystem path on a machine the reader administers, which is what they need
 * to find the files in an emergency and is not a secret.
 */
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
  lastRestore: { mode: RestoreMode; status: RestoreStatus; at: string } | null;
  /** The sentence about local-only storage. Carried by the API so the UI cannot forget it. */
  offSiteWarning: string | null;
};

export type Restorability = {
  backupRunId: string;
  compatibility: "COMPATIBLE" | "REQUIRES_MIGRATION" | "INCOMPATIBLE";
  compatibilityReason: string;
  restorable: boolean;
  refusal: string | null;
  drillDatabase: string;
  liveDatabase: string;
};

export type RestoreRun = {
  id: string;
  mode: RestoreMode;
  status: RestoreStatus;
  targetDatabase: string;
  requestedBy: string | null;
  backupRunId: string;
  backupType: BackupType;
  backupCreatedAt: string;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  failureCategory: string | null;
  failureDetail: string | null;
  validation: ValidationReport | null;
};

export type ValidationReport = {
  database: string;
  migration: string | null;
  migrations: number;
  counts: {
    users: number;
    superAdmins: number;
    organisations: number;
    settings: number;
    contentEntries: number;
  };
  checks: { name: string; ok: boolean; detail: string }[];
  ok: boolean;
};

export type RetentionPreview = {
  policy: {
    keepDatabase: number;
    keepMedia: number;
    keepFull: number;
    minimumAgeHours: number;
  };
  total: number;
  keep: number;
  remove: number;
  spared: { id: string; reason: string }[];
};
