import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";
import { Link } from "@/core/router";
import {
  ICONS,
  isActive,
  type NavDestination,
  type NavWorkspace,
  type WorkspaceId,
} from "../lib/navigation";

/**
 * The rail: favourites, then the reader's workspaces (P1B).
 *
 * **At most seven rows, and only the workspace you are in is open.** The rail
 * used to be the data model — thirty-five content types in six groups, a
 * settings group beside a content group of the same name — and an accordion
 * was needed to keep it readable. It now lists workspaces, and the one the
 * route belongs to unfolds its own destinations underneath. There is no
 * accordion state to remember: the route decides, so navigating into a
 * workspace opens it and leaving closes it. On a phone the drawer therefore
 * shows one workspace level at a time, never every child at once.
 *
 * **The open workspace's row is not a link.** Its destinations are, and the
 * first of them is where the row would have led — two adjacent links to one
 * page is the duplicated navigation a browser test once caught here as a
 * strict-mode violation. A closed workspace's row is a link to its first
 * destination, so it is middle-clickable and bookmarkable like any page.
 *
 * Search is the command palette now (Ctrl/Cmd + K, or the button at the top of
 * this rail). It reads the same filtered registry, so it can reach pages the
 * rail does not list — the content types, the reader's own account — without
 * reaching anything the reader is not offered.
 */

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
 * The active row is marked by a bar down its left edge, not by its fill alone —
 * the wordmark's own device, and one column the eye can run down. Both states
 * carry the 2px border so becoming active does not shift the label.
 */
const ROW =
  "group/row relative flex w-full items-center gap-3 rounded-md border-l-2 py-2 pl-3 pr-3 text-left text-[14px] transition-colors";
const ROW_IDLE = "border-transparent text-inverse/65 hover:bg-inverse/[0.07] hover:text-inverse";
const ROW_ACTIVE = "border-brand-sand bg-inverse/[0.14] font-medium text-inverse";

function Count({ value }: { value?: number }) {
  if (!value) return null;
  return (
    <span className="shrink-0 rounded-full bg-brand-sand px-1.5 py-0.5 font-mono text-[10px] tnum font-medium text-admin-rail">
      {value}
    </span>
  );
}

/**
 * A block heading. Sentence case, one step down in size and well under the
 * weight of the rows — and `/60`, not `/40`: 40 % white on the navy rail
 * measured 3.56:1 against the 4.5 AA wants for 11px text.
 */
function Heading({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1.5 pt-5 text-[11px] font-medium tracking-wide text-inverse/60">
      {children}
    </p>
  );
}

/** A favourite star, outside the link it belongs to so a keyboard reaches both. */
function Star({ starred, onToggle }: { starred: boolean; onToggle: () => void }) {
  const label = starred ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={starred}
      title={label}
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
      <span className="sr-only">{label}</span>
    </button>
  );
}

/**
 * One destination inside the open workspace — the workspace navigation.
 *
 * Indented to the workspace's icon column with a hairline down it: at this
 * width an indent alone is not enough to read as nesting.
 */
function DestinationRow({
  destination,
  active,
  starred,
  onToggleStar,
}: {
  destination: NavDestination;
  active: boolean;
  starred: boolean;
  onToggleStar: (id: string) => void;
}) {
  return (
    <li className="group/row relative ml-[1.35rem] border-l border-inverse/15 pl-2">
      <Link
        to={destination.to}
        data-nav-link
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-md py-1.5 pl-2 pr-7 text-left text-[13px] transition-colors",
          active
            ? "bg-inverse/[0.14] font-medium text-inverse"
            : "text-inverse/65 hover:bg-inverse/[0.07] hover:text-inverse",
        )}
      >
        {/* Wraps rather than truncates: at this rail width "Hintergrundaufgaben"
            and "Benachrichtigungsregeln" lost their endings, and a destination
            whose name is cut off is one people have to hover to identify. */}
        <span className="min-w-0 flex-1 break-words leading-snug">{destination.label}</span>
        <Count value={destination.count} />
      </Link>
      <Star starred={starred} onToggle={() => onToggleStar(destination.id)} />
    </li>
  );
}

function WorkspaceRow({
  workspace,
  open,
  path,
  activeDestination,
  starred,
  onToggleStar,
}: {
  workspace: NavWorkspace;
  open: boolean;
  path: string;
  activeDestination: string | null;
  starred: (id: string) => boolean;
  onToggleStar: (id: string) => void;
}) {
  const single = workspace.destinations.length === 1;
  const panelId = `workspace-${workspace.id}`;

  const face = (
    <>
      <span aria-hidden className="shrink-0 opacity-80">
        <Glyph name={workspace.icon} />
      </span>
      <span className="min-w-0 flex-1 truncate">{workspace.label}</span>
      {/* The open workspace shows its counts on its destinations instead. */}
      {!open || single ? <Count value={single ? workspace.destinations[0].count : workspace.count} /> : null}
    </>
  );

  // A workspace with one destination is that destination: a plain link, open or not.
  if (single) {
    const only = workspace.destinations[0];
    const active = isActive(only.to, path, only.exact);
    return (
      <li className="group/row relative">
        <Link
          to={only.to}
          data-nav-link
          data-workspace={workspace.id}
          aria-current={active ? "page" : undefined}
          className={cn(ROW, "pr-8", open ? ROW_ACTIVE : ROW_IDLE)}
        >
          {face}
        </Link>
        <Star starred={starred(only.id)} onToggle={() => onToggleStar(only.id)} />
      </li>
    );
  }

  return (
    <li>
      {open ? (
        /*
          The open workspace names itself and owns the list below it. Not a
          link: every destination beneath is one, and the first of them is
          where this row would lead.
        */
        <p
          id={`${panelId}-label`}
          data-workspace={workspace.id}
          className={cn(ROW, ROW_ACTIVE)}
        >
          {face}
        </p>
      ) : (
        <Link
          to={workspace.to}
          data-nav-link
          data-workspace={workspace.id}
          className={cn(ROW, ROW_IDLE)}
        >
          {face}
        </Link>
      )}

      {open ? (
        <WorkspaceDestinations
          id={panelId}
          workspace={workspace}
          activeDestination={activeDestination}
          starred={starred}
          onToggleStar={onToggleStar}
        />
      ) : null}
    </li>
  );
}

