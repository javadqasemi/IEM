/**
 * Content for the IEM AG landing page.
 *
 * Facts here are drawn from www.iem.ch (offices, phone numbers, service lines,
 * reference projects). Keep it that way — this page's credibility rests on the
 * numbers being checkable. If you add a statistic, add its source too.
 */

/**
 * Tones name the discipline they stand for, not a hue — the hues come from the
 * navy/gold brand family and are defined in `tailwind.config.ts` under `disc`.
 */
export type Tone = "heat" | "air" | "water" | "power" | "energy" | "model" | "neutral";

/**
 * The six disciplines. These are the trades IEM coordinates across, and the
 * tags that appear on every reference project. Tone assignments are shared
 * with Badge / KPI / ServiceIndex and are meant to stay in lockstep, so a
 * discipline reads the same colour everywhere on the page.
 */
export const disciplines = {
  heizung: { label: "Heizung & HLK", short: "Heizung", tone: "heat" as Tone },
  lueftung: { label: "Lüftung & Klima", short: "Lüftung", tone: "air" as Tone },
  sanitaer: { label: "Sanitär", short: "Sanitär", tone: "water" as Tone },
  elektro: { label: "Elektro & Automation", short: "Elektro", tone: "power" as Tone },
  energie: { label: "Energie & Sanierung", short: "Energie", tone: "energy" as Tone },
  bim: { label: "BIM & 3D", short: "BIM", tone: "model" as Tone },
} as const;

export type DisciplineKey = keyof typeof disciplines;

/**
 * The table above is written in **HLKSE order** — Heizung, Lüftung (which is
 * where Klima/Kälte sits in this taxonomy), Sanitär, Elektro, then the two that
 * are not trades. That is the order the industry names them in, and it is the
 * order every list of disciplines on the page has to read in.
 *
 * `inHLKSE` sorts a project's own tag list into it. Without it the tags come out
 * in whatever order the entry was typed — the Freienhof reference led with
 * "Energie & Sanierung" — so two projects could not be compared at a glance.
 * Sorting against the table's own key order rather than a second hand-written
 * list means there is nothing to keep in sync: add a discipline in the right
 * place above and every badge row follows.
 */
export const disciplineOrder = Object.keys(disciplines) as DisciplineKey[];

export function inHLKSE(keys: DisciplineKey[]): DisciplineKey[] {
  return [...keys].sort((a, b) => disciplineOrder.indexOf(a) - disciplineOrder.indexOf(b));
}

/** The five service lines IEM actually sells, in the order the site lists them. */
export const services = [
  {
    id: "gebaeudetechnik",
    title: "Gebäudetechnik-Planung",
    lead: "Heizung, Lüftung, Klima, Sanitär — als ein System geplant.",
    body: "Wir begleiten Ihr Projekt vom Vorprojekt über die Ausschreibung und die Fachbauleitung bis zur Inbetriebnahme und Abnahme. Koordiniert nach der BIM-Methode, damit Kollisionen im Modell auffallen und nicht auf der Baustelle.",
    disciplines: ["heizung", "lueftung", "sanitaer", "bim"] as DisciplineKey[],
    tone: "heat" as Tone,
  },
  {
    id: "energiekonzepte",
    title: "Energie- & Sanierungskonzepte",
    lead: "Herstellerneutrale Gesamtkonzepte für Wärme, Wasser und Klima.",
    body: "Wärmeerzeugung, Brauchwarmwasser, Fassade, Belüftung und Klimatisierung im Zusammenhang betrachtet — mit Varianten, die wir offen rechnen. Information, Transparenz und regelmässiger Austausch statt einer fertigen Lösung auf dem Tisch.",
    disciplines: ["energie", "heizung", "sanitaer"] as DisciplineKey[],
    tone: "energy" as Tone,
  },
  {
    id: "betriebsoptimierung",
    title: "Betriebsoptimierung",
    lead: "Sparpotenzial im Bestand finden — und den Erfolg belegen.",
    body: "Wir analysieren, wo Ihre Energiekosten entstehen, stellen im Neubau die optimalen Betriebsbedingungen ein und kontrollieren den Erfolg messbar. Sie sehen, was die Massnahme gebracht hat, nicht nur was sie kosten sollte.",
    disciplines: ["energie", "elektro", "lueftung"] as DisciplineKey[],
    tone: "power" as Tone,
  },
  {
    id: "simulation",
    title: "Dynamische Simulation",
    lead: "Das Gebäude durchrechnen, bevor es gebaut wird.",
    body: "Gebäudesimulation auf Basis realer Klimadaten für Fassaden-, Solar- und Klimakonzepte. So lassen sich Investitions- und Betriebskosten gegeneinander optimieren, solange Änderungen noch nichts kosten.",
    disciplines: ["lueftung", "bim", "energie"] as DisciplineKey[],
    tone: "air" as Tone,
  },
  {
    id: "messtechnik",
    title: "Messtechnik",
    lead: "Der Nachweis. Mit mobilen Messgeräten am Objekt.",
    body: "Durchflussmengen, Volumenströme, Temperaturen, Feuchte und Thermografie — aufgenommen, ausgewertet und interpretiert. Am Ende steht ein Befund, mit dem sich entscheiden lässt.",
    disciplines: ["heizung", "lueftung", "sanitaer", "elektro"] as DisciplineKey[],
    tone: "water" as Tone,
  },
];

/**
 * Project phases with their real SIA 112 numbers. The numbers are the point:
 * they are the vocabulary Swiss clients and architects already plan in, so the
 * sequence doubles as a statement about how IEM works.
 */
export const phases = [
  { no: "31", title: "Vorprojekt", body: "Varianten, Grobkosten, Machbarkeit." },
  { no: "32", title: "Bauprojekt", body: "Auslegung, Kostenvoranschlag, Bewilligung." },
  { no: "41", title: "Ausschreibung", body: "Devis, Offertvergleich, Vergabeantrag." },
  { no: "51", title: "Ausführungsprojekt", body: "Werk- und Montageplanung im Modell." },
  { no: "52", title: "Fachbauleitung", body: "Kontrolle auf der Baustelle, Termine, Kosten." },
  { no: "53", title: "Inbetriebnahme", body: "Einregulierung, Messung, Abnahme." },
];

/**
 * The three acts of the 3D scene in the Ablauf section: who is acting, what
 * happens, and which SIA phases it covers.
 *
 * `phases` are real numbers out of `phases` above, not decoration — the phase
 * track highlights exactly these while an act runs, so the animation and the
 * fee stages tell the same story. Keep them in sync if either list changes.
 *
 * The copy stays inside what iem.ch already claims: BIM coordination catching
 * collisions in the model, Fachbauleitung on site, and measurement at
 * Einregulierung. Nothing here promises anything the services section doesn't.
 */
export const bauakte = [
  {
    id: "planen",
    role: "Planer",
    phases: ["31", "32", "41", "51"],
    title: "Der Planer zeichnet die Anlage.",
    body: "Am Rechner entstehen die Leitungen zuerst als Linien im Modell — Architektur, Heizung und Lüftung als eigene Fachmodelle, überlagert nach der BIM-Methode. Kollisionen fallen hier auf und nicht auf der Baustelle.",
  },
  {
    id: "bauen",
    role: "Installateur",
    phases: ["52"],
    title: "Der Installateur baut sie ein.",
    body: "Aus Linien werden Rohre und Kanäle im wirklichen Durchmesser, dazu Speicher, Verteiler und die Lüftungsgeräte. Wir führen die Fachbauleitung: Kontrolle auf der Baustelle, Termine, Kosten.",
  },
  {
    id: "nutzen",
    role: "Nutzer",
    phases: ["53"],
    title: "Der Nutzer schaltet sie ein.",
    body: "Dann läuft, was vorher gezeichnet war: Heizwasser im Vor- und Rücklauf, Zu- und Abluft über neun Geschosse, Kaltwasser zur Zentrale. Bei der Einregulierung messen wir nach, was ankommt.",
  },
] as const;

export type Bauakt = (typeof bauakte)[number];

export const useCategories = [
  "Pflege & Wohnen",
  "Bildung",
  "Gewerbe & Industrie",
  "Energie & PV",
] as const;

export type UseCategory = (typeof useCategories)[number];

