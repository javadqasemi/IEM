"""
Schnitt aus dem echten Projektmodell.

Liest die IFC-Dateien in `ifc/` — das Fachmodell zum Projekt *Guglera,
Giffers* (Architektur, Heizung, Lüftung) — und legt eine Schnittebene
hindurch. Ergebnis sind 2D-Polylinien in Schnittkoordinaten, aus denen
`build_svg_ifc.py` die Hero-Zeichnung erzeugt.

Anders als `model.py` wird hier **nichts modelliert**. Jede Linie und jeder
Messwert in diesem Modul stammt aus den IFC-Dateien; erfunden ist allein die
Lage der Schnittebene.

Zwei getrennte Verfahren, weil Bau und Technik im IFC verschieden beschrieben
sind:

* **Rohbau** — Wände und Decken liegen als Dreiecksnetz vor. Die Ebene wird
  mit jedem Dreieck geschnitten; das ergibt echte Schnittkanten, wie sie ein
  Schnitt zeigt. Aus den Schnipseln werden Polylinien geknüpft (`chain`) und
  danach geglättet (`simplify`), sonst stünden ~14'000 Einzelstriche im SVG.

* **Technik** — Rohre und Kanäle tragen ihre Achse als `IfcDistributionPort`
  an beiden Enden. Das ist bereits die Einstrichdarstellung, die ein Schnitt
  1:200 zeigt; die Netze werden also nicht geschnitten, sondern aus einem
  Band um die Ebene herum auf sie projiziert. Ein Schnitt ohne Band zeigte
  nur die zufällig getroffenen Stränge, und die Aussage der Zeichnung ist die
  Verteilung im Gebäude, nicht der Zufall der Ebene.

Achsen: die Ebene steht auf der Gebäudelängsachse (Welt-X), die Zeichnung
läuft also in Welt-Y (waagrecht) und Welt-Z (senkrecht).
"""

from __future__ import annotations

import collections
import math
import pathlib

import numpy as np

IFC_DIR = pathlib.Path(__file__).parent.parent / "ifc"

ARCHITEKTUR = IFC_DIR / "4723_Architektur.ifc"
HEIZUNG = IFC_DIR / "4723_Heizung.ifc"
LUEFTUNG = IFC_DIR / "4723_Lüftung.ifc"

# --- Schnittebene ----------------------------------------------------------
# x = 5.00 m schneidet den Steigzonenbereich: dort stehen die Lüftungsstränge
# über alle neun Geschosse, und der Schnitt zeigt gleichzeitig die volle
# Staffelung des Baukörpers. Kandidaten x = 2/8/11/14 zeigen weniger.
SCHNITT_X = 5.00
# Halbe Bandbreite fuer die Technik. 8 m nimmt die Verteilung je Geschoss und
# die Heizzentrale mit; ab etwa 12 m legt sich der uebernaechste Strang ueber
# die Zeichnung und sie wird Brei.
BAND = 8.00

# Rohbau, den der Schnitt zeigt. Fenster und Tueren bleiben draussen — bei
# 1:200 auf Hero-Groesse sind sie nur noch Rauschen.
ROHBAU = ("IfcWallStandardCase", "IfcWall", "IfcSlab")

# --- Medien ----------------------------------------------------------------
# IFC-System -> (Schluessel, Anzeigename, Gewerk). Die Namen sind die des
# Planers; zusammengefasst wird nur, was in der Zeichnung dieselbe Linie ist.
SYSTEME = {
    "Vorlauf": ("heizwasser_vl", "Vorlauf", "Heizung"),
    "Vorlauf bestehend": ("heizwasser_vl", "Vorlauf", "Heizung"),
    "Rücklauf": ("heizwasser_rl", "Rücklauf", "Heizung"),
    "Rücklauf bestehend": ("heizwasser_rl", "Rücklauf", "Heizung"),
    "Kaltwasser VL": ("kaltwasser", "Kaltwasser", "Sanitär"),
    "Kaltwasser RL": ("kaltwasser", "Kaltwasser", "Sanitär"),
    "Zuluft": ("zuluft", "Zuluft", "Lüftung"),
    "Außenluft": ("zuluft", "Aussenluft", "Lüftung"),
    "Abluft": ("abluft", "Abluft", "Lüftung"),
    "Fortluft": ("abluft", "Fortluft", "Lüftung"),
}

