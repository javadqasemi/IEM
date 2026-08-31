"""
Massmodell fuer den Musterschnitt A-A.

Einzige Quelle der Wahrheit fuer beide Generatoren (build_dxf.py, build_ifc.py),
damit DXF und IFC nicht auseinanderlaufen.

Herkunft der Masse
------------------
Die Geometrie ist aus dem Hero-Schema in src/components/Hero.tsx abgeleitet.
Dort laeuft ein SVG-viewBox "0 0 520 560"; die bemasste Gebaeudehoehe von
14.20 m entspricht den 350 Einheiten zwischen y=104 (Dachkante) und y=454
(Terrain/EG). Daraus:

    k = 14.20 / 350 = 0.0405714 m je SVG-Einheit
    x_m = (x_svg - 100) * k      # 0 = Innenkante Wand links
    z_m = (454 - y_svg) * k      # 0 = EG / Terrain

Wo das Schema unbaubare Werte liefert, ist auf Baumasse gerundet; jede solche
Abweichung ist unten kommentiert. Alle Werte in Metern, Hoehen ueber EG (+-0.00).
"""

# --------------------------------------------------------------------------
# Umrechnung aus dem Hero-SVG
# --------------------------------------------------------------------------

SVG_K = 14.20 / 350.0
SVG_X0 = 100.0
SVG_Z0 = 454.0


def from_svg_x(x: float) -> float:
    return (x - SVG_X0) * SVG_K


def from_svg_z(y: float) -> float:
    return (SVG_Z0 - y) * SVG_K


# --------------------------------------------------------------------------
# Gebaeude
# --------------------------------------------------------------------------

# Lichte Breite im Schnitt: aus SVG 330 Einheiten = 13.389 m, gerundet.
WIDTH = 13.40
# Gebaeudetiefe steht nicht im Schnitt (Schnittrichtung); fuer ein
# tragfaehiges 3D-Modell angenommen.
DEPTH = 24.00

WALL_T = 0.30
SLAB_T = 0.30
ROOF_T = 0.35
BASE_T = 0.40

# Geschosse. Die Summe der drei oberirdischen Geschosse ergibt exakt die
# bemassten 14.20 m; die SVG-Bandhoehen (4.63 / 4.79 / 4.79) sind auf
# 4.60 / 4.80 / 4.80 gerundet.
STOREYS = [
    # (Name, OK Rohboden, lichte Geschosshoehe)
    ("UG", -3.10, 3.10),
    ("EG", 0.00, 4.60),
    ("1. OG", 4.60, 4.80),
    ("2. OG", 9.40, 4.80),
]
ROOF_LEVEL = 14.20
TERRAIN_LEVEL = 0.00
BASEMENT_LEVEL = -3.10

# --------------------------------------------------------------------------
# Heizung - Steigzone mit Etagenabgaengen (SVG x=159, Abgaenge nach x=250)
# --------------------------------------------------------------------------

HEIZUNG = {
    "riser_x": 2.40,          # SVG 159 -> 2.394
    "branch_x": 6.09,         # SVG 250 -> 6.086
    "z_bottom": -1.90,        # Anschluss WP im UG
    "z_top": 11.80,           # SVG 164 -> 11.77
    "branches": [2.20, 7.00, 11.80],   # SVG 400/282/164 -> 2.19 / 6.98 / 11.77
    "dn_riser": 50,
    "dn_branch": 32,
}

# --------------------------------------------------------------------------
# Lueftung - Hauptkanal unter Dach mit Abwuerfen (SVG y=140)
# --------------------------------------------------------------------------

LUEFTUNG = {
    "z_main": 12.74,          # SVG 140 -> 12.74
    "x_start": 1.06,          # SVG 126
    "x_end": 12.33,           # SVG 404
    "drops": [                # (x, z_unten)
        (8.11, 10.30),        # SVG 300 -> 8.11 / y=200 -> 10.30
        (10.79, 10.30),       # SVG 366 -> 10.79
    ],
    # Abwurf am Strangende, dann horizontal ins 2. OG
    "tail": {"x": 12.33, "z": 7.95, "x_to": 9.73},
    "duct_w": 0.50,
    "duct_h": 0.25,
}

# --------------------------------------------------------------------------
# Sanitaer - Steigstrang mit Abgaengen (SVG x=394)
# --------------------------------------------------------------------------

