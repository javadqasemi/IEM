import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * A hash router, in about eighty lines.
 *
 * Deliberately not `react-router`: the dashboard needs exactly three things —
 * a current path, a way to navigate, and path parameters — and a hash router
 * needs no server rewrite rule, which matters because `admin.html` is a static
 * file that may sit behind any host. It is also what the invitation and
 * password-reset mails already link to (`admin.html#/einladung?token=…`), so
 * the shape was fixed before this file existed.
 *
 * The trade is real and worth stating: no nested routes, no data loaders, no
 * scroll restoration. If the dashboard ever grows those needs, replace this —
 * the surface is `useRoute`, `navigate` and `<Link>`, and nothing else in the
 * application touches `window.location`.
 */

export type Route = {
  /** The path, without the leading `#`. Always starts with `/`. */
  path: string;
  /** Query parameters after the `?` *inside* the hash. */
  query: URLSearchParams;
};

function read(): Route {
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

export function useRoute(): Route {
  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    // The hash may already have changed between the first render and this
    // effect running — cheap to re-read rather than assume it has not.
    onChange();
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
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
