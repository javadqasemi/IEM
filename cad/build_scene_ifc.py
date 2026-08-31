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

Zwei Darstellungen
------------------
* **Leitungen** (Rohre, Kanäle, Formstücke, Klappen, Schalldämpfer, Armaturen)
  als Achse plus Radius. Die Achse steht als `IfcDistributionPort` an beiden
  Enden im Modell; ein Rohr *ist* ein Zylinder, das ist also keine Näherung,
  sondern die kompaktere Schreibweise derselben Sache.
* **Alles andere** als gedrehter Quader aus der kleinsten umschliessenden
  Grundfläche (min-area rect über der konvexen Hülle) und der Höhe. Für
  extrudierte Bauteile — Wände, Fenster, Türen, Geräte — ist das exakt.

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
MEDIEN = [
    ("heizwasser_vl", "Heizwasser Vorlauf", "Vorlauf", "Heizung", "#a2542a"),
    ("heizwasser_rl", "Heizwasser Rücklauf", "Rücklauf", "Heizung", "#b79a7a"),
    ("kaltwasser", "Kaltwasser", "Kaltwasser", "Sanitär", "#2f7d77"),
    ("zuluft", "Zuluft", "Zuluft", "Lüftung", "#2c5691"),
    ("abluft", "Abluft", "Abluft", "Lüftung", "#8fa4c4"),
    ("unbekannt", "ohne Systemzuordnung", "übrige", "—", "#9aa4b4"),
]
MEDIUM_INDEX = {m[0]: i for i, m in enumerate(MEDIEN)}

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

