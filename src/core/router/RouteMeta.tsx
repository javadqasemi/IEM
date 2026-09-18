import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * What the screen tells the shell.
 *
 * Two things a route table cannot know because they depend on data the screen
 * fetched: the record's own name, and the actions that apply to it right now.
 * Both used to be impossible to put in the top bar at all, so every screen
 * rendered its own heading and its own buttons — which is why the audit
 * export scrolled out of reach exactly on the 200-row logs that need it.
 *
 * The shell reads; the screen writes. Nothing else may.
 */

export type PageAction = {
  /** Stable, so React can key it and a command palette can address it. */
  id: string;
  label: string;
  /** Hidden when the signed-in user does not hold it. */
  permission?: string;
  run: () => void;
  intent?: "primary" | "secondary" | "ghost";
  busy?: boolean;
  disabled?: boolean;
};

type RouteMetaState = {
  title: string | null;
  actions: PageAction[];
  setTitle: (title: string | null) => void;
  setActions: (actions: PageAction[]) => void;
};

const RouteMetaContext = createContext<RouteMetaState | null>(null);

export function RouteMetaProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const [actions, setActions] = useState<PageAction[]>([]);
  const value = useMemo<RouteMetaState>(
    () => ({ title, actions, setTitle, setActions }),
    [title, actions],
  );
  return <RouteMetaContext.Provider value={value}>{children}</RouteMetaContext.Provider>;
}

/**
 * Read by the shell.
 *
 * Returns empty values outside a provider rather than throwing: the render
 * smoke test mounts screens on their own, and a missing top bar is not a
 * reason for a screen to fail to render.
 */
export function useRouteMeta(): { title: string | null; actions: PageAction[] } {
  const ctx = useContext(RouteMetaContext);
  return { title: ctx?.title ?? null, actions: ctx?.actions ?? [] };
}

/**
 * Publishes the record's name for the last breadcrumb.
 *
 * `undefined` while loading, so the trail shows the route's own label until
 * the name arrives rather than flashing an empty crumb.
 */
export function usePageTitle(title: string | null | undefined): void {
  const ctx = useContext(RouteMetaContext);
  const set = ctx?.setTitle;
  useEffect(() => {
    if (!set) return;
    set(title ?? null);
    // Cleared on unmount, so navigating away cannot leave the previous
    // record's name in the trail of the next screen.
    return () => set(null);
  }, [set, title]);
}

/**
 * Publishes this screen's actions to the top bar.
 *
 * The caller owns the array's identity — build it with `useMemo` or the effect
 * re-runs on every render. That constraint is the same one `useAsync` states
 * about its `deps`, and for the same reason: a fresh closure every render is
 * not a dependency.
 */
export function usePageActions(actions: PageAction[]): void {
  const ctx = useContext(RouteMetaContext);
  const set = ctx?.setActions;
  useEffect(() => {
    if (!set) return;
    set(actions);
    return () => set([]);
  }, [set, actions]);
}

/** For a screen that wants to clear both — a redirect, or an error state. */
export function useClearPageMeta(): () => void {
  const ctx = useContext(RouteMetaContext);
  return useCallback(() => {
    ctx?.setTitle(null);
    ctx?.setActions([]);
  }, [ctx]);
}
