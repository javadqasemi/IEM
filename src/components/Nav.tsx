import { useEffect, useState } from "react";
import { Button } from "./Button";
import { SiteSearch } from "./SiteSearch";
import { Wordmark } from "./Wordmark";
import { useContent } from "@/content/iem";

export function Nav() {
  const { navItems, offices, navLabels } = useContent();
  const [open, setOpen] = useState(false);
  const [lifted, setLifted] = useState(false);

  // The header only grows a border once the page has moved, so the hero reads
  // as one uninterrupted sheet at rest.
  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 bg-base/85 backdrop-blur-md transition-shadow duration-300 ${
        lifted ? "border-b border-line shadow-rail" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-6 lg:px-10">
        <a href="#top" className="group flex items-center gap-3" aria-label={navLabels.home}>
          <Wordmark className="h-5 text-brand-navy transition-colors group-hover:text-brand-blue" />
          {/* Stored as lines rather than one string with a `<br>`: the break is
              a layout decision about a two-line lockup beside the mark, and
              putting markup in the content would let an editor emit raw HTML
              into the header. */}
          <span className="hidden border-l border-line pl-3 text-[11px] leading-tight text-muted sm:inline">
            {navLabels.strapline.map((line, i) => (
              <span key={line}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </span>
        </a>

        <nav aria-label={navLabels.primary} className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={offices[0].phoneHref}
            className="hidden rounded-md px-3 py-2 font-mono text-[13px] text-muted transition-colors hover:text-brand-bronze lg:inline-block"
          >
            {offices[0].phone}
          </a>
          <SiteSearch className="hidden w-44 sm:block lg:w-56" />

          {/*
            The way into the CMS, and an `<a>` rather than a `<button>` because
            it leaves the page — `admin.html` is its own Vite entry, not a route.
            Icon-only, so the accessible name is the whole label: `sr-only` text
            rather than `aria-label`, matching the menu toggle below, and with a
            `title` so a mouse user gets the same word on hover.

            `navLabels.login` is optional — a snapshot published before the field
            existed has none — so it falls back rather than rendering a control
            no screen reader can announce.
          */}
          <a
            href="/admin.html"
            title={navLabels.login ?? "Anmelden"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-line transition-colors hover:bg-surface-2 hover:text-brand-blue"
          >
            <span className="sr-only">{navLabels.login ?? "Anmelden"}</span>
            {/* Arrow entering a door: the conventional sign-in mark. Rounded
                caps and joins are what separate it from the hamburger's plain
                strokes — the same weight, a softer finish. */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              aria-hidden
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9.5 2.5h3.5v11H9.5" />
              <path d="M6.5 5.5L9 8l-2.5 2.5" />
              <path d="M9 8H2.5" />
            </svg>
          </a>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-line transition-colors hover:bg-surface-2 md:hidden"
          >
            <span className="sr-only">{open ? navLabels.menuClose : navLabels.menuOpen}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
              {open ? (
                <path d="M3 3l10 10M13 3L3 13" />
              ) : (
                <>
                  <path d="M2 5h12" />
                  <path d="M2 11h12" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div id="mobile-nav" className="border-t border-line bg-base md:hidden">
          <nav aria-label={navLabels.mobile} className="mx-auto flex max-w-7xl flex-col px-6 py-2">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="border-b border-line py-3 text-[15px] text-ink last:border-0"
              >
                {item.label}
              </a>
            ))}
            <div className="flex flex-col gap-2 py-4">
              {/* Below `sm` the header has no room for the field, so the menu
                  carries it — the only place it appears on a phone. */}
              <SiteSearch className="sm:hidden" onNavigate={() => setOpen(false)} />
              <Button variant="secondary" href={offices[0].phoneHref}>
                {offices[0].phone}
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
