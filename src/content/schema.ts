/**
 * The site's content contract.
 *
 * This file is the seam between the page and the CMS. Everything the public
 * site renders is described here as a type; `defaults.ts` holds one value of
 * that type (today's copy, verbatim), the dashboard edits it, and the API
 * publishes it. Nothing here imports data — so the server can depend on this
 * file without pulling the whole snapshot into its bundle.
 *
 * Two rules carried over from the static build and still load-bearing:
 *
 * 1. **Tones name the discipline, not the hue.** `Tone` values map to Tailwind
 *    classes (`text-disc-air`, …); they are a closed set and the CMS must not
 *    be able to invent one. That is why `Tone` is a union and not `string`.
 * 2. **Discipline keys are closed too.** The six-discipline taxonomy is
 *    referenced by key from every project, service and badge on the page, so a
 *    key is structural. Labels are editable; keys are not.
 *
 * Everything else in here is free text and genuinely editable.
 */

/* ------------------------------------------------------------------ */
/* Closed sets — structural, not editable from the dashboard          */
/* ------------------------------------------------------------------ */

/**
 * Tones name the discipline they stand for, not a hue — the hues come from the
 * navy/gold brand family and are defined in `tailwind.config.ts` under `disc`.
 */
export type Tone = "heat" | "air" | "water" | "power" | "energy" | "model" | "neutral";

export const toneValues: readonly Tone[] = [
  "heat",
  "air",
  "water",
  "power",
  "energy",
  "model",
  "neutral",
] as const;

/**
 * The six disciplines, in **HLKSE order** — Heizung, Lüftung (where Klima/Kälte
 * sits in this taxonomy), Sanitär, Elektro, then the two that are not trades.
 * That is the order the industry names them in, and the order every list of
 * disciplines on the page has to read in.
 */
export type DisciplineKey =
  | "heizung"
  | "lueftung"
  | "sanitaer"
  | "elektro"
  | "energie"
  | "bim";

export const disciplineOrder: readonly DisciplineKey[] = [
  "heizung",
  "lueftung",
  "sanitaer",
  "elektro",
  "energie",
  "bim",
] as const;

/**
 * Sorts a project's own tag list into HLKSE order. Without it the tags come out
 * in whatever order the entry was typed — the Freienhof reference led with
 * "Energie & Sanierung" — so two projects could not be compared at a glance.
 * Sorting against `disciplineOrder` rather than a second hand-written list
 * means there is nothing to keep in sync.
 */
export function inHLKSE(keys: DisciplineKey[]): DisciplineKey[] {
  return [...keys].sort((a, b) => disciplineOrder.indexOf(a) - disciplineOrder.indexOf(b));
}

export type UseCategory = "Pflege & Wohnen" | "Bildung" | "Gewerbe & Industrie" | "Energie & PV";

export const useCategories: readonly UseCategory[] = [
  "Pflege & Wohnen",
  "Bildung",
  "Gewerbe & Industrie",
  "Energie & PV",
] as const;

export type JobCategory = "Offene Stellen" | "Schnupperlehre" | "Lehrstellen";

export const jobCategories: readonly JobCategory[] = [
  "Offene Stellen",
  "Schnupperlehre",
  "Lehrstellen",
] as const;

/**
 * The four Fachgruppen a person belongs to — mutually exclusive, one each.
 * There is deliberately no fifth "Lernende" option: it is not a trade, and the
 * page no longer states anyone's function at all.
 */
export type Trade = "Admin" | "Heizung" | "Lüftung" | "Sanitär";

export const trades: readonly Trade[] = ["Admin", "Heizung", "Lüftung", "Sanitär"] as const;

/* ------------------------------------------------------------------ */
/* Collections                                                         */
/* ------------------------------------------------------------------ */

export type Discipline = {
  label: string;
  short: string;
  tone: Tone;
};

