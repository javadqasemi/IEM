import { phases } from "@/content/iem";

/**
 * The SIA 112 phase numbers, laid out as stations on a measurement rule. The
 * numbers are real and carry information: a Swiss client reading "31" knows
 * exactly which deliverable and which fee stage is meant.
 */
export function PhaseTrack({ active }: { active?: readonly string[] }) {
  const lit = (no: string) => active !== undefined && active.includes(no);

  return (
    <div className="flex flex-col gap-6">
      {/* Dimension bracket: the same drawing device as the hero's height line. */}
      <div className="hidden items-center gap-3 lg:flex" aria-hidden>
        <span className="h-2 w-px bg-line-strong" />
        <span className="h-px flex-1 bg-line-strong" />
        <span className="eyebrow whitespace-nowrap text-muted">
          IEM begleitet alle Phasen
        </span>
        <span className="h-px flex-1 bg-line-strong" />
        <span className="h-2 w-px bg-line-strong" />
      </div>

      <ol className="grid gap-0 border-t border-line sm:grid-cols-2 lg:grid-cols-6">
        {phases.map((p, i) => {
          // `active` is set when the 3D scene above is driving the track: the
          // phases the current act covers stay lit, the rest step back. Without
          // it the first station is the only marked one, as before.
          const on = lit(p.no);
          const dim = active !== undefined && !on;
          return (
            <li
              key={p.no}
              className={`group relative flex flex-col gap-2 border-b border-line px-0 py-6
                         transition-opacity duration-500
                         sm:border-r sm:px-5 sm:first:pl-0 sm:[&:nth-child(2n)]:border-r-0
                         lg:border-b-0 lg:[&:nth-child(2n)]:border-r lg:last:border-r-0 lg:pb-8
                         ${dim ? "opacity-45" : "opacity-100"}`}
            >
              {/* Station tick on the rule above. */}
              <span
                aria-hidden
                className={`absolute -top-px left-0 h-0.5 transition-all duration-300 ${
                  on || (active === undefined && i === 0)
                    ? "bg-brand-navy"
                    : "bg-line-strong"
                } ${on ? "w-full" : i === 0 ? "w-10" : "w-6"} group-hover:w-full`}
              />
              <span
                className={`font-mono text-[13px] font-medium tnum ${
                  on ? "text-brand-navy" : "text-brand-blue"
                }`}
              >
                {p.no}
              </span>
              <h3 className="font-display text-lg font-semibold leading-tight text-ink">
                {p.title}
              </h3>
              <p className="text-[14px] leading-relaxed text-muted">{p.body}</p>
            </li>
          );
        })}
      </ol>

      <p className="text-[13px] text-muted">
        Phasenbezeichnungen nach SIA 112. Bei Photovoltaik planen wir nach SIA 108.
      </p>
    </div>
  );
}
