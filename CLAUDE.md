# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`README.md` and `docs/ARCHITECTURE.md` are thorough and current — read them for the *why* behind
the design, the brand rules, the CAD toolchain, and the content model. This file covers the
operational knowledge on top of them: how to run things, and the traps that cost real debugging
time because they span several files and fail silently.

`docs/PROJECT_IMPLEMENTATION_CHECKLIST.md` is a third document and a narrower one: a file-by-file
audit of the **frontend only**, dated 14 September 2026, written before the CMS existed. It is
still useful for the site's own coverage and technical debt, but it predates `server/` and knows
nothing about it — it is *not* the source of the Known gaps at the foot of this file.

Five further documents describe the **enterprise platform** the CMS is becoming the foundation of.
Read them in this order before touching `src/app`, `src/core`, `src/entities`, `src/features`,
`src/shared`, `src/widgets` or `server/src/core` — their README files are the contracts that say
what may go in them, and `src/architecture.test.ts` enforces the four that matter:

| Document | |
| --- | --- |
| `docs/system-audit.md` | What is actually here. **§0 is the premise: there is no operational domain model.** |
| `docs/enterprise-architecture.md` | Current architecture, its twelve named weaknesses, the target, the folder structure, navigation, dashboards, the UI system, and a staged migration |
| `docs/data-model.md` | Every business entity — fields, relationships, validation, lifecycle, statuses — with a Mermaid ER diagram |
| `docs/permissions.md` | The RBAC catalogue and the role × module × action matrix, including the row-level `◐` rules |
| `docs/roadmap.md` | Build order, complexity, dependencies, database and API impact, and the definition of done per module |

**None of the business modules is implemented, and the architecture says not to start one until the
Foundation stages are done.** As of 18 September 2026, **the twelve Foundation stages are done** and
Wave 1 — the Project module as the reference standard — is what comes next:

| Done | |
| --- | --- |
| F2 | `shared/ui` split into six families; three domain pieces moved to `entities/` and `widgets/` |
| F3 | `core/api` with the query cache, and `features/applications` as the five-layer reference |
| F4 | `core/router` with `parent`, derived breadcrumbs, and route-published actions |
| F5 | `useForm`, `EntityForm`, and an unsaved-changes guard that covers a hash change |
| F6 | `rbac/resources.ts` → generated catalogue, with a two-way agreement test |
| F7 | `core/events` — a named catalogue of 45 events, not a string bus |
| F8 | Audit derived from those events, with a `correlationId` per request |
| F9 | `Combobox`, `EntityPicker`, `DatePicker`, `DateRangePicker`, `Drawer`, `FilterBar` |
| F10 | `core/jobs` — a `Job` table, a poller, retries with capped backoff |
| F11 | `core/list` — one paginate/filter/sort/search contract, plus saved views, columns, export, bulk |
| F12 | A Nest module per feature; `app.module.ts` lists modules and nothing else |

**The rule the firm set, and it holds for every layer:** one fully tested reference
implementation before the pattern is copied. `features/applications/` is that reference on the
client and `ApplicationsService` is it for events — the other eight endpoint groups stay on the
shared `api` object and the other services keep their hand-written audit calls until each is
migrated deliberately.

## Commands

```bash
# Frontend (repo root)
npm run dev          # all three entries on :5173  — /, /stelle.html, /admin.html
npm run typecheck    # tsc -b, noEmit
npm run build        # tsc -b && vite build
npm run preview      # serve dist/

# API — also from the repo root. `server/` has its own package.json and
# node_modules, but these are all `npm --prefix server` wrappers, so running
# them *inside* server/ fails with "Missing script" (the script there is `dev`).
npm run setup        # one-time: install + migrate + seed
npm run server:dev   # nest start --watch
npm run server:build # nest build
npm run server:seed  # idempotent; reconciles permissions/types/settings
npm run db:migrate   # prisma migrate dev (creates the database if absent)
npm run db:studio

# The API's typecheck is the one script with no root wrapper — run it with the
# prefix. It checks the seed under a second tsconfig (`tsconfig.seed.json`),
# because the seed imports from the site package and would otherwise drag the
# build's `rootDir` up a level.
npm --prefix server run typecheck
```

After changing `schema.prisma`, regenerate before typechecking: the API's `tsc`
fails on the new field until `npx prisma generate` has run in `server/`.

**The API listens on 3100.** `docs/ARCHITECTURE.md` says `:3000` in its command list — that is
wrong; `server/.env`, `main.ts` and `README.md` all say 3100, and `README.md` explains why 3000 was
rejected.

