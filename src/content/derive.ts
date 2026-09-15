/**
 * Figures the page computes rather than stores, and the token syntax that lets
 * editable copy carry them.
 *
 * The static build had these as expressions inside JSX — `new Date().getFullYear()
 * - facts.founded`, `projects.length`, `${facts.headcount} Leute, zwei Büros.`
 * Moving the copy into the database would normally flatten all of that into
 * typed-out numbers, and typed-out numbers go stale: the client's own site says
 * "seit über 30 Jahren" in prose that somebody will have to remember to edit.
 *
 * So copy keeps the numbers as `{token}` placeholders and this module resolves
 * them at render. An editor can rewrite the sentence around a token freely; the
 * value inside it stays derived from `facts`, `projects` and `openings`.
 *
 * Two deliberate behaviours:
 *
 * - **An unknown token is left standing.** `{jahrzente}` renders as the literal
 *   `{jahrzente}`, which is visible in the dashboard preview. Blanking it would
 *   silently delete a number from a published page, which is the failure this
 *   whole mechanism exists to avoid.
 * - **Resolution is pure.** Same content in, same string out, apart from the
 *   two tokens that genuinely depend on today's date (`{jahr}`, `{jahre}`).
 */

import type { SiteContent } from "./schema";

/* ------------------------------------------------------------------ */
/* Derived figures                                                     */
/* ------------------------------------------------------------------ */

export type DerivedFigures = {
  /** Full years since founding. */
  jahre: number;
  /** The same, rounded down to a decade — "seit über 30 Jahren". */
  jahrzehnte: number;
  /** Open positions in the "Offene Stellen" category. */
  offeneStellen: number;
  /** Published reference projects. */
  referenzen: number;
  /** Offices. */
  standorte: number;
  /** The current calendar year. */
  jahr: number;
};

export function figuresOf(content: SiteContent, now = new Date()): DerivedFigures {
  const jahr = now.getFullYear();
  const jahre = jahr - content.facts.founded;
  return {
    jahre,
    jahrzehnte: Math.floor(jahre / 10) * 10,
    offeneStellen: content.openings.filter((o) => o.category === "Offene Stellen").length,
    referenzen: content.projects.length,
    standorte: content.offices.length,
    jahr,
  };
}

/**
 * German cardinals, for copy that spells a count out ("Sieben offene Stellen").
 * Past twelve, German switches to digits in running text anyway, so the table
 * stops where the language does rather than where a library would.
 */
const ZAHLWORT = [
  "Null",
  "Eine",
  "Zwei",
  "Drei",
  "Vier",
  "Fünf",
  "Sechs",
  "Sieben",
  "Acht",
  "Neun",
  "Zehn",
  "Elf",
  "Zwölf",
];

export function zahlwort(n: number): string {
  return ZAHLWORT[n] ?? String(n);
}

/* ------------------------------------------------------------------ */
/* Token resolution                                                    */
/* ------------------------------------------------------------------ */

/**
 * The tokens copy may use, with what each one means.
 *
 * This table is also the dashboard's help text — the editor for any field that
 * accepts tokens lists these, so nobody has to guess the spelling.
 */
export const tokenHelp: { token: string; meaning: string }[] = [
  { token: "{jahre}", meaning: "Volle Jahre seit der Gründung" },
  { token: "{jahrzehnte}", meaning: "Dasselbe, auf Jahrzehnte abgerundet" },
  { token: "{gegruendet}", meaning: "Gründungsjahr" },
  { token: "{gruendung}", meaning: "Gründungsdatum, ausgeschrieben" },
  { token: "{mitarbeitende}", meaning: "Anzahl Mitarbeitende" },
  { token: "{standorte}", meaning: "Anzahl Standorte" },
  { token: "{bernSeit}", meaning: "Jahr der Eröffnung Bern" },
  { token: "{referenzen}", meaning: "Anzahl Referenzprojekte" },
  { token: "{stellen}", meaning: "Anzahl offener Stellen, als Ziffer" },
  { token: "{stellenWort}", meaning: "Anzahl offener Stellen, ausgeschrieben" },
  { token: "{jahr}", meaning: "Laufendes Kalenderjahr" },
  { token: "{telefonThun}", meaning: "Telefonnummer des ersten Standorts" },
  { token: "{telefonThunHref}", meaning: "tel:-Link des ersten Standorts" },
];

function tokenTable(content: SiteContent, now?: Date): Record<string, string> {
  const f = figuresOf(content, now);
  const ersterStandort = content.offices[0];
  return {
    jahre: String(f.jahre),
    jahrzehnte: String(f.jahrzehnte),
    gegruendet: String(content.facts.founded),
    gruendung: content.facts.foundedLong,
    mitarbeitende: String(content.facts.headcount),
    standorte: String(f.standorte),
    bernSeit: String(content.facts.bernSince),
    referenzen: String(f.referenzen),
    stellen: String(f.offeneStellen),
    stellenWort: zahlwort(f.offeneStellen),
    jahr: String(f.jahr),
    telefonThun: ersterStandort?.phone ?? "",
    telefonThunHref: ersterStandort?.phoneHref ?? "",
  };
}

/**
 * Replaces every `{token}` in `text` with its derived value.
 *
 * Unknown tokens are returned untouched — see the note at the top of the file.
 */
export function resolveTokens(text: string, content: SiteContent, now?: Date): string {
  if (!text.includes("{")) return text;
  const table = tokenTable(content, now);
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in table ? table[name] : whole,
  );
}

/* ------------------------------------------------------------------ */
/* Derived content                                                     */
/* ------------------------------------------------------------------ */

/**
 * The "Fakten über IEM" table from iem.ch/ueber-uns, every row published there.
 *
 * Derived from `facts` rather than stored, so the roster count and the founding
 * date cannot drift away from the values the hero and the team grid compute
 * from — the dashboard edits `facts`, and this table follows. It is derived
 * here rather than in `CompanyProfile` because the site search indexes it too:
 * "Suissetec" and "MWST" have to find their way to the section that answers
 * them.
 */
export function companyFactsOf(content: SiteContent): { label: string; value: string }[] {
  const f = content.facts;
  return [
    { label: "Rechtsform", value: f.legalForm },
    { label: "Aktien", value: f.ownership },
    { label: "Gründung", value: `${f.foundedLong}, als Aktiengesellschaft` },
    { label: "Team", value: `${f.headcount} Mitarbeitende, inkl. Auszubildende` },
    { label: "Mitgliedschaften", value: f.memberships.join(" und ") },
    { label: "Betriebshaftpflicht", value: `${f.insurer}, Deckung ${f.insuranceCover}` },
    { label: "MwSt-Nr.", value: f.vatId },
  ];
}
