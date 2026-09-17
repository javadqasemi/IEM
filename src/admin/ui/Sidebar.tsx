import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
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
 * **Groups fold open in place.** A group's entries are nested under it, one
 * group at a time — see `SidebarGroup` for why that replaced rendering them in
 * the shell's top bar, and for what keeps the rail short with thirty-six
 * content types in it.
 *
 * Search still reaches every destination, including those inside a group that
 * is closed. That is the point of keeping it: typing "Fussbereich" is faster
 * than opening the group that holds it, and a favourite pins a specific page
 * rather than the group it lives in.
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
  /** The group left unfolded. `null` means "whichever the route is in". */
  openGroup: "iem.nav.openGroup",
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
const ROW_IDLE = "border-transparent text-inverse/65 hover:bg-inverse/[0.07] hover:text-inverse";
const ROW_ACTIVE = "border-brand-sand bg-inverse/[0.14] font-medium text-inverse";

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
 * A group that folds open to show its entries.
 *
 * The rail used to list main groups only and render a group's entries across
 * the shell's top bar. That was a deliberate answer to a real problem — thirty-six
 * content types nested under folding headings is a menu you have to operate
 * before you can read it — and it is replaced here on an equally deliberate
 * one: a top bar can only ever show the group you are *already in*, so reaching
 * another group's third page costs two navigations and a guess. With nineteen
 * modules ahead of the four that exist, that compounds.
 *
 * Three things keep the original objection answered:
 *
 * - **One group open at a time.** Opening a group closes the others, so the
 *   rail is never longer than its groups plus one group's entries. Without this
 *   the Website block alone unfolds to thirty-six rows.
 * - **The open group is the one you are in.** No state to manage in the common
 *   case: navigating opens the right group and closes the last one.
 * - **The choice is remembered per browser**, like favourites and history, so
 *   deliberately opening a group you are not in survives a reload.
 *
 * A foldable group's row is **a disclosure, not a link** — see the note inside
 * on why standing for its first entry put two links to the same page in one
 * block. A section with a single destination stays exactly the link it was.
 */
