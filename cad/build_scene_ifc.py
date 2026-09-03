"""
Erzeugt die 3D-Szene für `#ablauf` aus dem echten Fachmodell.

    python cad/build_scene_ifc.py

Ergebnis: src/generated/scene_guglera.ts  (generiert, nicht von Hand ändern)

Quelle sind die drei IFC in `ifc/` — Architektur, Heizung, Lüftung zum Projekt
Guglera, Giffers. Damit zeigt der Ablauf dasselbe Gebäude wie der Hero-Schnitt.

Vollständigkeit
---------------
Jedes `IfcProduct` der drei Dateien landet in genau einer Kategorie, und der
Generator **bricht ab**, wenn eine Klasse auftaucht, für die keine Regel
hinterlegt ist. Es gibt also keinen stillen Verlust: was nicht gezeichnet wird,
steht am Ende im Inventar mit Grund. Drei Gründe kommen vor:

* *ohne Geometrie* — das Bauteil führt in der Quelle keine Repräsentation
  (z. B. die 300 T-Stücke der Heizung). Nichts zu zeichnen.
* *Öffnung* — `IfcOpeningElement` ist ein Loch, kein Körper. Es wird durch das
  Fenster oder die Tür dargestellt, die darin sitzt.
* *Struktur* — Projekt, Areal, Gebäude, Geschoss sind Gliederung, kein Bauteil.

Drei Darstellungen
------------------
* **Runde Leitungen** als Achse plus Radius. Ein Rohr *ist* ein Zylinder, das
  ist keine Näherung, sondern die kompaktere Schreibweise derselben Sache.
* **Rechteckige Kanäle** als Quader entlang ihrer Achse, mit Breite, Höhe und
  der Querachse aus der Portplatzierung.
* **Alles andere** als gedrehter Quader aus der kleinsten umschliessenden
  Grundfläche (min-area rect über der konvexen Hülle) und der Höhe. Für
  extrudierte Bauteile — Wände, Fenster, Türen, Geräte — ist das exakt.

Formstücke sind keine Zylinder
------------------------------
Eine frühere Fassung zog durch *jedes* Leitungsbauteil einen Zylinder zwischen
den zwei am weitesten auseinanderliegenden Ports. Das war an vier Stellen
falsch, und zwar messbar:

* **Bögen wurden Sehnen.** 1'691 Formstücke der Heizung sind zu 89 % echte
  90°-Bögen (`Rohrbogen Bauart 2 D 90°`); der Zylinder schnitt die Ecke ab.
* **T-Stücke verloren den Abzweig.** 255 Bauteile führen drei oder vier Ports;
  die zwei entferntesten sind der Durchgang, der dritte Ast fiel weg.
* **Rechteckkanäle wurden Rohre** mit `hypot(s1, s2) / 4` als Radius,
  kommentiert als „flächengleich". Ein 500 × 500er kam damit auf 98'400 mm²
  statt 250'000 — 39 %. Gemessen lag die echte Geometrie der Lüftungsformstücke
  im Median 0,185 m ausserhalb des gezeichneten Körpers, im Extrem 0,889 m.
* **2'110 Formstücke bekamen 30 mm Notradius**, weil der Leser nur
  `Tech-Outside-diameter` kannte. Die Weite steht dort unter `Tech-DN`
  beziehungsweise `Tech-DN1/2/3`. Sie war da, sie wurde nicht gelesen.

Jetzt trägt jeder `IfcDistributionPort` seine Richtung bei (die lokale z-Achse
seiner Platzierung), und die Achsen aller Anschlüsse eines Formstücks schneiden
sich in dessen Mitte. Von dort zieht jeder Anschluss seinen eigenen Ast; bei
zwei Anschlüssen wird daraus der Bogen, dessen Krümmungsradius aus der
Tangentenlänge folgt. Wie fein er zerlegt wird, hängt an seiner Grösse — ein
DN-15-Bogen misst zwei Zentimeter und bleibt ein Knick, ein 700er-Lüftungsbogen
bekommt seine Rundung.

Die Weite eines Formstücks erbt über `IfcRelConnectsPorts` vom Rohr, das dort
ansetzt. Damit bekommt auch das reduzierte T-Stück je Ast die Weite, die dort
wirklich angeschlossen ist, statt einer für alle drei.

**Ausnahme Decken.** Die kommen als echtes Dreiecksnetz. Ein Quader über einer
Geschossdecke füllt die Schächte, und dann verschwinden genau die Steigstränge,
wegen derer die Szene existiert. 18 Decken sind rund 450 Dreiecke — billig.

Grösse
------
Die Daten sind rund 430 KB, gezippt gut 85. `ModelScene` lädt das Modul deshalb
per `await import()` zusammen mit three.js, damit es nicht im Haupt-Bundle
liegt. Zahlen werden auf den Millimeter gerundet und als flache Zahlenfelder
geschrieben, nicht als Objekte — ein Objekt je Körper wäre dreimal so gross.

**Die grossen Felder stehen als `JSON.parse("[…]")` in der Datei, nicht als
Array-Literal.** Das ist kein Stil, sondern eine Notwendigkeit: 62'000 Zahlen
als Literal sind 62'000 AST-Knoten, die Rollup einzeln durchgeht — der Build
lief damit **18 Minuten** statt 20 Sekunden. Als String sieht der Bundler einen
Knoten, und `JSON.parse` ist auch zur Laufzeit schneller als ein Literal
derselben Grösse. Nicht zurückbauen.
"""

from __future__ import annotations

import collections
import math
import pathlib

import numpy as np

import ifc_schnitt as IS

GEN = pathlib.Path(__file__).parent.parent / "src" / "generated"
TS = GEN / "scene_guglera.ts"          # Typen und Lader
JSON_DATEI = GEN / "scene_guglera.json"  # die Geometrie

# --- Medien --------------------------------------------------------------
# IFC-System -> Anzeige. Farben sind die Gewerkfarben aus tailwind.config.ts,
# Vor- und Rücklauf und Zu- und Abluft je zwei Töne derselben Familie, wie in
# MEDIEN in model.py.
#
# Die Reihenfolge ist gebunden: `ModelScene` greift für die Stifte auf dem
# Zeichentisch über feste Indizes zu. Neues hinten anhängen, nichts einschieben.
#
# Das sechste Feld ist ein Deckkraftfaktor. Er steht auf 1.0, ausser bei der
# Dämmung: die umhüllt das Rohr und würde es sonst zudecken.
MEDIEN = [
    ("heizwasser_vl", "Heizwasser Vorlauf", "Vorlauf", "Heizung", "#ff0000", 1.0),
    ("heizwasser_rl", "Heizwasser Rücklauf", "Rücklauf", "Heizung", "#0000ff", 1.0),
    ("heizwasser_vl_best", "Vorlauf Bestand", "Vorlauf Bestand", "Heizung", "#000000", 1.0),
    ("heizwasser_rl_best", "Rücklauf Bestand", "Rücklauf Bestand", "Heizung", "#000000", 1.0),
    ("kaltwasser_vl", "Kaltwasser Vorlauf", "Kaltwasser VL", "Sanitär", "#00ffff", 1.0),
    ("kaltwasser_rl", "Kaltwasser Rücklauf", "Kaltwasser RL", "Sanitär", "#6600cc", 1.0),
    ("zuluft", "Zuluft", "Zuluft", "Lüftung", "#ff0000", 1.0),
    ("abluft", "Abluft", "Abluft", "Lüftung", "#ffcc00", 1.0),
    ("aussenluft", "Aussenluft", "Aussenluft", "Lüftung", "#66ff33", 1.0),
    ("fortluft", "Fortluft", "Fortluft", "Lüftung", "#993300", 1.0),
    ("unbekannt", "ohne Systemzuordnung", "übrige", "—", "#9aa4b4", 1.0),
    # Die Dämmung ist im IFC ein eigener Körper und macht den sichtbaren
    # Durchmesser aus: 723 Heizungs- und 305 Lüftungsbauteile tragen 20 bis
    # 100 mm, im Median das Dreifache des blanken Rohrs, im Extrem das
    # 5,5-fache. Ohne sie sind die Leitungen im Bild schlicht zu dünn.
    #
    # Im IFC trägt der Dämmkörper dieselbe Farbe wie sein Rohr. Hier ist er
    # neutral grau — sonst bräuchte es je Medium einen zweiten Eintrag und die
    # Legende hätte zwanzig Felder. Das ist die eine bewusste Abweichung von
    # der Modellpalette; alles andere darüber steht so in der Quelle.
    ("daemmung", "Dämmung", "Dämmung", "—", "#c4c9d2", 0.30),
]
MEDIUM_INDEX = {m[0]: i for i, m in enumerate(MEDIEN)}

