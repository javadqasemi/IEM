import { useEffect, useRef, type ReactNode } from "react";
import { Badge } from "./Badge";
import { disciplines, inHLKSE, type projects } from "@/content/iem";

type Project = (typeof projects)[number];

/**
 * "Bearbeitete Fachgebiete" arrives from iem.ch as one comma-separated string,
 * in whatever order the entry was written — Heizung sometimes first, sometimes
 * after the Energiekonzept, Sanitär sometimes ahead of Lüftung. A reader
 * comparing two references wants the trades in the same place every time, so
 * the first line is always the trades **in HLKSE order** and everything else
 * follows on the next one, in the order it is published.
 *
 * HLKSE is how the trades are named in this industry, so it is the order the
 * line is built in: Heizung, Lüftung, Klima/Kälte, Sanitär, Elektro. A project
 * shows whichever of the five it actually carries — a missing one leaves no
 * hole, the next slot simply follows.
 *
 * Nothing is dropped, reordered within a line, or reworded: every item of the
 * verbatim string still prints, the row is only split in two.
 */
const HLKSE: RegExp[] = [
  /heizung/i,
  /lüftung/i,
  // Klima and Kälte are the one slot: a project names it "Kälteplanung",
  // "Klima-Kälteplanung" or "Klimaplanung". Lüftung is matched first, so a
  // combined "Lüftung/Klima" item lands in the Lüftung slot rather than here.
  /kälte|klima/i,
  /sanitär/i,
  // Matches "Koordination Elektroplanung" too — the longest item that can
  // reach this line, which is why the line below can't depend on text width.
  /elektro/i,
];

type Fach = {
  /** The HLKSE trades, in that order. Empty where the entry names none. */
  lead: string[];
  /** Everything else, in the order iem.ch publishes it. */
  rest: string[];
};

function splitFachgebiete(value: string): Fach {
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const used = new Set<number>();
  const pick = (re: RegExp) => {
    const i = items.findIndex((item, idx) => !used.has(idx) && re.test(item));
    if (i === -1) return null;
    used.add(i);
    return items[i];
  };

  const lead = HLKSE.map(pick).filter((v): v is string => v !== null);

  // Some entries name no trade at all ("Planung PV-Anlage", "Machbarkeitsstudie
  // …"). There is no HLKSE line to lift out, so the whole list prints as
  // published — as `rest`, which is the branch that wraps freely. Those items
  // are whole sentences; holding them on one row would shred them.
  if (lead.length === 0) return { lead: [], rest: items };

  return { lead, rest: items.filter((_, i) => !used.has(i)) };
}

/**
 * The HLKSE line. `flex` without `flex-wrap` is the point: the trades stay on
 * one row at the same height however long they are and however narrow the
 * dialog gets. `min-w-0` lets an item wrap inside its own slot instead of
 * pushing a later trade onto a line of its own — five items of "…planung" plus
 * the odd "Koordination Elektroplanung" cannot be made to fit by width alone.
 */
function TradeLine({ items }: { items: string[] }) {
  return (
    <span className="flex gap-x-2.5">
      {items.map((item, i) => (
        <span key={item} className="min-w-0">
          {item}
          {i < items.length - 1 ? "," : ""}
        </span>
      ))}
    </span>
  );
}

/** Everything after the trades — free to wrap, but never inside an item. */
function Fachgebiete({ items, className }: { items: string[]; className?: string }) {
  return (
    <span className={`flex flex-wrap gap-x-1.5 ${className ?? ""}`}>
      {items.map((item, i) => (
        <span key={item} className="whitespace-nowrap">
          {item}
          {i < items.length - 1 ? "," : ""}
        </span>
      ))}
    </span>
  );
}

/**
 * The full record for one reference project.
 *
 * A native `<dialog>` on purpose: `showModal()` brings the focus trap, the
 * inert background, Esc-to-close and the top layer with it, so none of that
 * has to be rebuilt (and there is no dialog library in this project).
 *
 * Rows are omitted where iem.ch publishes no value — see `ProjectDetails` in
 * `src/content/iem.ts`. An empty row would read as "we didn't bother", which
 * is worse than the row not being there.
 */