```bash
# The gates. `verify` is what to run before a commit.
npm run verify       # typecheck + lint + test, both halves. Needs nothing running.
npm test             # vitest, site + dashboard
npm --prefix server run test
npm run lint         # eslint; 0 errors is the bar, warnings are a backlog

# The browser pass. Needs `npm run dev`, `npm run server:dev` and a seeded database.
npm run e2e          # Playwright: 3 widths x 2 themes, every screen, + axe
npm run e2e:report   # the HTML report from the last run
npm run verify:all   # verify + e2e, for a release
```

**`e2e` is deliberately *not* in `verify`.** `verify` is the pre-commit gate: no
servers, no database, a few seconds. Folding the browser pass in would make it
fail on a machine with no Postgres, and a gate that fails for reasons unrelated
to the change is a gate people learn to skip. Run `e2e` before a release and
after anything touching the shell, the theme, the routes or the downloads.

Three things about the Playwright suite that cost time to learn:

- **It signs in once per worker and shares one browser context.** Per-test
  sign-in trips the login throttle (10/min) partway through, and the usual
  `storageState` trick is worse here: replaying one refresh cookie into fresh
  contexts looks exactly like token theft to `AuthService`, which revokes every
  session in response.
- **`channel: "chromium"`, not the headless shell.** The shell omits composited
  regions from `fullPage` screenshots at small viewports — an image renders
  correctly and photographs as a blank rectangle.
- **The dossier test submits through the public form**, which is capped at five
  an hour per IP. Re-running the suite repeatedly makes it skip itself with a
  message saying so; that is the rate limit working, not a failure.

Screenshots land in `e2e/shots/<width>/<theme>/` — 78 of them, all gitignored.

**Vitest and ESLint were added on 17 September 2026** and replace the note that used to stand here
saying none existed. Three things about them are deliberate:

- **Prettier is configured but the tree is not formatted**, and `format:check` is *not* in `verify`.
  Running it rewrites 74 files, which would bury every future diff and destroy `git blame` on a
  codebase whose comments are its main documentation. Use `npm run format <file>` on something you
  are already rewriting. `.prettierignore` also excludes the two NUL-byte files — see below; a
  reformat would silently strip the sentinel.
- **Lint is narrow on purpose.** ~28'000 lines were written without one, so it enforces the rules
  that catch bugs and leaves style to Prettier. The React Compiler rules
  (`set-state-in-effect`, `refs`, `use-memo`) fire 21 times on patterns this codebase chose and
  commented, so they are warnings: a countable backlog, not a wall. 0 errors is the bar.
- **Tests exist where a bug already got through**, not for coverage. `settings.dto.test.ts` runs the
  real `ValidationPipe` with the real options because the bug it guards was a missing decorator
  being silently stripped — asserting the decorator is present would not have caught it.

`npm run build`, `npm run server:build` and the typechecks remain the other gates.
`docs/ARCHITECTURE.md` → *Verifying a change* describes the Node `react-dom/server` smoke test,
which is still the strongest check available without a browser.

Two notes on aiming that smoke test at the **dashboard**, neither of which is obvious. It renders
under `<ToastProvider><AuthProvider>`, and the `globalThis.window` stub needs **both**
`location.hash` (read by `useRoute` in `lib/router.tsx`) and `location.origin` (read by `lib/api.ts`
when it builds a request URL) — a stub with only one of them fails on whichever runs first.
Effects do not run under `renderToStaticMarkup`, so the session stays empty and `UserMenu` renders
nothing, which is all most assertions need. To reach the shell itself rather than the signed-out
screen, render `AdminLayout` directly with a hand-built `sections` array. And the server's pure modules bundle
the same way — `--alias:@srv=server/src` plus
`--alias:@nestjs/common=server/node_modules/@nestjs/common` — which is how `buildSnapshot` and
`assertComplete` can be exercised directly against constructed rows. Prefer asserting against the
real published document (`GET /api/v1/content/published` is `@Public()`) over fixtures you invent;
it is the only way the ambiguities in real content show up.

`nest start --watch` buffers its bootstrap output; a startup failure can look like silence. To see
why the API will not start, run `node dist/main.js` from `server/` after `npm run server:build`.

## Big picture

Three Vite entries, none of them a route: `index.html` (site), `stelle.html` (one job advert, its
own React root), `admin.html` (the CMS dashboard). All three must stay listed in `vite.config.ts`
under `build.rollupOptions.input` — dropping `index.html` silently removes the site from the build.