SANITAER = {
    "riser_x": 11.93,         # SVG 394 -> 11.93
    "z_bottom": -1.90,
    "z_top": 5.76,            # SVG 312
    "branches": [             # (z, x_bis)
        (1.38, 9.33),         # SVG 420 -> 1.38 / x=330 -> 9.33
        (3.57, 9.73),         # SVG 366 -> 3.57 / x=340 -> 9.73
    ],
    "dn_riser": 40,
    "dn_branch": 25,
}

# --------------------------------------------------------------------------
# Gebaeudehuelle
# --------------------------------------------------------------------------
#
# Bis hierher ist das Gebaeude eine Kiste - fuer ein Anlagenschema genuegt das.
# Fuer die 3D-Szene traegt die Huelle die Architektur: gestaffelte Baukoerper,
# duenne auskragende Flachdaecher, ein steinverkleidetes Volumen, raumhohe
# Verglasung mit dunklen Rahmen und eine Pergola ueber der Dachterrasse.
#
# **Das Tragwerk aendert sich dadurch nicht.** Geschosshoehen, Breite und Tiefe
# bleiben, wie sie sind - sonst wuerden Straenge, Raeume und Messpunkte
# wandern. Die Huelle ist eine Schicht darueber, vollstaendig aus den Massen
# oben abgeleitet.
#
# Ein Detail ist Absicht: die Pergolabalken werden nach aussen schmaler. Das
# ist die Konstruktion der IEM-Wortmarke - ein Raster verjuengender Striche -,
# hier als Bauteil. Siehe .tick-rule in globals.css, dieselbe Idee.

HUELLE = {
    # Steinvolumen an der Ostseite, ueber alle Geschosse, leicht vorstehend.
    "stein_x": (10.20, WIDTH),
    "stein_vorstand": 0.55,
    # Das oberste Geschoss springt an der Suedfassade zurueck; darauf liegt
    # die Dachterrasse.
    "attika_versatz": 4.20,
    # Flachdaecher: duenn und weit auskragend, wie auf dem Vorbild.
    "dach_dicke": 0.30,
    "ueberstand": 1.10,
    # Fensterbaender: Anteil der lichten Geschosshoehe, Rahmenbreite.
    "glas_anteil": 0.74,
    "rahmen": 0.09,
    # Auskragender Balkon vor dem 1. OG.
    "balkon": {"x": (0.0, 8.00), "tiefe": 1.90, "dicke": 0.26, "gelaender": 1.05},
    # Pergola ueber der Dachterrasse.
    "pergola": {
        "balken": 13,
        "hoehe": 0.26,
        "breit_innen": 0.20,   # Balkenbreite am Gebaeude
        "breit_aussen": 0.09,  # ... und am freien Ende: verjuengt wie die Marke
        "ueber_terrasse": 2.70,
    },
}

# --------------------------------------------------------------------------
# Raeume
# --------------------------------------------------------------------------
#
# Eine grobe Nutzungsaufteilung je Geschoss, damit die Anlage in einem Haus
# steht und nicht in einer leeren Kiste. Die Zuschnitte sind gesetzt, nicht
# gemessen - es gibt keinen Grundriss zu diesem Schnitt -, aber sie sind an
# der Anlage ausgerichtet: die Technikzentrale umschliesst Waermepumpe, Pumpe
# und Speicher, der Sanitaerraum liegt an den Entnahmestellen, die Bodenheizung
# liegt vollstaendig im Buero.
#
# Angaben je Raum: (Name, x von-bis, y von-bis) in Modellkoordinaten.

RAEUME = {
    "UG": [
        ("Technikzentrale", (0.40, 6.60), (6.00, 15.00)),
        ("Lager", (7.00, 13.00), (6.00, 15.00)),
        ("Veloraum", (0.40, 13.00), (15.60, 22.50)),
    ],
    "EG": [
        ("Empfang", (0.40, 3.40), (7.60, 16.40)),
        ("Büro", (3.80, 8.60), (7.60, 16.40)),
        ("Sanitär", (9.00, 11.20), (7.60, 16.40)),
        ("Nebenraum", (11.60, 13.00), (7.60, 16.40)),
    ],
    "1. OG": [
        ("Büro Nord", (0.40, 4.60), (6.00, 18.00)),
        ("Büro Mitte", (5.00, 9.20), (6.00, 18.00)),
        ("Büro Süd", (9.60, 13.00), (6.00, 18.00)),
    ],
    "2. OG": [
        ("Grossraum", (0.40, 6.60), (6.00, 18.00)),
        ("Sitzungszimmer", (7.00, 13.00), (6.00, 18.00)),
    ],
}

