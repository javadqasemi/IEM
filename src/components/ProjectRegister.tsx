import { useEffect, useMemo, useState } from "react";
import { Badge } from "./Badge";
import { ProjectDialog } from "./ProjectDialog";
import { OPEN_PROJECT } from "./SiteSearch";
import { matchesProject, projectId, tokenize } from "@/lib/search";
import { disciplines, projects, useCategories, type UseCategory } from "@/content/iem";

type Filter = UseCategory | "Alle";
type Project = (typeof projects)[number];

const filters: Filter[] = ["Alle", ...useCategories];

/**
 * The references as a register rather than a set of hero cards: what was built,
 * where, when, and which trades IEM carried. The filter mirrors the one on
 * iem.ch, because "show me a school like mine" is the actual question a client
 * arrives with.
 */
export function ProjectRegister() {
  const [active, setActive] = useState<Filter>("Alle");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Project | null>(null);

  const tokens = useMemo(() => tokenize(query), [query]);

  const shown = useMemo(() => {
    const byUse = active === "Alle" ? projects : projects.filter((p) => p.use === active);
    return tokens.length ? byUse.filter((p) => matchesProject(p, tokens)) : byUse;
  }, [active, tokens]);

  // Picking a reference in the site search opens its dialog here. The filters
  // reset with it, so the card behind the dialog is actually in the register
  // rather than hidden by a category or query set earlier.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      const match = projects.find((p) => projectId(p) === id);
      if (!match) return;
      setActive("Alle");
      setQuery("");
      setOpen(match);
    };
    window.addEventListener(OPEN_PROJECT, onOpen);
    return () => window.removeEventListener(OPEN_PROJECT, onOpen);
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label="Referenzen nach Nutzung filtern" className="flex flex-wrap gap-2">
          {filters.map((f) => {
            const isActive = f === active;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setActive(f)}
                aria-pressed={isActive}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  isActive
                    ? "bg-ink text-surface"
                    : "bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-line-strong"
                }`}
              >
                {f}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-64">
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 L14 14" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Referenz suchen"
              aria-label="Referenzen nach Objekt, Ort, Bauherrschaft oder Fachgebiet durchsuchen"
              className="w-full rounded-full bg-surface py-1.5 pl-9 pr-9 text-[13px] text-ink ring-1 ring-line transition-colors placeholder:text-muted hover:ring-line-strong [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Suche zurücksetzen"
                className="absolute right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 16 16"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                >
                  <path d="M4 4 L12 12 M12 4 L4 12" />
                </svg>
              </button>
            ) : null}
          </div>

          {/* "im Auszug", not "von allen": the hero cites 31 published references
              and this register shows a selection. Don't let the two numbers
              contradict each other. */}
          <p aria-live="polite" className="eyebrow whitespace-nowrap text-muted">
            {shown.length} von {projects.length} im Auszug
          </p>
        </div>
      </div>

      <ul className="grid gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((p) => (
          <li key={`${p.name}-${p.place}`} className="flex">
            {/* The whole card is the trigger, not the corner marker: a 32px
                glyph is a weak affordance and a poor touch target, and these
                extra fields — client, architect, cost — are the checkable
                specifics the section is built on. They should be easy to
                reach, not hidden behind a discoverability puzzle. */}
            <button
              type="button"
              onClick={() => setOpen(p)}
              aria-label={`${p.name}: Projektangaben öffnen`}
              className="group flex flex-1 flex-col bg-surface text-left transition-colors duration-200 hover:bg-surface-2 focus-visible:relative focus-visible:z-10"
            >
              <div className="relative w-full overflow-hidden">
                <img
                  src={p.image}
                  alt={`${p.name}, ${p.place}`}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
                <span className="absolute left-3 top-3 rounded-full bg-surface/90 px-2.5 py-1 eyebrow text-ink backdrop-blur-sm">
                  {p.use}
                </span>
                <span
                  aria-hidden
                  className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-surface/90 text-muted ring-1 ring-line backdrop-blur-sm transition-all duration-200 group-hover:bg-brand-navy group-hover:text-surface group-hover:ring-brand-navy"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
                    <path
                      d="M7 17L17 7M9 7h8v8"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-4 p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-display text-xl font-semibold leading-tight text-ink">
                    {p.name}
                  </h3>
                  <span className="font-mono text-[11px] tnum text-muted">{p.years}</span>
                </div>
                <p className="text-[14px] text-muted">
                  {[p.place, p.scope].filter(Boolean).join(" · ")}
                </p>

                {/* Energiestandard earns a place on the card rather than only
                    in the dialog: it is short, it differentiates, and it is
                    what a client scans for. */}
                {p.details?.energiestandard ? (
                  <p className="flex items-center gap-1.5 font-mono text-[11px] text-disc-energy">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-disc-energy" />
                    {p.details.energiestandard}
                  </p>
                ) : null}

                <ul className="mt-auto flex flex-wrap gap-1.5 pt-2">
                  {p.disciplines.map((k) => (
                    <li key={k}>
                      <Badge tone={disciplines[k].tone} dot={false}>
                        {disciplines[k].short}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-[14px] text-muted">
          {query.trim()
            ? `Keine Referenz gefunden für „${query.trim()}“.`
            : `Keine Referenz in der Kategorie „${active}“.`}{" "}
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setActive("Alle");
            }}
            className="font-medium text-brand-blue underline decoration-line-strong underline-offset-4 transition-colors hover:text-brand-bronze"
          >
            Auswahl zurücksetzen
          </button>
        </p>
      ) : null}

      <ProjectDialog project={open} onClose={() => setOpen(null)} />
    </div>
  );
}