/**
 * The reference list published on iem.ch. `image` points at the project's own
 * photo, downloaded from the site into `public/img/ref/`. Every entry here has
 * a real photo — don't add one without it, an empty card breaks the grid.
 */
/**
 * The extra fields iem.ch publishes per reference, shown in the project dialog.
 * Every value is taken verbatim from https://www.iem.ch/referenzen — these are
 * the checkable specifics (who commissioned it, what it cost) that the page's
 * credibility rests on, so **don't fill a gap with a plausible guess**. Several
 * projects genuinely publish no architect, no cost or no energy standard; those
 * keys stay absent and the dialog simply omits the row.
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

export const projects: {
  name: string;
  /** Omitted where iem.ch publishes no location — don't fill one in. */
  place?: string;
  years: string;
  use: UseCategory;
  scope: string;
  image: string;
  disciplines: DisciplineKey[];
  details?: ProjectDetails;
}[] = [
  {
    name: "Alterszentrum Lebensart",
    place: "Aarwangen",
    years: "2020–2022",
    use: "Pflege & Wohnen",
    scope: "Umbau & Erweiterung",
    image: "/img/ref/alterszentrum-lebensart-aarwangen.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer", "elektro"],
    details: {
      bauherr: "LebensART Bärau",
      architekt: "Schär Buri Architekten BSA SIA, Bern",
      leistungen: "Energie-/Haustechnikkonzept, Heizungsplanung, Lüftungsplanung, Sanitärplanung, MSR-Planung, Fachkoordination, 100 % TL gem. SIA, Kanalisationsplanung",
      bausummeTotal: "CHF 20 Mio.",
      bausummeFach: "CHF 3.3 Mio.",
      energiestandard: "Kantonales Energiegesetz",
    },
  },
  {
    name: "Zentrum Schlossmatt",
    place: "Burgdorf",
    years: "2017–2021",
    use: "Pflege & Wohnen",
    scope: "Umbau, Erweiterung & Aufstockung",
    image: "/img/ref/zsb-burgdorf-aufstockung-03.jpg",
    disciplines: ["heizung", "lueftung", "sanitaer", "elektro"],
    details: {
      bauherr: "Zentrum Schlossmatt Burgdorf",
      architekt: "FRB + Partner Architekten AG, Ittigen",
      leistungen: "Heizungsplanung, Lüftungsplanung, Sanitärplanung, Elektroplanung, MSR-Planung, Fachkoordination, 100 % TL gem. SIA",
      bausummeTotal: "CHF 25.4 Mio.",
      bausummeFach: "CHF 7.98 Mio.",
    },
  },
  {
    name: "Burgergut",
    place: "Steffisburg",
    years: "2014–2019",
    use: "Pflege & Wohnen",
    scope: "Sanierung & Neubau",
    image: "/img/ref/iem-burgergut-thun.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer"],
    details: {
      bauherr: "Burgergemeinde Thun",
      architekt: "brügger architekten ag, Thun",
      leistungen: "Energie-/Haustechnikkonzept, Heizungsplanung, Lüftungsplanung, Sanitärplanung, MSR-Planung, Fachkoordination, 100 % TL gem. SIA, Kanalisationsplanung, Betriebsoptimierung",
      bausummeTotal: "CHF 57 Mio.",
      bausummeFach: "CHF 6 Mio.",
      energiestandard: "Minergie-P ECO",
    },
  },
  {
    name: "Dahlia",
    place: "Langnau",
    years: "2018–2021",
    use: "Pflege & Wohnen",
    scope: "Sanierung",
    image: "/img/ref/dahlia-langnau.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer", "elektro"],
    details: {
      bauherr: "Dahlia Lenggen Langnau",
      architekt: "Müller & Partner AG, Langenthal + Furter & Partner AG, Wettingen",
      leistungen: "Energie-/Haustechnikkonzept, Heizungsplanung, Lüftungsplanung, Sanitärplanung, Elektroplanung, MSR-Planung, Fachkoordination, 100 % TL gem. SIA",
      bausummeTotal: "CHF 42 Mio.",
      bausummeFach: "CHF 8.5 Mio.",
    },
  },
  {
    name: "Talgut",
    place: "Ittigen",
    years: "2018–2021",
    use: "Pflege & Wohnen",
    scope: "Sanierung",
    image: "/img/ref/talgut-ittigen.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer", "elektro"],
    details: {
      bauherr: "Seniorenresidenz Talgut Ittigen, P. Mennig",
      architekt: "Müller & Partner AG, Langenthal + Furter & Partner AG, Wettingen",
      leistungen: "Energie-/Haustechnikkonzept, Heizungsplanung, Lüftungsplanung, Sanitärplanung, Elektroplanung, MSR-Planung, Fachkoordination, 100 % TL gem. SIA",
      bausummeTotal: "CHF 42 Mio.",
      bausummeFach: "CHF 8.5 Mio.",
    },
  },
  {
    name: "Seegarten",
    place: "Hünibach",
    years: "2018–2022",
    use: "Pflege & Wohnen",
    scope: "Erweiterung & Wärmeerzeugung",
    image: "/img/ref/seegarten-hnibach.png",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer"],
    details: {
      bauherr: "Stiftung für Betagte Hilterfingen - Hünibach",
      architekt: "kathrinsimmen Architekten ETH SIA, Zürich",
      leistungen: "Energie-/Haustechnikkonzept, Heizungsplanung, Lüftungsplanung, Sanitärplanung, MSR-Planung, Fachkoordination, 100 % TL gem. SIA, Kanalisationsplanung",
      bausummeTotal: "CHF 15 Mio.",
      bausummeFach: "CHF 1.1 Mio.",
    },
  },
  {
    name: "Riedacker",
    place: "Muri",
    years: "2021–2023",
    use: "Pflege & Wohnen",
    scope: "Neubau",
    image: "/img/ref/riedacker-muri.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer"],
    details: {
      bauherr: "Frutiger AG",
      architekt: "Burkhart & Partner AG, Bern",
      leistungen: "Energie-/Haustechnikkonzept, Heizungsplanung, Lüftungsplanung, Sanitärplanung, Kanalisationsplanung, Käuferbetreuung, Fachkoordination, 100 % TL gem. SIA",
      bausummeTotal: "CHF 90 Mio.",
      bausummeFach: "CHF 5 Mio.",
      energiestandard: "Minergie-A",
    },
  },
  {
    name: "Stuckimatte",
    place: "Steffisburg",
    years: "2019–2020",
    use: "Pflege & Wohnen",
    scope: "Neubau & Wärmeerzeugung",
    image: "/img/ref/stuckimatte.jpg",
    disciplines: ["heizung", "sanitaer", "elektro"],
    details: {
      bauherr: "Stucki's Söhne Steffisburg",
      architekt: "brügger architekten ag, Thun",
      leistungen: "Wärmeerzeugerkonzept, Haustechnikkonzept, Heizungsplanung, Sanitärplanung, Elektroplanung, Fachkoordination, 100 % TL gem. SIA",
      bausummeTotal: "CHF 8.5 Mio.",
      bausummeFach: "CHF 1.8 Mio.",
      energiestandard: "Minergie-A Eco",
    },
  },
  {
    name: "Schäferhöhe",
    place: "Zollikofen",
    years: "2018–2020",
    use: "Pflege & Wohnen",
    scope: "Neubau",
    image: "/img/ref/schaeferhoehe.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer", "elektro"],
    details: {
      bauherr: "Marti GU AG",
      architekt: "brügger architekten ag, Thun",
      leistungen: "Energie-/Haustechnikkonzept, Heizungsplanung, Lüftungsplanung, Sanitärplanung, Elektroplanung, MSR-Planung, Fachkoordination, 100 % TL gem. SIA",
      bausummeTotal: "CHF 55 Mio.",
      bausummeFach: "CHF 8.7 Mio.",
      energiestandard: "Minergie",
    },
  },
  {
    name: "Feldeckstrasse 33",
    place: "Thun",
    years: "2018–2019",
    use: "Pflege & Wohnen",
    scope: "Neubau",
    image: "/img/ref/feldeckstrasse-thun.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer", "elektro"],
    details: {
      bauherr: "Strasser H. + K., Thun",
      architekt: "KXS Architekten AG, Thun",
      leistungen: "Energiekonzept, Heizungsplanung, Lüftungsplanung, Sanitärplanung, Elektroplanung, Fachkoordination, 80 % TL gem. SIA",
      bausummeFach: "CHF 430'000.00",
      energiestandard: "Kantonales Energiegesetz",
    },
  },
  {
    name: "Hochschule Lärchenplatz",
    place: "Magglingen",
    years: "2021–2023",
    use: "Bildung",
    scope: "Neubau · Fachbauleitung Phasen 31–53",
    image: "/img/ref/magglingen.jpg",
    disciplines: ["heizung", "lueftung", "sanitaer", "elektro", "bim"],
    details: {
      bauherr: "Bundesamt für Bauten BBL",
      architekt: "Kim Strebel Architekten GmbH, Aarau",
      leistungen: "100 % TL, Phase 31 - 53 gem. SIA 112",
      bausummeTotal: "CHF 42 Mio.",
      bausummeFach: "CHF 7 Mio.",
      energiestandard: "Minergie-ECO (ohne Zertifizierung)",
    },
  },
  {
    name: "Schulanlage Steckgut",
    place: "Bern",
    years: "2022–2023",
    use: "Bildung",
    scope: "Gesamtsanierung · Generalplanung",
    image: "/img/ref/schulanlage-steckgut-bern.jpg",
    disciplines: ["heizung", "lueftung", "sanitaer", "elektro"],
    details: {
      bauherr: "Stadt Bern",
      architekt: "Schär Buri Architekten BSA SIA, Bern",
      leistungen: "Koordination Elektroplanung, Heizungsplanung, Lüftungsplanung, Sanitärplanung, GA-Planung, Fachkoordination inkl. MSRL, 100 % TL gem. SIA",
      bausummeTotal: "CHF 7.8 Mio.",
      bausummeFach: "CHF 390'000.00",
      energiestandard: "Kantonale Energievorschrift (ECO-Standard)",
    },
  },
  {
    name: "Schulanlage Stegmatte",
    place: "Lyss",
    years: "2020–2022",
    use: "Bildung",
    scope: "Sanierung & Erweiterung",
    image: "/img/ref/sanierung-erweiterung-schulanlage-stegmatte-lyss.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer"],
    details: {
      bauherr: "Gemeinde Lyss",
      architekt: "H&R Architekten AG, Münsingen",
      leistungen: "Zustandsanalyse, Koordination Elektroplanung, Heizungsplanung, Lüftungsplanung, Sanitärplanung, GA-Planung, Fachkoordination, 100 % TL gem. SIA",
      bausummeTotal: "CHF 25 Mio.",
      bausummeFach: "CHF 3.5 Mio.",
      energiestandard: "Minergie-Standard (ohne Zertifizierung)",
    },
  },
  {
    name: "MZH Waffenplatz",
    place: "Thun",
    years: "2015–2016",
    use: "Bildung",
    scope: "Neubau Dreifachturnhalle",
    image: "/img/ref/thun-mehrzweckhalle-waffenplatz-hean.jpg",
    disciplines: ["energie", "lueftung", "elektro"],
    details: {
      bauherr: "Armasuisse immobilien",
      architekt: "HMS Architekten und Planer AG, Spiez",
      leistungen: "Neubau Dreifach-Sporthalle mit diversen Nebenräumen und ziviler Nutzung, optimales Energiekonzept, Tageslichtnutzung mittels Oblichter, Belüftung via Quelllüftung, energieeffiziente Beleuchtung, PV-Anlage zur Stromerzeugung",
      bausummeTotal: "CHF 10 Mio.",
      bausummeFach: "CHF 1.4 Mio.",
      energiestandard: "Minergie-A Eco und Minergie-P Eco",
    },
  },
  {
    name: "Kindergarten Roggern",
    place: "Einigen",
    years: "2017–2018",
    use: "Bildung",
    scope: "Neubau",
    image: "/img/ref/kiga-einigen.png",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer"],
    details: {
      bauherr: "Einwohnergemeinde Spiez",
      architekt: "HMS Architekten und Planer AG, Spiez",
      leistungen: "Heizungsplanung, Lüftungsplanung, Sanitärplanung, MSR-Anlagen mit 100 % TL, Fachkoordination, Energiekonzept sowie Beratung / Nachweise Energie",
      bausummeTotal: "CHF 2.8 Mio.",
      bausummeFach: "CHF 220'000.00",
    },
  },
  {
    name: "Schulanlage & Turnhalle",
    place: "Zäziwil",
    years: "2016–2017",
    use: "Bildung",
    scope: "Erweiterung & Sanierung",
    image: "/img/ref/zziwil-turnhalle.png",
    disciplines: ["heizung", "lueftung", "sanitaer", "elektro"],
    details: {
      bauherr: "Einwohnergemeinde Zäziwil",
      architekt: "von Allmen Architekten AG, Interlaken",
      leistungen: "Heizungsplanung, Lüftungsplanung, Sanitärplanung, Elektroplanung, MSR-Anlagen mit 100 % TL, Fachkoordination",
      bausummeTotal: "CHF 9 Mio.",
      bausummeFach: "CHF 1.1 Mio.",
    },
  },
  {
    name: "Verkehrsstützpunkt",
    place: "Chur",
    years: "2023–2024",
    use: "Gewerbe & Industrie",
    scope: "Neubau",
    image: "/img/ref/vks-chur.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer", "elektro"],
    details: {
      bauherr: "Kanton Graubünden",
      architekt: "Comamala Ismail, Delémont / Bienne",
      leistungen: "Energie-/Haustechnikkonzept, Heizungsplanung, Lüftungsplanung, Sanitärplanung, MSR-Planung, Kanalisationsplanung, Fachkoordination, 100 % TL gem. SIA",
      bausummeTotal: "CHF 9.5 Mio.",
      bausummeFach: "CHF 700'000.-",
      energiestandard: "Minergie-A Eco / Netto-Null-Gebäude",
    },
  },
  {
    name: "Freienhof",
    place: "Thun",
    years: "2018–2023",
    use: "Gewerbe & Industrie",
    scope: "Gesamtsanierung · Sprinkler",
    image: "/img/ref/freienhof-thun.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer"],
    details: {
      bauherr: "Gewerkschaft UNIA / Hotel Freienhof AG",
      architekt: "brügger architekten ag, Thun + Jordi & Partner AG, Bern",
      leistungen: "Energie-/Haustechnikkonzept, Heizungsplanung, Lüftungsplanung, Sanitärplanung, Sprinklerplanung, Klima-Kälteplanung, Gewerbliche-Kälteplanung, Fachkoordination, 100 % TL gem. SIA",
      bausummeTotal: "CHF 39 Mio.",
      bausummeFach: "CHF 5.6 Mio.",
    },
  },
  {
    name: "Falken",
    place: "Thun",
    years: "2018–2020",
    use: "Gewerbe & Industrie",
    scope: "Gesamtsanierung · Klima & Kälte",
    image: "/img/ref/falken-thun.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer"],
    details: {
      bauherr: "AEK Bank1826",
      architekt: "Think Architecture AG, Zürich",
      leistungen: "Energie-/Haustechnikkonzept, Heizungsplanung, Lüftungsplanung, Sanitärplanung, Kälteplanung, Fachkoordination, 100 % TL gem. SIA",
      bausummeTotal: "CHF 17 Mio.",
      bausummeFach: "CHF 1.2 Mio.",
    },
  },
  {
    name: "Extramet",
    place: "Plaffeien",
    years: "2009–2021",
    use: "Gewerbe & Industrie",
    scope: "Neubau & Sanierung, mehrere Etappen",
    image: "/img/ref/iem-extramet-plaffaien.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer", "elektro"],
    details: {
      bauherr: "Extramet AG",
      architekt: "B. Baeriswyl Architekten, Alterswil",
      leistungen: "Energiekonzept, Fachkoordination, Sanitärplanung, Lüftungsplanung, Kälteplanung, Heizungsplanung, Elektroplanung",
      bausummeTotal: "CHF 30 Mio.",
      bausummeFach: "CHF 3.5 Mio.",
    },
  },
  {
    name: "Transfair",
    place: "Thun",
    years: "2015–2017",
    use: "Gewerbe & Industrie",
    scope: "Neubau",
    image: "/img/ref/transfair-17-002.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer"],
    details: {
      bauherr: "Stiftung Transfair",
      architekt: "brügger architekten ag, Thun",
      leistungen: "Heizungsplanung, Lüftungsplanung, Klimaplanung, Sanitärplanung, Kanalisationsplanung, Energiekonzept, Fachkoordination, 100 % TL nach SIA",
      bausummeTotal: "CHF 21 Mio.",
      bausummeFach: "CHF 3.4 Mio.",
      energiestandard: "Minergie-P ECO",
    },
  },
  {
    name: "Marktareal",
    place: "Zweisimmen",
    years: "2018–2020",
    use: "Gewerbe & Industrie",
    scope: "Neubau",
    image: "/img/ref/marktareal-z-simmen.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer"],
    details: {
      bauherr: "Genossenschaft Migros Aare",
      architekt: "brügger architekten ag, Thun",
      leistungen: "Energie-/Haustechnikkonzept, Heizungsplanung, Lüftungsplanung, Kälteplanung, Sanitärplanung, 100 % TL gem. SIA",
      bausummeTotal: "CHF 21 Mio.",
      bausummeFach: "CHF 2.5 Mio.",
    },
  },
  {
    name: "Lorymatte",
    place: "Münsingen",
    years: "2016–2019",
    use: "Gewerbe & Industrie",
    scope: "Neubau & Mieterausbau · Sprinkler",
    image: "/img/ref/iem-lorymatte-muensingen.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer"],
    details: {
      bauherr: "Sarasin Anlagestiftung",
      architekt: "Trachsel Zeltner Architekten, Thun + brügger architekten ag, Thun",
      leistungen: "Energie-/Haustechnikkonzept, Heizungsplanung, Lüftungsplanung, Sanitärplanung, Sprinklerplanung, Werkleitungsplanung, MSR-Planung, Fachkoordination, 100 % TL gem. SIA",
      bausummeTotal: "CHF 90 Mio.",
      bausummeFach: "CHF 6.5 Mio.",
      energiestandard: "Minergie-P Eco",
    },
  },
  {
    name: "HGC Schoren",
    place: "Thun",
    years: "2022–2023",
    use: "Gewerbe & Industrie",
    scope: "Neubau",
    image: "/img/ref/hg-commercial.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer", "elektro"],
    details: {
      bauherr: "Frutiger AG Immobilienentwicklung",
      architekt: "Zellweger Architekten AG, Thun",
      leistungen: "Heizungsplanung, Lüftungsplanung, Sanitärplanung, Elektroplanung, Energiekonzept, Fachkoordination",
      bausummeTotal: "CHF 11 Mio.",
      bausummeFach: "CHF 1.6 Mio.",
    },
  },
  {
    name: "Diverse BEKB-Filialen",
    place: "10 Standorte",
    years: "2014–2020",
    use: "Gewerbe & Industrie",
    scope: "Sanierung",
    image: "/img/ref/sanierung-diverse-bekb-filialen.jpg",
    disciplines: ["energie", "heizung", "lueftung", "sanitaer"],
    details: {
      bauherr: "Berner Kantonalbank Bern",
      leistungen: "Heizungsplanung, Lüftungsplanung, Klimaplanung, Sanitärplanung, Energiekonzept, Fachkoordination, 100 % TL gem. SIA",
    },
  },
  {
    name: "Bürogebäude IEM AG",
    place: "Thun",
    years: "2024",
    use: "Energie & PV",
    scope: "Photovoltaik am eigenen Haus",
    image: "/img/ref/bro-thun.jpeg",
    disciplines: ["energie", "elektro"],
    details: {
      bauherr: "Ingenieurbüro IEM AG",
      leistungen: "Planung PV-Anlage",
    },
  },
  {
    name: "PV-Anlage Wattwil",
    place: "Wattwil",
    years: "2022",
    use: "Energie & PV",
    scope: "Machbarkeit & Planung nach SIA 108",
    image: "/img/ref/wattwil.jpg",
    disciplines: ["energie", "elektro"],
    details: {
      bauherr: "Swisscom Broadcast AG",
      leistungen: "Machbarkeitsstudie, Planung nach SIA 108 mit 100 % TL, Gesamtprojektleitung",
      bausummeTotal: "CHF 160'000.00",
    },
  },
  {
    name: "PV-Anlage Hornfluh",
    place: "Hornfluh",
    years: "2019",
    use: "Energie & PV",
    scope: "Machbarkeit & Planung nach SIA 108",
    image: "/img/ref/hornfluh.jpg",
    disciplines: ["energie", "elektro"],
    details: {
      bauherr: "Swisscom Broadcast AG",
      leistungen: "Machbarkeitsstudie, Planung nach SIA 108 mit 100 % TL, Gesamtprojektleitung",
      bausummeTotal: "CHF 200'000.00",
    },
  },
  {
    name: "PV-Anlage St. Chrischona",
    place: "St. Chrischona",
    years: "2017",
    use: "Energie & PV",
    scope: "Machbarkeit & Planung nach SIA 108",
    image: "/img/ref/st-chrischona.jpg",
    disciplines: ["energie", "elektro"],
    details: {
      bauherr: "Swisscom Broadcast AG",
      leistungen: "Machbarkeitsstudie, Planung nach SIA 108 mit 100 % TL, Gesamtprojektleitung",
      bausummeTotal: "CHF 450'000.00",
    },
  },
  {
    name: "PV-Anlage Strichboden",
    years: "2022",
    use: "Energie & PV",
    scope: "Machbarkeit & Planung nach SIA 108",
    image: "/img/ref/strichboden.jpg",
    disciplines: ["energie", "elektro"],
    details: {
      bauherr: "Swisscom Broadcast AG",
      leistungen: "Machbarkeitsstudie, Planung nach SIA 108 mit 100 % TL, Gesamtprojektleitung",
      bausummeTotal: "CHF 150'000.00",
    },
  },
];