Content flows one way: `server/src/content/content-types.ts` defines the model → editors write
`ContentEntry` rows → publishing assembles one `ContentSnapshot` (a complete `SiteContent`) →
`src/content/store.ts` fetches it and swaps it in after first paint. The public site never reads
content tables. The dashboard is the only writer.

**Editing and publishing are separate acts, and this is the most common source of confusion.**
Saving, deleting or reordering changes the draft; the site keeps serving the last snapshot until
someone publishes. Nothing an editor does reaches a visitor on its own. When a change "did not
work", check the snapshot version before reading any code — `GET /content/pending` reports exactly
whether the live document and the next one would differ.

`src/content/schema.ts` is shared ground: the site and the server depend on the same shapes.

**On the server, a change to a record is announced, not logged.** `EventBus.publish` from
`core/events` raises one of the 45 named events in `core/events/catalogue.ts`; `AuditListener`
turns it into the audit row, and notifications, reporting and the workflow engine will read the
same event without the module knowing they exist. Events are queued on the request context and
flushed when the request succeeds, so a listener never sees an uncommitted row and a failed request
announces nothing.

Call `AuditService.record` directly only for things that happened to *nobody* — a failed sign-in, a
denial — or for an **access** rather than a change: opening a dossier has no before and no after,
and it is in the log because personal data was looked at.

Anything slow goes through `JobService.enqueue` (`core/jobs`). A job is durable, retried with a
capped backoff, attributable — it inherits the correlation id and actor of the request that queued
it — and visible as a row, which is the property an operator needs when an export never arrives.

## Invariants that fail silently

These are the ones that have actually bitten. Each spans more than one file, so none is visible
from the code you are editing.

**The API envelope is `{ data: … }`, unconditionally.** `EnvelopeInterceptor`
(`server/src/common/http.ts`) wraps every successful body with no inspection of it, and both
clients — `src/admin/lib/api.ts` and `src/content/store.ts` — unwrap `.data` unconditionally.
*Never reintroduce a shape test for "is it already wrapped".* It was there, it looked harmless, and
it collided with the domain: `ContentEntry` has a real `data` column, so every endpoint returning a
single entry was passed through unwrapped, and the dashboard's editor rendered a blank white page.
A shape test cannot tell an envelope from data that looks like one. If a handler ever needs to
control its own envelope, give it an explicit opt-out decorator.

Routes that send non-JSON (`/audit/export`, the application file download) use `@Res()` *without*
`passthrough`, which bypasses the interceptor entirely. Keep it that way.

**Every DTO field needs a class-validator decorator.** The global pipe runs with `whitelist: true`,
which strips any property that carries none. An undecorated `data!: unknown` on the content DTOs
meant `data` never reached the service and every save failed with a message about the *downstream*
validator. Undecorated fields do not fail loudly; they vanish.

**A deletion never becomes `APPROVED`.** Deleting marks the row `deletedAt` and leaves `status`
alone, so it never enters the review workflow — and neither does a reordering. Any screen that
measures outstanding work by counting `APPROVED` entries is therefore blind to both. The publish
page did exactly that: it reported "nothing is approved" and *disabled the publish button* while a
deleted team member was still live on the site. Ask what the next publish would produce
(`ContentService.pendingChanges` → `rowsForNextPublish` + `diffDocuments`), never how many entries
are approved.

`rowsForNextPublish` is a pure model of the first two steps `publish()` performs in its
transaction. `publish()` deliberately does not call it — it writes the rows and re-reads them. If
the promotion rule changes, change it in both.

**Comparing anything read back from Postgres `jsonb` needs canonicalisation.** `jsonb` does not
preserve key order, so a plain `JSON.stringify` comparison against a freshly built object reports
almost every object as changed. `snapshot.builder.ts` sorts keys recursively before comparing; reuse
that rather than writing a second comparison.

**Adding a field to the site touches three files**: `src/content/schema.ts`,
`src/content/defaults.ts`, and `server/src/content/content-types.ts`. `REQUIRED_KEYS` in
`snapshot.builder.ts` is the backstop — an incomplete document fails the publish rather than
blanking a section on the live page. `buildSnapshot` and `prisma/seed.ts` are inverses; the two
`__`-prefixed loose-key types (`jobTexts`, `contactEmail`) are handled explicitly in both.

**Uploaded media is served by hand in `main.ts`, behind an allowlist.** Two things depend on it and
neither is visible from the other.

