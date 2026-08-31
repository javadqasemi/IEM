"""
Prueft cad/out/IEM-Musterprojekt.ifc: Struktur, Systeme, Messwerte - und
rendert die Geometrie in die Schnittebene, damit sich das Ergebnis mit dem
DXF vergleichen laesst.

    python cad/verify_ifc.py
"""

from __future__ import annotations

import collections
import math
import pathlib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element

import model as M

OUT = pathlib.Path(__file__).parent / "out"
IFC = OUT / "IEM-Musterprojekt.ifc"


def report(f):
    print(f"Schema           {f.schema}")
    print(f"Entitaeten       {len(list(f))}")

    counts = collections.Counter(
        e.is_a() for e in f.by_type("IfcProduct")
    )
    print("\nBauteile")
    for name, n in sorted(counts.items()):
        print(f"  {name:<26} {n}")

    print("\nGeschosse")
    for st in sorted(f.by_type("IfcBuildingStorey"), key=lambda s: s.Elevation):
        contained = sum(
            len(r.RelatedElements) for r in (st.ContainsElements or [])
        )
        print(f"  {st.Name:<8} {st.Elevation:+7.2f} m   {contained} Bauteile")

    print("\nSysteme")
    for sys in f.by_type("IfcDistributionSystem"):
        members = ifcopenshell.util.element.get_grouped_by(sys)
        print(f"  {sys.Name:<20} {sys.PredefinedType:<20} {len(members)} Elemente")

    print("\nMesspunkte (IfcSensor)")
    for s in f.by_type("IfcSensor"):
        psets = ifcopenshell.util.element.get_psets(s)
        mw = psets.get("IEM_Messwerte", {})
        print(f"  {mw.get('Messpunkt'):<8} {s.PredefinedType:<18} "
              f"{mw.get('Messwert')} {mw.get('Einheit'):<6} "
              f"{mw.get('Messverfahren')}")
    return counts


def geometry(f):
    settings = ifcopenshell.geom.settings()
    for key in ("use-world-coords", "USE_WORLD_COORDS"):
        try:
            settings.set(key, True)
            break
        except Exception:
            continue

    it = ifcopenshell.geom.iterator(settings, f)
    shapes = []
    if not it.initialize():
        raise SystemExit("Geometrie liess sich nicht aufbauen")
    while True:
        sh = it.get()
        verts = np.array(sh.geometry.verts, dtype=float).reshape(-1, 3)
        faces = np.array(sh.geometry.faces, dtype=int).reshape(-1, 3)
        shapes.append((f.by_guid(sh.guid), verts, faces))
        if not it.next():
            break
    return shapes


COLORS = {
    "IfcPipeSegment": None,      # nach System eingefaerbt
    "IfcDuctSegment": None,
    "IfcSensor": "#003882",
    "IfcSolarDevice": "#90814E",
    "IfcUnitaryEquipment": "#90814E",
}
SYS_COLOR = {
    "Heizung HV/HR": "#A2542A",
    "Lüftung Zuluft": "#2C5691",
    "Sanitär KW/WW": "#2F7D77",
    "Photovoltaik": "#90814E",
}


def color_for(el):
    for rel in el.HasAssignments or []:
        if rel.is_a("IfcRelAssignsToGroup") and rel.RelatingGroup.is_a("IfcDistributionSystem"):
            c = SYS_COLOR.get(rel.RelatingGroup.Name)
            if c:
                return c, 1.6
    if el.is_a() in COLORS and COLORS[el.is_a()]:
        return COLORS[el.is_a()], 1.4
    if el.is_a("IfcSpace"):
        return None, 0
    return "#BFCAD9", 0.7


def render(shapes, path):
    fig, ax = plt.subplots(figsize=(9, 10))
    lo = np.array([np.inf] * 3)
    hi = np.array([-np.inf] * 3)

    for el, verts, faces in shapes:
        lo = np.minimum(lo, verts.min(axis=0))
        hi = np.maximum(hi, verts.max(axis=0))
        c, lw = color_for(el)
        if not c:
            continue
        # Auf die Schnittebene X-Z projizieren, Kanten der Dreiecke zeichnen.
        segs = []
        for a, b, cc in faces:
            for p, q in ((a, b), (b, cc), (cc, a)):
                segs.append([(verts[p][0], verts[p][2]), (verts[q][0], verts[q][2])])
        lc = matplotlib.collections.LineCollection(
            segs, colors=c, linewidths=lw, alpha=0.85
        )
        ax.add_collection(lc)

    ax.set_xlim(lo[0] - 1.0, hi[0] + 1.0)
    ax.set_ylim(lo[2] - 1.0, hi[2] + 1.0)
    ax.set_aspect("equal")
    ax.set_xlabel("x [m]")
    ax.set_ylabel("z [m]  (0.00 = EG)")
    ax.set_title("IFC-Modell, projiziert in die Schnittebene A–A")
    ax.grid(True, lw=0.3, alpha=0.4)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    print(f"\nAusdehnung       x {lo[0]:.2f}…{hi[0]:.2f}   "
          f"y {lo[1]:.2f}…{hi[1]:.2f}   z {lo[2]:.2f}…{hi[2]:.2f}  [m]")
    print(f"Ansicht          {path}")
    return lo, hi


def main():
    f = ifcopenshell.open(IFC)
    report(f)
    shapes = geometry(f)
    print(f"\nGeometrie        {len(shapes)} Koerper gebaut")
    lo, hi = render(shapes, OUT / "preview-ifc.png")

    # Harte Kontrollen gegen das Massmodell
    by_name = {el.Name: verts for el, verts, _f in shapes}
    # Hoechster Punkt des geneigten Moduls: Oberkante Modulende, also
    # Laenge in Neigungsrichtung plus Aufbaudicke quer dazu.
    tilt = math.radians(M.PV["tilt_deg"])
    pv_top = (M.ROOF_LEVEL + M.PV["foot_h"]
              + M.PV["module_len"] * math.sin(tilt)
              + M.PV["module_t"] * math.cos(tilt))

    checks = [
        ("Oberkante Dachdecke", by_name["Dachdecke"][:, 2].max(), M.ROOF_LEVEL),
        ("Unterkante Bodenplatte", lo[2], M.BASEMENT_LEVEL - M.BASE_T),
        ("Oberkante PV-Feld", hi[2], pv_top),
        ("Aussenkante West", lo[0], -M.WALL_T),
        ("Aussenkante Ost", hi[0], M.WIDTH + M.WALL_T),
        ("Gebaeudetiefe", hi[1] - lo[1], M.DEPTH + 2 * M.WALL_T),
        ("Heizung Steigstrang oben",
         by_name[f"Steigstrang Heizung DN{M.HEIZUNG['dn_riser']}"][:, 2].max(),
         M.HEIZUNG["z_top"]),
        ("Lueftung Hauptkanal Hoehe",
         by_name[f"Hauptkanal ZUL {M.LUEFTUNG['duct_w']*1000:.0f}"
                 f"x{M.LUEFTUNG['duct_h']*1000:.0f}"][:, 2].mean(),
         M.LUEFTUNG["z_main"]),
    ]
    bad = 0
    print()
    for name, got, want in checks:
        ok = abs(got - want) <= 0.02
        bad += not ok
        print(f"  [{'ok' if ok else 'FEHLER'}] {name:<26} "
              f"{got:+7.2f} m  (erwartet {want:+7.2f})")
    if bad:
        raise SystemExit(f"{bad} Kontrolle(n) fehlgeschlagen")
    print("\nAlle Kontrollen bestanden.")


if __name__ == "__main__":
    main()
