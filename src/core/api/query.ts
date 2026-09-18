import { useCallback, useEffect, useReducer, useRef } from "react";
import { ApiError } from "./client";

/**
 * The query cache (weakness W2).
 *
 * `useAsync` re-runs on every mount, dedupes nothing, caches nothing and has
 * no invalidation. At four screens that is invisible. With cross-linked records
 * — a task that names a project, an invoice that names a customer — it becomes
 * the dominant source of *wrong data on screen*: a mutation on one screen
 * cannot tell a sibling that what it is showing is now false.
 *
 * This is ~150 lines rather than a dependency, for the same reason the project
 * wrote its own router, throttler store and class merger. The decision is
 * revisited the day something here needs suspense, infinite lists or
 * cross-tab sync; until then a library would be 12 kB to solve four problems:
 *
 * | Problem | Here |
 * | --- | --- |
 * | Refetch on every mount | cached by key, returned immediately |
 * | Six components, six requests | one in-flight promise per key |
 * | Stale after a mutation | `invalidate("applications")` by prefix |
 * | Loading flash on revalidation | stale-while-revalidate: data first, then fresh |
 *
 * **What it deliberately does not do.** No retries (the client already refreshes
 * and retries once on 401, and a second retry layer would hide a real failure),
 * no window-focus refetching (an editor who alt-tabs to check a figure should
 * not have the form reload underneath them), no optimistic writes (a mutation
 * calls `invalidate`, which is honest about the round trip).
 */

export type QueryKey = readonly (string | number | boolean | null | undefined)[];

type Entry = {
  data: unknown;
  error: Error | null;
  /** 0 means "never resolved" — the distinction between empty and unfetched. */
  updatedAt: number;
  /** Non-null while a request for this key is in the air. Dedups callers. */
  promise: Promise<unknown> | null;
  /** Bumped on every settle, so a reader can tell two identical values apart. */
  revision: number;
};

const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

/**
 * Keys serialise to `resource|part|part`, and the separator matters: prefix
 * invalidation is a string comparison against `resource|`, so a key whose
 * *first* segment is `applications` is reachable by `invalidate("applications")`
 * and one whose second segment happens to be is not. A JSON array would make
 * `["media"]` a prefix of `["mediaStats"]`, which is exactly the false match
 * that turns invalidation into a full cache flush.
 */
function serialise(key: QueryKey): string {
  return key.map((part) => (part === undefined || part === null ? "" : String(part))).join("|");
}

function entryFor(key: string): Entry {
  let entry = cache.get(key);
  if (!entry) {
    entry = { data: null, error: null, updatedAt: 0, promise: null, revision: 0 };
    cache.set(key, entry);
  }
  return entry;
}

function notify(key: string) {
  for (const fn of listeners.get(key) ?? []) fn();
}

function subscribe(key: string, fn: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (!set!.size) listeners.delete(key);
  };
}

/**
 * Fetches if the entry is missing, stale, or failed — and returns the existing
 * promise if one is already in the air.
 */
function load(key: string, fetcher: () => Promise<unknown>, staleMs: number): Promise<unknown> {
  const entry = entryFor(key);
  if (entry.promise) return entry.promise;
  const fresh = entry.updatedAt > 0 && Date.now() - entry.updatedAt < staleMs && !entry.error;
  if (fresh) return Promise.resolve(entry.data);

  entry.promise = fetcher()
    .then((data) => {
      entry.data = data;
      entry.error = null;
      entry.updatedAt = Date.now();
      return data;
    })
    .catch((err: unknown) => {
      /**
       * A 401 is not an error to show.
       *
       * The client is already refreshing and retrying, or ending the session;
       * putting "Nicht angemeldet" in the middle of a screen while that happens
       * is noise. The entry is left as it was so the retry can fill it.
       */
      if (err instanceof ApiError && err.status === 401) return entry.data;
      entry.error = err instanceof Error ? err : new Error("Unbekannter Fehler.");
      // Marked resolved so the hook stops showing a spinner; `error` is what
      // the screen renders. Not marked *fresh* — `updatedAt` stays where it
      // was, so the next mount retries rather than caching the failure.
      throw entry.error;
    })
    .finally(() => {
      entry.promise = null;
      entry.revision += 1;
      notify(key);
    });

  // The rejection is delivered to the entry and to `notify`; nothing awaits
  // this promise for its own sake, so it must not become an unhandled
  // rejection in the console every time a permission is missing.
  return entry.promise.catch(() => entry.data);
}

