"""
Erzeugt das Musterprojekt als IFC4-Modell.

    python cad/build_ifc.py

Ergebnis: cad/out/IEM-Musterprojekt.ifc

Anders als das DXF ist das hier ein echtes 3D-Modell - der Schnitt A-A ist
nur eine Ansicht darauf. Enthalten:

  * Bauwerksstruktur Projekt / Grundstueck / Gebaeude / Geschosse
  * Rohbau: Bodenplatte, Geschossdecken, Dach, Aussenwaende, Raeume
  * Gebaeudetechnik als IfcDistributionSystem je Gewerk, mit
    IfcPipeSegment / IfcDuctSegment als Straenge
  * Waermepumpe und PV-Feld
  * Die drei Messpunkte als IfcSensor mit dem Messwert im Property-Set
    "IEM_Messwerte" - damit haengt die Zahl am Bauteil und nicht an einer
    Beschriftung.

Masse kommen aus model.py, damit DXF und IFC dieselbe Geometrie beschreiben.
"""

from __future__ import annotations

import math
import pathlib

import numpy as np

import ifcopenshell
import ifcopenshell.guid
import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.geometry
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.system
import ifcopenshell.api.unit

import model as M

OUT = pathlib.Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)

api = ifcopenshell.api


# ---------------------------------------------------------------------------
# Platzierung und Geometrie
# ---------------------------------------------------------------------------

def matrix(origin=(0.0, 0.0, 0.0), zdir=(0.0, 0.0, 1.0), xdir=None) -> np.ndarray:
    """4x4-Platzierungsmatrix aus Ursprung und lokaler Z-Richtung."""
    z = np.array(zdir, dtype=float)
    z /= np.linalg.norm(z)
    if xdir is None:
        # Beliebige Richtung, die nicht parallel zu z liegt, dann orthogonalisieren.
        seed = np.array([0.0, 0.0, 1.0]) if abs(z[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
        x = seed - np.dot(seed, z) * z
    else:
        x = np.array(xdir, dtype=float)
        x = x - np.dot(x, z) * z
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    m = np.eye(4)
    m[:3, 0] = x
    m[:3, 1] = y
    m[:3, 2] = z
    m[:3, 3] = np.array(origin, dtype=float)
    return m


def place(f, product, m: np.ndarray):
    api.geometry.edit_object_placement(f, product=product, matrix=m, is_si=True)


def _point2(f, x, y):
    return f.create_entity("IfcCartesianPoint", Coordinates=(float(x), float(y)))


def _shape(f, body, item, rep_type="SweptSolid"):
    return f.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body,
        RepresentationIdentifier="Body",
        RepresentationType=rep_type,
        Items=[item],
    )


def box_rep(f, body, sx: float, sy: float, sz: float, centred=False):
    """Quader, extrudiert entlang lokaler +Z. Ohne `centred` liegt die Ecke im Ursprung."""
    pos = None if centred else f.create_entity(
        "IfcAxis2Placement2D", Location=_point2(f, sx / 2.0, sy / 2.0)
    )
    profile = f.create_entity(
        "IfcRectangleProfileDef", ProfileType="AREA",
        Position=pos, XDim=float(sx), YDim=float(sy),
    )
    solid = f.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        ExtrudedDirection=f.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
        Depth=float(sz),
    )
    return _shape(f, body, solid)


def pipe_rep(f, body, diameter: float, length: float):
    """Rundes Rohr, extrudiert entlang lokaler +Z."""
    profile = f.create_entity(
        "IfcCircleProfileDef", ProfileType="AREA", Radius=float(diameter) / 2.0
    )
    solid = f.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        ExtrudedDirection=f.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
        Depth=float(length),
    )
    return _shape(f, body, solid)


def duct_rep(f, body, w: float, h: float, length: float):
    profile = f.create_entity(
        "IfcRectangleProfileDef", ProfileType="AREA", XDim=float(w), YDim=float(h)
    )
    solid = f.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        ExtrudedDirection=f.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
        Depth=float(length),
    )
    return _shape(f, body, solid)


# ---------------------------------------------------------------------------
# Hilfen fuer Bauteile
# ---------------------------------------------------------------------------

