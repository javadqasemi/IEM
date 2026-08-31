# CAD

Zwei Werkzeugketten, die nichts miteinander zu tun haben:

| | Quelle | Ergebnis |
| --- | --- | --- |
| **Fachmodell** | `ifc/*.ifc` — die IFC des Kunden zum Projekt Guglera, Giffers | `SchnittGuglera.tsx` (Hero-Schnitt) und `scene_guglera.json` (3D-Szene in `#ablauf`) — **beides steht auf der Seite** |
| **Musterprojekt** | `model.py` — selbst modelliert | DXF/DWG-Plansatz und IFC4-Modell. Seine beiden React-Ausgaben werden noch erzeugt, aber nicht mehr gerendert. |

Das Musterprojekt bleibt aus zwei Gründen, und keiner davon ist die Seite: an
ihm hängen der Plansatz und das IFC-Ergebnis, und `build_scene.py` ist die
einzige echte automatische Prüfung im Repo (Kollisionsprüfung, siehe unten).

**Die Generatoren schreiben verschiedene Dateien.** Nie auf dieselbe richten:
der jeweils nächste Lauf überschriebe die Arbeit des anderen.

---

# Schnitt aus dem Fachmodell

```bash
pip install ifcopenshell
python cad/build_svg_ifc.py      # -> src/components/SchnittGuglera.tsx
```

`ifc_schnitt.py` legt eine senkrechte Ebene durch das Gebäude, `build_svg_ifc.py`
schreibt daraus die React-Komponente. Gesetzt sind nur drei Dinge — Lage der
Ebene (x = 5.00 m), Bandbreite der Technik (±8 m) und welche drei Bauteile eine
Wertfahne bekommen. Alles andere kommt aus dem IFC.

## Zwei Verfahren, weil das IFC zwei Beschreibungen führt

**Rohbau** liegt als Dreiecksnetz vor. Die Ebene wird mit jedem Dreieck
geschnitten; das ergibt echte Schnittkanten. Aus den ~1'000 Schnipseln knüpft
`chain()` Polylinien und `simplify()` (Douglas-Peucker) glättet sie auf ~37
Züge — ohne das stünden Tausende Einzelstriche im SVG. Geschlossene Ringe sind
angeschnittene Wände und Decken und werden pochéiert.

**Technik** trägt ihre Achse als `IfcDistributionPort` an beiden Enden. Das ist
bereits die Einstrichdarstellung, die ein Schnitt 1:200 zeigt. Die Netze werden
deshalb nicht geschnitten, sondern aus einem Band um die Ebene auf sie
projiziert: ein Schnitt ohne Band zeigte nur die zufällig getroffenen Stränge,
und die Aussage der Zeichnung ist die Verteilung im Gebäude, nicht der Zufall
der Ebene. Formstücke zählen mit — ohne sie klafft an jedem Bogen eine Lücke
und ein Strang zerfällt in Dutzende Striche.

Ein Strang, der die Ebene quer durchstösst, wird als **Punkt** gezeichnet, wie
ein angeschnittenes Rohr. Sonst fehlten genau die Leitungen, die in der
Gebäudelängsachse verteilen.

## Farben

Aus `IfcSystem`: Vor-/Rücklauf → `disc-heat`, Zu-/Abluft → `disc-air`,
Kaltwasser → `disc-water`. Der jeweilige Rücklauf trägt dieselbe Gewerkfarbe
mit halber Deckkraft; ein zweiter Farbton je Gewerk wäre ein Token, das eine
Richtung und keine Disziplin benennt (siehe CLAUDE.md, „Two colour groups").

## Wertfahnen

Drei Zahlen, alle aus `Pset MEP` des angeschriebenen Bauteils:

| Fahne | Wert | Property |
| --- | --- | --- |
| Auslegung | 50 / 40 °C | `Calc-Flow/Return temperature` der 182 Heizkörper |
| Zuluftkanal | 754 × 1'304 mm | `Geom-Side 1/2 (mm)` des grössten Zuluftkanals |
| Kaltwasser | DN 100 · 0.56 m/s | `Tech-DN`, `Calc-Velocitiy (m/s)` |

Es sind **Auslegungsdaten, keine Messwerte** — das steht so in der
Bildunterschrift. Diese IFC führen keine Einregulierung mit.

## 3D-Szene für #ablauf

```bash
python cad/build_scene_ifc.py     # -> src/generated/scene_guglera.json + .ts
```

Dieselben drei IFC, diesmal räumlich. **Jedes `IfcProduct` wird zugeordnet**,
und eine Klasse ohne Regel bricht den Lauf ab — stillschweigend weglassen gilt
nicht. 7'786 Bauteile werden gezeichnet, 11'194 nicht, jedes mit Grund im
exportierten Inventar: 9'734 sind `IfcDistributionPort` (ein Anschlusspunkt,
kein Bauteil), 1'041 führen in der Quelle keine Geometrie, 410 sind Öffnungen
und werden durch das Fenster oder die Tür darin dargestellt.

