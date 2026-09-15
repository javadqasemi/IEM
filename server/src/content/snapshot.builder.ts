import { BadRequestException } from "@nestjs/common";
import { CONTENT_TYPES, type ContentTypeDef } from "./content-types";

type EntryRow = {
  typeKey: string;
  key: string;
  position: number;
  data: unknown;
  publishedData: unknown;
  status: string;
};

/**
 * Assembles one `SiteContent` document from the content entries.
 *
 * This is the single point where the CMS's row-per-entry storage becomes the
 * shape the React components read, and it is deliberately the *only* place
 * that knows the mapping. Three rules:
 *
 * 1. **A singleton writes its object under `contentKey`.** A collection writes
 *    an array in `position` order, unless its type says `shape: "keyed"`, in
 *    which case entries fold into an object under their own `key` — that is
 *    how `disciplines` and `jobCategoryNotes` stay maps on the site.
 * 2. **Two types write loose keys rather than an object.** `jobTexts` spreads
 *    its three strings at the top level and `contactEmail` unwraps its single
 *    `value`. Both are marked by a `__`-prefixed `contentKey`, which is the
 *    signal to unwrap. They exist because the site's schema has them flat and
 *    the editor wants them grouped; inventing a nested shape on the site to
 *    match the CMS would be the tail wagging the dog.
 * 3. **The result is validated before it is stored.** A snapshot missing a key
 *    is a blank section on a live page, and it would be discovered by a
 *    visitor rather than by us. `assertComplete` is what stands between a
 *    half-seeded database and that.
 */
export function buildSnapshot(
  entries: EntryRow[],
  opts: { source: "draft" | "published" } = { source: "published" },
): Record<string, unknown> {
  const byType = new Map<string, EntryRow[]>();
  for (const e of entries) {
    const list = byType.get(e.typeKey) ?? [];
    list.push(e);
    byType.set(e.typeKey, list);
  }

  const out: Record<string, unknown> = {};

  for (const type of CONTENT_TYPES) {
    const rows = (byType.get(type.key) ?? []).sort((a, b) => a.position - b.position);
    const pick = (r: EntryRow) =>
      opts.source === "published" ? (r.publishedData ?? r.data) : r.data;

    if (type.kind === "SINGLETON") {
      const row = rows[0];
      if (!row) continue;
      writeSingleton(out, type, pick(row) as Record<string, unknown>);
      continue;
    }

    if (type.shape === "keyed") {
      const map: Record<string, unknown> = {};
      for (const r of rows) {
        const value = pick(r) as Record<string, unknown>;
        // `jobCategoryNotes` is a map of strings, not of objects: its single
        // field unwraps so the site gets `{ "Lehrstellen": "…" }` rather than
        // `{ "Lehrstellen": { text: "…" } }`.
        map[r.key] =
          type.fields.length === 1 ? value[type.fields[0].name] : value;
      }
      out[type.contentKey] = map;
      continue;
    }

    out[type.contentKey] = rows.map((r) => stripEmpty(pick(r) as Record<string, unknown>));
  }

  return out;
}

function writeSingleton(
  out: Record<string, unknown>,
  type: ContentTypeDef,
  data: Record<string, unknown>,
) {
  if (type.contentKey === "__jobTexts") {
    // Spread: the site holds these three as top-level strings.
    out.jobUeberUns = data.jobUeberUns;
    out.jobBewerbung = data.jobBewerbung;
    out.jobSchluss = data.jobSchluss;
    return;
  }
  if (type.contentKey === "__contactEmail") {
    out.contactEmail = data.value;
    return;
  }
  out[type.contentKey] = data;
}

/**
 * Drops keys whose value is `undefined`, `null` or an empty string.
 *
 * This is what makes "several projects publish no architect" work: the site's
 * dialog omits a row when the key is *absent*, and an editor clearing a field
 * leaves `""` behind rather than removing it. Without this the dialog would
 * print an empty "Architektur —" row, which reads as "we could not be
 * bothered" rather than "this was never published".
 *
 * Applies one level into nested objects (`details`, `detail.kontakt`), which
 * is as deep as the content model goes.
 */
