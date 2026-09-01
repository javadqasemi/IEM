import { useEffect, useMemo, useState } from "react";
import { FILTER_TEAM } from "./SiteSearch";
import { initials, normalize } from "@/lib/search";
import { team, trades, type Member, type Trade } from "@/content/iem";

type Filter = "Alle" | "Thun" | "Bern";
const filters: Filter[] = ["Alle", "Thun", "Bern"];

/**
 * The dropdown is a plain filter, not a re-sort: "Alle" leaves the roster in
 * its authored order and looking exactly as it did before the dropdown existed,
 * and picking an option narrows it to that group.
 */
type GroupChoice = "Alle" | Trade;

/**
 * A-Z by first name, with the surname as tiebreak.
 *
 * `de-CH` rather than a raw `<`, so Ä/Ö/Ü sort beside A/O/U instead of after Z,
 * and the sort is applied at render — `team` in the content file stays in its
 * documented office order, which is what makes it checkable against iem.ch.
 */
function byFirstName(a: Member, b: Member) {
  const [aFirst, ...aRest] = a.name.split(" ");
  const [bFirst, ...bRest] = b.name.split(" ");
  return (
    aFirst.localeCompare(bFirst, "de-CH") || aRest.join(" ").localeCompare(bRest.join(" "), "de-CH")
  );
}

/**
 * Every whitespace-separated token must appear somewhere in the member's name,
 * office or Fachgruppe, so "pedro sanitär" narrows instead of returning
 * nothing. `normalize` is shared with the site search, so both boxes fold
 * umlauts the same way.
 *
 * A person's function and their apprenticeship are deliberately *not* in the
 * haystack. The cards no longer print either, so matching on them would filter
 * the roster on something the reader cannot see — and typing "Lernende" would
 * still single out the apprentices, which is exactly what removing the label
 * was meant to stop.
 */
function matches(member: Member, tokens: string[]) {
  const haystack = normalize([member.name, member.office, member.group].filter(Boolean).join(" "));
  return tokens.every((t) => haystack.includes(t));
}

function Portrait({ member, className = "" }: { member: Member; className?: string }) {
  if (!member.photo) {
    return (
      <div
        className={`flex items-center justify-center bg-brand-navy/[0.07] ${className}`}
        aria-hidden
      >
        <span className="font-display text-2xl font-semibold text-brand-navy/45">
          {initials(member.name)}
        </span>
      </div>
    );
  }
  return (
    <img
      src={member.photo}
      alt={member.name}
      loading="lazy"
      decoding="async"
      className={`object-cover ${className}`}
    />
  );
}