Zwei Darstellungen: Rohre, Kanäle und Formstücke als Zylinder aus Achse und
Radius — ein Rohr *ist* ein Zylinder, und die Achse steht ohnehin als
`IfcDistributionPort` im Modell. Alles andere als gedrehter Quader über der
kleinsten umschliessenden Grundfläche. **Ausnahme Decken:** die bleiben ein
echtes Dreiecksnetz, sonst füllt ein Quader die Schächte und verdeckt genau
die Steigstränge, wegen derer die Szene existiert.

Rund ein Sechstel der Leitungsbauteile führt nur einen Anschluss. Deren Achse
kommt aus der ersten Hauptachse des Netzes; ohne diesen Rückfall fielen 650
Rohre und 118 Kanäle aus der Leitungsdarstellung heraus.

**Die Daten liegen als JSON-Ressource neben dem Modul, nicht darin.** Das ist
keine Stilfrage: 62'000 Zahlen als Array-Literal sind ebenso viele AST-Knoten,
und der Build lief damit **18 Minuten** statt 8 Sekunden — auch als
`JSON.parse("…")` noch, weil Vite die Datei trotzdem durch den Modulgraphen
zieht. Über `?url` sieht der Bundler eine Ressource.

## Modellprüfung

```bash
python cad/audit_ifc.py
```

Prüft die Dateien in `ifc/` und schreibt einen Bericht — Formales (Schema,
Einheiten, Georeferenzierung, doppelte GUIDs, Bauteile ohne Geometrie),
Föderation (tragen alle Modelle dieselben Geschosse?), Rechenwerte
(v gegen Q und Innendurchmesser, Q gegen Massenstrom und Spreizung),
Anschlüsse, Luftmengen, Dämmung, Kollisionen Heizung × Lüftung und
Durchdringungen des Rohbaus.

Es ist **kein Gate** — es prüft fremde Daten und ändert nichts. `verify_ifc.py`
dagegen rechnet *unser* erzeugtes IFC gegen `model.py` zurück und ist ein Gate.

Zwei Dinge, die der Prüfer bewusst konservativ macht:

- Der Kollisionsradius eines Rechteckkanals ist die halbe **kleinere** Seite.
  Jeder gemeldete Treffer ist damit sicher eine Kollision; eine Eck-an-Eck-
  Berührung zweier Kanäle kann durchrutschen. Lieber kein falscher Alarm als
  eine Liste, die niemand mehr durchsieht.
- Die Achse eines Formstücks ist die Sehne zwischen seinen Anschlüssen, nicht
  der Bogen. An engen Bögen ist die Prüfung dadurch etwas grob.

Der Bericht endet mit einer Liste dessen, was sich aus den Dateien **nicht**
entscheiden lässt. Diese Liste ist der wichtigere Teil: eine Zahl, die im
Modell nicht steht, wird nicht geschätzt.

## Grenzen

- Das Fachmodell des Kunden enthält Architektur, Heizung und Lüftung. Es gibt
  **kein Sanitärmodell**; „Kaltwasser" ist der Kaltwasserkreis der Zentrale und
  liegt in der Heizungsdatei.
- Fenster und Türen werden nicht geschnitten — auf Hero-Grösse sind sie
  Rauschen. Die Öffnungen fehlen deshalb auch in der Schnittfläche.
