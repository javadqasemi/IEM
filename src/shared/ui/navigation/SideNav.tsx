import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * A vertical sub-navigation, for a workspace that has more sections than a row
 * of tabs can carry.
 *
 * `Tabs` beside this file is the horizontal answer and stays the right one up
 * to about six destinations. Past that the labels either wrap or scroll
 * sideways, and a scrolling tab strip hides exactly the entries a newcomer
 * needs to discover — which is the failure the settings workspace would have
 * had at eleven sections.
 *
 * **Shape, not meaning.** It knows an item has a label, an href and possibly a
 * badge; it does not know what a setting is. That is what keeps it in
 * `shared/ui` rather than in the feature — `data/README` draws the same line
 * for `DataTable`.
 *
 * Two behaviours are deliberate and easy to lose:
 *
 * - **It is a `<nav>` of real links**, not buttons calling `navigate()`. A
 *   settings section is a URL somebody bookmarks and sends to a colleague, and
 *   an anchor is what makes middle-click, "open in new tab" and the browser's
 *   own back button work without a line of code.
 * - **`aria-current="page"`**, not a class alone. The active row is visually
 *   obvious and silent to a screen reader otherwise.
 *
 * At phone width it becomes a horizontally scrolling strip rather than
 * disappearing behind a menu: eleven short labels fit a swipe, and a second
 * disclosure to reach configuration is a tap nobody expects.
 */

export type SideNavItem = {
  id: string;
  label: string;
  href: string;
  /** Shown at the end of the row — a count, or a mark that something is unset. */
  badge?: ReactNode;
  /** Renders the row as unavailable and drops the link. */
  disabled?: boolean;
};

export type SideNavGroup = {
  id: string;
  /** `null` leaves the group unlabelled, for the first block. */
  label: string | null;
  items: SideNavItem[];
};

export function SideNav({
  groups,
  activeId,
  ariaLabel,
  className,
}: {
  groups: SideNavGroup[];
  /** The `id` of the item to mark current. */
  activeId: string | null;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        // The phone shape: one scrolling row. `-mx-4 px-4` lets the strip bleed
        // to the screen edge while its first and last rows keep the gutter, so
        // a swiped row is not clipped mid-label.
        "-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-0",
        className,
      )}
    >
      {groups.map((group) => (
        <div key={group.id} className="flex shrink-0 gap-1 lg:mt-5 lg:flex-col lg:gap-0.5 lg:first:mt-0">
          {group.label ? (
            <h2 className="eyebrow hidden px-3 pb-1.5 text-muted lg:block">{group.label}</h2>
          ) : null}
          {group.items.map((item) => {
            const active = item.id === activeId;
            const shared =
              "flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[13.5px] transition-colors lg:whitespace-normal";

            if (item.disabled) {
              return (
                <span
                  key={item.id}
                  aria-disabled
                  className={cn(shared, "cursor-not-allowed text-muted/60")}
                >
                  {item.label}
                  {item.badge}
                </span>
              );
            }

            return (
              <a
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  shared,
                  active
                    ? "bg-surface-2 font-medium text-ink"
                    : "text-muted hover:bg-surface-2/60 hover:text-ink",
                )}
              >
                <span className="min-w-0 truncate">{item.label}</span>
                {item.badge ? <span className="shrink-0">{item.badge}</span> : null}
              </a>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