class Builder:
    """
    Duennes Wrapper-Objekt. Das Modell liegt in der Schnittebene:
    X = Schnittrichtung (Breite), Y = Gebaeudetiefe, Z = Hoehe ueber EG.
    """

    def __init__(self):
        self.f = f = ifcopenshell.file(schema="IFC4")
        api.root.create_entity(f, ifc_class="IfcProject", name=M.PLAN["projekt"])
        self.project = f.by_type("IfcProject")[0]
        api.unit.assign_unit(f, length={"is_metric": True, "raw": "METERS"})

        model_ctx = api.context.add_context(f, context_type="Model")
        self.body = api.context.add_context(
            f, context_type="Model", context_identifier="Body",
            target_view="MODEL_VIEW", parent=model_ctx,
        )

        self.site = api.root.create_entity(f, ifc_class="IfcSite", name="Areal")
        self.building = api.root.create_entity(
            f, ifc_class="IfcBuilding", name=M.PLAN["projekt"]
        )
        api.aggregate.assign_object(f, products=[self.site], relating_object=self.project)
        api.aggregate.assign_object(f, products=[self.building], relating_object=self.site)

        self.storeys = {}
        for name, level, _h in M.STOREYS:
            st = api.root.create_entity(f, ifc_class="IfcBuildingStorey", name=name)
            st.Elevation = float(level)
            place(f, st, matrix((0.0, 0.0, level)))
            api.aggregate.assign_object(f, products=[st], relating_object=self.building)
            self.storeys[name] = st

        # Dachgeschoss fuer PV und Dachdecke
        st = api.root.create_entity(f, ifc_class="IfcBuildingStorey", name="Dach")
        st.Elevation = float(M.ROOF_LEVEL)
        place(f, st, matrix((0.0, 0.0, M.ROOF_LEVEL)))
        api.aggregate.assign_object(f, products=[st], relating_object=self.building)
        self.storeys["Dach"] = st

    # -- Bauteile ---------------------------------------------------------

    def element(self, ifc_class, name, storey, rep, m, predefined_type=None):
        f = self.f
        el = api.root.create_entity(
            f, ifc_class=ifc_class, name=name, predefined_type=predefined_type
        )
        place(f, el, m)
        api.geometry.assign_representation(f, product=el, representation=rep)
        # Raeume sind selbst Bauwerksstruktur: sie werden dem Geschoss
        # untergeordnet, nicht darin "enthalten".
        if el.is_a("IfcSpatialElement"):
            api.aggregate.assign_object(
                f, products=[el], relating_object=self.storeys[storey]
            )
        else:
            api.spatial.assign_container(
                f, products=[el], relating_structure=self.storeys[storey]
            )
        return el

    def box(self, ifc_class, name, storey, origin, size, predefined_type=None):
        sx, sy, sz = size
        rep = box_rep(self.f, self.body, sx, sy, sz)
        return self.element(ifc_class, name, storey, rep, matrix(origin),
                            predefined_type=predefined_type)

    def run(self, ifc_class, name, storey, p0, p1, diameter=None,
            duct=None, predefined_type="RIGIDSEGMENT"):
        """Ein gerades Strangstueck von p0 nach p1."""
        p0 = np.array(p0, dtype=float)
        p1 = np.array(p1, dtype=float)
        d = p1 - p0
        length = float(np.linalg.norm(d))
        if length < 1e-9:
            raise ValueError(f"{name}: Strangstueck ohne Laenge")
        if duct:
            rep = duct_rep(self.f, self.body, duct[0], duct[1], length)
        else:
            rep = pipe_rep(self.f, self.body, diameter, length)
        return self.element(ifc_class, name, storey, rep, matrix(p0, zdir=d),
                            predefined_type=predefined_type)

    def pset(self, product, name, properties):
        ps = api.pset.add_pset(self.f, product=product, name=name)
        api.pset.edit_pset(self.f, pset=ps, properties=properties)
        return ps

    def system(self, name, predefined_type):
        f = self.f
        sys = api.system.add_system(f, ifc_class="IfcDistributionSystem")
        sys.Name = name
        sys.PredefinedType = predefined_type
        f.create_entity(
            "IfcRelServicesBuildings",
            GlobalId=ifcopenshell.guid.new(),
            Name=name,
            RelatingSystem=sys,
            RelatedBuildings=[self.building],
        )
        return sys


# ---------------------------------------------------------------------------
# Modellaufbau
# ---------------------------------------------------------------------------

def storey_of(z: float) -> str:
    """Geschoss, in dem eine Hoehe liegt."""
    name = M.STOREYS[0][0]
    for n, level, _h in M.STOREYS:
        if z >= level - 1e-6:
            name = n
    return name


