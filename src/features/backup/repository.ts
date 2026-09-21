import { request } from "@/core/api";
import type {
  BackupOverview,
  BackupPage,
  BackupRun,
  BackupType,
  RestoreMode,
  RestoreRun,
  Restorability,
  RetentionPreview,
} from "./types";

/**
 * HTTP only. URLs, methods, DTOs — no React, no rules, no mapping.
 *
 * **Nothing here does the work.** `create` and `restore` enqueue and return an
 * id; the screen polls. A request that waited for a `pg_dump` would time out on
 * a database worth backing up, and the button would have nothing to report.
 *
 * `download` is deliberately **absent** from this file. The artifact is the
 * whole database and every applicant dossier, so it is fetched as a plain
 * navigation through `core/api`'s `download` helper rather than through the
 * JSON client — see `useBackups.ts`.
 */
export const backupRepository = {
  status: () => request<BackupOverview>("/backups/status"),

  list: (query: { status?: string; type?: string; page?: number; perPage?: number }) =>
    request<BackupPage>("/backups", {
      query: {
        status: query.status || undefined,
        type: query.type || undefined,
        page: query.page,
        perPage: query.perPage,
      },
    }),

  create: (type: BackupType) =>
    request<{ id: string; created: boolean }>("/backups", { method: "POST", body: { type } }),

  setProtected: (id: string, value: boolean) =>
    request<BackupRun>(`/backups/${encodeURIComponent(id)}/protect`, {
      method: "POST",
      body: { protected: value },
    }),

  remove: (id: string) =>
    request<void>(`/backups/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** Whether this backup could be restored, and why not where it could not. */
  restorability: (id: string) =>
    request<Restorability>(`/backups/${encodeURIComponent(id)}/restorability`),

  /**
   * Requests a restore.
   *
   * Three things travel with it and none is optional: the **mode**, the
   * **typed word**, and the **re-authentication window**. The window is in the
   * body rather than a header for the reason `ReauthService` records — a
   * custom header would mean widening `allowedHeaders` in `main.ts` for one
   * feature.
   */
  restore: (id: string, body: { mode: RestoreMode; confirmation: string; reauthToken: string }) =>
    request<{ id: string }>(`/backups/${encodeURIComponent(id)}/restore`, {
      method: "POST",
      body,
    }),

  restores: () => request<{ items: RestoreRun[] }>("/backups/restores"),

  retentionPreview: () => request<RetentionPreview>("/backups/retention/preview"),
};
