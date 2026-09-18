import type { QueryValue } from "./client";

/**
 * The list contract, client side (weakness W5).
 *
 * Five endpoints hand-rolled page/perPage/search today and each spells it
 * slightly differently. One shape, so a filter bar, a pagination control and a
 * repository can be written once and reused by twenty modules.
 *
 * `docs/enterprise-architecture.md` §7.2 holds the server half. The important
 * part of that half, restated here because it is a security property and not a
 * convention: **the server filters against an allowlist of fields per
 * resource.** A filter parameter that reaches Prisma unchecked is a query
 * injection surface, and nothing on this side can make that safe.
 */

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
};

export type SortDirection = "asc" | "desc";

/**
 * The ten operators the server's list contract accepts.
 *
 * **This list has to match `OPERATORS` in `server/src/core/list/list.ts`
 * exactly**, and it is a hand-kept copy because the two halves are separate
 * packages. The failure when it drifts is quiet in one direction and loud in
 * the other: an operator the server has and this list does not is one a
 * repository simply cannot express — `isnull` was missing until Tasks needed
 * "the top level of the tree" and could not write it — while one this list has
 * and the server does not is a 400 naming the operator, which is at least
 * findable.
 */
export type FilterOperator =
  | "eq"
  | "ne"
  | "in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "between"
  /**
   * `filter[parentTaskId]=isnull:true` — the column is null.
   *
   * The value is `"true"` or `"false"`, and `false` means *not* null, which is
   * the half people forget: "tasks with a parent" and "all tasks" are different
   * questions, and omitting the filter answers the second one.
   */
  | "isnull";

export type Filter = {
  field: string;
  op: FilterOperator;
  value: string | number | boolean | (string | number)[];
};

export type ListParams = {
  page?: number;
  perPage?: number;
  /** Free-text search across the resource's own searchable fields. */
  q?: string;
  sort?: { field: string; dir: SortDirection };
  filters?: Filter[];
};

/**
 * `ListParams` → the query object the client sends.
 *
 * `sort=updatedAt:desc` and `filter[status]=in:NEW,IN_REVIEW`. One parameter
 * per filter rather than a JSON blob, because a filtered list has to be a
 * **link**: the URL is the only thing a person can send a colleague, and a
 * base64 payload in a query string is not one.
 */
export function listQuery(params: ListParams): Record<string, QueryValue> {
  const query: Record<string, QueryValue> = {};
  if (params.page !== undefined) query.page = params.page;
  if (params.perPage !== undefined) query.perPage = params.perPage;
  if (params.q) query.q = params.q;
  if (params.sort) query.sort = `${params.sort.field}:${params.sort.dir}`;
  for (const filter of params.filters ?? []) {
    const value = Array.isArray(filter.value) ? filter.value.join(",") : String(filter.value);
    query[`filter[${filter.field}]`] = `${filter.op}:${value}`;
  }
  return query;
}

/**
 * A stable cache key for a set of list parameters.
 *
 * Sorted, because `{ page: 1, q: "a" }` and `{ q: "a", page: 1 }` are the same
 * request and must not be two cache entries. Object key order is insertion
 * order in JavaScript, so without the sort the key would depend on which
 * branch of a screen happened to set `q` first.
 */
export function listKey(params: ListParams): string {
  const query = listQuery(params);
  return Object.keys(query)
    .sort()
    .map((k) => `${k}=${String(query[k])}`)
    .join("&");
}

/** What a list screen renders before its first response. */
export function emptyPage<T>(perPage = 20): Paginated<T> {
  return { items: [], total: 0, page: 1, perPage, pages: 0 };
}
