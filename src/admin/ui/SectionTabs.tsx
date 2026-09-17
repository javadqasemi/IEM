import { cn } from "../lib/cn";
import { Link } from "../lib/router";
import { isActive, type NavSection } from "../lib/navigation";

/**
 * The entries of the current main group, in the shell's top bar.
 *
 * The rail carries the groups; this carries what is inside the one that is
 * open. Three consequences of that split are worth stating.
 *
 * **These are links, not tabs.** They are anchors in a `<nav>`, not
 * `role="tab"` buttons. A tab switches a panel that is already on the page;
 * these change the route. Borrowing the ARIA would promise a `tabpanel`
 * relationship that does not exist, and would cost the things a link gives for
 * free: a middle click, a bookmark, a legible status bar.
 *
 * **They are one segmented control, not loose pills.** They used to sit above
 * the page content and mirrored `Tabs` in `primitives.tsx` — a bottom rule with
 * the active entry underlined. That treatment needs a rule to sit on, and there
 * is none in the middle of the top bar, so an underline there would read as an
 * artefact rather than a state. They then became separated pills, which put the
 * entries of one group at the same visual weight as the unrelated controls
 * either side of them in the bar. Now they are butted together inside a single
 * outlined track: one object that says "these belong to each other", set
 * against the group's name on its left and the account button on its right.
 *
 * The active segment is `glass-lens` — the one element in the shell that sits
 * *in front of* the glass instead of being it, and the only thing in the bar
 * that catches the light. The rest stay transparent until hovered, so the track
 * reads as one pane with a single lit spot rather than as a row of competing
 * chips.
 *
 * Two details carry the segmented look and are easy to undo by accident.
 *
 * *The seam is drawn per segment, not with `divide-x`.* Each segment owns the
 * hairline on its own left edge, and that hairline is dropped on **both** sides
 * of the lit one so the fill reads as a solid block instead of a rectangle with
 * a light scratch down its edge. `divide-x` cannot express that: it selects
 * `& > * + *` at a specificity a single `border-l-0` utility cannot beat, so
 * the exception would silently not apply.
 *
 * *The ends are rounded on the first and last segments, not clipped with
 * `overflow-hidden` on the track.* Clipping is the shorter spelling and it
 * breaks the focus ring — `:focus-visible` in `admin.css` uses
 * `outline-offset: 2px`, which lands outside the track and would be cut off on
 * every segment.
 *
 * **It renders nothing for a group with no entries.** "Übersicht" and "Medien"
 * are single pages; a bar with one item in it is furniture, not navigation.
 * `AdminLayout` still names the section beside it, so those pages are not left
 * without a label in the bar.
 *
 * The ordering and width classes belong to the shell's one-row/two-row reflow
 * and are documented at its call site in `AdminLayout`.
 */
export function SectionTabs({ section, path }: { section: NavSection | null; path: string }) {
  if (!section || section.items.length < 2) return null;

  // Resolved once for the whole row, because a segment's seam depends on its
  // neighbour's state as well as its own. `isActive` is prefix-matching unless
  // the entry sets `exact`, so this deliberately does not assume a single hit —
  // each segment still answers for itself, exactly as before.
  const lit = section.items.map((item) => isActive(item.to, path, item.exact));
  const last = section.items.length - 1;

  return (
    <nav
      aria-label={`${section.label} — Unterbereiche`}
      // Its own horizontal scroll: "Unternehmen" holds six entries and
      // "Beschriftungen" could hold thirteen, and at phone width they must
      // scroll rather than push the page sideways.
      className="scroll-thin order-4 w-full overflow-x-auto lg:order-3 lg:w-auto lg:flex-1"
    >
      {/*
        `w-max` and nothing else: the track hugs its segments. It used to carry
        `min-w-full` too, which was invisible while the entries were loose pills
        but would now stretch the outline across the whole of the bar's free
        space — `lg:flex-1` on the nav — leaving a wide empty track with the
        segments bunched at its left end.

        `items-stretch` (the flex default, stated because it is load-bearing
        here) is what makes every segment the height of the tallest, so the
        seams run the full height of the track rather than floating in it.
      */}
      <ul className="flex w-max items-stretch rounded-full ring-1 ring-line">
        {section.items.map((item, i) => {
          const active = lit[i];
          return (
            <li key={item.id} className="flex">
              <Link
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  // The ends of the track. No `overflow-hidden` above, so these
                  // are what keep the fill inside the outline's radius.
                  i === 0 && "rounded-l-full pl-4",
                  i === last && "rounded-r-full pr-4",
                  // The seam, owned by the segment to its right. It is always
                  // *present* and only sometimes *coloured*: hiding it with
                  // `border-l-0` would make the two segments either side of the
                  // lit one a pixel narrower than the rest, and every segment
                  // after them would jump sideways as you move along the row.
                  // Transparent over `glass-lens` shows the fill through it —
                  // `background-clip` is `border-box` by default — so the lit
                  // segment reads as one solid block.
                  i > 0 && "border-l",
                  i > 0 && (!active && !lit[i - 1] ? "border-line" : "border-transparent"),
                  // No `bg-` on the active branch: `glass-lens` lives in the
                  // `components` layer, which Tailwind emits before
                  // `utilities`, so any `bg-` utility here would win and
                  // flatten the lens.
                  active
                    ? "glass-lens text-inverse"
                    : "text-muted hover:bg-surface/70 hover:text-ink",
                )}
              >
                {item.label}
                {item.badge ? (
                  <span
                    className={cn(
                      "font-mono text-[11px] tnum",
                      active ? "text-inverse/70" : "text-muted/70",
                    )}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