# Zeichenreihenfolge und Gewichtung je Medium. `haupt` steuert die Deckkraft:
# Vor- und Ruecklauf tragen dieselbe Gewerkfarbe, der Ruecklauf laeuft blasser
# mit — ein zweiter Farbton je Gewerk waere ein Token mehr, das eine
# Disziplin und keine Richtung benennt.
MEDIEN = {
    "heizwasser_vl": {"gewerk": "Heizung", "haupt": True},
    "heizwasser_rl": {"gewerk": "Heizung", "haupt": False},
    "zuluft": {"gewerk": "Lüftung", "haupt": True},
    "abluft": {"gewerk": "Lüftung", "haupt": False},
    "kaltwasser": {"gewerk": "Sanitär", "haupt": True},
}


# ---------------------------------------------------------------------------
# IFC lesen
# ---------------------------------------------------------------------------

def rohbau_dreiecke(path=ARCHITEKTUR, klassen=ROHBAU):
    """Dreiecksnetz der Rohbauteile in Weltkoordinaten, **je Bauteil eine
    Liste** von (n, 3, 3).

    Bewusst nicht zusammengeworfen: geschnitten und verkettet wird bauteilweise,
    sonst laeuft `chain` an einer gemeinsamen Ecke von der einen Wand in die
    naechste und knuepft aus zwei Rechtecken einen sich selbst kreuzenden Zug.
    Als Flaeche gefuellt gibt das ausgemalte Raeume statt pochierter Waende.
    """
    import ifcopenshell
    import ifcopenshell.geom

    f = ifcopenshell.open(str(path))
    elements = [e for k in klassen for e in f.by_type(k)]
    if not elements:
        return []

    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)

    keep = {e.id() for e in elements}
    out: list[np.ndarray] = []
    it = ifcopenshell.geom.iterator(settings, f, 4, include=elements)
    if it.initialize():
        while True:
            shape = it.get()
            if shape.id in keep:
                v = np.asarray(shape.geometry.verts, dtype=np.float64).reshape(-1, 3)
                idx = np.asarray(shape.geometry.faces, dtype=np.int64).reshape(-1, 3)
                if len(idx):
                    out.append(v[idx])
            if not it.next():
                break
    return out


def rohbau_schnitt(path=ARCHITEKTUR, x: float = SCHNITT_X):
    """Schnittkanten des Rohbaus als Polylinien, bauteilweise verkettet."""
    lines = []
    for tris in rohbau_dreiecke(path):
        segs = schneide(tris, x)
        if len(segs):
            lines.extend(polylines(segs))
    return lines


# Bauteile, aus denen die Einstrichdarstellung besteht. Die Formstuecke
# gehoeren dazu: ohne sie klafft an jedem Bogen und jedem Abzweig eine Luecke,
# und ein Strang zerfaellt in Dutzende Striche statt einer Trasse.
TECHNIK = (
    "IfcPipeSegment", "IfcDuctSegment",
    "IfcPipeFitting", "IfcDuctFitting",
    "IfcDuctSilencer", "IfcDamper", "IfcValve",
)