/**
 * The open workspace's destinations, in the order the registry lists them,
 * with a sub-heading where the registry names a group ("Einstellungen").
 */
function WorkspaceDestinations({
  id,
  workspace,
  activeDestination,
  starred,
  onToggleStar,
}: {
  id: string;
  workspace: NavWorkspace;
  activeDestination: string | null;
  starred: (id: string) => boolean;
  onToggleStar: (id: string) => void;
}) {
  const blocks: { group: string | null; items: NavDestination[] }[] = [];
  for (const destination of workspace.destinations) {
    const group = destination.group ?? null;
    const last = blocks[blocks.length - 1];
    if (last && last.group === group) last.items.push(destination);
    else blocks.push({ group, items: [destination] });
  }

  return (
    // A labelled group, not a second `<nav>` inside the rail's landmark.
    <div id={id} role="group" aria-labelledby={`${id}-label`} className="mt-0.5">
      {blocks.map((block, i) => (
        <div key={block.group ?? `block-${i}`}>
          {block.group ? (
            <p className="ml-[1.35rem] border-l border-inverse/15 pb-1 pl-4 pt-2.5 text-[11px] font-medium tracking-wide text-inverse/60">
              {block.group}
            </p>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {block.items.map((destination) => (
              <DestinationRow
                key={destination.id}
                destination={destination}
                active={destination.id === activeDestination}
                starred={starred(destination.id)}
                onToggleStar={onToggleStar}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function Sidebar({
  workspaces,
  path,
  activeWorkspace,
  activeDestination,
  favorites,
  onToggleStar,
  onOpenSearch,
}: {
  workspaces: NavWorkspace[];
  path: string;
  activeWorkspace: WorkspaceId | null;
  /** The destination the route belongs to, by id. */
  activeDestination: string | null;
  favorites: string[];
  onToggleStar: (id: string) => void;
  onOpenSearch: () => void;
}) {
  const offered = new Map(
    workspaces.flatMap((w) => w.destinations.map((d) => [d.id, d] as const)),
  );
  // Resolved against what is offered *now*: a favourite for a page the reader
  // has lost access to simply stops being drawn.
  const starredItems = favorites
    .map((id) => offered.get(id))
    .filter((d): d is NavDestination => Boolean(d));
  const isStarred = (id: string) => favorites.includes(id);

  /** Up and down move between links; Home and End jump to the ends. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const links = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("[data-nav-link]"),
    );
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

  return (
    <nav
      aria-label="Hauptnavigation"
      onKeyDown={onKeyDown}
      className="scroll-thin flex-1 overflow-y-auto px-3 py-4"
    >
      <button
        type="button"
        onClick={onOpenSearch}
        className="flex w-full items-center gap-2 rounded-md bg-inverse/[0.07] py-1.5 pl-2.5 pr-2 text-left text-[13px] text-inverse/70 transition-colors hover:bg-inverse/[0.12] hover:text-inverse focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inverse/40"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden
        >
          <path d={ICONS.seo} />
        </svg>
        <span className="flex-1">Suchen …</span>
        <kbd className="rounded bg-inverse/10 px-1.5 font-sans text-[10px] text-inverse/70">
          Strg K
        </kbd>
      </button>

      {starredItems.length ? (
        <>
          <Heading>Favoriten</Heading>
          <ul className="flex flex-col gap-0.5">
            {starredItems.map((destination) => (
              <li key={`fav:${destination.id}`} className="group/row relative">
                <Link
                  to={destination.to}
                  data-nav-link
                  aria-current={destination.id === activeDestination ? "page" : undefined}
                  className={cn(
                    ROW,
                    "pr-8",
                    destination.id === activeDestination ? ROW_ACTIVE : ROW_IDLE,
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{destination.label}</span>
                </Link>
                <Star starred onToggle={() => onToggleStar(destination.id)} />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <ul className="flex flex-col gap-0.5 pt-3">
        {workspaces.map((workspace) => (
          <WorkspaceRow
            key={workspace.id}
            workspace={workspace}
            open={workspace.id === activeWorkspace}
            path={path}
            activeDestination={activeDestination}
            starred={isStarred}
            onToggleStar={onToggleStar}
          />
        ))}
      </ul>
    </nav>
  );
}