export type Service = {
  id: string;
  title: string;
  lead: string;
  body: string;
  disciplines: DisciplineKey[];
  tone: Tone;
};

/**
 * Project phases with their real SIA 112 numbers. The numbers are the point:
 * they are the vocabulary Swiss clients and architects already plan in.
 */
export type Phase = {
  no: string;
  title: string;
  body: string;
};

/**
 * The three acts of the 3D scene in the Ablauf section. `phases` are real
 * numbers out of `phases`, not decoration — the phase track highlights exactly
 * these while an act runs.
 */
export type Bauakt = {
  id: string;
  role: string;
  phases: string[];
  title: string;
  body: string;
};

/**
 * The extra fields iem.ch publishes per reference, shown in the project dialog.
 * Every value is verbatim from https://www.iem.ch/referenzen — the checkable
 * specifics the page's credibility rests on, so **don't fill a gap with a
 * plausible guess**. Several projects genuinely publish no architect, no cost
 * or no energy standard; those keys stay absent and the dialog omits the row.
 */
export type ProjectDetails = {
  bauherr?: string;
  architekt?: string;
  /** "Bearbeitete Fachgebiete" — IEM's actual scope of work on the project. */
  leistungen?: string;
  /** "Gesamt-Bausumme" — the whole project. */
  bausummeTotal?: string;
  /** "Bausumme Fachgebiete" — the share IEM planned. */
  bausummeFach?: string;
  energiestandard?: string;
};

export type Project = {
  name: string;
  /** Omitted where iem.ch publishes no location — don't fill one in. */
  place?: string;
  years: string;
  use: UseCategory;
  scope: string;
  image: string;
  disciplines: DisciplineKey[];
  details?: ProjectDetails;
};

export type OfficeEntry = {
  city: string;
  street: string;
  zip: string;
  phone: string;
  phoneHref: string;
  /** Printed opposite the city name — "Hauptsitz" / "Zweigbüro". */
  kind: string;
};

/**
 * `color` is each platform's brand hex, and is deliberately **not** a token in
 * `tailwind.config.ts` / `src/lib/tokens.ts`: those hold the IEM identity, and
 * these hues are not part of it.
 */
export type Social = {
  label: string;
  href: string;
  icon: "linkedin" | "instagram" | "facebook";
  color: string;
};

/**
 * The advert body, read out of the PDF IEM publishes and stored **verbatim** —
 * the same rule the reference projects' `details` follow. These are a real
 * employer's terms of employment; a reworded duty or a softened requirement is
 * a false claim about what IEM is offering.
 */
export type JobDetail = {
  /**
   * The advert's own headline, verbatim — masculine form plus "(m / w / d)",
   * which is how IEM writes them. `role` on the opening carries the inclusive
   * ":in" form the website's own list uses. Both are IEM's wording; neither is
   * a correction of the other, so don't unify them.
   */
  titel: string;
  /** The opening sentence: availability, workload and office. */
  einstieg: string;
  aufgaben: string[];
  profil: string[];
  bieten: string[];
  /** Named contact for questions, as the advert prints them. */
  kontakt: { name: string; telefon: string };
};

export type Opening = {
  /** Slug the detail view is opened with (`/stelle.html?id=…`). */
  id: string;
  role: string;
  pensum: string;
  place: string;
  pdf: string;
  image: string;
  category: JobCategory;
  detail: JobDetail;
};

export type NavItem = {
  label: string;
  href: string;
};

export type Member = {
  name: string;
  /**
   * The city of one of the `offices`, or `null` for someone assigned to
   * neither. A plain string rather than a union: offices are editable now, so
   * a closed `"Thun" | "Bern"` would go stale the moment a third one is added.
   * It must still *match* an `OfficeEntry.city` — the team filter builds its
   * pills from `offices`, so a typo makes that person unreachable by filter.
   */
  office: string | null;
  /**
   * Published function. **Recorded, but shown only for `lead` members** — the
   * client asked for every other personal function to come off the team
   * section. Never guess a function for a real, named person.
   */
  role?: string;
  /** Geschäftsleitung — drives the split in `TeamGrid`. Distinct from `role`. */
  lead?: boolean;
  /** Fachgruppe — drives the grouping dropdown in `TeamGrid`. */
  group?: Trade;
  /** Lernende — recorded, deliberately never published. */
  lernend?: boolean;
  photo: string | null;
};

