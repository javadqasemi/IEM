import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/core/api";

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
  loading: boolean;
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

  useEffect(() => {
    const id = ++run.current;
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
        setError(err instanceof Error ? err.message : "Unbekannter Fehler.");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload, set: setData };
}
