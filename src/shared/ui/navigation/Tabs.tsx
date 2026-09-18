import { cn } from "@/shared/utils/cn";

/**
 * A real tab strip: it switches a panel in place and therefore carries
 * `role="tab"`.
 *
 * The rail's group entries and a detail record's section links look similar and
 * are **not** this — they change the route, so they are anchors in a `<nav>`.
 * Giving those `role="tab"` tells a screen reader a panel is about to swap when
 * in fact the page navigates.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: { value: T; label: string; count?: number }[];
  active: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map((tab) => {
        const isActive = tab.value === active;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-[14px] font-medium transition-colors",
              isActive
                ? "border-accent text-ink"
                : "border-transparent text-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className={cn("font-mono text-[11px] tnum", isActive ? "text-brand-blue" : "text-muted/70")}>
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
