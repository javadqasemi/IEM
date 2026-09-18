import {
  download,
  listQuery,
  request,
  type Filter,
  type Paginated,
  type QueryValue,
  type SortDirection,
} from "@/core/api";
import type { ApplicationDto, ApplicationPatchDto, ApplicationStatsDto } from "./dto";

/**
 * HTTP only. URLs, methods, DTOs — no React, no rules, no mapping.
 *
 * Everything this file knows is which path answers which question. It returns
 * wire shapes; `mapper.ts` turns them into entities. Keeping the two apart is
 * what makes an API change — a renamed field, a casing convention, one
 * endpoint splitting in two — land in two files with millisecond tests
 * instead of in every screen that reads the record.
 */

/**
 * The list parameters, now the shared contract.
 *
 * **This is what the layering was for.** The server moved from a hand-rolled
 * `?search=&status=` to `?q=&filter[status]=eq:…&sort=…` in foundation stage
 * F11, and the change reaches exactly two functions in one file. No screen, no
 * hook and no component knows that `status` became `filter[status]` — they
 * pass a `status` and always did.
 *
 * `listQuery` from `core/api/list` does the serialising, so the spelling of a
 * filter is decided once rather than per resource.
 */
export type ApplicationQuery = {
  search?: string;
  status?: string;
  /** ISO `yyyy-mm-dd`. Everything deleted on or before this date. */
  retainUntilBefore?: string;
  sort?: { field: string; dir: SortDirection };
  page?: number;
  perPage?: number;
};

function toQuery(query: ApplicationQuery): Record<string, QueryValue> {
  const filters: Filter[] = [];
  if (query.status) filters.push({ field: "status", op: "eq", value: query.status });
  if (query.retainUntilBefore) {
    filters.push({ field: "retainUntil", op: "lte", value: query.retainUntilBefore });
  }

  return {
    ...listQuery({
      page: query.page,
      perPage: query.perPage,
      q: query.search,
      sort: query.sort,
      filters,
    }),
  };
}

export const applicationRepository = {
  list: (query: ApplicationQuery) =>
    request<Paginated<ApplicationDto>>("/applications", { query: toQuery(query) }),

  get: (id: string) => request<ApplicationDto>(`/applications/${id}`),

  stats: () => request<ApplicationStatsDto>("/applications/stats"),

  update: (id: string, patch: ApplicationPatchDto) =>
    request<ApplicationDto>(`/applications/${id}`, { method: "PATCH", body: patch }),

  remove: (id: string) => request<void>(`/applications/${id}`, { method: "DELETE" }),

  /**
   * Downloads one dossier file.
   *
   * A call rather than an href. The route checks `application.download` and
   * records the download in the audit log, and that only happens if the
   * request carries a credential — which the `<a href>` this replaced did not,
   * so every click on it returned 401.
   */
  downloadFile: (id: string, index: number, fallbackName: string) =>
    download(`/applications/${id}/files/${index}`, { fallbackName }),

  /**
   * The CSV, for **the same query** the list is showing.
   *
   * Passing the query rather than nothing is the contract, not a convenience:
   * an export that quietly contains more than the filtered view is a document
   * somebody will act on (architecture §7.2).
   */
  exportCsv: (query: ApplicationQuery) =>
    download("/applications/export", {
      query: toQuery(query),
      fallbackName: `bewerbungen-${new Date().toISOString().slice(0, 10)}.csv`,
    }),

  bulkStatus: (ids: string[], status: string) =>
    request<{ changed: number }>("/applications/bulk/status", { body: { ids, status } }),
};

export type ApplicationRepository = typeof applicationRepository;
