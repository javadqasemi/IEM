/**
 * Row-level scope as a value a repository **requires** — never a default.
 *
 * ---
 *
 * ## What this replaced, and why the old shape was the bug
 *
 * Every scoped repository method took `scope: Prisma.XWhereInput = {}`, and
 * `{}` in a Prisma `where` means *every row*. The comments beside them said the
 * opposite — "a query that forgets the scope returns the caller's own rows" —
 * and it was not true: forgetting the argument silently widened the query to
 * the whole firm. `GET /drawings/:id/versions` did exactly that, serving any
 * plan's history to anyone holding `drawing.read`
 * (`docs/COMPLETE_APPLICATION_AUDIT.md` SEC-R6, 32 signatures).
 *
 * ## The rule now
 *
 * A repository's scoped methods take a `Scope<W>` with no default, so omitting
 * it does not compile. A `Scope` can be made three ways and no others:
 *
 * | | |
 * | --- | --- |
 * | `restrictedTo(where)` | the caller's predicate, from a `*.scope.ts` |
 * | `nothing()`           | matches no row — a caller who reaches none |
 * | `unrestricted(because)` | every row, **with a reason written at the call site** |
 *
 * `unrestricted` is the only way to ask for all rows, and it demands a
 * sentence: a reader of the call sees *why* this query may see the whole firm
 * (`"Super Admin"`, `"project.readAll"`, `"the nightly reconciler"`), and a
 * grep for `unrestricted(` lists every such place. `server/src/architecture.test.ts`
 * fails a repository that goes back to an optional or defaulted scope.
 *
 * The brand makes a `Scope` impossible to forge from an object literal, so
 * `{ where: {} }` typed by hand does not satisfy it either.
 */

declare const SCOPE: unique symbol;

export type Scope<W> = {
  readonly [SCOPE]: true;
  /** The predicate to merge into a `where`. `{}` only when `unrestricted`. */
  readonly where: W;
  readonly kind: "restricted" | "nothing" | "unrestricted";
  /** Why this scope sees everything — present only on `unrestricted`. */
  readonly because?: string;
};

function make<W>(where: W, kind: Scope<W>["kind"], because?: string): Scope<W> {
  return { where, kind, ...(because ? { because } : {}) } as Scope<W>;
}

/** The caller's own predicate. */
export function restrictedTo<W>(where: W): Scope<W> {
  return make(where, "restricted");
}

/**
 * Matches no row.
 *
 * `{ id: "" }` — no cuid is empty. Every scoped model here has a string `id`,
 * so this is valid for all of them; the cast is the one place that is assumed.
 * The same answer as a caller legitimately on no project, deliberately: a 403
 * would leak that the distinction exists.
 */
export function nothing<W>(): Scope<W> {
  return make({ id: "" } as W, "nothing");
}

/**
 * Every row — for a reason stated at the call site.
 *
 * `because` must be non-empty. It is not logged or checked against anything;
 * it is there so the sentence is written by the person widening the query and
 * read by the next one.
 */
export function unrestricted<W>(because: string): Scope<W> {
  if (!because.trim()) throw new Error("unrestricted() braucht eine Begründung.");
  return make({} as W, "unrestricted", because);
}

/** The predicate, to spread into a `where`. */
export function whereOf<W>(scope: Scope<W>): W {
  return scope.where;
}

/** Whether this scope sees every row. */
export function isUnrestricted<W>(scope: Scope<W>): boolean {
  return scope.kind === "unrestricted";
}
