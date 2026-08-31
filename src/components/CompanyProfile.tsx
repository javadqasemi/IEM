import { companyFacts, leitbild } from "@/content/iem";

/**
 * The two halves of iem.ch/ueber-uns that the rest of this page could not carry:
 * the Leitbild, and the register of hard company facts.
 *
 * They are deliberately set as two different kinds of document. The Leitbild is
 * what IEM says about itself — prose, in the client's own words. The facts are
 * what can be checked — a schedule, set in mono, the same register form the
 * drawing's title block and the SIA phase list use. Putting the second in the
 * language of the first would blur exactly the line this page rests on.
 */

export function CompanyProfile() {
  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
      {/* Leitbild. Four statements of equal weight, so they get equal boxes —
          this is the one block on the page where a 2×2 grid is the honest
          shape rather than the default one. */}
      <div className="flex flex-col gap-6 lg:col-span-7">
        <h3 className="eyebrow text-muted">Leitbild</h3>
        <ul className="grid gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line sm:grid-cols-2">
          {leitbild.map((l) => (
            <li key={l.title} className="flex flex-col gap-3 bg-surface p-6">
              {/* The heading in the mono eyebrow style: iem.ch sets these
                  upper-case, and this is the page's own upper-case voice. */}
              <h4 className="eyebrow text-brand-blue">{l.title}</h4>
              <p className="text-[15px] leading-relaxed text-muted">{l.body}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* The facts, as a schedule. `<dl>` because that is what this is — a list
          of term/definition pairs — and it gives assistive tech the pairing for
          free, which a two-column grid of <span>s would not. */}
      <div className="flex flex-col gap-6 lg:col-span-5">
        <h3 className="eyebrow text-muted">Fakten über IEM</h3>
        <dl className="flex flex-col border-t border-line">
          {companyFacts.map((r) => (
            <div
              key={r.label}
              className="flex flex-col gap-1 border-b border-line py-3.5 sm:flex-row sm:items-baseline sm:gap-4"
            >
              <dt className="eyebrow shrink-0 text-muted sm:w-40">{r.label}</dt>
              <dd className="font-mono text-[13px] leading-snug text-ink">{r.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[13px] leading-relaxed text-muted">
          Alle Angaben veröffentlicht auf iem.ch/ueber-uns.
        </p>
      </div>
    </div>
  );
}
