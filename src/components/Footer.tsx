import type { CSSProperties } from "react";
import { Wordmark } from "./Wordmark";
import { SocialIcon } from "./SocialIcon";
import { facts, navItems, offices, socials } from "@/content/iem";

const company = [
  { label: "Über uns", href: "#ueber-uns" },
  // Not in `navItems` — the header has six slots and Über uns took this one's.
  // The footer is where it stays reachable by name.
  { label: "Ablauf", href: "#ablauf" },
  { label: "Team", href: "#team" },
  { label: "Karriere", href: "#karriere" },
  { label: "Kontakt", href: "#kontakt" },
];

export function Footer() {
  return (
    <footer className="tick-rule mt-8 bg-surface">
      {/* The social rail sits outside the 12-column grid rather than inside it:
          the four content columns already spend the full twelve, and squeezing
          the offices block to three would break the two addresses onto too many
          lines. As a flex sibling it costs the grid ~80px and nothing else. */}
      {/* `pl-*` rather than `px-*`: the rail is the last flex child, so dropping
          the right padding lets the chips sit flush with the container edge.
          The text columns are unaffected — the grid stops where the rail's gap
          begins, so nothing else moves out to the edge with it. */}
      <div className="mx-auto flex max-w-7xl gap-8 py-16 pl-6 lg:gap-10 lg:pl-10">
        <div className="grid min-w-0 flex-1 gap-12 lg:grid-cols-12">
          <div className="flex flex-col gap-3 lg:col-span-4">
            <div className="flex max-w-xs flex-col gap-4">
              {/* The mark is measured by the line under it, not by a number.
                  `w-fit` sizes this wrapper to its widest child's max-content —
                  the tagline, since the SVG's own intrinsic width is only 142px
                  — and the mark takes 90% of that. Change the tagline's wording
                  or size and the mark follows on its own; the 90% is the only
                  free number here, a deliberate step back off the line's width.

                  Which is why the sentence had to leave the paragraph below:
                  fit-content takes the *widest* child, so with the long second
                  sentence in the same box the wrapper would measure that
                  instead and snap back to the column's full 320px.

                  On a narrow viewport fit-content resolves to the space
                  available rather than overflowing it — the tagline wraps and
                  the mark takes the column width. No nowrap, nothing to clamp.

                  `!w-…` rather than `w-…`: `Wordmark` sets `w-auto` and `cn` is
                  plain clsx with no conflict resolution, so without the
                  important flag stylesheet order decides. Width only — the
                  height follows from the viewBox (142:56). */}
              <div className="flex w-fit flex-col gap-3">
                <Wordmark className="!w-[90%] text-brand-navy" />
                <p className="text-sm leading-relaxed text-muted">
                  Ingenieurbüro für Energie- und Messtechnik.
                </p>
              </div>
              <p className="text-sm leading-relaxed text-muted">
                Gebäudetechnik-Planung für Neubau und Sanierung — Thun und Bern, seit{" "}
                {facts.founded}.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:col-span-2">
            <h2 className="eyebrow text-muted">Dienstleistungen</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {navItems.map((i) => (
                <li key={i.label}>
                  <a href={i.href} className="text-ink transition-colors hover:text-brand-bronze">
                    {i.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3 lg:col-span-2">
            <h2 className="eyebrow text-muted">Unternehmen</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {company.map((i) => (
                <li key={i.label}>
                  <a href={i.href} className="text-ink transition-colors hover:text-brand-bronze">
                    {i.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:col-span-4">
            {offices.map((o) => (
              <div key={o.city} className="flex flex-col gap-2">
                <h2 className="eyebrow text-muted">{o.city}</h2>
                <address className="flex flex-col gap-1 text-sm not-italic text-ink">
                  <span>{o.street}</span>
                  <span>{o.zip}</span>
                  <a
                    href={o.phoneHref}
                    className="font-mono text-[13px] tnum text-brand-blue hover:underline"
                  >
                    {o.phone}
                  </a>
                </address>
              </div>
            ))}
          </div>
        </div>

        {/* Vertical rail, pinned to the top-right. `self-start` keeps it level
            with the wordmark instead of stretching down the whole footer. */}
        <ul
          aria-label="IEM AG in sozialen Netzwerken"
          className="flex shrink-0 flex-col gap-2.5 self-start"
        >
          {socials.map((s) => (
            <li key={s.label}>
              <a
                href={s.href}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`IEM AG auf ${s.label}`}
                className="social-btn"
                style={{ "--sc": s.color } as CSSProperties}
              >
                <SocialIcon name={s.icon} />
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-2 px-6 py-6 lg:flex-row lg:px-10">
          <p className="eyebrow text-muted">© 2026 IEM AG · Thun · Bern</p>
          <p className="eyebrow flex gap-4 text-muted">
            <a href="#" className="hover:text-ink">Datenschutz</a>
            <a href="#" className="hover:text-ink">Impressum</a>
          </p>
        </div>
      </div>
    </footer>
  );
}
