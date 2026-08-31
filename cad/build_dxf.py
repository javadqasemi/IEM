"""
Erzeugt den Musterschnitt A-A als DXF (R2018, Einheit Millimeter).

    python cad/build_dxf.py

Ergebnis: cad/out/IEM-HLKS-101_Schnitt-AA.dxf

Das DXF ist die Austauschform; fuer DWG siehe cad/README.md (ODA File
Converter, ein Aufruf). Layerstruktur ist so gewaehlt, dass ein SVG-Export
direkt gewerkweise einfaerbbare Gruppen liefert.
"""

from __future__ import annotations

import math
import pathlib

import ezdxf
from ezdxf import bbox
from ezdxf.enums import TextEntityAlignment
from ezdxf.tools.standards import linetypes as std_linetypes

import model as M

OUT = pathlib.Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)

# Alles im DXF in Millimetern.
S = 1000.0


def mm(v: float) -> float:
    return v * S


# Massstabsfaktor fuer Text- und Symbolgroessen (geplottet 1:200).
PLOT = 200.0
TXT = 2.5 * PLOT      # 2.5 mm auf Papier
TXT_S = 1.8 * PLOT    # kleine Beschriftung


def rgb(name: str) -> int:
    return ezdxf.rgb2int(M.FARBEN[name])


# ---------------------------------------------------------------------------
# Dokument, Layer, Stile
# ---------------------------------------------------------------------------

def new_doc():
    doc = ezdxf.new("R2018", setup=True)
    doc.header["$INSUNITS"] = 4          # Millimeter
    doc.header["$MEASUREMENT"] = 1       # metrisch
    doc.header["$LUNITS"] = 2            # dezimal
    doc.header["$DIMASSOC"] = 2

    for name, desc, pattern in std_linetypes():
        if name not in doc.linetypes:
            doc.linetypes.add(name, pattern, description=desc)

    if "IEM" not in doc.styles:
        doc.styles.add("IEM", font="arial.ttf")

    layers = [
        # (Name, Farbe, Linienstaerke 1/100 mm, Linientyp)
        ("IEM_00_STRUKTUR", "struktur", 35, "CONTINUOUS"),
        ("IEM_01_TERRAIN", "struktur", 18, "CONTINUOUS"),
        ("IEM_10_HEIZUNG", "heizung", 50, "CONTINUOUS"),
        ("IEM_11_LUEFTUNG", "lueftung", 50, "CONTINUOUS"),
        ("IEM_12_SANITAER", "sanitaer", 50, "CONTINUOUS"),
        ("IEM_20_ANLAGEN", "anlagen", 35, "CONTINUOUS"),
        ("IEM_30_BEMASSUNG", "text", 18, "CONTINUOUS"),
        ("IEM_40_TEXT", "text", 18, "CONTINUOUS"),
        ("IEM_50_MESSPUNKTE", "navy", 25, "CONTINUOUS"),
        ("IEM_90_PLANRAHMEN", "navy", 35, "CONTINUOUS"),
    ]
    for name, farbe, lw, lt in layers:
        doc.layers.add(name, true_color=rgb(farbe), lineweight=lw, linetype=lt)

    # Bemassungsstil: Masszahl in Metern (dimlfac 0.001), Schraegstrich-
    # Endsymbole statt Pfeilen - wie auf dem Hero-Schema.
    ds = doc.dimstyles.add("IEM_200")
    ds.dxf.dimscale = PLOT
    ds.dxf.dimtxt = 2.5
    ds.dxf.dimtsz = 1.0        # Schraegstrich-Terminator
    ds.dxf.dimexe = 1.25
    ds.dxf.dimexo = 1.0
    ds.dxf.dimgap = 0.8
    ds.dxf.dimlfac = 0.001     # mm -> m
    ds.dxf.dimdec = 2
    ds.dxf.dimdsep = ord(".")  # Punkt statt Komma
    ds.dxf.dimzin = 0          # Nachkommanullen stehen lassen: "14.20"
    ds.dxf.dimtad = 1          # Text ueber der Masslinie
    ds.dxf.dimtxsty = "IEM"
    ds.dxf.dimclrt = 8
    return doc