export const offices = [
  {
    city: "Thun",
    street: "Uttigenstrasse 49",
    zip: "3600 Thun",
    phone: "+41 33 227 40 20",
    phoneHref: "tel:+41332274020",
  },
  {
    city: "Bern",
    street: "Sandrainstrasse 3",
    zip: "3007 Bern",
    phone: "+41 31 688 40 20",
    phoneHref: "tel:+41316884020",
  },
];

/**
 * IEM's own social accounts, linked from the footer of every page on iem.ch.
 * The URLs are the client's real ones — the Facebook handle really is spelled
 * `iemagoffical`, so don't "fix" it.
 *
 * `color` is each platform's brand hex, and is deliberately **not** a token in
 * `tailwind.config.ts` / `src/lib/tokens.ts`: those hold the IEM identity, and
 * these three hues are not part of it. They are applied as inline `currentColor`
 * on the icon only, so the surrounding button chrome stays on brand.
 */
export const socials: {
  label: string;
  href: string;
  icon: "linkedin" | "instagram" | "facebook";
  color: string;
}[] = [
  {
    label: "LinkedIn",
    href: "https://ch.linkedin.com/company/ingenieurb%C3%BCro-iem-ag",
    icon: "linkedin",
    color: "#0A66C2",
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/iem_ag/",
    icon: "instagram",
    color: "#E4405F",
  },
  {
    label: "Facebook",
    href: "https://www.facebook.com/iemagofficalFacebook",
    icon: "facebook",
    color: "#1877F2",
  },
];

