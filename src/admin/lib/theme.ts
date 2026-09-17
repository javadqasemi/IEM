import { useCallback, useEffect, useState } from "react";

/**
 * The dashboard's light/dark theme.
 *
 * Three states, not two. "System" is a real choice and the default: a reader
 * who has set their machine to switch at dusk expects the tool to follow, and
 * collapsing it to a boolean on first load would freeze whichever value
 * happened to be true at that moment.
 *
 * **The palette is not here.** It lives as CSS custom properties in
 * `src/admin/admin.css`, and this file only decides which set is in force by
 * writing `data-theme` on `<html>`. That split is what kept the change to the
 * markup at twenty lines: `bg-surface` is still `bg-surface` everywhere, and
 * what `surface` *means* became a property of the document.
 *
 * The public site has no theme and is deliberately untouched — one appearance,
 * no switch, and its stylesheet is the one every visitor downloads.
 */

export type ThemeChoice = "light" | "dark" | "system";

/**
 * Shared with the inline script in `admin.html`, which cannot import it.
 *
 * That script runs before the bundle to stop a flash of the wrong theme, so
 * the key is spelled twice. `theme.test.ts` asserts this constant against the
 * literal in the HTML, so the two cannot drift apart without a test failing —
 * which is the cheap version of not being able to duplicate it at all.
 */
export const THEME_STORAGE_KEY = "iem.admin.theme";

export const THEME_CHOICES: { value: ThemeChoice; label: string; hint: string }[] = [
  { value: "system", label: "Automatisch", hint: "Folgt der Einstellung des Betriebssystems." },
  { value: "light", label: "Hell", hint: "Immer hell, unabhängig vom System." },
  { value: "dark", label: "Dunkel", hint: "Immer dunkel, unabhängig vom System." },
];

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Broadcast when the choice changes, so every mounted `useTheme` agrees.
 *
 * Two of them exist: the shell keeps one so the OS listener is always running,
 * and the profile page mounts another for its radio group. Without this the
 * shell's copy would keep the choice it read at mount — so picking "hell" on
 * the profile page, then having the machine switch to dark at dusk, would let
 * the shell's stale "system" listener overwrite the explicit choice.
 *
 * A `window` CustomEvent rather than a context, matching the seam the site
 * already uses between components that do not own each other (see
 * docs/ARCHITECTURE.md). `storage` events would not do: the browser fires those
 * only in *other* tabs, never the one that wrote.
 */
const THEME_EVENT = "iem:theme-changed";

function readChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* Private window, blocked site data. The default is correct. */
  }
  return "system";
}

function prefersDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** Which palette a choice resolves to right now. */
export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") return prefersDark() ? "dark" : "light";
  return choice;
}

/**
 * Writes the attribute the stylesheet keys off.
 *
 * Light removes the attribute rather than setting `data-theme="light"`: the
 * light palette is what `:root` declares, so its selector is the absence of
 * the dark one. One value to write, one state to reason about.
 */
function apply(resolved: "light" | "dark"): void {
  const root = document.documentElement;
  if (resolved === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");

  // Keeps form controls, scrollbars and the caret in step — the parts of the
  // page the browser paints rather than the stylesheet.
  root.style.colorScheme = resolved;
}

export function useTheme(): {
  choice: ThemeChoice;
  resolved: "light" | "dark";
  setChoice: (next: ThemeChoice) => void;
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(readChoice()));

  const setChoice = useCallback((next: ThemeChoice) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* A preference that cannot be remembered still applies to this tab. */
    }
    apply(resolveTheme(next));
    // Every instance updates from this, including the one that dispatched it —
    // so there is one path to the state rather than two that can disagree.
    window.dispatchEvent(new CustomEvent(THEME_EVENT));
  }, []);

  /** Re-reads the stored choice whenever any instance changes it. */
  useEffect(() => {
    const onChanged = () => {
      const next = readChoice();
      setChoiceState(next);
      setResolved(resolveTheme(next));
    };
    window.addEventListener(THEME_EVENT, onChanged);
    return () => window.removeEventListener(THEME_EVENT, onChanged);
  }, []);

  /**
   * Follows the OS while the choice is "system".
   *
   * Subscribed rather than read once, or a dashboard left open across dusk
   * would stay in the theme it was opened in. The listener is removed as soon
   * as the reader picks an explicit theme, so an OS change cannot override a
   * deliberate choice.
   */
  useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      const now = media.matches ? "dark" : "light";
      setResolved(now);
      apply(now);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);

  /**
   * Re-asserts the attribute once on mount.
   *
   * The inline script in `admin.html` has already set it, so this is normally
   * a no-op — but it is what makes the module correct on its own, in a preview
   * or a test harness where that script did not run.
   */
  useEffect(() => {
    apply(resolveTheme(readChoice()));
  }, []);

  return { choice, resolved, setChoice };
}