# IFC-Systemname -> Medium. Bewusst hier und nicht in `IS.SYSTEME`: dort fasst
# die Tabelle Bestand mit Neubau und Aussen- mit Zuluft zusammen, und daran
# hängt der Hero-Schnitt. Diese Szene trennt, was das Modell trennt.
SYSTEM_ZU_MEDIUM = {
    "Vorlauf": "heizwasser_vl",
    "Rücklauf": "heizwasser_rl",
    "Vorlauf bestehend": "heizwasser_vl_best",
    "Rücklauf bestehend": "heizwasser_rl_best",
    "Kaltwasser VL": "kaltwasser_vl",
    "Kaltwasser RL": "kaltwasser_rl",
    "Zuluft": "zuluft",
    "Abluft": "abluft",
    "Außenluft": "aussenluft",
    "Fortluft": "fortluft",
}

# --- Kategorien der Körper ----------------------------------------------
KATEGORIEN = [
    ("wand", "Wand", "#dfe5ee", 1.0, "roh"),
    ("decke", "Decke", "#e7ebf2", 1.0, "roh"),
    ("fenster", "Fenster", "#9fc4d8", 0.35, "ausbau"),
    ("tuer", "Tür", "#b9c2d1", 0.9, "ausbau"),
    ("raum", "Raum", "#ffffff", 0.06, "raum"),
    ("heizkoerper", "Heizkörper", "#eef1f6", 1.0, "technik"),
    ("luftauslass", "Luftdurchlass", "#eef1f6", 1.0, "technik"),
    ("geraet", "Lüftungsgerät", "#e6e9f0", 1.0, "technik"),
    ("speicher", "Speicher / Verteiler", "#e6e9f0", 1.0, "technik"),
    ("armatur", "Armatur", "#cbb87f", 1.0, "technik"),
    ("zubehoer", "Zubehör", "#c9d2df", 0.8, "zubehoer"),
]
KAT_INDEX = {k[0]: i for i, k in enumerate(KATEGORIEN)}

# --- Abbildung IFC-Klasse -> Darstellung ---------------------------------
# "rohr"      Achse + Radius
# "<kat>"     gedrehter Quader dieser Kategorie
# "netz"      echtes Dreiecksnetz
# "-<grund>"  wird nicht gezeichnet, mit Begründung fürs Inventar
REGELN = {
    "IfcWallStandardCase": "wand",
    "IfcWall": "wand",
    "IfcSlab": "netz",
    "IfcWindow": "fenster",
    "IfcDoor": "tuer",
    "IfcSpace": "raum",
    "IfcSpaceHeater": "heizkoerper",
    "IfcAirTerminal": "luftauslass",
    "IfcUnitaryEquipment": "geraet",
    "IfcTank": "speicher",
    "IfcDistributionFlowElement": "speicher",
    "IfcPipeSegment": "rohr",
    "IfcPipeFitting": "rohr",
    "IfcDuctSegment": "rohr",
    "IfcDuctFitting": "rohr",
    "IfcDuctSilencer": "rohr",
    "IfcDamper": "rohr",
    "IfcValve": "armatur",
    "IfcProxy": "zubehoer",
    "IfcBuildingElementProxy": "zubehoer",
    "IfcVirtualElement": "-Platzhalter ohne Körper",
    "IfcOpeningElement": "-Öffnung, dargestellt durch Fenster oder Tür darin",
    "IfcSite": "-Struktur, kein Bauteil",
    "IfcBuilding": "-Struktur, kein Bauteil",
    "IfcBuildingStorey": "-Struktur, kein Bauteil",
    "IfcDistributionPort": "-Anschlusspunkt, kein Bauteil",
}

QUELLEN = [("Architektur", IS.ARCHITEKTUR), ("Heizung", IS.HEIZUNG), ("Lüftung", IS.LUEFTUNG)]


# ---------------------------------------------------------------------------
# Geometriehilfen
# ---------------------------------------------------------------------------

def konvexe_huelle(pts: np.ndarray) -> np.ndarray:
    """Andrew's monotone chain, gegen den Uhrzeigersinn."""
    p = np.unique(np.round(pts, 4), axis=0)
    if len(p) < 3:
        return p
    p = p[np.lexsort((p[:, 1], p[:, 0]))]

    def halb(punkte):
        stack: list[np.ndarray] = []
        for q in punkte:
            while len(stack) >= 2:
                a, b = stack[-2], stack[-1]
                if (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) > 1e-12:
                    break
                stack.pop()
            stack.append(q)
        return stack

    return np.array(halb(p)[:-1] + halb(p[::-1])[:-1])


def achse_aus_netz(v: np.ndarray):
    """Achse und Radius eines Rohr- oder Kanalstücks aus seinem Netz.

    Rund ein Sechstel der Leitungsbauteile führt nur *einen*
    `IfcDistributionPort` — Endstücke, angeschnittene Bögen, Bauteile, die der
    Planer nicht durchverbunden hat. Ohne Achse fielen sie aus der
    Leitungsdarstellung heraus und lägen als namenlose Kästchen in der Szene.

    Ein Rohr ist ein Zylinder, also ist seine Achse die erste Hauptachse der
    Punktwolke: die Richtung mit der grössten Streuung. Die Enden sind die
    Extremwerte der Projektion darauf, der Radius die halbe Streubreite quer
    dazu.
    """
    mitte = v.mean(0)
    zentriert = v - mitte
    # Kovarianz ist 3x3, das kostet nichts.
    _w, vek = np.linalg.eigh(zentriert.T @ zentriert)
    achse = vek[:, -1]
    t = zentriert @ achse
    quer = zentriert - np.outer(t, achse)
    radius = float(np.linalg.norm(quer, axis=1).max())
    return mitte + achse * t.min(), mitte + achse * t.max(), radius


