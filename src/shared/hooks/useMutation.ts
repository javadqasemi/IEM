import { useCallback, useState } from "react";
import { ApiError } from "@/core/api";

/**
 * Wraps a mutating call: tracks the in-flight flag and surfaces field errors.
 *
 * Returns the server's per-field validation messages separately from the
 * general message, so a form can put each one beside its input rather than
 * showing a banner that says "check your entries" and leaves the reader
 * hunting.
 *
 * It knows one transport concept — `ApiError` — and that is deliberate rather
 * than a leak: per-field validation messages are the reason this hook exists,
 * and a form layer that cannot read them is a form layer that shows banners.
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
