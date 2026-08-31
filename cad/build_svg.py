"""
Erzeugt aus dem DXF die Hero-Zeichnung als React-Komponente.

    python cad/build_svg.py

Ergebnis: src/components/SchnittAA.tsx  (generiert, nicht von Hand aendern)

Aufteilung
----------
* **Geometrie** kommt aus cad/out/IEM-HLKS-101_Schnitt-AA.dxf. Gelesen werden
  nur die Zeichnungslayer; Bemassung, Text, Messpunktbloecke und Planrahmen
  bleiben im DXF, weil der Hero sie anders setzt.
* **Beschriftung** (Geschosse, Hoehenmass) zeichnet dieser Exporter aus
  model.py - im Hero soll sie die Seitentypografie tragen, nicht CAD-Text.

Beides stammt damit aus derselben Quelle wie DXF und IFC.

Ein DXF aus Revit/Archicad laesst sich genauso verarbeiten, sofern die Layer
gleich heissen - dann faellt build_dxf.py als Zwischenschritt weg.
"""

from __future__ import annotations

import pathlib

import ezdxf

import model as M

DXF = pathlib.Path(__file__).parent / "out" / "IEM-HLKS-101_Schnitt-AA.dxf"
TSX = pathlib.Path(__file__).parent.parent / "src" / "components" / "SchnittAA.tsx"

# Zeichenflaeche in Metern. Der Ausschnitt ist enger als das DXF: dort laeuft
# das Terrain 4 m nach jeder Seite, im Hero soll es am Kartenrand enden.
CROP = (-2.90, -3.90, 16.30, 15.60)   # x_min, z_min, x_max, z_max

S = 30.0     # Pixel je Meter
PAD = 14.0

# Layer -> (Gruppenname, Tailwind-Klasse, Strichstaerke, Animationsverzoegerung)
LAYERS = {
    "IEM_00_STRUKTUR": ("Rohbau", "stroke-line-strong", 1.2, None),
    "IEM_20_ANLAGEN": ("Anlagen", "stroke-line-strong", 1.1, None),
    "IEM_10_HEIZUNG": ("Heizung", "stroke-disc-heat", 2.0, "0s"),
    "IEM_11_LUEFTUNG": ("Lüftung", "stroke-disc-air", 2.0, "0.25s"),
    "IEM_12_SANITAER": ("Sanitär", "stroke-disc-water", 2.2, "0.5s"),
}
FILL = {
    "IEM_10_HEIZUNG": "fill-disc-heat",
    "IEM_11_LUEFTUNG": "fill-disc-air",
    "IEM_12_SANITAER": "fill-disc-water",
}
HATCH_LAYER = "IEM_01_TERRAIN"

# Durchfluss-Animation
# --------------------
# Ueber jeder Trasse laeuft ein heller Schlitten, der das Medium zeigt:
# Heizungswasser steigt, Zuluft laeuft zu den Auslaessen, Kaltwasser steigt.
# Die Richtung ergibt sich aus der Zeichenrichtung der Pfade und stimmt damit
# automatisch, solange model.py die Straenge von der Quelle her zeichnet.
#
# Laenge und Tempo werden je Pfad gerechnet, nicht pauschal gesetzt: mit
# pathLength="1" waere eine feste Dauer auf dem 411px-Steigstrang und der
# 110px-Abzweigung dieselbe *Bruchteil*-Geschwindigkeit, also sichtbar
# verschiedene Tempi in px/s. Das liest sich wie drei Anlagen mit drei
# verschiedenen Pumpen. Konstant sind stattdessen Schlittenlaenge und
# Geschwindigkeit — physikalisch das, was ein Medium in einem Netz tut.
FLOW_DASH_PX = 34.0     # Laenge des Schlittens in Zeichenpixeln
FLOW_SPEED = 70.0       # Zeichenpixel je Sekunde
FLOW_START = 1.4        # Sekunden: erst laufen, wenn animate-draw fertig ist


# ---------------------------------------------------------------------------
# Zuschnitt und Abbildung
# ---------------------------------------------------------------------------