def zentrum_der_achsen(pts, richtungen):
    """Der Punkt, der allen Portachsen am nächsten liegt — die Ecke.

    Ein Formstück ist kein Zylinder zwischen seinen äussersten Anschlüssen. Ein
    Bogen knickt, ein T-Stück verzweigt. Jeder `IfcDistributionPort` trägt neben
    seiner Lage auch seine Richtung (die lokale z-Achse seiner Platzierung), und
    die Achsen aller Anschlüsse eines Formstücks schneiden sich in genau einem
    Punkt: dem Mittelpunkt des Bauteils. Von dort zieht jeder Anschluss seinen
    eigenen Ast — und der Abzweig eines T-Stücks geht nicht mehr verloren.

    Kleinste Quadrate über die Abstände zu allen Achsen. Sind die Achsen
    parallel — ein gerades Übergangsstück etwa —, ist das Gleichungssystem
    singulär; dann gibt es keine Ecke und der Aufrufer zieht eine Gerade.
    """
    A = np.zeros((3, 3))
    b = np.zeros(3)
    n_gueltig = 0
    for p, d in zip(pts, richtungen):
        if d is None:
            continue
        laenge = float(np.linalg.norm(d))
        if laenge < 1e-9:
            continue
        e = np.asarray(d, float) / laenge
        P = np.eye(3) - np.outer(e, e)   # projiziert quer zur Achse
        A += P
        b += P @ np.asarray(p, float)
        n_gueltig += 1
    if n_gueltig < 2:
        return None
    w = np.linalg.eigvalsh(A)
    # Parallele Achsen lassen die kleinste Eigenrichtung zusammenfallen.
    if w[-1] < 1e-9 or w[0] / w[-1] < 1e-6:
        return None
    try:
        return np.linalg.solve(A, b)
    except np.linalg.LinAlgError:
        return None


def bogen(ecke, p0, p1, stuecke):
    """Punktzug entlang des echten Bogens statt über die Ecke.

    Die beiden Anschlüsse eines Bogens sind seine Tangentenpunkte: dort geht das
    gerade Rohr in die Krümmung über. Mit der Tangentenlänge t und dem Winkel ψ
    zwischen den Schenkeln folgt der Krümmungsradius R = t·tan(ψ/2), und der
    Mittelpunkt des Kreises liegt auf der Winkelhalbierenden im Abstand
    R/sin(ψ/2). Damit ist der Bogen nicht geschätzt, sondern aus den Daten
    gerechnet, die das Modell ohnehin führt.

    Rückgabe: Punktfolge von p0 nach p1. Bei einem gestreckten oder entarteten
    Fall kommt None, dann genügt dem Aufrufer die Gerade.
    """
    u0, u1 = np.asarray(p0, float) - ecke, np.asarray(p1, float) - ecke
    t0, t1 = float(np.linalg.norm(u0)), float(np.linalg.norm(u1))
    if t0 < 1e-6 or t1 < 1e-6:
        return None
    u0, u1 = u0 / t0, u1 / t1
    cos_psi = float(np.clip(np.dot(u0, u1), -1.0, 1.0))
    psi = math.acos(cos_psi)
    # Gestreckt (ψ→180°) heisst gerade; spitz (ψ→0°) heisst entartet.
    if psi > math.radians(174) or psi < math.radians(6):
        return None
    t = min(t0, t1)
    halb = psi / 2
    R = t * math.tan(halb)
    m = u0 + u1
    if float(np.linalg.norm(m)) < 1e-9:
        return None
    m = m / float(np.linalg.norm(m))
    O = ecke + m * (R / math.sin(halb))
    a0, a1 = ecke + u0 * t, ecke + u1 * t      # Tangentenpunkte
    r0, r1 = a0 - O, a1 - O
    n0 = float(np.linalg.norm(r0))
    if n0 < 1e-9:
        return None
    # Drehachse des Bogens und der überstrichene Winkel.
    achse = np.cross(r0, r1)
    if float(np.linalg.norm(achse)) < 1e-9:
        return None
    achse = achse / float(np.linalg.norm(achse))
    phi = math.acos(float(np.clip(np.dot(r0, r1) / (n0 * float(np.linalg.norm(r1))), -1.0, 1.0)))

    pts = [np.asarray(p0, float)]
    if t0 > t + 1e-6:
        pts.append(a0)
    for k in range(1, stuecke):
        w = phi * k / stuecke
        c, s = math.cos(w), math.sin(w)
        # Rodrigues um `achse`
        gedreht = r0 * c + np.cross(achse, r0) * s + achse * float(np.dot(achse, r0)) * (1 - c)
        pts.append(O + gedreht)
    pts.append(a1)
    if t1 > t + 1e-6:
        pts.append(np.asarray(p1, float))
    return pts


def fehlender_ast(netz, ecke, an, radius):
    """Den nicht modellierten Ast eines T-Stücks aus seinem Netz zurückholen.

    Rund 120 T-Stücke der Heizung führen nur **zwei** `IfcDistributionPort`,
    obwohl `Tech-DN3` drei Weiten nennt. Mit zwei Ports sieht ein T-Stück wie
    ein Bogen aus: zwei Achsen, ein Schnittpunkt. Wer das glaubt, rundet die
    Ecke ab und verliert den Durchgang — der Fehler misst 1,55 Rohrradien.

    Der Durchgang steht aber im Netz. Von der Ecke aus wird jede Gegenrichtung
    der vorhandenen Ports geprüft: reicht der Körper dort deutlich weiter als
    sein eigener Radius, ist das ein Schenkel und kein Rohrende. Zurück kommt
    der Endpunkt des längsten solchen Astes.
    """
    V = netz.reshape(-1, 3)
    rel = V - np.asarray(ecke, float)
    bestes, beste_laenge = None, radius * 1.5
    for a in an:
        u = np.asarray(a["pos"], float) - np.asarray(ecke, float)
        n = float(np.linalg.norm(u))
        if n < 1e-9:
            continue
        gegen = -u / n
        # Nur Richtungen, die nicht schon ein Port belegt.
        if any(float(np.dot(gegen, (np.asarray(b["pos"], float) - ecke) /
                            (np.linalg.norm(np.asarray(b["pos"], float) - ecke) or 1.0))) > 0.9
               for b in an):
            continue
        laengs = rel @ gegen
        quer = np.linalg.norm(rel - np.outer(laengs, gegen), axis=1)
        # Nur Punkte im Schlauch um die Achse zählen, sonst misst die
        # gegenüberliegende Rohrwand mit.
        im_schlauch = laengs[quer <= radius * 1.4]
        if not len(im_schlauch):
            continue
        weite = float(im_schlauch.max())
        if weite > beste_laenge:
            bestes, beste_laenge = np.asarray(ecke, float) + gegen * weite, weite
    return bestes


def abzweig_aus_netz(netz, p0, p1, radius):
    """Den Abzweig eines T-Stücks finden, dessen Ports alle in einer Linie liegen.

    115 T-Stücke der Heizung führen nur Ports des Durchgangs. Ihre Achsen sind
    parallel, es gibt also keinen Schnittpunkt und damit keine Ecke — das
    Bauteil wird zum geraden Rohr, und der Abzweig, um den es geht, fehlt.

    Er steht aber im Netz: alles, was weiter als der Rohrradius von der
    Durchgangsachse absteht, gehört zum Abzweig. Aus diesen Punkten kommen
    Richtung, Ansatzpunkt und Länge. Zurück kommt (ansatz, ende) oder None.
    """
    V = netz.reshape(-1, 3)
    a = np.asarray(p0, float)
    achse = np.asarray(p1, float) - a
    L = float(np.linalg.norm(achse))
    if L < 1e-9:
        return None
    achse = achse / L
    rel = V - a
    laengs = rel @ achse
    quer = rel - np.outer(laengs, achse)
    abstand = np.linalg.norm(quer, axis=1)

    aussen = abstand > radius * 1.35
    if aussen.sum() < 4:
        return None
    richtung = quer[aussen].mean(0)
    n = float(np.linalg.norm(richtung))
    if n < radius * 0.3:
        # Ringsum verteilt: das ist eine Muffe oder ein Flansch, kein Abzweig.
        return None
    richtung = richtung / n
    # Nur die Punkte, die wirklich in diese Richtung stehen — nicht die
    # gegenüberliegende Rohrwand, die zufällig auch aussen liegt.
    passt = aussen & ((quer @ richtung) > radius * 0.9)
    if passt.sum() < 4:
        return None
    ansatz = a + achse * float(laengs[passt].mean())
    weite = float((quer[passt] @ richtung).max())
    if weite < radius * 1.5:
        return None
    return ansatz, ansatz + richtung * weite


