import { download, request, type Paginated, type QueryValue } from "@/core/api";
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
 * The list parameters the **server** accepts today.
 *
 * Not `ListParams` from `core/api/list`. The server still hand-rolls
 * page/perPage/search per resource (weakness W5); the shared filter/sort
 * contract lands in foundation stage F6. When it does, this is the one file
 * that changes — which is the whole reason it exists.
 */
export type ApplicationQuery = {
  search?: string;
  status?: string;
  page?: number;
  perPage?: number;
};

function toQuery(query: ApplicationQuery): Record<string, QueryValue> {
  return {
    search: query.search || undefined,
    status: query.status || undefined,
    page: query.page,
    perPage: query.perPage,
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
};

export type ApplicationRepository = typeof applicationRepository;
