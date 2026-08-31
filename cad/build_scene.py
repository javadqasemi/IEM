"""
Erzeugt aus model.py die Geometrie fuer die 3D-Szene im Ablauf-Abschnitt.

    python cad/build_scene.py

Ergebnis: src/generated/scene.ts  (generiert, nicht von Hand aendern)

Warum ein eigener Exporter und nicht die Zahlen im TSX
-----------------------------------------------------
Dieselbe Regel wie bei build_svg.py: model.py ist die einzige Quelle. Der
Schnitt im Hero, das DXF-Planblatt, das IFC-Modell und diese Szene zeigen
dasselbe Gebaeude, also duerfen sie nicht aus vier getippten Zahlensaetzen
kommen. Aendert sich eine Geschosshoehe, laufen alle vier neu.

Die Straenge liegen auf y = DEPTH/2 - **exakt dort, wo build_ifc.py sie
setzt**. Der Schnitt A-A sagt ueber die Tiefe nichts aus (er schneidet quer
dazu), und zwei Generatoren, die sich die Tiefe unabhaengig ausdenken, waeren
zwei verschiedene Gebaeude.

Medien statt Gewerke
--------------------
Der Hero-Schnitt zeigt je Gewerk eine Linie - richtig fuer ein Schema. Diese
Szene zeigt die gebaute Anlage, also die Medien einzeln: Vorlauf und Ruecklauf,
Kalt- und Warmwasser, Abwasser, Zu- und Abluft. Die Reihenfolge der Punkte je
Polylinie ist die **Fliessrichtung** - der Schlitten in der Szene laeuft ihr
nach, es gibt keine zweite Stelle, an der eine Richtung gepflegt wird.

Menschen im Modell
------------------
Planer, Installateur und Nutzer stehen an Orten, die aus der Anlage folgen:
der Installateur am Steigstrang im UG, der Nutzer beim Heizkoerper im 1. OG,
der Planer draussen am Rechner. Auch diese Punkte werden hier gerechnet, damit
sie mitwandern, wenn sich das Gebaeude aendert.

Achsen
------
model.py rechnet bauueblich: x quer, z Hoehe ueber EG. Three.js rechnet
y = oben. Die Umrechnung passiert **hier**, nicht in der Komponente, damit im
TSX keine zweite Koordinatenkonvention mitgefuehrt werden muss:

    three.x = model.x - WIDTH/2      (Gebaeudemitte auf 0)
    three.y = model.z                (Hoehe bleibt Hoehe)
    three.z = model.y - DEPTH/2      (Gebaeudemitte auf 0)
"""

from __future__ import annotations

import math
import pathlib

import model as M

TS = pathlib.Path(__file__).parent.parent / "src" / "generated" / "scene.ts"

Y_RUNS = M.DEPTH / 2.0     # Lage der Straenge in der Tiefe, wie im IFC


def hexcolor(rgb) -> str:
    return "#%02X%02X%02X" % rgb


def p3(x: float, z: float, y: float = Y_RUNS) -> tuple[float, float, float]:
    """model (x quer, y tief, z hoch) -> three (x, y hoch, z tief), zentriert."""
    return (
        round(x - M.WIDTH / 2.0, 3),
        round(z, 3),
        round(y - M.DEPTH / 2.0, 3),
    )


def fmt_pt(p) -> str:
    return "[" + ", ".join(f"{v:g}" for v in p) + "]"


def fmt_line(points) -> str:
    return "[" + ", ".join(fmt_pt(p) for p in points) + "]"


# ---------------------------------------------------------------------------
# Straenge je Medium, Punktreihenfolge = Fliessrichtung
# ---------------------------------------------------------------------------

def tee(point, axis, branch):
    """Ein T-Stueck: Punkt, Richtung des durchgehenden Strangs, Richtung des
    Abgangs. Die Szene setzt daraus Muffe und Stutzen - ohne das stossen zwei
    Rohre nur aneinander, und genau so sieht es dann auch aus."""
    return {"at": point, "axis": axis, "branch": branch}


UP = (0, 1, 0)
DOWN = (0, -1, 0)
PLUS_X = (1, 0, 0)
MINUS_X = (-1, 0, 0)

VERTEILER_OBEN = M.VERTEILER["z"] + M.VERTEILER["hoehe"] / 2.0

# Geraeteachse: Heizkoerper und Verteiler haengen zwischen Vor- und Ruecklauf.
# Eine Leitung, die auf ihrer eigenen Trassenachse bleibt, laeuft am Geraet
# vorbei - deshalb hat jeder Anschluss einen Versatz in die Geraeteachse.
Y_GERAET = (M.Y_TRASSE["heizwasser_vl"] + M.Y_TRASSE["heizwasser_rl"]) / 2.0

