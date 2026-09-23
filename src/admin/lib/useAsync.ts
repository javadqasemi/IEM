import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, toFailure } from "@/core/api";

/**
 * The pre-cache loader.
 *
 * Superseded by `useQuery` in `@/core/api` (weakness W2) and kept for the
 * screens that have not moved to a feature folder yet. The difference that
 * matters: this re-runs on every mount, dedupes nothing, caches nothing and
 * cannot be invalidated, so a mutation on one screen cannot tell a sibling
 * that what it is showing is now false.
 *
 * It goes when the last screen leaves `src/admin/pages/`. Nothing new should
 * use it — `useQuery` is the same four return values plus the three that
 * matter.
 *
 * `useDebounced` and `useMutation` used to live here and moved to
 * `@/shared/hooks`: neither had anything to do with loading, and the features
 * need them without reaching into `src/admin`.
 */

export type AsyncState<T> = {
  data: T | null;
  /**
   * True only while there is **nothing** to show yet.
   *
   * A `reload()` over data already on screen is not a loading state — it used
   * to be, and every list and editor in `src/admin/pages` dropped to a
   * skeleton after every save, which unmounted whatever the reader had open
   * beside it (UX-03). That is `refreshing`.
   */
  loading: boolean;
  /** A reload is in flight over data that is still being shown. */
  refreshing: boolean;
  error: string | null;
  /** Re-runs the loader. */
  reload: () => void;
  /** Replaces the data locally, for optimistic updates. */
  set: (next: T) => void;
};

/**
 * Loads data, once per change of `deps`.
 *
 * Two behaviours worth knowing:
 *
 * - **Stale responses are dropped.** A request started before the last one is
 *   ignored when it lands, which is what stops fast typing in a search box
 *   from showing the results of an earlier keystroke.
 * - **A 401 is not reported.** The API client is already refreshing and
 *   retrying, or dropping the session; surfacing "Nicht angemeldet" in the
 *   middle of the screen while that happens would be noise.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);

  // The loader is a fresh closure on every render, so it cannot be a
  // dependency — `deps` is what the caller declares instead.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  /*
    Which of the two reasons to run this is.

    A change of `deps` asks a *different question* — another content type,
    another search — so the old answer is cleared: showing the team list while
    the jobs list loads would be showing the wrong list. A `reload()` asks the
    same question again, so the old answer stays up until the new one lands.
  */
  const lastDeps = useRef<unknown[] | null>(null);

  useEffect(() => {
    const id = ++run.current;
    const previous = lastDeps.current;
    const depsChanged =
      previous === null ||
      previous.length !== deps.length ||
      deps.some((dep, i) => !Object.is(dep, previous[i]));
    lastDeps.current = deps;
    if (depsChanged) setData(null);
    setLoading(true);
    setError(null);

    loaderRef
      .current()
      .then((result) => {
        if (id !== run.current) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (id !== run.current) return;
        if (err instanceof ApiError && err.status === 401) {
          setLoading(false);
          return;
        }
        setError(toFailure(err).message);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    data,
    loading: loading && data === null,
    refreshing: loading && data !== null,
    error,
    reload,
    set: setData,
  };
}
