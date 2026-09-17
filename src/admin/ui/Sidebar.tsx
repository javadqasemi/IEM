import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Link } from "../lib/router";
import {
  ICONS,
  ZONES,
  flattenNavigation,
  isActive,
  sectionHref,
  type NavItem,
  type NavSection,
} from "../lib/navigation";

/**
 * The rail: search, favourites, history, and the main groups.
 *
 * **Main groups only.** What is inside a group is rendered across the top of
 * that group's page by `SectionTabs`, not here. The rail therefore stays about
 * a dozen rows long however many content types exist — thirty-six entries
 * nested under folding headings was a menu you had to operate before you could
 * read it.
 *
 * Search still reaches every destination, including the ones the rail no longer
 * lists. That is the point of keeping it: typing "Fussbereich" is faster than
 * opening the group that holds it, and a favourite pins a specific page rather
 * than the group it lives in.
 *
 * Favourites and history persist per browser in `localStorage`. Both are
 * conveniences — the menu is complete without either — so every access is
 * wrapped and a browser that refuses storage simply gets the defaults. None of
 * it leaves the machine.
 */

/* ------------------------------------------------------------------ */
/* Per-browser preferences                                             */
/* ------------------------------------------------------------------ */

const KEY = {
  favorites: "iem.nav.favorites",
  recent: "iem.nav.recent",
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // Private windows, blocked site data, a quota error mid-write leaving
    // invalid JSON. None of it is worth a broken menu.
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* A preference that cannot be remembered is not an error worth raising. */
  }
}

function usePersisted<T>(key: string, fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  const set = useCallback(
    (next: T) => {
      setValue(next);
      write(key, next);
    },
    [key],
  );
  return [value, set];
}

