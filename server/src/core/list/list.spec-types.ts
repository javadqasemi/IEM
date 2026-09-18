/**
 * What a resource allows a caller to do to its list.
 *
 * Foundation stage F11. Weakness W5 is that `content.listEntries`,
 * `media.list`, `users.list`, `audit.list` and `applications.list` each
 * hand-rolled page/perPage/search/where/count, five slightly different ways —
 * and W6 is the consequence on the client, where `DataTable` sorts only the
 * page it can see because there was nothing to sort on the server.
 *
 * One spec per resource, and it is an **allowlist in both directions**:
 *
 * - A filter field that is not listed is **refused**, not ignored. A parameter
 *   that reaches Prisma unchecked is a query-injection surface, and a filter
 *   that is silently dropped shows the reader a list that does not match the
 *   filter they set — which they will read as wrong data rather than as a
 *   rejected parameter.
 * - A sort field that is not listed is refused for the same reason. An ignored
 *   sort looks exactly like data that will not sort.
 *
 * The refusal names what *is* allowed, because the caller is our own dashboard
 * and the message is a developer's error message, not an attacker's map.
 */

export type FilterKind = "string" | "number" | "boolean" | "date" | "enum";

export type FilterField = {
  kind: FilterKind;
  /**
   * The Prisma path, when it differs from the query parameter.
   * `actor` → `actor.email`, so a caller filters by a word rather than a join.
   */
  path?: string;
  /** For `kind: "enum"`: the only values accepted. */
  values?: readonly string[];
};

export type ListSpec = {
  /** Fields `sort=<field>:<dir>` may name. */
  sortable: readonly string[];
  /** Fields `filter[<field>]=<op>:<value>` may name. */
  filterable: Record<string, FilterField>;
  /**
   * Fields `q=` searches, ORed.
   *
   * `contains` with `mode: "insensitive"` here rather than a `tsvector`: at
   * these row counts the difference is not measurable, and the generated
   * column is a migration per resource. `docs/data-model.md` §5 names the five
   * tables where that stops being true, and the spec is where it changes when
   * they arrive.
   */
  searchable: readonly string[];
  defaultSort: { field: string; dir: "asc" | "desc" };
  /**
   * The ceiling a caller may ask for.
   *
   * Not a preference: `perPage=100000` is a request that reads a table into
   * memory, and a public-facing list without one is a denial of service with a
   * query string. The export route is how somebody gets everything.
   */
  maxPerPage?: number;
};

export const DEFAULT_PER_PAGE = 25;
export const MAX_PER_PAGE = 200;
