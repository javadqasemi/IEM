import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * A hash router, in about a hundred lines.
 *
 * Deliberately not `react-router`: the dashboard needs a current path, a way to
 * navigate and path parameters, and a hash router needs no server rewrite rule
 * — which matters because `admin.html` is a static file that may sit behind any
 * host. It is also what the invitation and password-reset mails already link to
 * (`admin.html#/einladung?token=…`), so the shape was fixed before this file
 * existed.
 *
 * **What foundation stage F4 added** (weakness W11): the route table can now
 * express a *parent*, so a detail screen's trail and its "back" are derived
 * rather than written per screen; a screen can publish the record's own name
 * and its actions to the shell; and navigation resets the scroll position.
 * What is still missing, and is still an honest trade: data loaders, and
 * transitions. If the dashboard grows those needs, replace this — the surface
 * is `useRoute`, `navigate`, `<Link>` and the route table, and nothing else in
 * the application touches `window.location`.
 */

export type RouteLocation = {
  /** The path, without the leading `#`. Always starts with `/`. */
  path: string;
  /** Query parameters after the `?` *inside* the hash. */
  query: URLSearchParams;
};

function read(): RouteLocation {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, search] = raw.split("?");
  return {
    path: path.startsWith("/") ? path : `/${path}`,
    query: new URLSearchParams(search ?? ""),
  };
}

export function navigate(path: string, options: { replace?: boolean } = {}) {
  const next = `#${path.startsWith("/") ? path : `/${path}`}`;
  if (options.replace) {
    window.history.replaceState(null, "", next);
    // `replaceState` does not fire `hashchange`, so the subscribers have to be
    // told. Without this a redirect leaves the shell rendering the old screen.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = next;
  }
}

/**
 * One listener for the whole application, not one per `useRoute()` call.
 *
 * It used to be per-hook, which was harmless while nothing needed to *refuse*
 * a navigation. A guard cannot live in a hook: every `useRoute` subscriber
 * gets the same `hashchange`, the shell's runs first and re-renders to the new
 * screen, and a guard in a later one would be reverting a hash the application
 * has already acted on. With a single store there is one place that decides,
 * and it decides before anybody is told.
 *
 * Lazily read, because `src/admin/smoke.test.tsx` stubs `globalThis.window`
 * before rendering and a module-level read would run at import time instead.
 */
let location: RouteLocation | null = null;
const subscribers = new Set<() => void>();
let blocker: ((to: RouteLocation) => boolean) | null = null;

function current(): RouteLocation {
  /*
    The cache is only valid while the listener is attached.

    With no subscribers there is no `hashchange` handler, so a remembered
    location has no way of being right — a redirect, a test that sets the hash
    directly, or a render before any effect has run would all read a stale
    value. `src/admin/smoke.test.tsx` is the case that found this: it renders
    with `renderToStaticMarkup`, where effects never run, and four assertions
    about the rail silently measured the *first* test's route.
  */
  if (!subscribers.size) location = read();
  location ??= read();
  return location;
}

/**
 * Refuses navigations while something is unsaved.
 *
 * The callback returns `true` to allow. One at a time: two screens with unsaved
 * work cannot both be mounted, and a stack would make "who refused" unanswerable.
 * `useUnsavedGuard` in `shared/hooks` is the only intended caller.
 */
export function setNavigationBlocker(fn: ((to: RouteLocation) => boolean) | null): void {
  blocker = fn;
}

function handleHashChange() {
  const next = read();
  const previous = current();
  if (next.path !== previous.path && blocker && !blocker(next)) {
    /*
      Put the hash back without firing another `hashchange`.

      `replaceState` is silent, which is exactly what is wanted here: the
      address bar returns to where the reader still is, and no subscriber is
      told anything happened. `location` was never advanced, so nothing has
      rendered the screen they were refused.
    */
    const search = previous.query.toString();
    window.history.replaceState(null, "", `#${previous.path}${search ? `?${search}` : ""}`);
    return;
  }
  location = next;
  for (const fn of subscribers) fn();
}

function subscribe(fn: () => void): () => void {
  if (!subscribers.size) window.addEventListener("hashchange", handleHashChange);
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
    if (!subscribers.size) window.removeEventListener("hashchange", handleHashChange);
  };
}

export function useRoute(): RouteLocation {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribe(() => rerender((n) => n + 1));
    // The hash may already have changed between the first render and this
    // effect running — cheap to re-read rather than assume it has not.
    if (read().path !== current().path) handleHashChange();
    return unsubscribe;
  }, []);

  return current();
}

/**
 * Matches `path` against a pattern with `:name` segments.
 *
 * Returns the parameters, or `null` when it does not match. Exact-length match
 * only: `/inhalte/:type` does not match `/inhalte/projects/neu`, which keeps
 * the route table unambiguous without needing precedence rules.
 */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const a = path.split("/").filter(Boolean);
  if (p.length !== a.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) {
      params[p[i].slice(1)] = decodeURIComponent(a[i]);
    } else if (p[i] !== a[i]) {
      return null;
    }
  }
  return params;
}

/**
 * The inverse: `/inhalte/:type` + `{ type: "projects" }` → `/inhalte/projects`.
 *
 * What makes a parent link possible. A parameter the child has and the parent
 * does not is simply unused; a parameter the *parent* needs and nobody
 * supplied leaves the pattern unresolvable, and `null` is the honest answer —
 * a trail with `/inhalte/:type` in it is worse than a trail with one fewer
 * step.
 */
export function fillPattern(
  pattern: string,
  params: Record<string, string>,
): string | null {
  const segments = pattern.split("/").filter(Boolean);
  const out: string[] = [];
  for (const segment of segments) {
    if (!segment.startsWith(":")) {
      out.push(segment);
      continue;
    }
    const value = params[segment.slice(1)];
    if (value === undefined) return null;
    out.push(encodeURIComponent(value));
  }
  return `/${out.join("/")}`;
}

/** The first matching route, with its parameters. */
export function useMatch<T extends readonly string[]>(
  patterns: T,
): { pattern: T[number]; params: Record<string, string> } | null {
  const { path } = useRoute();
  return useMemo(() => {
    for (const pattern of patterns) {
      const params = match(pattern, path);
      if (params) return { pattern, params };
    }
    return null;
    // `patterns` is a literal array at every call site, so comparing by
    // content rather than identity avoids recomputing on every render.
  }, [path, patterns.join("|")]);
}

/**
 * Puts a new screen at the top of itself.
 *
 * Without it, opening a project from row 40 of a list renders the detail
 * already scrolled 1'200 px down, which reads as a broken page rather than as
 * a preserved position. Back is left alone deliberately: returning to a list
 * where you were is the behaviour people expect, and the browser restores it
 * for a hash change by itself.
 */
export function useScrollReset(path: string) {
  const [previous, setPrevious] = useState(path);
  useEffect(() => {
    if (path === previous) return;
    setPrevious(path);
    // `instant`, not smooth: a 300 ms animated jump on every navigation is
    // motion nobody asked for, and it fights `prefers-reduced-motion`.
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [path, previous]);
}

export function Link({
  to,
  children,
  className,
  onClick,
  ...rest
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  const handle = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Let the browser handle modified clicks — middle-click and ctrl-click
      // open a new tab, and a router that swallows them is a router people
      // fight with.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(to);
      onClick?.();
    },
    [to, onClick],
  );

  return (
    <a href={`#${to}`} onClick={handle} className={className} {...rest}>
      {children}
    </a>
  );
}
