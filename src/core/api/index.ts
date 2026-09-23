/**
 * `core/api` — transport, and nothing above it.
 *
 * Nothing in this folder knows what a project, an application or a content
 * entry is. A feature's `repository.ts` builds on it; a screen never imports
 * from here except for `ApiError`, which is the one transport concept a form
 * legitimately handles (per-field validation messages).
 */
export {
  ApiError,
  request,
  buildUrl,
  refreshSession,
  setAccessToken,
  getAccessToken,
  setUnauthenticatedHandler,
  BASE,
  PREFIX,
  type ApiErrorBody,
  type RefreshOutcome,
  type RequestOptions,
  type QueryValue,
} from "./client";

export { download, filenameFrom } from "./download";

export {
  useQuery,
  invalidate,
  settle,
  invalidateAround,
  revalidate,
  prime,
  peek,
  clearQueryCache,
  fetchQuery,
  peekError,
  type QueryKey,
  type QueryState,
} from "./query";

export {
  toFailure,
  attempt,
  FAILURE_MESSAGES,
  type FailureKind,
  type MutationFailure,
  type MutationResult,
} from "./failure";

export {
  listQuery,
  listKey,
  emptyPage,
  type Paginated,
  type ListParams,
  type Filter,
  type FilterOperator,
  type SortDirection,
} from "./list";