def bogenstuecke(radius, winkel_grad):
    """Wie fein ein Bogen zerlegt wird — nach seiner sichtbaren Grösse.

    Ein DN-15-Bogen misst zwei Zentimeter; dort ist die Krümmung im Gebäude
    nicht zu sehen und zwei Schenkel genügen. Ein Lüftungsbogen von 700 mm ist
    ein Möbelstück und braucht die Rundung. Die Zahl der Bauteile hängt also am
    Modell, nicht an einer Vorliebe.
    """
    if radius < 0.04:
        return 2
    return max(2, min(6, int(math.ceil(winkel_grad / 30.0))))


def fliesslinien(achsen, tol=0.02, min_laenge=4.0, hoechstens=22):
    """Einzelachsen zu durchgehenden Strecken verketten.

    Die Szene zeichnet jedes Bauteil für sich — 5'300 Zylinder. Für den
    Durchfluss in Akt drei braucht es aber eine *Strecke*, an der ein Medium
    entlanglaufen kann; ein Schlitten, der nach 40 cm am Formstück endet, zeigt
    keinen Kreislauf. Endpunkte werden auf ein Raster gerundet und über einen
    Graphen zu Zügen verkettet, wie beim Schnitt in ifc_schnitt.py — nur in 3D.

    Zurück kommen die längsten Züge je Medium, nicht alle: 30 Meter Steigstrang
    zeigen den Weg durchs Haus, 400 Stichleitungen zeigen Rauschen.
    """
    def key(p):
        return (round(p[0] / tol), round(p[1] / tol), round(p[2] / tol))

    knoten, kanten, gesehen = {}, [], set()
    for a, b in achsen:
        ka, kb = key(a), key(b)
        if ka == kb:
            continue
        e = (ka, kb) if ka < kb else (kb, ka)
        if e in gesehen:
            continue
        gesehen.add(e)
        knoten.setdefault(ka, a)
        knoten.setdefault(kb, b)
        kanten.append((ka, kb))

    nachbarn = collections.defaultdict(list)
    for i, (ka, kb) in enumerate(kanten):
        nachbarn[ka].append(i)
        nachbarn[kb].append(i)
    benutzt = [False] * len(kanten)

    def anderes(i, k):
        ka, kb = kanten[i]
        return kb if k == ka else ka

    def lauf(start):
        pts, cur, richtung = [start], start, None
        while True:
            frei = [i for i in nachbarn[cur] if not benutzt[i]]
            if not frei:
                break
            if richtung is None:
                pick = frei[0]
            else:
                def gerade(i):
                    n = np.subtract(knoten[anderes(i, cur)], knoten[cur])
                    laenge = np.linalg.norm(n) or 1.0
                    return float(np.dot(n / laenge, richtung))
                pick = max(frei, key=gerade)
            benutzt[pick] = True
            nxt = anderes(pick, cur)
            d = np.subtract(knoten[nxt], knoten[cur])
            richtung = d / (np.linalg.norm(d) or 1.0)
            pts.append(nxt)
            cur = nxt
            if cur == start:
                break
        return pts

    zuege = []
    for start in sorted(nachbarn, key=lambda k: (len(nachbarn[k]) == 2, k)):
        while any(not benutzt[i] for i in nachbarn[start]):
            pts = lauf(start)
            if len(pts) < 2:
                break
            coords = [knoten[k] for k in pts]
            laenge = sum(float(np.linalg.norm(np.subtract(b, a)))
                         for a, b in zip(coords, coords[1:]))
            if laenge >= min_laenge:
                zuege.append((laenge, coords))
    zuege.sort(key=lambda z: -z[0])
    return [c for _l, c in zuege[:hoechstens]]


def kleinstes_rechteck(pts: np.ndarray):
    """Kleinste umschliessende Grundfläche: (mitte_xy, breite, tiefe, winkel).

    Rotating calipers über die Hüllkanten. Für ein extrudiertes Bauteil ist das
    Ergebnis exakt — eine Wand ist genau ihr Rechteck, nicht die achsparallele
    Box darum, die bei einer schräg stehenden Wand um ein Vielfaches zu gross
    wäre.
    """
    hull = konvexe_huelle(pts)
    if len(hull) < 3:
        lo, hi = pts.min(0), pts.max(0)
        return (lo + hi) / 2, max(hi[0] - lo[0], 1e-4), max(hi[1] - lo[1], 1e-4), 0.0

    bestes = None
    for i in range(len(hull)):
        kante = hull[(i + 1) % len(hull)] - hull[i]
        laenge = math.hypot(*kante)
        if laenge < 1e-9:
            continue
        ux, uy = kante / laenge
        rot = np.array([[ux, uy], [-uy, ux]])
        lokal = pts @ rot.T
        lo, hi = lokal.min(0), lokal.max(0)
        flaeche = (hi[0] - lo[0]) * (hi[1] - lo[1])
        if bestes is None or flaeche < bestes[0]:
            mitte = rot.T @ ((lo + hi) / 2)
            bestes = (flaeche, mitte, hi[0] - lo[0], hi[1] - lo[1], math.atan2(uy, ux))
    _f, mitte, b, t, winkel = bestes
    return mitte, max(b, 1e-4), max(t, 1e-4), winkel


# ---------------------------------------------------------------------------
# Lesen
# ---------------------------------------------------------------------------

def querschnitt_aus_pset(p, dn_zu_aussen):
    """Der Querschnitt eines Leitungsbauteils, aus seinen eigenen Kennwerten.

    Rückgabe ("rechteck", breite, hoehe) oder ("rund", radius), in Metern, oder
    None. Die Reihenfolge ist nicht beliebig: ein Kanal führt Seite 1 und 2, ein
    Rohr einen Durchmesser, und ein Formstück oft nur seine Nennweite.

    `Tech-DN` ist der Schlüssel, an dem die alte Fassung vorbeigelesen hat —
    2'110 Formstücke der Heizung führen ihre Weite dort und nirgends sonst, und
    landeten deshalb allesamt auf dem Notradius von 30 mm. Die Nennweite wird
    über die Tabelle `dn_zu_aussen` auf den Aussendurchmesser gebracht, die aus
    den Rohren derselben Datei stammt (die führen beides). DN 15 ist damit
    21,3 mm, wie es die Rohre daneben auch sind, statt 15 mm.
    """
    s1, s2 = p.get("Geom-Side 1 (mm)"), p.get("Geom-Side 2 (mm)")
    if s1 and s2:
        return ("rechteck", float(s1) / 1000.0, float(s2) / 1000.0)
    od = p.get("Tech-Outside-diameter (mm)")
    if od:
        return ("rund", float(od) / 2000.0)
    rund = p.get("Geom-Ø (mm)")
    if rund:
        return ("rund", float(rund) / 2000.0)
    dn = p.get("Tech-DN")
    if dn is not None:
        aussen = dn_zu_aussen.get(str(dn).strip())
        if aussen:
            return ("rund", float(aussen) / 2000.0)
        try:
            return ("rund", float(str(dn).strip()) / 2000.0)
        except ValueError:
            pass
    return None