/**
 * Open positions, verbatim from iem.ch/karriere — role, workload and location
 * exactly as advertised, each with the job-ad PDF the client publishes.
 *
 * An earlier draft carried four invented openings with made-up locations and a
 * "Lehrstelle Gebäudetechnikplaner:in" that the site explicitly contradicts:
 * *"Ab Sommer 2026 haben wir leider keine freien Lehrstellen mehr zu besetzen."*
 * A wrong vacancy is a checkable claim about a real employer — re-read the page
 * before editing this list, and drop roles that have been filled rather than
 * leaving them up.
 */
/**
 * `image` is **editorial, not derived**, and — unlike everything else in
 * `public/img/` — **not the client's own photography.** These are licence-free
 * stock (Pexels licence: free commercial use, no attribution required) in
 * `public/img/jobs/`, picked to show the *trade* the advert is for: a
 * Heizungsverteiler, Lüftungskanäle, eine Kälteanlage, eine Sanitärleitung.
 *
 * This replaced a mapping onto IEM's reference-project photos. Those could not
 * carry trade meaning — every one of the 23 references covers Heizung, Lüftung
 * *and* Sanitär, so picking one "for Heizung" was invented precision — and a
 * named building beside a vacancy invites the reader to conclude the job is
 * *for* that project. Generic kit does neither.
 *
 * They still render decoratively (`alt=""`): the role title carries the meaning.
 * Two photos per trade, so nothing repeats in the grid. `kaelte.jpg` sits on the
 * Gesamtprojektleiter HLKS advert — the K in HLKS is Klima/Kälte, and that is
 * the one of the seven roles that spans it. Swap freely; the path only has to
 * stay a real file in `public/`.
 */
