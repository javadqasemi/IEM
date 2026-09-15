import { cn } from "@/lib/cn";
import { disciplineOrder, useContent, type Tone } from "@/content/iem";

/**
 * The five service lines as a full-width register: one band per line, a
 * hairline between them, the trade colour standing at the leading edge.
 *
 * It holds no state and nothing is behind a click. That is the point of this
 * version — the section had been, in turn, five stacked prose rows, an index
 * with a record beside it, and a coverage matrix, and each of those asked the
 * reader to do something (scroll, pick, decode) before it would answer. A
 * register just answers: every title, every claim, every body and the complete
 * coverage of all six disciplines are on screen at once.
 *
 * Two things it keeps from the matrix that came before it, because they were
 * the matrix's real contribution:
 *
 * - **All six disciplines are listed on every line**, and the ones a line does
 *   not cover are struck through rather than left out. "Was ist *nicht* dabei"
 *   is half of what a reader comparing two lines wants to know, and a list of
 *   only the covered ones cannot answer it.
 * - **The count is spelled out** ("4 von 6"). It is the one number in the
 *   section, and it lets you compare two lines without reading either list.
 *
 * Both states also carry `sr-only` text: nobody can hear a dot, and nobody can
 * hear 45 % opacity either.
 */

/** Trade colour, matching the `Badge` tone set. */
const farben: Record<Tone, string> = {
  neutral: "bg-line-strong",
  heat: "bg-disc-heat",
  air: "bg-disc-air",
  water: "bg-disc-water",
  power: "bg-disc-power",
  energy: "bg-disc-energy",
  model: "bg-disc-model",
};

/**
 * The complete discipline list, in HLKSE order.
 *
 * It comes from `disciplineOrder` rather than `Object.keys(disciplines)`: the
 * table is data now, and object key order is whatever the database or the JSON
 * parser handed back. The order is structural — see `schema.ts`.
 */
const allDisciplines = disciplineOrder;

export function ServiceIndex() {
  const { disciplines, services, serviceLabels } = useContent();

  return (
    <ul className="flex flex-col border-t border-line">
      {services.map((s) => (
        <li
          key={s.id}
          className="group relative border-b border-line py-8 pl-5 transition-colors duration-200 hover:bg-surface/60 sm:py-10 sm:pl-7"
        >
          {/* The trade colour upright at the leading edge — the device the
              section header and .tick-rule already use, stood on end. It is
              the row's only colour, which is why it can be this quiet. */}
          <span
            aria-hidden
            className={cn(
              "absolute bottom-8 left-0 top-8 w-1 rounded-full opacity-70 transition-opacity duration-200 group-hover:opacity-100 sm:bottom-10 sm:top-10",
              farben[s.tone],
            )}
          />

          <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
            <div className="flex flex-col gap-3 lg:col-span-7">
              <h3 className="font-display text-2xl font-semibold leading-tight text-ink sm:text-[28px]">
                {s.title}
              </h3>
              <p className="text-lg font-medium leading-snug text-ink">{s.lead}</p>
              <p className="max-w-prose leading-relaxed text-muted">{s.body}</p>
            </div>

            <div className="flex flex-col gap-3 lg:col-span-5">
              <h4 className="eyebrow flex items-baseline gap-2 text-muted">
                {serviceLabels.fachgebiete}
                <span className="font-mono text-[11px] normal-case tracking-normal text-ink/70 tnum">
                  {s.disciplines.length} {serviceLabels.von} {allDisciplines.length}
                </span>
              </h4>

              {/* Two columns of three on wider screens: six items in one column
                  would run taller than the prose beside them and drag the row
                  open for no reason. */}
              <ul className="grid max-w-sm grid-cols-2 gap-x-8 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-2">
                {allDisciplines.map((k) => {
                  const dabei = s.disciplines.includes(k);
                  return (
                    <li key={k} className="flex items-center gap-2">
                      {dabei ? (
                        <span
                          aria-hidden
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            farben[disciplines[k].tone],
                          )}
                        />
                      ) : (
                        <span aria-hidden className="h-px w-1.5 shrink-0 bg-line-strong" />
                      )}
                      <span
                        className={cn(
                          "text-[13px] leading-snug",
                          dabei ? "text-ink" : "text-muted/60 line-through decoration-line-strong",
                        )}
                      >
                        {disciplines[k].short}
                      </span>
                      <span className="sr-only">
                        {dabei ? serviceLabels.enthalten : serviceLabels.nichtEnthalten}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