const RECENT_LIMIT = 5;

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Glyph({ name }: { name: string }) {
  const d = ICONS[name as keyof typeof ICONS] ?? ICONS.content;
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

/**
 * The active row is marked by a bar down its left edge, not by its fill alone.
 *
 * The wordmark is a raster of tapering vertical bars, so a bar is the house
 * mark rather than a decoration borrowed from somewhere else — and it puts the
 * "you are here" signal in one column the eye can run down, instead of asking
 * it to spot which of thirteen rows is a shade lighter. Both states carry the
 * 2px border so that becoming active does not shift the label sideways.
 */
const ROW =
  "group/row flex w-full items-center gap-3 rounded-md border-l-2 py-2 pl-3 pr-8 text-left text-[14px] transition-colors";
const ROW_IDLE = "border-transparent text-inverse/65 hover:bg-surface/[0.07] hover:text-inverse";
const ROW_ACTIVE = "border-brand-sand bg-surface/[0.14] font-medium text-inverse";

function SidebarRow({
  item,
  active,
  icon,
  starred,
  onToggleStar,
}: {
  item: NavItem;
  active: boolean;
  icon?: string;
  starred: boolean;
  onToggleStar: (id: string) => void;
}) {
  return (
    <li className="relative">
      <Link
        to={item.to}
        data-nav-link
        aria-current={active ? "page" : undefined}
        className={cn(ROW, active ? ROW_ACTIVE : ROW_IDLE)}
      >
        {icon ? (
          <span aria-hidden className="shrink-0 opacity-80">
            <Glyph name={icon} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.badge ? (
          <span className="shrink-0 rounded-full bg-brand-sand px-1.5 py-0.5 font-mono text-[10px] tnum font-medium text-admin-rail">
            {item.badge}
          </span>
        ) : null}
      </Link>

      {/* Outside the link: a control nested inside an anchor is not something a
          keyboard or a screen reader can reach separately. The row reserves
          `pr-8` for it, so it never lands on top of the label or the count. */}
      <button
        type="button"
        onClick={() => onToggleStar(item.id)}
        aria-pressed={starred}
        title={starred ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
        className={cn(
          "absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 transition-opacity",
          "focus-visible:opacity-100 group-hover/row:opacity-100",
          starred ? "text-brand-sand opacity-100" : "text-inverse/40 opacity-0 hover:text-inverse",
        )}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 18 18"
          aria-hidden
          fill={starred ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        >
          <path d={ICONS.star} />
        </svg>
        <span className="sr-only">
          {starred ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
        </span>
      </button>
    </li>
  );
}

/**
 * A block heading.
 *
 * Deliberately *not* the dashboard's `.eyebrow` (mono, uppercase,
 * ultra-tracked). That signature earns its keep over a page heading, where it
 * has room and one job; three of them stacked in a rail this narrow shout over the
 * links they are meant to organise, and uppercase costs the word shape that
 * makes a heading skimmable in the first place. Sentence case, one step down
 * in size, well under the weight of the rows beneath it.
 */
function Heading({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1.5 pt-5 text-[11px] font-medium tracking-wide text-inverse/40">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* The rail                                                            */
/* ------------------------------------------------------------------ */

export function Sidebar({ sections, path }: { sections: NavSection[]; path: string }) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [favorites, setFavorites] = usePersisted<string[]>(KEY.favorites, []);
  const [recent, setRecent] = usePersisted<string[]>(KEY.recent, []);
  const nav = useRef<HTMLElement>(null);

  const all = useMemo(() => flattenNavigation(sections), [sections]);
  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);

  // History, recorded when the route settles on a known destination. A deep
  // link into an editor (`/inhalte/projects/abc`) credits the list it belongs
  // to, which is the thing worth returning to.
  const recentRef = useRef(recent);
  recentRef.current = recent;
  useEffect(() => {
    // `i.exact` matters here too: without it a visit to `/inhalte/team` would
    // be credited to "Website bearbeiten", which sorts earlier, and the
    // history would remember the index instead of the list actually opened.
    const hit = all.find((i) => isActive(i.to, path, i.exact));
    if (!hit) return;
    const next = [hit.id, ...recentRef.current.filter((id) => id !== hit.id)].slice(0, RECENT_LIMIT);
    if (next.join("|") !== recentRef.current.join("|")) setRecent(next);
  }, [path, all, setRecent]);

  // Arriving somewhere closes the panel and empties the box. Without this,
  // following a result leaves the rail showing the search it just answered
  // instead of the menu, with the new page's row hidden behind it — the same
  // mistake the mobile rail avoids by closing itself on a route change.
  useEffect(() => {
    setSearching(false);
    setQuery("");
  }, [path]);

  const toggleStar = useCallback(
    (id: string) =>
      setFavorites(
        favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id],
      ),
    [favorites, setFavorites],
  );

  /**
   * Up and down move between rows; Home and End jump to the ends.
   *
   * Read off the DOM rather than from an index into the model, because what is
   * present depends on the search term — and the DOM already knows.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Esc dismisses the panel before anything else acts on the key. The shell
    // also listens for Esc on `window` to close the rail on a phone; stopping
    // propagation here means one press closes the search and a second closes
    // the rail, rather than both going at once.
    if (e.key === "Escape" && (searching || query)) {
      e.stopPropagation();
      setQuery("");
      setSearching(false);
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const links = Array.from(nav.current?.querySelectorAll<HTMLElement>("[data-nav-link]") ?? []);
    if (!links.length) return;
    const at = links.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    const to =
      e.key === "Home" ? 0
      : e.key === "End" ? links.length - 1
      : e.key === "ArrowDown" ? (at + 1) % links.length
      : (at - 1 + links.length) % links.length;
    links[to]?.focus();
  };

  const q = query.trim().toLowerCase();
  const matches = q ? all.filter((i) => i.label.toLowerCase().includes(q)) : [];
  const starred = favorites.map((id) => byId.get(id)).filter((i): i is NavItem => Boolean(i));
  const history = recent
    .map((id) => byId.get(id))
    .filter((i): i is NavItem => Boolean(i))
    .filter((i) => !favorites.includes(i.id));

  /**
   * The panel replaces the menu while the box has focus or holds a term.
   *
   * History used to be a permanent block at the foot of the rail — a heading
   * and up to five rows, below thirteen others, answering a question nobody
   * asks while looking at a complete menu. It answers "where was I?", which is
   * asked at the search box, so that is where it now lives. The rail's resting
   * state is thirteen rows and two headings; everything else is one keystroke
   * away.
   */
  const panel = searching || Boolean(q);

  return (
    <nav
      ref={nav}
      aria-label="Hauptnavigation"
      onKeyDown={onKeyDown}
      className="scroll-thin flex-1 overflow-y-auto px-3 py-4"
    >
      <label className="relative block">
        <span className="sr-only">Navigation durchsuchen</span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-inverse/40"
        >
          <path d={ICONS.seo} />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setSearching(true)}
          onBlur={(e) => {
            // Focus moving to something else inside the rail keeps the panel
            // up — otherwise the blur would tear down the list a click on a
            // result is still travelling towards.
            if (!nav.current?.contains(e.relatedTarget as Node | null)) setSearching(false);
          }}
          placeholder="Suchen …"
          className="w-full rounded-md bg-surface/[0.07] py-1.5 pl-8 pr-2.5 text-[13px] text-inverse
                     placeholder:text-inverse/40 focus:bg-surface/[0.12] focus:outline-none
                     focus:ring-1 focus:ring-surface/25"
        />
      </label>

      {panel ? (
        q ? (
          <>
            <Heading>{matches.length ? "Treffer" : "Kein Treffer"}</Heading>
            {matches.length ? (
              <ul className="flex flex-col gap-0.5">
                {matches.map((item) => (
                  <SidebarRow
                    key={item.id}
                    item={item}
                    active={isActive(item.to, path, item.exact)}
                    starred={favorites.includes(item.id)}
                    onToggleStar={toggleStar}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-3 pt-1 text-[13px] text-inverse/45">Nichts im Menü heisst so.</p>
            )}
          </>
        ) : history.length ? (
          <>
            <Heading>Zuletzt besucht</Heading>
            <ul className="flex flex-col gap-0.5">
              {history.map((item) => (
                <SidebarRow
                  key={`recent:${item.id}`}
                  item={item}
                  active={isActive(item.to, path, item.exact)}
                  starred={false}
                  onToggleStar={toggleStar}
                />
              ))}
            </ul>
          </>
        ) : (
          <p className="px-3 pt-5 text-[13px] leading-relaxed text-inverse/45">
            Jede Seite des Dashboards ist über die Suche erreichbar — auch die, die das Menü nicht
            auflistet.
          </p>
        )
      ) : (
        <>
          {starred.length ? (
            <>
              <Heading>Favoriten</Heading>
              <ul className="flex flex-col gap-0.5">
                {starred.map((item) => (
                  <SidebarRow
                    key={`fav:${item.id}`}
                    item={item}
                    active={isActive(item.to, path, item.exact)}
                    starred
                    onToggleStar={toggleStar}
                  />
                ))}
              </ul>
            </>
          ) : null}

          {/* One block per zone, in `ZONES` order. A zone whose rows were all
              filtered away by permissions disappears with its heading, the same
              rule `buildNavigation` applies to an emptied group — and `hidden`
              is absent from `ZONES`, so those sections are searchable without
              ever being drawn. */}
          {ZONES.map((zone) => {
            const rows = sections.filter((s) => s.zone === zone.id);
            if (!rows.length) return null;
            return (
              <div key={zone.id}>
                {zone.label ? <Heading>{zone.label}</Heading> : null}
                <ul className={cn("flex flex-col gap-0.5", !zone.label && "pt-3")}>
                  {rows.map((section) => {
                    const to = sectionHref(section);
                    if (!to) return null;
                    // The group is lit by anything inside it, not only by its
                    // own route — otherwise opening the second entry of a group
                    // would leave the rail showing nothing selected.
                    const active =
                      (section.to ? isActive(section.to, path, section.exact) : false) ||
                      section.items.some((i) => isActive(i.to, path, i.exact));
                    return (
                      <SidebarRow
                        key={section.id}
                        item={{
                          id: section.id,
                          to,
                          label: section.label,
                          permissions: section.permissions,
                          badge: section.badge,
                          exact: section.exact,
                        }}
                        icon={section.icon}
                        active={active}
                        starred={favorites.includes(section.id)}
                        onToggleStar={toggleStar}
                      />
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </>
      )}
    </nav>
  );
}