def lies_quelle(pfad):
    """Je Bauteil: Klasse, Netz, Ports mit Richtung und Weite, Querschnitt, Medium."""
    import ifcopenshell
    import ifcopenshell.geom
    import ifcopenshell.util.element as ue
    import ifcopenshell.util.placement as placement

    f = ifcopenshell.open(str(pfad))

    ports = collections.defaultdict(list)
    element_von_port = {}
    for rel in f.by_type("IfcRelConnectsPortToElement"):
        ports[rel.RelatedElement.id()].append(rel.RelatingPort)
        element_von_port[rel.RelatingPort.id()] = rel.RelatedElement.id()
    # Welcher Anschluss steckt in welchem — daher kommt die Weite eines
    # Formstücks, das seine eigene nicht führt.
    nachbarport = {}
    for rel in f.by_type("IfcRelConnectsPorts"):
        nachbarport[rel.RelatingPort.id()] = rel.RelatedPort.id()
        nachbarport[rel.RelatedPort.id()] = rel.RelatingPort.id()

    # Nennweite -> Aussendurchmesser, aus den Rohren dieser Datei. Die führen
    # beides, die Formstücke nur die Nennweite.
    dn_zu_aussen = {}
    for el in f.by_type("IfcPipeSegment"):
        p = ue.get_psets(el).get("Pset MEP", {})
        dn, od = p.get("Tech-DN"), p.get("Tech-Outside-diameter (mm)")
        if dn is not None and od:
            dn_zu_aussen.setdefault(str(dn).strip(), float(od))

    system_of = {}
    for rel in f.by_type("IfcRelAssignsToGroup"):
        if rel.RelatingGroup.is_a("IfcSystem"):
            for obj in rel.RelatedObjects:
                system_of[obj.id()] = rel.RelatingGroup.Name

    produkte = [e for e in f.by_type("IfcProduct")]
    mit_rep = [e for e in produkte if e.Representation]

    netze: dict[int, np.ndarray] = {}
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    it = ifcopenshell.geom.iterator(settings, f, 4, include=mit_rep)
    if it.initialize():
        while True:
            shape = it.get()
            v = np.asarray(shape.geometry.verts, dtype=np.float64).reshape(-1, 3)
            idx = np.asarray(shape.geometry.faces, dtype=np.int64).reshape(-1, 3)
            if len(idx):
                # Mehrkörper-Bauteile (etwa Räume) kommen mehrfach; anhängen.
                tris = v[idx]
                netze[shape.id] = (np.concatenate([netze[shape.id], tris])
                                   if shape.id in netze else tris)
            if not it.next():
                break

    # Erst der eigene Querschnitt jedes Bauteils, dann erben die Anschlüsse.
    psets = {el.id(): ue.get_psets(el).get("Pset MEP", {}) for el in produkte}
    eigen = {eid: querschnitt_aus_pset(p, dn_zu_aussen) for eid, p in psets.items()}

    rows = []
    for el in produkte:
        medium = SYSTEM_ZU_MEDIUM.get(system_of.get(el.id(), ""))
        eid = el.id()

        # Anschlüsse mit Lage, Richtung, Querachse und geerbter Weite. Die
        # Richtung ist die lokale z-Achse der Portplatzierung, die Querachse
        # ihre x-Achse — daran hängt die Lage eines Rechteckkanals im Raum.
        anschluesse = []
        for port in ports[eid]:
            if not port.ObjectPlacement:
                continue
            M = placement.get_local_placement(port.ObjectPlacement)
            # Ein Formstück führt seine Weite oft nicht; der angeschlossene
            # Nachbar führt sie. So bekommt jeder Ast eines T-Stücks die Weite
            # des Rohrs, das dort wirklich ansetzt — auch beim reduzierten.
            nachbar = element_von_port.get(nachbarport.get(port.id(), -1), None)
            anschluesse.append({
                "pos": M[:3, 3],
                "dir": M[:3, 2],
                "quer": M[:3, 0],
                "quer_schnitt": eigen.get(nachbar) if nachbar is not None else None,
            })

        # Wie viele Äste das Bauteil laut Datenblatt hat. `Tech-DN3` führen im
        # Heizungsmodell genau die 328 T-Stücke — ein verlässlicheres Signal als
        # die Zahl der Ports, denn rund 120 T-Stücke führen nur zwei davon.
        p = psets[eid]
        typ = (p.get("Tech-Product type") or p.get("Name") or "")
        rows.append({
            "klasse": el.is_a(),
            "netz": netze.get(eid),
            "anschluesse": anschluesse,
            "querschnitt": eigen.get(eid),
            "produkttyp": typ,
            "ist_bogen": "bogen" in typ.lower(),
            "aeste": 3 if (p.get("Tech-DN3") is not None or "t-stück" in typ.lower()) else None,
            # Die Dämmung liegt im IFC als eigener Körper neben dem Rohr — daher
            # die zwei bis vier Repräsentationselemente dieser Bauteile. Ihre
            # Stärke steht im Property-Set und macht den sichtbaren Durchmesser.
            "daemmung": (float(p["Tech-Insulation thickness (mm)"]) / 1000.0
                         if p.get("Tech-Insulation thickness (mm)") else 0.0),
            "medium": medium or "unbekannt",
        })
    return rows


# ---------------------------------------------------------------------------
# Bauen
# ---------------------------------------------------------------------------

