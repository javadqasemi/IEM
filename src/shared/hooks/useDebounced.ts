import { useEffect, useState } from "react";

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
