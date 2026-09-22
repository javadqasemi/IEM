import { request, type Paginated } from "@/core/api";
import type { DiagnosticsRun, JobDetail, JobFilters, JobRow, JobStats, SystemOverview } from "./types";

/**
 * HTTP only. URLs, methods, shapes — no React, no rules, no mapping.
 *
 * **Three endpoints, and none of them is new ground.** The overview extends
 * `/dashboard` rather than opening a parallel `/system/*` API, because two
 * endpoints answering the same question are two endpoints that eventually
 * answer it differently. Jobs and diagnostics are the surfaces `core/jobs`
 * and the health checks never had.
 */
export const systemRepository = {
  /**
   * One read for the whole overview.
   *
   * Deliberately not eight endpoints the screen stitches together: the
   * subsystems are compared against each other to produce the overall
   * verdict, and comparing values fetched at eight different moments is how a
   * banner ends up disagreeing with the cards beneath it.
   */
  overview: () => request<SystemOverview>("/dashboard/system/overview"),

  jobs: (filters: JobFilters = {}) =>
    request<Paginated<JobRow>>("/jobs", {
      query: {
        status: filters.status,
        name: filters.name,
        // The server takes a string: a boolean would be dropped by the query
        // builder, which skips `undefined`, `null` and `""` but not `false`.
        failedOnly: filters.failedOnly ? "true" : undefined,
        search: filters.search,
        page: filters.page,
        perPage: filters.perPage,
      },
    }),

  job: (id: string) => request<JobDetail>(`/jobs/${id}`),

  jobStats: () => request<JobStats>("/jobs/stats"),

  retryJob: (id: string, reason?: string) =>
    request<{ id: string; status: string }>(`/jobs/${id}/retry`, {
      method: "POST",
      body: { reason },
    }),

  cancelJob: (id: string, reason?: string) =>
    request<{ id: string; status: string }>(`/jobs/${id}/cancel`, {
      method: "POST",
      body: { reason },
    }),

  /**
   * `POST`, because three of the checks reach a third party and one writes a
   * file. It is also throttled at three a minute server-side — a page with a
   * button must not be a way to knock on somebody's SMTP door as fast as a
   * browser can repeat a request.
   */
  runDiagnostics: () => request<DiagnosticsRun>("/diagnostics", { method: "POST" }),
};
