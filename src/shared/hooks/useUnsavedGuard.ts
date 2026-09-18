import { useCallback, useEffect, useRef, useState } from "react";
import { navigate, setNavigationBlocker } from "@/core/router";

/**
 * Stops a reader losing work by navigating away from a dirty form.
 *
 * Two halves, because the browser treats them as two different things:
 *
 * - **Leaving the page** — a reload, a closed tab, a typed URL. `beforeunload`
 *   covers it and the browser draws its own dialog; the message is not ours to
 *   choose and has not been for years.
 * - **Leaving the screen** — a click in the rail, a breadcrumb, a back button.
 *   The browser does *not* treat a hash change as a navigation, so
 *   `beforeunload` never fires. `ContentEditor` said so in a comment and worked
 *   around it with a "Verwerfen" dialog on its own back link, which covers one
 *   of the five ways out of that screen.
 *
 * The second half is what foundation stage F5 adds. The router holds one
 * blocker, consulted before any subscriber is told a navigation happened, so a
 * refused click leaves the address bar and the screen exactly where they were.
 *
 * ```tsx
 * const guard = useUnsavedGuard(form.dirty);
 * …
 * <ConfirmDialog
 *   open={guard.blocked !== null}
 *   onClose={guard.stay}
 *   onConfirm={guard.leave}
 *   title="Änderungen verwerfen?"
 * />
 * ```
 */
export type UnsavedGuard = {
  /** The path the reader tried to reach, or `null` when nothing is pending. */
  blocked: string | null;
  /** Dismiss the prompt and stay. */
  stay: () => void;
  /** Go anyway. The guard steps aside for exactly this one navigation. */
  leave: () => void;
};

export function useUnsavedGuard(active: boolean): UnsavedGuard {
  const [blocked, setBlocked] = useState<string | null>(null);

  // Read inside the blocker, which is registered once. Without the ref the
  // blocker would close over the first render's `active` and keep refusing
  // after the form was saved.
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    setNavigationBlocker((to) => {
      if (!activeRef.current) return true;
      setBlocked(to.path);
      return false;
    });
    // Cleared on unmount, so a screen that has left cannot keep refusing
    // navigations for the one that replaced it.
    return () => setNavigationBlocker(null);
  }, []);

  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  const stay = useCallback(() => setBlocked(null), []);

  const leave = useCallback(() => {
    const to = blocked;
    setBlocked(null);
    if (!to) return;
    // Stand down *before* navigating rather than after: the blocker is
    // consulted synchronously inside the hash change, so releasing afterwards
    // would refuse the very navigation it was released for.
    setNavigationBlocker(null);
    navigate(to);
  }, [blocked]);

  return { blocked, stay, leave };
}
