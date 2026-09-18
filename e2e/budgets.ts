/**
 * The performance budgets, as data.
 *
 * Set by the firm at review, and adopted with one thing made explicit that the
 * numbers on their own do not say: **what is being measured.**
 *
 * "Dashboard < 300 ms" is a budget an API can meet and a *browser in
 * development* cannot — an unminified module graph, no HTTP caching and a cold
 * Vite transform put first paint an order of magnitude above it, and a budget
 * that fails on the machine everyone develops on is a budget that gets deleted
 * in a week. So the numbers below are **server response times**, measured
 * against the running API with a token, and that is where a regression actually
 * originates: an N+1 in a `select`, a filter that stopped using an index, a
 * `count` that started scanning.
 *
 * The one client-side budget is **navigation**, because that genuinely is a
 * client property: moving between two already-loaded screens should not refetch
 * the world.
 *
 * ---
 *
 * **These are regression guards, not benchmarks**, and the difference decides
 * every design choice here:
 *
 * - **The median of nine samples**, not one. A laptop also running a browser,
 *   a dev server and Postgres produces outliers that have nothing to do with
 *   the code; a test that fails on one of them teaches people to re-run until
 *   it passes, which is worse than not having it.
 * - **A warm-up first, discarded.** The first request of a process pays for the
 *   TCP connection, the pool and Postgres preparing the statement. Including it
 *   measures start-up once and the endpoint never.
 * - **p95 is reported, never asserted.** It is the number a reader wants when
 *   something *is* slow, and it is far too noisy on a developer machine to gate
 *   on.
 * - **They are meaningless without rows.** `SEED_LOAD_PROJECTS=500` makes the
 *   list query work for its living; against the two demo projects every query
 *   is fast, including the ones that will not be fast at a realistic size. The
 *   spec says how many rows it measured against, and refuses to claim anything
 *   about scale below a threshold.
 */

export type Budget = {
  /** What a failure message calls it. */
  label: string;
  /** Milliseconds. The median of the samples must come in under this. */
  ms: number;
  /** Why this number and not another. */
  why: string;
};

export const API_BUDGETS = {
  "dashboard.overview": {
    label: "Dashboard-Übersicht",
    ms: 300,
    why: "Eight counts across eight tables. It is the first thing anybody sees after signing in, and it is the endpoint most likely to grow a ninth count nobody budgeted for.",
  },
  "projects.list": {
    label: "Projektliste",
    ms: 400,
    why: "One page plus its count, in one transaction, with four joins. The join count is the thing to watch: a fifth would not show at two rows and would at two thousand.",
  },
  "projects.listFiltered": {
    label: "Projektliste, gefiltert",
    ms: 400,
    why: "The same query with a status filter and a sort. A filter that stops using its index costs nothing at the seeded size and everything later; this is where that shows.",
  },
  "projects.detail": {
    label: "Projektdetail",
    ms: 500,
    why: "One project with its members, Gewerke and milestones — three nested selects. Higher than the list because it fetches more, and still one round trip.",
  },
  "projects.search": {
    label: "Projektsuche",
    ms: 300,
    why: "`q=` is an ILIKE across three columns and has no index behind it. `docs/data-model.md` §5 names the row count at which that has to become a tsvector; this budget is what will say when.",
  },
  "projects.stats": {
    label: "Projektkennzahlen",
    ms: 200,
    why: "One `groupBy`. It backs the rail badge, so it runs on every page load of the whole dashboard — the cheapest endpoint has the tightest budget for that reason alone.",
  },
  "masterdata.pickers": {
    label: "Stammdaten-Picker",
    ms: 300,
    why: "What a form's EntityPicker calls on every keystroke pause. A slow picker is felt more than a slow page, because the reader is mid-task.",
  },
} as const satisfies Record<string, Budget>;

export const CLIENT_BUDGETS = {
  navigation: {
    label: "Navigation zwischen geladenen Screens",
    ms: 100,
    why: "A route change between two screens whose chunks are already fetched and whose data is in the query cache. It measures the router and the render, and nothing else — which is exactly the thing that regresses when a screen starts doing work during render.",
  },
} as const satisfies Record<string, Budget>;

/**
 * Below this many projects, the list budgets prove reachability and not speed.
 *
 * The spec still *runs* them — a 3-second list at any size is a finding — but it
 * says in its output that it is not measuring scale, so nobody reads a green
 * run as evidence the query is indexed.
 */
export const MEANINGFUL_ROW_COUNT = 100;

/** How many samples, and how many to throw away first. */
export const SAMPLES = 9;
export const WARMUP = 2;

export type Measurement = {
  samples: number[];
  median: number;
  p95: number;
  min: number;
  max: number;
};

export function summarise(samples: number[]): Measurement {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return {
    samples,
    median: at(0.5),
    p95: at(0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/** The line a failure prints, and the line a pass prints too. */
export function report(label: string, budget: number, m: Measurement): string {
  return (
    `${label}: p50 ${m.median}ms (Budget ${budget}ms) · ` +
    `p95 ${m.p95}ms · min ${m.min}ms · max ${m.max}ms · n=${m.samples.length}`
  );
}