- Die Geschosse heissen im Modell alle „Geschoss". Angeschrieben wird die
  Höhenkote, die wirklich drinsteht; UG/EG/OG wäre geraten, denn das Modell
  führt kein Terrain.
- Es ist ein **echtes Kundenprojekt**. Bevor die Seite öffentlich geht, muss
  geklärt sein, ob Projektname und Modell gezeigt werden dürfen.

---

# Musterprojekt — Schnitt A–A

Ein selbst modelliertes Beispielgebäude als echte Planungsdaten: eine
2D-Zeichnung (DXF → DWG) und ein 3D-Fachmodell (IFC4). Es speist ausserdem die
3D-Szene in `#ablauf`.

## Erzeugen

```bash
pip install ezdxf ifcopenshell matplotlib
python cad/build_dxf.py      # -> out/IEM-HLKS-101_Schnitt-AA.dxf
python cad/build_ifc.py      # -> out/IEM-Musterprojekt.ifc
python cad/build_svg.py      # -> src/components/SchnittAA.tsx  (Hero-Zeichnung)
python cad/verify_ifc.py     # prueft das IFC und rendert out/preview-ifc.png
```

**Nach jeder Massänderung** laufen `build_dxf.py` und danach `build_svg.py` —
der SVG-Export liest das DXF, nicht `model.py`.

`matplotlib` wird nur zum Prüfen und Vorschau-Rendern gebraucht, nicht zum
Erzeugen der Dateien.

Vorschaubilder ohne CAD-Programm:

```bash
python -m ezdxf draw --background WHITE -o out/preview-model.png out/IEM-HLKS-101_Schnitt-AA.dxf
python -m ezdxf draw -l "A3 1-200" --background WHITE -o out/preview-plan.png out/IEM-HLKS-101_Schnitt-AA.dxf
python -m ezdxf audit out/IEM-HLKS-101_Schnitt-AA.dxf
```

## Dateien

| Datei | Rolle |
| --- | --- |
| `model.py` | Massmodell. **Einzige Quelle der Wahrheit** — beide Generatoren lesen daraus, damit DXF und IFC dieselbe Geometrie beschreiben. |
| `build_dxf.py` | 2D-Schnitt, DXF R2018, Einheit Millimeter. |
| `build_ifc.py` | 3D-Fachmodell, IFC4. |
| `build_svg.py` | DXF → `src/components/SchnittAA.tsx`. Wird von der Seite **nicht mehr gerendert**, seit der Hero den Schnitt aus dem Fachmodell zeigt. |
| `build_scene.py` | → `src/generated/scene.ts`. Ebenfalls **nicht mehr gerendert**, seit `#ablauf` das Fachmodell zeigt. Trotzdem nach jeder Änderung an `model.py` laufen lassen: das Skript prüft jedes Rohr gegen die Rohre jedes anderen Mediums und bricht ab, wenn zwei sich näher kommen als die Summe ihrer Radien. Eine gemeldete Kollision nicht durch Lockern der Prüfung „beheben". |
| `verify_ifc.py` | Liest *unser* IFC zurück, prüft Masse gegen `model.py`, rendert die Schnittebene. Nicht verwechseln mit `audit_ifc.py`, das die Kundenmodelle in `ifc/` prüft. |
| `to_dwg.ps1` | DXF → DWG (braucht den ODA File Converter, siehe unten). |

Eine Massänderung gehört **immer** nach `model.py`, nie in einen der
Generatoren — sonst driften Zeichnung und Modell auseinander.

## Woher die Masse kommen

Abgeleitet aus dem Hero-SVG (`viewBox="0 0 520 560"`). Die bemassten 14.20 m
liegen dort zwischen y=104 (Dachkante) und y=454 (Terrain), also

```
k    = 14.20 / 350 = 0.0405714 m je SVG-Einheit
x_m  = (x_svg − 100) · k        # 0 = Innenkante Wand links
z_m  = (454 − y_svg) · k        # 0 = EG / Terrain
```

Wo das Schema unbaubare Werte liefert, ist auf Baumasse gerundet. Die
Abweichungen stehen als Kommentar an der jeweiligen Stelle in `model.py`; die
beiden grösseren:

- **Geschosshöhen** 4.60 / 4.80 / 4.80 m statt der krummen 4.63 / 4.79 / 4.79 —
  die Summe ergibt weiterhin exakt die bemassten 14.20 m.
- **Wärmepumpe** steht auf dem UG-Rohboden. Im Schema schwebt der Kasten.

Die Gebäudetiefe (24.00 m) steht nicht im Schnitt und ist angenommen — ohne
sie liesse sich kein 3D-Modell bauen.

Die drei Messwerte sind nachgerechnet, damit sie zueinander passen:

| Messwert | Kontrolle |
| --- | --- |
| 1'450 m³/h in Kanal 500×250 | 3.22 m/s Kanalgeschwindigkeit |
| 12 l/min in DN25 | 0.64 m/s Fliessgeschwindigkeit |
| 38.6 °C Vorlauf | Niedertemperatur, passt zur Wärmepumpe im UG |

## DXF

Einheit **Millimeter** (`$INSUNITS = 4`), geplottet 1:200. Layer sind nach
Gewerk getrennt und in den Markenfarben aus `tailwind.config.ts` eingefärbt:

```
IEM_00_STRUKTUR    IEM_10_HEIZUNG     IEM_30_BEMASSUNG   IEM_90_PLANRAHMEN
IEM_01_TERRAIN     IEM_11_LUEFTUNG    IEM_40_TEXT
IEM_20_ANLAGEN     IEM_12_SANITAER    IEM_50_MESSPUNKTE
```

Diese Trennung ist bewusst: bei einem späteren SVG-Export werden daraus
gewerkweise Gruppen, die sich direkt per CSS einfärben lassen — statt
hunderter anonymer Pfade mit Inline-Farben.

Weiter enthalten:

- Bemassungsstil `IEM_200` — Masszahlen in Metern (`dimlfac = 0.001`),
  Schrägstrich-Terminatoren statt Pfeilen, wie im Hero-Schema.
- Höhenkoten in Schweizer Manier (Dreieck + Wert, `±0.00`).
- Messpunkte als Block `IEM_MESSPUNKT_R` / `_L` mit den Attributen `ID`,
  `WERT`, `GROESSE` — die Werte bleiben so auswertbar statt blosser Text zu
  sein. Zwei Varianten, weil der Beschriftungsblock sonst über die
  angemessene Leitung fällt.
- Layout **A3 1-200** mit Schriftfeld, Gewerkelegende und Messpunkttabelle.
  Der Massstab ist echt: Fensterhöhe 125 mm × 200 = 25.0 m Modellausschnitt.

## DWG

DWG ist ein geschlossenes Format; es gibt **keine freie Bibliothek, die es
schreibt**. Deshalb ist DXF R2018 die Ausgabe und DWG ein Konvertierungs-
schritt. Zwei Wege:

1. **ODA File Converter** (gratis) —
   <https://www.opendesign.com/guestfiles/oda_file_converter>, danach

   ```powershell
   powershell -File cad\to_dwg.ps1
   ```

   Das Skript sucht den Konverter selbst und schreibt nach `out/dwg/`.

2. **Ein CAD öffnen** — AutoCAD, BricsCAD, ZWCAD, Revit und Archicad lesen
   das DXF direkt und speichern als DWG.

## IFC

IFC4, Einheit Meter. Anders als das DXF ist das ein echtes 3D-Modell; der
Schnitt A–A ist nur eine Ansicht darauf.

- **Struktur** Projekt → Areal → Gebäude → Geschosse (UG, EG, 1. OG, 2. OG, Dach)
- **Rohbau** Bodenplatte, Geschossdecken, Dachdecke, vier Aussenwände,
  Nutzflächen als `IfcSpace`
- **Gebäudetechnik** je Gewerk ein `IfcDistributionSystem`
  (`HEATING`, `VENTILATION`, `DOMESTICCOLDWATER`, `ELECTRICAL`) mit
  `IfcPipeSegment` / `IfcDuctSegment` als Stränge