TECHNIKZENTRALE = ("UG", "Technikzentrale")

# --------------------------------------------------------------------------
# Waermeabgabe und Umwaelzung
# --------------------------------------------------------------------------
#
# Das Schema oben zeigt Steigstrang und Abgaenge - was am Ende des Abgangs
# haengt, laesst ein Schema offen. Fuer die 3D-Szene ist genau das die Frage,
# also steht es hier: Pumpe, Heizkoerper, Verteiler, Bodenheizung.
#
# Aufteilung wie in einem realen Projekt dieser Groesse: im EG Bodenheizung
# ueber einen Verteiler, in den Obergeschossen Heizkoerper. Beides zu zeigen
# ist ehrlicher als eine Anlage, die im ganzen Haus dasselbe macht.

# Umwaelzpumpe im Vorlauf, ueber der Waermepumpe.
PUMPE = {
    "x": HEIZUNG["riser_x"],
    "z": -1.20,
    "laenge": 0.34,        # Baulaenge in Rohrachse
    "d_gehaeuse": 0.22,    # Motorgehaeuse quer zur Rohrachse
}

# Heizkoerper an den Abgaengen der Obergeschosse. Index 0 (EG) traegt keinen -
# dort liegt die Bodenheizung.
HEIZKOERPER = {
    "an_abzweig": [1, 2],
    "breite": 1.10,
    "hoehe": 0.60,
    "tiefe": 0.12,
    "unter_leitung": 0.45,   # Achsabstand Leitung -> Mitte Heizkoerper
    # Anschluesse links und rechts, Achsabstand von der Koerpermitte. Vorlauf
    # links hinein, Ruecklauf rechts heraus - ein Heizkoerper wird durchstroemt,
    # nicht angetippt.
    "anschluss_x": 0.45,
}

# Waschbecken im Sanitaerraum, am unteren Abgang. Kalt und warm kommen von
# oben, das Abwasser geht nach unten in den Fallstrang.
WASCHBECKEN = {
    "x": SANITAER["branches"][0][1],
    "z": 0.86,               # OK Becken ueber Fertigboden
    "breite": 0.62,
    "tiefe": 0.44,
    "hoehe": 0.18,
}

# Zuluftauslaesse am Ende der Abwuerfe.
LUFTAUSLASS = {
    "breite": 0.60,
    "hoehe": 0.12,
    "tiefe": 0.40,
}

# Heizkreisverteiler im EG, am Ende des EG-Abgangs.
VERTEILER = {
    "x": HEIZUNG["branch_x"],
    "z": 0.75,               # Verteilerkasten ueber Fertigboden
    "breite": 0.70,
    "hoehe": 0.55,
    "tiefe": 0.16,
}

# Bodenheizung im EG: Schlange im Ueberzug, gespeist aus dem Verteiler.
# Verlegeabstand 0.25 m ist der uebliche Bereich (0.15-0.30); die Feldgroesse
# ist ein Raum von 6.40 x 8.00 m, nicht das ganze Geschoss - eine Schlange
# ueber 13 x 24 m waere keine Anlage, sondern ein Teppich.
BODENHEIZUNG = {
    "z": 0.08,               # im Ueberzug ueber der Rohdecke
    # Feld liegt vollstaendig im Buero (RAEUME["EG"]), keine Schlange unter
    # einer Trennwand hindurch.
    "x_von": 4.20,
    "x_bis": 8.40,
    "y_von": 8.00,           # Raumtiefe, in Modellkoordinaten
    "y_bis": 16.00,
    "verlegeabstand": 0.25,
    "dn": 17,
}

# --------------------------------------------------------------------------
# Medien
# --------------------------------------------------------------------------
#
# Bis hierher fuehrt jedes Gewerk **eine** Linie - das ist die Schema-Ebene, die
# der Hero-Schnitt zeigt und die fuer ein Uebersichtsschema richtig ist. Eine
# gebaute Anlage besteht aber aus Medien, die sich nicht mischen lassen:
# Vorlauf ist nicht Ruecklauf, Kaltwasser ist nicht Abwasser. Ab hier stehen
# sie einzeln, weil die 3D-Szene zeigt, was tatsaechlich in den Rohren laeuft.
#
# Die Farben sind aus der Markenpalette (disc-*), nicht aus der DIN-Farbtafel:
# die Seite muss zusammenpassen, und ein Betrachter liest hier "warm / kalt /
# schmutzig", keinen Normfarbcode.
#
# ACHTUNG - noch nicht in DXF und IFC: build_dxf.py und build_ifc.py zeichnen
# weiterhin nur die drei Schema-Straenge oben. Die Zusatzstraenge brauchen dort
# eigene Layer bzw. IfcFlowSegment-Typen; solange das nicht nachgezogen ist,
# zeigt die 3D-Szene mehr als das Planblatt.

