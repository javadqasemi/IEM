# IEM AG — Website-Redesign (Konzept)

A concept redesign of the [IEM AG](https://www.iem.ch) website — *Ingenieurbüro für Energie- und
Messtechnik*, Thun and Bern.

This is **not** the production site. It is a single-page design study plus the small component
library behind it, built to show a proposed direction: light, precise, and grounded in the firm's
real brand, real projects and real people rather than placeholder content.

![Stack](https://img.shields.io/badge/Vite-6-informational) ![React](https://img.shields.io/badge/React-18-informational) ![TypeScript](https://img.shields.io/badge/TypeScript-5-informational) ![Tailwind](https://img.shields.io/badge/Tailwind-3-informational)

## Quick start

```bash
npm install
npm run dev       # dev server on http://localhost:5173
npm run build     # tsc -b (typecheck) && vite build  →  dist/
npm run preview   # serve the built dist/
```

Requires Node 18+. There is no test runner, linter or formatter configured — `npm run build` is the
only automated check, and it only catches type errors.

The 3D model behind the hero and in the Ablauf section is generated out of the IFC models in `ifc/`
by a Python toolchain in `cad/`. You don't need it to run or build the site — the generated files
are committed. See [The hero backdrop](#the-hero-backdrop) and [The 3D scene](#the-3d-scene).

## The design in one paragraph

The firm's name is literally *Messtechnik* — measurement. So the page leads with a measurement
rather than a render: the hero is an annotated building section where the heating, ventilation and
sanitary runs draw themselves in and three measured values settle into place. That section is not a
drawing of a drawing — it is cut from an actual CAD model, which also exports as a DXF plan sheet
and an IFC4 building model. Structural numbering uses **real SIA 112 phase numbers** (31 Vorprojekt
→ 53 Inbetriebnahme), the vocabulary Swiss clients already plan in, instead of decorative
`01 / 02 / 03` markers.

## Brand

The palette is **derived from the client's own published assets**, not invented — navy and gold:

| | Hex | Source |
| --- | --- | --- |
| Navy | `#003882` | the logo fill (`iem.ch/images/logo.svg`, monochrome) |
| Blue | `#2C5691` | the site's `--sitecolor` |
| Gold | `#90814E` | the site's `--linkcolor-hov` |

The logo is also a *shape*: the mark is built from vertical bars whose widths taper left to right.
`src/components/Wordmark.tsx` reproduces that geometry, and the section dividers repeat the same
tapering-bar rhythm so they quote the mark rather than merely separating content.

Gold appears as three tokens (`brand-gold`, `brand-bronze`, `brand-sand`) because its contrast
changes with what it sits on — the plain gold fails WCAG AA for small text on white, so text uses
the darkened bronze and text on navy uses the lightened sand.

## Content

All copy and data lives in **`src/content/iem.ts`** — one file to edit for any content change. It
holds the five service lines, the six-discipline taxonomy, the SIA phases, 30 reference projects,
the 41-person team, sponsorships, offices and company facts.

Everything in it is checkable against iem.ch. That is deliberate: an earlier draft carried invented
statistics (1'200+ projects, 42 specialists, a 92% BIM share) and they were removed. **If you add a
number, add its source.** Company facts are derived rather than retyped — the "Jahre" figure
computes from `facts.founded` and the project count from `projects.length`, so they cannot drift.

Copy is German, Swiss conventions: apostrophe thousands (`1'450`), a true minus sign (`−38%`), `ss`
rather than `ß`.

### Team photos

The roster is the real 41 people. Two rules, worth respecting:

- Names and name→photo pairings come from the `alt` attributes on `iem.ch/team`, not from filenames
  — the filenames mix `first_last` and `last_first` order, so guessing mislabels real people.
- Only the three Geschäftsleitung cards state a function, and those are the three iem.ch itself
  publishes. The other 38 entries show name and location only, and the roster no longer marks who is
  an apprentice. `lernend` and the rest of `role` stay in the data but nothing renders or searches
  them. **Don't invent job titles** for the entries that don't have a published one.

## Images

`public/img/` holds the client's own photography, downloaded from iem.ch (~78 files, 14 MB) in four
folders: `ref/` project photos, `team/` portraits, `about/` sponsorships, `career/` recruiting.

A fifth folder, `jobs/`, is **not** the client's: seven licence-free stock photos (Pexels licence,
no attribution required) showing the trade each vacancy is for — Heizung, Lüftung, Kälte, Sanitär.

The CMS publishes only a single `-2560` variant of each file. They arrive reasonably compressed
(~80 KB typical) and are used as-is with `loading="lazy"`, which is fine for a design study but is
the first thing to fix for production — there is no build-time image pipeline here, so a real
deployment should add responsive `srcset` sizes and AVIF/WebP.

## The hero backdrop

The hero is type over a moving backdrop: the same coordination model, building itself through the
six SIA phases from 31 Vorprojekt to 53 Inbetriebnahme, on a loop. It is scenery — no controls, no
pointer events, `aria-hidden` — and it is allowed not to be there. It loads only after the page is
idle (the headline must paint first), Save-Data skips it, reduced motion freezes it at the last
phase, and it pauses once the hero scrolls off screen. `src/lib/modellSzene.ts` builds the geometry
and is shared with the 3D scene in the Ablauf section; only the staging differs.

## Drawing the section

`src/components/SchnittGuglera.tsx` is a 2D section cut from the same three IFC files — nine
storeys, real cut edges, the runs coloured by system. The page no longer renders it (the hero shows
the model instead), but the generator is intact and the component works. The file is **generated**;
edits to it are lost on the next run.

```
ifc/4723_Architektur.ifc ─┐
ifc/4723_Heizung.ifc      ├─→ ifc_schnitt.py ─→ build_svg_ifc.py ─→ SchnittGuglera.tsx
ifc/4723_Lüftung.ifc      ─┘
```

To change it:

```bash
pip install ifcopenshell
python cad/build_svg_ifc.py
```

Two extraction methods, because the IFC describes structure and services differently. Walls and
slabs are triangle meshes, so the section plane is intersected with every triangle — those are real
cut edges, chained into polylines and simplified. Pipes and ducts carry their axis as
`IfcDistributionPort` objects at both ends, which is already the single-line representation a 1:200
section wants; they are projected onto the plane from a band around it, and a run crossing the plane
head-on is drawn as a dot, the way a cut pipe is. Everything else — colours by system (Vorlauf,
Rücklauf, Zu-/Abluft), storey levels, the three annotated values — comes out of the IFC too. Only
the plane's position (x = 5.00 m), the band width (±8 m) and which three components get a label are
chosen; they are constants at the top of `cad/ifc_schnitt.py` and `cad/build_svg_ifc.py`.

### The 3D scene

The Ablauf section shows the same project as a WebGL model, from the same IFC:

```bash
python cad/build_scene_ifc.py     # -> src/generated/scene_guglera.json
```

Every `IfcProduct` in the three files is accounted for — 7'786 components drawn, 11'194 not, each
with a reason in the exported inventory (ports aren't components, 1'041 elements have no geometry
in the source, and openings are represented by the window or door in them). An IFC class with no
rule **aborts the generator** rather than being skipped quietly. Pipes and ducts become cylinders
from their axis and radius; everything else becomes an oriented box; slabs keep their real mesh so
the shafts stay open and the risers stay visible.

The data ships as a JSON asset rather than a module. That is not a preference: 62'000 numbers as an
array literal took Rollup **18 minutes** to build.

### Checking the models

```bash
python cad/audit_ifc.py
```

A report on the client's IFC — schema, units, georeferencing, duplicate GUIDs, federation,
hydraulic values recomputed from the model's own numbers, port connectivity, air flows, insulation,
cross-trade clashes and structural penetrations. It writes nothing and never fails the build; it is
third-party data, not ours to fix. Its last section lists what the files cannot answer.

### The sample-building toolchain

A second, older chain models a sample building from scratch and produces the DXF/DWG plan sheet and
the IFC4 deliverable. Its two React outputs are still generated but no longer rendered:

```
cad/model.py ──┬─→ build_dxf.py ─→ DXF plan sheet (A3, 1:200) ─→ to_dwg.ps1 ─→ DWG
               │        └────────→ build_svg.py ─→ src/components/SchnittAA.tsx  (unused)
               ├─→ build_ifc.py ─→ IFC4 building model
               └─→ build_scene.py ─→ src/generated/scene.ts  (unused)
```

`build_scene.py` is worth keeping and worth running after any change to `model.py`: it checks every
pipe against every other medium's pipes and exits non-zero if two come closer than the sum of their
radii. It is the only real automated check in the repo.

```bash
pip install ezdxf ifcopenshell matplotlib   # matplotlib only for verification
python cad/build_dxf.py && python cad/build_svg.py
```

The order matters — that SVG exporter reads the DXF, not `model.py` directly. DWG needs one extra
step: it is a closed format with no free writing library, so `cad/to_dwg.ps1` converts the DXF via
the (free) ODA File Converter. Any CAD application will also just open the DXF.

`cad/README.md` has the full account of both chains.

## Project layout

```
src/
  App.tsx              page composition
  content/iem.ts       all copy and data
  components/          primitives (Button, Badge, Card, KPI) + compositions
                       HeroModel.tsx  the hero backdrop
                       ModelScene.tsx the Ablauf scene
                       SchnittGuglera.tsx is generated and currently unused
  lib/modellSzene.ts   builds the model into a three.js scene (shared by both)
  lib/tokens.ts        design tokens for runtime use (mirrors tailwind.config.ts)
  styles/globals.css   base layer, .eyebrow / .tick-rule / .grid-bg utilities
public/img/            client photography (except img/jobs/ — stock)
ifc/                   the client's own IFC models — source of the hero section
cad/                   Python toolchain, not part of the build
  ifc_schnitt.py       cuts a section out of ifc/
  build_svg_ifc.py     writes SchnittGuglera.tsx
  build_scene_ifc.py   writes the #ablauf 3D scene from ifc/
  audit_ifc.py         model-quality report on ifc/ (clashes, penetrations, data)
  model.py             sample-building dimensions — single source of truth
  out/                 generated DXF and IFC
```

Design tokens are defined **twice on purpose** — in `tailwind.config.ts` for component classes and
in `src/lib/tokens.ts` for runtime needs such as SVG fills. Change a colour in one, change it in the
other.

Path alias `@/*` → `src/*`, configured in both `tsconfig.json` and `vite.config.ts`.

## Known limitations

- Nav links are in-page anchors; there is no routing and no CMS.
- The hero backdrop and the Ablauf scene are a **real client project**. Confirm with IEM that the
  project may be named and its model shown before this goes anywhere public.
- The backdrop costs ~280 KB gzipped (three.js plus the model) for something decorative. It is
  deferred, skipped on Save-Data and paused off screen, but on a phone it is a watermark behind a
  near-solid scrim — worth deciding whether it should load there at all.
- The three annotated values are design data out of the model, not measurements — the caption says
  so. There is nothing in these IFC files that carries a commissioning reading.
- The section shows only Rohbau, Heizung and Lüftung, because that is what the client's federation
  contains. There is no Sanitär model; the "Sanitär" run is the plant's cold-water circuit, which
  lives in the Heizung file.
- The sample IFC in `cad/out/` has no materials, no element types and no port connections, so it
  will not carry a network calculation as it stands.
- Job listings in the Karriere section are illustrative rather than a live feed.
- Legal pages (Datenschutz, Impressum) and the social links are placeholders.

Further architectural and design-decision notes — including several failure modes specific to this
setup — are in [CLAUDE.md](./CLAUDE.md).