export function TeamGrid() {
  const [active, setActive] = useState<Filter>("Alle");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<GroupChoice>("Alle");

  const tokens = useMemo(() => normalize(query).split(/\s+/).filter(Boolean), [query]);

  // Picking a person in the site search narrows this grid to them, rather than
  // dropping the visitor at the top of a 38-card roster to find them by eye.
  // The office and group filters reset with it, or the person could be filtered
  // straight back out by a selection made earlier.
  useEffect(() => {
    const onFilter = (e: Event) => {
      const name = (e as CustomEvent<{ name: string }>).detail?.name;
      if (!name) return;
      setQuery(name);
      setActive("Alle");
      setGroup("Alle");
    };
    window.addEventListener(FILTER_TEAM, onFilter);
    return () => window.removeEventListener(FILTER_TEAM, onFilter);
  }, []);

  // Split on `lead` — the one field that says who sits in the Geschäftsleitung.
  // Nothing on the page prints a function any more, so this is the *only* thing
  // that can drive the split; don't reintroduce a "has a role" test.
  //
  // The office pills stay a roster-only filter, as before — but search spans
  // both blocks, because looking up a name has to find that person whether or
  // not they sit in the Geschäftsleitung.
  const leads = useMemo(() => team.filter((m) => m.lead && matches(m, tokens)), [tokens]);
  const roster = useMemo(() => {
    const rest = team.filter((m) => !m.lead && matches(m, tokens));
    const byOffice = active === "Alle" ? rest : rest.filter((m) => m.office === active);
    const byGroup = group === "Alle" ? byOffice : byOffice.filter((m) => m.group === group);
    return [...byGroup].sort(byFirstName);
  }, [active, group, tokens]);

  const total = leads.length + roster.length;

  return (
    <div className="flex flex-col gap-14">
      {/* ---- Geschäftsleitung ---- */}
      {leads.length > 0 ? (
        <div className="flex flex-col gap-5">
          <h3 className="eyebrow text-muted">Geschäftsleitung</h3>
          <ul className="grid gap-5 sm:grid-cols-3">
            {leads.map((m) => (
              <li
                key={m.name}
                className="group flex flex-col overflow-hidden rounded-lg bg-surface ring-1 ring-line"
              >
                <div className="relative overflow-hidden">
                  <Portrait
                    member={m}
                    className="aspect-[4/5] w-full transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                </div>
                {/* Name and function. These three titles are the only ones on
                    the page, and the only ones iem.ch itself publishes — the
                    roster's `role` values came from IEM internally and stay
                    unprinted. `role` is optional, so guard it rather than
                    assuming a lead has one. */}
                <div className="p-5">
                  <h4 className="font-display text-lg font-semibold leading-tight text-ink">
                    {m.name}
                  </h4>
                  {m.role ? (
                    <p className="mt-1.5 text-[13px] leading-snug text-muted">{m.role}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ---- Full roster ---- */}
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="eyebrow text-muted">Das Team</h3>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-60">
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
                placeholder="Person suchen"
                aria-label="Team nach Name, Fachgruppe oder Standort durchsuchen"
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
            {/* Native <select> on purpose: it brings keyboard handling, the
                mobile picker and screen-reader semantics for free, the same
                trade the page makes with <dialog> in ProjectDialog. Only the
                chevron is custom — `appearance-none` drops the platform one. */}
            <div className="relative">
              <select
                value={group}
                onChange={(e) => setGroup(e.target.value as GroupChoice)}
                aria-label="Team nach Fachgruppe sortieren"
                className="w-full cursor-pointer appearance-none rounded-full bg-surface py-1.5 pl-4 pr-9 text-[13px] font-medium text-ink ring-1 ring-line transition-colors hover:ring-line-strong sm:w-auto"
              >
                <option value="Alle">Alle Gruppen</option>
                {trades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <svg
                aria-hidden
                viewBox="0 0 16 16"
                className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 6 L8 10 L12 6" />
              </svg>
            </div>

            <div role="group" aria-label="Team nach Standort filtern" className="flex gap-2">
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
                        ? "bg-brand-navy text-surface"
                        : "bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-line-strong"
                    }`}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
            <p aria-live="polite" className="eyebrow whitespace-nowrap text-muted">
              {total} {total === 1 ? "Person" : "Personen"}
            </p>
          </div>
        </div>

        <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {roster.map((m) => (
            <li key={m.name} className="group flex flex-col gap-3">
              <div className="relative overflow-hidden rounded-md ring-1 ring-line">
                <Portrait
                  member={m}
                  className="aspect-[3/4] w-full transition-transform duration-500 group-hover:scale-[1.04]"
                />
              </div>
              {/* Name and office, nothing else. The roster used to print a
                  function and a "· Lernende" marker; both were removed at the
                  client's request, so no card singles a person out by rank or
                  by being an apprentice. */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium leading-tight text-ink">{m.name}</span>
                <span className="font-mono text-[10px] uppercase tracking-ultra-wide text-muted">
                  {m.office}
                </span>
              </div>
            </li>
          ))}
        </ul>

        {total === 0 ? (
          <p className="py-8 text-center text-[14px] text-muted">
            {query.trim()
              ? `Keine Person gefunden für „${query.trim()}“.`
              : `Für die Gruppe „${group}“ ist noch niemand erfasst.`}{" "}
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setGroup("Alle");
                setActive("Alle");
              }}
              className="font-medium text-brand-blue underline decoration-line-strong underline-offset-4 transition-colors hover:text-brand-bronze"
            >
              Auswahl zurücksetzen
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
