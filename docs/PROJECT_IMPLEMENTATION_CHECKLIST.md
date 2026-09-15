# Project Implementation Checklist — IEM AG Website Redesign

| | |
| --- | --- |
| **Project** | `iem-ui` v0.0.1 — concept redesign of https://www.iem.ch (Ingenieurbüro für Energie- und Messtechnik, Thun/Bern) |
| **Audit date** | 14 September 2026 |
| **Audit basis** | Source code in this repository only. Every row below points at the file that implements it. Nothing was inferred from documentation alone; where the docs and the code disagree, the code wins and the disagreement is listed under Technical Debt. |
| **Verification performed** | Full read of `src/`, `index.html`, `stelle.html`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `package.json`, `.gitignore`; `npm run build` executed; Python toolchain presence checked (`python --version`, `pip show`). The dev server, the browser rendering and the Python generators were **not** executed in this audit and are marked accordingly. |

## Status legend

| Symbol | Meaning |
| --- | --- |
| ✅ Completed | Fully implemented in code and working as far as static analysis and the build can tell. |
| 🟡 Partial | Exists but has missing pieces, known problems, or depends on something not present. |
| ❌ Missing | Not implemented. Where it is missing *by design* the Notes column says so. |
| ⚠️ Needs review | Exists but requires a security, performance, legal or manual-testing review before it can be relied on. |

---

## 0. Executive summary

This repository is a **static, single-page design study** with two HTML entry points, built with Vite, React 18, TypeScript and Tailwind 3. **There is no backend of any kind**: no server, no API, no database, no authentication, no email or SMS service, no background jobs, no hosting or CI configuration. The only "server-side" code is a separate **Python CAD toolchain** (`cad/`) that generates React components and a JSON model from the client's IFC files at development time; it is not part of the web build.

The **most important finding** is that the repository does not currently build: `src/stelle.tsx` contains unresolved git merge-conflict markers, and `npm run build` fails at the TypeScript step with nine errors. Everything else in the frontend is in a mature, well-documented state.

---

## 1. Architecture Overview

### 1.1 Technology

