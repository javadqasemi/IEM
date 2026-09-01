import {
  companyFacts,
  disciplines,
  leitbild,
  offices,
  openings,
  projects,
  services,
  team,
  type Member,
} from "@/content/iem";

export type Project = (typeof projects)[number];

/**
 * Fold case and strip diacritics so "muller" finds "Müller", "sanitar" finds
 * "Sanitär" and "lueftung" is not the only spelling that works.
 */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export function normalize(value: string) {
  return value.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

export function tokenize(query: string) {
  return normalize(query).split(/\s+/).filter(Boolean);
}

/**
 * Initials for the people iem.ch shows with a silhouette placeholder — an
 * honest monogram reads better than generic stock art. Shared with `TeamGrid`
 * so the roster card and the search result show the same fallback.
 */
export function initials(name: string) {
  return name
    .split(" ")
    .filter((p) => p[0] === p[0]?.toUpperCase())
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
}

/** Result groups, in the order the panel lists them. */
export const kindOrder = [
  "Team",
  "Dienstleistungen",
  "Referenzen",
  "Fachgebiete",
  "Standorte",
  "Karriere",
  "Über uns",
] as const;

export type ResultKind = (typeof kindOrder)[number];

export type SearchResult = {
  id: string;
  kind: ResultKind;
  title: string;
  detail: string;
  href: string;
  /** Set on Referenzen hits, so selecting one can open that project's dialog. */
  project?: Project;
  /** Set on Team hits, so selecting one can narrow the team grid to them. */
  member?: Member;
  /**
   * Thumbnail for the kinds that have one — a portrait for people, the project
   * photo for references. `null` on a person iem.ch has no portrait for, which
   * is what `fallback` is for; absent entirely on the text-only kinds.
   */
  image?: string | null;
  /** Monogram shown when `image` is null. */
  fallback?: string;
  /** Portraits are 3:4, project photos 4:3 — the thumb box follows suit. */
  imageAspect?: "portrait" | "landscape";
  /** Everything matchable about the entry, pre-normalized. */
  haystack: string;
  /** Just the title, pre-normalized — drives the ranking below. */
  key: string;
};

export function projectId(p: Project) {
  return `${p.name}-${p.place ?? ""}`;
}

/**
 * Everything about a project worth matching on. Shared by the site search and
 * the Referenzen section's own box, so a term that finds a project in the
 * header finds it in the register too.
 */
export function projectTerms(p: Project) {
  return [
    p.name,
    p.place,
    p.scope,
    p.years,
    p.use,
    p.details?.bauherr,
    p.details?.architekt,
    p.details?.leistungen,
    p.details?.energiestandard,
    ...p.disciplines.map((k) => disciplines[k].label),
  ].filter(Boolean) as string[];
}

/** Token-AND match over `projectTerms`, the same rule the team search uses. */
export function matchesProject(p: Project, tokens: string[]) {
  const haystack = normalize(projectTerms(p).join(" "));
  return tokens.every((t) => haystack.includes(t));
}

function entry(r: Omit<SearchResult, "haystack" | "key"> & { extra?: (string | undefined)[] }) {
  const { extra = [], ...rest } = r;
  return {
    ...rest,
    key: normalize(r.title),
    haystack: normalize([r.title, r.detail, ...extra].filter(Boolean).join(" ")),
  };
}

/**
 * The page's content as one flat index.
 *
 * Built once at module load: `src/content/iem.ts` is static data, so there is
 * nothing to invalidate and no reason to rebuild it per keystroke.
 */
export const searchIndex: SearchResult[] = [
  ...team.map((m) =>
    entry({
      id: `team:${m.name}`,
      kind: "Team",
      title: m.name,
      // Office and Fachgruppe only. A person's function and their
      // apprenticeship are recorded but unpublished (see `Member` in the
      // content module), and the search panel is part of the page — printing
      // them here would put back exactly what the team cards no longer show.
      detail: [m.office, m.group].filter(Boolean).join(" · "),
      href: "#team",
      member: m,
      image: m.photo,
      fallback: initials(m.name),
      imageAspect: "portrait",
    }),
  ),
  ...services.map((s) =>
    entry({
      id: `service:${s.id}`,
      kind: "Dienstleistungen",
      title: s.title,
      detail: s.lead,
      href: "#leistungen",
      extra: [s.body, ...s.disciplines.map((k) => disciplines[k].label)],
    }),
  ),
  ...projects.map((p) =>
    entry({
      id: `project:${projectId(p)}`,
      kind: "Referenzen",
      title: p.name,
      detail: [p.place, p.scope, p.years].filter(Boolean).join(" · "),
      href: "#referenzen",
      project: p,
      image: p.image,
      imageAspect: "landscape",
      extra: projectTerms(p),
    }),
  ),
  ...Object.entries(disciplines).map(([key, d]) =>
    entry({
      id: `discipline:${key}`,
      kind: "Fachgebiete",
      title: d.label,
      detail: "Fachgebiet",
      href: "#leistungen",
      extra: [d.short],
    }),
  ),
  ...offices.map((o) =>
    entry({
      id: `office:${o.city}`,
      kind: "Standorte",
      title: o.city,
      detail: [o.street, o.zip, o.phone].filter(Boolean).join(" · "),
      href: "#standorte",
    }),
  ),
  ...openings.map((o) =>
    entry({
      id: `opening:${o.role}`,
      kind: "Karriere",
      title: o.role,
      detail: [o.pensum, o.place].filter(Boolean).join(" · "),
      href: "#karriere",
    }),
  ),
  // The company register is indexed by its *value*, not its label: nobody
  // searches "Mitgliedschaften", they search "Suissetec". So the value is the
  // title of the hit and the label is the detail line under it.
  ...companyFacts.map((f) =>
    entry({
      id: `fact:${f.label}`,
      kind: "Über uns",
      title: f.value,
      detail: f.label,
      href: "#ueber-uns",
    }),
  ),
  ...leitbild.map((l) =>
    entry({
      id: `leitbild:${l.title}`,
      kind: "Über uns",
      title: l.title,
      detail: "Leitbild",
      href: "#ueber-uns",
      extra: [l.body],
    }),
  ),
];

/**
 * Rank per token: a title that starts with the term beats one that merely
 * contains it, which beats a match anywhere else in the record. Without this a
 * search for "Bern" leads with whichever project happens to name Bern in its
 * client field rather than with the Bern office.
 */
function score(result: SearchResult, tokens: string[]) {
  let total = 0;
  for (const t of tokens) {
    if (result.key.startsWith(t)) continue;
    if (result.key.split(/[\s·-]+/).some((w) => w.startsWith(t))) total += 1;
    else if (result.key.includes(t)) total += 2;
    else if (result.haystack.includes(t)) total += 3;
    else return null; // every token has to land somewhere
  }
  return total;
}

export function searchSite(query: string, limit = 12, perKind = 4): SearchResult[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const scored: { result: SearchResult; rank: number }[] = [];
  for (const result of searchIndex) {
    const rank = score(result, tokens);
    if (rank !== null) scored.push({ result, rank });
  }

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      kindOrder.indexOf(a.result.kind) - kindOrder.indexOf(b.result.kind) ||
      a.result.title.localeCompare(b.result.title, "de-CH"),
  );

  // Cap each group before applying the overall limit. The roster is by far the
  // largest slice of the index, so without this a query like "Bern" fills every
  // slot with people and the Bern office — the obvious intent — never appears.
  const taken = new Map<ResultKind, number>();
  const out: SearchResult[] = [];
  for (const { result } of scored) {
    const n = taken.get(result.kind) ?? 0;
    if (n >= perKind) continue;
    taken.set(result.kind, n + 1);
    out.push(result);
    if (out.length >= limit) break;
  }
  return out;
}

/** Results in panel order, grouped under their kind. */
export function groupResults(results: SearchResult[]) {
  return kindOrder
    .map((kind) => ({ kind, items: results.filter((r) => r.kind === kind) }))
    .filter((g) => g.items.length > 0);
}