export const jobCategories = ["Offene Stellen", "Schnupperlehre", "Lehrstellen"] as const;

export type JobCategory = (typeof jobCategories)[number];

/**
 * What to show when a category has no entries.
 *
 * Both texts below are the facts iem.ch already publishes and that the Karriere
 * section's own description repeats — nothing here is inferred. IEM lists seven
 * open positions and no apprenticeship adverts, so those two categories carry a
 * statement rather than invented listings. Add real entries to `openings` with
 * the matching `category` and the note disappears on its own.
 */
export const jobCategoryNotes: Record<JobCategory, string> = {
  "Offene Stellen": "Zurzeit sind keine Stellen ausgeschrieben.",
  Schnupperlehre:
    "Schnupperlehren bieten wir jedes Jahr an — einzeln vereinbart, ohne feste Ausschreibung. Melden Sie sich über das Formular, dann finden wir einen Termin.",
  Lehrstellen:
    "Ab Sommer 2026 sind alle Lehrstellen besetzt. Für den nächsten Lehrbeginn nehmen wir Bewerbungen laufend entgegen.",
};

/**
 * The advert bodies, read out of the seven PDFs IEM publishes and stored
 * **verbatim** — the same rule the reference projects' `details` follow. These
 * are a real employer's terms of employment; a reworded duty or a softened
 * requirement is a false claim about what IEM is offering. Line breaks from the
 * PDF's typesetting are joined, and nothing else is touched.
 *
 * Re-extract rather than edit by hand when an advert changes:
 *   python -c "from pypdf import PdfReader; print(PdfReader('inserat.pdf').pages[0].extract_text())"
 *
 * The three passages every advert shares sit here once rather than seven times.
 * The wording is identical across all seven files — checked, not assumed.
 */
export const jobUeberUns =
  "Die IEM AG ist ein mittleres Unternehmen mit Sitz in Thun und Bern, das innovative und nachhaltige Lösungen im Bereich der Gebäudetechnikplanung bietet. Unsere Projekte reichen von kleinen Installationen bis hin zu grossen Industrieanlagen. Ob Heizungs-, Lüftungs-, Klima-, Sanitär- oder Elektroplanung – wir sind ein verlässlicher Partner mit einem starken Fokus auf qualitativ hochstehende Arbeit und entsprechende Kundenzufriedenheit.";

export const jobBewerbung =
  "Wenn Du Interesse an dieser herausfordernden und vielseitigen Position hast, freuen wir uns auf Deine vollständigen Bewerbungsunterlagen (Motivationsschreiben, Lebenslauf, Zeugnisse) per E-Mail an: info@iem.ch";

export const jobSchluss = "Wir freuen uns darauf, Dich kennenzulernen!";

/**
 * The five closing "Wir bieten" lines every advert carries. The opening line
 * differs — six adverts promise "Interessante Gesamtplanungen", the
 * Gesamtprojektleitung promises its own — so it is written per advert.
 */
const bietenBasis = [
  "Eine attraktive und leistungsgerechte Vergütung",
  "Ein abwechslungsreiches und spannendes Tätigkeitsfeld",
  "Moderne Arbeitsmittel und Software",
  "Ein kollegiales und dynamisches Team",
  "Weiterbildungsmöglichkeiten und Unterstützung bei der beruflichen Entwicklung",
];

const gesamtplanungen = "Interessante Gesamtplanungen (HLKSE, Gebäudeautomation und BIM)";
const aufstieg = "Aufstiegsmöglichkeiten in die Geschäftsleitung";

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

/**
 * `id` is the slug the detail view is opened with (`/stelle.html?id=…`), taken
 * from the PDF's own filename so the two stay recognisably paired.
 */