/**
 * Drops everything under a prefix and tells whoever is showing it.
 *
 * Called by mutations: `updateApplication` invalidates `applications`, and the
 * list, the stats tile and the open detail all refetch — none of which knows
 * the others exist. That indirection is the point; the alternative is every
 * mutation holding a list of the screens it affects.
 *
 * Returns the number of entries dropped, which is what makes it testable.
 */
export function invalidate(prefix: string | QueryKey): number {
  const head = typeof prefix === "string" ? prefix : serialise(prefix);
  let dropped = 0;
  for (const key of [...cache.keys()]) {
    if (key !== head && !key.startsWith(`${head}|`)) continue;
    const entry = cache.get(key)!;
    // An in-flight request is left to settle: its result is for the *old*
    // parameters but the refetch below supersedes it, and aborting here would
    // strand any caller awaiting that promise.
    entry.updatedAt = 0;
    entry.error = null;
    dropped += 1;
    notify(key);
  }
  return dropped;
}

/** Puts a value in the cache without fetching — for a detail already in a list. */
export function prime(key: QueryKey, data: unknown): void {
  const entry = entryFor(serialise(key));
  entry.data = data;
  entry.error = null;
  entry.updatedAt = Date.now();
  entry.revision += 1;
  notify(serialise(key));
}

/** Reads without subscribing. Returns `undefined` when nothing is cached. */
export function peek<T>(key: QueryKey): T | undefined {
  const entry = cache.get(serialise(key));
  return entry && entry.updatedAt > 0 ? (entry.data as T) : undefined;
}

/**
 * Empties the cache.
 *
 * **Called on sign-out, and that is not housekeeping.** Permissions are
 * resolved per request on the server, so a second user signing in on the same
 * tab gets correct *new* data — but anything still in this map was fetched
 * under the previous session and would be handed to them on the first render,
 * before the refetch lands. The cache is per-tab and in memory, so this is the
 * only thing that clears it.
 */
export function clearQueryCache(): void {
  const keys = [...cache.keys()];
  cache.clear();
  for (const key of keys) notify(key);
}

export type QueryState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Milliseconds since the epoch, or 0 when this key has never resolved. */
  updatedAt: number;
  /** Forces a refetch regardless of staleness. */
  refetch: () => void;
  /** Replaces the cached value locally — for an optimistic update. */
  set: (next: T) => void;
};

/**
 * Subscribes a component to one key.
 *
 * `key: null` disables the query, which is how a detail screen waits for an id
 * without breaking the rules of hooks.
 */
export function useQuery<T>(
  key: QueryKey | null,
  fetcher: () => Promise<T>,
  options: { staleMs?: number } = {},
): QueryState<T> {
  const { staleMs = 30_000 } = options;
  const serialised = key === null ? null : serialise(key);

  // The fetcher is a fresh closure on every render, so it cannot be a
  // dependency — the key is what identifies the request, which is the same
  // contract `useAsync` expressed as an explicit `deps` array.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const sync = useCallback(() => {
    if (!serialised) return;
    void load(serialised, () => fetcherRef.current(), staleMs);
    rerender();
  }, [serialised, staleMs]);

  useEffect(() => {
    if (!serialised) return;
    const unsubscribe = subscribe(serialised, sync);
    sync();
    return unsubscribe;
  }, [serialised, sync]);

  const refetch = useCallback(() => {
    if (!serialised) return;
    entryFor(serialised).updatedAt = 0;
    void load(serialised, () => fetcherRef.current(), staleMs);
    rerender();
  }, [serialised, staleMs]);

  const set = useCallback(
    (next: T) => {
      if (!serialised) return;
      const entry = entryFor(serialised);
      entry.data = next;
      entry.updatedAt = Date.now();
      entry.revision += 1;
      notify(serialised);
    },
    [serialised],
  );

  const entry = serialised ? cache.get(serialised) : undefined;
  const hasData = Boolean(entry && entry.updatedAt > 0);

  return {
    data: hasData ? (entry!.data as T) : null,
    // Stale-while-revalidate: a refetch over data already on screen is **not**
    // a loading state. Reporting it as one is what makes a list flash back to
    // a skeleton every time something near it is saved.
    loading: Boolean(serialised) && !hasData && !entry?.error,
    error: entry?.error?.message ?? null,
    updatedAt: entry?.updatedAt ?? 0,
    refetch,
    set,
  };
}