# Dasselbe fuer das Waschbecken: es haengt zwischen Kalt-, Warm- und
# Abwasserachse, alle drei setzen dorthin ueber.
Y_BECKEN = (M.Y_TRASSE["kaltwasser"] + M.Y_TRASSE["abwasser"]) / 2.0

# Die beiden Armaturenzulaeufe stehen hinter dem Becken und weit genug
# auseinander, dass der Ablauf in der Mitte zwischen ihnen Platz hat. Ohne
# diesen Versatz meldet die Kollisionspruefung kaltwasser x abwasser - die
# 55-mm-Ablaufleitung braucht mehr Luft als zwei 20-mm-Rohre.
BECKEN_ANSCHLUSS_DX = 0.20
Y_ARMATUR = Y_BECKEN - 0.12

HK_OBEN = M.HEIZUNG["branches"][0]  # nur als Platzhalter, siehe hk_geometrie


def hk_geometrie(i):
    """Mitte, Oberkante und die beiden Anschlusspunkte eines Heizkoerpers."""
    hk = M.HEIZKOERPER
    x = M.HEIZUNG["branch_x"]
    z_mitte = M.HEIZUNG["branches"][i] - hk["unter_leitung"]
    return {
        "x": x,
        "z_mitte": z_mitte,
        "z_oben": z_mitte + hk["hoehe"] / 2.0,
        "x_vl": x - hk["anschluss_x"],
        "x_rl": x + hk["anschluss_x"],
    }


def heizwasser_vl(y):
    h = M.HEIZUNG
    lines = [[p3(h["riser_x"], h["z_bottom"], y), p3(h["riser_x"], h["z_top"], y)]]
    fittings = []
    for i, z in enumerate(h["branches"]):
        if i == 0:
            # EG: der Abgang laeuft nicht ins Leere, sondern hinunter in den
            # Heizkreisverteiler der Bodenheizung. Der Versatz in die
            # Geraeteachse ist der Grund, warum das hier drei Punkte mehr sind
            # als eine gerade Linie - ohne ihn endet das Rohr neben dem Kasten.
            xv = M.VERTEILER["x"] - 0.20
            lines.append([
                p3(h["riser_x"], z, y),
                p3(xv, z, y),
                p3(xv, z, Y_GERAET),
                p3(xv, VERTEILER_OBEN, Y_GERAET),
            ])
        else:
            # Vorlauf in den linken Anschluss des Heizkoerpers: waagrecht auf
            # der Trassenachse, Versatz in die Geraeteachse, dann hinunter auf
            # die Oberkante.
            g = hk_geometrie(i)
            lines.append([
                p3(h["riser_x"], z, y),
                p3(g["x_vl"], z, y),
                p3(g["x_vl"], z, Y_GERAET),
                p3(g["x_vl"], g["z_oben"], Y_GERAET),
            ])
        fittings.append(tee(p3(h["riser_x"], z, y), UP, PLUS_X))
    return lines, fittings


def heizwasser_rl(y):
    """Zurueck von Heizkoerper und Verteiler in den Ruecklauf und zur WP."""
    h = M.HEIZUNG
    x = h["riser_x"] + M.RL_DX
    lines = []
    fittings = []
    for i, z in enumerate(h["branches"]):
        if i == 0:
            xv = M.VERTEILER["x"] + 0.20
            lines.append([
                p3(xv, VERTEILER_OBEN, Y_GERAET),
                p3(xv, z, Y_GERAET),
                p3(xv, z, y),
                p3(x, z, y),
            ])
        else:
            # Ruecklauf aus dem rechten Anschluss: von der Oberkante hoch,
            # zurueck auf die eigene Trassenachse, dann zum Strang.
            g = hk_geometrie(i)
            lines.append([
                p3(g["x_rl"], g["z_oben"], Y_GERAET),
                p3(g["x_rl"], z, Y_GERAET),
                p3(g["x_rl"], z, y),
                p3(x, z, y),
            ])
        fittings.append(tee(p3(x, z, y), UP, PLUS_X))
    lines.append([p3(x, h["z_top"], y), p3(x, h["z_bottom"], y)])
    return lines, fittings


def bodenheizung(y):
    """Eine Heizschlange im EG-Ueberzug, vom Verteiler aus verlegt.

    Maeander in der Bodenebene: Zuege in x, Versatz in der Gebaeudetiefe. Die
    Rueckleitung laeuft hinter dem letzten Zug zurueck zum Verteiler, wie eine
    reale Schleife, die dort anfaengt und aufhoert wo der Verteiler haengt.
    """
    b = M.BODENHEIZUNG
    v = M.VERTEILER
    z = b["z"]
    pts = [p3(v["x"], VERTEILER_OBEN - 0.20, y), p3(v["x"], z, y)]

    n = int((b["y_bis"] - b["y_von"]) / b["verlegeabstand"])
    pts.append(p3(b["x_von"], z, b["y_von"]))
    for i in range(n):
        y = b["y_von"] + i * b["verlegeabstand"]
        a, e = (b["x_von"], b["x_bis"]) if i % 2 == 0 else (b["x_bis"], b["x_von"])
        pts.append(p3(a, z, y))
        pts.append(p3(e, z, y))
    y_end = b["y_von"] + (n - 1) * b["verlegeabstand"]
    pts.append(p3(v["x"], z, y_end + b["verlegeabstand"] / 2.0))
    pts.append(p3(v["x"], VERTEILER_OBEN - 0.20, y))
    return [pts], []