function stripEmpty(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      out[k] = v;
      continue;
    }
    if (typeof v === "object") {
      const nested = stripEmpty(v as Record<string, unknown>);
      // An object that is empty once cleaned is itself absent — an entry with
      // no `details` at all and one whose details were all cleared should
      // render the same way.
      if (Object.keys(nested).length) out[k] = nested;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Every key the public site reads.
 *
 * Mirrors `SiteContent` in `src/content/schema.ts`. It is written out rather
 * than derived because the server cannot import the site's types at runtime —
 * and because a list that has to be updated by hand when the schema grows is
 * exactly the kind of thing the check below is for: forgetting produces a
 * failing publish, not a blank section in production.
 */
const REQUIRED_KEYS = [
  "disciplines", "services", "phases", "bauakte", "projects", "offices", "socials",
  "openings", "jobCategoryNotes", "jobUeberUns", "jobBewerbung", "jobSchluss",
  "navItems", "team", "sponsorships", "facts", "leitbild", "hero", "sections",
  "phaseTrack", "ablaufControls", "teamImage", "contact", "footer", "seo",
  "contactEmail", "stelleLabels", "appLabels", "navLabels", "serviceLabels",
  "teamLabels", "jobLabels", "bewerbung", "siteSearchLabels", "searchLabels",
  "referenzLabels", "projectDialogLabels", "ueberUnsLabels",
] as const;

/**
 * Refuses to publish an incomplete document.
 *
 * Runs before the snapshot is written, so the failure lands on the person who
 * pressed Publish, with a list of what is missing — rather than on a visitor
 * looking at a page with no footer.
 */
export function assertComplete(snapshot: Record<string, unknown>): void {
  const missing = REQUIRED_KEYS.filter((k) => {
    const v = snapshot[k];
    if (v === undefined || v === null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "object") return Object.keys(v).length === 0;
    return v === "";
  });

  if (missing.length) {
    throw new BadRequestException({
      code: "snapshot_incomplete",
      message:
        `Die Veröffentlichung wurde abgebrochen: ${missing.length} Bereich(e) sind leer. ` +
        `Fehlend: ${missing.join(", ")}.`,
    });
  }
}

/**
 * Cross-checks the references the site follows but the database cannot.
 *
 * Postgres can enforce a foreign key; it cannot enforce "this project's
 * discipline keys exist in the discipline table" when both live in JSON. These
 * are the four that break something visible if they drift, so they are checked
 * at publish time — a warning, not a refusal, because the honest answer to
 * "this person's office no longer exists" is to tell an editor, not to block
 * the whole site from publishing.
 */
export function crossCheck(snapshot: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const disciplines = Object.keys((snapshot.disciplines ?? {}) as object);
  const phases = ((snapshot.phases ?? []) as { no: string }[]).map((p) => p.no);
  const offices = ((snapshot.offices ?? []) as { city: string }[]).map((o) => o.city);

  for (const p of (snapshot.projects ?? []) as { name: string; disciplines?: string[] }[]) {
    for (const d of p.disciplines ?? []) {
      if (!disciplines.includes(d)) {
        warnings.push(`Referenz „${p.name}“ nennt das unbekannte Fachgebiet „${d}“.`);
      }
    }
  }

  for (const s of (snapshot.services ?? []) as { title: string; disciplines?: string[] }[]) {
    for (const d of s.disciplines ?? []) {
      if (!disciplines.includes(d)) {
        warnings.push(`Dienstleistung „${s.title}“ nennt das unbekannte Fachgebiet „${d}“.`);
      }
    }
  }

  for (const a of (snapshot.bauakte ?? []) as { id: string; phases?: string[] }[]) {
    for (const ph of a.phases ?? []) {
      if (!phases.includes(ph)) {
        warnings.push(`Ablauf-Akt „${a.id}“ nennt die unbekannte SIA-Phase „${ph}“.`);
      }
    }
  }

  for (const m of (snapshot.team ?? []) as { name: string; office?: string | null }[]) {
    if (m.office && !offices.includes(m.office)) {
      warnings.push(
        `„${m.name}“ ist dem Standort „${m.office}“ zugeordnet, den es nicht gibt — die Person erscheint in keinem Standortfilter.`,
      );
    }
  }

  // The job advert's Bewerbung paragraph has its tail turned into a mailto:
  // link by `StelleDetail`. If the two drift the paragraph still renders, but
  // the link silently disappears — worth a warning, not a refusal.
  const bewerbung = snapshot.jobBewerbung as string | undefined;
  const email = snapshot.contactEmail as string | undefined;
  if (bewerbung && email && !bewerbung.trimEnd().endsWith(email)) {
    warnings.push(
      `Der Bewerbungstext endet nicht auf „${email}“ — auf der Inseratsseite wird die Adresse dann nicht verlinkt.`,
    );
  }

  return warnings;
}
