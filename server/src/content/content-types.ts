/**
 * The content model, described once.
 *
 * Every entry here does three jobs at the same time, which is the point: the
 * dashboard renders a form from it, the service validates writes against it,
 * and the snapshot builder uses `contentKey` to assemble the `SiteContent`
 * document the public site consumes. One description, so a field cannot exist
 * in the editor but not in the payload, or vice versa.
 *
 * `contentKey` names the key on `SiteContent` (see `src/content/schema.ts` in
 * the site package). A `SINGLETON` writes its `data` there directly; a
 * `COLLECTION` writes an array of its entries in `position` order. Two
 * collections are exceptions and say so: `disciplines` and `jobCategoryNotes`
 * are keyed maps on the site, so their builder folds entries into an object.
 *
 * **What is deliberately not here.** Closed sets — `Tone`, `DisciplineKey`,
 * `UseCategory`, `JobCategory`, `Trade` — are structural. They map to Tailwind
 * classes, sort orders and component branches, so the CMS may choose *among*
 * them (that is what `select` fields are for) but may not add to them. Adding
 * a seventh discipline is a code change, and should be.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "richtext"
  | "number"
  | "boolean"
  | "select"
  | "multiselect"
  | "image"
  | "file"
  | "url"
  | "email"
  | "tel"
  | "date"
  | "color"
  | "list"
  | "object"
  | "objectList";

export type FieldDef = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Shown under the input. Say *why* a rule exists, not just what it is. */
  help?: string;
  /** For `select` / `multiselect`. */
  options?: { value: string; label: string }[];
  /** For `select` whose options are another content type's entries. */
  optionsFrom?: string;
  /** For `list` — the element type. */
  of?: FieldType;
  /** For `object` / `objectList` — the nested shape. */
  fields?: FieldDef[];
  maxLength?: number;
  min?: number;
  max?: number;
  /** Marks a field whose copy accepts `{token}` placeholders. */
  tokens?: boolean;
  /** Hidden from the form; kept so a round-trip does not drop it. */
  readOnly?: boolean;
};

export type ContentTypeDef = {
  key: string;
  kind: "SINGLETON" | "COLLECTION";
  name: string;
  description: string;
  /** Key on `SiteContent`. */
  contentKey: string;
  /**
   * Collections only. `"array"` writes `[…]`; `"keyed"` folds entries into an
   * object under each entry's `key`, for the two site fields that are maps.
   */
  shape?: "array" | "keyed";
  orderable?: boolean;
  icon?: string;
  rank: number;
  fields: FieldDef[];
};

const TONE_OPTIONS = [
  { value: "heat", label: "Heizung (Bronze)" },
  { value: "air", label: "Lüftung (Blau)" },
  { value: "water", label: "Sanitär (Petrol)" },
  { value: "power", label: "Elektro (Gold)" },
  { value: "energy", label: "Energie (Moos)" },
  { value: "model", label: "BIM (Navy)" },
  { value: "neutral", label: "Neutral" },
];

const DISCIPLINE_OPTIONS = [
  { value: "heizung", label: "Heizung & HLK" },
  { value: "lueftung", label: "Lüftung & Klima" },
  { value: "sanitaer", label: "Sanitär" },
  { value: "elektro", label: "Elektro & Automation" },
  { value: "energie", label: "Energie & Sanierung" },
  { value: "bim", label: "BIM & 3D" },
];

const USE_OPTIONS = [
  { value: "Pflege & Wohnen", label: "Pflege & Wohnen" },
  { value: "Bildung", label: "Bildung" },
  { value: "Gewerbe & Industrie", label: "Gewerbe & Industrie" },
  { value: "Energie & PV", label: "Energie & PV" },
];

const JOB_CATEGORY_OPTIONS = [
  { value: "Offene Stellen", label: "Offene Stellen" },
  { value: "Schnupperlehre", label: "Schnupperlehre" },
  { value: "Lehrstellen", label: "Lehrstellen" },
];

const TRADE_OPTIONS = [
  { value: "Admin", label: "Admin" },
  { value: "Heizung", label: "Heizung" },
  { value: "Lüftung", label: "Lüftung" },
  { value: "Sanitär", label: "Sanitär" },
];

const BUTTON_VARIANT_OPTIONS = [
  { value: "primary", label: "Primär (Navy)" },
  { value: "secondary", label: "Sekundär (Umriss)" },
  { value: "ghost", label: "Ghost" },
  { value: "inverse", label: "Invers (auf Navy)" },
  { value: "inverseOutline", label: "Invers Umriss" },
  { value: "mark", label: "Mark — nur für die Bewerbung" },
];

const CTA_FIELDS: FieldDef[] = [
  { name: "label", label: "Beschriftung", type: "text", required: true, tokens: true },
  {
    name: "href",
    label: "Ziel",
    type: "text",
    tokens: true,
    help: "Anker (#kontakt), mailto: oder tel:. Leer lassen, wenn eine Aktion gewählt ist.",
  },
  {
    name: "action",
    label: "Aktion statt Link",
    type: "select",
    options: [{ value: "bewerbung", label: "Bewerbungsformular öffnen" }],
    help: "Nur für Schaltflächen, die kein Ziel haben, sondern etwas auf der Seite auslösen.",
  },
  { name: "variant", label: "Stil", type: "select", required: true, options: BUTTON_VARIANT_OPTIONS },
  {
    name: "trailing",
    label: "Zeichen am Ende",
    type: "text",
    maxLength: 2,
    help: "Zum Beispiel → oder ↗. Beim Mark-Stil bewusst leer lassen.",
  },
];

