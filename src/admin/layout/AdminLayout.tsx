import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";
import { Button, PageActionsSlot } from "@/shared/ui/primitives";
import { Breadcrumb } from "@/shared/ui/navigation";
import { Wordmark } from "@/components/Wordmark";
import { NotificationBell } from "@/features/notifications";
import { useAuth } from "@/core/auth";
import { Link, useRoute, useRouteMeta, type Crumb } from "@/core/router";
import { useTheme } from "../lib/theme";
import {
  WORKSPACES,
  activeWorkspace as workspaceOf,
  ownerOf,
  type NavWorkspace,
  type SearchEntry,
} from "../lib/navigation";
import { Sidebar } from "../ui/Sidebar";
import { CommandPalette } from "../ui/CommandPalette";
import { WorkspaceStrip } from "../ui/WorkspaceStrip";

/* ------------------------------------------------------------------ */
/* Per-browser preferences: favourites and history                     */
/* ------------------------------------------------------------------ */

const PREF = { favorites: "iem.nav.favorites", recent: "iem.nav.recent" } as const;
const RECENT_LIMIT = 6;

function readPref(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // Private windows, blocked site data, half-written JSON. A preference that
    // cannot be read is the default, never a broken menu.
    return [];
  }
}

function writePref(key: string, value: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* A preference that cannot be remembered is not an error worth raising. */
  }
}

/** The search entry a path is — a content type's own id when it is one, else its destination's. */
function entryIdFor(path: string): string | null {
  const type = /^\/inhalte\/([^/]+)/.exec(path)?.[1];
  if (type) return `type:${type}`;
  return ownerOf(path)?.id ?? null;
}

/**
 * The dashboard shell: rail, top bar, content.
 *
 * The frame only. What goes *in* the rail is `Sidebar`, and what the menu
 * contains is `lib/navigation` — this file no longer knows that a menu entry
 * exists, which is why adding a section touches neither it nor `App.tsx`.
 *
 * Navigation is built from permissions, not from roles (P1B): seven workspaces,
 * each shown when its audience holds and it has something to open — see
 * `AUDIENCES` in `lib/navigation.ts`. None of it is written as a role check,
 * so a custom role assembled in the role editor gets a correct menu with
 * nobody touching this code. The command palette (Ctrl/Cmd + K) reads the
 * same filtered registry and can offer nothing the rail would not.
 *
 * Hiding is a courtesy, not the control. Every route the rail omits is still
 * enforced by the server on each call, so a hidden item someone navigates to
 * by hand returns 403 rather than data.
 */