export const openings: {
  id: string;
  role: string;
  pensum: string;
  place: string;
  pdf: string;
  image: string;
  category: JobCategory;
  detail: JobDetail;
}[] = [
  {
    id: "gpl-hlks",
    role: "Gesamtprojektleiter:in HLKS",
    pensum: "80–100%",
    place: "Thun",
    image: "/img/jobs/kaelte.jpg",
    category: "Offene Stellen",
    pdf: "https://www.iem.ch/download/pictures/5d/8tbx4wfy3vxz7ueprv64g3fozpx4pf/stelleninserat_gpl_hlks.pdf",
    detail: {
      titel: "Gesamtprojektleiter HLKS (m / w / d)",
      einstieg:
        "Per sofort oder nach Vereinbarung motivierter und erfahrener Gesamtprojektleiter HLKS (m / w / d) 80 – 100 % zur Verstärkung unseres Teams in Thun gesucht!",
      aufgaben: [
        "Gesamtverantwortung für anspruchsvolle HLKS-Projekte von der Planung bis zur Inbetriebnahme",
        "Koordination und Führung interner und externer Projektteams sowie Fachplaner",
        "Termin-, Kosten- und Qualitätskontrolle über alle Gewerke hinweg",
        "Ansprechperson für Bauherren, Architekten, Generalunternehmer und Behörden",
        "Sicherstellung der Einhaltung aller relevanten Normen, Gesetze und Vorschriften",
        "Unterstützung bei der Akquise, Projektkalkulation und Angebotsausarbeitung",
      ],
      profil: [
        "Abgeschlossene Ausbildung im Bereich Gebäudetechnik (zB. HLKS-Ingenieur, Techniker HF oder gleichwertig)",
        "Mehrjährige Berufserfahrung in der Leitung von komplexen Gesamtprojekten im HLKS-Umfeld",
        "Ausgeprägtes technisches und betriebswirtschaftliches Verständnis",
        "Führungsstärke, Durchsetzungsvermögen und hohe Sozialkompetenz",
        "Strukturierte, lösungsorientierte und unternehmerische Denkweise",
        "Sicherer Umgang mit gängiger Planungssoftware und MS Office",
        "Gute Deutschkenntnisse in Wort und Schrift",
      ],
      bieten: [
        "Anspruchsvolle, abwechslungsreiche Projekte mit viel Eigenverantwortung (HLKSE, Gebäudeautomation und BIM)",
        ...bietenBasis,
      ],
      kontakt: { name: "Kevin von Dach", telefon: "033 227 40 20" },
    },
  },
  {
    id: "projektleiter-heizung",
    role: "Projektleiter:in Heizung",
    pensum: "80–100%",
    place: "Thun",
    image: "/img/jobs/heizung.jpg",
    category: "Offene Stellen",
    pdf: "https://www.iem.ch/download/pictures/94/m0j1ei3ry3ze1mi2ev8wudmjcv9g3q/stelleninserat_projektleiter_heizung.pdf",
    detail: {
      titel: "Projektleiter Heizung (m / w / d)",
      einstieg:
        "Per sofort oder nach Vereinbarung motivierter und erfahrener Projektleiter Heizung (m / w / d) 80 – 100 % zur Verstärkung unseres Teams in Thun gesucht!",
      aufgaben: [
        "Bearbeitung und Leitung von Projekten im Fachgebiet Heizungstechnik in allen Phasen (SIA)",
        "Verantwortung für Budget, Zeitpläne und die technische Ausführung",
        "Beratung von Bauherren und Kunden",
        "Übernahme der Fachbauleitung und Umsetzung von Entwürfen und Projektbeschrieben",
      ],
      profil: [
        "Abgeschlossene Ausbildung als Gebäudetechnikplaner/in Fachrichtung Heizung, allenfalls mit Weiterbildung Techniker/in HF",
        "Mehrjährige Berufserfahrung, idealerweise in einer leitenden Position",
        "Sicherer Umgang mit CAD-Software (NOVA) und den Office-Programmen",
        "Hohes Verantwortungsbewusstsein und Engagement",
        "Unternehmerisches Denken und Handeln",
        "Ausgeprägte Team- und Kommunikationsfähigkeiten",
        "Motivation, unser junges Heizungsteam zu fördern und weiterzuentwickeln",
      ],
      bieten: [gesamtplanungen, ...bietenBasis, aufstieg],
      kontakt: { name: "Andreas Huber", telefon: "033 227 40 22" },
    },
  },
  {
    id: "projektleiter-lueftung",
    role: "Projektleiter:in Lüftung",
    pensum: "80–100%",
    place: "Thun",
    image: "/img/jobs/lueftung.jpg",
    category: "Offene Stellen",
    pdf: "https://www.iem.ch/download/pictures/38/celiy2pubm8v9mksrzp3dwtzhrr9yi/stelleninserat_projektleiter_lueftung.pdf",
    detail: {
      titel: "Projektleiter Lüftung (m / w / d)",
      einstieg:
        "Per sofort oder nach Vereinbarung motivierter und erfahrener Projektleiter Lüftung (m / w / d) 80 – 100 % zur Verstärkung unseres Teams in Thun gesucht!",
      aufgaben: [
        "Bearbeitung und Leitung von Projekten im Fachgebiet Lüftungstechnik in allen Phasen (SIA)",
        "Verantwortung für Budget, Zeitpläne und die technische Ausführung",
        "Beratung von Bauherren und Kunden",
        "Übernahme der Fachbauleitung und Umsetzung von Entwürfen und Projektbeschrieben",
      ],
      profil: [
        "Abgeschlossene Ausbildung als Gebäudetechnikplaner/in Fachrichtung Lüftung, allenfalls mit Weiterbildung Techniker/in HF",
        "Mehrjährige Berufserfahrung, idealerweise in einer leitenden Position",
        "Sicherer Umgang mit CAD-Software (NOVA) und den Office-Programmen",
        "Hohes Verantwortungsbewusstsein und Engagement",
        "Unternehmerisches Denken und Handeln",
        "Ausgeprägte Team- und Kommunikationsfähigkeiten",
        "Motivation, unser junges Lüftungsteam zu fördern und weiterzuentwickeln",
      ],
      bieten: [gesamtplanungen, ...bietenBasis, aufstieg],
      kontakt: { name: "Kevin von Dach", telefon: "033 227 40 30" },
    },
  },
  {
    id: "projektleiter-sanitaer",
    role: "Projektleiter:in Sanitär",
    pensum: "80–100%",
    place: "Thun oder Bern",
    image: "/img/jobs/sanitaer.jpg",
    category: "Offene Stellen",
    pdf: "https://www.iem.ch/download/pictures/0b/8jyg8vy6r4gvtzg4q5peawwbhqqb8w/stelleninserat_projektleiter_sanitaer.pdf",
    detail: {
      titel: "Projektleiter Sanitär (m / w / d)",
      einstieg:
        "Per sofort oder nach Vereinbarung motivierter und erfahrener Projektleiter Sanitär (m / w / d) 80 – 100 % zur Verstärkung unseres Teams in Thun und Bern gesucht!",
      aufgaben: [
        "Bearbeitung und Leitung von Projekten im Fachgebiet Sanitärtechnik in allen Phasen (SIA)",
        "Verantwortung für Budget, Zeitpläne und die technische Ausführung",
        "Beratung von Bauherren und Kunden",
        "Übernahme der Fachbauleitung und Umsetzung von Entwürfen und Projektbeschrieben",
      ],
      profil: [
        "Abgeschlossene Ausbildung als Gebäudetechnikplaner/in Fachrichtung Sanitär, allenfalls mit Weiterbildung Techniker/in HF",
        "Mehrjährige Berufserfahrung, idealerweise in einer leitenden Position",
        "Sicherer Umgang mit CAD-Software (NOVA) und den Office-Programmen",
        "Hohes Verantwortungsbewusstsein und Engagement",
        "Unternehmerisches Denken und Handeln",
        "Ausgeprägte Team- und Kommunikationsfähigkeiten",
      ],
      bieten: [gesamtplanungen, ...bietenBasis, aufstieg],
      kontakt: { name: "Kevin von Dach", telefon: "033 227 40 30" },
    },
  },
  {
    id: "heizungsplaner",
    role: "Heizungsplaner:in",
    pensum: "60–100%",
    place: "Thun oder Bern",
    image: "/img/jobs/heizung-2.jpg",
    category: "Offene Stellen",
    pdf: "https://www.iem.ch/download/pictures/2a/xem2btrx0ipd5i1cgfc9pfzawz8rt2/stelleninserat_heizungsplaner.pdf",
    detail: {
      titel: "Heizungsplaner (m / w / d)",
      einstieg:
        "Per sofort oder nach Vereinbarung motivierter und erfahrener Heizungsplaner (m / w / d) 60 – 100 % zur Verstärkung unseres Teams in Thun oder Bern gesucht!",
      aufgaben: [
        "Planung und Projektierung von Heizungsanlagen in den Bereichen Industrie-, Gewerbe- und Wohnbau",
        "Erstellung von Schemas, Grundrissplänen und Detailzeichnungen mittels CAD-Software",
        "Berechnung von Dimensionierungen, Materialbedarf und Leistungswerten",
        "Zusammenarbeit und Abstimmung mit Architekten, Bauherren und anderen Gewerken",
        "Durchführung von Kosten- und Materialkalkulationen",
        "Unterstützung bei der Erstellung von Ausschreibungsunterlagen und Angeboten",
        "Betreuung und Koordination der Projekte von der Konzeptphase bis zur Inbetriebnahme",
      ],
      profil: [
        "Abgeschlossene Ausbildung als Gebäudetechnikplaner Heizung EFZ oder eine vergleichbare Qualifikation",
        "Mehrjährige Berufserfahrung in der Planung von Heizungsanlagen, idealerweise im Schweizer Bauwesen",
        "Sicherer Umgang mit CAD-Software (NOVA)",
        "Fundierte Kenntnisse der relevanten Normen und Vorschriften",
        "Selbstständige und strukturierte Arbeitsweise",
        "Teamfähigkeit und Kommunikationsstärke",
        "Gute Deutschkenntnisse in Wort und Schrift",
      ],
      bieten: [gesamtplanungen, ...bietenBasis],
      kontakt: { name: "Kevin von Dach", telefon: "033 227 40 20" },
    },
  },
  {
    id: "lueftungsplaner",
    role: "Lüftungsplaner:in",
    pensum: "60–100%",
    place: "Thun",
    image: "/img/jobs/lueftung-2.jpg",
    category: "Offene Stellen",
    pdf: "https://www.iem.ch/download/pictures/d0/ltle1v7001x3l9renodg0k8n5d5m0e/stelleninserat_lueftungsplaner.pdf",
    detail: {
      titel: "Lüftungsplaner (m / w / d)",
      einstieg:
        "Per sofort oder nach Vereinbarung motivierter und erfahrener Lüftungsplaner (m / w / d) 60 – 100 % zur Verstärkung unseres Teams in Thun und Bern gesucht!",
      aufgaben: [
        "Planung und Projektierung von Lüftungsanlagen in den Bereichen Industrie-, Gewerbe- und Wohnbau",
        "Erstellung von Schemas, Grundrissplänen und Detailzeichnungen mittels CAD-Software",
        "Berechnung von Dimensionierungen, Materialbedarf und Leistungswerten",
        "Zusammenarbeit und Abstimmung mit Architekten, Bauherren und anderen Gewerken",
        "Durchführung von Kosten- und Materialkalkulationen",
        "Unterstützung bei der Erstellung von Ausschreibungsunterlagen und Angeboten",
        "Betreuung und Koordination der Projekte von der Konzeptphase bis zur Inbetriebnahme",
      ],
      profil: [
        "Abgeschlossene Ausbildung als Gebäudetechnikplaner Lüftung EFZ oder eine vergleichbare Qualifikation",
        "Mehrjährige Berufserfahrung in der Planung von Lüftungsanlagen, idealerweise im Schweizer Bauwesen",
        "Sicherer Umgang mit CAD-Software (NOVA)",
        "Fundierte Kenntnisse der relevanten Normen und Vorschriften",
        "Selbstständige und strukturierte Arbeitsweise",
        "Teamfähigkeit und Kommunikationsstärke",
        "Gute Deutschkenntnisse in Wort und Schrift",
      ],
      bieten: [gesamtplanungen, ...bietenBasis],
      kontakt: { name: "Kevin von Dach", telefon: "033 227 40 20" },
    },
  },
  {
    id: "sanitaerplaner",
    role: "Sanitärplaner:in",
    pensum: "60–100%",
    place: "Thun oder Bern",
    image: "/img/jobs/sanitaer-2.jpg",
    category: "Offene Stellen",
    pdf: "https://www.iem.ch/download/pictures/61/ghw0rtq81fq5hem7ohkwguo88pyslv/stelleninserat_sanitaerplaner.pdf",
    detail: {
      titel: "Sanitärplaner (m / w / d)",
      einstieg:
        "Per sofort oder nach Vereinbarung motivierter und erfahrener Sanitärplaner (m / w / d) 60 – 100 % zur Verstärkung unseres Teams in Thun und Bern gesucht!",
      aufgaben: [
        "Planung und Projektierung von Sanitäranlagen in den Bereichen Industrie-, Gewerbe- und Wohnbau",
        "Erstellung von Schemas, Grundrissplänen und Detailzeichnungen mittels CAD-Software",
        "Berechnung von Dimensionierungen, Materialbedarf und Leistungswerten",
        "Zusammenarbeit und Abstimmung mit Architekten, Bauherren und anderen Gewerken",
        "Durchführung von Kosten- und Materialkalkulationen",
        "Unterstützung bei der Erstellung von Ausschreibungsunterlagen und Angeboten",
        "Betreuung und Koordination der Projekte von der Konzeptphase bis zur Inbetriebnahme",
      ],
      profil: [
        "Abgeschlossene Ausbildung als Gebäudetechnikplaner Sanitär EFZ oder eine vergleichbare Qualifikation",
        "Mehrjährige Berufserfahrung in der Planung von Sanitäranlagen, idealerweise im Schweizer Bauwesen",
        "Sicherer Umgang mit CAD-Software (NOVA)",
        "Fundierte Kenntnisse der relevanten Normen und Vorschriften",
        "Selbstständige und strukturierte Arbeitsweise",
        "Teamfähigkeit und Kommunikationsstärke",
        "Gute Deutschkenntnisse in Wort und Schrift",
      ],
      bieten: [gesamtplanungen, ...bietenBasis],
      kontakt: { name: "Kevin von Dach", telefon: "033 227 40 20" },
    },
  },
];