/**
 * `fit: "contain"` marks the entries whose asset is a wide club logo rather
 * than a photo — cropping those to a portrait box cuts the wordmark in half.
 */
export type Sponsorship = {
  name: string;
  detail: string;
  photo: string;
  fit?: "cover" | "contain";
};

/**
 * A Leitbild statement from iem.ch/ueber-uns — **verbatim**, headings included.
 * The one kind of copy on this page that must not be rewritten, tightened or
 * translated: a reworded value statement is a claim IEM never made.
 *
 * Headings are set upper-case on iem.ch. They are stored in their natural case
 * and upper-cased by the `.eyebrow` class, so the data stays readable and the
 * styling stays in CSS.
 */
export type LeitbildStatement = {
  title: string;
  body: string;
};

export type Facts = {
  founded: number;
  foundedLong: string;
  bernSince: number;
  headcount: number;
  insuranceCover: string;
  insurer: string;
  memberships: string[];
  legalForm: string;
  ownership: string;
  vatId: string;
};

/* ------------------------------------------------------------------ */
/* Page copy — previously hardcoded in App.tsx / Hero.tsx / Footer.tsx */
/* ------------------------------------------------------------------ */

/**
 * A section's heading block. `title` and `description` may contain `{…}`
 * placeholders resolved against the derived figures — see `resolveTokens` in
 * `tokens.ts`. That is how "Seit über 30 Jahren" stays computed from
 * `facts.founded` instead of being typed and going stale, while still being
 * editable from the dashboard.
 */
export type SectionCopy = {
  eyebrow: string;
  title: string;
  description: string;
};

/** `Button`'s variants, restated so the CMS cannot invent one. */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "inverse"
  | "inverseOutline"
  | "mark";

/** `KPI`'s own smaller tone set — distinct from `Tone`. */
export type KpiTone = "ink" | "navy" | "gold" | "water" | "energy";

export type KpiCopy = {
  value: string;
  label: string;
  note: string;
  tone?: KpiTone;
};

/**
 * A call to action. Exactly one of `href` and `action` is set: `href`
 * navigates (anchor, `tel:`, `mailto:`), `action` fires one of the page's
 * custom-event seams. Anything else would need code, which is the thing this
 * model exists to avoid.
 */
export type CtaCopy = {
  label: string;
  href?: string;
  action?: "bewerbung";
  variant: ButtonVariant;
  trailing?: string;
};

export type HeroCopy = {
  /** Left half of the eyebrow, before the hairline. */
  eyebrowPlace: string;
  /** Right half, after the hairline. */
  eyebrowSince: string;
  title: string;
  lead: string;
  ctas: CtaCopy[];
  /** Prefix for the live phase readout — the phase itself is appended. */
  phasePrefix: string;
  kpis: KpiCopy[];
};

export type ContactCopy = {
  eyebrow: string;
  title: string;
  body: string;
  ctas: CtaCopy[];
};

export type FooterCopy = {
  /**
   * The line directly under the wordmark. It also *measures* the mark: the
   * wrapper is `w-fit`, so the mark takes 90 % of this sentence's width.
   * Lengthening it widens the logo — see the note in `Footer.tsx`.
   */
  tagline: string;
  /** The second, longer sentence. Kept out of the tagline's box on purpose. */
  blurb: string;
  serviceColumnTitle: string;
  companyColumnTitle: string;
  /**
   * The "Unternehmen" column. Deliberately *not* `navItems`: the header has six
   * slots and `#ablauf` gave its one up, so this column is where it stays
   * reachable by name.
   */
  companyLinks: NavItem[];
  socialRailLabel: string;
  /** Prefixed to each network's name for the icon's accessible label. */
  socialLinkPrefix: string;
  copyright: string;
  legalLinks: NavItem[];
};

