import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request } from "@/core/api";

export type SavedListView = {
  hidden?: string[];
  sort?: { field: string; dir: "asc" | "desc" };
  perPage?: number;
};

/**
 * One reader's saved view of one list (foundation stage F11).
 *
 * **Server-side, not `localStorage`.** A column arrangement that lives in the
 * browser is lost when the person opens the dashboard on the machine in the
 * meeting room, which is exactly when they need the view they built. It is a
 * row keyed by user and resource.
 *
 * Three behaviours the call sites would otherwise each get slightly wrong:
 *
 * **It renders the default immediately and applies the saved view when it
 * arrives.** Waiting would put a spinner over a table that has nothing to wait
 * for; the columns settle a moment later, which is the right trade for a
 * preference.
 *
 * **Saves are debounced.** Dragging through four columns in the picker is four
 * changes and one request. 600 ms rather than the search box's 300: nobody is
 * watching for the result, and the saving is a round trip either way.
 *
 * **A failed save is silent.** The view still works for this session — it is
 * local state that happens to be persisted. A toast saying "could not save
 * your column preference" is an interruption about something the reader did
 * not ask for.
 */
export function useListView(
  resource: string,
  defaults: SavedListView = {},
): {
  view: SavedListView;
  hidden: Set<string>;
  setHidden: (next: Set<string>) => void;
  setSort: (next: { field: string; dir: "asc" | "desc" }) => void;
  reset: () => void;
  /** True until the saved view has been fetched. The table renders regardless. */
  loading: boolean;
} {
  const [view, setView] = useState<SavedListView>(defaults);
  const [loading, setLoading] = useState(true);

  // The defaults are usually a literal, so a new object every render. Captured
  // once rather than depended on, or the effect below would refetch forever.
  const defaultsRef = useRef(defaults);

  useEffect(() => {
    let cancelled = false;
    request<SavedListView>(`/list-preferences/${resource}`)
      .then((saved) => {
        if (cancelled) return;
        setView({ ...defaultsRef.current, ...saved });
        setLoading(false);
      })
      .catch(() => {
        // No saved view, or the call failed. The default is a correct answer
        // to both, and the alternative is an error screen over a table that
        // works.
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resource]);

  const timer = useRef<number | undefined>(undefined);
  const persist = useCallback(
    (next: SavedListView) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void request(`/list-preferences/${resource}`, { method: "PUT", body: next }).catch(
          () => undefined,
        );
      }, 600);
    },
    [resource],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const update = useCallback(
    (patch: SavedListView) => {
      setView((previous) => {
        const next = { ...previous, ...patch };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setHidden = useCallback(
    (next: Set<string>) => update({ hidden: [...next] }),
    [update],
  );

  const setSort = useCallback(
    (next: { field: string; dir: "asc" | "desc" }) => update({ sort: next }),
    [update],
  );

  const reset = useCallback(() => {
    window.clearTimeout(timer.current);
    setView(defaultsRef.current);
    void request(`/list-preferences/${resource}`, { method: "DELETE" }).catch(() => undefined);
  }, [resource]);

  const hidden = useMemo(() => new Set(view.hidden ?? []), [view.hidden]);

  return { view, hidden, setHidden, setSort, reset, loading };
}