def clip(p0, p1):
    """Liang-Barsky: Strecke auf CROP zuschneiden, None wenn ausserhalb."""
    x0, z0 = p0
    x1, z1 = p1
    dx, dz = x1 - x0, z1 - z0
    t0, t1 = 0.0, 1.0
    xmin, zmin, xmax, zmax = CROP
    for p, q in ((-dx, x0 - xmin), (dx, xmax - x0),
                 (-dz, z0 - zmin), (dz, zmax - z0)):
        if abs(p) < 1e-12:
            if q < 0:
                return None
            continue
        t = q / p
        if p < 0:
            if t > t1:
                return None
            t0 = max(t0, t)
        else:
            if t < t0:
                return None
            t1 = min(t1, t)
    return ((x0 + t0 * dx, z0 + t0 * dz), (x0 + t1 * dx, z0 + t1 * dz))


def px(x_m: float, z_m: float) -> tuple[float, float]:
    xmin, _zmin, _xmax, zmax = CROP
    return ((x_m - xmin) * S + PAD, (zmax - z_m) * S + PAD)


def fmt(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def path_len_px(points, closed=False) -> float:
    """Laenge des Streckenzugs in Zeichenpixeln — Grundlage fuer Tempo und
    Schlittenlaenge der Durchfluss-Animation."""
    pts = [px(x, z) for x, z in points]
    if closed and len(pts) > 2:
        pts.append(pts[0])
    return sum(
        ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
        for a, b in zip(pts, pts[1:])
    )


def path_d(points, closed=False) -> str:
    parts = []
    for i, (x, z) in enumerate(points):
        sx, sy = px(x, z)
        parts.append(f"{'M' if i == 0 else 'L'}{fmt(sx)} {fmt(sy)}")
    if closed:
        parts.append("Z")
    return "".join(parts)


# ---------------------------------------------------------------------------
# DXF lesen
# ---------------------------------------------------------------------------

def read_dxf():
    doc = ezdxf.readfile(DXF)
    msp = doc.modelspace()

    paths = {layer: [] for layer in LAYERS}
    dots = {layer: [] for layer in FILL}
    hatches = []

    for e in msp:
        layer = e.dxf.layer
        kind = e.dxftype()

        if layer == HATCH_LAYER and kind == "HATCH":
            for bp in e.paths:
                # Die Terrainflaechen sind achsparallele Rechtecke, die im DXF
                # 4 m ueber den Ausschnitt hinauslaufen. Ecken einklemmen statt
                # Punkte wegwerfen - sonst bleibt keine Flaeche uebrig.
                pts = [_clamp((v[0] / 1000.0, v[1] / 1000.0)) for v in bp.vertices]
                if len(pts) >= 3:
                    hatches.append(pts)
            continue

        if layer not in LAYERS:
            continue

        if kind == "LINE":
            seg = clip((e.dxf.start.x / 1000.0, e.dxf.start.y / 1000.0),
                       (e.dxf.end.x / 1000.0, e.dxf.end.y / 1000.0))
            if seg:
                paths[layer].append((list(seg), False))

        elif kind == "LWPOLYLINE":
            pts = [(p[0] / 1000.0, p[1] / 1000.0) for p in e.get_points("xy")]
            if e.closed:
                # Geschlossene Kontur: nur uebernehmen, wenn sie ganz im
                # Ausschnitt liegt - ein Zuschnitt wuerde sie oeffnen.
                if all(_inside(p) for p in pts):
                    paths[layer].append((pts, True))
                continue
            kept = []
            for a, b in zip(pts, pts[1:]):
                seg = clip(a, b)
                if seg:
                    kept.append(list(seg))
            for seg in kept:
                paths[layer].append((seg, False))

        elif kind == "CIRCLE" and layer in FILL:
            c = (e.dxf.center.x / 1000.0, e.dxf.center.y / 1000.0)
            if _inside(c):
                dots[layer].append((c, e.dxf.radius / 1000.0))

    return paths, dots, hatches


def _clamp(p):
    xmin, zmin, xmax, zmax = CROP
    return (min(max(p[0], xmin), xmax), min(max(p[1], zmin), zmax))


def _inside(p) -> bool:
    xmin, zmin, xmax, zmax = CROP
    return xmin - 1e-9 <= p[0] <= xmax + 1e-9 and zmin - 1e-9 <= p[1] <= zmax + 1e-9


# ---------------------------------------------------------------------------
# TSX schreiben
# ---------------------------------------------------------------------------

def emit(paths, dots, hatches) -> str:
    _xmin, zmin, xmax, zmax = CROP
    w = (xmax - CROP[0]) * S + 2 * PAD
    h = (zmax - zmin) * S + 2 * PAD

    out: list[str] = []
    add = out.append

    add('/*')
    add(' * GENERIERT von cad/build_svg.py — nicht von Hand ändern.')
    add(' *')
    add(' * Geometrie stammt aus cad/out/IEM-HLKS-101_Schnitt-AA.dxf, die')
    add(' * Beschriftung aus cad/model.py. Nach jeder Massänderung:')
    add(' *')
    add(' *   python cad/build_dxf.py && python cad/build_svg.py')
    add(' *')
    add(' * Die drei Trassen tragen pathLength="1" und strokeDasharray="1", damit')
    add(' * animate-draw unabhängig von der echten Pfadlänge sauber durchläuft.')
    add(' *')
    add(' * Darüber liegt je Trasse eine zweite Gruppe (.flow-run) mit einem hellen')
    add(' * Schlitten, der das Medium zeigt. Dauer und Strichlänge sind je Pfad aus')
    add(' * seiner echten Länge gerechnet, damit alle Stränge dieselbe')
    add(' * Geschwindigkeit in px/s haben. Unter prefers-reduced-motion blendet')
    add(' * globals.css .flow-run aus.')
    add(' */')
    add('')
    add('export function SchnittAA({ className }: { className?: string }) {')
    add('  return (')
    add(f'    <svg viewBox="0 0 {fmt(w)} {fmt(h)}" className={{className}} role="img"')
    add('      aria-label="Schematischer Gebäudeschnitt mit eingezeichneten Trassen '
        'für Heizung, Lüftung und Sanitär.">')

    # Terrainschraffur
    if hatches:
        add('      <defs>')
        add('        <pattern id="schnitt-hatch" width="8" height="8" '
            'patternTransform="rotate(45)" patternUnits="userSpaceOnUse">')
        add('          <line x1="0" y1="0" x2="0" y2="8" '
            'className="stroke-line-strong" strokeWidth="1" />')
        add('        </pattern>')
        add('      </defs>')
        add('')
        add('      {/* Terrain */}')
        for pts in hatches:
            add(f'      <path d="{path_d(pts, closed=True)}" '
                'fill="url(#schnitt-hatch)" opacity="0.7" />')
        add('')

    # Geometrie je Layer
    for layer, (name, klass, width, delay) in LAYERS.items():
        entries = paths[layer]
        if not entries:
            continue
        add(f'      {{/* {name} */}}')
        anim = ' animate-draw' if delay else ''
        extra = ''
        if delay:
            extra = ' strokeLinecap="round" strokeDasharray="1"'
            if delay != "0s":
                extra += f' style={{{{ animationDelay: "{delay}" }}}}'
        add(f'      <g className="{klass}{anim}" fill="none" '
            f'strokeWidth="{width}"{extra}>')
        for points, closed in entries:
            pl = ' pathLength="1"' if delay else ''
            add(f'        <path{pl} d="{path_d(points, closed)}" />')
        add('      </g>')

        # Durchfluss: heller Schlitten auf derselben Geometrie. Weiss statt der
        # Gewerkfarbe, weil ein Schlitten in der Rohrfarbe auf dem Rohr nicht
        # zu sehen waere; schmaler als das Rohr, damit er als Kern darin liegt.
        if delay:
            flow_delay = FLOW_START + float(delay.rstrip('s'))
            add(f'      {{/* Durchfluss {name} */}}')
            add(f'      <g className="stroke-surface flow-run" fill="none" '
                f'strokeWidth="{max(width - 0.9, 0.8):.1f}" strokeLinecap="round" '
                'opacity="0.9">')
            for points, closed in entries:
                length = path_len_px(points, closed)
                if length < 1:
                    continue
                dash = min(0.35, FLOW_DASH_PX / length)
                dur = max(1.2, length / FLOW_SPEED)
                add(f'        <path pathLength="1" '
                    f'strokeDasharray="{dash:.3f} {1 - dash:.3f}" '
                    'className="animate-flow" '
                    f'style={{{{ animationDuration: "{dur:.1f}s", '
                    f'animationDelay: "{flow_delay:.2f}s" }}}} '
                    f'd="{path_d(points, closed)}" />')
            add('      </g>')

        for centre, radius in dots.get(layer, []):
            cx, cy = px(*centre)
            add(f'      <circle cx="{fmt(cx)}" cy="{fmt(cy)}" '
                f'r="{fmt(max(radius * S, 3.0))}" className="{FILL[layer]}" />')
        add('')

    # Hoehenmass, aus model.py
    x_dim = -2.20
    dx, dy_top = px(x_dim, M.ROOF_LEVEL)
    _, dy_bot = px(x_dim, M.TERRAIN_LEVEL)
    add('      {/* Höhenmass und Geschosse — aus cad/model.py */}')
    add('      <g className="stroke-line-strong" strokeWidth="1">')
    add(f'        <path d="M{fmt(dx)} {fmt(dy_top)}L{fmt(dx)} {fmt(dy_bot)}" />')
    for y in (dy_top, dy_bot):
        add(f'        <path d="M{fmt(dx - 7)} {fmt(y)}L{fmt(dx + 7)} {fmt(y)}" />')
    add('      </g>')
    mid = (dy_top + dy_bot) / 2
    add(f'      <text x="{fmt(dx - 6)}" y="{fmt(mid)}" '
        f'transform="rotate(-90 {fmt(dx - 6)} {fmt(mid)})" textAnchor="middle" '
        'className="fill-muted font-mono" fontSize="11">')
    add(f'        {M.ROOF_LEVEL:.2f} m')
    add('      </text>')
    add('')

    # Geschossbeschriftung
    add('      <g className="fill-muted font-mono" fontSize="10">')
    for name, level, hgt in M.STOREYS:
        tx, ty = px(0.35, level + hgt / 2)
        add(f'        <text x="{fmt(tx)}" y="{fmt(ty)}" '
            f'dominantBaseline="middle">{name}</text>')
    add('      </g>')
    add('    </svg>')
    add('  );')
    add('}')
    add('')

    # Messwertfahnen: Position in Prozent der Zeichenflaeche, damit der Hero
    # sie als HTML ueber das SVG legen kann und die Fahnen trotzdem auf der
    # richtigen Leitung sitzen.
    tone = {"Heizung": "heat", "Lüftung": "air", "Sanitär": "water"}
    add('/** Messwerte aus cad/model.py, Position in % der Zeichenfläche. */')
    add('export const messpunkte = [')
    for i, mp in enumerate(M.MESSPUNKTE):
        cx, cy = px(mp["x"], mp["z"])
        # hero_seite schlaegt beschriftung: die Zeichenflaeche im Hero ist
        # schmaler als das Planblatt, die Fahnen fallen anders herum.
        seite = mp.get("hero_seite", mp.get("beschriftung", "R"))
        side = "left" if seite == "L" else "right"
        add('  {')
        add(f'    id: "{mp["id"]}",')
        add(f'    value: "{mp["anzeige"]}",')
        add(f'    label: "{mp.get("kurz", mp["groesse"])}",')
        add(f'    tone: "{tone[mp["gewerk"]]}",')
        add(f'    side: "{side}",')
        add(f'    left: {cx / w * 100:.2f},')
        add(f'    top: {cy / h * 100:.2f},')
        add(f'    delay: "{1.0 + i * 0.15:.2f}s",')
        add('  },')
    add('] as const;')
    add('')
    add('/** Seitenverhältnis der Zeichenfläche — der Hero rahmt damit die')
    add(' *  Fahnen deckungsgleich zum SVG ein. */')
    add(f'export const schnittAspect = "{fmt(w)} / {fmt(h)}";')
    add('')
    return "\n".join(out)


def main():
    if not DXF.exists():
        raise SystemExit(f"{DXF} fehlt — zuerst 'python cad/build_dxf.py' laufen lassen.")
    paths, dots, hatches = read_dxf()
    n = sum(len(v) for v in paths.values())
    TSX.write_text(emit(paths, dots, hatches), encoding="utf-8")
    print(f"geschrieben: {TSX}")
    print(f"  {n} Pfade, {sum(len(v) for v in dots.values())} Strangendpunkte, "
          f"{len(hatches)} Terrainflächen")
    for layer, (name, *_r) in LAYERS.items():
        print(f"  {name:<10} {len(paths[layer])}")


if __name__ == "__main__":
    main()
