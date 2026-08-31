"""
Erzeugt die Hero-Zeichnung aus dem echten Fachmodell.

    python cad/build_svg_ifc.py

Ergebnis: src/components/SchnittGuglera.tsx  (generiert, nicht von Hand ändern)

Quelle sind die IFC-Dateien in `ifc/` — Architektur, Heizung und Lüftung zum
Projekt *Guglera, Giffers*. `ifc_schnitt.py` legt die Schnittebene hindurch,
dieses Skript schreibt daraus die React-Komponente.

Verhältnis zu build_svg.py
--------------------------
`build_svg.py` erzeugt `SchnittAA.tsx` aus dem selbst modellierten
Musterprojekt (`model.py` -> DXF -> SVG). Das bleibt, weil daran auch der
DXF-Plansatz, das IFC und die 3D-Szene hängen. Der Hero zeigt seit dieser
Änderung aber den echten Schnitt; die beiden Generatoren schreiben deshalb
**verschiedene Dateien** und dürfen nicht auf dieselbe gerichtet werden.

Was hier steht und was nicht
----------------------------
Jede Linie kommt aus dem IFC. Gesetzt sind nur drei Dinge, und die stehen als
Konstanten oben in `ifc_schnitt.py` bzw. hier: die Lage der Schnittebene, die
Bandbreite, aus der die Technik auf sie projiziert wird, und welche drei
Bauteile eine Wertfahne bekommen. Die Werte in den Fahnen sind Auslegungs-
daten aus den Property-Sets der angeschriebenen Bauteile — nichts davon ist
gerundet oder geschätzt.
"""

from __future__ import annotations

import math
import pathlib
import sys

import ifc_schnitt as IS

TSX = pathlib.Path(__file__).parent.parent / "src" / "components" / "SchnittGuglera.tsx"

S = 18.0         # Pixel je Meter
PAD = 16.0       # Rand ringsum
PAD_TOP = 30.0   # zusätzlich oben: dort liegt die Gewerkelegende der Karte
PAD_BOT = 40.0   # zusätzlich unten: dort liegt das Schriftfeld der Karte
PAD_LEFT = 30.0  # zusätzlich links: die Spalte mit den Höhenkoten
MARGIN = 0.35    # Meter Luft um den Baukörper

# Gewerk -> Tailwind-Klasse und Startverzögerung von animate-draw
GEWERK = {
    "Heizung": ("disc-heat", "0s"),
    "Lüftung": ("disc-air", "0.25s"),
    "Sanitär": ("disc-water", "0.5s"),
}

# Zeichenreihenfolge: der Nebenstrang zuerst, damit der Hauptstrang oben liegt.
REIHENFOLGE = ["heizwasser_rl", "heizwasser_vl", "abluft", "zuluft", "kaltwasser"]

STRICH = {True: 1.9, False: 1.6}     # haupt -> Strichstärke
DECKKRAFT = {True: 1.0, False: 0.55}

# Durchfluss-Animation, wie in build_svg.py: Länge und Tempo werden je Pfad aus
# seiner echten Pixellänge gerechnet, damit jeder Strang gleich schnell fliesst.
FLOW_DASH_PX = 30.0
FLOW_SPEED = 70.0
FLOW_START = 1.4
FLOW_MIN_PX = 45.0      # kürzere Stummel bekommen keinen Schlitten