export type SeoConfig = {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  themeColor: string;
  robots: string;
};

/**
 * Every string in the application form.
 *
 * It is the largest copy block on the site and the only one where wording is
 * load-bearing rather than decorative — this is a real applicant being told
 * what happened to their documents. Three groups deserve care:
 *
 * - **Validation messages** say what to do, not what is wrong.
 * - **The mail-path strings** must not claim anything was sent. A `mailto:`
 *   only *opens* the visitor's mail client; the dossier is still sitting in
 *   their drafts. `mailTitel` and `mailText` are written around that and
 *   should stay that way.
 * - **`doneText` promises a confirmation email.** Nothing in this repo sends
 *   one. It is reachable only once an upload endpoint is configured, so
 *   whoever configures it either sends that mail or edits this line.
 *
 * Braces are local substitutions — `{name}`, `{groesse}`, `{max}` — filled by
 * the component from the file or field at hand, not by `resolveTokens`.
 */
export type BewerbungCopy = {
  /** The default `position` value: an application to no particular advert. */
  spontan: string;
  titelblock: string;
  titel: string;
  schliessen: string;

  fehlerVorname: string;
  fehlerNachname: string;
  fehlerEmail: string;
  fehlerEmailUngueltig: string;
  fehlerDateien: string;
  /** `{max}` — the file-count limit. */
  fehlerZuViele: string;
  /** `{name}`, `{groesse}`, `{limit}`. */
  fehlerZuGross: string;
  /** `{limit}` — the combined-size limit. */
  fehlerGesamt: string;
  /** `{status}` — the HTTP status the endpoint returned. */
  fehlerServer: string;
  fehlerVerbindung: string;
  fehlerAbbruch: string;
  fehlerUnbekannt: string;

  /** Labels for the generated mail body, on the `mailto:` path. */
  mailFeldPosition: string;
  mailFeldName: string;
  mailFeldEmail: string;
  mailFeldTelefon: string;
  mailFeldVerfuegbar: string;
  mailKeineNachricht: string;
  mailFeldBeilagen: string;
  mailSignatur: string;

  modusFrage: string;
  modusGroupLabel: string;
  modusUploadLabel: string;
  modusUploadNote: string;
  modusMailLabel: string;
  modusMailNote: string;
  modusNichtEingerichtet: string;
  modusHinweis: string;

  feldPosition: string;
  feldVorname: string;
  feldNachname: string;
  feldEmail: string;
  feldTelefon: string;
  feldVerfuegbar: string;
  feldVerfuegbarHint: string;
  feldNachricht: string;
  feldNachrichtHint: string;
  optional: string;
  pflichtfeld: string;

  dossier: string;
  dossierZiehen: string;
  /** `{max}`, `{proDatei}`. */
  dossierRegeln: string;
  /** `{name}`. */
  dateiEntfernen: string;
  /** `{n}`, `{max}`, `{bytes}`, `{gesamt}`. */
  dateiZaehler: string;
  mailAnhangHinweis: string;

  wirdUebermittelt: string;

  doneTitel: string;
  doneEineDatei: string;
  /** `{n}`. */
  doneMehrereDateien: string;
  /** `{dateien}`, `{groesse}`, `{email}`. */
  doneText: string;
  /**
   * `{n}`, `{kontakt}`. Shown when the server did not keep every file.
   *
   * Optional because it arrived after the published snapshot did: a snapshot
   * published before it has no such key, and the dialog falls back to the
   * default rather than rendering `undefined` (UX-43).
   */
  doneUebersprungen?: string;

  mailTitel: string;
  mailText: string;
  mailDateienTitel: string;
  mailKeineDateien: string;
  mailFallbackPrefix: string;
  mailFallbackSuffix: string;
  mailNochmals: string;

  failedTitel: string;
  failedPrefix: string;
  failedSuffix: string;

  abbrechen: string;
  senden: string;
  wirdGesendet: string;
};