/**
 * Six slots, because a seventh overflows the header at tablet widths. `#ablauf`
 * gave up its slot to `#ueber-uns` — it is the section a visitor is least
 * likely to arrive looking for by name, and it still sits directly under
 * Dienstleistungen in the page flow, where it is read rather than navigated to.
 * The footer keeps a link to it so it is not reachable by scrolling alone.
 */
export const navItems = [
  { label: "Dienstleistungen", href: "#leistungen" },
  { label: "Referenzen", href: "#referenzen" },
  { label: "Über uns", href: "#ueber-uns" },
  { label: "Team", href: "#team" },
  { label: "Standorte", href: "#standorte" },
  { label: "Karriere", href: "#karriere" },
];

/**
 * The full roster as published on iem.ch/team — 41 people, which matches the
 * "41 Mitarbeitende inkl. Lernende" figure on iem.ch/ueber-uns.
 *
 * Names and photo pairings were taken from the `alt`/`title` attributes on that
 * page, not guessed from filenames.
 *
 * `photo: null` means the site shows its silhouette placeholder for that person.
 * We render initials instead: a generic stock silhouette reads worse than an
 * honest monogram, and it keeps the grid rhythm intact.
 */
export type Member = {
  name: string;
  office: "Thun" | "Bern" | null;
  /**
   * Published function. **Recorded, but no longer shown anywhere on the page** —
   * the client asked for every personal function to come off the team section,
   * the Geschäftsleitung's three included. `TeamGrid` and the site search both
   * ignore this field; a card carries name and office only.
   *
   * It is kept rather than deleted because the three values that came from
   * iem.ch/team (Geschäftsführer, the two Standortleiter) are sourced facts and
   * cheap to hold. Everything else here came from IEM internally and cannot be
   * checked against the public site, so the old rule still stands if the labels
   * ever come back: **never guess a function for a real, named person.**
   */
  role?: string;
  /**
   * Geschäftsleitung — drives the split in `TeamGrid`.
   *
   * Deliberately separate from `role`, and now the *only* thing that can drive
   * that split, since no function is rendered. The split used to key off "has a
   * role", which silently meant that giving anyone else a function moved them
   * into the leadership block and emptied the roster.
   */
  lead?: boolean;
  /**
   * Fachgruppe — drives the grouping dropdown in `TeamGrid`.
   *
   * Same rule as `role`, and for the same reason: which group a person works in
   * is an unverifiable claim about a real, named individual, so it is only ever
   * filled in from what IEM states — never inferred from a name, an office or a
   * photo. iem.ch publishes no group assignment, so every value below came from
   * IEM directly.
   *
   * Unset is fine. `TeamGrid` collects the unassigned into a "Weitere" section.
   */
  group?: Trade;
  /**
   * Lernende — orthogonal to `group`, never a substitute for it: apprentices
   * hold a trade as well, so this is a flag alongside `group` rather than a
   * value inside it.
   *
   * **Recorded, not published.** Like `role`, this was taken off the page at the
   * client's request — no card prints it, the Fachgruppen dropdown has no
   * "Lernende" option, and neither search box matches on it. Don't wire it back
   * into the UI without asking; the point of removing it was that the roster
   * stops marking out which colleagues are apprentices.
   */
  lernend?: boolean;
  photo: string | null;
};

/**
 * The four Fachgruppen a person belongs to — mutually exclusive, one each.
 * They are also, in this order, the options of the dropdown in `TeamGrid`.
 *
 * There is deliberately **no fifth "Lernende" option.** It is not a trade —
 * every apprentice IEM listed also sits in one — and more to the point the page
 * no longer states anyone's function at all, so it is not a filter either. See
 * `lernend` on `Member`: the flag is still recorded, just never published.
 */
export const trades = ["Admin", "Heizung", "Lüftung", "Sanitär"] as const;

export type Trade = (typeof trades)[number];

