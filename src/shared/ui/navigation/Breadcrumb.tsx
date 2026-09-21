export type Crumb = { label: string; to?: string };

/**
 * The trail above a detail record.
 *
 * The last crumb is the current page and is deliberately *not* a link: a link
 * to where you already are is a link that does nothing, and a screen reader
 * announces it as a destination.
 */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Brotkrumen">
      <ol className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
        {/*
          Keyed by position, not by label.

          A trail may legitimately repeat a word — a group and the page inside
          it can share a name, and there is a *transient* repeat on every
          two-segment route, because the last crumb's label comes from the
          screen through `usePageTitle` and until the screen has mounted it is
          still the route's own label. `key={item.label}` turned both into
          React's "two children with the same key" warning, which the console
          check in `screens.spec.ts` counts as a failure. The index is the
          right key here: this list is positional, never reordered, never
          filtered, and rebuilt from the route on every navigation.
        */}
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 ? (
              <span aria-hidden className="text-line-strong">
                /
              </span>
            ) : null}
            {item.to ? (
              <a href={`#${item.to}`} className="transition-colors hover:text-ink">
                {item.label}
              </a>
            ) : (
              <span className="text-ink">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
