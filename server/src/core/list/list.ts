import { BadRequestException } from "@nestjs/common";
import {
  DEFAULT_PER_PAGE,
  MAX_PER_PAGE,
  type FilterField,
  type ListSpec,
} from "./list.spec-types";

/**
 * The list contract: one query string in, one Prisma `where`/`orderBy` out.
 *
 * Pure — no Prisma client, no Nest injection, nothing async — so every rule in
 * it is testable without a database. That is deliberate and it is the same
 * argument `service.ts` makes in a feature folder: the parsing, the allowlists
 * and the operator handling are where the bugs are, and a test that needed
 * Postgres to reach them would be testing Postgres.
 */

export type ListParams = {
  page: number;
  perPage: number;
  q?: string;
  sort: { field: string; dir: "asc" | "desc" };
  filters: ParsedFilter[];
};

export type ParsedFilter = {
  field: string;
  op: FilterOperator;
  value: unknown;
};

const OPERATORS = [
  "eq",
  "ne",
  "in",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "between",
  "isnull",
] as const;
export type FilterOperator = (typeof OPERATORS)[number];

/**
 * Pulls `filter[...]` out of the raw query object.
 *
 * **Express 5 changed the default query parser from `extended` to `simple`**,
 * so `?filter[status]=eq:NEW` arrives as the literal key `"filter[status]"`
 * rather than as a nested `{ filter: { status: … } }`. Both shapes are read
 * here rather than either being assumed: the parser is a one-line setting
 * somebody may change, and a list that silently stops filtering because of a
 * framework default is the kind of regression that reaches production.
 */
export function readFilterParams(query: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};

  const nested = query.filter;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    for (const [field, value] of Object.entries(nested as Record<string, unknown>)) {
      if (typeof value === "string") out[field] = value;
    }
  }

  for (const [key, value] of Object.entries(query)) {
    const match = /^filter\[(.+)\]$/.exec(key);
    if (match && typeof value === "string") out[match[1]] = value;
  }

  return out;
}

/**
 * Validates a query against a resource's spec.
 *
 * Throws `BadRequestException` naming what is allowed. A 400 rather than a
 * silent default, because the caller is our own dashboard: a dropped parameter
 * is a bug in code we own, and the fastest way to find it is for the request
 * to fail loudly the first time it is written wrong.
 */
export function parseListQuery(raw: Record<string, unknown>, spec: ListSpec): ListParams {
  const maxPerPage = spec.maxPerPage ?? MAX_PER_PAGE;
  const page = Math.max(1, positiveInt(raw.page) ?? 1);
  const perPage = Math.min(maxPerPage, Math.max(1, positiveInt(raw.perPage) ?? DEFAULT_PER_PAGE));

  const rawSort = text(raw.sort, 80);
  let sort = spec.defaultSort;
  if (rawSort) {
    const [field, dir = "asc"] = rawSort.split(":");
    if (!spec.sortable.includes(field)) {
      throw new BadRequestException(
        `Sortierung nach „${field}“ ist nicht möglich. Erlaubt: ${spec.sortable.join(", ")}.`,
      );
    }
    if (dir !== "asc" && dir !== "desc") {
      throw new BadRequestException(`Sortierrichtung „${dir}“ ist unbekannt. Erlaubt: asc, desc.`);
    }
    sort = { field, dir };
  }

  const filters: ParsedFilter[] = [];
  for (const [field, expression] of Object.entries(readFilterParams(raw))) {
    const definition = spec.filterable[field];
    if (!definition) {
      throw new BadRequestException(
        `Filter „${field}“ ist nicht möglich. Erlaubt: ${Object.keys(spec.filterable).join(", ")}.`,
      );
    }
    filters.push(parseFilter(field, expression, definition));
  }

  const q = text(raw.q, 200)?.trim();
  return { page, perPage, q: q || undefined, sort, filters };
}

/**
 * Query-string values are strings, always.
 *
 * These coercions live here rather than in a DTO because the DTO cannot see
 * the filters at all (`list.decorator.ts`), and splitting validation across
 * two places is how one of them ends up trusted for something it never
 * checked. The bounds are protections, not formatting: an unbounded `q`
 * reaches `contains` and an unbounded `sort` reaches an error message.
 */
function positiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.slice(0, max);
}