export const team: Member[] = [
  // `group` / `lernend` below were supplied by IEM (August 2026), not derived.
  // Christian Hilgenberg is the one person left without a group — he was not on
  // the list, which reads as intended for the Geschäftsführer.
  { name: "Christian Hilgenberg", office: null, lead: true, role: "Geschäftsführer", photo: "/img/team/hilgenberg-christian.jpg" },
  { name: "Sacha Flubacher", office: "Bern", lead: true, role: "Leiter Standort Bern · GL-Mitglied", group: "Heizung", photo: "/img/team/sacha-flubacher.jpg" },
  { name: "Kevin von Dach", office: "Thun", lead: true, role: "Leiter Standort Thun · GL-Mitglied", group: "Lüftung", photo: "/img/team/kevin-von-dach.jpg" },

  { name: "Max Bardakci", office: "Bern", role: "Lüftungsplaner", group: "Lüftung", photo: "/img/team/max-bardakci.jpg" },
  { name: "Valentin Brnic", office: "Bern", role: "Projektleiter Lüftung", group: "Lüftung", photo: "/img/team/brnic-valentin.jpg" },
  { name: "Simon Dällenbach", office: "Bern", group: "Sanitär", photo: "/img/team/simon-dllenbach.jpg" },
  // The published role "Lernende Lüftung" carries both axes — the trade in
  // `group`, the apprenticeship in `lernend`. It is the pattern for the rest.
  { name: "Dilagshan Krishnamoorthy", office: "Bern", role: "Lernende Lüftung", group: "Lüftung", lernend: true, photo: "/img/team/krishnamoorthy-dilagshan.jpg" },
  { name: "Noemi Odermatt", office: "Bern", group: "Heizung", lernend: true, photo: "/img/team/noemi-odermatt.jpg" },
  { name: "Nayana Oester", office: "Bern", group: "Heizung", photo: "/img/team/oester-nayana.jpg" },
  { name: "Pedro Pereira", office: "Bern", group: "Sanitär", lernend: true, photo: "/img/team/pereira-pedro.jpg" },
  { name: "Javad Qasemi", office: "Bern", group: "Heizung", lernend: true, photo: "/img/team/qasemi-javad.jpg" },
  { name: "Priska Rugiano", office: "Bern", group: "Sanitär", photo: "/img/team/rugiano-priska.jpg" },
  { name: "Dylan Schommer", office: "Bern", group: "Lüftung", photo: "/img/team/dylan-schommer.jpg" },
  { name: "Lionel Seli", office: "Bern", group: "Sanitär", lernend: true, photo: "/img/team/lionel-seli.jpg" },
  { name: "Valentina Simic", office: "Bern", group: "Lüftung", lernend: true, photo: null },
  { name: "Artan Strikcani", office: "Bern", group: "Heizung", photo: "/img/team/artan-strikcani.jpg" },
  { name: "René Wyss", office: "Bern", group: "Sanitär", photo: "/img/team/wyss-rene.jpg" },
  { name: "Arlinda Zejnaj", office: "Bern", group: "Sanitär", lernend: true, photo: "/img/team/zejnaj-arlinda.jpg" },
  { name: "Ken Zurflüh", office: "Bern", group: "Heizung", photo: "/img/team/ken-zurflh.jpg" },

  { name: "Nico Baumgartner", office: "Thun", group: "Heizung", photo: "/img/team/nico-baumgartner.jpg" },
  { name: "Finn Borter", office: "Thun", group: "Heizung", photo: "/img/team/borter-finn.jpg" },
  { name: "Kastriot Colaj", office: "Thun", group: "Heizung", photo: "/img/team/colaj-kastriot-2026-2.jpg" },
  { name: "Ilir Destani", office: "Thun", group: "Heizung", photo: "/img/team/destani-ilir-2026.jpg" },
  { name: "Seraina Grossen", office: "Thun", group: "Admin", photo: "/img/team/grossen-seraina.jpg" },
  { name: "Andreas Huber", office: "Thun", group: "Heizung", photo: "/img/team/huber-aendu.jpg" },
  { name: "Rolf Linder", office: "Thun", group: "Sanitär", photo: "/img/team/rolf-linder.jpg" },
  { name: "Ricardo Luginbühl", office: "Thun", group: "Heizung", lernend: true, photo: "/img/team/ricardo-luginbuehl.jpg" },
  { name: "Rohullah Mohammadi", office: "Thun", group: "Lüftung", lernend: true, photo: "/img/team/mohammadi-rohullah-2025.jpg" },
  { name: "Olena Olshevska", office: "Thun", group: "Sanitär", lernend: true, photo: "/img/team/olena-olshevska.jpg" },
  { name: "Ursina Prevost", office: "Thun", group: "Admin", photo: "/img/team/prevost-ursina-2026.jpg" },
  { name: "Stefan Pulfer", office: "Thun", group: "Sanitär", photo: "/img/team/stefan-pulfer.jpg" },
  { name: "Janis Reusser", office: "Thun", group: "Heizung", photo: "/img/team/reusser-janis.jpg" },
  { name: "Jan Reuter", office: "Thun", group: "Lüftung", photo: "/img/team/jan-reuter.jpg" },
  { name: "Yosef Shonora", office: "Thun", group: "Sanitär", photo: "/img/team/shonora-yosef.jpg" },
  { name: "Joel Soder", office: "Thun", group: "Sanitär", photo: "/img/team/joel-soder.jpg" },
  { name: "Miriam Soricelli", office: "Thun", group: "Lüftung", photo: "/img/team/soricelli-miriam-2025.jpg" },
  { name: "Emir Sylejmani", office: "Thun", group: "Heizung", lernend: true, photo: "/img/team/emir-sylejmani.jpg" },
  { name: "Colin Tschudin", office: "Thun", group: "Heizung", photo: "/img/team/colin-tschudin.jpg" },
  { name: "Sina Vopat", office: "Thun", group: "Lüftung", lernend: true, photo: "/img/team/vopat-sina.jpg" },
  { name: "Jenny Wenger", office: "Thun", group: "Admin", photo: "/img/team/jenny-wenger.jpg" },
  { name: "Marc Wittwer", office: "Thun", group: "Sanitär", photo: "/img/team/wittwer-marc.jpg" },
];

/**
 * Sponsorships listed on iem.ch/ueber-uns. Captions come from the image alt text.
 * `fit: "contain"` marks the entries whose asset is a wide club logo rather than
 * a photo — cropping those to a portrait box cuts the wordmark in half.
 */
export const sponsorships: {
  name: string;
  detail: string;
  photo: string;
  fit?: "cover" | "contain";
}[] = [
  { name: "Colin Tschudin", detail: "Eishockey · HC Beo Yetis Unterseen", photo: "/img/about/tsco.jpg" },
  { name: "Janis Reusser", detail: "Unihockey · UHC Thun", photo: "/img/about/janis-reusser.png" },
  { name: "Patrick von Känel", detail: "Gleitschirmpilot", photo: "/img/about/patrick-von-kaenel.jpg" },
  { name: "Sepp Inniger", detail: "Gleitschirm-Testpilot", photo: "/img/about/sepp-inniger.jpg" },
  {
    name: "Tennisclub Heimberg",
    detail: "Vereinssponsoring",
    photo: "/img/about/tennisclub-heimberg.jpg",
    fit: "contain",
  },
];

/** Company facts from iem.ch/ueber-uns. Update the year alongside `founded`. */
export const facts = {
  founded: 1994,
  foundedLong: "7. Juli 1994",
  bernSince: 2006,
  headcount: 41,
  insuranceCover: "CHF 10 Mio.",
  insurer: "Helvetia",
  memberships: ["Suissetec", "IAKS"],
  legalForm: "Aktiengesellschaft",
  ownership: "Zu 100% im Besitz der Geschäftsleitung",
  vatId: "CHE-107.625.851 MWST",
};

/**
 * The "Fakten über IEM" table from iem.ch/ueber-uns, every row published there.
 *
 * Derived from `facts` rather than typed out, so the roster count and the
 * founding date cannot drift away from the values the hero and the team grid
 * compute from. It lives here rather than in the component because the site
 * search indexes it too — "Suissetec" and "MWST" have to find their way to the
 * section that answers them.
 */
export const companyFacts: { label: string; value: string }[] = [
  { label: "Rechtsform", value: facts.legalForm },
  { label: "Aktien", value: facts.ownership },
  { label: "Gründung", value: `${facts.foundedLong}, als Aktiengesellschaft` },
  { label: "Team", value: `${facts.headcount} Mitarbeitende, inkl. Auszubildende` },
  { label: "Mitgliedschaften", value: facts.memberships.join(" und ") },
  { label: "Betriebshaftpflicht", value: `${facts.insurer}, Deckung ${facts.insuranceCover}` },
  { label: "MwSt-Nr.", value: facts.vatId },
];

/**
 * The Leitbild from iem.ch/ueber-uns — **verbatim**, headings included. These
 * are the client's own words about themselves, which is the one kind of copy on
 * this page that must not be rewritten, tightened or translated: a reworded
 * value statement is a claim IEM never made. If the wording on the site
 * changes, replace the string; don't edit it here.
 *
 * The headings are set upper-case on iem.ch. They are stored in their natural
 * case and upper-cased by the `.eyebrow` class in the component, so the data
 * stays readable and the styling stays in CSS.
 */
export const leitbild = [
  {
    title: "Qualität und Kompetenz",
    body: "Wir sind professionell und pflegen hohe Qualitätsansprüche – an uns selbst wie auch an die Partner, die mit uns Projekte realisieren.",
  },
  {
    title: "Lösungsorientiert und fachübergreifend",
    body: "Als unabhängiger und zuverlässiger Partner nutzen wir unser umfangreiches Wissen aus allen Fachbereichen für kundenspezifische und wirtschaftlich optimale Lösungen.",
  },
  {
    title: "Dynamisch in die Zukunft",
    body: "Unser Team ist auf dem neusten Stand und gut ausgebildet, damit nutzen wir jederzeit aktuelles Fachwissen.",
  },
  {
    title: "Potentiale nutzen",
    body: "Pioniergeist innerhalb von Projekten ist uns ebenso wichtig, wie solides Handwerk.",
  },
];