def text(msp, s, x, y, height=TXT, layer="IEM_40_TEXT",
         align=TextEntityAlignment.LEFT, rotation=0.0, color=None):
    attribs = {"layer": layer, "style": "IEM"}
    if color is not None:
        attribs["true_color"] = color
    if rotation:
        attribs["rotation"] = rotation
    t = msp.add_text(s, height=height, dxfattribs=attribs)
    t.set_placement((x, y), align=align)
    return t


# ---------------------------------------------------------------------------
# Rohbau
# ---------------------------------------------------------------------------

def draw_structure(msp):
    lay = {"layer": "IEM_00_STRUKTUR"}
    w = mm(M.WIDTH)
    t = mm(M.WALL_T)
    top = mm(M.ROOF_LEVEL)
    bot = mm(M.BASEMENT_LEVEL)

    def rect(x1, y1, x2, y2, layer="IEM_00_STRUKTUR"):
        msp.add_lwpolyline(
            [(x1, y1), (x2, y1), (x2, y2), (x1, y2)],
            close=True, dxfattribs={"layer": layer},
        )

    # Aussenwaende
    rect(-t, bot, 0, top)
    rect(w, bot, w + t, top)

    # Bodenplatte UG
    rect(-t, bot - mm(M.BASE_T), w + t, bot)

    # Geschossdecken (Oberkante = Geschossniveau)
    for name, level, _h in M.STOREYS[1:]:
        z = mm(level)
        rect(0, z - mm(M.SLAB_T), w, z)

    # Dachdecke
    rect(-t, top - mm(M.ROOF_T), w + t, top)

    # Terrain links und rechts, mit Boeschungsschraffur
    ground = mm(M.TERRAIN_LEVEL)
    for x1, x2 in ((-mm(4.0), -t), (w + t, w + mm(4.0))):
        msp.add_line((x1, ground), (x2, ground),
                     dxfattribs={"layer": "IEM_00_STRUKTUR", "lineweight": 50})
        h = msp.add_hatch(dxfattribs={"layer": "IEM_01_TERRAIN"})
        h.set_pattern_fill("ANSI31", scale=60.0)
        h.paths.add_polyline_path(
            [(x1, ground), (x2, ground), (x2, ground - mm(0.55)),
             (x1, ground - mm(0.55))],
            is_closed=True,
        )

    # Geschossbeschriftung
    for name, level, h in M.STOREYS:
        text(msp, name, mm(0.35), mm(level + h / 2), height=TXT_S,
             align=TextEntityAlignment.MIDDLE_LEFT)


def draw_plant(msp):
    """Waermepumpe im UG und PV-Feld auf dem Dach."""
    lay = {"layer": "IEM_20_ANLAGEN"}
    wp = M.WP
    x1, y1 = mm(wp["x"]), mm(wp["z_base"])
    x2, y2 = mm(wp["x"] + wp["width"]), mm(wp["z_base"] + wp["height"])
    msp.add_lwpolyline([(x1, y1), (x2, y1), (x2, y2), (x1, y2)],
                       close=True, dxfattribs=lay)
    msp.add_line((x1, y1 + mm(wp["height"]) * 0.62),
                 (x2, y1 + mm(wp["height"]) * 0.62), dxfattribs=lay)
    text(msp, "WP  Sole/Wasser", x2 + mm(0.35), (y1 + y2) / 2, height=TXT_S,
         align=TextEntityAlignment.MIDDLE_LEFT)

    pv = M.PV
    tilt = math.radians(pv["tilt_deg"])
    dx = pv["module_len"] * math.cos(tilt)
    dz = pv["module_len"] * math.sin(tilt)
    for i in range(pv["rows"]):
        bx = pv["x_first"] + i * pv["spacing"]
        bz = pv["z_base"] + pv["foot_h"]
        msp.add_line((mm(bx), mm(bz)), (mm(bx + dx), mm(bz + dz)),
                     dxfattribs={"layer": "IEM_20_ANLAGEN", "lineweight": 50})
        # Aufstaenderung
        msp.add_line((mm(bx), mm(bz)), (mm(bx), mm(pv["z_base"])), dxfattribs=lay)
        msp.add_line((mm(bx + dx), mm(bz + dz)), (mm(bx + dx), mm(pv["z_base"])),
                     dxfattribs=lay)
    text(msp, f"PV {pv['rows']} Reihen, {pv['tilt_deg']:.0f}° — Planung nach SIA 108",
         mm(pv["x_first"] + pv["spacing"] * (pv["rows"] - 1) + dx + 0.6),
         mm(pv["z_base"] + pv["foot_h"] + dz / 2),
         height=TXT_S, align=TextEntityAlignment.MIDDLE_LEFT)