function parseFilter(field: string, expression: string, definition: FilterField): ParsedFilter {
  // `eq:NEW` — and a value containing a colon is intact, because only the
  // first one is a separator. A `like` on a timestamp needs that.
  const separator = expression.indexOf(":");
  const op = (separator === -1 ? "eq" : expression.slice(0, separator)) as FilterOperator;
  const rawValue = separator === -1 ? expression : expression.slice(separator + 1);

  if (!OPERATORS.includes(op)) {
    throw new BadRequestException(
      `Operator „${op}“ ist unbekannt. Erlaubt: ${OPERATORS.join(", ")}.`,
    );
  }

  if (op === "isnull") {
    return { field, op, value: rawValue !== "false" };
  }

  if (op === "in") {
    return { field, op, value: rawValue.split(",").map((v) => coerce(field, v, definition)) };
  }

  if (op === "between") {
    const parts = rawValue.split(",");
    if (parts.length !== 2) {
      throw new BadRequestException(`„between“ braucht zwei Werte: filter[${field}]=between:a,b`);
    }
    return { field, op, value: parts.map((v) => coerce(field, v, definition)) };
  }

  return { field, op, value: coerce(field, rawValue, definition) };
}

function coerce(field: string, value: string, definition: FilterField): unknown {
  switch (definition.kind) {
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new BadRequestException(`„${value}“ ist keine Zahl (Filter ${field}).`);
      }
      return n;
    }
    case "boolean":
      return value === "true" || value === "1";
    case "date": {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException(`„${value}“ ist kein Datum (Filter ${field}).`);
      }
      return d;
    }
    case "enum":
      if (definition.values && !definition.values.includes(value)) {
        throw new BadRequestException(
          `„${value}“ ist kein gültiger Wert für ${field}. Erlaubt: ${definition.values.join(", ")}.`,
        );
      }
      return value;
    default:
      return value;
  }
}

/* ================================================================== */
/* Prisma                                                              */
/* ================================================================== */

type Where = Record<string, unknown>;

/**
 * Turns parsed parameters into what Prisma wants.
 *
 * `AND` for the filters and `OR` for the search, which is the combination
 * people expect and the one a hand-rolled implementation usually gets subtly
 * wrong: two filters narrow, two search fields widen.
 */
export function buildWhere(params: ListParams, spec: ListSpec, base: Where = {}): Where {
  const and: Where[] = [];
  if (Object.keys(base).length) and.push(base);

  for (const filter of params.filters) {
    const path = spec.filterable[filter.field]?.path ?? filter.field;
    and.push(nest(path, condition(filter)));
  }

  if (params.q && spec.searchable.length) {
    and.push({
      OR: spec.searchable.map((field) =>
        nest(field, { contains: params.q, mode: "insensitive" }),
      ),
    });
  }

  if (!and.length) return {};
  return and.length === 1 ? and[0] : { AND: and };
}

function condition(filter: ParsedFilter): Record<string, unknown> {
  switch (filter.op) {
    case "eq":
      return { equals: filter.value };
    case "ne":
      return { not: filter.value };
    case "in":
      return { in: filter.value };
    case "gt":
      return { gt: filter.value };
    case "gte":
      return { gte: filter.value };
    case "lt":
      return { lt: filter.value };
    case "lte":
      return { lte: filter.value };
    case "like":
      return { contains: filter.value, mode: "insensitive" };
    case "between": {
      const [from, to] = filter.value as unknown[];
      return { gte: from, lte: to };
    }
    case "isnull":
      return filter.value ? { equals: null } : { not: null };
  }
}

/** `actor.email` + `{ contains: … }` → `{ actor: { email: { contains: … } } }`. */
function nest(path: string, leaf: unknown): Where {
  const parts = path.split(".");
  let out: unknown = leaf;
  for (let i = parts.length - 1; i >= 0; i--) out = { [parts[i]]: out };
  return out as Where;
}

export function buildOrderBy(params: ListParams, spec: ListSpec): Record<string, unknown> {
  const path = spec.filterable[params.sort.field]?.path ?? params.sort.field;
  return nest(path, params.sort.dir);
}

export function skipTake(params: ListParams): { skip: number; take: number } {
  return { skip: (params.page - 1) * params.perPage, take: params.perPage };
}

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
};

export function paginated<T>(items: T[], total: number, params: ListParams): Paginated<T> {
  return {
    items,
    total,
    page: params.page,
    perPage: params.perPage,
    // `0` for an empty result rather than `1`: the client reads `pages <= 1` as
    // "one page of results", and no results is not one page of them.
    pages: total === 0 ? 0 : Math.ceil(total / params.perPage),
  };
}