def technik_achsen(path, klassen=TECHNIK):
    """Achsen der Rohr- und Kanalbauteile.

    Jedes Bauteil traegt seine Anschluesse als `IfcDistributionPort`; deren
    Lage ist die Achse. Bei mehr als zwei Ports (Abzweiger) wird das laengste
    Paar genommen — das ist der durchgehende Strang.

    Rueckgabe: Liste von (p0, p1, medium, ifc_element).
    """
    import ifcopenshell
    import ifcopenshell.util.placement as placement

    f = ifcopenshell.open(str(path))

    ports = collections.defaultdict(list)
    for rel in f.by_type("IfcRelConnectsPortToElement"):
        ports[rel.RelatedElement.id()].append(rel.RelatingPort)

    system_of: dict[int, str] = {}
    for rel in f.by_type("IfcRelAssignsToGroup"):
        group = rel.RelatingGroup
        if group.is_a("IfcSystem"):
            for obj in rel.RelatedObjects:
                system_of[obj.id()] = group.Name

    out = []
    segments = [e for k in klassen for e in f.by_type(k)]
    for el in segments:
        medium = SYSTEME.get(system_of.get(el.id(), ""))
        if medium is None:
            continue
        pts = [placement.get_local_placement(p.ObjectPlacement)[:3, 3]
               for p in ports[el.id()] if p.ObjectPlacement]
        if len(pts) < 2:
            continue
        best, best_len = None, -1.0
        for i in range(len(pts)):
            for j in range(i + 1, len(pts)):
                d = float(np.linalg.norm(pts[i] - pts[j]))
                if d > best_len:
                    best_len, best = d, (pts[i], pts[j])
        if best_len < 1e-4:
            continue
        out.append((best[0], best[1], medium[0], el))
    return f, out


# ---------------------------------------------------------------------------
# Schneiden und projizieren
# ---------------------------------------------------------------------------

def schneide(tris: np.ndarray, x: float = SCHNITT_X) -> np.ndarray:
    """Dreiecke gegen die Ebene x = const schneiden.

    Rueckgabe (n, 2, 2) in Schnittkoordinaten (u = Welt-Y, v = Welt-Z).
    """
    if len(tris) == 0:
        return np.zeros((0, 2, 2))

    d = tris[:, :, 0] - x
    hit = (d.min(1) <= 0) & (d.max(1) >= 0) & (d.max(1) > d.min(1))
    tris, d = tris[hit], d[hit]

    segs = []
    for tri, dd in zip(tris, d):
        pts = []
        for i in range(3):
            j = (i + 1) % 3
            a, b = dd[i], dd[j]
            if a == 0.0:
                pts.append((tri[i][1], tri[i][2]))
            elif (a < 0) < (b < 0) or (a > 0) < (b > 0):
                t = a / (a - b)
                p = tri[i] + t * (tri[j] - tri[i])
                pts.append((p[1], p[2]))
        uniq: list[tuple[float, float]] = []
        for p in pts:
            if not any(abs(p[0] - q[0]) < 1e-9 and abs(p[1] - q[1]) < 1e-9 for q in uniq):
                uniq.append(p)
        if len(uniq) == 2:
            segs.append(uniq)
    return np.asarray(segs) if segs else np.zeros((0, 2, 2))


def projiziere(achsen, x: float = SCHNITT_X, band: float = BAND):
    """Technikachsen im Band um die Ebene auf sie projizieren.

    Rueckgabe: dict medium -> Liste von ((u0, v0), (u1, v1)).
    """
    out = collections.defaultdict(list)
    for p0, p1, medium, _el in achsen:
        if abs((p0[0] + p1[0]) / 2 - x) > band:
            continue
        a = (float(p0[1]), float(p0[2]))
        b = (float(p1[1]), float(p1[2]))
        if math.dist(a, b) < 0.02:      # senkrecht zur Ebene: faellt auf einen Punkt
            continue
        out[medium].append((a, b))
    return out


# ---------------------------------------------------------------------------
# Polylinien knuepfen und glaetten
# ---------------------------------------------------------------------------