# ---------------------------------------------------------------------------
# Gewerke
# ---------------------------------------------------------------------------

def poly(msp, pts, layer):
    msp.add_lwpolyline([(mm(x), mm(z)) for x, z in pts],
                       dxfattribs={"layer": layer})


def draw_heizung(msp):
    h = M.HEIZUNG
    L = "IEM_10_HEIZUNG"
    poly(msp, [(h["riser_x"], h["z_bottom"]), (h["riser_x"], h["z_top"])], L)
    for z in h["branches"]:
        poly(msp, [(h["riser_x"], z), (h["branch_x"], z)], L)
        msp.add_circle((mm(h["branch_x"]), mm(z)), mm(0.12),
                       dxfattribs={"layer": L})
    # Anbindung an die WP
    poly(msp, [(h["riser_x"], h["z_bottom"]),
               (M.WP["x"] + M.WP["width"] / 2, h["z_bottom"]),
               (M.WP["x"] + M.WP["width"] / 2, M.WP["z_base"] + M.WP["height"])], L)
    # Strangbezeichnung laengs des Steigstrangs, im freien Feld zwischen
    # Geschossbeschriftung (x=0.35) und Strang (x=2.40).
    text(msp, f"HV/HR DN{h['dn_riser']}", mm(h["riser_x"] - 0.55), mm(3.20),
         height=TXT_S, rotation=90,
         align=TextEntityAlignment.LEFT, color=rgb("heizung"))
    # DN mittig ueber den Abgang - das Strangende traegt teils einen Messpunkt.
    for z in h["branches"]:
        text(msp, f"DN{h['dn_branch']}",
             mm((h["riser_x"] + h["branch_x"]) / 2), mm(z + 0.26),
             height=TXT_S, align=TextEntityAlignment.CENTER,
             color=rgb("heizung"))


def draw_lueftung(msp):
    l = M.LUEFTUNG
    L = "IEM_11_LUEFTUNG"
    poly(msp, [(l["x_start"], l["z_main"]), (l["x_end"], l["z_main"])], L)
    for x, z_u in l["drops"]:
        poly(msp, [(x, l["z_main"]), (x, z_u)], L)
    t = l["tail"]
    poly(msp, [(l["x_end"], l["z_main"]), (t["x"], t["z"]), (t["x_to"], t["z"])], L)
    msp.add_circle((mm(l["x_end"]), mm(l["z_main"])), mm(0.12),
                   dxfattribs={"layer": L})
    # Einzeilig ueber dem Kanal - unterhalb liegen Geschossbeschriftung und
    # der oberste Heizungsabgang zu dicht.
    text(msp, f"ZUL {l['duct_w']*1000:.0f}×{l['duct_h']*1000:.0f} — ab Monobloc UG",
         mm(l["x_start"] + 0.4), mm(l["z_main"] + 0.30), height=TXT_S,
         color=rgb("lueftung"))