def zuluft(y):
    l = M.LUEFTUNG
    lines = [[p3(l["x_start"], l["z_main"], y), p3(l["x_end"], l["z_main"], y)]]
    fittings = []
    for x, z_u in l["drops"]:
        lines.append([p3(x, l["z_main"], y), p3(x, z_u, y)])
        fittings.append(tee(p3(x, l["z_main"], y), PLUS_X, DOWN))
    t = l["tail"]
    lines.append([
        p3(t["x"], l["z_main"], y),
        p3(t["x"], t["z"], y),
        p3(t["x_to"], t["z"], y),
    ])
    return lines, fittings


def abluft(y):
    """Aus den Raeumen hoch in den Abluftkanal und zurueck zur Zentrale."""
    l = M.LUEFTUNG
    z_kanal = l["z_main"] + M.ABL_DZ
    lines = []
    fittings = []
    for x, _z_u in l["drops"]:
        lines.append([p3(x, M.ABL_Z_UNTEN, y), p3(x, z_kanal, y)])
        fittings.append(tee(p3(x, z_kanal, y), PLUS_X, DOWN))
    lines.append([p3(l["x_end"], z_kanal, y), p3(l["x_start"], z_kanal, y)])
    return lines, fittings


def kaltwasser(y):
    """Steigstrang und zwei Abgaenge: einer aufs Waschbecken, einer als
    Zapfstelle an der Wand."""
    s = M.SANITAER
    b = M.WASCHBECKEN
    lines = [[p3(s["riser_x"], s["z_bottom"], y), p3(s["riser_x"], s["z_top"], y)]]
    fittings = []
    for i, (z, x_to) in enumerate(s["branches"]):
        if i == 0:
            # Auf die Achse des Beckens versetzen und auf die Armatur hinunter.
            xa = x_to - BECKEN_ANSCHLUSS_DX
            lines.append([
                p3(s["riser_x"], z, y),
                p3(xa, z, y),
                p3(xa, z, Y_ARMATUR),
                p3(xa, b["z"] + 0.24, Y_ARMATUR),
            ])
        else:
            lines.append([p3(s["riser_x"], z, y), p3(x_to, z, y)])
        fittings.append(tee(p3(s["riser_x"], z, y), UP, MINUS_X))
    return lines, fittings


def warmwasser(y):
    """Vom Speicher im UG zu denselben Entnahmestellen, leicht versetzt."""
    s = M.SANITAER
    b = M.WASCHBECKEN
    x = s["riser_x"] + M.WW_DX
    lines = [[p3(x, s["z_bottom"], y), p3(x, s["z_top"], y)]]
    fittings = []
    for i, (z, x_to) in enumerate(s["branches"]):
        zb = z + 0.18
        if i == 0:
            xa = x_to + BECKEN_ANSCHLUSS_DX
            lines.append([
                p3(x, zb, y),
                p3(xa, zb, y),
                p3(xa, zb, Y_ARMATUR),
                p3(xa, b["z"] + 0.24, Y_ARMATUR),
            ])
        else:
            lines.append([p3(x, zb, y), p3(x_to, zb, y)])
        fittings.append(tee(p3(x, zb, y), UP, MINUS_X))
    return lines, fittings


def abwasser(y):
    """Vom Becken in den Fallstrang und unter die UG-Sohle."""
    s = M.SANITAER
    b = M.WASCHBECKEN
    x = s["riser_x"] + M.AW_DX
    lines = []
    fittings = []
    z_top = None
    for i, (z, x_to) in enumerate(s["branches"]):
        z_ab = z - 0.25
        if i == 0:
            # Der Ablauf beginnt unter dem Becken, nicht an der Wand daneben.
            lines.append([
                p3(b["x"], b["z"] - 0.10, Y_BECKEN),
                p3(b["x"], z_ab, Y_BECKEN),
                p3(b["x"], z_ab, y),
                p3(x, z_ab, y),
            ])
        else:
            lines.append([p3(x_to, z_ab, y), p3(x, z_ab, y)])
        fittings.append(tee(p3(x, z_ab, y), UP, MINUS_X))
        z_top = z_ab if z_top is None else max(z_top, z_ab)
    lines.append([p3(x, z_top, y), p3(x, M.AW_Z_BOTTOM, y)])
    return lines, fittings


