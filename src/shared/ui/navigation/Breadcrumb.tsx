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
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-1.5">
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
