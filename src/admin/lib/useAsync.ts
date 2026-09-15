import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

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
 * Every screen needs the same four things — data, a loading flag, an error
 * string and a way to reload — and writing that `useEffect` in fifteen files
 * is how three of them end up missing the cancellation guard. This is the one
 * copy.
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

/**
 * Wraps a mutating call: tracks the in-flight flag and surfaces field errors.
 *
 * Returns the server's per-field validation messages separately from the
 * general message, so a form can put each one beside its input rather than
 * showing a banner that says "check your entries" and leaves the reader
 * hunting.
 */
export function useMutation<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
): {
  run: (...args: Args) => Promise<T | null>;
  busy: boolean;
  error: string | null;
  fields: Record<string, string[]>;
  reset: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});

  const run = useCallback(
    async (...args: Args): Promise<T | null> => {
      setBusy(true);
      setError(null);
      setFields({});
      try {
        return await fn(...args);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
          setFields(err.fields ?? {});
        } else {
          setError(err instanceof Error ? err.message : "Unbekannter Fehler.");
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );

  const reset = useCallback(() => {
    setError(null);
    setFields({});
  }, []);

  return { run, busy, error, fields, reset };
}

/**
 * Delays a value, so a search box queries on a pause rather than a keystroke.
 *
 * 300 ms: below about 250 the request fires mid-word, above about 400 the
 * results feel detached from the typing.
 */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