def draw_sanitaer(msp):
    s = M.SANITAER
    L = "IEM_12_SANITAER"
    poly(msp, [(s["riser_x"], s["z_bottom"]), (s["riser_x"], s["z_top"])], L)
    for z, x_to in s["branches"]:
        poly(msp, [(s["riser_x"], z), (x_to, z)], L)
        msp.add_circle((mm(x_to), mm(z)), mm(0.12), dxfattribs={"layer": L})
    # Oberes Strangdrittel - unten liegt der Messpunkt MP-S-01 im Weg.
    text(msp, f"KW/WW DN{s['dn_riser']}", mm(s["riser_x"] + 0.42), mm(3.90),
         height=TXT_S, rotation=90,
         align=TextEntityAlignment.LEFT, color=rgb("sanitaer"))
    # Unter die Leitung gesetzt: darueber steht bei z=1.38 der Messpunkt.
    for z, x_to in s["branches"]:
        text(msp, f"DN{s['dn_branch']}", mm((s["riser_x"] + x_to) / 2),
             mm(z - 0.46), height=TXT_S, align=TextEntityAlignment.CENTER,
             color=rgb("sanitaer"))


# ---------------------------------------------------------------------------
# Bemassung, Hoehenkoten, Messpunkte
# ---------------------------------------------------------------------------

def draw_dimensions(msp):
    x_dim = -mm(2.20)
    dim = msp.add_linear_dim(
        base=(x_dim, 0),
        p1=(-mm(M.WALL_T), mm(M.TERRAIN_LEVEL)),
        p2=(-mm(M.WALL_T), mm(M.ROOF_LEVEL)),
        angle=90,
        dimstyle="IEM_200",
        dxfattribs={"layer": "IEM_30_BEMASSUNG"},
    )
    dim.render()

    # Geschossbemassung als Kette
    x_ket = -mm(1.05)
    levels = [lv for _n, lv, _h in M.STOREYS] + [M.ROOF_LEVEL]
    for a, b in zip(levels, levels[1:]):
        d = msp.add_linear_dim(
            base=(x_ket, 0),
            p1=(-mm(M.WALL_T), mm(a)),
            p2=(-mm(M.WALL_T), mm(b)),
            angle=90,
            dimstyle="IEM_200",
            dxfattribs={"layer": "IEM_30_BEMASSUNG"},
        )
        d.render()


def draw_levels(msp):
    """Hoehenkoten in Schweizer Manier: Dreieck plus Wert."""
    # Rechts ausserhalb der Terrainschraffur (die bis WIDTH+4.0 reicht).
    x = mm(M.WIDTH) + mm(4.60)
    size = mm(0.26)
    marks = [(lv, n) for n, lv, _h in M.STOREYS] + [(M.ROOF_LEVEL, "Dachkante")]
    for level, name in marks:
        z = mm(level)
        msp.add_line((mm(M.WIDTH + M.WALL_T), z), (x, z),
                     dxfattribs={"layer": "IEM_30_BEMASSUNG"})
        msp.add_lwpolyline(
            [(x, z), (x + size, z + size), (x + size, z - size)],
            close=True, dxfattribs={"layer": "IEM_30_BEMASSUNG"},
        )
        label = "±0.00" if abs(level) < 1e-6 else f"{level:+.2f}".replace("-", "−")
        text(msp, label, x + size + mm(0.18), z, height=TXT_S,
             align=TextEntityAlignment.MIDDLE_LEFT)


