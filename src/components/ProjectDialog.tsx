import { useEffect, useRef } from "react";
import { Badge } from "./Badge";
import { disciplines, type projects } from "@/content/iem";

type Project = (typeof projects)[number];

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
  const rows: [string, string | undefined][] = [
    ["Bauherrschaft", d?.bauherr],
    ["Architektur", d?.architekt],
    ["Realisierung", project.years],
    ["Bearbeitete Fachgebiete", d?.leistungen],
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
      className="max-h-[calc(100dvh-2rem)] w-[min(44rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-lg bg-surface p-0 text-ink shadow-card ring-1 ring-line backdrop:bg-ink/40 backdrop:backdrop-blur-sm"
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
          <ul className="flex flex-wrap gap-1.5">
            {project.disciplines.map((k) => (
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
