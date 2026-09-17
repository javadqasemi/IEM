# IEM AG — Website-Redesign (Konzept)

A concept redesign of the [IEM AG](https://www.iem.ch) website — *Ingenieurbüro für Energie- und
Messtechnik*, Thun and Bern.

This is **not** the production site. It is a design study — light, precise, and grounded in the
firm's real brand, real projects and real people rather than placeholder content — together with
the content-management platform that runs it.

![Stack](https://img.shields.io/badge/Vite-6-informational) ![React](https://img.shields.io/badge/React-18-informational) ![TypeScript](https://img.shields.io/badge/TypeScript-5-informational) ![Tailwind](https://img.shields.io/badge/Tailwind-3-informational) ![NestJS](https://img.shields.io/badge/NestJS-11-informational) ![Prisma](https://img.shields.io/badge/Prisma-7-informational) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-informational)

## What's here

| | Where | |
| --- | --- | --- |
| **The site** | `/` | The public page. |
| **A job advert** | `/stelle.html?id=…` | One vacancy as its own page, for forwarding and printing. |
| **The dashboard** | `/admin.html` | The CMS: content, media, users, roles, approvals, audit log. |
| **The API** | `server/` | NestJS + Prisma + PostgreSQL. Its own `package.json`. |

## Quick start

The site alone needs nothing but Node 18+ and runs exactly as it always did:

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc -b (typecheck) && vite build  →  dist/
npm run preview   # serve the built dist/
```

Without an API configured the page renders the content snapshot compiled into its bundle and makes
no network request. That is not a fallback mode — it is the same HTML the static build always
produced.

To run the CMS as well you need a PostgreSQL database:

```bash
cp server/.env.example server/.env    # set DATABASE_URL and JWT_ACCESS_SECRET
cp .env.example .env.local            # point the frontend at the API

npm run setup                         # install + migrate + seed
npm run server:dev                    # API on http://localhost:3100
npm run dev                           # site + dashboard on http://localhost:5173
```

The API runs on **3100, not 3000** — 3000 is the default for Next.js and most
other frameworks, and two servers on one port is worse than it sounds: they can
bind different address families (one `::`, one `0.0.0.0`), the OS reports no
conflict, both log success, and the browser silently reaches whichever one its
resolver prefers.

`npm run setup` fills an empty database **from the site's own content file**, so a fresh install
comes up as the real website rather than as an empty CMS. The seed creates one Super Admin; with
`SEED_ADMIN_PASSWORD` left blank it has no password and is activated through "Passwort vergessen",
which is the right default for anything that is not a throwaway local database.

```bash
npm run verify    # typecheck + lint + test, both halves — run this before committing
```

Vitest and ESLint were added in September 2026. Prettier is configured but the existing tree is
deliberately **not** formatted and the check is not part of `verify`: running it rewrites 74 files,
which would bury every future diff and destroy `git blame` on a codebase whose comments carry most
of its documentation. Lint is narrow — rules that catch bugs, with the React Compiler rules as
warnings rather than errors, because they fire on patterns this code chose and commented. See
*Verifying a change* in `docs/ARCHITECTURE.md` for the `react-dom/server` smoke test, which is still
the strongest check available without a browser.

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

**Everything on the page is editable from the dashboard** — every heading, body, card, image,
button label, and every `aria-label` a screen reader reads. Nothing on the site is hardcoded any
more.

`src/content/` describes what that content *is*:

| File | |
| --- | --- |
| `schema.ts` | The contract: types and the closed sets that are structural, not editable. |
| `defaults.ts` | One complete value of it — the copy the static build shipped. |
| `store.ts` | Which version is current, and how a published one arrives. |
| `derive.ts` | The figures the page computes, and the `{token}` syntax for them. |
| `iem.ts` | What the rest of `src/` imports. |

It holds the five service lines, the six-discipline taxonomy, the SIA phases, 30 reference projects,
the 41-person team, sponsorships, offices and company facts.

Everything in it is checkable against iem.ch. That is deliberate: an earlier draft carried invented
statistics (1'200+ projects, 42 specialists, a 92% BIM share) and they were removed. **If you add a
number, add its source.**

### Numbers stay computed even though the copy is editable

The hero's "Jahre" figure, the "Seit über 30 Jahren" heading, "Sieben offene Stellen", the footer's
copyright year — these were expressions in the code. Moving copy into a database would normally
flatten them into typed-out numbers, and typed-out numbers go stale.

So copy carries placeholders instead. An editor writes

> Seit über `{jahrzehnte}` Jahren.

and can rewrite the sentence around it freely; the number still computes from `facts.founded`. The
dashboard offers the available placeholders as clickable chips beside any field that accepts them.
An unknown placeholder renders as itself rather than vanishing, so a typo is visible instead of
silently deleting a number from a live page.

Copy is German, Swiss conventions: apostrophe thousands (`1'450`), a true minus sign (`−38%`), `ss`
rather than `ß`.

### The site's appearance is unchanged by any of this

Two mechanisms, both deliberate:

- **The first paint comes from the bundle.** The published content is embedded at build time, so the
  page renders complete and correct with no loading state, no skeleton and no layout shift. It then
  fetches the live snapshot in the background and swaps it in if it is newer. If the API is slow,
  down, or not deployed, the page simply keeps rendering and says nothing about it.
- **The dashboard has its own stylesheet.** It uses the same design tokens but a separate Tailwind
  config, so its several hundred admin-only utilities never reach the CSS a visitor downloads. The
  public stylesheet's content hash is identical to what it was before the CMS existed.

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

## The dashboard

`/admin.html` — a separate Vite entry with its own React root, its own component library in
`src/admin/ui/`, and its own stylesheet.

**Content.** Every editable part of the site, grouped by what someone came to change. Forms are
generated from the content model rather than written per type, so adding a field to the site adds
it to the editor with no second implementation to keep in step. Collections can be searched,
reordered and duplicated; every save writes a version.

**Approval workflow.** Draft → In Prüfung → Freigegeben → Veröffentlicht, with Abgelehnt and
Archiviert alongside. An editor submits, someone else approves — self-approval is refused — and
publishing is a separate act on its own permission. Of the ten seeded roles, only Super Admin holds
it.

**Publishing is atomic.** It freezes every approved entry and writes one complete snapshot of the
site. Drafts stay behind. If the resulting document would be incomplete the whole publish is
refused rather than putting a blank section on a live page, and cross-checks that the database
cannot enforce — a project citing a discipline that does not exist, a person assigned to a deleted
office — are reported as warnings.

**Versions and rollback.** Every save is a version with an author, a timestamp and an optional
note; any two can be compared field by field. Restoring an old version writes a *new* one, so the
record of what the page said when stays complete. The same applies to whole-site snapshots.

**Media.** Uploads are stripped of EXIF, hashed against the library so the same file is never stored
twice, and resized into WebP derivatives with a ready-made `srcset`. "Replace" keeps the id, so a
re-shot portrait appears everywhere it is used without editing 41 entries — and the old file stays
as a version. Alt text is asked for at upload, with "decorative" as an explicit choice rather than
as the default of leaving it blank.

**Users, roles and permissions.** Rights are granted individually, not per page, and roles are
assembled from them. Ten roles ship; custom ones can be built from the same ~50 permissions.
Argon2id passwords, rotating refresh tokens with replay detection, account lockout, and an invite
flow that never mails a password.

**Audit log.** Every sign-in, change, approval, download and deletion, with the before and after of
each record and secrets scrubbed on the way in. Append-only — there is no API to edit or delete a
row. Exportable as CSV.

**Applications.** The site's Bewerbung form now has a receiving end: it stores the dossier, notifies
IEM, confirms to the applicant, and deletes both the record and the files when the retention period
set in the dashboard expires.

## Project layout

```
index.html             the site
stelle.html            one job advert
admin.html             the dashboard
src/
  App.tsx              page composition
  content/             the content layer — schema, defaults, store, derive
  components/          primitives (Button, Badge, Card, KPI) + compositions
                       HeroModel.tsx  the hero backdrop
                       ModelScene.tsx the Ablauf scene
                       SchnittGuglera.tsx is generated and currently unused
  admin/               the dashboard
    ui/                its component library — primitives, tables, forms, toasts
    pages/             one file per area
    lib/               API client, auth, router, data hooks
  lib/modellSzene.ts   builds the model into a three.js scene (shared by both)
  lib/tokens.ts        design tokens for runtime use (mirrors tailwind.config.ts)
  styles/globals.css   base layer, .eyebrow / .tick-rule / .grid-bg utilities
server/                the API — its own package.json and node_modules
  prisma/schema.prisma the data model
  prisma/seed.ts       fills an empty database from src/content/defaults.ts
  src/content/         content types, validation, snapshot builder
  src/rbac/            the permission catalogue — the source of truth for it
  src/{auth,users,media,applications,settings,audit}/
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

- Nav links are in-page anchors; the public site has no router, by design.
- **The dashboard has not been exercised against a live database in this repo.** Everything
  typechecks, builds and renders, and the seed is written against the site's own content — but the
  first `npm run setup` on a real PostgreSQL is still the first real run.
- **No analytics.** The dashboard's executive view shows visitors, conversions, revenue and
  customers as explicitly unavailable rather than as zeros, because nothing here measures them.
  Wiring any of them up means choosing a data source and, for visitor data, a privacy policy first.
- **Scheduled publishing assumes one API instance.** The background jobs are in-process `@Cron`
  timers, so a second instance would run them too and could produce duplicate snapshots. Put them
  behind a queue or a leader lock before scaling horizontally.
- **No MFA yet.** The schema and a settings toggle for it exist; the enrolment and verification
  flow does not.
- Media is stored on local disk. `StorageAdapter` is the one seam to implement for S3 or Azure Blob.
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
- Job listings are the seven IEM publishes, with the advert bodies stored verbatim from the PDFs.
  The site's list and those PDFs **disagree about three locations** and both are IEM's own wording —
  ask the client which is current rather than picking one.
- Legal pages (Datenschutz, Impressum) are still placeholder links, and the application form has no
  privacy-consent line. Both are required before this collects personal data in public.
- `CodeGate` is a **display barrier, not security** — the code is in the shipped bundle. Anything
  that must actually be private needs HTTP Basic Auth or an access-controlled host.

Further architectural and design-decision notes — including several failure modes specific to this
setup — are in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).