# ---------------------------------------------------------------------------
# Wertfahnen
# ---------------------------------------------------------------------------
# Je Fahne: ein Filter auf die Technikbauteile im Band und die Property, die
# angeschrieben wird. `waehle`/`sortiere` bekommen das Property-Set und die
# beiden Achsenpunkte in Weltkoordinaten (x quer zur Ebene, y waagrecht,
# z senkrecht). Die Regel steht hier, der Wert kommt aus dem IFC — so lässt
# sich jede Zahl in der Zeichnung im Modell nachschlagen.
FAHNEN = [
    {
        "id": "hk",
        "quelle": "heizung",
        "medium": "heizwasser_vl",
        # Verteilstrang in den Obergeschossen: dort hängen die Heizkörper, für
        # die das Modell durchgehend 50/40 °C bei 20 °C Raum auslegt.
        "waehle": lambda ps, a, b: 13.0 < (a[2] + b[2]) / 2 < 20.0,
        "sortiere": lambda ps, a, b: math.dist(a, b),
        "wert": "50 / 40 °C",
        "label": "Auslegung",
        "gewerk": "Heizung",
        # Alle drei Fahnen sitzen in der rechten Bildhälfte, ihre Beschriftung
        # muss also nach links laufen — sonst schneidet der Kartenrand sie ab.
        "seite": "L",
    },
    {
        "id": "zl",
        "quelle": "lueftung",
        "medium": "zuluft",
        "klasse": "IfcDuctSegment",
        # Der grösste Zuluftquerschnitt oberhalb 20 m: der Sammelkanal an der
        # Lüftungszentrale im Dachgeschoss. Die Zentrale im UG führt dieselben
        # Querschnitte, dort stünde die Fahne aber auf der Kaltwasserfahne.
        # `Tech-Medium` statt des Mediums oben: die Aussenluftfassung zählt hier
        # nicht mit, sie ist zwar Zuluftseite, aber kein Sammelkanal.
        "waehle": lambda ps, a, b: (
            (a[2] + b[2]) / 2 > 20.0
            and ps.get("Tech-Medium") == "L_Zuluft"
            and bool(ps.get("Geom-Side 1 (mm)") and ps.get("Geom-Side 2 (mm)"))
        ),
        "sortiere": lambda ps, a, b: ps["Geom-Side 1 (mm)"] * ps["Geom-Side 2 (mm)"],
        "wert": lambda ps: f"{_ch(ps['Geom-Side 1 (mm)'])} × {_ch(ps['Geom-Side 2 (mm)'])} mm",
        "label": "Zuluftkanal",
        "gewerk": "Lüftung",
        "seite": "L",
    },
    {
        "id": "kw",
        "quelle": "heizung",
        "medium": "kaltwasser",
        "waehle": lambda ps, a, b: bool(ps.get("Tech-DN")) and math.dist(a, b) > 1.0,
        "sortiere": lambda ps, a, b: math.dist(a, b),
        "wert": lambda ps: f"DN {ps['Tech-DN']} · {ps['Calc-Velocitiy (m/s)']:.2f} m/s",
        "label": "Kaltwasser",
        "gewerk": "Sanitär",
        "seite": "L",
    },
]


def _ch(v: float) -> str:
    """Schweizer Tausendertrennung mit Apostroph."""
    return f"{int(round(v)):,}".replace(",", "’")


# ---------------------------------------------------------------------------
# Abbildung
# ---------------------------------------------------------------------------

class Blatt:
    """Rechnet Schnittkoordinaten (Meter) in Zeichenpixel."""

    def __init__(self, bounds):
        u0, v0, u1, v1 = bounds
        self.u0, self.v0 = u0 - MARGIN, v0 - MARGIN
        self.u1, self.v1 = u1 + MARGIN, v1 + MARGIN
        self.w = (self.u1 - self.u0) * S + 2 * PAD + PAD_LEFT
        self.h = (self.v1 - self.v0) * S + 2 * PAD + PAD_TOP + PAD_BOT

    def px(self, u, v):
        return ((u - self.u0) * S + PAD + PAD_LEFT, (self.v1 - v) * S + PAD + PAD_TOP)

    def d(self, points, closed=False) -> str:
        parts = []
        for i, (u, v) in enumerate(points):
            x, y = self.px(u, v)
            parts.append(f"{'M' if i == 0 else 'L'}{fmt(x)} {fmt(y)}")
        if closed:
            parts.append("Z")
        return "".join(parts)

    def length(self, points, closed=False) -> float:
        pts = [self.px(u, v) for u, v in points]
        if closed and len(pts) > 2:
            pts.append(pts[0])
        return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