export function AdminLayout({
  children,
  workspaces,
  searchEntries = [],
  trail = [],
}: {
  children: ReactNode;
  /** `buildNavigation` for this reader. */
  workspaces: NavWorkspace[];
  /** `searchIndex` for this reader — the palette offers nothing else. */
  searchEntries?: SearchEntry[];
  /**
   * Derived in `App` from the route table (foundation stage F4). Empty for a
   * top-level screen, where a single crumb repeating the page's own heading
   * would be noise rather than orientation.
   */
  trail?: Crumb[];
}) {
  const { path } = useRoute();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  /** The bar element `PageHeader` portals its actions into — see `pageActionsSlot.ts`. */
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const { title, actions } = useRouteMeta();

  /*
    Where the route belongs, over the whole registry — ownership is the
    route's, not the reader's. The rail opens this workspace only if the reader
    has it; a deep link into a workspace they are not offered (a Projektleiter
    opening `/inhalte/team` from a colleague's mail) still gets its name in the
    bar, and a rail with nothing open.
  */
  const workspaceId = workspaceOf(path);
  const destinationId = ownerOf(path)?.id ?? null;
  const workspaceLabel = WORKSPACES.find((w) => w.id === workspaceId)?.label ?? null;
  const current = workspaces.find((w) => w.id === workspaceId) ?? null;

  const [favorites, setFavorites] = useState<string[]>(() => readPref(PREF.favorites));
  const [recent, setRecent] = useState<string[]>(() => readPref(PREF.recent));

  const toggleStar = useCallback((id: string) => {
    setFavorites((list) => {
      const next = list.includes(id) ? list.filter((f) => f !== id) : [...list, id];
      writePref(PREF.favorites, next);
      return next;
    });
  }, []);

  // History, recorded as the route settles. Only ids are stored; they are
  // resolved against what the reader is offered *now* when shown.
  useEffect(() => {
    const id = entryIdFor(path);
    if (!id) return;
    setRecent((list) => {
      if (list[0] === id) return list;
      const next = [id, ...list.filter((r) => r !== id)].slice(0, RECENT_LIMIT);
      writePref(PREF.recent, next);
      return next;
    });
  }, [path]);

  const byId = useMemo(() => new Map(searchEntries.map((e) => [e.id, e])), [searchEntries]);
  const recentEntries = useMemo(
    () => recent.map((id) => byId.get(id)).filter((e): e is SearchEntry => Boolean(e)),
    [recent, byId],
  );

  /*
    Ctrl + K and Cmd + K open the palette from anywhere. `preventDefault`
    because browsers bind both to their own search bar. Not while a dialog is
    already open: two modals stacked is a focus trap inside a focus trap.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "k") return;
      if (document.querySelector("dialog[open]") && !searching) return;
      e.preventDefault();
      setSearching(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searching]);

  /**
   * The trail, with the record's own name substituted into the last step.
   *
   * `App` derives the shape from the route table; only the screen knows what
   * the record is called, and it publishes that through `usePageTitle`. The
   * two meet here, because this is the one component that is both inside the
   * provider and holding the trail.
   */
  const crumbs =
    title && trail.length
      ? [...trail.slice(0, -1), { ...trail[trail.length - 1], label: title }]
      : trail;

  /**
   * Filtered here so a screen declares the key once and never asks twice.
   * Hiding is a courtesy as everywhere else — the server refuses the call.
   */
  const visibleActions = actions.filter((a) => !a.permission || can(a.permission));

  /**
   * Mounted for its side effects, not for its value.
   *
   * The attribute is already set by the inline script in `admin.html` before
   * the first paint, so this changes nothing on load. What it buys is the
   * subscription: with the choice on "Automatisch", a dashboard left open
   * across dusk follows the machine instead of staying in the theme it was
   * opened in. The shell is the right host because it is the one component
   * mounted for the whole session.
   */
  useTheme();

  // The rail is a disclosure on a phone; a route change has to close it, or
  // the visitor lands on the new page behind a panel they have to dismiss.
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-dvh bg-base">
      <a href="#main" className="skip-link">
        Zum Inhalt springen
      </a>

      {/* ---- Rail ---- */}
      <aside
        id="admin-rail"
        className={cn(
          // 12.96rem — a tenth off 14.4rem, which was itself a tenth off the
          // 16rem this started at, so the rail now stands at 81% of its
          // original width. The content area is a flex sibling, not offset by
          // a matching padding, so the width lives here alone and nothing else
          // has to be kept in step with it.
          //
          // This is about as narrow as the current labels go: after the
          // padding, the icon and the `pr-8` the favourite star is parked in,
          // roughly 111px are left for text, and "Website bearbeiten" wants
          // more than that. The rows carry `truncate`, so the failure is an
          // ellipsis rather than a broken layout.
          "fixed inset-y-0 left-0 z-50 flex w-[12.96rem] shrink-0 flex-col bg-admin-rail transition-transform",
          // Desktop: pinned to the viewport, not to the document.
          //
          // This was `lg:static`, which made the rail a plain flex child and so
          // stretched it to the height of the *document*. On a long screen — the
          // media grid, the audit log — the navigation scrolled off the top and
          // the nav's own `overflow-y-auto` never engaged, because an element
          // with no bounded height has nothing to scroll. `h-dvh` gives it that
          // bound and `sticky top-0` keeps it in view, which is also what lets
          // the footer below sit at the bottom of the screen rather than at the
          // bottom of the page.
          //
          // `bottom-auto` undoes the `inset-y-0` above: sticky treats `top` and
          // `bottom` as opposing thresholds and setting both is contradictory.
          "lg:sticky lg:top-0 lg:bottom-auto lg:h-dvh lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-inverse/10 px-5">
          {/* The site's header lockup (`components/Nav.tsx`), re-toned for the
              rail: same `h-5` mark, same divider-and-strapline beside it, same
              hover shift. Only the palette moves — the site sets navy on paper
              and hovers to `brand-blue`; on `admin-rail` navy the mark is white
              and the accent is `brand-sand`, which is the gold lightened for
              exactly this ground. The strapline is spelled out here rather than
              read from `navLabels`: the dashboard shares only the theme tokens,
              `Wordmark` and `cn` with the site (see `admin/main.tsx`), and
              importing content defaults would pull the site's copy into this
              bundle. The site keeps it behind `sm:` because its header is
              fluid; the rail has a fixed width, so it always fits. */}
          <Link to="/" className="group flex items-center gap-3 text-inverse">
            <Wordmark className="h-5 transition-colors group-hover:text-brand-sand" />
            <span className="border-l border-inverse/15 pl-3 text-[11px] leading-tight text-inverse/60">
              Energie- und
              <br />
              Messtechnik
            </span>
          </Link>
        </div>

        <Sidebar
          workspaces={workspaces}
          path={path}
          activeWorkspace={current ? workspaceId : null}
          activeDestination={destinationId}
          favorites={favorites}
          onToggleStar={toggleStar}
          onOpenSearch={() => setSearching(true)}
        />

        {/* Pinned to the foot of the rail: `shrink-0` after a `flex-1` nav, so
            the navigation scrolls and this does not move. With the rail itself
            now viewport-height, that foot is the bottom of the screen. */}
        <div className="shrink-0 border-t border-inverse/10 p-3">
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-[14px] text-inverse/65 transition-colors hover:bg-inverse/[0.07] hover:text-inverse"
          >
            <span aria-hidden className="shrink-0 opacity-80">
              <svg
                width="16"
                height="16"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12M3.3 7h11.4M3.3 11h11.4M9 3c-1.6 1.8-2.4 3.8-2.4 6S7.4 13.2 9 15c1.6-1.8 2.4-3.8 2.4-6S10.6 4.8 9 3" />
              </svg>
            </span>
            <span className="min-w-0 flex-1 truncate">Website ansehen</span>
            <span aria-hidden className="shrink-0 text-[11px] opacity-70">
              ↗
            </span>
          </a>
        </div>
      </aside>

      {/* The scrim only exists while the rail is a disclosure. */}
      {open ? (
        <button
          type="button"
          aria-label="Navigation schliessen"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm lg:hidden"
        />
      ) : null}

      {/* ---- Content ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          The top bar carries where you are: the open group's name, then its
          entries. Both used to be elsewhere — the name nowhere at all (the lit
          rail row was the only clue, and the rail is off-canvas on a phone),
          the entries on a rule above the page content, where they scrolled
          away on the long screens that need them most. The bar is sticky, so
          up here they stay reachable down a 200-row audit log.

          One row or two, decided by wrapping rather than by a breakpoint's
          opinion of what fits. Below `lg` the entries take `w-full`, which
          pushes them onto their own line under the name and the account
          button; from `lg` they are `flex-1` and sit between the two. The
          `order-*` classes are what keep the account button last on a wide
          screen and on the first line on a narrow one, since DOM order alone
          cannot do both.
        */}
        <header className="glass-bar sticky top-0 z-30 shrink-0">
          <div className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:px-8 lg:py-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="admin-rail"
              className="order-1 lg:hidden"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M2 5h12" />
                <path d="M2 11h12" />
              </svg>
              <span className="sr-only">Navigation</span>
            </Button>

            {/*
              The workspace's name, and the trail under it.

              The name comes from route ownership (`ownerOf`), so it is right
              for a detail page three segments deep and for a deep link into a
              workspace the reader's rail does not show. The workspace's
              destinations are in the rail (and, below `lg`, in the strip above
              the page) — not here, which would be the same navigation twice.
            */}
            {workspaceLabel ? (
              <div className="order-2 flex min-w-0 flex-col justify-center gap-0.5">
                {/* `h2`, not `h1`: the page below keeps its own `h1` in
                    `PageHeader`, and the workspace is the heading above it —
                    "Projekte" over "Pläne › 4723-HZG-EG-101". */}
                {/* `data-shell-title`: since P1C the page's header actions are
                    portalled into this bar, and an action that owns a dialog
                    brings the dialog's (closed, hidden) `h2` along — so "the
                    h2 in the bar" is no longer one element. */}
                <h2 data-shell-title className="truncate font-display text-[15px] font-semibold text-ink">
                  {workspaceLabel}
                </h2>
                {/* The trail sits under the group's name rather than beside it:
                    on a phone the bar already wraps, and a second horizontal
                    element is what pushes the account button onto a third row. */}
                {crumbs.length > 1 ? (
                  <div className="hidden min-w-0 sm:block">
                    <Breadcrumb items={crumbs} />
                  </div>
                ) : null}
              </div>
            ) : null}

            {/*
              The screen's own actions, published through `usePageActions`.

              In the bar rather than on the page because the bar is sticky: the
              audit export was a button at the top of a 200-row log, which is
              to say out of reach exactly when it is wanted. Permission-filtered
              here so a screen never has to ask twice — it declares the key and
              the shell decides whether to draw it.
            */}
            {/*
              The page header's own actions (P1C, UX-18), portalled here so
              they stay reachable on a long list or form. Empty — and hidden —
              on a screen that has none.
            */}
            <div
              ref={setActionsSlot}
              className="order-4 flex shrink-0 flex-wrap items-center gap-2 empty:hidden lg:order-3"
            />

            {visibleActions.length ? (
              <div className="order-4 flex shrink-0 flex-wrap items-center gap-2 lg:order-3">
                {visibleActions.map((action) => (
                  <Button
                    key={action.id}
                    size="sm"
                    variant={action.intent ?? "secondary"}
                    busy={action.busy}
                    disabled={action.disabled}
                    onClick={action.run}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            ) : null}

            {/* `ml-auto` holds the account button against the right edge
                rather than against the group's name. It used to share that job
                with the entries' `lg:flex-1`; with those gone it is the only
                thing doing it. */}
            <div className="order-3 ml-auto flex shrink-0 items-center gap-1 lg:order-5 lg:pl-4">
              {/*
                The bell, immediately left of the account button.

                Imported directly rather than behind a `lazy()` boundary,
                unlike every other feature the shell touches: this renders on
                every screen for every signed-in person, so deferring it would
                put a spinner in the top bar on every page load and fetch the
                chunk anyway. See the note in `features/notifications/index.ts`
                — it is the same Rollup argument reaching the opposite
                conclusion because there is no dynamic import to conflict with.

                No permission check. Everybody has an inbox of their own, and
                the count endpoint scopes to the verified token.
              */}
              {/* The palette's second door, for widths where the rail — and
                  its search button — is behind the drawer. */}
              <button
                type="button"
                onClick={() => setSearching(true)}
                aria-label="Suchen (Strg + K)"
                title="Suchen (Strg + K)"
                className="grid h-9 w-9 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
              >
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                  <path d="M8 12.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM11.5 11.5 14.5 14.5" />
                </svg>
              </button>
              <NotificationBell />
              <UserMenu />
            </div>
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto flex max-w-[84rem] flex-col gap-6">
            {/* The open workspace's destinations, below `lg` only — where the
                rail that carries them is a drawer. Same data, same links. */}
            {current && current.destinations.length > 1 ? (
              <WorkspaceStrip workspace={current} activeDestination={destinationId} />
            ) : null}
            <PageActionsSlot.Provider value={actionsSlot}>{children}</PageActionsSlot.Provider>
          </div>
        </main>
      </div>

      <CommandPalette
        open={searching}
        onClose={() => setSearching(false)}
        entries={searchEntries}
        recent={recentEntries}
      />
    </div>
  );
}

/**
 * The signed-in user, top right.
 *
 * It used to sit at the foot of the rail. Two things changed by moving it, and
 * both are deliberate:
 *
 * **The colours are the light-surface set, not the rail's.** The rail is navy,
 * so that block was written in `text-inverse` and `bg-inverse/[0.07]` — white on
 * dark. The header is `bg-base`, where those are invisible. This uses the same
 * tokens every other light surface in the dashboard uses (`text-ink`,
 * `text-muted`, `hover:bg-surface-2`), matching `Modal`'s close button exactly.
 * Nothing new was invented; the palette is the one already in the file.
 *
 * **Name and roles moved into a panel.** The rail had the width to spell them
 * out. The header does not — on a phone it already carries the navigation
 * toggle and the site link — so the trigger is the avatar alone below `sm`, and
 * the identity it stands for is inside, where there is room for it.
 *
 * No menu primitive exists to reuse, and this is the only menu in the
 * dashboard. If a second one appears, lift this into `ui/primitives.tsx` rather
 * than copying it.
 */
function UserMenu() {
  const { user, logout } = useAuth();
  const { path } = useRoute();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // A route change closes it — the panel's own links navigate, and leaving it
  // standing over the new screen is the same mistake the rail avoids.
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Esc returns the caret to what opened the panel; without this the focus
      // is left on a removed node and the next Tab starts from the top.
      trigger.current?.focus();
    };
    const onPointer = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };

    window.addEventListener("keydown", onKey);
    // `mousedown`, not `click`: a click that starts inside and ends outside
    // should not count as dismissing it.
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  if (!user) return null;

  const roles = user.roles.map((r) => r.name).join(", ") || "Keine Rolle";

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "flex max-w-[12rem] items-center gap-2 rounded-md py-1.5 pl-1.5 pr-2 transition-colors hover:bg-surface-2",
          open && "bg-surface-2",
        )}
      >
        <Avatar name={user.name} />
        <span className="hidden min-w-0 truncate text-[13px] font-medium text-ink sm:block">
          {user.name}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")}
        >
          <path d="M2.5 4l2.5 2.5L7.5 4" />
        </svg>
        <span className="sr-only">Benutzerkonto</span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Benutzerkonto"
          className="glass-raised absolute right-0 top-full z-50 mt-2 w-[min(15rem,calc(100vw-2rem))] overflow-hidden rounded-lg"
        >
          <div className="flex flex-col gap-0.5 border-b border-line px-4 py-3">
            <span className="truncate text-[13px] font-medium text-ink">{user.name}</span>
            <span className="truncate text-[12px] text-muted" title={user.email}>
              {user.email}
            </span>
            <span className="truncate text-[11px] text-muted/80" title={roles}>
              {roles}
            </span>
          </div>

          <Link
            to="/profil"
            role="menuitem"
            className="block px-4 py-2.5 text-[13px] text-ink transition-colors hover:bg-surface-2"
          >
            Profil
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => void logout()}
            className="block w-full px-4 py-2.5 text-left text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            Abmelden
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Initials, never a generated face — the same honest-monogram choice the team
 * grid makes.
 *
 * Navy on a pale navy disc, because its one caller now sits on the light header
 * rather than on the navy rail. Note that `cn` is plain `clsx` with no
 * Tailwind-merge: a `className` passed here is *appended*, so it cannot
 * reliably override `bg-` or `text-` above — stylesheet order would decide.
 * Re-tone this base, or add a `tone` prop, rather than fighting it from a call
 * site.
 */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(" ")
    .filter((p) => p[0] === p[0]?.toUpperCase())
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/10 font-display text-[12px] font-semibold text-accent",
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}