export function ProjectDialog({
  project,
  onClose,
}: {
  project: Project | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (project && !el.open) el.showModal();
    if (!project && el.open) el.close();
  }, [project]);

  if (!project) return null;

  const d = project.details;
  const fach = d?.leistungen ? splitFachgebiete(d.leistungen) : null;
  const rows: [string, ReactNode][] = [
    ["Bauherrschaft", d?.bauherr],
    ["Architektur", d?.architekt],
    ["Realisierung", project.years],
    [
      "Bearbeitete Fachgebiete",
      fach ? (
        <span className="flex flex-col gap-y-1">
          {fach.lead.length ? <TradeLine items={fach.lead} /> : null}
          {fach.rest.length ? (
            // Dimmed only where a trade line stands above it — that is what
            // makes the fixed HLKSE order visible as an order rather than
            // reading as an accidental line break.
            <Fachgebiete items={fach.rest} className={fach.lead.length ? "text-muted" : ""} />
          ) : null}
        </span>
      ) : null,
    ],
    ["Gesamt-Bausumme", d?.bausummeTotal],
    ["Bausumme Fachgebiete", d?.bausummeFach],
    ["Energiestandard", d?.energiestandard],
  ];

  return (
    <dialog
      ref={ref}
      aria-labelledby="project-dialog-title"
      onClose={onClose}
      // A click landing on the dialog element itself is a click on the
      // backdrop — the content sits in child elements.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      // A dialog does not scroll on its own — on a short viewport the last
      // rows would simply be cut off, so cap the height and let it scroll.
      // 52rem, not the 44 this started at: the value column has to hold the
      // five HLKSE trades of "Bearbeitete Fachgebiete" side by side, and the
      // widest project (Extramet, all five) measures ~526px against the 432px
      // a 44rem dialog leaves once label column and gap are taken off. The
      // trade line stays on one row below this width too — see `TradeLine` —
      // it just starts wrapping inside the slots, which is the ugly fallback
      // rather than the intended look.
      className="max-h-[calc(100dvh-2rem)] w-[min(52rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-lg bg-surface p-0 text-ink shadow-card ring-1 ring-line backdrop:bg-ink/40 backdrop:backdrop-blur-sm"
    >
      <div className="relative">
        <img
          src={project.image}
          alt={`${project.name}${project.place ? `, ${project.place}` : ""}`}
          className="aspect-[16/9] w-full object-cover"
        />
        <span className="absolute left-4 top-4 rounded-full bg-surface/90 px-2.5 py-1 eyebrow text-ink backdrop-blur-sm">
          {project.use}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Schliessen"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-surface/90 text-muted ring-1 ring-line backdrop-blur-sm transition-colors hover:text-ink hover:ring-line-strong"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-col gap-1.5">
          <h2
            id="project-dialog-title"
            className="font-display text-display-md font-semibold text-ink"
          >
            {project.name}
          </h2>
          <p className="text-[15px] text-muted">
            {[project.place, project.scope].filter(Boolean).join(" · ")}
          </p>
        </div>

        <dl className="tick-rule grid gap-x-8 gap-y-4 pt-6 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          {rows.map(([label, value]) =>
            value ? (
              <div key={label} className="contents">
                <dt className="eyebrow self-start pt-0.5 text-muted">{label}</dt>
                <dd className="text-[14px] leading-relaxed text-ink">{value}</dd>
              </div>
            ) : null,
          )}
        </dl>

        <div className="flex flex-col gap-2.5 border-t border-line pt-5">
          <span className="eyebrow text-muted">Gewerke</span>
          {/* Same HLKSE order as the trade line above and as the cards in the
              register — one project's tags must not read in two orders. */}
          <ul className="flex flex-wrap gap-1.5">
            {inHLKSE(project.disciplines).map((k) => (
              <li key={k}>
                <Badge tone={disciplines[k].tone} dot={false}>
                  {disciplines[k].label}
                </Badge>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[12px] leading-snug text-muted">
          Angaben gemäss{" "}
          <a
            href="https://www.iem.ch/referenzen"
            target="_blank"
            rel="noreferrer"
            className="text-brand-blue underline decoration-line-strong underline-offset-2 hover:text-brand-bronze"
          >
            iem.ch/referenzen
          </a>
          .
        </p>
      </div>
    </dialog>
  );
}