def main():
    import sys
    sys.setrecursionlimit(20000)

    alle = []
    for tag, pfad in QUELLEN:
        print(f"lese {pfad.name} …")
        rows = lies_quelle(pfad)
        for r in rows:
            r["quelle"] = tag
        alle.extend(rows)
        print(f"  {len(rows)} Produkte")

    unbekannt = sorted({r["klasse"] for r in alle} - set(REGELN))
    if unbekannt:
        raise SystemExit(
            "Keine Regel für: " + ", ".join(unbekannt) +
            "\nIn REGELN eintragen — entweder eine Darstellung oder eine "
            "Begründung mit führendem '-'. Stillschweigend weglassen gilt nicht.")

    # --- Ausdehnung aus dem Rohbau, damit ein Leitungsausläufer nach draussen
    #     (die Zuleitung zur Bestandszentrale) die Mitte nicht verschiebt.
    roh = [r["netz"] for r in alle
           if r["netz"] is not None and REGELN[r["klasse"]] in ("wand", "netz")]
    pts = np.concatenate([n.reshape(-1, 3) for n in roh])
    lo, hi = pts.min(0), pts.max(0)
    mitte_x, mitte_y = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
    print(f"Rohbau von {np.round(lo, 2).tolist()} bis {np.round(hi, 2).tolist()}")

    def nach_three(p):
        """IFC (x rechts, y hinten, z oben) -> three.js (x, y oben, z vorne),
        in x/z auf die Gebäudemitte gerückt, y bleibt die echte Höhe."""
        return (p[0] - mitte_x, p[2], -(p[1] - mitte_y))

    def richtung_nach_three(d):
        """Dasselbe für einen Richtungsvektor — ohne die Verschiebung.

        Eine Richtung wird gedreht, nicht verschoben. Sie durch `nach_three` zu
        schicken hängt ihr die Gebäudemitte an und macht aus der Querachse eines
        Kanals einen Vektor quer durchs halbe Haus.
        """
        return (d[0], d[2], -d[1])

    koerper: list[float] = []
    straenge: list[float] = []
    kanaele: list[float] = []
    decken: list[np.ndarray] = []
    achsen_je_medium: dict[str, list] = collections.defaultdict(list)
    inventar = collections.Counter()
    # Ein Formstück ist jetzt mehrere Körper — ein Bogen ein Zug, ein T-Stück
    # drei Äste. `inventar` zählt weiterhin **Bauteile**, damit die Summe unten
    # die Zahl der Produkte in den drei Dateien bleibt und die Bildunterschrift
    # der Szene nicht anfängt, Rohrstücke als Bauteile auszugeben. Wie viele
    # Körper daraus werden, steht daneben in `teile`.
    teile_je = collections.Counter()
    weggelassen = collections.Counter()
    ersatzweite = collections.Counter()
    gedaemmt = [0]

    def lege_ab(medium, a_ifc, b_ifc, quer, querachse, daemmung=0.0):
        """Ein gerades Leitungsstück ablegen — als Rohr oder als Kanal.

        Ein Rechteckkanal ist kein Rohr. Die alte Fassung machte aus jedem einen
        Zylinder mit `hypot(s1, s2) / 4` als Radius, kommentiert als
        „flächengleich"; ein 500 × 500er kam damit auf 98'400 mm² statt
        250'000 — 39 % des Querschnitts. Rechteckiges geht deshalb als Quader
        heraus, mit der Querachse aus der Portplatzierung, damit er im Raum so
        liegt wie im Modell.

        Trägt das Bauteil eine Dämmung, kommt sie als zweiter Körper darüber —
        als Medium „Dämmung", damit sie im Bild als Hülle lesbar bleibt und
        nicht als dickeres Rohr. Ohne sie ist die Leitung im Median dreimal zu
        dünn gegenüber dem, was ein IFC-Betrachter zeigt.
        """
        a, b = nach_three(a_ifc), nach_three(b_ifc)
        if float(np.linalg.norm(np.subtract(b, a))) < 1e-4:
            return False
        rechteckig = bool(quer and quer[0] == "rechteck")
        u = None
        if rechteckig:
            u = np.asarray(querachse, float) if querachse is not None else None
            achse = np.subtract(b_ifc, a_ifc)
            achse = achse / (float(np.linalg.norm(achse)) or 1.0)
            if u is None or float(np.linalg.norm(u)) < 1e-9:
                u = np.array([1.0, 0.0, 0.0])
            # Querachse senkrecht zur Leitung ausrichten; fällt sie mit ihr
            # zusammen, eine beliebige senkrechte nehmen.
            u = u - achse * float(np.dot(u, achse))
            if float(np.linalg.norm(u)) < 1e-9:
                hilf = np.array([0.0, 0.0, 1.0])
                if abs(float(np.dot(hilf, achse))) > 0.9:
                    hilf = np.array([1.0, 0.0, 0.0])
                u = hilf - achse * float(np.dot(hilf, achse))
            u = u / float(np.linalg.norm(u))
            kanaele.extend([MEDIUM_INDEX[medium], *a, *b, quer[1], quer[2],
                            *richtung_nach_three(u)])
        else:
            straenge.extend([MEDIUM_INDEX[medium], *a, *b, quer[1] if quer else 0.03])
        if daemmung > 0:
            d = MEDIUM_INDEX["daemmung"]
            if rechteckig:
                kanaele.extend([d, *a, *b, quer[1] + 2 * daemmung,
                                quer[2] + 2 * daemmung, *richtung_nach_three(u)])
            else:
                straenge.extend([d, *a, *b, (quer[1] if quer else 0.03) + daemmung])
            gedaemmt[0] += 1
        # Die Dämmung ist keine Leitung — sie gehört nicht in die Verkettung der
        # Fliesslinien, sonst läuft das Medium durch die Hülle statt durchs Rohr.
        achsen_je_medium[medium].append((a, b))
        return True

    for r in alle:
        regel = REGELN[r["klasse"]]
        if regel.startswith("-"):
            weggelassen[(r["klasse"], regel[1:])] += 1
            continue
        if r["netz"] is None and len(r["anschluesse"]) < 2:
            weggelassen[(r["klasse"], "ohne Geometrie in der Quelle")] += 1
            continue

        if regel == "rohr":
            an = r["anschluesse"]
            eigen_qs = r["querschnitt"]
            if eigen_qs is None:
                # Weite vom ersten Anschluss erben, der eine führt.
                eigen_qs = next((a["quer_schnitt"] for a in an if a["quer_schnitt"]), None)
            if eigen_qs is None:
                ersatzweite[(r["quelle"], r["klasse"])] += 1

            gezeichnet, woher = 0, "Leitung"
            if len(an) >= 2:
                ecke = zentrum_der_achsen([a["pos"] for a in an], [a["dir"] for a in an])
                qs_haupt = (an[0]["quer_schnitt"] or an[-1]["quer_schnitt"] or eigen_qs)
                r_haupt = (qs_haupt[1] if qs_haupt and qs_haupt[0] == "rund"
                           else max(qs_haupt[1], qs_haupt[2]) / 2 if qs_haupt else 0.03)

                # Ein T-Stück mit nur zwei Ports sieht wie ein Bogen aus. Das
                # Datenblatt weiss es besser: `Tech-DN3` nennt drei Weiten. Den
                # fehlenden Durchgang holt das Netz zurück, und gerundet wird
                # hier nichts — ein T hat eine Ecke, keinen Radius.
                if (r["aeste"] == 3 and len(an) == 2 and ecke is not None
                        and r["netz"] is not None):
                    extra = fehlender_ast(r["netz"], ecke, an, r_haupt)
                    if extra is not None:
                        an = an + [{"pos": extra, "dir": None,
                                    "quer": an[0]["quer"],
                                    "quer_schnitt": eigen_qs}]

                if ecke is not None and len(an) == 2 and r["ist_bogen"]:
                    # Zwei Anschlüsse mit einer Ecke: ein Bogen. Die Krümmung
                    # steht in den Portachsen, sie muss nur gerechnet werden.
                    qs = an[0]["quer_schnitt"] or an[1]["quer_schnitt"] or eigen_qs
                    r_sicht = r_haupt
                    u0 = np.asarray(an[0]["pos"], float) - ecke
                    u1 = np.asarray(an[1]["pos"], float) - ecke
                    n0, n1 = float(np.linalg.norm(u0)), float(np.linalg.norm(u1))
                    winkel = 180.0
                    if n0 > 1e-9 and n1 > 1e-9:
                        winkel = 180.0 - math.degrees(math.acos(float(np.clip(
                            np.dot(u0 / n0, u1 / n1), -1.0, 1.0))))
                    zug = bogen(ecke, an[0]["pos"], an[1]["pos"],
                                bogenstuecke(r_sicht, winkel))
                    if zug is not None:
                        for p, q in zip(zug, zug[1:]):
                            if lege_ab(r["medium"], p, q, qs, an[0]["quer"], r["daemmung"]):
                                gezeichnet += 1
                        woher = "Bogen"
                elif ecke is not None:
                    # Alles andere mit einer Ecke: von der Mitte je ein Ast, mit
                    # scharfem Knick. Das gilt für T-Stücke und Abzweige — deren
                    # Ecke ist eine Ecke — und ebenso für ein Formstück ohne
                    # Typangabe, wo eine erfundene Rundung mehr behaupten würde,
                    # als das Modell hergibt.
                    for a in an:
                        qs = a["quer_schnitt"] or eigen_qs
                        if lege_ab(r["medium"], ecke, a["pos"], qs, a["quer"], r["daemmung"]):
                            gezeichnet += 1
                    woher = "Verzweigung"
                if not gezeichnet:
                    # Keine Ecke — gerades Bauteil: längste Portstrecke.
                    best, bl = None, -1.0
                    for i in range(len(an)):
                        for j in range(i + 1, len(an)):
                            d = float(np.linalg.norm(an[i]["pos"] - an[j]["pos"]))
                            if d > bl:
                                bl, best = d, (an[i], an[j])
                    if bl > 1e-3:
                        qs = best[0]["quer_schnitt"] or best[1]["quer_schnitt"] or eigen_qs
                        if lege_ab(r["medium"], best[0]["pos"], best[1]["pos"],
                                   qs, best[0]["quer"], r["daemmung"]):
                            gezeichnet, woher = 1, "Leitung"
                        # Ein T-Stück, dessen Ports alle in einer Linie liegen,
                        # hat keine Ecke — und verlöre hier seinen Abzweig. Der
                        # steht im Netz und wird von dort geholt.
                        if (gezeichnet and r["aeste"] == 3 and r["netz"] is not None):
                            ab = abzweig_aus_netz(r["netz"], best[0]["pos"],
                                                  best[1]["pos"], r_haupt)
                            if ab is not None and lege_ab(r["medium"], ab[0], ab[1],
                                                          qs, best[0]["quer"],
                                                          r["daemmung"]):
                                gezeichnet += 1
                                woher = "Verzweigung"

            if not gezeichnet and r["netz"] is not None:
                # Höchstens ein Anschluss: Achse aus dem Körper holen, statt das
                # Rohr als Kästchen abzulegen. Die Weite kommt weiter aus dem
                # Pset, wenn es eine führt — die Streubreite der Punktwolke ist
                # bei einem angeschnittenen Bogen deutlich zu gross.
                p0, p1, r_netz = achse_aus_netz(r["netz"].reshape(-1, 3))
                qs = eigen_qs or ("rund", r_netz)
                querachse = an[0]["quer"] if an else None
                if lege_ab(r["medium"], p0, p1, qs, querachse, r["daemmung"]):
                    gezeichnet, woher = 1, "Leitung (Achse aus Körper)"

            if gezeichnet:
                inventar[(r["quelle"], r["klasse"], woher)] += 1
                teile_je[(r["quelle"], r["klasse"], woher)] += gezeichnet
                continue
            if r["netz"] is None:
                weggelassen[(r["klasse"], "ohne Geometrie in der Quelle")] += 1
                continue
            regel = "zubehoer"

        if regel == "netz":
            tris = r["netz"].reshape(-1, 3)
            decken.append(np.array([nach_three(p) for p in tris]))
            inventar[(r["quelle"], r["klasse"], "Netz")] += 1
            teile_je[(r["quelle"], r["klasse"], "Netz")] += 1
            continue

        # Quader aus der kleinsten umschliessenden Grundfläche
        v = r["netz"].reshape(-1, 3)
        mitte, breite, tiefe, winkel = kleinstes_rechteck(v[:, :2])
        z0, z1 = v[:, 2].min(), v[:, 2].max()
        cx, cy, cz = nach_three((mitte[0], mitte[1], (z0 + z1) / 2))
        koerper.extend([
            KAT_INDEX[regel], cx, cy, cz,
            breite, max(z1 - z0, 1e-3), tiefe,
            # In three.js dreht +y andersherum als der Winkel in der xy-Ebene.
            -winkel,
        ])
        inventar[(r["quelle"], r["klasse"], regel)] += 1
        teile_je[(r["quelle"], r["klasse"], regel)] += 1

    # --- Fliesslinien je Medium
    fluss = {}
    for medium, achsen in achsen_je_medium.items():
        fluss[medium] = fliesslinien(achsen)
        print(f"  {medium}: {len(achsen)} Achsen -> {len(fluss[medium])} Fliesslinien")

    # --- Ankerpunkte für die drei Rollen, aus dem Modell abgeleitet
    speicher = [r for r in alle if r["klasse"] == "IfcTank" and r["netz"] is not None]
    heizkoerper = [r for r in alle if r["klasse"] == "IfcSpaceHeater" and r["netz"] is not None]
    geraete = [r for r in alle if r["klasse"] == "IfcUnitaryEquipment" and r["netz"] is not None]
    geschosse = IS.geschosse()

    def schwerpunkt(rows):
        v = np.concatenate([r["netz"].reshape(-1, 3) for r in rows])
        return v.mean(0)

    def auf_geschoss(p):
        """Fusspunkt: nächstes Geschoss unter dem Bauteil."""
        unter = [g for g in geschosse if g <= p[2] + 0.2]
        return (p[0], p[1], (unter[-1] if unter else geschosse[0]))

    # Der Installateur steht an der Heizzentrale, beim grössten Speicher.
    zentrale = schwerpunkt(speicher)
    installateur = nach_three(auf_geschoss((zentrale[0] + 2.2, zentrale[1], zentrale[2])))
    # Der Nutzer steht an einem Heizkörper in einem Obergeschoss.
    oben = [r for r in heizkoerper if r["netz"].reshape(-1, 3)[:, 2].mean() > 15]
    hk = schwerpunkt(oben[:1] or heizkoerper[:1])
    nutzer = nach_three(auf_geschoss((hk[0], hk[1] - 1.4, hk[2])))
    # Der Planer sitzt vor dem Gebäude, auf Terrainhöhe.
    eg = min(geschosse, key=lambda g: abs(g))
    planer = nach_three((mitte_x - (hi[0] - lo[0]) * 0.30, lo[1] - 6.0, eg))
    lueftungszentrale = nach_three(schwerpunkt(geraete))
    heizzentrale = nach_three(zentrale)

    # --- Messwerte: drei Zahlen aus den Property-Sets, an ihrem Ort im Modell.
    #     Auslegungsdaten, keine Messwerte — die Bildunterschrift sagt das.
    import ifcopenshell
    import ifcopenshell.util.element as ue

    fh = ifcopenshell.open(str(IS.HEIZUNG))
    leistung = sum(ue.get_psets(e).get("Pset MEP", {}).get("Calc-Q target net (W)", 0.0)
                   for e in fh.by_type("IfcSpaceHeater"))
    temp = next(ue.get_psets(e).get("Pset MEP", {}) for e in fh.by_type("IfcSpaceHeater"))
    fl = ifcopenshell.open(str(IS.LUEFTUNG))
    # Nicht `kanaele` nennen — so heisst die Geometrieliste der Rechteckkanäle.
    kanal_psets = [ue.get_psets(e).get("Pset MEP", {}) for e in fl.by_type("IfcDuctSegment")]
    groesster = max((p for p in kanal_psets
                     if p.get("Geom-Side 1 (mm)") and p.get("Geom-Side 2 (mm)")
                     and p.get("Tech-Medium") == "L_Zuluft"),
                    key=lambda p: p["Geom-Side 1 (mm)"] * p["Geom-Side 2 (mm)"])

    def ch(v):
        return f"{int(round(v)):,}".replace(",", "’")

    messpunkte = [
        ("hl", f"{leistung/1000:.1f} kW".replace(".", ","), "Heizlast installiert",
         "heat", heizzentrale),
        ("au", f"{temp['Calc-Flow temperature']:.0f} / "
               f"{temp['Calc-Return temperature']:.0f} °C", "Auslegung", "heat", nutzer),
        ("zl", f"{ch(groesster['Geom-Side 1 (mm)'])} × "
               f"{ch(groesster['Geom-Side 2 (mm)'])} mm", "Zuluftkanal",
         "air", lueftungszentrale),
    ]

    # --- schreiben
    n_kat = len(koerper) // 8
    n_str = len(straenge) // 8
    n_kan = len(kanaele) // 12
    daten = emit_json(koerper, straenge, kanaele, decken, fluss, geschosse, lo, hi,
                      mitte_x, mitte_y, planer, installateur, nutzer, heizzentrale,
                      lueftungszentrale, messpunkte, inventar, teile_je, weggelassen)
    JSON_DATEI.parent.mkdir(parents=True, exist_ok=True)
    JSON_DATEI.write_text(daten, encoding="utf-8")
    TS.write_text(emit_ts(), encoding="utf-8")

    print(f"\ngeschrieben: {JSON_DATEI}  ({len(daten)/1024:.0f} KB)")
    print(f"            {TS}")
    print(f"  {n_kat} Körper, {n_str} Rohre, {n_kan} Kanäle, {len(decken)} "
          f"Deckennetze ({sum(len(d) for d in decken)//3} Dreiecke)")
    print(f"  davon {gedaemmt[0]} Dämmhüllen über gedämmten Leitungsstücken")
    if ersatzweite:
        print("\nOhne Weite in der Quelle — mit 30 mm gezeichnet")
        for (quelle, klasse), n in sorted(ersatzweite.items()):
            print(f"  {quelle:<12} {klasse:<28} {n:6d}")
    print("\nInventar (Bauteile, in Klammern die Körper daraus)")
    for (quelle, klasse, wie), n in sorted(inventar.items()):
        t = teile_je[(quelle, klasse, wie)]
        zusatz = f"  ({t} Körper)" if t != n else ""
        print(f"  {quelle:<12} {klasse:<28} {wie:<28} {n:6d}{zusatz}")
    print("\nNicht gezeichnet")
    for (klasse, grund), n in sorted(weggelassen.items()):
        print(f"  {klasse:<28} {n:6d}   {grund}")
    gezeichnet = sum(inventar.values())
    print(f"\nSumme: {gezeichnet} Bauteile gezeichnet (als {sum(teile_je.values())} "
          f"Körper plus {gedaemmt[0]} Dämmhüllen), {sum(weggelassen.values())} "
          f"nicht gezeichnet, zusammen {gezeichnet + sum(weggelassen.values())} Produkte")