*The allowlist is not optional.* `applications.service.ts` says its dossiers are "deliberately not
under the media root", but it passes the key `bewerbungen/<year>/<hash>.<ext>` to the same adapter,
whose root **is** `MEDIA_ROOT` — they are in `var/media/bewerbungen/`. Mounting the root unguarded
publishes every applicant's CV to anyone who can guess a URL. The guard is a *positive* match on
`^/\d{4}/<name>.<ext>`, the only shape `MediaService.upload` writes, and it must stay positive: a
`bewerbungen/` denial has to be written against `req.path`, which is **not** percent-decoded, while
`express.static` decodes before opening a file — `/media/%62ewerbungen/…` and
`/media/bewerbungen%2f…` both walked straight past a prefix test and served the PDF.

*The dev proxy is what makes it work at all.* `LocalStorageAdapter.url()` returns a root-relative
`/media/<key>`, which is right — the snapshot outlives the machine — but the site and the API are
separate origins in development. `vite.config.ts` proxies `/media` to `:3100`. Without it the dev
server answers with its SPA fallback: **status 200, `text/html`**, so a broken image reads as a
failed upload rather than a missing route.

**Tailwind emits `components` before `utilities`, so a utility silently wins.** The `glass-*` panes
in `src/admin/admin.css` set their own `background`; leaving a `bg-*` utility on the same element
flattens the pane with no error anywhere. Every call site drops its `bg-` when it gains a `glass-`
class. The same ordering is why `@layer components` classes are purged when their name appears in
no content file.

**`ContentEntry.hidden` is filtered in exactly one place.** `buildSnapshot` drops hidden rows, which
is why the public site has no concept of visibility at all — an entry that is not in the document
does not exist as far as the page is concerned. It applies to the draft preview too, so the preview
shows what publishing would produce. Note the interaction with `assertComplete`: hiding *every*
entry of a required collection empties it and fails the publish. That is intended, and it is the
same backstop that stands between a half-seeded database and a blank section.

**`cn()` is plain `clsx`, with no tailwind-merge.** A `className` passed to a component is
*appended*, so it cannot reliably override a `bg-` or `text-` in the base — stylesheet order
decides. Re-tone the component or add a `tone` prop instead of fighting it from a call site.

**Absolutely positioned elements need a horizontal anchor.** Without `left`/`right`/`inset-x`, the
element lands at its *static position*, and inside a `<button>` that is affected by the user
agent's `text-align: center` (Tailwind preflight does not reset it). This is what misplaced the
`Toggle` knob.

**`tsc` has `noEmit: true` for a reason.** Without it TypeScript writes a `.js` beside every source
file, Vite resolves `.js` before `.tsx`, and the dev server serves stale output. If edits appear to
have no effect, look for stray `src/**/*.js`.

**three.js must stay dynamically imported.** `ModelScene` uses `await import("three")` inside an
effect so it lands in its own chunk. A static top-level import still builds — the page just triples
in weight. Type-only imports are free.

**Two Tailwind configs.** `tailwind.config.ts` scans the public site; `tailwind.admin.config.ts`
scans `src/admin` and is selected by `@config` in `src/admin/admin.css`. Widening the public
config's `content` to `./src/**` pushes several hundred admin-only utilities into the stylesheet
every visitor downloads.

**`theme.extend.screens` appends; it does not sort.** Tailwind emits responsive variants in the
screens object's *key order*, not in ascending width order. A breakpoint added through `extend`
therefore lands after `2xl` and beats every earlier variant at any width it matches — an extended
`xs: 400px` wins over `sm:` and `lg:` on every screen wider than 400px, which looks like the
utilities being ignored rather than like an ordering bug. Adding a breakpoint means restating the
whole `screens` object under `theme` in ascending order; Tailwind's own values are sm 640,
md 768, lg 1024, xl 1280, 2xl 1536. `tailwind.admin.config.ts` spreads `base.theme`, so it picks
up whatever is declared there and the two cannot drift.

**The page width and gutter are repeated at every band, not held in a token.** `mx-auto max-w-7xl
px-6 lg:px-10` is written out in `App.tsx` (both the `Section` wrapper and the contact band),
`Nav.tsx` (header and mobile menu), `Hero.tsx` and `Footer.tsx`; the dashboard's equivalent is
`max-w-[84rem]` in `AdminLayout`. Changing the page width means changing all of them, and missing
one leaves that band centred at a different width — which reads as a misaligned footer, not as a
wrong number. Two of those call sites are deliberately not symmetrical and should stay that way:
the footer's top row carries `pl-6 lg:pl-10` with **no** right padding, so the social rail sits
flush with the container edge, and `Hero.tsx`'s scrim gradient is a share of the *viewport* while
the text column is a fixed `max-w-2xl` inside the container — its `54%` stop is measured against
that pairing, so moving the page width means re-measuring the gradient.