# Trassenachsen in der Gebaeudetiefe.
#
# **Zwei Leitungen duerfen sich nicht durchdringen.** Im Schema faellt das
# nicht auf, weil ein Schnitt keine Tiefe hat - dort liegen alle Straenge auf
# einer Ebene und Vorlauf und Ruecklauf sogar deckungsgleich uebereinander. In
# einem Modell ist das eine Kollision, und Kollisionsfreiheit ist genau das,
# was die BIM-Koordination auf dieser Seite verspricht.
#
# Also bekommt jedes Medium seine eigene Achse. Die Abstaende sind groesser als
# die Summe der halben Durchmesser der Nachbarn, mit Luft fuer Daemmung: die
# Lueftungskanaele (250 mm) liegen 0.55 m auseinander, die Rohre 0.35 m.
# Reihenfolge nach Gewerk gebuendelt, wie eine reale Trassenfuehrung.
Y_TRASSE = {
    "heizwasser_vl": DEPTH / 2 - 0.70,
    "heizwasser_rl": DEPTH / 2 - 0.35,
    "bodenheizung": DEPTH / 2 - 0.70,   # haengt am selben Verteiler wie der VL
    "zuluft": DEPTH / 2 + 0.30,
    "abluft": DEPTH / 2 + 0.85,
    "kaltwasser": DEPTH / 2 + 1.40,
    "warmwasser": DEPTH / 2 + 1.75,
    "abwasser": DEPTH / 2 + 2.20,
}

MEDIEN = {
    "heizwasser_vl": {"label": "Heizwasser Vorlauf", "kurz": "Vorlauf", "farbe": (162, 84, 42), "gewerk": "Heizung"},
    "heizwasser_rl": {"label": "Heizwasser Rücklauf", "kurz": "Rücklauf", "farbe": (124, 100, 76), "gewerk": "Heizung"},
    "zuluft": {"label": "Zuluft", "kurz": "Zuluft", "farbe": (44, 86, 145), "gewerk": "Lüftung"},
    "abluft": {"label": "Abluft", "kurz": "Abluft", "farbe": (124, 145, 178), "gewerk": "Lüftung"},
    "bodenheizung": {"label": "Bodenheizung", "kurz": "Bodenheizung", "farbe": (188, 118, 74), "gewerk": "Heizung"},
    "kaltwasser": {"label": "Kaltwasser", "kurz": "Kaltwasser", "farbe": (47, 125, 119), "gewerk": "Sanitär"},
    "warmwasser": {"label": "Warmwasser", "kurz": "Warmwasser", "farbe": (183, 110, 60), "gewerk": "Sanitär"},
    "abwasser": {"label": "Abwasser", "kurz": "Abwasser", "farbe": (112, 106, 94), "gewerk": "Sanitär"},
}

# Achsabstaende der zusaetzlichen Straenge zum jeweiligen Schema-Strang.
RL_DX = 0.35          # Heizung: Ruecklauf neben dem Vorlauf
WW_DX = -0.35         # Sanitaer: Warmwasser neben dem Kaltwasser
AW_DX = 0.55          # Sanitaer: Abwasser-Fallstrang
AW_Z_BOTTOM = -2.60   # Fallstrang bis unter die UG-Sohle (Anschluss Kanal)
ABL_DZ = -0.45        # Lueftung: Abluftkanal unter dem Zuluftkanal
ABL_Z_UNTEN = 10.30   # Abluft-Ansaugung auf Hoehe der Zuluft-Abwuerfe

# --------------------------------------------------------------------------
# Anlagen
# --------------------------------------------------------------------------

# Waermepumpe: im Schema schwebt der Kasten (SVG y=478..512); hier auf den
# UG-Rohboden gestellt, sonst waere das Modell nicht baubar.
WP = {
    "x": 1.22,                # SVG 130
    "width": 2.35,            # SVG 58 Einheiten
    "height": 1.40,
    "depth": 1.20,
    "z_base": BASEMENT_LEVEL,
}