- **Anlagen** Wärmepumpe (`IfcUnitaryEquipment`), PV-Feld (`IfcSolarDevice`)
- **Messpunkte** als `IfcSensor` (`TEMPERATURESENSOR` / `FLOWSENSOR`) mit dem
  Property-Set `IEM_Messwerte`

Das letzte Stück ist der eigentliche Punkt: der Messwert hängt am Bauteil,
nicht an einer Beschriftung. Auslesen mit

```python
import ifcopenshell, ifcopenshell.util.element
f = ifcopenshell.open("cad/out/IEM-Musterprojekt.ifc")
for s in f.by_type("IfcSensor"):
    print(ifcopenshell.util.element.get_psets(s)["IEM_Messwerte"])
```

`IEM_Messwerte` führt `Beispielwert = True` und
`Herkunft = "Einregulierung vor der Abnahme"` mit — die Einschränkung aus der
Hero-Bildunterschrift steht damit in den Daten selbst und geht nicht
verloren, wenn jemand nur das Modell weitergibt.

### Prüfung

`verify_ifc.py` baut die Geometrie mit IfcOpenShell auf und vergleicht sie
gegen `model.py` — Dachkante, Fundament, Aussenkanten, Gebäudetiefe,
Strangenden. Nach jeder Massänderung laufen lassen.

## SVG-Export

`build_svg.py` erzeugt `src/components/SchnittAA.tsx`. Die Datei ist
**generiert** — Änderungen daran gehen beim nächsten Lauf verloren. Der Hero
zeigt sie nicht mehr; sie bleibt als zweite, schematische Lesart derselben
Zeichnung und weil an ihr der Zuschnitt-Code hängt, den `build_svg_ifc.py`
nicht braucht.

Aufteilung:

- **Geometrie** aus dem DXF. Gelesen werden nur die Zeichnungslayer;
  Bemassung, CAD-Text, Messpunktblöcke und Planrahmen bleiben liegen, weil der
  Hero sie anders setzt.
- **Beschriftung** (Geschosse, Höhenmass) zeichnet der Exporter aus
  `model.py`, damit sie die Seitentypografie trägt statt CAD-Text zu sein.

Der Ausschnitt (`CROP`) ist enger als das DXF: dort läuft das Terrain 4 m nach
jeder Seite, im Hero soll es am Kartenrand enden. Strecken werden per
Liang-Barsky zugeschnitten; geschlossene Konturen werden nur übernommen, wenn
sie ganz im Ausschnitt liegen — ein Zuschnitt würde sie öffnen.

Exportiert werden drei Dinge:

| Export | |
| --- | --- |
| `SchnittAA` | Die Zeichnung. Trassen tragen `pathLength="1"` und `strokeDasharray="1"`, damit `animate-draw` unabhängig von der echten Pfadlänge durchläuft. Farben als Tailwind-Klassen (`stroke-disc-heat` &c.), nicht als Hex. |
| `messpunkte` | Die Messwertfahnen mit Position in Prozent der Zeichenfläche — der Hero legt sie als HTML darüber. |
| `schnittAspect` | Seitenverhältnis der Zeichenfläche. |

`schnittAspect` ist der Grund, warum die Fahnen sitzen: der Hero rahmt SVG und
Overlays in **eine** Box dieses Verhältnisses. Ohne das würde das SVG in der
Karte letterboxen und die Prozentwerte zeigten daneben.

Die Fahnenseite steuert `hero_seite` in `model.py` und nicht `beschriftung` —
die Zeichenfläche im Hero ist schmaler als das Planblatt, die Fahnen fallen
dort anders herum.

Ein DXF aus Revit oder Archicad lässt sich genauso verarbeiten, sofern die
Layer gleich heissen; dann fällt `build_dxf.py` als Zwischenschritt weg.

## Was noch fehlt

- Keine Materialien, keine Bauteiltypen (`IfcSlabType` &c.), keine Öffnungen.
- Die Stränge sind nicht über Ports (`IfcRelConnectsPorts`) verbunden — für
  eine Netzberechnung müssten sie das sein.
- Der Schnitt zeigt eine schematische Einstrangdarstellung, wie bei 1:200
  üblich; keine zweilinige Kanaldarstellung.