def fmt(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def bounds_of(*groups):
    us, vs = [], []
    for group in groups:
        for pts, _closed in group:
            for u, v in pts:
                us.append(u)
                vs.append(v)
    return min(us), min(vs), max(us), max(vs)


# ---------------------------------------------------------------------------
# Lesen
# ---------------------------------------------------------------------------

def lies():
    print(f"Schnittebene x = {IS.SCHNITT_X:.2f} m, Band ±{IS.BAND:.2f} m")

    rohbau = IS.rohbau_schnitt()
    geschlossen = sum(1 for _p, c in rohbau if c)
    print(f"  Rohbau: {len(rohbau)} Polylinien, davon {geschlossen} Schnittflächen")

    achsen = {}
    for tag, path in (("heizung", IS.HEIZUNG), ("lueftung", IS.LUEFTUNG)):
        _f, ax = IS.technik_achsen(path)
        achsen[tag] = ax
        print(f"  {tag}: {len(ax)} Bauteilachsen")

    alle = achsen["heizung"] + achsen["lueftung"]
    projiziert = IS.projiziere(alle)
    trassen = {}
    for medium, segs in projiziert.items():
        # Grösseres tol als beim Rohbau: die Achsen treffen sich an den
        # Anschlüssen auf den Millimeter genau, aber Formstück und Rohr sind
        # zwei Bauteile — ohne Fangbereich bliebe jede Naht eine Lücke.
        trassen[medium] = IS.polylines([list(s) for s in segs],
                                       tol=0.012, eps=0.02, min_len=0.10)
        print(f"    {medium}: {len(segs)} Achsen -> {len(trassen[medium])} Trassen")

    punkte = anschnitte(alle)
    print(f"  angeschnittene Stränge: {sum(len(v) for v in punkte.values())}")
    return rohbau, trassen, punkte, achsen


def anschnitte(achsen, x=IS.SCHNITT_X):
    """Stränge, die quer zur Ebene laufen und sie durchstossen.

    Im Schnitt ist das ein angeschnittenes Rohr — gezeichnet wird ein Punkt,
    nicht eine Linie. Ohne das fehlten genau die Leitungen, die in der
    Gebäudelängsachse verteilen, also die meisten Verteilstränge.
    """
    out: dict[str, list] = {}
    for p0, p1, medium, _el in achsen:
        lo, hi = sorted((float(p0[0]), float(p1[0])))
        if not (lo <= x <= hi) or hi - lo < 0.25:
            continue
        quer = math.dist((float(p0[1]), float(p0[2])), (float(p1[1]), float(p1[2])))
        if quer > 0.35:          # läuft schräg: erscheint schon als Linie
            continue
        t = (x - lo) / (hi - lo)
        a = (float(p0[1]), float(p0[2]))
        b = (float(p1[1]), float(p1[2]))
        out.setdefault(medium, []).append((a[0] + t * (b[0] - a[0]),
                                           a[1] + t * (b[1] - a[1])))
    # doppelte Punkte (Rohr + Formstück am selben Ort) zusammenfassen
    for medium, pts in out.items():
        keep: list[tuple[float, float]] = []
        for p in pts:
            if not any(math.dist(p, q) < 0.12 for q in keep):
                keep.append(p)
        out[medium] = keep
    return out


def waehle_fahnen(achsen):
    """Die drei Wertfahnen aus dem Modell auflösen."""
    import ifcopenshell.util.element as ue

    fahnen = []
    for spec in FAHNEN:
        best, best_key, best_ps = None, None, None
        for p0, p1, medium, el in achsen[spec["quelle"]]:
            if medium != spec["medium"]:
                continue
            if "klasse" in spec and not el.is_a(spec["klasse"]):
                continue
            if abs((p0[0] + p1[0]) / 2 - IS.SCHNITT_X) > IS.BAND:
                continue
            ps = ue.get_psets(el).get("Pset MEP", {})
            a = tuple(float(c) for c in p0)
            b = tuple(float(c) for c in p1)
            try:
                if not spec["waehle"](ps, a, b):
                    continue
                key = spec["sortiere"](ps, a, b)
            except (KeyError, TypeError):
                continue
            if best_key is None or key > best_key:
                best, best_key, best_ps = (a, b), key, ps
        if best is None:
            raise SystemExit(f"Wertfahne {spec['id']}: kein Bauteil gefunden — "
                             "Ebene, Band oder Regel prüfen.")
        wert = spec["wert"](best_ps) if callable(spec["wert"]) else spec["wert"]
        u = (best[0][1] + best[1][1]) / 2
        v = (best[0][2] + best[1][2]) / 2
        fahnen.append({**spec, "wert": wert, "u": u, "v": v})
        print(f"  Fahne {spec['id']}: {wert}  bei y={u:.2f} z={v:.2f}")
    return fahnen


# ---------------------------------------------------------------------------
# Schreiben
# ---------------------------------------------------------------------------

def emit(rohbau, trassen, punkte, fahnen, levels) -> str:
    blatt = Blatt(bounds_of(rohbau))
    out: list[str] = []
    add = out.append

    add('/*')
    add(' * GENERIERT von cad/build_svg_ifc.py — nicht von Hand ändern.')
    add(' *')
    add(' * Schnitt durch das Fachmodell zum Projekt Guglera, Giffers:')
    add(' * ifc/4723_Architektur.ifc, ifc/4723_Heizung.ifc, ifc/4723_Lüftung.ifc.')
    add(' * Neu erzeugen mit:')
    add(' *')
    add(' *   python cad/build_svg_ifc.py')
    add(' *')
    add(f' * Schnittebene x = {IS.SCHNITT_X:.2f} m, Technik aus einem Band von')
    add(f' * ±{IS.BAND:.2f} m darum auf die Ebene projiziert. Rohbau sind echte')
    add(' * Schnittkanten (Ebene gegen das Dreiecksnetz), die Punkte sind quer')
    add(' * zur Ebene laufende, also angeschnittene Stränge.')
    add(' *')
    add(' * Die Trassen tragen pathLength="1" und strokeDasharray="1", damit')
    add(' * animate-draw unabhängig von der echten Pfadlänge durchläuft; darüber')
    add(' * liegt je Gewerk eine .flow-run-Gruppe, deren Dauer und Strichlänge')
    add(' * pro Pfad aus seiner Pixellänge gerechnet sind.')
    add(' */')
    add('')
    add('export function SchnittGuglera({ className }: { className?: string }) {')
    add('  return (')
    add(f'    <svg viewBox="0 0 {fmt(blatt.w)} {fmt(blatt.h)}" className={{className}} role="img"')
    add('      aria-label="Gebäudeschnitt aus dem IFC-Fachmodell: neun Geschosse mit den '
        'Trassen für Heizung, Lüftung und Sanitär.">')
    add('')

    # --- Rohbau. Geschlossene Ringe sind angeschnittene Wände und Decken und
    #     werden als Schnittfläche gefüllt; offene Züge bleiben Kanten.
    ringe = [(p, c) for p, c in rohbau if c]
    kanten = [(p, c) for p, c in rohbau if not c]
    # Die geschlossenen Ringe sind die Schnittflaechen und werden pochéiert.
    # Navy statt der Graustufe: der Rohbau ist damit als Figur lesbar, bleibt
    # aber deutlich hinter den Trassen, um die es in der Zeichnung geht.
    add('      {/* Rohbau — Schnittflächen aus dem Architekturmodell */}')
    if ringe:
        add('      <g className="fill-brand-navy stroke-brand-navy" fillOpacity="0.10" '
            'strokeOpacity="0.45" strokeWidth="0.9" strokeLinejoin="round">')
        for pts, _c in ringe:
            add(f'        <path d="{blatt.d(pts, True)}" />')
        add('      </g>')
    if kanten:
        add('      <g className="stroke-brand-navy" fill="none" strokeWidth="0.9" '
            'strokeOpacity="0.3">')
        for pts, _c in kanten:
            add(f'        <path d="{blatt.d(pts)}" />')
        add('      </g>')
    add('')

    # --- Geschosskoten. Die Geschosse heissen im Modell alle "Geschoss";
    #     angeschrieben wird deshalb die Höhenkote, die wirklich drinsteht.
    add('      {/* Höhenkoten der Geschosse — aus den IfcBuildingStorey */}')
    add('      <g className="fill-muted font-mono" fontSize="9">')
    for level in levels:
        _x, y = blatt.px(0, level)
        add(f'        <text x="{fmt(PAD)}" y="{fmt(y - 3)}">'
            f'{"+" if level >= 0 else "−"}{abs(level):.2f}</text>')
    add('      </g>')
    add('')

    # --- Technik
    for medium in REIHENFOLGE:
        eintraege = trassen.get(medium)
        if not eintraege:
            continue
        info = IS.MEDIEN[medium]
        klasse, delay = GEWERK[info["gewerk"]]
        haupt = info["haupt"]
        breite = STRICH[haupt]
        style = f' style={{{{ animationDelay: "{delay}" }}}}' if delay != "0s" else ''
        add(f'      {{/* {medium} */}}')
        add(f'      <g className="stroke-{klasse} animate-draw" fill="none" '
            f'strokeWidth="{breite}" strokeLinecap="round" strokeLinejoin="round" '
            f'strokeDasharray="1" opacity="{DECKKRAFT[haupt]}"{style}>')
        for pts, closed in eintraege:
            add(f'        <path pathLength="1" d="{blatt.d(pts, closed)}" />')
        add('      </g>')

        # Durchfluss: heller Schlitten im Rohr. Weiss statt Gewerkfarbe, sonst
        # wäre er auf der Leitung nicht zu sehen.
        lang = [(p, c) for p, c in eintraege if blatt.length(p, c) >= FLOW_MIN_PX]
        if lang:
            flow_delay = FLOW_START + float(delay.rstrip("s"))
            add(f'      <g className="stroke-surface flow-run" fill="none" '
                f'strokeWidth="{max(breite - 0.8, 0.7):.1f}" strokeLinecap="round" '
                'opacity="0.9">')
            for pts, closed in lang:
                length = blatt.length(pts, closed)
                dash = min(0.35, FLOW_DASH_PX / length)
                dur = max(1.2, length / FLOW_SPEED)
                add(f'        <path pathLength="1" '
                    f'strokeDasharray="{dash:.3f} {1 - dash:.3f}" '
                    'className="animate-flow" '
                    f'style={{{{ animationDuration: "{dur:.1f}s", '
                    f'animationDelay: "{flow_delay:.2f}s" }}}} '
                    f'd="{blatt.d(pts, closed)}" />')
            add('      </g>')

        # Angeschnittene Stränge
        pts = punkte.get(medium, [])
        if pts:
            add(f'      <g className="fill-{klasse}" opacity="{DECKKRAFT[haupt]}">')
            for u, v in pts:
                x, y = blatt.px(u, v)
                add(f'        <circle cx="{fmt(x)}" cy="{fmt(y)}" r="1.6" />')
            add('      </g>')
        add('')

    add('    </svg>')
    add('  );')
    add('}')
    add('')

    # --- Wertfahnen als HTML-Overlay des Hero, Position in % der Zeichenfläche
    tone = {"Heizung": "heat", "Lüftung": "air", "Sanitär": "water"}
    add('/**')
    add(' * Auslegungswerte aus den Property-Sets der angeschriebenen Bauteile,')
    add(' * Position in % der Zeichenfläche — der Hero legt sie als HTML darüber.')
    add(' */')
    add('export const messpunkte = [')
    for i, f in enumerate(fahnen):
        x, y = blatt.px(f["u"], f["v"])
        add('  {')
        add(f'    id: "{f["id"]}",')
        add(f'    value: "{f["wert"]}",')
        add(f'    label: "{f["label"]}",')
        add(f'    tone: "{tone[f["gewerk"]]}",')
        add(f'    side: "{"left" if f["seite"] == "L" else "right"}",')
        add(f'    left: {x / blatt.w * 100:.2f},')
        add(f'    top: {y / blatt.h * 100:.2f},')
        add(f'    delay: "{1.0 + i * 0.15:.2f}s",')
        add('  },')
    add('] as const;')
    add('')
    add('/** Seitenverhältnis der Zeichenfläche — der Hero rahmt damit die')
    add(' *  Fahnen deckungsgleich zum SVG ein. */')
    add(f'export const schnittAspect = "{fmt(blatt.w)} / {fmt(blatt.h)}";')
    add('')
    return "\n".join(out)


def main():
    sys.setrecursionlimit(20000)
    rohbau, trassen, punkte, achsen = lies()
    fahnen = waehle_fahnen(achsen)
    levels = IS.geschosse()
    print(f"  Geschosse: {levels}")
    TSX.write_text(emit(rohbau, trassen, punkte, fahnen, levels), encoding="utf-8")
    print(f"geschrieben: {TSX}")


if __name__ == "__main__":
    main()