# (Medium-Key, Radius in m, Polylinien-Funktion). Radien aus den DN-Angaben
# des Schemas; Abwasser und Kanaele sind groesser, weil sie es real sind.
RUNS = [
    ("heizwasser_vl", M.HEIZUNG["dn_riser"] / 2000.0, heizwasser_vl),
    ("heizwasser_rl", M.HEIZUNG["dn_riser"] / 2000.0, heizwasser_rl),
    ("bodenheizung", M.BODENHEIZUNG["dn"] / 2000.0, bodenheizung),
    ("zuluft", 0.125, zuluft),
    ("abluft", 0.11, abluft),
    ("kaltwasser", M.SANITAER["dn_riser"] / 2000.0, kaltwasser),
    ("warmwasser", M.SANITAER["dn_branch"] / 2000.0, warmwasser),
    ("abwasser", 0.055, abwasser),
]


# ---------------------------------------------------------------------------
# Gebaeudehuelle
# ---------------------------------------------------------------------------

def box(kind, x0, x1, z0, z1, y0, y1, phase="roh"):
    """Ein Huellenteil als Quader, in Modellkoordinaten begrenzt."""
    cx, cy, cz = p3((x0 + x1) / 2.0, (z0 + z1) / 2.0, (y0 + y1) / 2.0)
    return {
        "kind": kind,
        "phase": phase,
        "center": (round(cx, 3), round(cy, 3), round(cz, 3)),
        "size": (round(abs(x1 - x0), 3), round(abs(z1 - z0), 3), round(abs(y1 - y0), 3)),
    }


def envelope():
    """Die Huelle als Liste von Quadern.

    `phase` steuert, wann ein Teil in der Szene erscheint: "roh" mit dem
    Rohbau im zweiten Akt, "ausbau" erst im dritten. Das ist die Reihenfolge
    einer Baustelle - erst Decken und Traeger, dann Fassade und Glas.
    """
    h = M.HUELLE
    parts = []
    W, D = M.WIDTH, M.DEPTH
    ov = h["ueberstand"]
    t = h["dach_dicke"]
    stein_x0, stein_x1 = h["stein_x"]
    vs = h["stein_vorstand"]
    setback = h["attika_versatz"]

    top = next(s for s in M.STOREYS if s[0] == "2. OG")
    og2_base, og2_h = top[1], top[2]

    # --- Flachdaecher ----------------------------------------------------
    # Ueber dem zurueckspringenden Obergeschoss ...
    parts.append(box("dach", -ov, stein_x0 + ov, M.ROOF_LEVEL, M.ROOF_LEVEL + t,
                     setback - ov, D + ov))
    # ... ueber dem Steinvolumen ...
    parts.append(box("dach", stein_x0 - 0.2, stein_x1 + ov, M.ROOF_LEVEL, M.ROOF_LEVEL + t,
                     -vs - ov, D + vs + ov))
    # ... und ueber dem 1. OG, wo das oberste Geschoss zurueckspringt: das ist
    # zugleich der Boden der Dachterrasse.
    parts.append(box("dach", -ov, stein_x0 + ov, og2_base - t, og2_base,
                     -ov, setback))

    # --- Steinvolumen ----------------------------------------------------
    parts.append(box("stein", stein_x0, stein_x1, M.BASEMENT_LEVEL, M.ROOF_LEVEL,
                     -vs, D + vs, phase="ausbau"))

    # --- Fensterbaender je Geschoss, Sued- und Nordfassade ----------------
    for name, base, hgt in M.STOREYS:
        if name == "UG":
            continue
        z0 = base + hgt * (1 - h["glas_anteil"]) / 2.0
        z1 = z0 + hgt * h["glas_anteil"]
        x1 = stein_x0 - 0.3
        # Das oberste Geschoss steht hinter der Terrasse.
        y_sued = setback if name == "2. OG" else 0.0
        parts.append(box("glas", 0.35, x1, z0, z1, y_sued - 0.06, y_sued + 0.06,
                         phase="ausbau"))
        parts.append(box("glas", 0.35, x1, z0, z1, D - 0.06, D + 0.06, phase="ausbau"))
        # Dunkle Rahmen ober- und unterhalb des Bandes.
        for z in (z0, z1):
            r = h["rahmen"]
            parts.append(box("rahmen", 0.35, x1, z - r / 2, z + r / 2,
                             y_sued - 0.09, y_sued + 0.09, phase="ausbau"))
            parts.append(box("rahmen", 0.35, x1, z - r / 2, z + r / 2,
                             D - 0.09, D + 0.09, phase="ausbau"))
    # Ein hohes Fenster im Steinvolumen, wie auf dem Vorbild.
    parts.append(box("glas", stein_x0 + 0.9, stein_x1 - 0.9, 5.20, 12.60,
                     -vs - 0.06, -vs + 0.06, phase="ausbau"))

    # --- Balkon vor dem 1. OG --------------------------------------------
    b = h["balkon"]
    og1 = next(s for s in M.STOREYS if s[0] == "1. OG")
    parts.append(box("dach", b["x"][0], b["x"][1], og1[1] - b["dicke"], og1[1],
                     -b["tiefe"], 0.0))
    parts.append(box("glas", b["x"][0], b["x"][1], og1[1], og1[1] + b["gelaender"],
                     -b["tiefe"] - 0.04, -b["tiefe"] + 0.04, phase="ausbau"))

    # --- Pergola ueber der Dachterrasse ----------------------------------
    p = h["pergola"]
    n = p["balken"]
    z0 = og2_base + p["ueber_terrasse"]
    for i in range(n):
        # Balkenbreite verjuengt sich nach aussen - die Konstruktion der Marke.
        f = i / max(n - 1, 1)
        w = p["breit_innen"] + (p["breit_aussen"] - p["breit_innen"]) * f
        x = 0.35 + i * ((stein_x0 - 1.0) / max(n - 1, 1))
        parts.append(box("balken", x - w / 2, x + w / 2, z0, z0 + p["hoehe"],
                         -ov, setback + 0.3))
    # Zwei Traeger, auf denen die Balken liegen.
    for y in (-ov + 0.25, setback - 0.1):
        parts.append(box("balken", 0.0, stein_x0 - 0.6, z0 - 0.16, z0,
                         y - 0.09, y + 0.09))
    # Zwei Stuetzen am freien Ende.
    for x in (0.9, stein_x0 - 1.4):
        parts.append(box("balken", x - 0.08, x + 0.08, og2_base, z0,
                         -ov + 0.17, -ov + 0.33))

    return parts


