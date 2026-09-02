# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

This repo is a **redesign sketch / component library** for the IEM AG website (https://www.iem.ch — Ingenieurbüro für Energie- und Messtechnik, Thun/Bern). It is not the production site; it is a concept implementation of a proposed redesign.

`README.md` covers the same ground for a human reader (quick start, brand summary, layout, known limitations). This file adds the decisions and failure modes that aren't visible from the code — read it before changing colour, content or the hero.

The design is **light mode only** — a navy-tinted "technical paper" ground (`base #F6F8FB`), chosen deliberately over the earlier dark build. Don't reintroduce a dark theme or a `dark:` variant without asking.

Two things are *load-bearing*. Don't drift them without checking with the user:

1. **The real IEM brand palette**, read off the client's own assets rather than invented — see below.
2. **The six-discipline taxonomy** — Heizung & HLK, Lüftung & Klima, Sanitär, Elektro & Automation, Energie & Sanierung, BIM & 3D. Defined once in `src/content/iem.ts` as `disciplines`.

### Where the brand comes from

The palette is derived from the client's published assets, not chosen. Sources, so this can be re-verified:

- `https://www.iem.ch/images/logo.svg` — the logo is **monochrome `#003882`**, a deep navy.
- `https://www.iem.ch/_cmsbox_15/design/screen-small.css` — the site's own CSS custom properties: `--sitecolor: #2c5691`, `--linkcolor-hov: #90814e`, `--textcolor: #000`. On inverted panels the site sets a `#2c5691` background with `--titlecolor: #90814e`.

So IEM is a **navy + gold** identity. An earlier draft of this repo used an invented cyan/orange/green trio; it was replaced on purpose. Don't reintroduce bright accent hues.

The logo is also a *form*, not just a colour: the mark is built from vertical bars whose widths taper left to right. `src/components/Wordmark.tsx` reproduces that geometry, and the `.tick-rule` section divider repeats the same tapering-bar rhythm so the divider quotes the mark.

### Imagery

Photography is the client's own, downloaded from iem.ch into `public/img/` — with **one deliberate exception**, `img/jobs/`:

| Folder | Contents |
| --- | --- |
| `img/ref/` | Reference project photos, one per entry in `projects`. |
| `img/team/` | Staff portraits, plus `chrischonaturm.jpg` (the client's team-page header). |
| `img/about/` | Sponsorship photos. |
| `img/career/` | The "Wir machen Profis. Lehrbetrieb" mark and a PV photo. |
| `img/jobs/` | **Not IEM's.** Licence-free stock (Pexels licence: free commercial use, no attribution required), two per trade — `heizung`, `lueftung`, `kaelte`, `sanitaer` — one for each vacancy in `openings`. |

**The advert bodies are stored, not linked.** Each entry in `openings` carries a `detail` object — `titel`, `einstieg`, `aufgaben`, `profil`, `bieten`, `kontakt` — read out of the seven PDFs IEM publishes and held **verbatim**, under the same rule as the reference projects' `details`: these are a real employer's terms of employment, so a reworded duty or a softened requirement is a false claim about what IEM offers. The three passages every advert shares (`jobUeberUns`, `jobBewerbung`, `jobSchluss`) sit beside the list once. Re-extract rather than retype when an advert changes — `pypdf`'s `extract_text()` on the file behind `pdf`, joining the PDF's typesetting line breaks and touching nothing else. The `pdf` URL stays and is linked at the foot of the detail page, so the reading copy never replaces the document.

Note the adverts and the site's own job list **disagree about three locations**, and both are IEM's published wording: `place` says Lüftungsplaner:in "Thun" where the PDF says "Thun und Bern", and says "Thun oder Bern" for Sanitärplaner:in and Projektleiter:in Sanitär where both PDFs say "Thun und Bern". Neither was invented to fix the other; ask the client which is current rather than picking one.

`img/jobs/` exists because the vacancies want *trade* imagery and IEM's own photos can't supply it: every reference project covers Heizung, Lüftung and Sanitär at once, so "the photo for Heizung" was a choice dressed up as a fact, and a named building beside a job advert reads as though the job were for that project. The cards render them with `alt=""` for the same reason — the role title carries the meaning. Pulled at `?auto=compress&cs=tinysrgb&w=900`, matching the ~900px the client's own derivatives are pulled at. If you replace one, keep it plant/equipment, not a building.

The CMS serves derivatives from a sizing path — `https://www.iem.ch/_cmsbox_images_<quality>_<width>_<height>/pictures/<hash>/<file>-2560.jpg`, with `0` meaning "auto" on either axis. `_82_900_0` is what the team portraits here were pulled at (~40–70 KB, 900px wide, comfortably 2× their rendered size); the `-2560` original behind `data-src` on the live page runs 200–300 KB and is more than the page needs. Files are used as-is with `loading="lazy"` and `object-cover`.

**To detect what actually changed on the client's side, compare dimensions, not bytes.** Each `<img>` on iem.ch carries `data-width`/`data-height` for its current original; a different aspect ratio from the local copy means the photo was genuinely re-shot. Byte size proves nothing, because the local files and any freshly fetched derivative are different renderings of the same source.

One caveat learned the hard way: some assets are **wide club logos, not photos**. Cropping those into a portrait box cuts the wordmark in half, so `sponsorships` carries `fit: "contain"` for them.

Unused leftovers: `ref/magglingen-2.jpg` and `ref/stuckimatte-2.jpg` are byte-identical duplicates the CMS serves from a second hash directory, the two `team/aaa-silhouette*.jpg` placeholders are deliberately not used (see below), and `about/verkehrsstuetzpunkt-chur.jpg` is left over from the full-bleed band that used to sit between Team and Sponsoring — removed at the client's request because the framing was wrong. The Chur project itself is still in `projects`, with its own photo at `ref/vks-chur.jpg`.

### Team

`team` in `src/content/iem.ts` is the full roster — **41 people**, which matches the "41 Mitarbeitende inkl. Lernende" figure on iem.ch/ueber-uns.

- Names and name→photo pairings were taken from the `alt`/`title` attributes on iem.ch/team, **not** inferred from filenames. The filenames mix `first_last` and `last_first`, so guessing mislabels people. If you add someone, get their pairing the same way.
- **Only the Geschäftsleitung's three titles are published.** At the client's request (September 2026) the roster cards print **name and office only** — no `role`, no "· Lernende" marker. The three GL cards are the exception, restored at the user's request: they print the `role` beneath the name, and those are exactly the three functions iem.ch itself publishes (Geschäftsführer, the two Standortleiter). The Fachgruppen dropdown lists the four trades and does not offer "Lernende". Neither search box matches on a function or on the apprenticeship: matching a roster function would filter on something the reader cannot see, and matching "Lernende" would go on singling out the apprentices, which is the thing removing the label was for. Don't extend the titles past those three, and don't put the "· Lernende" marker back, without asking.
- **`lernend` is recorded but never published, and most of `role` with it.** Both were kept rather than deleted, so nothing sourced from IEM is lost. Only `TeamGrid`'s Geschäftsleitung block reads `role`, and only for the three `lead: true` members; every other value in the field is unpublished.
- **`role` and `lead` are two different things**, and `lead` is now the *only* thing that can split the grid. `lead: true` marks the three Geschäftsleitung members and is what `TeamGrid` splits on; `role` is anyone's function. They used to be the same field — the split keyed off "has a role", so giving a fourth person a title silently moved them into the leadership block and dropped them out of the roster. Don't collapse them again.
- iem.ch/team prints a function for **three** people only (Geschäftsführer, the two Standortleiter) — which is why those three are the ones the page prints too. Every other `role` came from IEM internally and **cannot be verified against the public site**, so it stays off the page. The rule holds for any label that is ever added: it can only be added when someone at IEM supplies it, and **never guess a job title for a real, named person.** That is a different class of error from a wrong project figure — it attaches a false professional claim to an identifiable individual. Roles are also stored as given, including the gendered form; don't "correct" someone's title, and don't infer a form from a name.
- `photo: null` marks the people the site shows with its silhouette placeholder — **one** as of the September 2026 re-check (Valentina Simic). Finn Borter and Yosef Shonora have since been photographed and now carry portraits. `TeamGrid` renders navy initials instead: an honest monogram beats a generic stock silhouette and keeps the grid rhythm. Recheck this against iem.ch/team rather than trusting the count here; portraits get added as people are photographed.
- **The portraits are being re-shot from 3:2 to 4:3.** The September 2026 re-check found 18 people whose live original had moved from `720x480`-style 3:2 to `2560x1920` 4:3 — a genuine re-shoot, caught by the aspect-ratio rule above. Those were re-pulled at `_82_900_0`. Five people are still on the old 3:2 frame (Andreas Huber, Stefan Pulfer, Dylan Schommer, Marc Wittwer, Ken Zurflüh); expect them to change next, and diff aspect ratios rather than bytes to find them.

### Real facts vs. positioning

The page is grounded in facts published on iem.ch: two offices (Thun, Uttigenstrasse 49, +41 33 227 40 20; Bern, Sandrainstrasse 3, +41 31 688 40 20), the five service lines, and the reference project list. **Keep it that way** — the page's credibility rests on the numbers being checkable, so if you add a statistic, add its source. An earlier draft carried invented figures (1'200+ projects, 42 specialists, 92% BIM share); those were removed on purpose.

Each entry in `projects` also carries an optional `details` object — Bauherrschaft, Architektur, bearbeitete Fachgebiete, Gesamt-Bausumme, Bausumme Fachgebiete, Energiestandard — taken **verbatim** from iem.ch/referenzen and shown in `ProjectDialog`. Several projects genuinely publish no architect, no cost or no energy standard; those keys stay absent and the dialog omits the row. **Don't fill a gap with a plausible figure** — construction costs are exactly the kind of number a reader will check.

**`ifc/` holds real client files**, not sample data: the Architektur/Heizung/Lüftung models and a set of ARCH drawings for the Guglera conversion in Giffers. The hero's section is cut straight out of them (see "Hero"), which makes it the one place on the page showing a project the public site does not document. Two consequences: the numbers on it are checkable in a way invented ones never were, and **naming the project publicly needs IEM's say-so** — flag it rather than assuming. Note the `ifc/` files are also the only large binaries in the repo (~26 MB); the generated component is committed, so nobody needs them to build the site.

Company facts live in `facts` in `src/content/iem.ts` and are derived, not hardcoded into copy — the hero's "Jahre" KPI computes from `facts.founded`, and the references KPI from `projects.length`, so they can't drift.

**Founding year:** the company was founded **7 July 1994** (AG), with the Bern branch from **2006**. The repo's original draft said "seit 1991" throughout; that was wrong and is corrected. Don't reintroduce 1991.

Note the two-level offering model, which is intentional:

- **Five service lines** (`services`) — what IEM actually sells, in the order iem.ch lists them. This drives the Dienstleistungen section.
- **Six disciplines** (`disciplines`) — the trades coordinated across, used as tags on services and reference projects.

User-facing copy is **German** (Swiss DE conventions: apostrophe-thousands `1'450`, `−38%` true minus sign, `ss` not `ß`).

## Stack & commands

Vite + React 18 + TypeScript + Tailwind v3.

```bash
npm install
npm run dev       # vite dev server
npm run build     # tsc -b && vite build
npm run preview   # serve dist/
```

There is no test runner, linter, or formatter configured. Don't introduce one unprompted.

**three.js is the only runtime dependency beyond React and it is deliberately not in the main bundle.** `ModelScene` imports it with `await import("three")` inside an effect, so Vite emits it as its own chunk (~190 KB gzip against the page's ~85 KB) that only downloads when the Ablauf section approaches the viewport. A static `import * as THREE` at the top of a file undoes that silently — the build still passes, the page just triples in weight. Type-only imports (`import type * as Three from "three"`) are free and are how the scene stays typed.

`cad/` is a **second, separate toolchain** — Python. It is not part of `npm run build` and nothing in `src/` imports from it at runtime. It holds **two independent chains** that both produce a building section; only the first is on the page.

```bash
pip install ifcopenshell ezdxf matplotlib   # ezdxf/matplotlib only for the sample project

# From the client's own IFC in ifc/ — this is what the page renders
python cad/build_svg_ifc.py     # hero section  -> src/components/SchnittGuglera.tsx
python cad/build_scene_ifc.py   # #ablauf scene -> src/generated/scene_guglera.json
python cad/audit_ifc.py         # model-quality report on ifc/ (no output files)

# Sample project (model.py) — plan sheet and IFC deliverable, no longer on the page
python cad/build_dxf.py && python cad/build_svg.py   # -> src/components/SchnittAA.tsx (unused)
python cad/build_scene.py                            # -> src/generated/scene.ts (unused)
python cad/build_ifc.py                              # IFC4 deliverable
```

The two chains write **different files**. Never point them at the same one — the next run of either would overwrite the other's work.

`model.py` and its generators stay for two reasons, neither of which is the page: they produce the DXF/DWG plan sheet and the IFC4 deliverable, and `build_scene.py` is the repo's only real automated check (see "The Ablauf scene"). Their two React outputs — `SchnittAA.tsx` and `src/generated/scene.ts` — are **generated but no longer rendered**. Leave them or delete them, but don't wire them back into the page without deciding what happens to the real model.

See `cad/README.md`, and the Hero and Ablauf sections below for how the parts connect.

### Verifying a change

With no test suite, `npm run build` is the only automated gate — it runs `tsc -b` first, so it catches type errors and nothing else. Anything visual has to be looked at.

On the IFC side, `python cad/build_svg_ifc.py` is its own gate: it **exits non-zero if a value flag's rule matches no component**, and prints the value and position it chose for each of the three. Move the section plane or narrow the band and it will tell you which flag fell off the drawing rather than silently emitting a section with two labels.

`python cad/audit_ifc.py` is a **report, not a gate** — it checks the client's models in `ifc/` (schema, units, georeferencing, duplicate GUIDs, federation, hydraulic values recomputed from the model's own numbers, port connectivity, air flows, insulation, cross-trade clashes, structural penetrations). It never exits non-zero and never edits anything, because the data isn't ours to fix. Its last section lists what the files **cannot** answer; keep that section honest rather than filling gaps with plausible numbers. Don't confuse it with `verify_ifc.py`, which recomputes *our* generated IFC against `model.py` and is a gate.

On the sample-project side there are three more gates, all worth running after any change to `cad/model.py`:

- `python cad/build_scene.py` — **checks every pipe against every other medium's pipes and exits non-zero if two come closer than the sum of their radii.** It is the closest thing this repo has to a unit test, it has already caught a real mistake, and it prints the offending pair and the missing clearance. Do not "fix" a reported collision by loosening the check.
- `python -m ezdxf audit cad/out/*.dxf` — checks the drawing.
- `python cad/verify_ifc.py` — rebuilds the IFC geometry and asserts its dimensions back against `model.py`.

`npm run dev` serves on port 5173. **Check the dev server's own output after a change**, not just the browser: a Tailwind or PostCSS failure in `globals.css` returns HTTP 500 for the stylesheet, which fails the whole module graph and renders a *blank white page* with no console hint about the real cause. Fetching `http://localhost:5173/src/styles/globals.css` and checking for a 500 is the fastest way to distinguish "CSS broke" from "component broke".

If you screenshot the page in headless Chromium, two traps:

- **Tall viewports drop images.** Capturing the full page needs ~17,000px of height, and at that size Chromium silently skips rasterizing the highest-resolution images — they appear as empty boxes that look exactly like a broken `src`. Verify any suspect image in a small standalone page at a normal viewport before believing it's broken.
- **`vh` units and hash anchors don't behave.** A `46vh` band becomes ~6,000px tall in a 13,000px viewport, and `#anchor` navigation doesn't scroll a screenshot. Prefer fixed heights for banded imagery — a stepped `h-[280px] sm:h-[380px] lg:h-[460px]` rather than a `vh` value — if you add a full-bleed band.

To photograph a section below the fold at a *normal* viewport — which sidesteps both traps — put a throwaway page in `public/` holding a same-origin `<iframe src="/">` and script the inner window's scroll. Two things make or break it: poll for the target rather than scrolling on the iframe's `load` event (React mounts after it, and layout keeps shifting as images decode), and set `documentElement.style.scrollBehavior = "auto"` on the inner document first — `globals.css` sets `scroll-behavior: smooth`, so a repeated `scrollTo` restarts the animation on every tick and creeps a couple of hundred pixels instead of arriving. Delete the page afterwards; anything in `public/` ships in the build.

Path alias: `@/*` → `src/*` (configured in both `tsconfig.json` and `vite.config.ts` — keep them in sync).

`tsconfig.json` sets `noEmit: true`. This matters: `tsc -b` in the build script is a typecheck only, and without it TypeScript writes a `.js` next to every source file. Vite resolves `.js` **before** `.tsx`, so those artifacts shadow the real sources and the dev server serves stale output. If you ever see edits not taking effect, check for stray `src/**/*.js`.

## Architecture

Single-page showcase. `src/App.tsx` composes the landing page. There is no routing — sections are anchor-linked, in page order: `#leistungen`, `#ablauf`, `#referenzen`, `#ueber-uns`, `#team`, `#sponsoring`, `#karriere`, `#standorte`, `#kontakt`.

**There is a second entry point, and it is not a route.** `stelle.html` + `src/stelle.tsx` render one job advert as a page of its own, opened from the Karriere cards' `Detail →` chip as `/stelle.html?id=<opening id>` in a new window. It is a separate Vite input (`build.rollupOptions.input` in `vite.config.ts` — **`index.html` has to stay listed there**, or the site itself drops out of the build), and it mounts its own React root, so nothing on it can rely on the landing page's custom-event seams. `StelleDetail` hosts `BewerbungDialog` directly for exactly that reason; `openBewerbung`'s listener lives in the other root. The dev server picks the file up on its own — only the build config needs telling. If you add a third page, add it there too.

A window rather than a dialog on purpose: a job advert is the thing on this page most likely to be forwarded, printed or left open in a tab, and a modal has no address to send. An unknown `?id=` renders `StelleNichtGefunden` rather than a blank page — positions get filled and links outlive them.

`#ueber-uns` carries what iem.ch/ueber-uns publishes and the rest of the page had no home for: the **Leitbild** (four statements, `leitbild` in the content — the client's own words, stored verbatim; never reword a value statement) and the **company register** (`companyFacts` — Rechtsform, Aktien, Gründung, Team, Mitgliedschaften, Betriebshaftpflicht, MwSt-Nr.). The register is derived from `facts`, so the roster count and founding date cannot drift from the hero's. Both are indexed by the site search under the "Über uns" kind, the facts by their *value* rather than their label — nobody searches "Mitgliedschaften", they search "Suissetec".

`navItems` in `src/content/iem.ts` deliberately lists only six of those — a seventh overflows the header on tablet widths. `#sponsoring`, `#kontakt` and `#ablauf` are reachable by scrolling and by the footer instead; `#ablauf` gave up its slot to `#ueber-uns`, and the footer's "Unternehmen" column carries it so it is not scroll-only. The header list is also the footer's "Dienstleistungen" column, so dropping something from `navItems` drops it from both — add it to `company` in `Footer.tsx` when you do. If you add a section, decide whether it earns a nav slot and what gives one up.

Component layering:

- **Primitives** (`Button`, `Badge`, `Card`, `KPI`) — variant/tone props, no domain knowledge, safe to reuse anywhere.
- **Compositions** (`SectionHeader`, `ServiceIndex`, `Bauablauf`, `PhaseTrack`, `ProjectRegister`, `TeamGrid`, `CompanyProfile`, `JobRegister`, `ProfisMark`, `Hero`, `Nav`, `Footer`) — built from primitives, carry IEM-specific layout decisions.
- **`Wordmark`** — the IEM logo as inline SVG, filled with `currentColor`. Use it rather than setting "IEM" as type.
- **Generated** — `SchnittGuglera` (the hero's section, from `cad/build_svg_ifc.py`) and `src/generated/scene_guglera.json` + `.ts` (the 3D model, from `cad/build_scene_ifc.py`), plus two the page no longer renders: `SchnittAA` (from `cad/build_svg.py`) and `src/generated/scene.ts` (from `cad/build_scene.py`). **Never edit any of them by hand**; the next generator run overwrites them. `ModelScene` reads the JSON and must not carry a dimension of its own.
- **Content** (`src/content/iem.ts`) — disciplines, services, SIA phases, `bauakte`, projects, team, sponsorships, offices, `leitbild`, `companyFacts`, company `facts`, nav. All page copy and data lives here, not inline in components. It is the single file to edit for a content change.
- **Showcase** (`App.tsx`) — wires compositions to content.

Four components hold state: `ProjectRegister` (filter + open dialog), `TeamGrid` (filter), `JobRegister` (category) and `Bauablauf` (act + plant on/off). The filters all expose themselves as `aria-pressed` buttons with an `aria-live` count — keep that pattern if you add another.

`ServiceIndex` holds **none**, and that is the current answer to a section that has been rebuilt several times. It has been five stacked prose rows, an index with a record beside it, and a 5 × 6 coverage matrix in a real `<table>`; each of those asked the reader to scroll, pick or decode before it would answer anything. It is now a **full-width register**: one band per service line, a hairline between them, the trade colour upright at the leading edge, and every title, claim, body and the complete discipline coverage on screen at once. Two things carried over from the matrix, because they were the matrix's real contribution:

- **All six disciplines appear on every line**, with the uncovered ones struck through rather than omitted. "Was ist nicht dabei" is half of what a reader comparing two lines wants to know, and a list of only the covered ones cannot answer it. Both states carry `sr-only` text — nobody can hear a dot, and nobody can hear 45 % opacity.
- **The count is spelled out** ("4 von 6"), so two lines can be compared without reading either list.

**No `01 / 02 / 03` in front of the rows.** It was in the sketch this design was chosen from and it is deliberately not in the build — see "Structural devices".

### Custom events are the seam between sections

Three interactions have to reach a component their trigger does not own, and all three use a `window` CustomEvent rather than lifted state or a store. That is deliberate: the alternative is page-wide plumbing in `App` for three interactions, and each seam keeps both sides ignorant of the other.

| Event | Fired by | Handled by |
| --- | --- | --- |
| `iem:open-project` (`OPEN_PROJECT`, `SiteSearch.tsx`) | site search result | `ProjectRegister` — opens that project's dialog |
| `iem:filter-team` (`FILTER_TEAM`, `SiteSearch.tsx`) | site search result | `TeamGrid` — narrows to that person |
| `iem:open-bewerbung` (`OPEN_BEWERBUNG`, `BewerbungButton.tsx`) | any job card, the empty-category link, the section CTA | `BewerbungButton` — opens the application form |

The third has a trap worth knowing: **`BewerbungButton` is both the trigger and the host of `BewerbungDialog`.** It has to stay mounted for anything else to open the form, so it sits inside `JobRegister` (always rendered, including for a category with no adverts) rather than in the section header. Moving it somewhere conditional silently breaks every "Bewerben" click on the cards — nothing errors, the dialog just never opens.

`src/lib/search.ts` builds the search index from the content module at import time and is shared with the Referenzen section's own box, so a term that finds a project in the header finds it in the register too. Add a section worth finding and it needs an entry there plus a kind in `kindOrder`.

`ProjectDialog` shows the full record for one reference. It is a **native `<dialog>` opened with `showModal()`**, which brings the focus trap, the inert background, Esc-to-close and the top layer with it — don't replace it with a div, and don't add a dialog library. Two things it needs and would silently lose: `onClose` must clear the parent's state (Esc closes the element without React knowing), and the element needs a capped height with `overflow-y-auto`, because a dialog does not scroll on its own and the lower rows just vanish on a short viewport.

The whole card is the trigger, not the corner marker. That is deliberate: a 32px glyph is a weak affordance and a poor touch target, and these fields are the checkable specifics the section rests on.

The `tone` prop (`"heat" | "air" | "water" | "power" | "energy" | "model" | "neutral"`, exported as `Tone` from `src/content/iem.ts`) is shared across `Badge`, `ServiceIndex` and the `disciplines` table. Tones name the **discipline**, not the hue, so the palette can move without the API lying. When adding a tone, update all of them together — they stay in lockstep so a discipline reads the same colour everywhere. `KPI` has its own smaller tone set (`ink`/`navy`/`gold`/`water`/`energy`).

`Button` renders an `<a>` when given `href`, otherwise a `<button>`. Most CTAs navigate (anchors, `tel:`, `mailto:`), and those must be links.

Its `mark` variant is `primary` wearing the logo: navy ground, with the mark's tapering bar raster set in gold before the label (`.btn-mark` in `globals.css` — a `::before` that the button's own `inline-flex`/`gap-2` treats as a flex item, so it needs no padding or positioning). It is **reserved for the Bewerbung CTA**, the one action on the page that is the brand asking rather than the reader being served. Spend it anywhere else and it stops meaning anything. It also takes no `trailing` arrow: bars leading and an arrow trailing is one accessory too many.

## Design tokens

Tokens live in **two places that must stay in sync**:

1. `tailwind.config.ts` — the source of truth for components (used via classes like `bg-brand-navy`, `text-disc-air`, `text-display-xl`).
2. `src/lib/tokens.ts` — TypeScript export for runtime needs (inline styles, SVG fills, future charting).

If you change a colour or font in one, change it in the other.

### Two colour groups: `brand-*` and `disc-*`

`brand-*` is the identity. Each value has one job — they are not interchangeable, because gold changes hex depending on what it sits on:

| Token | Hex | Use |
| --- | --- | --- |
| `brand-navy` | `#003882` | The logo colour. Primary buttons, the contact panel, the wordmark. |
| `brand-blue` | `#2C5691` | The site colour. Links and interactive text on paper. |
| `brand-gold` | `#90814E` | Accent fills and rules — the `.btn-mark` bars, the switch in the Ablauf scene. **Not** small text — 3.9:1 on white. |
| `brand-bronze` | `#7A6C3F` | Gold darkened for small text on paper (5.2:1). Link hovers. |
| `brand-sand` | `#CBB87F` | Gold lightened for text on navy (5.5:1). Eyebrows on the contact panel. |

**One deliberate exception to "tokens live in two places".** The footer's social buttons carry LinkedIn blue, Instagram magenta and Facebook blue. Those three hexes live in `socials` in `src/content/iem.ts` and are *not* tokens — they are other companies' identities, not IEM's, and putting them in `brand-*` would make the palette lie. They reach the DOM as a `--sc` custom property set inline on each button, which `.social-btn` in `globals.css` reads. Keep them out of `tailwind.config.ts`.

`disc-*` is the six discipline hues, all drawn from the navy/gold family and **all text-safe on `surface`** (≥4.8:1), so unlike the earlier build there is no separate "ink" variant to keep in sync:

`disc-heat` bronze · `disc-air` blue · `disc-water` teal · `disc-power` gold · `disc-energy` moss · `disc-model` navy

Because these hues are muted rather than bright, the three runs in the hero section are less instantly separable than a saturated triad would be. That is the accepted cost of being on-brand; the legend is colour-coded so the drawing stays decodable.

The hero section draws **five** media out of the IFC with these three hues: flow and return share their discipline's colour, the return at 0.55 opacity. That is deliberate — a second hex per discipline would be a token naming a *direction*, which is exactly what the `tone` contract above says a token must not do. `cad/build_svg_ifc.py` holds that split in `DECKKRAFT`, not in the palette.

### Do not `@apply` a custom colour with an opacity modifier

`@apply bg-brand-gold/25` and the like resolve inconsistently: the dev server throws `The class does not exist` while `vite build` passes, and a failing `globals.css` takes the whole render down to a blank page. This has bitten this repo twice. Write plain CSS instead — see `::selection` and `:focus-visible` in `globals.css`.

Related: after changing colours in `tailwind.config.ts`, restart the dev server. HMR reloads the config but can keep a stale Tailwind context.

### Other extensions worth knowing

- `text-display-{xl,lg,md}` — fluid `clamp()` display sizes with tightened tracking.
- `tracking-ultra-wide` (`0.18em`) — the mono uppercase eyebrow style, a brand signature. Use the `.eyebrow` component class rather than respelling it.
- `.tick-rule` — the standard section divider: a hairline hung with vertical bars of tapering width, quoting the logo's construction (see "Where the brand comes from").
- `shadow-card` / `shadow-glow` — resting elevation, and the hover affordance for interactive cards.
- `bg-grid` + `.grid-bg` — engineering-blueprint pattern, masked radially in Hero.
- `animate-fade-up`, `animate-sample`, `animate-draw`, `animate-pulse-line` — reuse before adding new ones. All motion is disabled under `prefers-reduced-motion`, handled globally in `globals.css`.

### Typography

Display **Archivo** (industrial grotesque), body **IBM Plex Sans**, data/labels **IBM Plex Mono** — loaded from Google Fonts in `index.html`. The Plex pair keeps body and mono in one family; Archivo carries the headlines.

## Hero

`src/components/Hero.tsx` is type over a moving backdrop: the Guglera coordination model building itself through the six SIA phases, 31 Vorprojekt to 53 Inbetriebnahme, on a loop. `HeroModel` owns the canvas; `Hero` owns the layout, the scrim and the phase readout.

**The backdrop is scenery, not a component of the page.** No controls, no pointer events, no labels in the scene — the canvas is `aria-hidden` and `pointer-events-none`. The one thing the animation says out loud is the phase, and that is a DOM readout with `aria-live`, not a sprite.

- **The geometry is generated and shared with `#ablauf`.** Both call `baueModell` in `src/lib/modellSzene.ts`, which builds the 7'786 components as instanced meshes. Only the *staging* differs: three acts with figures and labels there, six phases and silence here. Never type a dimension into either component.
- **The animation is one table.** `PHASE_OPACITY` in `HeroModel.tsx` gives an opacity per SIA phase for each category, and `MEDIUM_OPACITY` does the same for the runs. Rooms come first and fade as the building gets real; structure arrives at Bauprojekt; the runs trace at Ausschreibung and become pipe at Ausführung; the façade closes at Fachbauleitung; the media move only at Inbetriebnahme. Change the story by changing the table, not by adding code.
- **The camera stays outside the building.** Six stations on a slow orbit, azimuth turning about 30°, closing in and dropping as the project gets specific, then pulling back out. Flying into the plant room — which is exactly what the Ablauf scene does in its second act — fills the frame with pipework that reads as abstract texture behind a headline. It was tried; it looked like wallpaper.
- **The building is pushed into the right half by panning, not by turning.** Camera *and* target shift by the same lateral vector, which moves the subject on screen; shifting only the camera would turn it and leave the building where it was. Without this the model spends its left half under the scrim, visible as haze and legible as nothing.

Three things keep it from costing the page anything:

- **It loads after the page does.** This is the first viewport and three.js plus the model are ~280 KB gzipped. The import waits for `requestIdleCallback` (700 ms timeout fallback), so the headline paints first and the canvas fades in over 1.2 s. **Don't make it eager** — LCP is the headline and it must stay that way.
- **Save-Data skips it entirely, and reduced motion freezes it** at the last phase: the finished building, standing still. A backdrop that cycles behind text is precisely what that preference is about.
- **It pauses off screen.** An IntersectionObserver stops the render loop once the hero scrolls away, which is within one screen of the top.

### The scrim

Two versions, because the text does not sit in the same place at both widths. Below `lg` the column runs full width — there is no free side for a building to stand in, so the wash is `rgba(246,248,251,0.9)` flat and the model reads as a watermark. From `lg` on it is a horizontal gradient: solid to 38%, clearing to 14% at the right edge, where `HeroModel` puts the building. Top and bottom edges fade so the model collides with neither the header nor the KPI rule.

The colour is spelled out rather than using Tailwind's gradient utilities: those need their `--tw-gradient-*` variables set on the same element, and mixing that with an arbitrary-value gradient works right up until someone reorders a class.

**If you change the text column's width, re-check the scrim.** The two are a pair, and nothing in the code enforces it.

### The section drawing is no longer on the page

`SchnittGuglera.tsx` — the 2D section cut from the same IFC by `cad/build_svg_ifc.py` — is still generated but nothing imports it. It is a complete, working component; if the hero ever wants a still image again, or another section wants a drawing, it is there. Same status as `SchnittAA.tsx` and `src/generated/scene.ts`. The generator is documented under "Stack & commands" and in `cad/README.md`.

## The Ablauf scene (3D)

`#ablauf` runs a WebGL model of the **same real project as the hero** — Guglera, Giffers — in three acts: the planner draws it, the installer builds it, the occupant switches it on, with the SIA phase track underneath lighting up whichever phases the current act covers. `Bauablauf` owns the act and the on/off state; `ModelScene` owns the three.js scene; `PhaseTrack` takes an optional `active` list.

- **The geometry is generated out of the client's IFC.** `cad/build_scene_ifc.py` writes `src/generated/scene_guglera.json` plus a small typed loader beside it. Never type a dimension into `ModelScene.tsx` — change the rules in the generator and run `python cad/build_scene_ifc.py`. What the component *does* own is the staging: the three figures, the desk, the ladder, the light switch. Those stand at anchors the exporter derives from the plant, so they move with it.
- **Nothing is silently dropped, and the generator enforces it.** Every `IfcProduct` of the three files is matched against `REGELN`; an unknown class **aborts the run** rather than being skipped. 7'786 components are drawn, 11'194 are not — and each of those carries a reason in the exported `inventar` (9'734 are `IfcDistributionPort`, which is a connection point rather than a component; 1'041 have no geometry in the source; 410 are openings represented by the window or door in them). The card's title block prints the drawn count. If you add a rule, keep the reason honest.
- **Two representations, and the reason for each.** Pipes, ducts and fittings become a cylinder from axis and radius — a pipe *is* a cylinder, and its axis is already in the file as two `IfcDistributionPort` positions, so this is the same description written shorter. Everything else becomes an oriented box fitted to the component's own footprint (smallest enclosing rectangle, not the axis-aligned box, so a wall standing at an angle is that wall). **Slabs are the exception and stay a real triangle mesh:** a box over a floor slab fills the shafts and swallows the risers the scene exists to show. 18 slabs are 472 triangles.
- **About a sixth of the pipe components carry only one port.** Their axis is recovered from the mesh by its first principal component — a cylinder's axis is the direction of greatest spread. Without that fallback 650 pipes and 118 ducts would have dropped out of the pipe layer into generic boxes, which is the quiet kind of loss this generator exists to prevent.
- **Everything is instanced.** One `InstancedMesh` per body category and one per medium — about twenty draw calls for 7'786 components. One mesh each would stall the frame on the draw calls alone. An act change only animates material opacities, so no geometry is rebuilt and the transitions stay interruptible.
- **The scene shows media, not trades.** Five strands out of `IfcSystem`: Vor- and Rücklauf, Zu- and Abluft, Kaltwasser. Flow and return share their discipline's colour with the return at lower opacity — see "Two colour groups" for why that is not a second token.
- **For the flow animation the exporter chains components into runs.** The scene draws 5'317 separate cylinders; a slug needs a *route*. `fliesslinien` holds the longest chained polylines per medium — a slug that stops after 40 cm at the next fitting shows no circuit.
- **three.js and the model both load on demand.** A type-only import at the top plus `await import()` inside the effect keeps three.js in its own chunk (~190 KB gzip) and the model in a JSON asset (~87 KB gzip) against the page's own ~86 KB. An IntersectionObserver starts both when the section approaches. Don't turn either into a static import.
- **The model data is a JSON asset, not a module, and that is load-bearing.** 62'000 numbers as an array literal are 62'000 AST nodes for Rollup to walk: the build went from 8 seconds to **18 minutes**. Wrapping them in `JSON.parse("…")` did not help, because Vite still pulls the file through the module graph. Importing `./scene_guglera.json?url` and fetching it makes the bundler see one asset. If you ever inline that data again, you will pay the 18 minutes back.
- **Camera framing is derived from the building, not typed in.** The Guglera is 51 × 32 × 27 m; the sample building this scene used to show was a third of that. `VIEWS` is written in multiples of the model's own span so a different model reframes itself.
- **Zoom and pan are off deliberately.** A wheel-zooming canvas swallows page scroll and panning loses the building off-screen; rotation is the only interaction that can't go wrong. Once the visitor drags, the camera stops re-framing on act changes.
- Auto-play advances the acts once, on first view, and never loops — the timers are in refs on purpose. Held in state they would land in the effect's dependency array, and setting them would tear down the effect and clear its own timers.
- `bauakte` in the content module describes what the scene shows. It used to promise a heat pump, a PV field and a drainage stack; this model has none of those, so the copy was corrected. **If you swap the model, read that copy again.**

### The sample project's scene generator

`cad/build_scene.py` still writes `src/generated/scene.ts` from `model.py`, and the page no longer renders it. Keep running it anyway when you touch `model.py`: it is the repo's only real unit test. `Y_TRASSE` gives each of the eight strands its own lane in the building's depth, and the generator checks every segment against every segment of every *other* medium and **fails the build** if two come closer than the sum of their radii. Do not "fix" a reported collision by loosening the check.

## Structural devices

Numbering on this page carries information rather than decorating:

- The Ablauf section uses **real SIA 112 phase numbers** (31 Vorprojekt → 53 Inbetriebnahme). Swiss clients plan in these, so they double as a statement about how IEM works. PV work is planned to SIA 108.
- There are no arbitrary `01 / 02 / 03` section markers. Don't add them back.
