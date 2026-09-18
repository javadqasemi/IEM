import { fillPattern } from "./router";

/**
 * Breadcrumbs, derived from the route table.
 *
 * A parallel structure listing the trail for each screen is a structure that
 * goes out of date — the route moves and the crumb still points at the old
 * path, with nothing to notice. So a route names its `parent` and the trail is
 * walked from it.
 *
 * `crumb` is for the label that depends on the URL (`projects` →
 * "Projekte"); the label that depends on the *record* — an entry's title, a
 * project's name — is published by the screen through `usePageTitle`, because
 * only the screen has fetched it.
 */

export type Crumb = { label: string; to?: string };

export type CrumbRoute = {
  pattern: string;
  label: string;
  /** A pattern in the same table. Must not cycle. */
  parent?: string;
  /**
   * Overrides `label` for a screen the URL can name.
   *
   * `labels` is a dictionary the shell supplies — content type keys to their
   * German names, today. It exists because the *middle* of a trail cannot use
   * `usePageTitle`: on `/inhalte/projects/abc` the editor knows its entry's
   * title, and nothing on that screen is going to publish the label for the
   * list above it. The shell has already fetched the content types to build
   * the menu, so it is the one place that knows both.
   */
  crumb?: (params: Record<string, string>, labels: Record<string, string>) => string;
};

/**
 * Walks `parent` upwards from the matched route and returns the trail, root
 * first. The last crumb is the current page and carries no `to` — a link to
 * where you already are is a link that does nothing, and a screen reader
 * announces it as a destination.
 *
 * `title` replaces the last label when a screen has published one.
 */
export function buildTrail(
  routes: readonly CrumbRoute[],
  pattern: string,
  params: Record<string, string>,
  options: { title?: string | null; labels?: Record<string, string> } = {},
): Crumb[] {
  const { title, labels = {} } = options;
  const byPattern = new Map(routes.map((route) => [route.pattern, route]));
  const chain: CrumbRoute[] = [];

  let current = byPattern.get(pattern);
  // A route table is hand-written and a typo in `parent` is a hang, not an
  // error. Bounded rather than trusted, and the bound is generous enough that
  // no legitimate trail reaches it.
  const seen = new Set<string>();
  while (current && !seen.has(current.pattern) && chain.length < 10) {
    seen.add(current.pattern);
    chain.unshift(current);
    current = current.parent ? byPattern.get(current.parent) : undefined;
  }

  return chain.map((route, index) => {
    const last = index === chain.length - 1;
    const label = last && title ? title : (route.crumb?.(params, labels) ?? route.label);
    const to = last ? undefined : (fillPattern(route.pattern, params) ?? undefined);
    return { label, to };
  });
}