| Layer | Technology | Notes |
| --- | --- | --- |
| Frontend framework | React 18.3 (`react`, `react-dom`), TypeScript 5.7 strict mode | `tsconfig.json`: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noEmit` |
| Build tool | Vite 6 with `@vitejs/plugin-react` | Two Rollup inputs: `index.html`, `stelle.html` (`vite.config.ts`) |
| Styling | Tailwind CSS 3.4 + PostCSS + Autoprefixer | Tokens in `tailwind.config.ts`, mirrored in `src/lib/tokens.ts` |
| 3D | three.js 0.185 | Dynamically imported only (`await import("three")`) so it stays in its own chunk |
| Utilities | `clsx` (via `src/lib/cn.ts`) | The only other runtime dependency |
| Fonts | Archivo, IBM Plex Sans, IBM Plex Mono via Google Fonts | External request from `index.html` / `stelle.html` |
| Backend | **None** | — |
| Database | **None** | All content is a static TypeScript module: `src/content/iem.ts` |
| Hosting / deployment | **None configured** | No Dockerfile, CI workflow, `vercel.json`, `netlify.toml`, or deploy script. A stale `dist/` exists locally (git-ignored). |
| Environment config | One optional variable, `VITE_BEWERBUNG_ENDPOINT` | Declared in `src/vite-env.d.ts`, **not set** (no `.env`, `.env.local` or `.env.example` present) |
| CAD toolchain | Python 3.14, `ifcopenshell` 0.8.5, `ezdxf` 1.4.4 (installed locally) | `cad/*.py`, not part of `npm run build` |
| Runtime environment (audit machine) | Node 22.23.2, npm 10.9.8 | `git` is not on the PowerShell PATH on this machine |

### 1.2 Main folders

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Landing-page composition (all sections in order) |
| `src/main.tsx`, `index.html` | Landing-page entry, wrapped in `CodeGate` |
| `src/stelle.tsx`, `stelle.html` | Second entry: one job advert per `?id=` (**currently broken — see §6**) |
| `src/components/` | 28 components: primitives, compositions, generated drawings |
| `src/content/iem.ts` | **Single content source** — disciplines, services, SIA phases, 30 projects, 41 team members, 7 openings, offices, socials, Leitbild, company facts, nav |
| `src/lib/` | `search.ts` (site-wide search index), `modellSzene.ts` (three.js model builder shared by hero and Ablauf), `tokens.ts`, `cn.ts` |
| `src/generated/` | `scene_guglera.json` + typed loader (**rendered**); `scene.ts` (generated, unused) |
| `src/styles/globals.css` | Base layer, `.eyebrow`, `.tick-rule`, `.btn-mark`, `.social-btn`, `.skip-link`, reduced-motion rules |
| `public/img/` | Client photography (`ref/`, `team/`, `about/`, `career/`) plus licence-free stock in `jobs/`; `beruf/` is unreferenced |
| `cad/` | Python generators and audits (two independent chains, see §3.2) |
| `ifc/` | Client's real IFC/DWG files (~26 MB, git-ignored, needed only to regenerate) |
| `docs/` | This checklist (created by this audit) |

### 1.3 Important files

| File | Why it matters |
| --- | --- |
| `docs/ARCHITECTURE.md` | Design decisions, brand derivation, failure modes; the authoritative rationale document |
| `README.md` | Human quick start and known limitations (some statements now stale — see §6) |
| `cad/README.md` | Full account of both CAD chains |
| `vite.config.ts` | Must keep `index.html` in `rollupOptions.input` or the site drops out of the build |
| `src/vite-env.d.ts` | Declares the only environment variable |
| `.gitignore` | Ignores `dist`, `*.local`, `tsconfig.tsbuildinfo`, `src/**/*.js`, `ifc/` |

---

## 2. Frontend

### 2.1 Framework, build and entry points

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Vite + React 18 + TS strict setup | ✅ Completed | `package.json`, `tsconfig.json`, `vite.config.ts` | ES2022 target, bundler resolution, `noEmit` typecheck-only | `@types/three` sits in `dependencies` rather than `devDependencies` (harmless, untidy) |
| Tailwind 3 + PostCSS pipeline | ✅ Completed | `tailwind.config.ts`, `postcss.config.js`, `src/styles/globals.css` | Custom colours, fluid display sizes, keyframes, component classes | Documented trap: never `@apply` a custom colour with an opacity modifier |
| Path alias `@/*` | ✅ Completed | `tsconfig.json`, `vite.config.ts` | Configured in both places, in sync | — |
| Multi-page build (landing + job advert) | ✅ Completed | `vite.config.ts` `build.rollupOptions.input` | `index` and `stelle` entries | — |
| **Production build (`npm run build`)** | 🟡 Partial | `src/stelle.tsx` | **Fails.** `tsc -b` reports 9 errors: `TS1185 Merge conflict marker encountered` at lines 3, 5, 6, 28, 30, 32 plus three follow-on syntax errors | **CRITICAL.** The conflict is between a `HEAD` version that wraps the advert in `CodeGate` and commit `bc9571c` that does not. Resolve before anything else. |
| Dev server (`npm run dev`) | ⚠️ Needs review | `package.json` | Vite dev server on port 5173 | Not started in this audit. Note: Vite dev will serve `index.html` despite the `stelle.tsx` error; only the `stelle.html` route and the build are affected. |
| Client-side routing | ❌ Missing | — | No router; sections are anchor-linked (`#leistungen` … `#kontakt`) | **By design** (documented in docs/ARCHITECTURE.md and README). |
| Landing page entry | ✅ Completed | `index.html`, `src/main.tsx` | `lang="de"`, meta description, `color-scheme: light`, `theme-color`, font preconnect | — |
| Job-advert page entry | 🟡 Partial | `stelle.html`, `src/stelle.tsx`, `src/components/StelleDetail.tsx` | Reads `?id=`, sets `document.title` to the position, renders `StelleDetail` or `StelleNichtGefunden` | Component is complete; the entry file is the one with the merge conflict. |
| Unknown advert (`?id=` not found) | ✅ Completed | `StelleDetail.tsx` → `StelleNichtGefunden` | Friendly message and link back to `/#karriere` | — |
| Legal pages (Datenschutz, Impressum) | ❌ Missing | `src/components/Footer.tsx` lines 136–137 | Both links are `href="#"` placeholders | Required before any public deployment (Swiss DSG / revDSG). |
| Hosting 404 page | ❌ Missing | — | No hosting config, so no custom 404 | Depends on hosting choice. |

### 2.2 Page sections (landing page, in order)

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Skip link | ✅ Completed | `App.tsx`, `.skip-link` in `globals.css` | "Zum Inhalt springen" → `#leistungen` | — |
| Header / navigation | ✅ Completed | `Nav.tsx` | Fixed, blur backdrop, border appears after 8 px scroll; six nav items from `navItems`; phone link ≥ `lg`; site search ≥ `sm`; mobile hamburger with `aria-expanded`/`aria-controls`, Esc closes | Search is inside the mobile menu below `sm`. |
| Hero with 3D backdrop | ✅ Completed | `Hero.tsx`, `HeroModel.tsx` | Headline, lead, three CTAs (Kontakt, Bewerben, Referenzen), SIA phase readout with `aria-live`, four KPIs derived from `facts` and `projects.length` | Backdrop is `aria-hidden`, `pointer-events-none`; loads after idle; skipped under Save-Data; frozen under reduced motion; paused off-screen. CTA label "Kontaktiere" is du-form while the rest of the page is Sie-form — copy review. |
| Dienstleistungen (`#leistungen`) | ✅ Completed | `ServiceIndex.tsx` | Five service lines as a stateless full-width register; all six disciplines listed per line with covered/struck-through state and `sr-only` text; "n von 6" count | — |
| Ablauf (`#ablauf`) | ✅ Completed | `Bauablauf.tsx`, `ModelScene.tsx`, `PhaseTrack.tsx` | Three-act WebGL scene of the client's IFC model (7'786 components, instanced), act buttons with `aria-pressed`, plant on/off switch in act 3, auto-play once on first view, SIA phase track lights active phases | OrbitControls rotate only; wheel zoom armed after first pointer-down; +/− buttons; touch: two fingers only. |
| Referenzen (`#referenzen`) | ✅ Completed | `ProjectRegister.tsx`, `ProjectDialog.tsx` | 30 projects, use-category filter + token search, `aria-live` count, empty-state reset, whole-card trigger opens native `<dialog>` with verbatim details | Comment in `ProjectRegister.tsx` line 114 still says "31 published references" — stale comment. |
| Über uns (`#ueber-uns`) | ✅ Completed | `CompanyProfile.tsx` | Leitbild (4 verbatim statements) + company facts `<dl>` derived from `facts` | Heading "Seit über N Jahren" computed from `facts.founded`. |
| Team (`#team`) | ✅ Completed | `TeamGrid.tsx` | Geschäftsleitung block (3, `lead: true`) + roster (38) sorted A–Z by first name (`de-CH`); office pills, Fachgruppe `<select>`, token search; initials fallback for `photo: null` (1 person) | Role/apprentice status deliberately not rendered or searchable. |
| Sponsoring (`#sponsoring`) | ✅ Completed | `App.tsx` | Five entries, `fit: "contain"` for the wide club logo | Not in header nav (by design); reachable by scroll only. |
| Karriere (`#karriere`) | ✅ Completed | `JobRegister.tsx`, `ProfisMark.tsx`, `BewerbungButton.tsx` | Category filter (Offene Stellen 7 / Schnupperlehre 0 / Lehrstellen 0) with counts and empty-state notes; image-led cards; "Bewerben" opens the form on that position; "Detail →" opens `/stelle.html?id=…` in a new window | Section description says "Sieben offene Stellen" as literal text — not derived from `openings.length`. |
| Standorte (`#standorte`) | ✅ Completed | `App.tsx` | Two offices with `<address>`, `tel:` button, Google Maps "Anfahrt" link (`target="_blank"`, `rel="noreferrer"`) | — |
| Kontakt (`#kontakt`) | ✅ Completed | `App.tsx` | Navy panel with `mailto:info@iem.ch` and `tel:` CTAs | **No contact form** — see §2.5. |
| Footer | 🟡 Partial | `Footer.tsx` | Wordmark, tagline, Dienstleistungen column (mirrors `navItems`), Unternehmen column, both offices, social rail (LinkedIn/Instagram/Facebook with brand colours via `--sc`), copyright | Datenschutz/Impressum are `href="#"`. Copyright year "2026" is hard-coded. |

### 2.3 Component library

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| `Button` primitive | ✅ Completed | `Button.tsx` | Six variants (`primary`, `secondary`, `ghost`, `inverse`, `inverseOutline`, `mark`), three sizes, renders `<a>` when `href` given, `forwardRef`, `trailing` slot | `mark` reserved for the Bewerbung CTA. |
| `Badge` primitive | ✅ Completed | `Badge.tsx` | Seven tones matching `Tone`, optional dot | Tones in lockstep with `ServiceIndex` and `disciplines`. |
| `KPI` primitive | ✅ Completed | `KPI.tsx` | Value/label/note, five tones | — |
| `Card` primitive | ⚠️ Needs review | `Card.tsx` | Implemented with `interactive` hover state | **Unused** — no import anywhere in `src/`. Delete or keep as library primitive. |
| `Wordmark` | ✅ Completed | `Wordmark.tsx` | IEM logo as inline SVG, `currentColor`, own `aria-label` | — |
| `SocialIcon` | ✅ Completed | `SocialIcon.tsx` | LinkedIn/Instagram/Facebook paths, `aria-hidden` | — |
| `SectionHeader` | ✅ Completed | `SectionHeader.tsx` | Eyebrow, title, description, right-aligned `action` slot | — |
| `ProfisMark` | ✅ Completed | `ProfisMark.tsx` | "Wir machen Profis" badge over PV photo | — |
| `PhaseTrack` | ✅ Completed | `PhaseTrack.tsx` | Six SIA 112 phases, optional `active` list | — |
| `HeroModel` | ✅ Completed | `HeroModel.tsx` | Six-phase opacity table, six camera stations, pan-not-turn framing, idle-deferred load, IO pause, Save-Data skip, reduced-motion freeze, full cleanup | — |
| `ModelScene` | ✅ Completed | `ModelScene.tsx` | Three acts, figures/props staged at exporter-derived anchors, legend by medium id, title block with component count, loading/failed states, zoom API | Header doc-comment (lines 38–45) still describes "five strands" and "labels are HTML sprites"; both are outdated — the scene has ten media and no in-scene labels. |
| `SchnittGuglera` (generated) | 🟡 Partial | `SchnittGuglera.tsx` | Complete 2D section from IFC | Generated but **not rendered** anywhere. Kept deliberately. |
| `SchnittAA` + `src/generated/scene.ts` (generated) | 🟡 Partial | `SchnittAA.tsx`, `generated/scene.ts` | Sample-project outputs | Generated but **not rendered**. Kept because `build_scene.py` is the repo's collision check. |
| `CodeGate` | 🟡 Partial | `CodeGate.tsx`, `main.tsx` | Six-digit access code before the page; per-digit inputs, paste/autofill, backspace/arrow handling, error state with `aria-live`, `sessionStorage` persistence | **Not security** (documented in-file): code is a constant in the bundle. Not mentioned in `docs/ARCHITECTURE.md` or `README.md`. |

### 2.4 State management and cross-component seams

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Local state only (no store) | ✅ Completed | `ProjectRegister`, `TeamGrid`, `JobRegister`, `Bauablauf`, `Nav`, `SiteSearch`, `BewerbungButton`, `CodeGate` | `useState`/`useMemo`/refs; no Redux/Zustand/Context | **By design.** |
| `iem:open-project` event | ✅ Completed | `SiteSearch.tsx` → `ProjectRegister.tsx` | Search hit opens that project's dialog and resets filters | — |
| `iem:filter-team` event | ✅ Completed | `SiteSearch.tsx` → `TeamGrid.tsx` | Search hit narrows the roster to that person | — |
| `iem:open-bewerbung` event | ✅ Completed | `BewerbungButton.tsx` ← `Hero`, `JobRegister` cards, empty-category link | Opens the application form, optionally on a position | `BewerbungButton` must stay mounted inside `JobRegister` (documented trap). |
| Timers kept in refs (auto-play) | ✅ Completed | `Bauablauf.tsx` | Prevents effect teardown from clearing its own timers | — |

### 2.5 Forms, validation and file upload

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Application form (Bewerbung) UI | ✅ Completed | `BewerbungDialog.tsx` | Native `<dialog>`; position `<select>` seeded with all openings; Vorname, Nachname, E-Mail, Telefon, Verfügbar ab, Nachricht (1200 chars); required markers; reset on close | Hosted by `BewerbungButton` (landing) and directly by `StelleDetail` (advert page). |
| Client-side validation | ✅ Completed | `BewerbungDialog.tsx` `validate()` | Required fields, loose email regex, first-error focus, error cleared on edit, `aria-invalid` + `aria-describedby` | No server-side validation exists (no server). |
| Send mode: E-Mail (`mailto:`) | ✅ Completed | `BewerbungDialog.tsx` `mailtoHref()` | Builds subject/body, names attachments in the body, shows honest "not yet sent" state with fallback address | Only mode that works today. |
| Send mode: Upload (multipart POST) | 🟡 Partial | `BewerbungDialog.tsx` `postDossier()` | XHR with progress bar, success and failure states, `FormData` with `dateien[]` | **Disabled at runtime** because `VITE_BEWERBUNG_ENDPOINT` is unset. UI shows "Noch nicht eingerichtet". Needs a receiving service. |
| File picker + drag-and-drop | ✅ Completed | `BewerbungDialog.tsx` `addFiles()` | Max 5 files, 10 MB each, 20 MB total, accept `.pdf,.doc,.docx,.jpg,.jpeg,.png`, duplicate skip, per-file remove, keyboard-reachable via `peer` label | Client-side limits only; MIME type not verified. |
| Spam protection (honeypot / captcha / rate limit) | ❌ Missing | — | None | Needed once an upload endpoint exists. |
| Privacy consent checkbox | ❌ Missing | — | Form collects personal data with no consent statement or link to a privacy policy | Legal requirement for a real deployment. |
| Contact form | ❌ Missing | `App.tsx` `#kontakt` | Contact is `mailto:` and `tel:` links only | Acceptable for a design study; decide for production. |
| Access-code form | ✅ Completed | `CodeGate.tsx` | Numeric `inputMode`, `autocomplete="one-time-code"`, per-digit `aria-label`, status `role="status"` | — |

### 2.6 Search and filter

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Site-wide search index | ✅ Completed | `src/lib/search.ts` | Built once at import; indexes team, services, projects, disciplines, offices, openings, company facts (by value), Leitbild; diacritic folding; token-AND; prefix > word-prefix > contains > haystack ranking; per-kind cap (4) and total cap (12) | Adding a section requires an entry plus a `kindOrder` kind. |
| Header search combobox | ✅ Completed | `SiteSearch.tsx` | `role="combobox"`, `aria-activedescendant`, arrow/Enter/Esc keys, grouped listbox, thumbnails/monograms, outside-click close, clear button | — |
| Referenzen filter + search | ✅ Completed | `ProjectRegister.tsx` | Use-category pills + free-text over `projectTerms()` | Shares matching with the site search. |
| Team filter + search | ✅ Completed | `TeamGrid.tsx` | Office pills, Fachgruppe select, free-text over name/office/group | Deliberately does not match on role or apprenticeship. |
| Job category filter | ✅ Completed | `JobRegister.tsx` | Three categories with counts, empty-state notes | — |

### 2.7 Dialogs and overlays

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Project detail modal | ✅ Completed | `ProjectDialog.tsx` | Native `<dialog>` + `showModal()`, backdrop click closes, `onClose` syncs state, capped height with scroll, HLKSE-ordered trade line, rows omitted when data absent | — |
| Application modal | ✅ Completed | `BewerbungDialog.tsx` | Same native-dialog pattern; close disabled while uploading | — |
| Mobile navigation panel | ✅ Completed | `Nav.tsx` | Toggle button, Esc closes, links close it | No focus trap (acceptable for a non-modal disclosure). |

### 2.8 Loading, error and feedback states

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| 3D scene loading/failed states | ✅ Completed | `ModelScene.tsx` | "Modell wird geladen …" / "3D-Ansicht nicht verfügbar"; `fetch` failure rejects and sets `failed` | — |
| Hero backdrop graceful absence | ✅ Completed | `HeroModel.tsx` | Fades in only after first frame; any failure leaves the type-only hero | Errors from `los()` are swallowed silently (no user impact, no logging). |
| Live-region counts on filters | ✅ Completed | `ProjectRegister`, `TeamGrid`, `JobRegister` | `aria-live="polite"` counts | — |
| Act caption announcement | ✅ Completed | `Bauablauf.tsx` | `aria-live="polite"` on caption | — |
| Form success / failure feedback | ✅ Completed | `BewerbungDialog.tsx` | Done, mail-opened, failed states with next steps | — |
| Toast / notification system | ❌ Missing | — | All feedback is inline | **By design**; nothing needs a toast today. |
| React error boundary | ❌ Missing | `main.tsx`, `stelle.tsx` | A render error in any section blanks the whole page | Recommended for production. |
| Image load error fallback | ❌ Missing | — | `<img>` tags have no `onError` handling | Low priority; assets are local. |
| Logging / monitoring | ❌ Missing | — | No error reporting, analytics or console instrumentation | Decide with the privacy policy. |

### 2.9 Theme and design tokens

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Light-mode-only design system | ✅ Completed | `tailwind.config.ts`, `globals.css`, `index.html` `color-scheme` | Navy/gold brand palette derived from client assets; six discipline hues; display type scale; shadows; grid background; keyframes | **By design.** |
| Dark mode | ❌ Missing | — | No `dark:` variants, `color-scheme: light` pinned | **Deliberately excluded** (docs/ARCHITECTURE.md). Do not add without asking. |
| Tokens duplicated in TS | ✅ Completed | `src/lib/tokens.ts` | Colours and fonts match `tailwind.config.ts` exactly (verified this audit) | Manual sync rule; no automated check. |
| Social brand colours outside tokens | ✅ Completed | `content/iem.ts` `socials`, `.social-btn` | Applied via inline `--sc` | Intentional exception. |
| 3D scene colours from IFC | ✅ Completed | `generated/scene_guglera.json` | Planner's colours from `IfcStyledItem` | Intentional exception; two source-level colour collisions documented. |

### 2.10 Responsive design

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Responsive layout | ✅ Completed | All components | Mobile-first Tailwind breakpoints (`sm`, `md`, `lg`, `xl`); grids collapse to 1–2 columns; nav collapses at `md`; search relocates below `sm` | Not visually verified in this audit. |
| Hero scrim pairing | ⚠️ Needs review | `Hero.tsx`, `HeroModel.tsx` | Scrim breakpoint `xl` and camera pan are a coupled pair with no code enforcement | Re-check visually whenever text column or pan changes. |
| 3D card sizing | ✅ Completed | `ModelScene.tsx` | Aspect-ratio below `lg`, viewport-height-capped above | — |
| Fixed-height imagery guidance | ✅ Completed | docs/ARCHITECTURE.md | No `vh`-sized bands present | — |

### 2.11 Accessibility

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Document language | ✅ Completed | `index.html`, `stelle.html` | `lang="de"` | — |
| Skip link | ✅ Completed | `App.tsx` | — | — |
| Visible focus | ✅ Completed | `globals.css` `:focus-visible` | 2 px navy outline, plain CSS | — |
| Reduced motion | ✅ Completed | `globals.css`, `HeroModel`, `ModelScene`, `Bauablauf` | Global animation/transition clamp; 3D frozen/auto-play skipped; flow slugs hidden | — |
| Toggle semantics | ✅ Completed | All filter groups, act buttons, plant switch, send-mode buttons | `role="group"` + `aria-label`, `aria-pressed` | Consistent pattern. |
| Native dialogs | ✅ Completed | `ProjectDialog`, `BewerbungDialog` | Focus trap, inert background, Esc from the platform | — |
| Combobox pattern | ✅ Completed | `SiteSearch.tsx` | ARIA 1.2 combobox/listbox/option | — |
| Alt text policy | ✅ Completed | Throughout | Descriptive alt for content images; `alt=""` for decorative job photos; monogram fallback `aria-hidden` | — |
| 3D canvas semantics | ✅ Completed | `ModelScene.tsx`, `HeroModel.tsx` | Ablauf host is `role="img"` with a full text description; hero canvas `aria-hidden` | — |
| Colour contrast | ⚠️ Needs review | `tailwind.config.ts` | Ratios documented in comments (bronze 5.2:1, sand 5.5:1, disciplines ≥ 4.8:1); `brand-gold` explicitly not for small text | Not re-measured in this audit; muted-on-tinted combinations (`text-muted/55`, `text-muted/60`) deserve a check. |
| Form labelling | ✅ Completed | `BewerbungDialog.tsx`, `CodeGate.tsx` | `<label htmlFor>`, hint/error ids, `aria-invalid` | — |
| Screen-reader audit | ⚠️ Needs review | — | No manual AT pass recorded | Do one before launch. |

### 2.12 Performance

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| three.js code-split | ✅ Completed | `HeroModel.tsx`, `ModelScene.tsx` | Type-only import at top, `await import()` in effect; separate chunks confirmed in the stale `dist/` (`three.module-*.js` 734 KB raw, `OrbitControls-*.js`) | Static import would silently triple page weight. |
| Model as JSON asset | ✅ Completed | `generated/scene_guglera.ts` (`?url` + `fetch`) | 656 KB raw asset; single in-flight promise cached | Inlining as a module took Rollup 18 min. |
| Deferred hero backdrop | ✅ Completed | `HeroModel.tsx` | `requestIdleCallback` (1200 ms timeout) / 500 ms fallback; pixel ratio capped at 1.5 | — |
| Off-screen pause | ✅ Completed | `HeroModel.tsx` | IntersectionObserver gates the render loop | `ModelScene` does **not** pause when scrolled away — it keeps rendering once started. |
| Save-Data respect | ✅ Completed | `HeroModel.tsx` | Skips backdrop entirely | Ablauf scene still loads on Save-Data. |
| Instanced rendering | ✅ Completed | `lib/modellSzene.ts` | One `InstancedMesh` per category / per medium | — |
| Lazy images | ✅ Completed | Throughout | `loading="lazy"`, `decoding="async"` | Hero/first-viewport images: none, so no LCP image. |
| Font loading | ⚠️ Needs review | `index.html`, `stelle.html` | Google Fonts with `preconnect` and `display=swap` | External request on every page load; consider self-hosting for privacy and performance. |
| Responsive images / `srcset` | ❌ Missing | — | Single derivative per image | README names this as first production fix. |
| Modern formats (AVIF/WebP) | ❌ Missing | — | JPG/PNG only | — |
| Oversized assets | ⚠️ Needs review | `public/img/ref/kiga-einigen.png` (1.69 MB), `seegarten-hnibach.png` (1.69 MB), `career/stuckimatte-pv.jpg` (1.03 MB), `stuckimatte*.jpg` (0.92 MB each), `magglingen*.jpg` (0.61 MB each) | Large for card-sized rendering | Convert PNG photos to JPG/WebP; drop duplicates. |
| Unused assets shipped | ⚠️ Needs review | `public/img/beruf/` (4 files, unreferenced), `ref/magglingen-2.jpg`, `ref/stuckimatte-2.jpg` (byte-identical duplicates), `team/aaa-silhouette*.jpg`, `about/verkehrsstuetzpunkt-chur.jpg` | All copied into `dist/` | ~2.5 MB of dead weight in the build output. |
| Bundle analysis / budgets | ❌ Missing | — | No size-limit or analyzer configured | — |

### 2.13 SEO and metadata

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Title + meta description | ✅ Completed | `index.html`, `stelle.html` | Both pages; advert title set at runtime | — |
| Viewport, theme-color, color-scheme | ✅ Completed | `index.html`, `stelle.html` | — | — |
| Favicon | ❌ Missing | `index.html` | No `<link rel="icon">`; no `public/favicon.*` | Browser will 404 on `/favicon.ico`. |
| Open Graph / Twitter cards | ❌ Missing | — | — | Relevant because job adverts are meant to be forwarded. |
| Canonical URL | ❌ Missing | — | — | — |
| `robots.txt` / `sitemap.xml` | ❌ Missing | `public/` | — | — |
| Structured data (Organization, JobPosting) | ❌ Missing | — | — | JobPosting schema would suit the advert page. |
| Access gate vs. crawlers | ⚠️ Needs review | `CodeGate.tsx` | Crawlers see only the code prompt while the gate is on | Remove the gate before indexing matters. |

### 2.14 Authentication, roles, dashboards, settings (scope check)

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Authentication UI | 🟡 Partial | `CodeGate.tsx` | A shared preview code, not user authentication; `sessionStorage` key `iem:zutritt` | See §4. |
| Role-based UI | ❌ Missing | — | No users, no roles | **Not applicable** to a public marketing site. |
| User profile / account | ❌ Missing | — | — | Not applicable. |
| Dashboards | ❌ Missing | — | — | Not applicable. |
| Settings UI | ❌ Missing | — | — | Not applicable. |
| Data tables | ✅ Completed | `ServiceIndex.tsx` (register), `CompanyProfile.tsx` (`<dl>`), `ProjectDialog.tsx` (`<dl>`) | Semantic list/definition-list registers rather than `<table>` | No sortable/paginated tables needed. |
| Internationalisation | ❌ Missing | — | German only, Swiss conventions | By design. |

### 2.15 Content and data integrity

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Single content module | ✅ Completed | `src/content/iem.ts` (1'303 lines) | 5 services, 6 disciplines, 6 SIA phases, 3 Bauakte, 30 projects, 41 team members, 7 openings with verbatim advert bodies, 2 offices, 3 socials, 5 sponsorships, 4 Leitbild statements, 7 company facts | Verified counts this audit. |
| Derived figures | ✅ Completed | `Hero.tsx`, `App.tsx`, `companyFacts` | Years, headcount, Bern-since, project count all computed | Karriere description "Sieben offene Stellen" and footer "© 2026" are literals. |
| Verbatim rule for client text | ✅ Completed | `projects[].details`, `openings[].detail`, `leitbild` | Documented and followed | — |
| Job location discrepancy | ⚠️ Needs review | `openings` `place` vs `detail.einstieg` | Three adverts: site says "Thun"/"Thun oder Bern", PDFs say "Thun und Bern" | Open question for the client; both are IEM's wording. |
| Naming the Guglera project | ⚠️ Needs review | `generated/scene_guglera.*`, `ModelScene.tsx` | Real client project not documented on iem.ch | Needs IEM's permission before publication. |
| Team photo drift | ⚠️ Needs review | `public/img/team/` | Five portraits still 3:2 (client is re-shooting to 4:3); one member without photo | Re-check against iem.ch/team periodically; compare aspect ratios, not bytes. |
| README accuracy | 🟡 Partial | `README.md` | Says job listings are "illustrative" (they are verbatim from iem.ch) and describes the hero as an annotated 2D section (it is now the 3D model); does not mention `CodeGate` | Update alongside the merge-conflict fix. |
| docs/ARCHITECTURE.md accuracy | 🟡 Partial | `docs/ARCHITECTURE.md` | Does not mention `CodeGate`, `BewerbungDialog` or `StelleDetail` in the component layering list | Add them. |

---

## 3. Backend

### 3.1 Server-side features

There is no server-side code in this repository. Every item below is listed so the absence is explicit and checkable.

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Server architecture | ❌ Missing | — | Static site only | **By design** for a redesign sketch. |
| API routes / controllers / services | ❌ Missing | — | — | — |
| Database models / migrations | ❌ Missing | — | Content is a TypeScript module | No CMS (README "Known limitations"). |
| Authentication (server) | ❌ Missing | — | Client-side preview gate only (§2.14) | If the preview must be protected, use HTTP Basic Auth at the host. |
| Authorization / roles / permissions | ❌ Missing | — | — | Not applicable. |
| User management | ❌ Missing | — | — | Not applicable. |
| Security middleware (CSP, HSTS, headers) | ❌ Missing | — | No server to set headers; no `_headers`/`vercel.json` equivalent | Configure at the chosen host. |
| Server-side validation | ❌ Missing | — | — | Required for the upload endpoint. |
| Server-side error handling | ❌ Missing | — | — | — |
| Logging | ❌ Missing | — | — | — |
| File storage (dossier uploads) | ❌ Missing | `BewerbungDialog.tsx` expects `VITE_BEWERBUNG_ENDPOINT` | Frontend ready to POST `multipart/form-data` with fields `position, vorname, nachname, email, telefon, verfuegbar, nachricht` and files under `dateien` | Candidate: Formspree-style service or a small function with virus scanning and retention policy. |
| Email service | ❌ Missing | — | Applications go via the visitor's own mail client (`mailto:`) | Success screen promises "Eine Bestätigung geht an …" for the upload path — only true once a backend sends it. |
| SMS service | ❌ Missing | — | — | Not applicable. |
| Background jobs / cron | ❌ Missing | — | — | Not applicable. |
| External integrations | 🟡 Partial | `index.html`, `App.tsx`, `Footer.tsx`, `openings[].pdf` | Google Fonts (runtime), Google Maps deep links, social profile links, PDF links to iem.ch | All outbound links; no inbound integration. |
| Environment configuration | 🟡 Partial | `src/vite-env.d.ts` | One typed optional variable; no `.env.example`; variable unset | Add `.env.example` documenting it. |
| Database performance | ❌ Missing | — | — | Not applicable. |
| API security (rate limiting, CORS, auth) | ❌ Missing | — | — | Required with the upload endpoint. |
| Hosting / deployment | ❌ Missing | — | No CI, Dockerfile, host config, or deploy script; `dist/` is a stale local build (git-ignored) | Any static host works (`dist/` contains `index.html`, `stelle.html`, assets, images). Configure caching for `/assets/*` (hashed) and `no-cache` for HTML. |

### 3.2 Python CAD toolchain (development-time generators)

These scripts are the closest thing the project has to "backend" logic. They run on a developer machine, read `ifc/` and `cad/model.py`, and write committed artefacts. **None were executed in this audit**; status reflects the code and the committed outputs.

| Feature | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Python environment | ✅ Completed | Local machine | Python 3.14.7, `ifcopenshell` 0.8.5, `ezdxf` 1.4.4 present | `matplotlib` not checked (only needed for verification plots). No `requirements.txt` / `pyproject.toml`. |
| IFC section → `SchnittGuglera.tsx` | ✅ Completed | `cad/ifc_schnitt.py`, `cad/build_svg_ifc.py` | Cuts plane x = 5.00 m, ±8 m band; **exits non-zero** if a value-flag rule matches nothing | Output committed but not rendered. |
| IFC → 3D scene JSON | ✅ Completed | `cad/build_scene_ifc.py` | Every `IfcProduct` classified; unknown class **aborts**; pipes/ducts/fittings reconstructed from ports and mesh; insulation as own medium; flow polylines chained | Output `scene_guglera.json` (656 KB) committed and rendered. |
| IFC quality audit | ✅ Completed | `cad/audit_ifc.py` | Report only, never exits non-zero, never edits | Honest "cannot answer" section. |
| Sample project model | ✅ Completed | `cad/model.py` | Single source of truth for the sample building | No longer on the page. |
| DXF plan sheet | ✅ Completed | `cad/build_dxf.py` → `cad/out/IEM-HLKS-101_Schnitt-AA.dxf` | Committed output dated 19 Aug 2026 | — |
| DXF → DWG conversion | 🟡 Partial | `cad/to_dwg.ps1` | Requires the external ODA File Converter | Not reproducible without that install. |
| IFC4 deliverable | ✅ Completed | `cad/build_ifc.py` → `cad/out/IEM-Musterprojekt.ifc` | Committed | README notes: no materials, types or port connections. |
| Sample scene + collision check | ✅ Completed | `cad/build_scene.py` → `src/generated/scene.ts` | Fails the run if two media come within the sum of their radii | The repo's only real automated test. Output unused on the page. |
| IFC geometry verification | ✅ Completed | `cad/verify_ifc.py` | Asserts generated IFC dimensions against `model.py` | Gate. |
| Generator run status | ⚠️ Needs review | All of `cad/` | Not run in this audit; `__pycache__` shows recent execution under Python 3.14 | Run the three gates after any `model.py` or rule change. |

---

## 4. Security Checklist

| Area | Status | Location | Finding | Recommendation |
| --- | --- | --- | --- | --- |
| Authentication | 🟡 Partial | `CodeGate.tsx` | Six-digit code stored as a string constant in the source and shipped in the JS bundle; comparison happens in the browser; unlock persisted in `sessionStorage`. Component comment states this is a display barrier, not security. | Treat the site as public. If the preview must be private, add HTTP Basic Auth or an access-controlled host and remove `CodeGate`. Do not add real secrets to the frontend. |
| Authorization | ❌ Missing | — | No roles; nothing to authorise | Not applicable. |
| API protection | ❌ Missing | — | No API. The future upload endpoint will receive personal data and files | Endpoint must enforce size/type limits server-side, rate limiting, CSRF/origin checks, and virus scanning. |
| Password security | ❌ Missing | — | No passwords | Not applicable. |
| Data validation | 🟡 Partial | `BewerbungDialog.tsx` | Client-side only: required fields, loose email pattern, file count/size/extension | Add server-side validation when the endpoint exists; the `accept` attribute is advisory only. |
| File upload security | 🟡 Partial | `BewerbungDialog.tsx` | Limits enforced in the browser; MIME sniffed by extension only; files never leave the browser today | Server: verify content type, cap size, store outside the web root, scan, define retention. |
| Environment variables | ✅ Completed | `src/vite-env.d.ts`, `.gitignore` (`*.local`) | Only one `VITE_*` variable; `.env.local` ignored; no secrets in the repo | Remember that every `VITE_*` value is public in the bundle. |
| XSS surface | ✅ Completed | `src/` | No `dangerouslySetInnerHTML`; all content is static TS rendered through React; `mailto:` body built with `encodeURIComponent` | — |
| External links | ✅ Completed | `Footer.tsx`, `JobRegister.tsx`, `StelleDetail.tsx`, `ProjectDialog.tsx`, `App.tsx` | `target="_blank"` links carry `rel="noreferrer"` or `rel="noreferrer noopener"` | — |
| Third-party requests | ⚠️ Needs review | `index.html`, `stelle.html` | Google Fonts loaded from `fonts.googleapis.com`/`fonts.gstatic.com` on every visit | Self-host fonts to avoid transmitting visitor IPs to Google (relevant under Swiss revDSG / EU GDPR for a Swiss firm). |
| Privacy / legal | ❌ Missing | `Footer.tsx` | No Datenschutzerklärung, no Impressum, no consent on the application form | Required before public launch. |
| Security headers | ❌ Missing | — | No CSP, HSTS, X-Content-Type-Options, Referrer-Policy | Set at the host. A CSP must allow `fonts.googleapis.com`/`fonts.gstatic.com` (or self-host), inline styles used by React, and `blob:`/WebGL as needed. |
| Dependency hygiene | ⚠️ Needs review | `package.json`, `package-lock.json` | 5 runtime + 8 dev dependencies, all mainstream; no audit run in this session | Run `npm audit` and keep Vite/three current. |
| Personal data in repo | ⚠️ Needs review | `content/iem.ts`, `public/img/team/` | 41 named employees with portraits; unpublished `role`/`lernend` fields stored in source; `CodeGate` includes a personal mobile number as "Code vergessen?" contact | Data comes from the client's own site, but the repo is a data store of personal data: confirm consent, keep the repo private, and reconsider the phone number in the gate. |
| Client confidential files | ✅ Completed | `.gitignore` `ifc/` | Client IFC/DWG models excluded from git | Confirm they are also excluded from any shared build artefacts. |
| Known vulnerabilities in own code | ✅ Completed | — | None found by static reading | — |

---

## 5. Testing Checklist

| Area | Status | Location | Details | Notes |
| --- | --- | --- | --- | --- |
| Unit tests (frontend) | ❌ Missing | — | No test runner (no Vitest/Jest), no `*.test.*` files | README: "no test runner, linter or formatter configured". Not to be introduced unprompted per docs/ARCHITECTURE.md. |
| Integration / component tests | ❌ Missing | — | None | — |
| End-to-end / browser tests | ❌ Missing | — | None | — |
| Backend tests | ❌ Missing | — | No backend | Not applicable. |
| TypeScript typecheck as gate | 🟡 Partial | `npm run build` (`tsc -b`) | The only automated frontend gate | **Currently failing** (merge conflict). |
| Linting / formatting | ❌ Missing | — | No ESLint/Prettier config | By decision. |
| CAD gate: collision check | ✅ Completed | `cad/build_scene.py` | Exits non-zero on inter-medium collision | Not run in this audit. |
| CAD gate: IFC verification | ✅ Completed | `cad/verify_ifc.py` | Asserts dimensions vs `model.py` | Not run in this audit. |
| CAD gate: section value flags | ✅ Completed | `cad/build_svg_ifc.py` | Exits non-zero if a flag rule matches nothing | Not run in this audit. |
| CAD gate: DXF audit | 🟡 Partial | `python -m ezdxf audit cad/out/*.dxf` | Documented command, not scripted | — |
| Manual testing: build | ✅ Completed (this audit) | — | `npm run build` executed → **fails** with 9 TS errors in `src/stelle.tsx` | See §6. |
| Manual testing: dev server / rendering | ⚠️ Needs review | — | Not performed in this audit | Follow docs/ARCHITECTURE.md guidance: check the dev server output and fetch `globals.css` for a 500 after CSS changes. |
| Manual testing: application form (mail path) | ⚠️ Needs review | `BewerbungDialog.tsx` | Depends on the visitor's mail client; no record of a test pass | Test on Windows/macOS/iOS/Android mail clients. |
| Manual testing: upload path | ❌ Missing | — | Cannot be tested until an endpoint exists | — |
| Manual testing: 3D on low-end devices / no WebGL | ⚠️ Needs review | `HeroModel.tsx`, `ModelScene.tsx` | Failure paths exist in code; behaviour on devices without WebGL not recorded | — |
| Manual testing: accessibility (keyboard + screen reader) | ⚠️ Needs review | — | Patterns are correct in code; no AT pass recorded | — |
| Manual testing: cross-browser | ⚠️ Needs review | — | Native `<dialog>`, `requestIdleCallback` (with fallback), `CSS.escape`, `dvh` units used | Safari < 15.4 lacks `<dialog>`; decide on the support matrix. |
| Visual regression | ❌ Missing | — | None | Screenshot traps documented in docs/ARCHITECTURE.md. |

---

## 6. Technical Debt

### 6.1 Bugs

1. **Build is broken.** `src/stelle.tsx` lines 3–6 and 28–32 contain `<<<<<<< HEAD` / `=======` / `>>>>>>> bc9571c…` markers. `tsc -b` fails; `vite build` never runs. The two sides differ only in whether the advert page is wrapped in `CodeGate`. The `HEAD` side (with `CodeGate`) is consistent with `src/main.tsx` and with the `sessionStorage` design described in `CodeGate.tsx`.
2. **Upload success copy over-promises.** `BewerbungDialog.tsx` line 348 states a confirmation email will be sent. No system sends one. Harmless while the upload path is disabled, wrong the moment an endpoint is configured without an email step.
3. **Ablauf scene keeps rendering off-screen.** `ModelScene.tsx` starts its `requestAnimationFrame` loop once and never pauses it; `HeroModel.tsx` has the IntersectionObserver pause, `ModelScene` does not. Costs GPU on every frame after the section has been reached.
4. **Missing favicon** produces a 404 on every page load.
5. **Placeholder legal links** (`href="#"`) scroll to top instead of going anywhere.

### 6.2 Missing features

- Upload endpoint for the application form (frontend is ready; `VITE_BEWERBUNG_ENDPOINT` unset).
- Datenschutz and Impressum pages; privacy consent on the form.
- Favicon, Open Graph tags, `robots.txt`, `sitemap.xml`, JobPosting structured data.
- Error boundary around both React roots.
- Hosting / CI / deploy configuration; security headers.
- `.env.example` and a Python `requirements.txt`.

### 6.3 Refactoring and housekeeping

- Remove or wire up `src/components/Card.tsx` (unused).
- Decide the fate of the three generated-but-unrendered outputs (`SchnittGuglera.tsx`, `SchnittAA.tsx`, `src/generated/scene.ts`); docs/ARCHITECTURE.md permits either keeping or deleting.
- Delete unreferenced assets: `public/img/beruf/*` (4 files), `ref/magglingen-2.jpg`, `ref/stuckimatte-2.jpg`, `team/aaa-silhouette*.jpg`, `about/verkehrsstuetzpunkt-chur.jpg`.
- Derive the literal "Sieben offene Stellen" (`App.tsx` line 135) from `openings.length`, and the footer year from `new Date()` or a build-time constant.
- Fix stale comments: `ModelScene.tsx` header items 4–5 (five strands / HTML labels), `ProjectRegister.tsx` line 114 ("31 published references").
- Update `README.md` (job listings are verbatim, hero is the 3D model, `CodeGate` exists) and `docs/ARCHITECTURE.md` (component list lacks `CodeGate`, `BewerbungDialog`, `StelleDetail`).
- Move `@types/three` to `devDependencies`.
- Delete the stale local `dist/` or rebuild it once the build passes.
- Copy consistency: hero CTA "Kontaktiere" (du-form) against a Sie-form page.

### 6.4 Performance

- No responsive `srcset`, no AVIF/WebP; two 1.7 MB PNG photos and several 0.6–1.0 MB JPGs rendered at card size.
- Google Fonts as a render-blocking external stylesheet (also a privacy item).
- Ablauf scene does not honour Save-Data and does not pause off-screen (hero does both).
- No bundle-size budget; three.js chunk is ~734 KB raw (~190 KB gzip) and is only ever loaded on demand — keep it that way.

### 6.5 Security and privacy

- `CodeGate` gives a false sense of privacy; documented in-file but not in README/docs/ARCHITECTURE.md.
- Personal mobile number embedded in `CodeGate.tsx`.
- No security headers, no CSP.
- Personal data (41 employees, internal role/apprentice flags) stored in source; repository must stay private and consent confirmed.
- Two open client questions block publication: naming the Guglera project, and which job-location wording is current.

---

## 7. Next Development Priorities

### Priority 1 — Critical (blocks any build or release)

1. **Resolve the merge conflict in `src/stelle.tsx`** (keep the `CodeGate` wrapper to match `main.tsx`, or remove the gate from both), then confirm `npm run build` passes and `dist/` contains both `index.html` and `stelle.html`.
2. **Add Impressum and Datenschutzerklärung** and link them from the footer; add a consent line to the application form.
3. **Get the two client sign-offs**: permission to show and name the Guglera model; the current wording for the three job locations.
4. **Decide the preview-protection strategy**: keep `CodeGate` for the sketch only, and never rely on it for anything confidential.

### Priority 2 — Important improvements (before public launch)

1. Provide an upload endpoint (or a hosted form service) and set `VITE_BEWERBUNG_ENDPOINT`; add server-side validation, size/type checks, scanning, rate limiting and a real confirmation email — or remove the "Bestätigung geht an …" sentence.
2. Favicon, Open Graph/Twitter tags, `robots.txt`, `sitemap.xml`, canonical URLs; JobPosting JSON-LD on `stelle.html`.
3. Self-host the three font families; add security headers (CSP, HSTS, Referrer-Policy) at the host.
4. Image pipeline: convert the two PNG photos, add `srcset`/WebP, delete the unreferenced and duplicate assets.
5. Add an error boundary to both roots; add the IntersectionObserver pause and Save-Data check to `ModelScene`.
6. Hosting + CI: a workflow that runs `npm run build` on every push (this alone would have caught the merge conflict), then deploys `dist/`.
7. Manual test pass: keyboard/screen reader, mail-client behaviour of the `mailto:` path on four platforms, WebGL-less fallback, Safari support matrix.

### Priority 3 — Future features and polish

1. Documentation refresh (README, docs/ARCHITECTURE.md, `.env.example`, `requirements.txt`).
2. Housekeeping from §6.3 (unused `Card`, stale comments, literal counts, dependency placement).
3. Consider a lightweight visual-regression or smoke test if the project outgrows "design study".
4. If the section drawing (`SchnittGuglera`) is ever wanted back on the page, it is complete and only needs importing.
5. Analytics/monitoring only after the privacy policy defines what may be collected.

---

## 8. Summary counts

Counts are of the status cells in the tables of §2, §3, §4 and §5 (one status per row).

| Status | Count |
| --- | --- |
| ✅ Completed | 99 |
| 🟡 Partial | 18 |
| ❌ Missing | 53 |
| ⚠️ Needs review | 21 |
| **Total rows** | **191** |

Of the 53 ❌ rows, 21 are features that are **not applicable or excluded by design** for a static marketing site (routing, dark mode, toasts, i18n, roles, profiles, dashboards, settings, server/API/database, server auth, user management, SMS, background jobs, password security, backend tests, linting) and are listed only so their absence is explicit. The remaining 32 are genuine gaps: legal pages and consent, SEO assets, the upload backend with its validation and protection, email confirmation, hosting/CI and security headers, tests, the image pipeline, and the error boundary.