def build_structure(b: Builder):
    W, D, T = M.WIDTH, M.DEPTH, M.WALL_T

    # Bodenplatte
    b.box("IfcSlab", "Bodenplatte UG", "UG",
          (-T, -T, M.BASEMENT_LEVEL - M.BASE_T),
          (W + 2 * T, D + 2 * T, M.BASE_T), predefined_type="BASESLAB")

    # Geschossdecken (Oberkante = Geschossniveau)
    for name, level, _h in M.STOREYS[1:]:
        b.box("IfcSlab", f"Decke unter {name}", name,
              (0.0, 0.0, level - M.SLAB_T), (W, D, M.SLAB_T),
              predefined_type="FLOOR")

    # Dachdecke
    b.box("IfcSlab", "Dachdecke", "Dach",
          (-T, -T, M.ROOF_LEVEL - M.ROOF_T),
          (W + 2 * T, D + 2 * T, M.ROOF_T), predefined_type="ROOF")

    # Aussenwaende ueber die volle Hoehe
    h = M.ROOF_LEVEL - M.BASEMENT_LEVEL
    walls = [
        ("Aussenwand West", (-T, -T, M.BASEMENT_LEVEL), (T, D + 2 * T, h)),
        ("Aussenwand Ost", (W, -T, M.BASEMENT_LEVEL), (T, D + 2 * T, h)),
        ("Aussenwand Sued", (0.0, -T, M.BASEMENT_LEVEL), (W, T, h)),
        ("Aussenwand Nord", (0.0, D, M.BASEMENT_LEVEL), (W, T, h)),
    ]
    for name, origin, size in walls:
        b.box("IfcWall", name, "UG", origin, size, predefined_type="SOLIDWALL")

    # Raeume je Geschoss - macht das Modell fuer Volumen und Energie brauchbar.
    for name, level, hh in M.STOREYS:
        clear = hh - (M.SLAB_T if name != M.STOREYS[-1][0] else M.ROOF_T)
        sp = b.box("IfcSpace", f"Nutzflaeche {name}", name,
                   (0.0, 0.0, level), (W, D, clear), predefined_type="SPACE")
        b.pset(sp, "Pset_SpaceCommon", {
            "GrossPlannedArea": float(W * D),
            "PubliclyAccessible": False,
        })


def build_heizung(b: Builder):
    h = M.HEIZUNG
    y = M.DEPTH / 2.0
    sys = b.system("Heizung HV/HR", "HEATING")
    parts = []

    d_riser = h["dn_riser"] / 1000.0
    d_branch = h["dn_branch"] / 1000.0

    parts.append(b.run(
        "IfcPipeSegment", f"Steigstrang Heizung DN{h['dn_riser']}",
        storey_of(h["z_bottom"]),
        (h["riser_x"], y, h["z_bottom"]), (h["riser_x"], y, h["z_top"]),
        diameter=d_riser,
    ))
    for z in h["branches"]:
        parts.append(b.run(
            "IfcPipeSegment", f"Abgang Heizung DN{h['dn_branch']} auf {z:+.2f}",
            storey_of(z),
            (h["riser_x"], y, z), (h["branch_x"], y, z), diameter=d_branch,
        ))

    # Waermepumpe und Anbindung
    wp = M.WP
    wp_el = b.box("IfcUnitaryEquipment", "Wärmepumpe Sole/Wasser", "UG",
                  (wp["x"], y - wp["depth"] / 2.0, wp["z_base"]),
                  (wp["width"], wp["depth"], wp["height"]),
                  predefined_type="USERDEFINED")
    wp_el.ObjectType = "Wärmepumpe Sole/Wasser"
    b.pset(wp_el, "IEM_Anlage", {
        "Gewerk": "Heizung",
        "Aufstellung": "Technikraum UG",
        "Auslegungsvorlauf": 38.6,
    })
    parts.append(wp_el)

    api.system.assign_system(b.f, products=parts, system=sys)
    return sys


def build_lueftung(b: Builder):
    l = M.LUEFTUNG
    y = M.DEPTH / 2.0
    sys = b.system("Lüftung Zuluft", "VENTILATION")
    parts = []
    duct = (l["duct_w"], l["duct_h"])

    parts.append(b.run(
        "IfcDuctSegment",
        f"Hauptkanal ZUL {l['duct_w']*1000:.0f}x{l['duct_h']*1000:.0f}",
        storey_of(l["z_main"]),
        (l["x_start"], y, l["z_main"]), (l["x_end"], y, l["z_main"]), duct=duct,
    ))
    for i, (x, z_u) in enumerate(l["drops"], start=1):
        parts.append(b.run(
            "IfcDuctSegment", f"Abwurf ZUL {i}", storey_of(z_u),
            (x, y, l["z_main"]), (x, y, z_u), duct=duct,
        ))
    t = l["tail"]
    parts.append(b.run(
        "IfcDuctSegment", "Abwurf ZUL Strangende", storey_of(t["z"]),
        (l["x_end"], y, l["z_main"]), (t["x"], y, t["z"]), duct=duct,
    ))
    parts.append(b.run(
        "IfcDuctSegment", "Verteilung ZUL 2. OG", storey_of(t["z"]),
        (t["x"], y, t["z"]), (t["x_to"], y, t["z"]), duct=duct,
    ))

    api.system.assign_system(b.f, products=parts, system=sys)
    return sys


