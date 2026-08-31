import { useMemo, useState } from "react";
import { BewerbungButton, openBewerbung } from "./BewerbungButton";
import { jobCategories, jobCategoryNotes, openings, type JobCategory } from "@/content/iem";

/**
 * The vacancies in the same register form as the references: a hairline grid of
 * image-led cards where the whole card is the trigger. There it opens the
 * project's record; here it opens the application form on that position.
 *
 * The three categories are filters, not sections — Schnupperlehre and
 * Lehrstellen carry no adverts today, and stacking three headings with two
 * empty bodies under them would read as neglect rather than as information.
 */
export function JobRegister() {
  const [active, setActive] = useState<JobCategory>("Offene Stellen");

  const shown = useMemo(() => openings.filter((o) => o.category === active), [active]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Stellen nach Art filtern" className="flex flex-wrap gap-2">
          {jobCategories.map((c) => {
            const isActive = c === active;
            const count = openings.filter((o) => o.category === c).length;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setActive(c)}
                aria-pressed={isActive}
                className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  isActive
                    ? "bg-ink text-surface"
                    : "bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-line-strong"
                }`}
              >
                {c}
                <span
                  className={`font-mono text-[11px] tnum ${
                    isActive ? "text-surface/70" : "text-muted/70"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        {/* Count and spontaneous application share the right end of the filter
            row. `BewerbungButton` also hosts the dialog, so it sits outside the
            branch below on purpose — the job cards' own triggers need it
            mounted, including in a category that carries no adverts at all. */}
        <div className="flex items-center gap-4 sm:gap-5">
          <p aria-live="polite" className="eyebrow whitespace-nowrap text-muted">
            {shown.length === 1 ? "1 Inserat" : `${shown.length} Inserate`}
          </p>
          <BewerbungButton size="sm" className="ml-auto sm:ml-0" />
        </div>
      </div>

      {shown.length > 0 ? (
        // Four to a row from `lg` up. The container is 944px inside its padding
        // at the `lg` breakpoint, so a card is ~235px there and up to ~299px
        // wider on — which leaves ~203px inside the text block's padding, and
        // the Bewerben chip takes ~104px of that line. Cut this to three
        // columns if the role titles wrap too hard beside it.
        <ul className="grid gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((o) => (
            // `relative` so the two chips can sit above the card button — a
            // link nested inside a button is invalid, and reading the advert
            // and applying are genuinely different actions.
            //
            // The hover state is named `group/card` on the <li>, not `group` on
            // the button: the chips are siblings of the button, not its
            // children, so a group on the button could not reach them. Focus
            // uses `focus-within` for the same reason — the focusable element
            // is inside the group, not the group itself.
            <li key={o.role} className="group/card relative flex">
              <button
                type="button"
                onClick={() => openBewerbung(o.role)}
                aria-label={`${o.role}: bewerben`}
                className="flex flex-1 flex-col bg-surface text-left transition-colors duration-200 group-hover/card:bg-surface-2 focus-visible:relative focus-visible:z-10"
              >
                <div className="relative w-full overflow-hidden">
                  {/* Decorative: `alt=""` on purpose — the photo is context
                      for the role, not a claim that the job is for that
                      building. See the note on `openings` in the content. */}
                  <img
                    src={o.image}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="aspect-[3/2] w-full object-cover transition-transform duration-500 group-hover/card:scale-[1.03]"
                  />
                  <span className="absolute left-2.5 top-2.5 rounded-full bg-surface/90 px-2 py-0.5 eyebrow text-ink backdrop-blur-sm">
                    {o.pensum}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-1 p-4">
                  {/* Title and action on one line, the chip held to the right
                      edge. `min-w-0` on the title is what makes that work: a
                      flex item defaults to `min-width: auto`, so a long role
                      would refuse to wrap and push the chip out of the card
                      instead. `shrink-0` and `self-start` keep the chip at its
                      own width, top-aligned to the title's first line however
                      many lines follow. */}
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 font-display text-[15px] font-semibold leading-tight text-ink">
                      {o.role}
                    </h3>

                    {/* A <span>, not a <button>: this one sits *inside* the
                        card button, which is already the trigger — a button
                        nested in a button is invalid HTML. Its counterpart in
                        the photo's corner had to be a real button only because
                        it was a sibling overlay that would have swallowed the
                        click. */}
                    <span
                      aria-hidden
                      className="eyebrow flex shrink-0 items-center gap-1.5 self-start rounded-full bg-surface px-2.5 py-1 text-brand-navy ring-1 ring-line transition-colors duration-200 group-hover/card:bg-brand-navy group-hover/card:text-surface group-hover/card:ring-brand-navy group-focus-within/card:bg-brand-navy group-focus-within/card:text-surface group-focus-within/card:ring-brand-navy"
                    >
                      Bewerben
                      <span className="transition-transform duration-200 group-hover/card:translate-x-0.5">
                        →
                      </span>
                    </span>
                  </div>

                  <p className="text-[13px] text-muted">{o.place}</p>
                </div>
              </button>

              {/* The client's own job advert — served from iem.ch, not copied
                  here. It sits above the card button rather than inside it: a
                  link nested in a button is invalid HTML, and these are two
                  genuinely different actions. */}
              <a
                href={o.pdf}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Stelleninserat ${o.role} als PDF öffnen`}
                className="eyebrow absolute right-2.5 top-2.5 z-10 rounded-full bg-surface/90 px-2 py-1 text-brand-blue backdrop-blur-sm transition-colors hover:bg-surface hover:text-brand-bronze"
              >
                PDF ↗
              </a>
            </li>
          ))}
        </ul>
      ) : (
        // An empty category is an invitation, not a dead end: it says what is
        // true today and what to do about it.
        <div className="flex flex-col items-start gap-4 rounded-lg bg-surface p-8 ring-1 ring-line">
          <p className="max-w-prose text-[15px] leading-relaxed text-muted">
            {jobCategoryNotes[active]}
          </p>
          <button
            type="button"
            onClick={() => openBewerbung(active)}
            className="eyebrow flex items-center gap-1.5 text-brand-blue transition-colors hover:text-brand-bronze"
          >
            {active} anfragen
            <span aria-hidden>→</span>
          </button>
        </div>
      )}
    </div>
  );
}
