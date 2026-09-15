import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Wordmark } from "@/components/Wordmark";
import { useAuth } from "../lib/auth";
import { Link, useRoute } from "../lib/router";
import { Button } from "../ui/primitives";

/**
 * The dashboard shell: rail, top bar, content.
 *
 * Navigation is built from permissions, not from roles. An HR user and a
 * Marketing user both reach "Inhalte" but only one of them sees
 * "Bewerbungen", and neither sees "Rollen" — and none of that is written as a
 * role check, so a custom role assembled in the role editor gets a correct
 * menu without anyone touching this file.
 *
 * Hiding is a courtesy, not the control. Every route the rail omits is still
 * enforced by the server on each call, so a hidden item someone navigates to
 * by hand returns 403 rather than data.
 */

export type NavItem = {
  to: string;
  label: string;
  /** Any one of these grants the item. */
  permissions: string[];
  icon: ReactNode;
  /** Shown as a count chip — pending reviews, new applications. */
  badge?: number;
};

export function AdminLayout({
  children,
  nav,
}: {
  children: ReactNode;
  nav: NavItem[];
}) {
  const { user, logout, canAny } = useAuth();
  const { path } = useRoute();
  const [open, setOpen] = useState(false);

  // The rail is a disclosure on a phone; a route change has to close it, or
  // the visitor lands on the new page behind a panel they have to dismiss.
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = nav.filter((item) => canAny(...item.permissions));

  return (
    <div className="flex min-h-dvh bg-base">
      <a href="#main" className="skip-link">
        Zum Inhalt springen
      </a>

      {/* ---- Rail ---- */}
      <aside
        id="admin-rail"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-admin-rail transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-surface/10 px-5">
          <Link to="/" className="flex items-center gap-2.5 text-surface">
            <Wordmark className="h-4 w-auto" />
            <span className="eyebrow text-brand-sand">Dashboard</span>
          </Link>
        </div>

        <nav aria-label="Hauptnavigation" className="scroll-thin flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-0.5">
            {visible.map((item) => {
              // Prefix match, so `/inhalte/projects/abc` keeps "Inhalte" lit.
              const active = path === item.to || (item.to !== "/" && path.startsWith(item.to));
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-[14px] transition-colors",
                      active
                        ? "bg-surface/[0.14] font-medium text-surface"
                        : "text-surface/65 hover:bg-surface/[0.07] hover:text-surface",
                    )}
                  >
                    <span aria-hidden className="shrink-0 opacity-80">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="shrink-0 rounded-full bg-brand-sand px-1.5 py-0.5 font-mono text-[10px] tnum font-medium text-admin-rail">
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="shrink-0 border-t border-surface/10 p-3">
          <Link
            to="/profil"
            className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface/[0.07]"
          >
            <Avatar name={user?.name ?? "?"} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium text-surface">{user?.name}</span>
              <span className="truncate text-[11px] text-surface/50">
                {user?.roles.map((r) => r.name).join(", ") || "Keine Rolle"}
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-1 w-full rounded-md px-2 py-2 text-left text-[13px] text-surface/55 transition-colors hover:bg-surface/[0.07] hover:text-surface"
          >
            Abmelden
          </button>
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
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-base/90 px-4 backdrop-blur-md lg:px-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="admin-rail"
            className="lg:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M2 5h12" />
              <path d="M2 11h12" />
            </svg>
            <span className="sr-only">Navigation</span>
          </Button>

          <div className="min-w-0 flex-1" />

          <Button
            variant="ghost"
            size="sm"
            href="/"
            target="_blank"
            rel="noreferrer"
            trailing={<span aria-hidden>↗</span>}
          >
            Website ansehen
          </Button>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto flex max-w-[84rem] flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** Initials on navy — the same honest-monogram choice the team grid makes. */
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
        "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface/15 font-display text-[12px] font-semibold text-surface",
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}