function SidebarGroup({
  section,
  path,
  open,
  onToggle,
  starred,
  onToggleStar,
}: {
  section: NavSection;
  path: string;
  open: boolean;
  onToggle: () => void;
  starred: (id: string) => boolean;
  onToggleStar: (id: string) => void;
}) {
  const active =
    (section.to ? isActive(section.to, path, section.exact) : false) ||
    section.items.some((i) => isActive(i.to, path, i.exact));

  // A group with one entry is not worth a fold: the row can simply go there.
  const foldable = section.items.length > 1;
  const panelId = `nav-group-${section.id}`;

  /**
   * A foldable group is a **disclosure, not a link**.
   *
   * `sectionHref` makes a group stand for its first entry, which was right when
   * the entries were not in the rail: every row was a real destination and
   * nothing was unreachable. With the entries folded in underneath, it puts two
   * adjacent links to the same page in the same block — "Benutzer & Rollen" and
   * "Benutzer" both pointing at `#/benutzer` — which is the duplicated
   * navigation this change set out to remove, and it makes the group's own row
   * answer to a page that is really one of its children.
   *
   * So the whole row toggles, and the entries inside are the links. Nothing
   * becomes unreachable: every destination is still an anchor, still
   * middle-clickable, still bookmarkable, one level down. It is also the
   * pattern the spec's reference products use, and a far larger hit target
   * than a 24px chevron.
   */
  if (foldable) {
    return (
      <li className="relative">
        <button
          type="button"
          data-nav-link
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className={cn(ROW, active ? ROW_ACTIVE : ROW_IDLE)}
        >
          <span aria-hidden className="shrink-0 opacity-80">
            <Glyph name={section.icon} />
          </span>
          <span className="min-w-0 flex-1 truncate">{section.label}</span>
          {section.badge ? (
            <span className="shrink-0 rounded-full bg-brand-sand px-1.5 py-0.5 font-mono text-[10px] tnum font-medium text-admin-rail">
              {section.badge}
            </span>
          ) : null}
          {/*
            Inside the button, in the `pr-8` the row already reserves. It was
            briefly its own control beside the label with the row widened to
            `pr-14`, which cost every foldable label 24px — at this rail width
            the difference between "Unternehmen" and "Unternehm…", on six of the
            eight groups.
          */}
          <span
            aria-hidden
            className="absolute right-2 top-1/2 -translate-y-1/2 text-inverse/45"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn("transition-transform", open && "rotate-90")}
            >
              <path d="M4 2.5 L8 6 L4 9.5" />
            </svg>
          </span>
        </button>

        {/*
          Unmounted when closed rather than hidden with CSS. The rail's keyboard
          navigation reads `[data-nav-link]` off the DOM, so a hidden-but-present
          entry would be a stop on a journey through rows nobody can see.
        */}
        {open ? (
          <ul id={panelId} className="mt-0.5 flex flex-col gap-0.5">
            {section.items.map((item) => (
              <SidebarSubRow
                key={item.id}
                item={item}
                active={isActive(item.to, path, item.exact)}
                starred={starred(item.id)}
                onToggleStar={onToggleStar}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  /**
   * A single-destination section is a plain row, exactly as before — and it
   * keeps its favourite star, because it is a page. A *group* is not a page,
   * so it is no longer starrable: the entries inside it are, individually,
   * which is both more precise and what the star was always for.
   */
  const to = sectionHref(section);
  if (!to) return null;

  return (
    <SidebarRow
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
      starred={starred(section.id)}
      onToggleStar={onToggleStar}
    />
  );
}

/**
 * One entry inside an open group.
 *
 * Indented to the group's icon column rather than to its label, and carrying a
 * hairline down that column: at this rail width the indent alone is four or
 * five pixels of difference, which is not enough to read as nesting. The rule
 * is what makes the block legible as "these belong to the row above".
 *
 * No icon. Giving every entry one would put twelve near-identical glyphs in a
 * column and cost the indent its meaning — the group's icon is the block's
 * mark, and the entries are text under it.
 */
function SidebarSubRow({
  item,
  active,
  starred,
  onToggleStar,
}: {
  item: NavItem;
  active: boolean;
  starred: boolean;
  onToggleStar: (id: string) => void;
}) {
  return (
    <li className="relative ml-[1.35rem] border-l border-inverse/15 pl-2">
      <Link
        to={item.to}
        data-nav-link
        aria-current={active ? "page" : undefined}
        className={cn(
          "group/row flex w-full items-center gap-2 rounded-md py-1.5 pl-2 pr-7 text-left text-[13px] transition-colors",
          active
            ? "bg-inverse/[0.14] font-medium text-inverse"
            : "text-inverse/55 hover:bg-inverse/[0.07] hover:text-inverse",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.badge ? (
          <span className="shrink-0 rounded-full bg-brand-sand px-1.5 py-0.5 font-mono text-[10px] tnum font-medium text-admin-rail">
            {item.badge}
          </span>
        ) : null}
      </Link>

      <button
        type="button"
        onClick={() => onToggleStar(item.id)}
        aria-pressed={starred}
        title={starred ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
        className={cn(
          "absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-1 transition-opacity",
          "focus-visible:opacity-100 group-hover/row:opacity-100",
          starred ? "text-brand-sand opacity-100" : "text-inverse/40 opacity-0 hover:text-inverse",
        )}
      >
        <svg
          width="11"
          height="11"
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
    // `/60`, not `/40`. At 40% white on the navy rail this measured **3.56:1**
    // in the light theme and 3.74:1 in the dark — below the 4.5 AA wants for
    // 11px text, and found by an axe pass on every screen. 60% measures 6.4:1
    // and is still comfortably quieter than the rows it organises, which was
    // the whole point of the value.
    <p className="px-3 pb-1.5 pt-5 text-[11px] font-medium tracking-wide text-inverse/60">
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
  const [openGroup, setOpenGroup] = usePersisted<string | null>(KEY.openGroup, null);
  const nav = useRef<HTMLElement>(null);

  const all = useMemo(() => flattenNavigation(sections), [sections]);
  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);

  /**
   * Which group is unfolded.
   *
   * The group the current route belongs to wins over the remembered one, and
   * that ordering is the whole behaviour: navigating into a group opens it,
   * navigating out closes it, and nobody has to manage the rail by hand. The
   * stored value only decides the case the route cannot — a group deliberately
   * opened to look at something while standing somewhere else, which then
   * survives a reload.
   *
   * Derived during render rather than synchronised in an effect. An effect
   * would paint the old group open for one frame on every navigation, and the
   * state it maintained would be a second source of truth for something the
   * path already answers.
   */
  const routeGroup = useMemo(
    () =>
      sections.find(
        (s) =>
          s.items.length > 1 &&
          (((s.to && isActive(s.to, path, s.exact)) ?? false) ||
            s.items.some((i) => isActive(i.to, path, i.exact))),
      )?.id ?? null,
    [sections, path],
  );
  const expanded = routeGroup ?? openGroup;

  /**
   * Opening a group closes the others.
   *
   * Without this the Website block alone unfolds to thirty-six rows, which is
   * the objection the previous groups-only rail was built to answer. An
   * accordion keeps the rail at its groups plus one group's entries.
   */
  const toggleGroup = useCallback(
    (id: string) => setOpenGroup(expanded === id ? null : id),
    [expanded, setOpenGroup],
  );

  const isStarred = useCallback((id: string) => favorites.includes(id), [favorites]);

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
          className="w-full rounded-md bg-inverse/[0.07] py-1.5 pl-8 pr-2.5 text-[13px] text-inverse
                     placeholder:text-inverse/60 focus:bg-inverse/[0.12] focus:outline-none
                     focus:ring-1 focus:ring-inverse/25"
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
                  {rows.map((section) => (
                    <SidebarGroup
                      key={section.id}
                      section={section}
                      path={path}
                      open={expanded === section.id}
                      onToggle={() => toggleGroup(section.id)}
                      starred={isStarred}
                      onToggleStar={toggleStar}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}
    </nav>
  );
}
