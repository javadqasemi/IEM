import { BadRequestException } from "@nestjs/common";
import { CONTENT_TYPES, type ContentTypeDef } from "./content-types";

type EntryRow = {
  typeKey: string;
  key: string;
  position: number;
  data: unknown;
  publishedData: unknown;
  status: string;
  /**
   * Optional so a caller that does not select it still typechecks — but every
   * caller should, or the filter below silently never fires. See the note on
   * `buildSnapshot`.
   */
  hidden?: boolean;
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
 * 4. **Hidden entries are dropped, here and nowhere else.** That is why the
 *    public site has no concept of visibility at all: an entry that is not in
 *    the document does not exist as far as the page is concerned. It applies to
 *    the draft preview too, so the preview shows what publishing would produce.
 *    Note the interaction with `assertComplete`: hiding *every* entry of a
 *    required collection empties it and fails the publish. That is intended,
 *    and it is the same backstop that stands between a half-seeded database and
 *    a blank section.
 *
 *    The filter reads `row.hidden`, so **a caller must select it**. A Prisma
 *    `select` that omits the column returns `undefined`, which is falsy, and
 *    the filter then silently passes everything — the feature would look
 *    implemented and do nothing.
 * 5. **`offices` does not come from a content entry.** It is injected, from the
 *    `Office` table, and it is the one key in the document that has a
 *    relational source. There used to be an `offices` content type holding the
 *    same facts as editorial copy while `Office` held them as master data for
 *    employees, projects and buildings — two stores, no relationship, and they
 *    had already disagreed: the seed put Thun at Bierigutstrasse 6 and the live
 *    site at Uttigenstrasse 49.
 *
 *    Injected rather than read here because this function is pure and must
 *    stay so — it is the model the publish screen runs on every load. The
 *    caller fetches (`OrganisationService.siteOffices`) and passes. An omitted
 *    `offices` leaves the key absent, and `assertComplete` then refuses the
 *    publish rather than blanking the site's address band, which is exactly
 *    the failure mode that backstop exists for.
 */
export function buildSnapshot(
  entries: EntryRow[],
  opts: {
    source: "draft" | "published";
    /** From the `Office` table. See rule 5 above. */
    offices?: unknown[];
  } = { source: "published" },
): Record<string, unknown> {
  const byType = new Map<string, EntryRow[]>();
  for (const e of entries) {
    if (e.hidden) continue;
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

  if (opts.offices) out.offices = opts.offices;

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

/* ------------------------------------------------------------------ */
/* Comparing two documents                                             */
/* ------------------------------------------------------------------ */

/**
 * Sorts object keys recursively, so two documents can be compared as strings.
 *
 * **Required, not tidiness.** The live document comes back out of a Postgres
 * `jsonb` column, and `jsonb` does not preserve key order — it stores an
 * object's keys in its own order and hands them back that way. A plain
 * `JSON.stringify` comparison against a freshly built object therefore reports
 * almost every object as changed, which would make the publish screen claim
 * there is always something to publish and so tell an editor nothing.
 *
 * Arrays keep their order: in this document order is meaning, because a
 * collection is written in `position` order and reordering *is* a change worth
 * reporting.
 *
 * Exported so nothing writes a second comparison that gets this wrong.
 */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Two documents are the same when their canonical forms are. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/**
 * How many things are in one area, for the diff's readout.
 *
 * A collection reports its length and a keyed map its number of entries, which
 * is the number an editor recognises — "Referenzprojekte 30 → 29" says what
 * happened. A singleton reports `null`: counting the fields of the footer would
 * be a number that looks like information and is not.
 */
function countOf(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value as object).length;
  return null;
}

/** The editor-facing name of a content key, from the content model. */
function labelFor(contentKey: string): string {
  const type = CONTENT_TYPES.find((t) => t.contentKey === contentKey);
  if (type) return type.name;
  // The two `__`-prefixed types spread loose keys, so their content key is not
  // the one that lands in the document — name those explicitly rather than
  // falling through to the raw key.
  const loose: Record<string, string> = {
    jobUeberUns: "Stelleninserat — Über uns",
    jobBewerbung: "Stelleninserat — Bewerbung",
    jobSchluss: "Stelleninserat — Schlusssatz",
    contactEmail: "Bewerbungsadresse",
    // Injected from the `Office` table rather than written by a content type,
    // so `CONTENT_TYPES` has no name for it — see rule 5 on `buildSnapshot`.
    // The publish screen would otherwise report a changed area as "offices".
    offices: "Standorte",
  };
  return loose[contentKey] ?? contentKey;
}

/**
 * What differs between the live document and the one the next publish builds.
 *
 * Per **area** rather than per field, because that is the question the publish
 * screen asks: an editor deciding whether to publish wants to know that the
 * team and the references have changed, not that `team[17].office` did.
 *
 * The comparison is what makes the screen honest. It used to count `APPROVED`
 * entries instead, and that count is not the question — a **deletion** never
 * reaches `APPROVED` (the row is marked deleted and its status left alone) and
 * neither does a **reordering** or a **hide**. So removing a team member left
 * the screen reporting nothing to do, with the publish button disabled, while
 * the live page still showed the person. Comparing built documents catches all
 * four the same way.
 *
 * `live` is null before anything has ever been published, and every area then
 * counts as new.
 */
export function diffDocuments(
  live: Record<string, unknown> | null,
  next: Record<string, unknown>,
): { key: string; label: string; live: number | null; next: number | null }[] {
  const keys = [...new Set([...Object.keys(live ?? {}), ...Object.keys(next)])].sort();

  const changes: { key: string; label: string; live: number | null; next: number | null }[] = [];
  for (const key of keys) {
    const before = live?.[key];
    const after = next[key];
    if (same(before, after)) continue;
    changes.push({
      key,
      label: labelFor(key),
      live: live ? countOf(before) : null,
      next: countOf(after),
    });
  }
  return changes;
}

/* ------------------------------------------------------------------ */
/* What the next publish would use                                     */
/* ------------------------------------------------------------------ */

/**
 * The rows `publish()` would build its snapshot from, without writing anything.
 *
 * A **pure model of the first two steps** `publish()` performs inside its
 * transaction:
 *
 * 1. every `APPROVED` entry has its `data` promoted to `publishedData`;
 * 2. the snapshot is built from every non-deleted row that has a
 *    `publishedData` — `where: { deletedAt: null, publishedData: { not: DbNull } }`.
 *
 * Step 1 is modelled by substituting `data` for `publishedData` on approved
 * rows; step 2 by dropping rows that would still have none. A row that has
 * never been published and is not approved is therefore absent from both — it
 * is a draft, and a draft is not on the site.
 *
 * **`publish()` deliberately does not call this.** It writes the rows and reads
 * them back, so what it stores is what the database actually holds rather than
 * what this function predicted. The duplication is the point: this one has to
 * be side-effect free because `GET /content/pending` runs it on every load of
 * the publish screen. If the promotion rule changes, change it in both.
 *
 * Deleted rows are the caller's responsibility — `pendingChanges` already
 * queries `where: { deletedAt: null }`, which is what makes a deletion show up
 * here as an absence.
 */
export function rowsForNextPublish<T extends EntryRow>(rows: T[]): T[] {
  return rows
    .map((row) =>
      row.status === "APPROVED" ? ({ ...row, publishedData: row.data } as T) : row,
    )
    .filter((row) => row.publishedData !== null && row.publishedData !== undefined);
}
