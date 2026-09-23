import { useCallback, useState } from "react";
import { toFailure, type MutationFailure, type MutationResult } from "@/core/api";

/**
 * Wraps a mutating call: tracks the in-flight flag and reports the outcome.
 *
 * **`run` resolves to a result, never to `null`.** It used to return
 * `T | null`, and a `null` is a value a caller can simply not look at —
 * which fourteen of them did, showing "Gelöscht" or "Reihenfolge gespeichert"
 * straight after an `await` that had failed. A `MutationResult` has no `data`
 * until it has been narrowed on `ok`, so the success path has to be written
 * as one; `src/architecture.test.ts` fails a call whose result is discarded,
 * which is the one shape the type cannot catch on its own.
 *
 * The per-field messages are still exposed separately (`fields`), so a form
 * can put each one beside its input rather than showing a banner that says
 * "check your entries" and leaves the reader hunting. `error` is the
 * sentence for everything that is not a field — already normalised by
 * `toFailure`, so a 5xx or a dropped connection reads as German and says the
 * input is still there, rather than `Failed to fetch`.
 */
/** One object, so a caller's effect that depends on `fields` does not re-run every render. */
const NO_FIELDS: Record<string, string[]> = Object.freeze({}) as Record<string, string[]>;

export function useMutation<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
): {
  run: (...args: Args) => Promise<MutationResult<T>>;
  busy: boolean;
  /** The last failure's sentence, or `null`. Cleared when the next run starts. */
  error: string | null;
  /** The last failure, whole — `kind` tells a conflict from a refusal. */
  failure: MutationFailure | null;
  fields: Record<string, string[]>;
  reset: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MutationFailure | null>(null);

  const run = useCallback(
    async (...args: Args): Promise<MutationResult<T>> => {
      setBusy(true);
      setFailure(null);
      try {
        const data = await fn(...args);
        return { ok: true, data };
      } catch (err) {
        const next = toFailure(err);
        setFailure(next);
        return { ok: false, failure: next };
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );

  const reset = useCallback(() => setFailure(null), []);

  return {
    run,
    busy,
    error: failure?.message ?? null,
    failure,
    fields: failure?.fields ?? NO_FIELDS,
    reset,
  };
}