def z(v: float) -> str:
    return f"{v:.3f}".rstrip("0").rstrip(".") or "0"

def emit_json(koerper, straenge, kanaele, decken, fluss, geschosse, lo, hi, mitte_x,
              mitte_y, planer, installateur, nutzer, heizzentrale, lueftungszentrale,
              messpunkte, inventar, teile_je, weggelassen) -> str:
    """Die ganze Szene als JSON.

    Bewusst **nicht** als TypeScript-Modul: 62'000 Zahlen und 10'000 Punkte als
    Literale sind ebenso viele AST-Knoten, die Rollup einzeln durchgeht. Der
    Build lief damit **18 Minuten** statt 20 Sekunden — auch als
    `JSON.parse("…")` noch, weil Vite die Datei trotzdem durch den Modulgraphen
    zieht. Als Ressource daneben sieht der Bundler eine Datei und kopiert sie.
    """
    def punkte(p):
        return "[" + ",".join(z(v) for v in p) + "]"

    teile = []
    teile.append('"erzeugtVon":"cad/build_scene_ifc.py"')
    teile.append('"quelle":["ifc/4723_Architektur.ifc","ifc/4723_Heizung.ifc",'
                 '"ifc/4723_L\\u00fcftung.ifc"]')
    teile.append('"bauwerk":{'
                 f'"min":[{z(lo[0]-mitte_x)},{z(lo[2])},{z(-(hi[1]-mitte_y))}],'
                 f'"max":[{z(hi[0]-mitte_x)},{z(hi[2])},{z(-(lo[1]-mitte_y))}],'
                 f'"breite":{z(hi[0]-lo[0])},"tiefe":{z(hi[1]-lo[1])},'
                 f'"hoehe":{z(hi[2]-lo[2])},'
                 f'"geschosse":[{",".join(z(g) for g in geschosse)}]}}')

    kats = ",".join(
        f'{{"id":"{k}","label":"{label}","color":"{farbe}","opacity":{deck},'
        f'"phase":"{phase}"}}'
        for k, label, farbe, deck, phase in KATEGORIEN)
    teile.append(f'"kategorien":[{kats}]')

    meds = ",".join(
        f'{{"id":"{k}","label":"{label}","short":"{kurz}","gewerk":"{gewerk}",'
        f'"color":"{farbe}","deckkraft":{z(deck)}}}'
        for k, label, kurz, gewerk, farbe, deck in MEDIEN)
    teile.append(f'"medien":[{meds}]')

    teile.append('"KOERPER_STRIDE":8')
    teile.append('"koerper":[' + ",".join(z(v) for v in koerper) + "]")
    teile.append('"STRANG_STRIDE":8')
    teile.append('"straenge":[' + ",".join(z(v) for v in straenge) + "]")
    teile.append('"KANAL_STRIDE":12')
    teile.append('"kanaele":[' + ",".join(z(v) for v in kanaele) + "]")
    teile.append('"decken":['
                 + ",".join(z(v) for d in decken for p in d for v in p) + "]")

    linien = []
    for key, *_rest in MEDIEN:
        for linie in fluss.get(key, []):
            pts = ",".join(punkte(p) for p in linie)
            linien.append(f'{{"medium":{MEDIUM_INDEX[key]},"punkte":[{pts}]}}')
    teile.append('"fliesslinien":[' + ",".join(linien) + "]")

    teile.append('"acteurs":{'
                 f'"planer":{punkte(planer)},'
                 f'"installateur":{punkte(installateur)},'
                 f'"nutzer":{punkte(nutzer)}}}')
    teile.append('"zentralen":['
                 f'{{"name":"Heizzentrale","at":{punkte(heizzentrale)}}},'
                 f'{{"name":"L\\u00fcftungszentrale","at":{punkte(lueftungszentrale)}}}]')

    mps = ",".join(
        f'{{"id":"{mid}","value":{_js(wert)},"label":{_js(label)},"tone":"{tone}",'
        f'"at":{punkte(at)}}}'
        for mid, wert, label, tone, at in messpunkte)
    teile.append(f'"messpunkte":[{mps}]')

    gez = ",".join(
        f'{{"quelle":{_js(q)},"klasse":"{k}","als":{_js(w)},"n":{n},'
        f'"teile":{teile_je[(q, k, w)]}}}'
        for (q, k, w), n in sorted(inventar.items()))
    nicht = ",".join(
        f'{{"klasse":"{k}","grund":{_js(g)},"n":{n}}}'
        for (k, g), n in sorted(weggelassen.items()))
    teile.append(f'"inventar":{{"gezeichnet":[{gez}],"nichtGezeichnet":[{nicht}]}}')

    return "{" + ",".join(teile) + "}"


def _js(s: str) -> str:
    """String als JSON, mit \\u-Escapes für alles ausser ASCII."""
    import json
    return json.dumps(s, ensure_ascii=True)


def emit_ts() -> str:
    """Der schlanke Zugang zur Szene: Typen und ein Lader, sonst nichts."""
    return '''/*
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
'''




if __name__ == "__main__":
    main()