def make_mp_blocks(doc):
    """
    Messpunkt als Block mit Attributen - die Werte bleiben so auswertbar.

    Zwei Varianten, weil der Beschriftungsblock sonst ueber die angemessene
    Leitung faellt: "_R" beschriftet nach rechts, "_L" nach links.
    """
    r = mm(0.30)
    for suffix, sign, align in (
        ("R", 1.0, TextEntityAlignment.LEFT),
        ("L", -1.0, TextEntityAlignment.RIGHT),
    ):
        blk = doc.blocks.new(f"IEM_MESSPUNKT_{suffix}")
        lay = {"layer": "IEM_50_MESSPUNKTE"}
        blk.add_circle((0, 0), r, dxfattribs=lay)
        blk.add_line((-r, 0), (r, 0), dxfattribs=lay)
        blk.add_line((0, -r), (0, r), dxfattribs=lay)
        for tag, dy, h in (("ID", r * 1.5, TXT_S),
                           ("WERT", -r * 0.5, TXT),
                           ("GROESSE", -r * 2.6, TXT_S)):
            ad = blk.add_attdef(
                tag, (0, 0), height=h,
                dxfattribs={"layer": "IEM_50_MESSPUNKTE", "style": "IEM"},
            )
            ad.set_placement((sign * r * 1.5, dy), align=align)


def draw_messpunkte(msp):
    for mp in M.MESSPUNKTE:
        blk = f"IEM_MESSPUNKT_{mp.get('beschriftung', 'R')}"
        ref = msp.add_blockref(
            blk, (mm(mp["x"]), mm(mp["z"])),
            dxfattribs={"layer": "IEM_50_MESSPUNKTE"},
        )
        # R2018 ist UTF-8, die Einheitenzeichen koennen direkt stehen.
        ref.add_auto_attribs({
            "ID": mp["id"],
            "WERT": mp["anzeige"],
            "GROESSE": mp["groesse"],
        })


# ---------------------------------------------------------------------------
# Planrahmen A3, Massstab 1:200
# ---------------------------------------------------------------------------

