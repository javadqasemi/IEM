/*
 * GENERIERT von cad/build_scene_ifc.py — nicht von Hand ändern.
 *
 * Die 3D-Szene in #ablauf, gebaut aus dem Fachmodell zum Projekt Guglera,
 * Giffers: ifc/4723_Architektur.ifc, ifc/4723_Heizung.ifc,
 * ifc/4723_Lüftung.ifc. Neu erzeugen mit:
 *
 *   python cad/build_scene_ifc.py
 *
 * Koordinaten in three.js-Konvention (y = oben), in x/z auf die Gebäudemitte
 * gerückt, y ist die echte Höhe über IFC-Null. Meter.
 *
 * Die Geometrie selbst steht in scene_guglera.json **daneben**, nicht hier,
 * und wird per fetch geholt. Das ist keine Stilfrage: als Modul eingebunden
 * sind die 62'000 Zahlen ebenso viele Knoten im Bundler-AST, und der Build
 * dauert 18 Minuten statt 20 Sekunden — auch dann noch, wenn sie als
 * JSON.parse("…") dastehen. Über `?url` sieht Vite eine Ressource, hängt ihr
 * einen Inhalts-Hash an und kopiert sie; geladen wird sie erst, wenn der
 * Abschnitt in Sichtweite kommt.
 */

import modellUrl from "./scene_guglera.json?url";

export type Vec3 = [number, number, number];

export type Modell = {
  quelle: string[];
  bauwerk: {
    min: Vec3;
    max: Vec3;
    breite: number;
    tiefe: number;
    hoehe: number;
    /** Geschosskoten aus den IfcBuildingStorey, echte Höhen. */
    geschosse: number[];
  };
  /** Farbe, Deckkraft und Bauphase je Körperart. */
  kategorien: { id: string; label: string; color: string; opacity: number; phase: string }[];
  /**
   * Medien der Leitungen, Farben wie im Hero-Schnitt. `deckkraft` ist ein
   * Faktor auf die Deckkraft, die der Aufrufer setzt: bei den Medien 1, bei der
   * Dämmung deutlich darunter — sie liegt als Hülle über dem Rohr und würde es
   * sonst zudecken. Die Reihenfolge ist gebunden, `ModelScene` greift für die
   * Stifte auf dem Zeichentisch über feste Indizes zu.
   */
  medien: {
    id: string; label: string; short: string; gewerk: string;
    color: string; deckkraft: number;
  }[];
  KOERPER_STRIDE: number;
  /**
   * Ein Körper je acht Zahlen: Kategorie, Mitte x/y/z, Grösse b/h/t, Drehung
   * um y. Die Grundfläche ist das kleinste umschliessende Rechteck des
   * Bauteils, nicht seine achsparallele Box.
   */
  koerper: number[];
  STRANG_STRIDE: number;
  /**
   * Ein rundes Leitungsstück je acht Zahlen: Medium, von x/y/z, nach x/y/z,
   * Radius. Ein Formstück steht hier als mehrere Stücke: ein Bogen als Zug
   * entlang seiner Krümmung, ein T-Stück als ein Ast je Anschluss. Die Ecke ist
   * der Schnittpunkt der Portachsen, der Krümmungsradius folgt aus der
   * Tangentenlänge — beides gerechnet, nicht geschätzt.
   */
  straenge: number[];
  KANAL_STRIDE: number;
  /**
   * Ein rechteckiges Leitungsstück je zwölf Zahlen: Medium, von x/y/z, nach
   * x/y/z, Breite, Höhe, und die Querachse x/y/z, an der die Breite liegt.
   *
   * Rechteckkanäle sind bewusst keine Zylinder. Als Rohr mit „flächengleichem"
   * Ersatzradius gezeichnet kam ein 500 × 500er auf 39 % seines Querschnitts,
   * und die echte Geometrie lag im Median 0,185 m ausserhalb des gezeichneten
   * Körpers. Die Querachse stammt aus der Portplatzierung, damit der Kanal im
   * Raum so liegt wie im Modell und nicht bloss ungefähr.
   */
  kanaele: number[];
  /**
   * Decken als echtes Dreiecksnetz, je drei Zahlen ein Eckpunkt. Ein Quader
   * über einer Geschossdecke füllt die Schächte und verdeckt damit die
   * Steigstränge — deshalb hier die Ausnahme von der Quaderregel.
   */
  decken: number[];
  /**
   * Die Einzelachsen eines Mediums zu durchgehenden Zügen verkettet, die
   * längsten zuerst. Die Szene zeichnet jedes Bauteil einzeln; für den
   * Durchfluss in Akt drei braucht das Medium eine Strecke zum Entlanglaufen.
   */
  fliesslinien: { medium: number; punkte: Vec3[] }[];
  /** Standpunkte, aus dem Modell abgeleitet. */
  acteurs: { planer: Vec3; installateur: Vec3; nutzer: Vec3 };
  /** Die beiden Zentralen, als Schwerpunkt ihrer Anlagen. */
  zentralen: { name: string; at: Vec3 }[];
  /** Auslegungswerte aus den Property-Sets, an ihrem Ort im Modell. */
  messpunkte: { id: string; value: string; label: string; tone: string; at: Vec3 }[];
  /**
   * Jedes IfcProduct der drei Dateien steht hier — entweder gezeichnet oder
   * mit Grund nicht. Der Generator bricht ab, wenn eine Klasse auftaucht, für
   * die keine Regel hinterlegt ist.
   */
  inventar: {
    /**
     * `n` zählt Bauteile, `teile` die Körper daraus. Für alles ausser
     * Formstücken ist das dasselbe; ein Bogen wird zu mehreren Körpern, ein
     * T-Stück zu einem je Ast. Die Bildunterschrift der Szene nennt Bauteile,
     * also `n` — sonst gäbe sie Rohrstücke als Bauteile aus.
     */
    gezeichnet: { quelle: string; klasse: string; als: string; n: number; teile: number }[];
    nichtGezeichnet: { klasse: string; grund: string; n: number }[];
  };
};

let anfrage: Promise<Modell> | null = null;

/** Lädt das Modell einmal und gibt danach dieselbe Zusage zurück. */
export function ladeModell(): Promise<Modell> {
  anfrage ??= fetch(modellUrl).then((r) => {
    if (!r.ok) throw new Error(`Modell nicht ladbar: ${r.status}`);
    return r.json() as Promise<Modell>;
  });
  return anfrage;
}