# ---------------------------------------------------------------------------
# Ausgabe
# ---------------------------------------------------------------------------

def emit() -> str:
    out: list[str] = []
    add = out.append

    add("/*")
    add(" * GENERIERT von cad/build_scene.py — nicht von Hand ändern.")
    add(" *")
    add(" * Geometrie aus cad/model.py, derselben Quelle wie das DXF-Planblatt,")
    add(" * das IFC-Modell und der Hero-Schnitt. Nach jeder Massänderung:")
    add(" *")
    add(" *   python cad/build_scene.py")
    add(" *")
    add(" * Koordinaten sind bereits in three.js-Konvention (y = oben) und um die")
    add(" * Gebäudemitte zentriert. Masse in Metern. Die Punktreihenfolge einer")
    add(" * Polylinie ist die Fliessrichtung des Mediums.")
    add(" */")
    add("")
    add("export type Vec3 = [number, number, number];")
    add("")

    add("export const building = {")
    add(f"  width: {M.WIDTH:g},")
    add(f"  depth: {M.DEPTH:g},")
    add(f"  wallT: {M.WALL_T:g},")
    add(f"  slabT: {M.SLAB_T:g},")
    add(f"  roofLevel: {M.ROOF_LEVEL:g},")
    add(f"  basementLevel: {M.BASEMENT_LEVEL:g},")
    add(f"  terrainLevel: {M.TERRAIN_LEVEL:g},")
    add("};")
    add("")

    add("/** Rohdecken: eine je Geschoss plus Dach. `base` ist OK Rohboden. */")
    add("export const storeys = [")
    for name, base, height in M.STOREYS:
        add(f'  {{ name: "{name}", base: {base:g}, height: {height:g} }},')
    add("] as const;")
    add("")

    add("/** Ein Strang je Medium. `lines` in Fliessrichtung, `gewerk` für die")
    add(" *  Legende, `color` aus MEDIEN in model.py. */")
    add("export const runs: {")
    add("  id: string;")
    add("  label: string;")
    add("  short: string;")
    add("  gewerk: string;")
    add("  color: string;")
    add("  radius: number;")
    add("  lines: Vec3[][];")
    add("  /** T-Stücke: Punkt, Achse des durchgehenden Strangs, Richtung des")
    add("   *  Abgangs. Ohne sie stossen zwei Rohre nur aneinander. */")
    add("  fittings: { at: Vec3; axis: Vec3; branch: Vec3 }[];")
    add("}[] = [")
    for key, radius, fn in RUNS:
        med = M.MEDIEN[key]
        lines, fittings = fn(M.Y_TRASSE[key])
        add("  {")
        add(f'    id: "{key}",')
        add(f'    label: "{med["label"]}",')
        add(f'    short: "{med["kurz"]}",')
        add(f'    gewerk: "{med["gewerk"]}",')
        add(f'    color: "{hexcolor(med["farbe"])}",')
        add(f"    radius: {radius:g},")
        add("    lines: [")
        for line in lines:
            add(f"      {fmt_line(line)},")
        add("    ],")
        add("    fittings: [")
        for f in fittings:
            add(
                f'      {{ at: {fmt_pt(f["at"])}, axis: {fmt_pt(f["axis"])}, '
                f'branch: {fmt_pt(f["branch"])} }},'
            )
        add("    ],")
        add("  },")
    add("];")
    add("")

    wp = M.WP
    cx, cy, cz = p3(wp["x"] + wp["width"] / 2.0, wp["z_base"] + wp["height"] / 2.0)
    add("/** Wärmepumpe im UG — Mittelpunkt und Kantenlängen. */")
    add("export const waermepumpe = {")
    add(f"  center: [{cx:g}, {cy:g}, {cz:g}] as Vec3,")
    add(f'  size: [{wp["width"]:g}, {wp["height"]:g}, {wp["depth"]:g}] as Vec3,')
    add("};")
    add("")

    pv = M.PV
    add("/** PV-Feld auf dem Dach: je Reihe Mittelpunkt, Neigung um die Tiefenachse. */")
    add("export const pvRows: { center: Vec3 }[] = [")
    for i in range(pv["rows"]):
        x = pv["x_first"] + i * pv["spacing"]
        z_mid = pv["z_base"] + pv["foot_h"] + math.sin(math.radians(pv["tilt_deg"])) * pv["module_len"] / 2.0
        px_, py_, pz_ = p3(x + pv["module_len"] / 2.0, z_mid)
        add(f"  {{ center: [{px_:g}, {py_:g}, {pz_:g}] }},")
    add("];")
    add("")
    add("export const pvModule = {")
    add(f'  length: {pv["module_len"]:g},')
    add(f'  width: {pv["module_w"]:g},')
    add(f'  thickness: {pv["module_t"]:g},')
    add(f'  tiltDeg: {pv["tilt_deg"]:g},')
    add("};")
    add("")

    # --- Menschen und ihre Requisiten, aus der Anlage abgeleitet -----------
    h, s = M.HEIZUNG, M.SANITAER
    og1 = next(st for st in M.STOREYS if st[0] == "1. OG")
    floor_1og = og1[1]

    planer = p3(-4.20, M.TERRAIN_LEVEL, Y_RUNS + 3.20)
    installer = p3(h["riser_x"] + 1.30, M.BASEMENT_LEVEL, Y_RUNS + 1.40)
    nutzer = p3(h["branch_x"] + 1.35, floor_1og, Y_RUNS + 1.30)
    heizkoerper = p3(h["branch_x"], h["branches"][1] - 0.45)
    schalter = p3(h["branch_x"] + 2.60, floor_1og + 1.30, Y_RUNS + 1.30)
    becken = p3(s["branches"][1][1] - 0.30, s["branches"][1][0] - 0.55)

    add("/** Wo die drei Menschen stehen und was um sie herum steht. Alles aus")
    add(" *  der Anlage abgeleitet: der Installateur am Steigstrang im UG, der")
    add(" *  Nutzer beim Heizkörper im 1. OG, der Planer draussen am Rechner. */")
    add("export const acteurs = {")
    add(f"  planer: {fmt_pt(planer)} as Vec3,")
    add(f"  installateur: {fmt_pt(installer)} as Vec3,")
    add(f"  nutzer: {fmt_pt(nutzer)} as Vec3,")
    add("};")
    add("")
    add("export const props = {")
    add(f"  heizkoerper: {fmt_pt(heizkoerper)} as Vec3,")
    add(f"  schalter: {fmt_pt(schalter)} as Vec3,")
    add(f"  becken: {fmt_pt(becken)} as Vec3,")
    add("};")
    add("")

    # --- Geraete an den Leitungsenden --------------------------------------
    b = M.WASCHBECKEN
    bx, by, bz = p3(b["x"], b["z"] - b["hoehe"] / 2.0, Y_BECKEN)
    add("/** Waschbecken im Sanitärraum — Endpunkt von Kalt- und Warmwasser,")
    add(" *  Anfang des Abwassers. */")
    add("export const waschbecken = {")
    add(f"  center: [{bx:g}, {by:g}, {bz:g}] as Vec3,")
    add(f'  size: [{b["breite"]:g}, {b["hoehe"]:g}, {b["tiefe"]:g}] as Vec3,')
    add("};")
    add("")

    la = M.LUFTAUSLASS
    add("/** Zuluftauslässe am Ende der Abwürfe — ein Kanal, der im Raum")
    add(" *  aufhört, ist kein Kanal. */")
    add("export const luftauslaesse: { center: Vec3 }[] = [")
    for x, z_u in M.LUEFTUNG["drops"]:
        cx, cy, cz = p3(x, z_u - la["hoehe"] / 2.0, M.Y_TRASSE["zuluft"])
        add(f"  {{ center: [{cx:g}, {cy:g}, {cz:g}] }},")
    add("];")
    add("export const luftauslassSize: Vec3 = "
        f'[{la["breite"]:g}, {la["hoehe"]:g}, {la["tiefe"]:g}];')
    add("")

    # --- Waermeabgabe und Umwaelzung ---------------------------------------
    hk = M.HEIZKOERPER
    # Heizkoerper und Verteiler haengen zwischen Vor- und Ruecklauf, also auf
    # die Mitte der beiden Trassenachsen gesetzt - sonst sitzt der Koerper
    # neben seinen eigenen Anschluessen.
    y_hk = (M.Y_TRASSE["heizwasser_vl"] + M.Y_TRASSE["heizwasser_rl"]) / 2.0
    add("/** Heizkörper an den Abgängen der Obergeschosse. Das EG trägt keinen —")
    add(" *  dort liegt die Bodenheizung, gespeist aus dem Verteiler. */")
    add("export const heizkoerper: { center: Vec3 }[] = [")
    for i in hk["an_abzweig"]:
        z = M.HEIZUNG["branches"][i] - hk["unter_leitung"]
        add(f'  {{ center: {fmt_pt(p3(M.HEIZUNG["branch_x"], z, y_hk))} }},')
    add("];")
    add("export const heizkoerperSize: Vec3 = "
        f'[{hk["breite"]:g}, {hk["hoehe"]:g}, {hk["tiefe"]:g}];')
    add("")

    v = M.VERTEILER
    add("/** Heizkreisverteiler der Bodenheizung, am Ende des EG-Abgangs. */")
    add("export const verteiler = {")
    add(f'  center: {fmt_pt(p3(v["x"], v["z"], y_hk))} as Vec3,')
    add(f'  size: [{v["breite"]:g}, {v["hoehe"]:g}, {v["tiefe"]:g}] as Vec3,')
    add("};")
    add("")

    # --- Huelle ------------------------------------------------------------
    add("/** Die Gebäudehülle als Quader. `kind` steuert das Material in der")
    add(" *  Szene, `phase` wann das Teil erscheint: \"roh\" mit dem Rohbau im")
    add(" *  zweiten Akt, \"ausbau\" erst im dritten — erst Decken und Träger,")
    add(" *  dann Fassade und Glas. */")
    add("export const envelope: {")
    add('  kind: "dach" | "stein" | "glas" | "rahmen" | "balken";')
    add('  phase: "roh" | "ausbau";')
    add("  center: Vec3;")
    add("  size: Vec3;")
    add("}[] = [")
    for part in envelope():
        add(
            f'  {{ kind: "{part["kind"]}", phase: "{part["phase"]}", '
            f'center: {fmt_pt(part["center"])}, size: {fmt_pt(part["size"])} }},'
        )
    add("];")
    add("")

    # --- Raeume ------------------------------------------------------------
    add("/** Grobe Nutzungsaufteilung je Geschoss. `technik` markiert die")
    add(" *  Technikzentrale — sie bekommt in der Szene ein Schild, die")
    add(" *  übrigen Räume nur ihre Wände. Höhe ist die lichte Geschosshöhe. */")
    add("export const raeume: {")
    add("  storey: string;")
    add("  name: string;")
    add("  center: Vec3;")
    add("  size: Vec3;")
    add("  technik: boolean;")
    add("}[] = [")
    for storey, base, height in M.STOREYS:
        for name, (x0, x1), (y0, y1) in M.RAEUME.get(storey, []):
            cx, cy, cz = p3((x0 + x1) / 2.0, base + height / 2.0, (y0 + y1) / 2.0)
            technik = (storey, name) == M.TECHNIKZENTRALE
            add("  {")
            add(f'    storey: "{storey}",')
            add(f'    name: "{name}",')
            add(f"    center: [{cx:g}, {cy:g}, {cz:g}],")
            add(f"    size: [{x1 - x0:g}, {height:g}, {y1 - y0:g}],")
            add(f"    technik: {'true' if technik else 'false'},")
            add("  },")
    add("];")
    add("")

    sp = M.SPEICHER
    scx, scy, scz = p3(sp["x"], sp["z_base"] + sp["h"] / 2.0)
    add("/** Warmwasserspeicher in der Technikzentrale. */")
    add("export const speicher = {")
    add(f"  center: [{scx:g}, {scy:g}, {scz:g}] as Vec3,")
    add(f'  radius: {sp["d"] / 2.0:g},')
    add(f'  height: {sp["h"]:g},')
    add("};")
    add("")

    lg = M.LUEFTUNGSGERAET
    lcx, lcy, lcz = p3(lg["x"], lg["z"])
    add("/** Lüftungsmonoblock am Anfang des Zuluftkanals. */")
    add("export const lueftungsgeraet = {")
    add(f"  center: [{lcx:g}, {lcy:g}, {lcz:g}] as Vec3,")
    add(f'  size: [{lg["breite"]:g}, {lg["hoehe"]:g}, {lg["tiefe"]:g}] as Vec3,')
    add("};")
    add("")

    pu = M.PUMPE
    add("/** Umwälzpumpe im Vorlauf, über der Wärmepumpe. `length` liegt in der")
    add(" *  Rohrachse (senkrecht), `housing` ist der Motor quer dazu. */")
    add("export const pumpe = {")
    add(f'  center: {fmt_pt(p3(pu["x"], pu["z"], M.Y_TRASSE["heizwasser_vl"]))} as Vec3,')
    add(f'  length: {pu["laenge"]:g},')
    add(f'  housing: {pu["d_gehaeuse"]:g},')
    add("};")
    add("")

    # Jede Fahne sitzt auf der Trasse ihres eigenen Mediums - sonst zeigt der
    # Messwert auf eine Stelle, an der das Rohr gar nicht liegt.
    mess_lane = {
        "Heizung": M.Y_TRASSE["heizwasser_vl"],
        "Lüftung": M.Y_TRASSE["zuluft"],
        "Sanitär": M.Y_TRASSE["kaltwasser"],
    }
    tone = {"Heizung": "heat", "Lüftung": "air", "Sanitär": "water"}
    add("/** Die drei Messwerte aus model.py, als Punkte im Modell. Sie erscheinen")
    add(" *  im dritten Akt — gemessen wird an der laufenden Anlage. */")
    add("export const messpunkte: {")
    add("  id: string;")
    add("  value: string;")
    add("  label: string;")
    add("  tone: string;")
    add("  at: Vec3;")
    add("}[] = [")
    for mp in M.MESSPUNKTE:
        x, y, z = p3(mp["x"], mp["z"], mess_lane[mp["gewerk"]])
        add("  {")
        add(f'    id: "{mp["id"]}",')
        add(f'    value: "{mp["anzeige"]}",')
        add(f'    label: "{mp.get("kurz", mp["groesse"])}",')
        add(f'    tone: "{tone[mp["gewerk"]]}",')
        add(f"    at: [{x:g}, {y:g}, {z:g}],")
        add("  },")
    add("];")
    add("")
    return "\n".join(out)