def draw_layout(doc, msp):
    # Layoutnamen duerfen keine Sonderzeichen enthalten (kein ':', kein Gedankenstrich).
    psp = doc.layouts.new("A3 1-200")
    psp.page_setup(size=(420, 297), margins=(0, 0, 0, 0), units="mm")

    def pline(pts, lw=25):
        psp.add_lwpolyline(pts, close=True,
                           dxfattribs={"layer": "IEM_90_PLANRAHMEN",
                                       "lineweight": lw})

    pline([(10, 10), (410, 10), (410, 287), (10, 287)], lw=50)

    # Schriftfeld unten rechts
    bx, by, bw, bh = 230, 10, 180, 46
    pline([(bx, by), (bx + bw, by), (bx + bw, by + bh), (bx, by + bh)], lw=50)
    for dy in (12, 24, 34):
        psp.add_line((bx, by + dy), (bx + bw, by + dy),
                     dxfattribs={"layer": "IEM_90_PLANRAHMEN"})

    def ptext(s, x, y, h=3.0, layer="IEM_90_PLANRAHMEN"):
        t = psp.add_text(s, height=h, dxfattribs={"layer": layer, "style": "IEM"})
        t.set_placement((x, y), align=TextEntityAlignment.BOTTOM_LEFT)

    ptext("IEM AG", bx + 4, by + 37, h=6.0)
    ptext("Energie- und Messtechnik · Thun / Bern", bx + 4, by + 28, h=2.6)
    ptext(M.PLAN["projekt"], bx + 4, by + 17.5, h=3.4)
    ptext(M.PLAN["titel"], bx + 4, by + 13.5, h=2.6)
    ptext(f"Plan-Nr. {M.PLAN['plan_nr']}", bx + 4, by + 5.5, h=2.8)
    ptext(f"Massstab {M.PLAN['massstab']}", bx + 78, by + 5.5, h=2.8)
    ptext("Einheit mm", bx + 132, by + 5.5, h=2.8)

    # Der Planhinweis steht bereits als Zeichnungsnotiz im Modellbereich und
    # kommt durch das Ansichtsfenster mit - hier nicht wiederholen.

    # --- Gewerkelegende + Messpunkttabelle im freien Blattbereich ---
    lx, ly, lw = 230, 70, 180
    pline([(lx, ly), (lx + lw, ly), (lx + lw, ly + 110), (lx, ly + 110)], lw=50)
    ptext("Legende", lx + 4, ly + 100, h=4.0)

    gewerke = [
        ("Heizung", "heizung", "HV/HR — Steigstrang mit Etagenabgängen"),
        ("Lüftung", "lueftung", "ZUL — Hauptkanal unter Dach, Abwürfe"),
        ("Sanitär", "sanitaer", "KW/WW — Steigstrang mit Abgängen"),
    ]
    y = ly + 88
    for name, farbe, beschrieb in gewerke:
        psp.add_line((lx + 5, y + 1.2), (lx + 17, y + 1.2),
                     dxfattribs={"layer": "IEM_90_PLANRAHMEN",
                                 "true_color": rgb(farbe), "lineweight": 50})
        ptext(name, lx + 20, y, h=2.8)
        ptext(beschrieb, lx + 48, y, h=2.4)
        y -= 7

    y -= 4
    psp.add_line((lx + 4, y + 4), (lx + lw - 4, y + 4),
                 dxfattribs={"layer": "IEM_90_PLANRAHMEN"})
    ptext("Messpunkte", lx + 4, y - 4, h=3.2)
    y -= 12
    for col, head in ((0, "Nr."), (20, "Grösse"), (66, "Wert"), (96, "Verfahren")):
        ptext(head, lx + 4 + col, y, h=2.2)
    y -= 6
    for mp in M.MESSPUNKTE:
        ptext(mp["id"], lx + 4, y, h=2.4)
        ptext(mp["groesse"], lx + 24, y, h=2.4)
        ptext(mp["anzeige"], lx + 70, y, h=2.4)
        ptext(mp["verfahren"], lx + 100, y, h=2.0)
        y -= 6.5

    # Echter Massstab 1:200: view_height / Fensterhoehe muss 200 ergeben.
    # 125 mm Fensterhoehe * 200 = 25.0 m Modellausschnitt.
    vp_h = 125.0
    ext = bbox.extents(msp, fast=False)
    center = ((ext.extmin.x + ext.extmax.x) / 2, (ext.extmin.y + ext.extmax.y) / 2)
    need = max(ext.size.x / 210.0, ext.size.y / vp_h)
    if need > PLOT:
        raise SystemExit(
            f"Zeichnung passt nicht 1:200 auf A3 (noetig waere 1:{need:.0f}); "
            f"Ausdehnung {ext.size.x/S:.1f} x {ext.size.y/S:.1f} m"
        )
    psp.add_viewport(
        center=(150, 185), size=(210, vp_h),
        view_center_point=center,
        view_height=vp_h * PLOT,
    )


# ---------------------------------------------------------------------------

def main():
    doc = new_doc()
    msp = doc.modelspace()
    make_mp_blocks(doc)

    draw_structure(msp)
    draw_plant(msp)
    draw_heizung(msp)
    draw_lueftung(msp)
    draw_sanitaer(msp)
    draw_dimensions(msp)
    draw_levels(msp)
    draw_messpunkte(msp)

    # Schnittbezeichnung und Zeichnungsnotiz
    text(msp, "SCHNITT A–A", mm(0.0), mm(M.ROOF_LEVEL + 2.6), height=TXT * 1.6)
    text(msp, M.PLAN["hinweis"], mm(0.0), mm(M.BASEMENT_LEVEL - 1.9),
         height=TXT_S)

    # Zuletzt: das Ansichtsfenster misst die fertigen Modellgrenzen aus.
    draw_layout(doc, msp)

    doc.set_modelspace_vport(height=mm(24), center=(mm(5.5), mm(6.0)))

    path = OUT / "IEM-HLKS-101_Schnitt-AA.dxf"
    doc.saveas(path)
    print(f"geschrieben: {path}  ({path.stat().st_size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