def lies_quelle(pfad):
    """Je Bauteil: Klasse, Netz (oder None), Achse (oder None), Medium."""
    import ifcopenshell
    import ifcopenshell.geom
    import ifcopenshell.util.element as ue
    import ifcopenshell.util.placement as placement

    f = ifcopenshell.open(str(pfad))

    ports = collections.defaultdict(list)
    for rel in f.by_type("IfcRelConnectsPortToElement"):
        ports[rel.RelatedElement.id()].append(rel.RelatingPort)
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

    rows = []
    for el in produkte:
        medium = IS.SYSTEME.get(system_of.get(el.id(), ""))
        achse = None
        pts = [placement.get_local_placement(p.ObjectPlacement)[:3, 3]
               for p in ports[el.id()] if p.ObjectPlacement]
        if len(pts) >= 2:
            best, bl = None, -1.0
            for i in range(len(pts)):
                for j in range(i + 1, len(pts)):
                    d = float(np.linalg.norm(pts[i] - pts[j]))
                    if d > bl:
                        bl, best = d, (pts[i], pts[j])
            if bl > 1e-3:
                achse = best
        p = ue.get_psets(el).get("Pset MEP", {})
        od = p.get("Tech-Outside-diameter (mm)")
        s1, s2 = p.get("Geom-Side 1 (mm)"), p.get("Geom-Side 2 (mm)")
        rund = p.get("Geom-Ø (mm)")
        if od:
            r_mm = od / 2
        elif s1 and s2:
            r_mm = math.hypot(s1, s2) / 4     # flächengleicher Ersatzradius
        elif rund:
            r_mm = rund / 2
        else:
            r_mm = None
        rows.append({
            "klasse": el.is_a(),
            "netz": netze.get(el.id()),
            "achse": achse,
            "radius": (r_mm / 1000.0) if r_mm else None,
            "medium": medium[0] if medium else "unbekannt",
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

    koerper: list[float] = []
    straenge: list[float] = []
    decken: list[np.ndarray] = []
    achsen_je_medium: dict[str, list] = collections.defaultdict(list)
    inventar = collections.Counter()
    weggelassen = collections.Counter()

    for r in alle:
        regel = REGELN[r["klasse"]]
        if regel.startswith("-"):
            weggelassen[(r["klasse"], regel[1:])] += 1
            continue
        if r["netz"] is None and r["achse"] is None:
            weggelassen[(r["klasse"], "ohne Geometrie in der Quelle")] += 1
            continue

        if regel == "rohr":
            achse, radius, woher = r["achse"], r["radius"], "Leitung"
            if achse is None and r["netz"] is not None:
                # Nur ein Anschluss im Modell: Achse aus dem Körper holen,
                # statt das Rohr als Kästchen abzulegen.
                p0, p1, r_netz = achse_aus_netz(r["netz"].reshape(-1, 3))
                achse, radius, woher = (p0, p1), radius or r_netz, "Leitung (Achse aus Körper)"
            if achse is not None:
                a, b = nach_three(achse[0]), nach_three(achse[1])
                straenge.extend([MEDIUM_INDEX[r["medium"]], *a, *b, radius or 0.03])
                achsen_je_medium[r["medium"]].append((a, b))
                inventar[(r["quelle"], r["klasse"], woher)] += 1
                continue
            regel = "zubehoer"

        if regel == "netz":
            tris = r["netz"].reshape(-1, 3)
            decken.append(np.array([nach_three(p) for p in tris]))
            inventar[(r["quelle"], r["klasse"], "Netz")] += 1
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
    kanaele = [ue.get_psets(e).get("Pset MEP", {}) for e in fl.by_type("IfcDuctSegment")]
    groesster = max((p for p in kanaele
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
    daten = emit_json(koerper, straenge, decken, fluss, geschosse, lo, hi, mitte_x,
                      mitte_y, planer, installateur, nutzer, heizzentrale,
                      lueftungszentrale, messpunkte, inventar, weggelassen)
    JSON_DATEI.parent.mkdir(parents=True, exist_ok=True)
    JSON_DATEI.write_text(daten, encoding="utf-8")
    TS.write_text(emit_ts(), encoding="utf-8")

    print(f"\ngeschrieben: {JSON_DATEI}  ({len(daten)/1024:.0f} KB)")
    print(f"            {TS}")
    print(f"  {n_kat} Körper, {n_str} Leitungen, {len(decken)} Deckennetze "
          f"({sum(len(d) for d in decken)//3} Dreiecke)")
    print("\nInventar")
    for (quelle, klasse, wie), n in sorted(inventar.items()):
        print(f"  {quelle:<12} {klasse:<28} {wie:<12} {n:6d}")
    print("\nNicht gezeichnet")
    for (klasse, grund), n in sorted(weggelassen.items()):
        print(f"  {klasse:<28} {n:6d}   {grund}")
    gezeichnet = sum(inventar.values())
    print(f"\nSumme: {gezeichnet} gezeichnet, {sum(weggelassen.values())} nicht "
          f"gezeichnet, zusammen {gezeichnet + sum(weggelassen.values())} Produkte")


def z(v: float) -> str:
    return f"{v:.3f}".rstrip("0").rstrip(".") or "0"

def emit_json(koerper, straenge, decken, fluss, geschosse, lo, hi, mitte_x, mitte_y,
              planer, installateur, nutzer, heizzentrale, lueftungszentrale,
              messpunkte, inventar, weggelassen) -> str:
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
        f'"color":"{farbe}"}}'
        for k, label, kurz, gewerk, farbe in MEDIEN)
    teile.append(f'"medien":[{meds}]')

    teile.append('"KOERPER_STRIDE":8')
    teile.append('"koerper":[' + ",".join(z(v) for v in koerper) + "]")
    teile.append('"STRANG_STRIDE":8')
    teile.append('"straenge":[' + ",".join(z(v) for v in straenge) + "]")
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
        f'{{"quelle":{_js(q)},"klasse":"{k}","als":{_js(w)},"n":{n}}}'
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
  /** Medien der Leitungen, Farben wie im Hero-Schnitt. */
  medien: { id: string; label: string; short: string; gewerk: string; color: string }[];
  KOERPER_STRIDE: number;
  /**
   * Ein Körper je acht Zahlen: Kategorie, Mitte x/y/z, Grösse b/h/t, Drehung
   * um y. Die Grundfläche ist das kleinste umschliessende Rechteck des
   * Bauteils, nicht seine achsparallele Box.
   */
  koerper: number[];
  STRANG_STRIDE: number;
  /**
   * Eine Leitung je acht Zahlen: Medium, von x/y/z, nach x/y/z, Radius. Die
   * Achse steht als IfcDistributionPort an beiden Enden im Modell.
   */
  straenge: number[];
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
    gezeichnet: { quelle: string; klasse: string; als: string; n: number }[];
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