/* ------------------------------------------------------------------ */
/* The whole thing                                                     */
/* ------------------------------------------------------------------ */

/**
 * One published version of everything the public site renders.
 *
 * The API serves exactly this shape at `/api/v1/content/published`, and the
 * build embeds exactly this shape as the boot snapshot. Adding a field here is
 * the one change that has to be made in three places at once: this type, the
 * default in `defaults.ts`, and the dashboard editor that writes it.
 */
export type SiteContent = {
  disciplines: Record<DisciplineKey, Discipline>;
  services: Service[];
  phases: Phase[];
  bauakte: Bauakt[];
  projects: Project[];
  offices: OfficeEntry[];
  socials: Social[];
  openings: Opening[];
  jobCategoryNotes: Record<JobCategory, string>;
  /** The three passages every advert shares, held once rather than seven times. */
  jobUeberUns: string;
  jobBewerbung: string;
  jobSchluss: string;
  navItems: NavItem[];
  team: Member[];
  sponsorships: Sponsorship[];
  facts: Facts;
  /** The client's own words, stored verbatim — never reword a value statement. */
  leitbild: LeitbildStatement[];
  hero: HeroCopy;
  sections: {
    leistungen: SectionCopy;
    ablauf: SectionCopy;
    referenzen: SectionCopy;
    ueberUns: SectionCopy;
    team: SectionCopy;
    sponsoring: SectionCopy;
    karriere: SectionCopy;
    standorte: SectionCopy;
  };
  /** The two lines that frame the SIA phase track. */
  phaseTrack: { bracketLabel: string; footnote: string };
  /**
   * Header labels. Most are accessible names rather than visible text — the
   * two `nav` landmarks, the logo link and the hamburger's state — which is
   * exactly why they belong in the content rather than in the component: they
   * are the header's only words for a screen reader.
   */
  navLabels: {
    home: string;
    /** The lockup beside the mark, one entry per line. */
    strapline: string[];
    primary: string;
    mobile: string;
    menuOpen: string;
    menuClose: string;
    /**
     * The header's link into the CMS. **Optional, and that is deliberate.**
     *
     * `setContent` replaces the document wholesale rather than merging it with
     * `defaults.ts`, so a snapshot published before this field existed carries a
     * `navLabels` without it. Typing it as required would be a lie the first
     * time such a snapshot hydrates, and the cost would land on the one place
     * that cannot afford it — an icon button whose only accessible name is this
     * string. `Nav.tsx` falls back rather than rendering an unlabelled control.
     */
    login?: string;
  };
  /**
   * Labels in the service register. `enthalten`/`nichtEnthalten` are the
   * `sr-only` texts behind the dot and the strike-through — nobody can hear a
   * dot, and nobody can hear 45 % opacity, so these are not decoration.
   */
  serviceLabels: {
    fachgebiete: string;
    von: string;
    enthalten: string;
    nichtEnthalten: string;
  };
  /**
   * The address applications go to. Also the tail `StelleDetail` splits off
   * the verbatim Bewerbung paragraph and turns into a `mailto:` link — change
   * one without the other and the link quietly stops appearing.
   */
  contactEmail: string;
  /**
   * Labels on the job-advert page (`stelle.html`). `rueckfragenPrefix` takes
   * `{name}`; the phone number after it is a link, which is why that sentence
   * is split around it rather than stored whole.
   */
  stelleLabels: {
    home: string;
    zurueck: string;
    jetztBewerben: string;
    originalPdf: string;
    ueberUns: string;
    aufgaben: string;
    profil: string;
    bieten: string;
    bewerbung: string;
    rueckfragenPrefix: string;
    rueckfragenSuffix: string;
    quellePrefix: string;
    quelleLabel: string;
    quelleSuffix: string;
    firma: string;
    nichtGefundenTitel: string;
    nichtGefundenText: string;
    nichtGefundenCta: string;
  };
  /** The page-level strings `App.tsx` renders directly. */
  appLabels: { skipLabel: string; skipHref: string; anfahrt: string };
  /**
   * Labels in the vacancy register. `detailLabel` takes `{rolle}` and
   * `anfragen` takes `{kategorie}`, both substituted locally.
   */
  jobLabels: {
    filterGroup: string;
    inserat: string;
    inserate: string;
    karteBewerben: string;
    bewerben: string;
    detail: string;
    detailLabel: string;
    anfragen: string;
  };
  /**
   * Labels in the team grid. `leerSuche` / `leerGruppe` take `{query}` and
   * `{gruppe}`, substituted locally from the reader's own selection.
   */
  teamLabels: {
    geschaeftsleitung: string;
    roster: string;
    alle: string;
    alleGruppen: string;
    gruppeLabel: string;
    standortGroup: string;
    suchePlatzhalter: string;
    sucheLabel: string;
    sucheZuruecksetzen: string;
    person: string;
    personen: string;
    leerSuche: string;
    leerGruppe: string;
    auswahlZuruecksetzen: string;
  };
  /** Every string in the application form — see `BewerbungCopy`. */
  bewerbung: BewerbungCopy;
  /** Labels on the header search box. `leer` takes `{query}`. */
  siteSearchLabels: {
    platzhalter: string;
    label: string;
    zuruecksetzen: string;
    ergebnisse: string;
    leer: string;
  };
  /**
   * The two detail lines the search index writes itself, under a Fachgebiet
   * hit and a Leitbild hit. The group headings are the `ResultKind` values in
   * `@/lib/search` — those are structural and stay in code.
   */
  searchLabels: { fachgebiet: string; leitbild: string };
  /**
   * Labels in the reference register. `leerSuche` and `leerKategorie` take
   * `{query}` / `{kategorie}` — these are substituted locally, not by
   * `resolveTokens`, because the value is the reader's own input.
   */
  referenzLabels: {
    alle: string;
    filterGroup: string;
    suchePlatzhalter: string;
    sucheLabel: string;
    sucheZuruecksetzen: string;
    von: string;
    imAuszug: string;
    karteOeffnen: string;
    leerSuche: string;
    leerKategorie: string;
    auswahlZuruecksetzen: string;
  };
  /**
   * Row labels in the reference dialog. These are the names iem.ch itself
   * gives the fields, which is how a reader matches the dialog against the
   * source page — rename them and the two stop lining up.
   */
  projectDialogLabels: {
    bauherr: string;
    architekt: string;
    realisierung: string;
    leistungen: string;
    bausummeTotal: string;
    bausummeFach: string;
    energiestandard: string;
    gewerke: string;
    schliessen: string;
    quellePrefix: string;
    quelleLabel: string;
    quelleHref: string;
    quelleSuffix: string;
  };
  /** The three headings inside the Über-uns block. */
  ueberUnsLabels: { leitbild: string; fakten: string; quelle: string };
  /** Microcopy on the Ablauf scene's own controls. */
  ablaufControls: {
    groupLabel: string;
    running: string;
    stopped: string;
    turnOff: string;
    turnOn: string;
  };
  /** The image the client heads their own team page with. */
  teamImage: { src: string; alt: string };
  contact: ContactCopy;
  footer: FooterCopy;
  seo: SeoConfig;
};

/** Stamped onto every published snapshot so the site can tell versions apart. */
export type PublishedSnapshot = {
  /** Monotonic, assigned by the server on publish. `0` is the build-time seed. */
  version: number;
  publishedAt: string;
  content: SiteContent;
};