def segments(lines):
    for line in lines:
        for a, b in zip(line, line[1:]):
            yield a, b


def seg_distance(p, q, r, s):
    """Kuerzester Abstand zweier Strecken im Raum."""
    def sub(a, b):
        return (a[0] - b[0], a[1] - b[1], a[2] - b[2])

    def dot(a, b):
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

    u, v, w = sub(q, p), sub(s, r), sub(p, r)
    a, b, c, d, e = dot(u, u), dot(u, v), dot(v, v), dot(u, w), dot(v, w)
    den = a * c - b * b
    if den < 1e-9:
        sc, tc = 0.0, (d / b if abs(b) > 1e-9 else 0.0)
    else:
        sc = (b * e - c * d) / den
        tc = (a * e - b * d) / den
    sc, tc = min(max(sc, 0.0), 1.0), min(max(tc, 0.0), 1.0)
    diff = (
        w[0] + sc * u[0] - tc * v[0],
        w[1] + sc * u[1] - tc * v[1],
        w[2] + sc * u[2] - tc * v[2],
    )
    return dot(diff, diff) ** 0.5


def check_collisions(built):
    """Zwei Medien duerfen sich nicht durchdringen.

    Prueft alle Strecken paarweise ueber Mediengrenzen hinweg: unterschreitet
    der Achsabstand die Summe der beiden Radien, waere das im gebauten Zustand
    eine Kollision. Innerhalb eines Mediums wird nicht geprueft - dort sind
    Beruehrungen die T-Stuecke, und die sollen sich beruehren.
    """
    hits = []
    keys = list(built)
    for i, k1 in enumerate(keys):
        for k2 in keys[i + 1:]:
            r1, lines1 = built[k1]
            r2, lines2 = built[k2]
            clearance = r1 + r2
            for a, b in segments(lines1):
                for c, d in segments(lines2):
                    gap = seg_distance(a, b, c, d)
                    if gap < clearance:
                        hits.append((k1, k2, round(gap, 3), round(clearance, 3)))
                        break
                else:
                    continue
                break
    return hits


def main():
    TS.parent.mkdir(parents=True, exist_ok=True)
    TS.write_text(emit(), encoding="utf-8")
    print(f"geschrieben: {TS}")
    built = {}
    for key, radius, fn in RUNS:
        lines, fittings = fn(M.Y_TRASSE[key])
        built[key] = (radius, lines)
        print(
            f"  {M.MEDIEN[key]['label']:<22} {len(lines)} Polylinien, "
            f"{len(fittings)} T-Stücke, Achse y={M.Y_TRASSE[key]:+.2f}"
        )

    hits = check_collisions(built)
    if hits:
        print("\n  KOLLISIONEN:")
        for k1, k2, gap, need in hits:
            print(f"    {k1} × {k2}: Abstand {gap} m, nötig {need} m")
        raise SystemExit(
            "Zwei Medien durchdringen sich — Y_TRASSE in model.py korrigieren."
        )
    print("\n  kollisionsfrei geprüft: alle Medienpaare")


if __name__ == "__main__":
    main()