def build_sanitaer(b: Builder):
    s = M.SANITAER
    y = M.DEPTH / 2.0
    sys = b.system("Sanitär KW/WW", "DOMESTICCOLDWATER")
    parts = []
    d_riser = s["dn_riser"] / 1000.0
    d_branch = s["dn_branch"] / 1000.0

    parts.append(b.run(
        "IfcPipeSegment", f"Steigstrang Sanitär DN{s['dn_riser']}",
        storey_of(s["z_bottom"]),
        (s["riser_x"], y, s["z_bottom"]), (s["riser_x"], y, s["z_top"]),
        diameter=d_riser,
    ))
    for z, x_to in s["branches"]:
        parts.append(b.run(
            "IfcPipeSegment", f"Abgang Sanitär DN{s['dn_branch']} auf {z:+.2f}",
            storey_of(z), (s["riser_x"], y, z), (x_to, y, z), diameter=d_branch,
        ))

    api.system.assign_system(b.f, products=parts, system=sys)
    return sys


def build_pv(b: Builder):
    pv = M.PV
    y = M.DEPTH / 2.0
    sys = b.system("Photovoltaik", "ELECTRICAL")
    tilt = math.radians(pv["tilt_deg"])
    parts = []
    for i in range(pv["rows"]):
        x = pv["x_first"] + i * pv["spacing"]
        z = pv["z_base"] + pv["foot_h"]
        # Modulebene um die Gebaeudetiefe geneigt: lokale Z zeigt die Neigung
        # hinauf, lokale X muss explizit auf die Tiefe gelegt werden - sonst
        # waehlt matrix() eine Ersatzachse und die Modulbreite kippt mit auf.
        m = matrix((x, y - pv["module_w"] / 2.0, z),
                   zdir=(math.cos(tilt), 0.0, math.sin(tilt)),
                   xdir=(0.0, 1.0, 0.0))
        rep = box_rep(b.f, b.body, pv["module_w"], pv["module_t"],
                      pv["module_len"])
        el = b.element("IfcSolarDevice", f"PV-Reihe {i+1}", "Dach", rep, m,
                       predefined_type="SOLARPANEL")
        parts.append(el)
    b.pset(parts[0], "IEM_Anlage", {
        "Gewerk": "Energie",
        "Planungsgrundlage": "SIA 108",
        "Neigung": float(pv["tilt_deg"]),
        "Reihen": int(pv["rows"]),
    })
    api.system.assign_system(b.f, products=parts, system=sys)
    return sys


SENSOR_TYP = {
    "Vorlauftemperatur": "TEMPERATURESENSOR",
    "Volumenstrom": "FLOWSENSOR",
    "Durchfluss": "FLOWSENSOR",
}


def build_messpunkte(b: Builder):
    """
    Die drei Messwerte als IfcSensor. Der Wert haengt damit am Objekt und
    ist auswertbar - nicht bloss eine Beschriftung auf einem Plan.
    """
    y = M.DEPTH / 2.0
    sensors = []
    for mp in M.MESSPUNKTE:
        rep = box_rep(b.f, b.body, 0.16, 0.16, 0.16, centred=True)
        el = b.element(
            "IfcSensor", f"{mp['id']} {mp['groesse']}", storey_of(mp["z"]),
            rep, matrix((mp["x"], y, mp["z"])),
            predefined_type=SENSOR_TYP[mp["groesse"]],
        )
        b.pset(el, "IEM_Messwerte", {
            "Messpunkt": mp["id"],
            "Gewerk": mp["gewerk"],
            "Messgroesse": mp["groesse"],
            "Messwert": float(mp["wert"]),
            "Einheit": mp["einheit"],
            "Messverfahren": mp["verfahren"],
            "Herkunft": "Einregulierung vor der Abnahme",
            "Beispielwert": True,
        })
        sensors.append(el)
    return sensors


def main():
    b = Builder()
    build_structure(b)
    build_heizung(b)
    build_lueftung(b)
    build_sanitaer(b)
    build_pv(b)
    build_messpunkte(b)

    b.pset(b.project, "IEM_Plan", {
        "Planbezeichnung": M.PLAN["plan_nr"],
        "Titel": M.PLAN["titel"],
        "Buero": M.PLAN["buero"],
        "Hinweis": M.PLAN["hinweis"],
    })

    path = OUT / "IEM-Musterprojekt.ifc"
    b.f.write(str(path))
    print(f"geschrieben: {path}  ({path.stat().st_size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