**Two source files carry a literal NUL byte, and git calls them binary.**
`src/components/ProjectRegister.tsx` and `src/components/TeamGrid.tsx` each declare the
"show everything" filter sentinel as `const ALLE = "<U+0000>alle"`, with a real NUL embedded in the
string so it can never collide with a category or a city an editor might type. The sentinel works,
but it costs the diff: `git diff` prints `Binary files … differ` for both, `git diff --stat` marks
them `Bin`, `git add -p` cannot stage them by hunk, and any review tool reading the diff sees no
change at all. Re-typing that line by hand yields a plain `"alle"` and silently drops the
guarantee. A `Bin` marker on a `.tsx` file here is this, not corruption.

**Never `@apply` a custom colour with an opacity modifier** (`@apply ring-brand-navy/40`). It
resolves inconsistently — the dev server throws while the build passes — and a failing stylesheet
renders a blank page. Write it as plain CSS.

**`AsyncLocalStorage` cannot be opened in a Nest interceptor.** `run(store, fn)` propagates to what
`fn` *starts*; an interceptor's `intercept()` only builds the observable, and Nest subscribes after
it returns — so the route handler runs outside the scope. Everything typechecks, every unit test
passes (they call `runWithContext` themselves), and in a live request every `correlationId()` mints
a fresh id. The symptom was an audit row that never appeared. `RequestContextMiddleware` calls
`next()` synchronously inside the scope, which is the only placement that works.

**A feature's screen must own its own `lazy()` boundary.** When the shell statically imports a
feature's `index.ts` (for a rail badge, say) and the route table imports it dynamically, Rollup
resolves the conflict by hoisting the shared module into the *entry* chunk — the route's own chunk
disappears and the bundle grows, with no error. `features/applications/index.ts` therefore exports
`lazy(() => import("./screens/…"))` rather than re-exporting the component.

**`Content-Disposition` plus a PDF body breaks `fetch` in Chromium 153.** It is reported as
`MissingAllowOriginHeader` even though the response carries `Access-Control-Allow-Origin`, and
same-origin it is worse: HTTP 204 with an empty body, so the caller saves a 0-byte file. Confirmed
against curl, a Node client replaying the exact preflight-then-GET, and Playwright's interception —
all three get the header. PNG and JPEG on the same route succeed. The dossier download therefore
sends `application/octet-stream` + `nosniff` + `Content-Length` and **no** `Content-Disposition`;
`/audit/export` keeps its, because a CSV body triggers none of this.

**A DTO type may be named in `repository.ts` and `mapper.ts` and nowhere else.** That rule is what
makes the mapper a seam rather than a decoration, and `src/architecture.test.ts` enforces it along
with feature isolation, the `index.ts` boundary and the direction of every layer arrow.

**A folder under `server/src/` is either infrastructure or a feature, never both.** `audit/` and
`settings/` were both, and it was invisible from either half: each held a controller belonging to
one feature *and* a service every other feature injects. So `ApplicationsService` imported
`../settings/settings.service`, which reads as a feature reaching into a sibling and is exactly
what `server/src/architecture.test.ts` forbids — but the import was legitimate, because that
service is infrastructure wearing a feature's folder name. The services moved to
`core/audit/audit.service.ts` and `core/settings/settings.service.ts`; the controllers stayed.
`settings/settings.controller.module.ts` is named for that split — it is the *routes*, and the
global `SettingsModule` in `core/` is the provider. When a new service is going to be injected by
more than the feature it sits in, it belongs in `core/` before the second caller appears, not
after.

**Generated files are overwritten.** `src/components/SchnittGuglera.tsx`, `src/components/SchnittAA.tsx`,
`src/generated/scene_guglera.json` and `src/generated/scene.ts` come from the Python chain in `cad/`.
Do not hand-edit them.

## Dashboard navigation

Navigation is data, not JSX. `src/admin/lib/navigation.ts` is the single source: the Website groups
are built at runtime from the content types the server reports, sorted by each type's own `rank` and
slotted by `GROUP_OF`. A type missing from that map still appears, under "Weitere Inhalte" — adding
a content type needs no change here.

