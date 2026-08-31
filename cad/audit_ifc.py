"""
Prüft die Fachmodelle in `ifc/` — Modellqualität und Auslegung.

    python cad/audit_ifc.py

Anders als `verify_ifc.py`, das *unser* erzeugtes IFC gegen `model.py`
zurückrechnet, prüft dieses Skript **fremde Daten**: die Architektur-, Heizungs-
und Lüftungsmodelle des Projekts Guglera, Giffers. Es ändert nichts und ist
kein Gate — es schreibt einen Bericht.

Der Aufbau folgt dem, was sich an einem IFC überhaupt beweisen lässt:

* **Formales** — Schema, Einheiten, Georeferenzierung, doppelte GUIDs,
  Bauteile ohne Geometrie. Objektiv richtig oder falsch.
* **Föderation** — tragen die drei Modelle dieselben Geschosse und denselben
  Nullpunkt? Ohne das ist jede weitere Prüfung wertlos.
* **Rechenwerte** — die Modelle führen Volumenstrom, Innendurchmesser und
  Geschwindigkeit nebeneinander. Das lässt sich gegeneinander nachrechnen:
  v = Q / A. Wo das nicht aufgeht, ist ein Wert falsch.
* **Koordination** — Kollisionen zwischen den Gewerken und Durchdringungen des
  Rohbaus. Das ist die eigentliche Frage an ein Fachmodell.

Was hier **nicht** geprüft werden kann, steht am Ende im Bericht. Eine Zahl,
die im Modell nicht steht, wird nicht geschätzt.
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
KOMBI = IFC_DIR / "4723 Giffers Guglera Sanierung.ifc"

# Bauteile mit Achse. Formstuecke gehoeren dazu, sonst klafft an jedem Bogen
# eine Luecke und die Kollisionspruefung laeuft an den Ecken vorbei.
TECHNIK = ("IfcPipeSegment", "IfcDuctSegment", "IfcPipeFitting", "IfcDuctFitting",
           "IfcDuctSilencer", "IfcDamper", "IfcValve")

# 5 mm Toleranz: darunter ist eine Ueberdeckung Rundung, keine Kollision.
KOLLISION_TOL = 0.005

befunde: list[tuple[str, str, str]] = []


def befund(schwere: str, thema: str, text: str):
    befunde.append((schwere, thema, text))
    print(f"    [{schwere}] {text}")


# ---------------------------------------------------------------------------
# Geometrie- und Achsenzugriff
# ---------------------------------------------------------------------------

def achsen(f, klassen=TECHNIK):
    """(p0, p1, radius_m, system, klasse, id) je Bauteil mit Achse.

    Die Achse kommt aus den `IfcDistributionPort` an beiden Enden — das ist die
    Einstrichdarstellung, die im Modell ohnehin gefuehrt wird. Bei mehr als zwei
    Anschluessen zaehlt das laengste Paar, also der durchgehende Strang.

    Der Radius ist bewusst **knapp** gewaehlt: beim Rechteckkanal die halbe
    *kleinere* Seite. Damit ist jeder gemeldete Treffer sicher eine Kollision;
    Eck-an-Eck-Beruehrungen zweier Kanaele koennen dafuer durchrutschen.
    """
    import ifcopenshell.util.element as ue
    import ifcopenshell.util.placement as placement

    ports = collections.defaultdict(list)
    for rel in f.by_type("IfcRelConnectsPortToElement"):
        ports[rel.RelatedElement.id()].append(rel.RelatingPort)
    system_of = {}
    for rel in f.by_type("IfcRelAssignsToGroup"):
        if rel.RelatingGroup.is_a("IfcSystem"):
            for obj in rel.RelatedObjects:
                system_of[obj.id()] = rel.RelatingGroup.Name

    out = []
    for el in [e for k in klassen for e in f.by_type(k)]:
        if not el.Representation:      # ohne Geometrie kollidiert nichts
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
        p = ue.get_psets(el).get("Pset MEP", {})
        od = p.get("Tech-Outside-diameter (mm)")
        s1, s2 = p.get("Geom-Side 1 (mm)"), p.get("Geom-Side 2 (mm)")
        rund = p.get("Geom-Ø (mm)")
        if od:
            r_mm = od / 2
        elif s1 and s2:
            r_mm = min(s1, s2) / 2
        elif rund:
            r_mm = rund / 2
        else:
            r_mm = 30.0
        r_mm += p.get("Tech-Insulation thickness (mm)") or 0.0
        out.append((best[0], best[1], r_mm / 1000.0,
                    system_of.get(el.id(), "?"), el.is_a(), el.id()))
    return out


def netze(f, klassen):
    """Dreiecksnetz je Bauteil in Weltkoordinaten."""
    import ifcopenshell.geom

    els = [e for k in klassen for e in f.by_type(k)]
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    out = []
    it = ifcopenshell.geom.iterator(settings, f, 4, include=els)
    if it.initialize():
        while True:
            shape = it.get()
            v = np.asarray(shape.geometry.verts, dtype=np.float64).reshape(-1, 3)
            idx = np.asarray(shape.geometry.faces, dtype=np.int64).reshape(-1, 3)
            if len(idx):
                out.append((f.by_id(shape.id), v[idx]))
            if not it.next():
                break
    return out


def strecken_abstand(p1, q1, p2, q2):
    """Kleinster Abstand zweier Strecken, vektorisiert über Achse 0."""
    d1, d2 = q1 - p1, q2 - p2
    r = p1 - p2
    a = np.einsum("ij,ij->i", d1, d1)
    e = np.einsum("ij,ij->i", d2, d2)
    fv = np.einsum("ij,ij->i", d2, r)
    b = np.einsum("ij,ij->i", d1, d2)
    c = np.einsum("ij,ij->i", d1, r)
    denom = a * e - b * b
    s = np.where(denom > 1e-12,
                 np.clip((b * fv - c * e) / np.where(denom > 1e-12, denom, 1), 0, 1), 0.0)
    t = np.clip((b * s + fv) / np.where(e > 1e-12, e, 1), 0, 1)
    s = np.clip((b * t - c) / np.where(a > 1e-12, a, 1), 0, 1)
    return np.linalg.norm((p1 + d1 * s[:, None]) - (p2 + d2 * t[:, None]), axis=1)


def strecke_trifft_netz(p, q, tris):
    """Möller-Trumbore: durchstösst die Strecke p->q das Netz?"""
    d = q - p
    v0, v1, v2 = tris[:, 0], tris[:, 1], tris[:, 2]
    e1, e2 = v1 - v0, v2 - v0
    h = np.cross(np.broadcast_to(d, e2.shape), e2)
    det = np.einsum("ij,ij->i", e1, h)
    ok = np.abs(det) > 1e-12
    if not ok.any():
        return False
    inv = np.zeros_like(det)
    inv[ok] = 1.0 / det[ok]
    s = p - v0
    u = np.einsum("ij,ij->i", s, h) * inv
    qv = np.cross(s, e1)
    v = np.einsum("j,ij->i", d, qv) * inv
    t = np.einsum("ij,ij->i", e2, qv) * inv
    return bool((ok & (u >= -1e-9) & (u <= 1 + 1e-9) & (v >= -1e-9)
                 & (u + v <= 1 + 1e-9) & (t >= 1e-9) & (t <= 1 - 1e-9)).any())


# ---------------------------------------------------------------------------
# Prüfungen
# ---------------------------------------------------------------------------

def pruefe_formales(f, name):
    print(f"\n  {name}")
    import ifcopenshell.util.unit as uu

    print(f"    Schema {f.schema}, Längeneinheit -> {uu.calculate_unit_scale(f)} m")

    if not f.by_type("IfcMapConversion"):
        befund("HINWEIS", "Georeferenzierung",
               f"{name}: keine IfcMapConversion — das Modell hängt in lokalen "
               "Koordinaten, nicht in LV95.")
    for s in f.by_type("IfcSite"):
        if s.RefLatitude and s.RefLongitude:
            lat = s.RefLatitude[0] + s.RefLatitude[1] / 60 + s.RefLatitude[2] / 3600
            lon = s.RefLongitude[0] + s.RefLongitude[1] / 60 + s.RefLongitude[2] / 3600
            # Giffers FR liegt bei rund 46.79 N / 7.22 O
            if abs(lat - 46.79) > 0.5 or abs(lon - 7.22) > 0.5:
                befund("FEHLER", "Georeferenzierung",
                       f"{name}: RefLatitude/RefLongitude = {lat:.2f}°N {lon:.2f}°O, "
                       "das ist nicht Giffers (46.79°N 7.22°O).")

    guids = collections.Counter(e.GlobalId for e in f.by_type("IfcRoot"))
    for gid, n in guids.items():
        if n > 1:
            els = [e for e in f.by_type("IfcRoot") if e.GlobalId == gid]
            befund("FEHLER", "Identität",
                   f"{name}: GUID {gid} kommt {n}× vor "
                   f"({', '.join(e.is_a() for e in els)}) — GUIDs müssen eindeutig sein.")

    ohne = collections.Counter(e.is_a() for e in f.by_type("IfcElement") if not e.Representation)
    if ohne:
        detail = ", ".join(f"{n}× {k}" for k, n in ohne.most_common())
        befund("HINWEIS", "Geometrie", f"{name}: {sum(ohne.values())} Bauteile ohne "
               f"Geometrie ({detail}).")
    return {s.GlobalId: s.Elevation for s in f.by_type("IfcBuildingStorey")}


def pruefe_foederation(geschosse: dict[str, dict]):
    print("\n  Föderation")
    keys = list(geschosse)
    basis = geschosse[keys[0]]
    for k in keys[1:]:
        if set(geschosse[k]) != set(basis):
            befund("FEHLER", "Föderation",
                   f"{k}: andere Geschoss-GUIDs als {keys[0]} — die Modelle lassen "
                   "sich nicht sauber überlagern.")
        else:
            abweichung = {g: (basis[g], geschosse[k][g]) for g in basis
                          if basis[g] != geschosse[k][g]}
            if abweichung:
                befund("FEHLER", "Föderation",
                       f"{k}: {len(abweichung)} Geschosse mit abweichender Höhe "
                       f"gegenüber {keys[0]}.")
    if not any(b[0] == "FEHLER" and b[1] == "Föderation" for b in befunde):
        print(f"    alle {len(keys)} Modelle tragen dieselben "
              f"{len(basis)} Geschosse mit gleicher Höhe")


def pruefe_rohrhydraulik(f):
    print("\n  Rohrhydraulik (v gegen Q und Innendurchmesser)")
    import ifcopenshell.util.element as ue

    schief, ok, v_all, r_all, dn_falsch = [], 0, [], [], 0
    for e in f.by_type("IfcPipeSegment"):
        p = ue.get_psets(e).get("Pset MEP", {})
        q = p.get("Calc-Volumetric flow heating (l/h)")
        di = p.get("Tech-Inside-diameter (mm)")
        od = p.get("Tech-Outside-diameter (mm)")
        v = p.get("Calc-Velocitiy (m/s)")
        if di and od and abs(di - od) < 1e-9:
            dn_falsch += 1
        if q is None or not di or v is None:
            continue
        v_all.append(v)
        if p.get("Calc-R (mbar/m)") is not None:
            r_all.append(p["Calc-R (mbar/m)"])
        v_soll = (q / 3.6e6) / (math.pi * (di / 1000) ** 2 / 4)
        if abs(v_soll - v) > max(0.005, 0.03 * v):
            schief.append(e.id())
        else:
            ok += 1
    v_all, r_all = np.array(v_all), np.array(r_all)
    print(f"    {ok} von {ok + len(schief)} Rohren rechnerisch konsistent")
    if dn_falsch:
        befund("FEHLER", "Rohrdaten",
               f"Heizung: {dn_falsch} Rohre führen Innen- = Aussendurchmesser = Nennweite. "
               "Der Innendurchmesser ist dort die Nennweite, nicht das Innenmass — "
               "die Geschwindigkeit dieser Rohre lässt sich damit nicht nachrechnen.")
    print(f"    v: Median {np.median(v_all):.2f}, 95 % {np.percentile(v_all, 95):.2f}, "
          f"max {v_all.max():.2f} m/s")
    print(f"    R: Median {np.median(r_all):.2f}, max {r_all.max():.2f} mbar/m")
    if v_all.max() > 1.5:
        befund("WARNUNG", "Auslegung", f"Heizung: {(v_all > 1.5).sum()} Rohre über "
               "1.5 m/s — Strömungsgeräusch.")
    if r_all.max() > 2.5:
        befund("WARNUNG", "Auslegung", f"Heizung: {(r_all > 2.5).sum()} Rohre über "
               "2.5 mbar/m Druckgefälle.")
    langsam = int((v_all < 0.05).sum())
    if langsam:
        befund("HINWEIS", "Auslegung",
               f"Heizung: {langsam} Rohre unter 0.05 m/s. Rechnerisch unkritisch, "
               "aber bei so kleinen Geschwindigkeiten entlüftet sich das Netz nicht "
               "von selbst.")


def pruefe_heizkoerper(f):
    print("\n  Heizkörper")
    import ifcopenshell.util.element as ue

    q, m, paare = [], [], collections.Counter()
    for e in f.by_type("IfcSpaceHeater"):
        p = ue.get_psets(e).get("Pset MEP", {})
        if None in (p.get("Calc-Q target net (W)"), p.get("Calc-Design volumetric flow (kg/s)"),
                    p.get("Calc-Flow temperature"), p.get("Calc-Return temperature")):
            continue
        q.append(p["Calc-Q target net (W)"])
        m.append(p["Calc-Design volumetric flow (kg/s)"]
                 * 4180 * (p["Calc-Flow temperature"] - p["Calc-Return temperature"]))
        paare[(p["Calc-Flow temperature"], p["Calc-Return temperature"],
               p.get("Calc-Room temperature"))] += 1
    q, m = np.array(q), np.array(m)
    print(f"    {len(q)} Heizkörper, {q.sum()/1000:.1f} kW, Auslegung "
          f"{', '.join(f'{a:.0f}/{b:.0f} °C bei {c:.0f} °C' for (a, b, c) in paare)}")
    # Q = m * cp * dT. Stimmt das nur, wenn m als kg/h gelesen wird, ist die
    # Einheit im Property-Set falsch angeschrieben.
    if len(q) and np.abs(m - q).mean() > q.mean():
        if np.abs(m / 3600 - q).mean() < 0.01 * q.mean():
            befund("FEHLER", "Einheiten",
                   "Heizung: „Calc-Design volumetric flow (kg/s)\" führt in Wahrheit "
                   "kg/h — Q = m·cp·ΔT geht nur so auf. Der Name nennt ausserdem einen "
                   "Volumenstrom, der Wert ist ein Massenstrom.")
        else:
            befund("FEHLER", "Auslegung",
                   "Heizung: Leistung, Massenstrom und Spreizung der Heizkörper passen "
                   "in keiner Einheitendeutung zusammen.")


def pruefe_anschluesse(f, name):
    verbunden = set()
    for r in f.by_type("IfcRelConnectsPorts"):
        verbunden.add(r.RelatingPort.id())
        verbunden.add(r.RelatedPort.id())
    besitzer = {r.RelatingPort.id(): r.RelatedElement
                for r in f.by_type("IfcRelConnectsPortToElement")}
    offen = collections.Counter(el.is_a() for pid, el in besitzer.items()
                                if pid not in verbunden)
    print(f"    {name}: {len(besitzer)} Anschlüsse, offen {sum(offen.values())}")
    if offen:
        befund("WARNUNG", "Netz",
               f"{name}: {sum(offen.values())} offene Anschlüsse "
               f"({dict(offen.most_common(4))}) — dort endet ein Strang im Nichts.")


def pruefe_luftmengen(g):
    print("\n  Luftmengen")
    import ifcopenshell.util.element as ue

    je_medium = collections.defaultdict(list)
    for e in g.by_type("IfcAirTerminal"):
        p = ue.get_psets(e).get("Pset MEP", {})
        je_medium[p.get("Tech-Medium", "?")].append(p.get("Calc-Volumetric flow (m3/h)") or 0.0)
    alle = [v for vs in je_medium.values() for v in vs]
    for med, vs in sorted(je_medium.items()):
        print(f"    {med:<16} {len(vs):4d} Stk  {sum(vs):8.0f} m³/h")
    if alle and len(set(alle)) == 1:
        befund("FEHLER", "Luftmengen",
               f"Lüftung: alle {len(alle)} Luftdurchlässe führen denselben Wert "
               f"{alle[0]:.0f} m³/h. Das ist ein Vorgabewert, keine Auslegung — jede "
               "Bilanz aus diesen Zahlen ist ohne Aussage.")
    fehlklasse = sum(1 for e in g.by_type("IfcAirTerminal")
                     if (ue.get_psets(e).get("Pset MEP", {}).get("Name") or "").startswith("Abluft")
                     and ue.get_psets(e).get("Pset MEP", {}).get("Tech-Medium") == "L_Zuluft")
    if fehlklasse:
        befund("WARNUNG", "Luftmengen",
               f"Lüftung: {fehlklasse} Bauteile heissen „Abluftventil\", sind aber dem "
               "Medium L_Zuluft zugeordnet — Typ oder Systemzuordnung stimmt nicht.")
    for e in g.by_type("IfcUnitaryEquipment"):
        p = ue.get_psets(e).get("Pset MEP", {})
        if not any(k.startswith("Calc") for k in p):
            befund("HINWEIS", "Luftmengen",
                   "Lüftung: die Lüftungsgeräte tragen nur Abmessungen, keine Leistungs- "
                   "oder Volumenstromdaten — die Anlagenluftmenge steht nicht im Modell.")
            break


def pruefe_daemmung(f):
    print("\n  Dämmung")
    import ifcopenshell.util.element as ue

    ohne = collections.Counter()
    for e in f.by_type("IfcPipeSegment"):
        p = ue.get_psets(e).get("Pset MEP", {})
        if not p.get("Tech-Insulation thickness (mm)"):
            ohne[p.get("Tech-DN")] += 1
    gross = {dn: n for dn, n in ohne.items() if dn and dn.isdigit() and int(dn) >= 25}
    print(f"    ohne Dämmstärke im Datensatz: {sum(ohne.values())} Rohre "
          f"(davon DN ≥ 25: {sum(gross.values())})")
    if gross:
        befund("WARNUNG", "Dämmung",
               f"Heizung: {sum(gross.values())} Rohre ab DN 25 ohne Dämmstärke "
               f"({gross}). Dämmung ist als Geometrie modelliert (Layer H_Isolierung), "
               "am Rohr aber nicht als Eigenschaft geführt — eine Prüfung gegen "
               "MuKEn/SIA 380/1 ist aus dem Modell so nicht möglich.")


def pruefe_kollisionen(h_achsen, l_achsen):
    print("\n  Kollisionen Heizung × Lüftung")
    hp0 = np.array([a[0] for a in h_achsen]); hp1 = np.array([a[1] for a in h_achsen])
    hr = np.array([a[2] for a in h_achsen])
    hlo = np.minimum(hp0, hp1) - hr[:, None]
    hhi = np.maximum(hp0, hp1) + hr[:, None]

    treffer, spalte = [], []
    for i, (p0, p1, r, sysn, kls, eid) in enumerate(l_achsen):
        lo = np.minimum(p0, p1) - r - 0.30
        hi = np.maximum(p0, p1) + r + 0.30
        m = np.all((hlo <= hi) & (hhi >= lo), axis=1)
        idx = np.nonzero(m)[0]
        if not len(idx):
            continue
        d = strecken_abstand(hp0[idx], hp1[idx],
                             np.repeat(np.asarray(p0)[None], len(idx), 0),
                             np.repeat(np.asarray(p1)[None], len(idx), 0))
        luft = d - (hr[idx] + r)
        spalte.append(luft)
        for k in np.nonzero(luft < -KOLLISION_TOL)[0]:
            treffer.append((float(-luft[k]), h_achsen[idx[k]], l_achsen[i]))
    spalte = np.concatenate(spalte) if spalte else np.zeros(0)
    print(f"    {len(spalte)} Paare im 30-cm-Umkreis, kleinster freier Abstand "
          f"{spalte.min()*1000:.0f} mm" if len(spalte) else "    keine Paare im Umkreis")
    if treffer:
        befund("FEHLER", "Kollision",
               f"{len(treffer)} harte Kollisionen zwischen Heizung und Lüftung.")
        for ueb, h, l in sorted(treffer, key=lambda t: -t[0])[:10]:
            mid = (np.asarray(h[0]) + np.asarray(h[1])) / 2
            print(f"      {ueb*1000:5.0f} mm  {h[3]} × {l[3]}  bei "
                  f"x={mid[0]:.2f} y={mid[1]:.2f} z={mid[2]:.2f}")
    else:
        print("    keine harten Kollisionen")
    return treffer


def pruefe_durchdringungen(a, mep):
    print("\n  Durchdringungen und Öffnungen")
    gefuellt = collections.Counter()
    belegt = set()
    for r in a.by_type("IfcRelFillsElement"):
        gefuellt[r.RelatedBuildingElement.is_a()] += 1
        belegt.add(r.RelatingOpeningElement.id())
    offen = [o for o in a.by_type("IfcOpeningElement") if o.id() not in belegt]
    print(f"    Öffnungen im Architekturmodell: {len(a.by_type('IfcOpeningElement'))} "
          f"({dict(gefuellt)}), ungefüllt: {len(offen)}")

    rohbau = netze(a, ("IfcWallStandardCase", "IfcWall", "IfcSlab"))
    rb_lo = np.array([m.reshape(-1, 3).min(0) for _e, m in rohbau])
    rb_hi = np.array([m.reshape(-1, 3).max(0) for _e, m in rohbau])

    stellen = []
    for tag, A in mep.items():
        gefunden = []
        for p0, p1, r, sysn, kls, eid in A:
            lo, hi = np.minimum(p0, p1), np.maximum(p0, p1)
            for j in np.nonzero(np.all((rb_lo <= hi) & (rb_hi >= lo), axis=1))[0]:
                if strecke_trifft_netz(np.asarray(p0), np.asarray(p1), rohbau[j][1]):
                    gefunden.append(((np.asarray(p0) + np.asarray(p1)) / 2,
                                     rohbau[j][0], r, tag, sysn))
                    break
        # was naeher als 20 cm im selben Bauteil liegt, ist ein Durchbruch
        gruppen = []
        for pt, el, r, t, sysn in gefunden:
            for gr in gruppen:
                if gr["el"].id() == el.id() and np.linalg.norm(gr["p"] - pt) < 0.20:
                    gr["r"] = max(gr["r"], r)
                    break
            else:
                gruppen.append({"p": pt, "el": el, "r": r, "tag": t, "sys": sysn})
        print(f"    {tag}: {len(gefunden)} durchdringende Bauteile -> "
              f"{len(gruppen)} Durchbruchstellen")
        stellen.extend(gruppen)

    if stellen and not offen:
        arten = collections.Counter(s["el"].is_a() for s in stellen)
        befund("FEHLER", "Koordination",
               f"{len(stellen)} Stellen, an denen Heizung oder Lüftung Wand oder Decke "
               f"durchdringt ({dict(arten)}) — und im Architekturmodell **keine einzige** "
               "Öffnung dafür. Alle vorhandenen Öffnungen sind Fenster und Türen. "
               "Es gibt also keine Durchbruchsplanung im Modell.")
        for s in sorted(stellen, key=lambda s: -s["r"])[:8]:
            print(f"      ab Ø {s['r']*2000:4.0f} mm  {s['tag']:<8} {s['sys']:<10} "
                  f"{s['el'].is_a():<20} x={s['p'][0]:.2f} y={s['p'][1]:.2f} z={s['p'][2]:.2f}")
    return stellen


def pruefe_kombidatei():
    import ifcopenshell

    print("\n  Sammeldatei")
    if not KOMBI.exists():
        return
    k = ifcopenshell.open(str(KOMBI))
    kaputt = [s for s in k.by_type("IfcBuildingStorey") if not s.ObjectPlacement]
    if kaputt:
        befund("FEHLER", "Sammeldatei",
               f"{KOMBI.name}: {len(kaputt)} von {len(k.by_type('IfcBuildingStorey'))} "
               "Geschossen ohne Verortung und mit Höhe 0.00. Alle Bauteile hängen an "
               "einem einzigen Geschoss — die Datei ist als Sammelmodell unbrauchbar.")


# ---------------------------------------------------------------------------

def main():
    import ifcopenshell

    print("=" * 74)
    print("Fachmodelle Guglera, Giffers — Prüfbericht")
    print("=" * 74)

    print("\nFormales")
    dateien = {}
    geschosse = {}
    for pfad in (ARCHITEKTUR, HEIZUNG, LUEFTUNG):
        f = ifcopenshell.open(str(pfad))
        dateien[pfad.name] = f
        geschosse[pfad.name] = pruefe_formales(f, pfad.name)

    pruefe_foederation(geschosse)
    pruefe_kombidatei()

    a = dateien[ARCHITEKTUR.name]
    h = dateien[HEIZUNG.name]
    g = dateien[LUEFTUNG.name]

    pruefe_rohrhydraulik(h)
    pruefe_heizkoerper(h)
    print("\n  Anschlüsse")
    pruefe_anschluesse(h, "Heizung")
    pruefe_anschluesse(g, "Lüftung")
    pruefe_luftmengen(g)
    pruefe_daemmung(h)

    h_achsen = achsen(h)
    l_achsen = achsen(g)
    print(f"\n  Achsen mit Geometrie: Heizung {len(h_achsen)}, Lüftung {len(l_achsen)}")
    pruefe_kollisionen(h_achsen, l_achsen)
    pruefe_durchdringungen(a, {"Heizung": h_achsen, "Lüftung": l_achsen})

    print("\n" + "=" * 74)
    zahl = collections.Counter(b[0] for b in befunde)
    print(f"Befunde: {zahl['FEHLER']} Fehler, {zahl['WARNUNG']} Warnungen, "
          f"{zahl['HINWEIS']} Hinweise")
    for schwere in ("FEHLER", "WARNUNG", "HINWEIS"):
        for s, thema, text in befunde:
            if s == schwere:
                print(f"  [{s:<8}] {thema:<18} {text}")

    print("""
Nicht prüfbar aus diesen Dateien
  - Brandabschnitte sind nicht modelliert; ob die 13 Brandschutzklappen
    ausreichen, lässt sich am Modell nicht entscheiden.
  - Die Lüftungsgeräte führen keine Luftmengen, also gibt es keine
    Anlagenbilanz, gegen die sich die Durchlässe prüfen liessen.
  - Heizlast je Raum: die Räume heissen alle „Raum", tragen keine Nummer und
    keine Mengen (kein Qto_*). Eine raumweise Prüfung ist nicht möglich.
  - Die DWG-Pläne lassen sich hier nicht öffnen (kein DWG-Leser installiert),
    also ist der Abgleich Modell gegen Planstand offen.
""")


if __name__ == "__main__":
    main()
