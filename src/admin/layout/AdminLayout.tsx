import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Wordmark } from "@/components/Wordmark";
import { useAuth } from "../lib/auth";
import { Link, useRoute } from "../lib/router";
import { useTheme } from "../lib/theme";
import { activeSection, type NavSection } from "../lib/navigation";
import { Sidebar } from "../ui/Sidebar";
import { Button } from "../ui/primitives";

/**
 * The dashboard shell: rail, top bar, content.
 *
 * The frame only. What goes *in* the rail is `Sidebar`, and what the menu
 * contains is `lib/navigation` — this file no longer knows that a menu entry
 * exists, which is why adding a section touches neither it nor `App.tsx`.
 *
 * Navigation is built from permissions, not from roles. An HR user and a
 * Marketing user both reach the content groups but only one of them sees
 * "Bewerbungen", and neither sees "Rollen" — none of it written as a role
 * check, so a custom role assembled in the role editor gets a correct menu
 * with nobody touching this code.
 *
 * Hiding is a courtesy, not the control. Every route the rail omits is still
 * enforced by the server on each call, so a hidden item someone navigates to
 * by hand returns 403 rather than data.
 */

export function AdminLayout({
  children,
  sections,
}: {
  children: ReactNode;
  sections: NavSection[];
}) {
  const { path } = useRoute();
  const [open, setOpen] = useState(false);
  const section = activeSection(sections, path);

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

        <Sidebar sections={sections} path={path} />

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
              The group's name, and nothing else.

              Its entries used to sit beside it as a segmented control, because
              the rail listed groups only. The rail now folds them open in
              place, so a copy here would be the same navigation twice — and the
              copy was always the weaker one, able to show only the group you
              were already in. `SectionTabs` was deleted with this change; it is
              in the history if the trade is ever reconsidered.

              "Website bearbeiten" opts out: it embeds the live site, which
              carries its own header, and the rail already says which page is
              open.
            */}
            {section && !section.hideBarTitle ? (
              <div className="order-2 flex min-w-0 items-center gap-4">
                {/* `h2`, not `h1`: the page below keeps its own `h1` in
                    `PageHeader`, and the group is the heading above it. */}
                <h2 className="truncate font-display text-[15px] font-semibold text-ink">
                  {section.label}
                </h2>
              </div>
            ) : null}

            {/* `ml-auto` holds the account button against the right edge
                rather than against the group's name. It used to share that job
                with the entries' `lg:flex-1`; with those gone it is the only
                thing doing it. */}
            <div className="order-3 ml-auto shrink-0 lg:order-4 lg:pl-4">
              <UserMenu />
            </div>
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto flex max-w-[84rem] flex-col gap-6">{children}</div>
        </main>
      </div>
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