def chain(segs, tol: float = 0.004):
    """Strecken zu Polylinien verknuepfen.

    Der Dreiecksschnitt liefert pro Dreieck ein Schnipsel; nebeneinander
    liegende Schnipsel gehoeren zur selben Kante. Endpunkte werden auf ein
    Raster von `tol` gerundet und ueber einen Graphen zu Zuegen verkettet.

    Rueckgabe: Liste von (punkte, geschlossen).
    """
    def key(p):
        return (round(p[0] / tol), round(p[1] / tol))

    node: dict[tuple[int, int], tuple[float, float]] = {}
    edges: list[tuple] = []
    seen = set()
    for a, b in segs:
        ka, kb = key(a), key(b)
        if ka == kb:
            continue
        e = (ka, kb) if ka < kb else (kb, ka)
        if e in seen:
            continue
        seen.add(e)
        node.setdefault(ka, (float(a[0]), float(a[1])))
        node.setdefault(kb, (float(b[0]), float(b[1])))
        edges.append((ka, kb))

    adj = collections.defaultdict(list)
    for i, (ka, kb) in enumerate(edges):
        adj[ka].append(i)
        adj[kb].append(i)

    used = [False] * len(edges)

    def other(i, k):
        ka, kb = edges[i]
        return kb if k == ka else ka

    def walk(start):
        """Von `start` aus so weit wie moeglich laufen, immer geradeaus."""
        pts = [start]
        cur, prev_dir = start, None
        while True:
            cands = [i for i in adj[cur] if not used[i]]
            if not cands:
                break
            if prev_dir is None:
                pick = cands[0]
            else:
                # geradeaus bevorzugen, damit eine Ecke die Polylinie
                # beendet statt sie zufaellig um die Ecke zu ziehen
                def straightness(i):
                    n = node[other(i, cur)]
                    c = node[cur]
                    d = (n[0] - c[0], n[1] - c[1])
                    ln = math.hypot(*d) or 1.0
                    return (d[0] * prev_dir[0] + d[1] * prev_dir[1]) / ln
                pick = max(cands, key=straightness)
            used[pick] = True
            nxt = other(pick, cur)
            c, n = node[cur], node[nxt]
            ln = math.hypot(n[0] - c[0], n[1] - c[1]) or 1.0
            prev_dir = ((n[0] - c[0]) / ln, (n[1] - c[1]) / ln)
            pts.append(nxt)
            cur = nxt
            if cur == start:
                break
        return pts

    lines = []
    # zuerst offene Enden und Verzweigungen, damit Zuege nicht mitten in
    # einer geraden Kante anfangen; danach bleiben nur noch Ringe uebrig
    order = sorted(adj, key=lambda k: (len(adj[k]) == 2, k))
    for start in order:
        while any(not used[i] for i in adj[start]):
            pts = walk(start)
            if len(pts) < 2:
                break
            closed = len(pts) > 3 and pts[0] == pts[-1]
            coords = [node[k] for k in (pts[:-1] if closed else pts)]
            lines.append((coords, closed))
    return lines


def simplify(points, eps: float = 0.012):
    """Douglas-Peucker. Haelt die Zeichnung klein, ohne eine Ecke zu verlieren."""
    if len(points) < 3:
        return list(points)
    a, b = points[0], points[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    norm = math.hypot(dx, dy)
    worst, at = -1.0, 0
    for i in range(1, len(points) - 1):
        p = points[i]
        if norm < 1e-12:
            d = math.dist(p, a)
        else:
            d = abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / norm
        if d > worst:
            worst, at = d, i
    if worst <= eps:
        return [a, b]
    return simplify(points[:at + 1], eps)[:-1] + simplify(points[at:], eps)


def polylines(segs, tol: float = 0.004, eps: float = 0.012, min_len: float = 0.06):
    """chain + simplify, kurze Reste fallen raus."""
    out = []
    for pts, closed in chain(segs, tol):
        ring = pts + [pts[0]] if closed else pts
        pts = simplify(ring, eps)
        if closed:
            pts = pts[:-1]
            if len(pts) < 3:
                continue
        total = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
        if not closed and total < min_len:
            continue
        out.append((pts, closed))
    return out


# ---------------------------------------------------------------------------
# Geschosse
# ---------------------------------------------------------------------------

def geschosse(path=ARCHITEKTUR):
    """Geschosshoehen aus dem IFC, von unten nach oben.

    Die Geschosse heissen im Modell alle „Geschoss"; beschriftet wird deshalb
    mit der Hoehenkote, die tatsaechlich drinsteht — eine Benennung UG/EG/OG
    waere geraten, denn das Modell fuehrt kein Terrain.
    """
    import ifcopenshell

    f = ifcopenshell.open(str(path))
    levels = sorted({round(float(s.Elevation), 3)
                     for s in f.by_type("IfcBuildingStorey")
                     if s.Elevation is not None})
    return levels