The rail (`src/admin/ui/Sidebar.tsx`) lists **main groups only**, in three zones — what is waiting
for you, what you edit, what you administer. `ZONES` fixes their order and every section names its
own; `buildNavigation` sorts by it, so `flattenNavigation` feeds search in the order the eye meets
the rows. A section in the `hidden` zone is searchable but never drawn, which is how "Mein Konto"
stays reachable without a rail row duplicating the header's user panel.

The shell's **sticky top bar** carries the group's name, the breadcrumb trail and whatever the
current screen has published through `usePageActions`. `SectionTabs` is gone — the rail folds its
groups open in place, so a copy of the entries up here would be the same navigation twice.

The trail is *derived*: a route names its `parent` in `routes.tsx` and `core/router/breadcrumbs.ts`
walks it. Do not write a `<Breadcrumb>` in a screen — `ContentEditor` did, and a hand-written trail
keeps pointing at the old path the first time a route moves, with nothing to notice. The last
crumb's label comes from the screen through `usePageTitle`, because only it has fetched the record;
the *middle* crumb comes from a dictionary the shell passes, because no screen can name its own
parent list.

Two flags exist because a destination that is the parent of other destinations breaks the default
rules. `exact` on a `NavItem`/`NavSection` switches `isActive` from prefix to exact matching:
"Website bearbeiten" is `/inhalte`, and without it every `/inhalte/<type>` would light its row and
win `activeSection` ahead of the group the editor is actually in. `hideBarTitle` leaves the
section's name out of the top bar, for a page that already says where it is.

Only add a menu entry for a route the table in `src/admin/routes.tsx` actually serves —
`routes.test.ts` checks both directions, plus that every `parent` resolves and nothing cycles.

## Permissions

`server/src/rbac/resources.ts` is the source of truth, not the database and no longer
`permissions.catalog.ts` — that file *derives* the flat list from the resource declarations. Add a
module by adding a resource; the role editor groups itself from `label` and `category`. The seeder
reconciles and reports orphans rather than deleting them. `JwtAuthGuard` is global and **denies by
default** — a route is protected unless it carries `@Public()`. Permissions are resolved from the
database on every request, so revoking a role takes effect immediately. Super Admin short-circuits
on the role key, never on holding every permission.

The backend half is complete. The frontend half is **partial**: every route in `routes.tsx` now
declares the permissions that open it and `App.tsx` shows a "no access" screen instead of rendering
one it cannot fill. That is still a courtesy — the server's 403 is what stops the data, and the rail
hiding what a user cannot reach is a third courtesy on top.

`permissions.agreement.test.ts` compares the catalogue against every guard in the tree, in both
directions, and counts a `permissions.has(...)` check inside a handler as enforcement — those are
the row- and field-level `◐` rules in `docs/permissions.md` §4, and `settings.secrets` is one.

## Known gaps

Documented in the audit performed on this repo, still open:

- 12 permissions in the catalogue are enforced on no route. **They are now a list rather than a
  paragraph**: `KNOWN_UNENFORCED` in `server/src/rbac/permissions.agreement.test.ts`, one line each
  with what it is waiting for. A thirteenth fails the build, and so does an entry that has started
  being enforced and was left on the list. (The audit said twelve; the test found a thirteenth on
  its first run and it was a false positive — `settings.secrets` is checked inside the handler
  rather than by a decorator, which is the documented `◐` pattern.)
- `ContentEntry.scheduledAt` is read and cleared by the publish job but set by nothing — no
  endpoint, no UI. Scheduled publishing is half built.
- The `Notification` and `Redirect` Prisma models have tables and no implementation at all.
  `docs/data-model.md` §3.23 makes Notification a real domain; nothing reads it yet.
- No Department entity; the closest thing is a hardcoded option list on the team type's `group`.
- **The client renders any route to any signed-in user.** `routes.tsx` declares each route's
  permissions and `App.tsx` checks them, so the *shell* refuses — but that is a courtesy. The
  server's 403 is the control, as it has always been.

`README.md` → *Known limitations* carries the product-level list (no MFA flow, local-disk media,
placeholder legal pages, `CodeGate` is a display barrier and not security).

## Content rules

Copy is German, Swiss conventions: apostrophe thousands (`1'450`), true minus (`−38%`), `ss` not `ß`.
Derived figures stay derived — copy carries `{token}` placeholders resolved by `derive.ts`, and an
unknown token renders as itself rather than blanking a number on a live page.

Everything in the content is checkable against iem.ch. **If you add a number, add its source.** Do
not invent job titles for the team entries that have no published one — only the three
Geschäftsleitung members state a function.