/** The label-only blocks: a flat list of `text` fields with sensible help. */
function labelBlock(
  key: string,
  name: string,
  description: string,
  contentKey: string,
  rank: number,
  fields: [string, string, string?][],
): ContentTypeDef {
  return {
    key,
    kind: "SINGLETON",
    name,
    description,
    contentKey,
    rank,
    icon: "label",
    fields: fields.map(([n, label, help]) => ({
      name: n,
      label,
      type: "text",
      required: true,
      help,
    })),
  };
}

export const CONTENT_TYPES: ContentTypeDef[] = [
  // =================================================================
  // Startseite
  // =================================================================
  {
    key: "hero",
    kind: "SINGLETON",
    name: "Hero",
    description: "Der Seitenkopf mit Titel, Lead, Schaltflächen und den vier Kennzahlen.",
    contentKey: "hero",
    rank: 10,
    icon: "hero",
    fields: [
      { name: "eyebrowPlace", label: "Eyebrow links", type: "text", required: true },
      { name: "eyebrowSince", label: "Eyebrow rechts", type: "text", required: true, tokens: true },
      { name: "title", label: "Titel", type: "textarea", required: true, tokens: true },
      { name: "lead", label: "Lead", type: "textarea", required: true, tokens: true },
      { name: "ctas", label: "Schaltflächen", type: "objectList", fields: CTA_FIELDS },
      {
        name: "phasePrefix",
        label: "Präfix der Phasenanzeige",
        type: "text",
        required: true,
        help: 'Steht vor der laufenden SIA-Phase, z. B. "SIA".',
      },
      {
        name: "kpis",
        label: "Kennzahlen",
        type: "objectList",
        help: "Vier Werte unter dem Lead. Zahlen als Platzhalter eintragen, damit sie berechnet bleiben.",
        fields: [
          { name: "value", label: "Wert", type: "text", required: true, tokens: true },
          { name: "label", label: "Bezeichnung", type: "text", required: true },
          { name: "note", label: "Quellenhinweis", type: "text", tokens: true },
          {
            name: "tone",
            label: "Farbe",
            type: "select",
            options: [
              { value: "ink", label: "Tinte" },
              { value: "navy", label: "Navy" },
              { value: "gold", label: "Gold" },
              { value: "water", label: "Petrol" },
              { value: "energy", label: "Moos" },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "sections",
    kind: "SINGLETON",
    name: "Abschnitts-Überschriften",
    description:
      "Eyebrow, Titel und Beschreibung der acht Abschnitte. Zahlen bleiben als Platzhalter berechnet.",
    contentKey: "sections",
    rank: 20,
    icon: "sections",
    fields: (
      [
        ["leistungen", "Dienstleistungen"],
        ["ablauf", "Ablauf"],
        ["referenzen", "Referenzen"],
        ["ueberUns", "Über uns"],
        ["team", "Team"],
        ["sponsoring", "Sponsoring"],
        ["karriere", "Karriere"],
        ["standorte", "Standorte"],
      ] as const
    ).map(([name, label]) => ({
      name,
      label,
      type: "object" as const,
      fields: [
        { name: "eyebrow", label: "Eyebrow", type: "text" as const, required: true },
        { name: "title", label: "Titel", type: "text" as const, required: true, tokens: true },
        {
          name: "description",
          label: "Beschreibung",
          type: "textarea" as const,
          required: true,
          tokens: true,
        },
      ],
    })),
  },

  // =================================================================
  // Sammlungen
  // =================================================================
  {
    key: "disciplines",
    kind: "COLLECTION",
    name: "Fachgebiete",
    description:
      "Die sechs Gewerke. Bezeichnungen sind änderbar, die Schlüssel und ihre Reihenfolge nicht — daran hängen Farben und Sortierung auf der ganzen Seite.",
    contentKey: "disciplines",
    shape: "keyed",
    orderable: false,
    rank: 30,
    icon: "tag",
    fields: [
      { name: "label", label: "Bezeichnung", type: "text", required: true },
      { name: "short", label: "Kurzform", type: "text", required: true, maxLength: 20 },
      {
        name: "tone",
        label: "Farbe",
        type: "select",
        required: true,
        options: TONE_OPTIONS,
        help: "Bestimmt die Farbe dieses Gewerks überall auf der Seite.",
      },
    ],
  },
  {
    key: "services",
    kind: "COLLECTION",
    name: "Dienstleistungen",
    description: "Die Leistungen, in der Reihenfolge, in der die Seite sie auflistet.",
    contentKey: "services",
    rank: 40,
    icon: "service",
    fields: [
      { name: "id", label: "Kennung", type: "text", required: true, help: "Kleinbuchstaben, keine Leerzeichen." },
      { name: "title", label: "Titel", type: "text", required: true },
      { name: "lead", label: "Lead", type: "textarea", required: true },
      { name: "body", label: "Text", type: "textarea", required: true },
      {
        name: "disciplines",
        label: "Abgedeckte Fachgebiete",
        type: "multiselect",
        required: true,
        options: DISCIPLINE_OPTIONS,
        help: "Nicht gewählte Fachgebiete erscheinen durchgestrichen — das ist beabsichtigt.",
      },
      { name: "tone", label: "Farbe", type: "select", required: true, options: TONE_OPTIONS },
    ],
  },
  {
    key: "phases",
    kind: "COLLECTION",
    name: "SIA-Phasen",
    description: "Die Phasen nach SIA 112. Die Nummern sind echt und gehören zur Aussage.",
    contentKey: "phases",
    rank: 50,
    icon: "phase",
    fields: [
      { name: "no", label: "Nummer", type: "text", required: true, maxLength: 4 },
      { name: "title", label: "Titel", type: "text", required: true },
      { name: "body", label: "Text", type: "text", required: true },
    ],
  },
  {
    key: "bauakte",
    kind: "COLLECTION",
    name: "Ablauf-Akte",
    description:
      "Die drei Akte der 3D-Szene. Die Phasennummern müssen zu den SIA-Phasen passen — der Phasenbalken hebt genau diese hervor.",
    contentKey: "bauakte",
    rank: 60,
    icon: "act",
    fields: [
      { name: "id", label: "Kennung", type: "text", required: true },
      { name: "role", label: "Rolle", type: "text", required: true },
      {
        name: "phases",
        label: "Abgedeckte Phasen",
        type: "list",
        of: "text",
        required: true,
        help: "Nummern wie 31, 32 — müssen in den SIA-Phasen vorkommen.",
      },
      { name: "title", label: "Titel", type: "text", required: true },
      { name: "body", label: "Text", type: "textarea", required: true },
    ],
  },
  {
    key: "projects",
    kind: "COLLECTION",
    name: "Referenzprojekte",
    description:
      "Die öffentlich dokumentierten Projekte. Angaben stammen wörtlich von iem.ch/referenzen — eine Lücke bleibt leer, sie wird nicht geschätzt.",
    contentKey: "projects",
    rank: 70,
    icon: "project",
    fields: [
      { name: "name", label: "Objekt", type: "text", required: true },
      { name: "place", label: "Ort", type: "text", help: "Leer lassen, wo iem.ch keinen Ort nennt." },
      { name: "years", label: "Realisierung", type: "text", required: true },
      { name: "use", label: "Nutzung", type: "select", required: true, options: USE_OPTIONS },
      { name: "scope", label: "Art der Arbeit", type: "text", required: true },
      { name: "image", label: "Foto", type: "image", required: true, help: "Ohne Foto bricht die Rasterung." },
      {
        name: "disciplines",
        label: "Gewerke",
        type: "multiselect",
        required: true,
        options: DISCIPLINE_OPTIONS,
      },
      {
        name: "details",
        label: "Detailangaben",
        type: "object",
        help: "Erscheinen im Dialog. Leere Felder werden weggelassen, nicht mit Platzhaltern gefüllt.",
        fields: [
          { name: "bauherr", label: "Bauherrschaft", type: "text" },
          { name: "architekt", label: "Architektur", type: "text" },
          { name: "leistungen", label: "Bearbeitete Fachgebiete", type: "textarea" },
          { name: "bausummeTotal", label: "Gesamt-Bausumme", type: "text" },
          { name: "bausummeFach", label: "Bausumme Fachgebiete", type: "text" },
          { name: "energiestandard", label: "Energiestandard", type: "text" },
        ],
      },
    ],
  },
  {
    key: "team",
    kind: "COLLECTION",
    name: "Team",
    description:
      "Die Belegschaft. Funktion wird nur bei den drei GL-Mitgliedern angezeigt; alles andere ist erfasst, aber unveröffentlicht.",
    contentKey: "team",
    rank: 80,
    icon: "person",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      {
        name: "office",
        label: "Standort",
        type: "select",
        optionsFrom: "offices",
        help: "Muss einem Standort entsprechen — daran hängt der Filter im Team-Raster.",
      },
      {
        name: "role",
        label: "Funktion",
        type: "text",
        help: "Wird nur bei Geschäftsleitungsmitgliedern angezeigt. Nie raten — nur eintragen, was IEM angibt.",
      },
      { name: "lead", label: "Geschäftsleitung", type: "boolean" },
      { name: "group", label: "Fachgruppe", type: "select", options: TRADE_OPTIONS },
      {
        name: "lernend",
        label: "Lernende:r",
        type: "boolean",
        help: "Wird erfasst, aber bewusst nirgends angezeigt und nicht durchsucht.",
      },
      {
        name: "photo",
        label: "Porträt",
        type: "image",
        help: "Leer lassen, wenn kein Porträt vorliegt — dann erscheinen die Initialen.",
      },
    ],
  },
  {
    key: "openings",
    kind: "COLLECTION",
    name: "Stellen",
    description:
      "Offene Stellen mit vollständigem Inseratstext. Der Text steht wörtlich so im PDF — Umformulieren ändert die Anstellungsbedingungen.",
    contentKey: "openings",
    rank: 90,
    icon: "job",
    fields: [
      { name: "id", label: "Kennung", type: "text", required: true, help: "Wird zu /stelle.html?id=…" },
      { name: "role", label: "Rolle", type: "text", required: true },
      { name: "pensum", label: "Pensum", type: "text", required: true },
      { name: "place", label: "Ort", type: "text", required: true },
      { name: "pdf", label: "Original-PDF", type: "url", required: true },
      { name: "image", label: "Bild", type: "image", required: true, help: "Anlage oder Technik, kein Gebäude." },
      { name: "category", label: "Kategorie", type: "select", required: true, options: JOB_CATEGORY_OPTIONS },
      {
        name: "detail",
        label: "Inseratstext",
        type: "object",
        fields: [
          { name: "titel", label: "Titel des Inserats", type: "text", required: true },
          { name: "einstieg", label: "Einstiegssatz", type: "textarea", required: true },
          { name: "aufgaben", label: "Deine Aufgaben", type: "list", of: "text", required: true },
          { name: "profil", label: "Dein Profil", type: "list", of: "text", required: true },
          { name: "bieten", label: "Wir bieten", type: "list", of: "text", required: true },
          {
            name: "kontakt",
            label: "Kontakt für Rückfragen",
            type: "object",
            fields: [
              { name: "name", label: "Name", type: "text", required: true },
              { name: "telefon", label: "Telefon", type: "tel", required: true },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "offices",
    kind: "COLLECTION",
    name: "Standorte",
    description: "Die Büros. Der erste Eintrag liefert die Telefonnummer für Kopf und Kontaktfeld.",
    contentKey: "offices",
    rank: 100,
    icon: "office",
    fields: [
      { name: "city", label: "Ort", type: "text", required: true },
      { name: "street", label: "Strasse", type: "text", required: true },
      { name: "zip", label: "PLZ und Ort", type: "text", required: true },
      { name: "phone", label: "Telefon", type: "tel", required: true },
      { name: "phoneHref", label: "Telefon-Link", type: "text", required: true, help: "Form: tel:+41332274020" },
      { name: "kind", label: "Bezeichnung", type: "text", required: true, help: "Hauptsitz, Zweigbüro …" },
    ],
  },
  {
    key: "sponsorships",
    kind: "COLLECTION",
    name: "Sponsoring",
    description: "Unterstützte Personen und Vereine.",
    contentKey: "sponsorships",
    rank: 110,
    icon: "heart",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "detail", label: "Beschreibung", type: "text", required: true },
      { name: "photo", label: "Bild", type: "image", required: true },
      {
        name: "fit",
        label: "Bildausschnitt",
        type: "select",
        options: [
          { value: "cover", label: "Füllend (Foto)" },
          { value: "contain", label: "Vollständig (Logo)" },
        ],
        help: "Breite Vereinslogos brauchen «Vollständig», sonst wird der Schriftzug angeschnitten.",
      },
    ],
  },
  {
    key: "socials",
    kind: "COLLECTION",
    name: "Soziale Netzwerke",
    description:
      "Die Profile im Fussbereich. Die Farben sind die der Plattformen und gehören bewusst nicht zur IEM-Palette.",
    contentKey: "socials",
    rank: 120,
    icon: "social",
    fields: [
      { name: "label", label: "Netzwerk", type: "text", required: true },
      { name: "href", label: "Profil-URL", type: "url", required: true },
      {
        name: "icon",
        label: "Symbol",
        type: "select",
        required: true,
        options: [
          { value: "linkedin", label: "LinkedIn" },
          { value: "instagram", label: "Instagram" },
          { value: "facebook", label: "Facebook" },
        ],
      },
      { name: "color", label: "Markenfarbe", type: "color", required: true },
    ],
  },
  {
    key: "navItems",
    kind: "COLLECTION",
    name: "Navigation",
    description:
      "Die Einträge im Kopf — und zugleich die Spalte «Dienstleistungen» im Fussbereich. Mehr als sechs sprengen den Kopf auf Tablet-Breite.",
    contentKey: "navItems",
    rank: 130,
    icon: "nav",
    fields: [
      { name: "label", label: "Beschriftung", type: "text", required: true },
      { name: "href", label: "Ziel", type: "text", required: true, help: "Anker wie #referenzen." },
    ],
  },
  {
    key: "leitbild",
    kind: "COLLECTION",
    name: "Leitbild",
    description:
      "Die Grundsätze, wörtlich von iem.ch. Ein umformulierter Wertesatz ist eine Aussage, die IEM nie gemacht hat.",
    contentKey: "leitbild",
    rank: 140,
    icon: "quote",
    fields: [
      { name: "title", label: "Überschrift", type: "text", required: true },
      { name: "body", label: "Text", type: "textarea", required: true },
    ],
  },
  {
    key: "jobCategoryNotes",
    kind: "COLLECTION",
    name: "Hinweise leerer Stellenkategorien",
    description: "Was angezeigt wird, wenn eine Kategorie keine Inserate hat.",
    contentKey: "jobCategoryNotes",
    shape: "keyed",
    orderable: false,
    rank: 150,
    icon: "note",
    fields: [{ name: "text", label: "Hinweis", type: "textarea", required: true }],
  },

  // =================================================================
  // Einzelblöcke
  // =================================================================
  {
    key: "facts",
    kind: "SINGLETON",
    name: "Unternehmensdaten",
    description:
      "Gründung, Grösse, Rechtsform. Hieraus berechnen sich die Kennzahlen im Hero und die Faktentabelle — an einer Stelle ändern genügt.",
    contentKey: "facts",
    rank: 160,
    icon: "facts",
    fields: [
      { name: "founded", label: "Gründungsjahr", type: "number", required: true, min: 1800, max: 2100 },
      { name: "foundedLong", label: "Gründungsdatum", type: "text", required: true },
      { name: "bernSince", label: "Bern seit", type: "number", required: true, min: 1800, max: 2100 },
      { name: "headcount", label: "Mitarbeitende", type: "number", required: true, min: 1 },
      { name: "insuranceCover", label: "Deckungssumme", type: "text", required: true },
      { name: "insurer", label: "Versicherer", type: "text", required: true },
      { name: "memberships", label: "Mitgliedschaften", type: "list", of: "text", required: true },
      { name: "legalForm", label: "Rechtsform", type: "text", required: true },
      { name: "ownership", label: "Aktien", type: "text", required: true },
      { name: "vatId", label: "MwSt-Nummer", type: "text", required: true },
    ],
  },
  {
    key: "jobTexts",
    kind: "SINGLETON",
    name: "Gemeinsame Inseratstexte",
    description:
      "Die drei Abschnitte, die in allen Stelleninseraten gleich lauten. Wörtlich aus den PDFs.",
    contentKey: "__jobTexts",
    rank: 170,
    icon: "text",
    fields: [
      { name: "jobUeberUns", label: "Über uns", type: "textarea", required: true },
      {
        name: "jobBewerbung",
        label: "Bewerbung",
        type: "textarea",
        required: true,
        help: "Muss auf der Kontakt-E-Mail enden — der Schluss wird auf der Inseratsseite verlinkt.",
      },
      { name: "jobSchluss", label: "Schlusssatz", type: "text", required: true },
    ],
  },
  {
    key: "contact",
    kind: "SINGLETON",
    name: "Kontaktfeld",
    description: "Das Navy-Feld am Seitenende.",
    contentKey: "contact",
    rank: 180,
    icon: "mail",
    fields: [
      { name: "eyebrow", label: "Eyebrow", type: "text", required: true },
      { name: "title", label: "Titel", type: "text", required: true, tokens: true },
      { name: "body", label: "Text", type: "textarea", required: true, tokens: true },
      { name: "ctas", label: "Schaltflächen", type: "objectList", fields: CTA_FIELDS },
    ],
  },
  {
    key: "footer",
    kind: "SINGLETON",
    name: "Fussbereich",
    description: "Spalten, Rechtliches und Copyright.",
    contentKey: "footer",
    rank: 190,
    icon: "footer",
    fields: [
      {
        name: "tagline",
        label: "Zeile unter dem Logo",
        type: "text",
        required: true,
        help: "Bestimmt zugleich die Breite des Logos — es nimmt 90 % dieser Zeile ein.",
      },
      { name: "blurb", label: "Zweiter Satz", type: "textarea", required: true, tokens: true },
      { name: "serviceColumnTitle", label: "Titel Spalte 1", type: "text", required: true },
      { name: "companyColumnTitle", label: "Titel Spalte 2", type: "text", required: true },
      {
        name: "companyLinks",
        label: "Spalte «Unternehmen»",
        type: "objectList",
        fields: [
          { name: "label", label: "Beschriftung", type: "text", required: true },
          { name: "href", label: "Ziel", type: "text", required: true },
        ],
      },
      { name: "socialRailLabel", label: "Beschriftung Social-Leiste", type: "text", required: true },
      { name: "socialLinkPrefix", label: "Präfix Social-Links", type: "text", required: true },
      { name: "copyright", label: "Copyright", type: "text", required: true, tokens: true },
      {
        name: "legalLinks",
        label: "Rechtliche Links",
        type: "objectList",
        fields: [
          { name: "label", label: "Beschriftung", type: "text", required: true },
          { name: "href", label: "Ziel", type: "text", required: true },
        ],
      },
    ],
  },
  {
    key: "seo",
    kind: "SINGLETON",
    name: "SEO",
    description: "Titel, Beschreibung, Open Graph und Indexierung.",
    contentKey: "seo",
    rank: 200,
    icon: "seo",
    fields: [
      { name: "title", label: "Seitentitel", type: "text", required: true, maxLength: 70 },
      { name: "description", label: "Meta-Beschreibung", type: "textarea", required: true, maxLength: 200 },
      { name: "canonical", label: "Kanonische URL", type: "url", required: true },
      { name: "ogImage", label: "Vorschaubild", type: "image", required: true },
      { name: "themeColor", label: "Theme-Farbe", type: "color", required: true },
      {
        name: "robots",
        label: "Robots",
        type: "select",
        required: true,
        options: [
          { value: "index,follow", label: "Indexieren und folgen" },
          { value: "noindex,follow", label: "Nicht indexieren, folgen" },
          { value: "noindex,nofollow", label: "Weder noch" },
        ],
      },
    ],
  },
  {
    key: "teamImage",
    kind: "SINGLETON",
    name: "Team-Bild",
    description: "Das Bild neben der Team-Überschrift.",
    contentKey: "teamImage",
    rank: 210,
    icon: "image",
    fields: [
      { name: "src", label: "Bild", type: "image", required: true },
      { name: "alt", label: "Alt-Text", type: "text", required: true },
    ],
  },
  {
    key: "contactEmail",
    kind: "SINGLETON",
    name: "Bewerbungsadresse",
    description:
      "Wohin Bewerbungen gehen. Erscheint zweimal auf der Inseratsseite und muss beide Male gleich lauten.",
    contentKey: "__contactEmail",
    rank: 220,
    icon: "mail",
    fields: [{ name: "value", label: "E-Mail", type: "email", required: true }],
  },

  // =================================================================
  // Beschriftungen
  // =================================================================
  labelBlock("appLabels", "Beschriftungen — Seite", "Sprungmarke und Anfahrtslink.", "appLabels", 300, [
    ["skipLabel", "Sprunglink", "Erstes Element für Tastaturnutzer."],
    ["skipHref", "Ziel des Sprunglinks", "Muss auf einen echten Anker der Seite zeigen."],
    ["anfahrt", "Anfahrt"],
  ]),
  {
    key: "navLabels",
    kind: "SINGLETON",
    name: "Beschriftungen — Kopf",
    description: "Fast alles hiervon sind Vorlesenamen, keine sichtbaren Texte.",
    contentKey: "navLabels",
    rank: 310,
    icon: "label",
    fields: [
      { name: "home", label: "Logo-Link", type: "text", required: true },
      {
        name: "strapline",
        label: "Zeilen neben dem Logo",
        type: "list",
        of: "text",
        required: true,
        help: "Eine Zeile pro Eintrag — der Umbruch ist Layout, kein Textinhalt.",
      },
      { name: "primary", label: "Hauptnavigation", type: "text", required: true },
      { name: "mobile", label: "Mobile Navigation", type: "text", required: true },
      { name: "menuOpen", label: "Menü öffnen", type: "text", required: true },
      { name: "menuClose", label: "Menü schliessen", type: "text", required: true },
    ],
  },
  labelBlock(
    "serviceLabels",
    "Beschriftungen — Dienstleistungen",
    "«Enthalten» und «nicht enthalten» werden vorgelesen und ersetzen Punkt und Durchstreichung.",
    "serviceLabels",
    320,
    [
      ["fachgebiete", "Fachgebiete"],
      ["von", "von"],
      ["enthalten", "Enthalten (Vorlesetext)"],
      ["nichtEnthalten", "Nicht enthalten (Vorlesetext)"],
    ],
  ),
  labelBlock(
    "referenzLabels",
    "Beschriftungen — Referenzen",
    "Leermeldungen tragen {query} und {kategorie}.",
    "referenzLabels",
    330,
    [
      ["alle", "Alle"],
      ["filterGroup", "Filtergruppe"],
      ["suchePlatzhalter", "Suchfeld-Platzhalter"],
      ["sucheLabel", "Suchfeld-Vorlesename"],
      ["sucheZuruecksetzen", "Suche zurücksetzen"],
      ["von", "von"],
      ["imAuszug", "im Auszug"],
      ["karteOeffnen", "Karte öffnen"],
      ["leerSuche", "Leermeldung Suche"],
      ["leerKategorie", "Leermeldung Kategorie"],
      ["auswahlZuruecksetzen", "Auswahl zurücksetzen"],
    ],
  ),
  labelBlock(
    "projectDialogLabels",
    "Beschriftungen — Referenzdialog",
    "Entsprechen den Feldnamen auf iem.ch/referenzen.",
    "projectDialogLabels",
    340,
    [
      ["bauherr", "Bauherrschaft"],
      ["architekt", "Architektur"],
      ["realisierung", "Realisierung"],
      ["leistungen", "Bearbeitete Fachgebiete"],
      ["bausummeTotal", "Gesamt-Bausumme"],
      ["bausummeFach", "Bausumme Fachgebiete"],
      ["energiestandard", "Energiestandard"],
      ["gewerke", "Gewerke"],
      ["schliessen", "Schliessen"],
      ["quellePrefix", "Quellenhinweis davor"],
      ["quelleLabel", "Quellen-Linktext"],
      ["quelleHref", "Quellen-Link"],
      ["quelleSuffix", "Quellenhinweis danach"],
    ],
  ),
  labelBlock(
    "teamLabels",
    "Beschriftungen — Team",
    "Der Suchhinweis nennt bewusst nur Name, Fachgruppe und Standort — auf mehr wird nicht gesucht.",
    "teamLabels",
    350,
    [
      ["geschaeftsleitung", "Geschäftsleitung"],
      ["roster", "Das Team"],
      ["alle", "Alle"],
      ["alleGruppen", "Alle Gruppen"],
      ["gruppeLabel", "Fachgruppen-Auswahl"],
      ["standortGroup", "Standortfilter"],
      ["suchePlatzhalter", "Suchfeld-Platzhalter"],
      ["sucheLabel", "Suchfeld-Vorlesename"],
      ["sucheZuruecksetzen", "Suche zurücksetzen"],
      ["person", "Person (Einzahl)"],
      ["personen", "Personen (Mehrzahl)"],
      ["leerSuche", "Leermeldung Suche"],
      ["leerGruppe", "Leermeldung Gruppe"],
      ["auswahlZuruecksetzen", "Auswahl zurücksetzen"],
    ],
  ),
  labelBlock("jobLabels", "Beschriftungen — Stellen", "{rolle} und {kategorie} werden eingesetzt.", "jobLabels", 360, [
    ["filterGroup", "Filtergruppe"],
    ["inserat", "Inserat (Einzahl)"],
    ["inserate", "Inserate (Mehrzahl)"],
    ["karteBewerben", "Karte — Vorlesename"],
    ["bewerben", "Bewerben"],
    ["detail", "Detail-Chip"],
    ["detailLabel", "Detail — Vorlesename"],
    ["anfragen", "Kategorie anfragen"],
  ]),
  labelBlock(
    "stelleLabels",
    "Beschriftungen — Inseratsseite",
    "Die «nicht gefunden»-Texte sind der Normalfall für ein weitergeleitetes Inserat.",
    "stelleLabels",
    370,
    [
      ["home", "Logo-Link"],
      ["zurueck", "Zurück zur Übersicht"],
      ["jetztBewerben", "Jetzt bewerben"],
      ["originalPdf", "Original-PDF"],
      ["ueberUns", "Über uns"],
      ["aufgaben", "Deine Aufgaben"],
      ["profil", "Dein Profil"],
      ["bieten", "Wir bieten"],
      ["bewerbung", "Bewerbung"],
      ["rueckfragenPrefix", "Rückfragen — Text davor"],
      ["rueckfragenSuffix", "Rückfragen — Text danach"],
      ["quellePrefix", "Quellenhinweis davor"],
      ["quelleLabel", "Quellen-Linktext"],
      ["quelleSuffix", "Quellenhinweis danach"],
      ["firma", "Firmenname"],
      ["nichtGefundenTitel", "Nicht gefunden — Titel"],
      ["nichtGefundenText", "Nicht gefunden — Text"],
      ["nichtGefundenCta", "Nicht gefunden — Schaltfläche"],
    ],
  ),
  labelBlock("siteSearchLabels", "Beschriftungen — Suche", "{query} wird eingesetzt.", "siteSearchLabels", 380, [
    ["platzhalter", "Platzhalter"],
    ["label", "Vorlesename"],
    ["zuruecksetzen", "Zurücksetzen"],
    ["ergebnisse", "Ergebnisliste"],
    ["leer", "Leermeldung"],
  ]),
  labelBlock("searchLabels", "Beschriftungen — Suchindex", "Die Zeilen unter einem Treffer.", "searchLabels", 390, [
    ["fachgebiet", "Fachgebiet"],
    ["leitbild", "Leitbild"],
  ]),
  labelBlock("ueberUnsLabels", "Beschriftungen — Über uns", "", "ueberUnsLabels", 400, [
    ["leitbild", "Leitbild"],
    ["fakten", "Fakten"],
    ["quelle", "Quellenhinweis"],
  ]),
  labelBlock("ablaufControls", "Beschriftungen — Ablauf-Steuerung", "", "ablaufControls", 410, [
    ["groupLabel", "Steuerungsgruppe"],
    ["running", "Anlage läuft"],
    ["stopped", "Anlage aus"],
    ["turnOff", "Ausschalten"],
    ["turnOn", "Einschalten"],
  ]),
  labelBlock("phaseTrack", "Beschriftungen — Phasenbalken", "", "phaseTrack", 420, [
    ["bracketLabel", "Klammertext"],
    ["footnote", "Fussnote", "Nennt, dass PV nach SIA 108 geplant wird — eine echte Unterscheidung."],
  ]),
  {
    key: "bewerbung",
    kind: "SINGLETON",
    name: "Bewerbungsformular",
    description:
      "Alle Texte des Formulars. Auf dem E-Mail-Weg wurde noch nichts gesendet — die Texte dürfen nichts anderes behaupten.",
    contentKey: "bewerbung",
    rank: 430,
    icon: "form",
    fields: [
      { name: "spontan", label: "Spontanbewerbung", type: "text", required: true },
      { name: "titelblock", label: "Titelblock", type: "text", required: true },
      { name: "titel", label: "Titel", type: "text", required: true },
      { name: "schliessen", label: "Schliessen", type: "text", required: true },
      { name: "fehlerVorname", label: "Fehler — Vorname", type: "text", required: true },
      { name: "fehlerNachname", label: "Fehler — Nachname", type: "text", required: true },
      { name: "fehlerEmail", label: "Fehler — E-Mail fehlt", type: "text", required: true },
      { name: "fehlerEmailUngueltig", label: "Fehler — E-Mail ungültig", type: "text", required: true },
      { name: "fehlerDateien", label: "Fehler — keine Datei", type: "text", required: true },
      { name: "fehlerZuViele", label: "Fehler — zu viele Dateien", type: "text", required: true },
      { name: "fehlerZuGross", label: "Fehler — Datei zu gross", type: "text", required: true },
      { name: "fehlerGesamt", label: "Fehler — Gesamtgrösse", type: "text", required: true },
      { name: "fehlerServer", label: "Fehler — Server", type: "text", required: true },
      { name: "fehlerVerbindung", label: "Fehler — Verbindung", type: "text", required: true },
      { name: "fehlerAbbruch", label: "Fehler — Abbruch", type: "text", required: true },
      { name: "fehlerUnbekannt", label: "Fehler — unbekannt", type: "text", required: true },
      { name: "mailFeldPosition", label: "Mailfeld — Position", type: "text", required: true },
      { name: "mailFeldName", label: "Mailfeld — Name", type: "text", required: true },
      { name: "mailFeldEmail", label: "Mailfeld — E-Mail", type: "text", required: true },
      { name: "mailFeldTelefon", label: "Mailfeld — Telefon", type: "text", required: true },
      { name: "mailFeldVerfuegbar", label: "Mailfeld — Verfügbar ab", type: "text", required: true },
      { name: "mailKeineNachricht", label: "Mailfeld — keine Nachricht", type: "text", required: true },
      { name: "mailFeldBeilagen", label: "Mailfeld — Beilagen", type: "text", required: true },
      { name: "mailSignatur", label: "Mail-Signatur", type: "text", required: true },
      { name: "modusFrage", label: "Modus — Frage", type: "text", required: true },
      { name: "modusGroupLabel", label: "Modus — Gruppe", type: "text", required: true },
      { name: "modusUploadLabel", label: "Modus — Upload", type: "text", required: true },
      { name: "modusUploadNote", label: "Modus — Upload Hinweis", type: "text", required: true },
      { name: "modusMailLabel", label: "Modus — E-Mail", type: "text", required: true },
      { name: "modusMailNote", label: "Modus — E-Mail Hinweis", type: "text", required: true },
      { name: "modusNichtEingerichtet", label: "Modus — nicht eingerichtet", type: "text", required: true },
      { name: "modusHinweis", label: "Modus — Hinweistext", type: "textarea", required: true },
      { name: "feldPosition", label: "Feld — Position", type: "text", required: true },
      { name: "feldVorname", label: "Feld — Vorname", type: "text", required: true },
      { name: "feldNachname", label: "Feld — Nachname", type: "text", required: true },
      { name: "feldEmail", label: "Feld — E-Mail", type: "text", required: true },
      { name: "feldTelefon", label: "Feld — Telefon", type: "text", required: true },
      { name: "feldVerfuegbar", label: "Feld — Verfügbar ab", type: "text", required: true },
      { name: "feldVerfuegbarHint", label: "Feld — Verfügbar ab Hinweis", type: "text", required: true },
      { name: "feldNachricht", label: "Feld — Nachricht", type: "text", required: true },
      { name: "feldNachrichtHint", label: "Feld — Nachricht Hinweis", type: "text", required: true },
      { name: "optional", label: "Optional-Markierung", type: "text", required: true },
      { name: "pflichtfeld", label: "Pflichtfeld", type: "text", required: true },
      { name: "dossier", label: "Dossier", type: "text", required: true },
      { name: "dossierZiehen", label: "Dossier — Ablagebereich", type: "text", required: true },
      { name: "dossierRegeln", label: "Dossier — Regeln", type: "text", required: true },
      { name: "dateiEntfernen", label: "Datei entfernen", type: "text", required: true },
      { name: "dateiZaehler", label: "Dateizähler", type: "text", required: true },
      { name: "mailAnhangHinweis", label: "Hinweis zu Anhängen", type: "textarea", required: true },
      { name: "wirdUebermittelt", label: "Wird übermittelt", type: "text", required: true },
      { name: "doneTitel", label: "Erfolg — Titel", type: "text", required: true },
      { name: "doneEineDatei", label: "Erfolg — eine Datei", type: "text", required: true },
      { name: "doneMehrereDateien", label: "Erfolg — mehrere Dateien", type: "text", required: true },
      {
        name: "doneText",
        label: "Erfolg — Text",
        type: "textarea",
        required: true,
        help: "Verspricht eine Bestätigungsmail. Nur zutreffend, wenn der Upload-Endpunkt eine sendet.",
      },
      {
        name: "mailTitel",
        label: "E-Mail-Weg — Titel",
        type: "text",
        required: true,
        help: "Darf nicht behaupten, die Bewerbung sei gesendet — sie liegt im Entwurfsordner.",
      },
      { name: "mailText", label: "E-Mail-Weg — Text", type: "textarea", required: true },
      { name: "mailDateienTitel", label: "E-Mail-Weg — Dateien", type: "text", required: true },
      { name: "mailKeineDateien", label: "E-Mail-Weg — ohne Dateien", type: "text", required: true },
      { name: "mailFallbackPrefix", label: "E-Mail-Weg — Rückfall davor", type: "text", required: true },
      { name: "mailFallbackSuffix", label: "E-Mail-Weg — Rückfall danach", type: "text", required: true },
      { name: "mailNochmals", label: "E-Mail-Weg — zurück", type: "text", required: true },
      { name: "failedTitel", label: "Fehlschlag — Titel", type: "text", required: true },
      { name: "failedPrefix", label: "Fehlschlag — davor", type: "text", required: true },
      { name: "failedSuffix", label: "Fehlschlag — danach", type: "text", required: true },
      { name: "abbrechen", label: "Abbrechen", type: "text", required: true },
      { name: "senden", label: "Senden", type: "text", required: true },
      { name: "wirdGesendet", label: "Wird gesendet", type: "text", required: true },
    ],
  },
];

export const CONTENT_TYPE_KEYS = CONTENT_TYPES.map((t) => t.key);

export function contentTypeByKey(key: string): ContentTypeDef | undefined {
  return CONTENT_TYPES.find((t) => t.key === key);
}