# Warmwasserspeicher neben der Waermepumpe - der Punkt, an dem der
# Warmwasserstrang anfaengt.
SPEICHER = {
    "x": 4.60,
    "z_base": BASEMENT_LEVEL,
    "d": 0.80,
    "h": 1.90,
}

# Lueftungsmonoblock am Anfang des Zuluftkanals, unter dem Dach. Erklaert,
# woher die Luft kommt - ein Kanal, der im Nichts beginnt, tut das nicht.
LUEFTUNGSGERAET = {
    "x": LUEFTUNG["x_start"],
    "z": LUEFTUNG["z_main"],
    "breite": 1.80,
    "hoehe": 1.10,
    "tiefe": 1.30,
}

# PV-Feld: 4 Reihen, aus SVG-Neigung 16/32 Einheiten -> 26.6 Grad.
PV = {
    "rows": 4,
    "x_first": 2.03,          # SVG 150
    "spacing": 2.43,          # SVG 60 Einheiten
    "module_len": 1.45,     # Laenge in Neigungsrichtung
    "module_w": 8.00,       # Feldbreite laengs der Gebaeudetiefe
    "module_t": 0.04,       # Aufbaudicke
    "tilt_deg": 27.0,
    "foot_h": 0.32,
    "z_base": ROOF_LEVEL,
}

# --------------------------------------------------------------------------
# Messpunkte - die drei Werte aus dem Hero
# --------------------------------------------------------------------------
#
# Plausibilitaet (nachgerechnet, damit die Zahlen zueinander passen):
#   Lueftung  1'450 m3/h in 500x250 -> 3.22 m/s Kanalgeschwindigkeit
#   Sanitaer  12 l/min in DN25      -> 0.64 m/s Fliessgeschwindigkeit
#   Heizung   38.6 GradC Vorlauf    -> Niedertemperatur, passt zur WP im UG

MESSPUNKTE = [
    {
        "id": "MP-H-01",
        "gewerk": "Heizung",
        "groesse": "Vorlauftemperatur",
        "kurz": "Vorlauf",          # Kurzform fuer die Hero-Fahne
        "wert": 38.6,
        "einheit": "°C",
        "anzeige": "38.6 °C",
        "x": HEIZUNG["branch_x"],
        "z": 7.00,
        "verfahren": "Anlegefühler PT100, Klasse A",
    },
    {
        "id": "MP-L-01",
        # Auf dem Plan nach rechts (links kommt der Kanal an), im Hero nach
        # links - dort sitzt der Punkt bei 78 % und die Fahne liefe sonst
        # aus der Karte.
        "hero_seite": "L",
        "gewerk": "Lüftung",
        "groesse": "Volumenstrom",
        "kurz": "Volumenstrom",
        "wert": 1450.0,
        "einheit": "m³/h",
        "anzeige": "1'450 m³/h",
        "x": LUEFTUNG["x_end"],
        "z": LUEFTUNG["z_main"],
        "verfahren": "Flügelradanemometer, Netzmessung nach SN EN 12599",
    },
    {
        "id": "MP-S-01",
        # Der Abgang laeuft nach rechts weg -> Beschriftung nach links,
        # sonst liegt der Text auf der Leitung.
        "beschriftung": "L",
        "gewerk": "Sanitär",
        "groesse": "Durchfluss",
        "kurz": "Durchfluss",
        "wert": 12.0,
        "einheit": "l/min",
        "anzeige": "12 l/min",
        "x": SANITAER["branches"][0][1],
        "z": SANITAER["branches"][0][0],
        "verfahren": "Ultraschall-Clamp-on",
    },
]

# --------------------------------------------------------------------------
# Planangaben
# --------------------------------------------------------------------------

PLAN = {
    "projekt": "Musterprojekt Gebäudetechnik",
    "plan_nr": "IEM-HLKS-101",
    "titel": "Schnitt A–A — Schema Heizung / Lüftung / Sanitär",
    "massstab": "1:200",
    "buero": "IEM AG — Energie- und Messtechnik, Thun / Bern",
    "hinweis": (
        "Schematischer Schnitt. Messwerte beispielhaft — im Projekt "
        "stammen sie aus der Einregulierung vor der Abnahme."
    ),
}

# Markenfarben (siehe tailwind.config.ts / src/lib/tokens.ts)
FARBEN = {
    "struktur": (191, 202, 217),
    "heizung": (162, 84, 42),
    "lueftung": (44, 86, 145),
    "sanitaer": (47, 125, 119),
    "anlagen": (144, 129, 78),
    "text": (86, 101, 126),
    "navy": (0, 56, 130),
}
