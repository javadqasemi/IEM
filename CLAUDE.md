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

As of 18 September 2026 the **fourteen Foundation stages are done**, so is
**Wave 1 module 4 — Projects, the reference standard**, and so are the first three modules of
Wave 2: **Aufgaben**, **Sitzungen und Entscheide** and **Pläne und Planversand**. The four
modules Projects needs as data (Customer, Building, Employee, Discipline)
ship as **read-only slices**: the subset `docs/data-model.md` documents that a real project
requires, no more, each in the folder its own module will grow into.

**Wave 2 is ordered by dependency, not by the roadmap table:**
`Project → Tasks → Meetings → Drawings → Documents → SIA Phases → BIM`.

Two corrections have been made to that line and both were the same failure — an order stated in
more than one place drifts, and the copy a reader happens to meet first is the one that decides
what gets built. The note that used to stand here said the roadmap's *prose* was wrong about
Tasks and Meetings; that prose has since been corrected, so the note outlived the problem it
described. **Drawings and Documents were swapped on 18 September 2026**, and there the prose and
the numbered table had been right all along while the dependency block was wrong: a drawing does
not hang off a document, it is the Arbeitsgegenstand with its own `ALPHA` revision scheme, and
the archive is where things go once they have stopped moving. `docs/roadmap.md` §Wave 2 carries
the full argument and the workflow chain it rests on.

**The rule the firm set is that no second business module starts until Projects meets all ten rows
of the gate in `docs/roadmap.md` → Wave 1.** It does. The next module derives from this shape
rather than inventing one — and *deriving* means the five layers, the list spec, the events, the
permissions and the tests, not a folder with the same names in it.

| Done | |
| --- | --- |
| F2 | `shared/ui` split into six families; three domain pieces moved to `entities/` and `widgets/` |
| F3 | `core/api` with the query cache, and `features/applications` as the five-layer reference |
| F4 | `core/router` with `parent`, derived breadcrumbs, and route-published actions |
| F5 | `useForm`, `EntityForm`, and an unsaved-changes guard that covers a hash change |
| F6 | `rbac/resources.ts` → generated catalogue, with a two-way agreement test |
| F7 | `core/events` — a named catalogue, not a string bus. `DOMAIN_EVENT_NAMES` is the count |
| F8 | Audit derived from those events, with a `correlationId` per request |
| F9 | `Combobox`, `EntityPicker`, `DatePicker`, `DateRangePicker`, `Drawer`, `FilterBar` |
| F10 | `core/jobs` — a `Job` table, a poller, retries with capped backoff |
| F11 | `core/list` — one paginate/filter/sort/search contract, plus saved views, columns, export, bulk |
| F12 | A Nest module per feature; `app.module.ts` lists modules and nothing else |
| W1·4 | **Projects** — ten tables, the five layers on both sides, ten events, row-level scope, fourteen tabs |
| F13 | **Versionierung** — `EntityVersion`, the optimistic lock, and both revision schemes |
| F14 | `core/metrics` — records in four states, latency with its percentiles, error rate, events, audit and jobs, per module, and a module that declares itself |
| W2·1 | **Aufgaben** — four tables, ten events, a board, row-level *write* scope, and the first embedded project tab |
| W2·2 | **Sitzungen und Entscheide** — six tables, twelve events, a protocol that closes on approval, and a decision register that outlives it |
| W2·3 | **Pläne und Planversand** — five tables, eleven events, `I` and `O` skipped, and a reissue that names who holds the old revision |

**Three cross-cutting pieces stand between Wave 1 and Wave 2**, set by the firm at review, and all
three are done. They are here rather than after the next module because every module inherits them
and each is far more expensive to retrofit than to establish:

| | |
| --- | --- |
| Security validation | `e2e/security.spec.ts` — the role × verb × resource matrix against the live API, plus direct-id, query-manipulation and nested-route attempts |
| Performance budgets | `e2e/budgets.spec.ts` and `e2e/budgets.ts` — the numbers, the method, and the N+1 slope check |
| Versionierung | F13 above, demonstrated on Projects: `v12`, the history tab, and a lock a concurrent write actually loses |

**No module ships without metrics**, set by the firm at the same review, and F14 is how that is
paid for once rather than per module. A module declares a `ModuleMetricsSource` — a key, a label,
a record count, a route prefix, and the events, jobs and audit resources it owns — and everything
else (latency, p50/p95, error rate, job durations) is measured centrally by `MetricsInterceptor`
and the event bus. `GET /metrics/modules` is the report, behind `system.health`.
`architecture.test.ts` fails a feature folder that has no `*.metrics.ts`, with the ten folders
that predate the rule on a shrink-only list.

**The rule the firm set, and it holds for every layer:** one fully tested reference
implementation before the pattern is copied. `features/applications/` was that reference for the
five layers and `features/projects/` is it for a *business* module — the other eight endpoint
groups stay on the shared `api` object and the other services keep their hand-written audit calls
until each is migrated deliberately.

**Two things to copy from Projects, and one not to.** Copy the layer split
(`dto → repository → mapper → service → hooks → screens`, and on the server
`rules → repository → mapper → service → controller`) and the *rules file*, which is pure and
therefore the only part that can be tested exhaustively. Do **not** copy the four read-only
master-data slices as a pattern: they are thin because their own modules are not built yet, and a
module that ships without a `service.ts` because Projects' customers did is a module that has
skipped its domain rules rather than found it had none.

**What Aufgaben changed about the pattern, because deriving is not copying.** Four decisions were
argued rather than inherited, and each is written up where it lives:

| | |
| --- | --- |
| No stored `isOverdue` or `progressPercent` | Both are a `where` clause or a count the server already has. Projects stores its two because a *list sorts by them*; a stored figure nothing sorts by goes stale for free, and copying the reconciler would be deriving the shape rather than the reasoning |
| A job anyway — `tasks.flagOverdue` | Knowing a task is late needs no column; **telling somebody** is an event, and time is the trigger, so a clock has to raise it. Once per due date, guarded by `overdueNotifiedAt`, announced *before* it is marked |
| Row-level **write** scope | `task.updateOwn` is the first of its kind. It cannot be a route decorator — `@RequirePermissions` is AND, and ownership depends on a row the guard has not read — so `requireWritable` is the single gate and the agreement test counts the `permissions.has` inside it |
| A drawer, not a route | A task is opened, ticked and closed, often four in a row. The cost is stated rather than discovered: **a task has no shareable URL** |

**What Meetings changed about the pattern, and the first row is Aufgaben's decided the other
way.** Four more arguments, each written up where it lives:

| | |
| --- | --- |
| A route, not a drawer | The opposite of the row above, on the same grounds. A protocol is read, quoted and sent to people who were not in the room — *"siehe Bausitzung 14, Punkt 3"* has to be a link somebody can paste into an e-mail, and a drawer has no URL to paste. The cost is the mirror image: opening two protocols means going back |
| An approved protocol is closed | `refuseProtocolEdit` consults no permission, which is the point: it is not about authority. A protocol that can still be edited after approval is a document whose contents *at the time of approval* are unknowable, which is precisely the property a dispute needs it to have. The way to change one is to approve an **amendment** at the next meeting, and the screen says so rather than only refusing |
| `AUFGEHOBEN` is not a settable status | It is reachable only through `supersede`, which always attaches the replacement in one transaction — so a reversal can never read as withdrawn with nothing to point at. `refuseDecisionStatus` refuses it as a direct transition and says what to do instead. The arrow points **from the new decision to the old one**, which is the one call in the module where the wrong direction still typechecks, because both arguments are ids |
| Two resources, one feature | `/meetings` and `/decisions` are one module and share one cache prefix. A decision is created from a protocol line and a line shows its decision's status, so a write to either changes what the other renders — two prefixes would make every mutation guess which to invalidate, and the guess would be wrong exactly when a decision was superseded from a meeting screen |

**What Pläne changed about the pattern.** Four more, and the first is the second
time a shape has been *adopted* rather than invented — which is what stops it being a coincidence:

| | |
| --- | --- |
| `ISSUED`/`SUPERSEDED` are not settable | The same arrangement Entscheide used for `AUFGEHOBEN`, applied to two statuses instead of one. Both are consequences — of a Planversand and of a newer revision — so a plan can never read as being in a contractor's hands with no row saying whose. `refuseTransition` refuses each **by name** and says what to do instead, because the generic "Status X kann nur nach Y" would send somebody looking for a missing transition |
| A rule a permission cannot express | **A draftsman may not check their own work.** The question is not what the caller holds but whose name is already in the other column, so `refuseFourEyes` is a rule and not a key. What is deliberately *not* enforced — releasing a plan you checked — is the other half: `docs/permissions.md` names only the first pair, and a rule stricter than the firm's practice is one the firm stops using the system over |
| The catalogue settled a rule before the service asked it | `DrawingReleased`, `DrawingIssued` and `DrawingWithdrawn` were declared during **F7**, before the module existed, and the module was built to them. `DrawingWithdrawn.reason` is a non-nullable `string`, which turned out to mean a plan cannot be withdrawn without saying why — the payload decided it. A `RevisionReleased` invented here would have been a second name for one fact, and `drawings.metrics.test.ts` asserts against exactly that |
| A warning that is not a refusal | Reissuing a revised plan is the **normal case**, so refusing it would make the correct action impossible. But whoever holds revision B while C goes out is the one who builds the wrong thing, so `priorIssueWarnings` names them, the warnings come back *beside* the created transmittal, and the dialog becomes a report rather than closing. A toast would put them where nobody reads them |
| A stored figure that needs no reconciler | `issuedRevision` beside `currentRevision` — what is *out there* against what the office is drawing. Stored because the register sorts and filters on the pair, which is the `progressPercent` test and the one `isOverdue` failed; **not** reconciled nightly, which is where it parts company with `progressPercent`: that one drifts because two of its inputs are the current date, whereas a Transmittal can be neither edited nor deleted, so this column's inputs are append-only. One writer, `markIssued`, inside the Planversand transaction — and one `updateMany` per plan rather than one for all of them, because the letter differs per drawing and a single `data` object would stamp the same wrong revision on every row. It never moves backwards: re-issuing an older revision is a real act that does not make it the newest thing out there |

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

# The cross-cutting suites, runnable on their own. All `--project=desktop` only:
# none says anything different at a phone width, and all are slow.
npm run e2e:security   # the role x verb x resource matrix, against the live API
npm run e2e:budgets    # the performance budgets, with the measurements printed
npm run e2e:versioning # the optimistic lock, including two writers racing
```

**Both need a seed that ordinary development does not.** `e2e:security` needs
the six role accounts (`SEED_TEST_USERS=true` plus `SEED_TEST_PASSWORD`, both in
`server/.env`), and `e2e:budgets` is only meaningful with rows —
`SEED_LOAD_PROJECTS=500 npm run server:seed` creates them. Each **skips with a
message** rather than failing when its data is absent, because a red suite on a
machine that has not opted in is one people learn to ignore.

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
- **The budget is sign-ins, not requests, and it is spent per *width*.** A spec
  that calls `apiAs()` in a `beforeAll` costs one `/auth/login` per project, so
  running it at three widths costs three. Adding one such spec was enough to
  starve the tablet project's own sign-in, and the failure surfaced two screens
  away: the first tests of `projects.spec.ts` reported *"Hauptnavigation not
  found"* over a screenshot of the **login page**. That reads as a broken shell.
  `RUN_ONCE` in `playwright.config.ts` is the list of suites the narrower
  projects skip — `API_ONLY` plus anything that authenticates in a fixture — and
  the repair is always to run the suite once, never to raise the limit.
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
  (`set-state-in-effect`, `refs`, `use-memo`) fire on patterns this codebase chose and commented,
  so they are warnings: a countable backlog, not a wall. **0 errors is the bar**, and that is the
  number to watch — as of Wave 2 module 2 the warnings stand at 35 (28 compiler, 8
  `exhaustive-deps`), up from the 21 this note recorded when it was written, because the count
  grows with the dashboard rather than with any decision. Treat a rise in *errors* as a
  regression and a rise in warnings as arithmetic.
- **Tests exist where a bug already got through**, not for coverage. `settings.dto.test.ts` runs the
  real `ValidationPipe` with the real options because the bug it guards was a missing decorator
  being silently stripped — asserting the decorator is present would not have caught it.

### The rule about which toolchain a test runs in

**A business-critical assertion runs against the compiled build wherever the build and the test
toolchain are known to behave differently.** Vitest transforms with esbuild; `nest build` and
`tsc -b` do not. Where those two disagree, a vitest test is not a weaker check — it is a check of
something else, and it will pass while the shipped code is wrong.

Three places they disagree, all found the hard way:

| | esbuild | `tsc` / `nest build` | What it cost |
| --- | --- | --- | --- |
| `emitDecoratorMetadata` | not emitted | emitted | A Nest DI test is impossible; F12 broke the app twice with 355 tests green |
| `useDefineForClassFields` (ES2022) | absent fields not defined | every declared field defined as `undefined` | `changed` on every version row listed every field, for a whole wave, with 600 tests green |
| Decorator evaluation order | differs in edge cases | — | Not yet bitten; assume it will |

So, in order of preference:

1. **An e2e assertion against the running API.** `e2e/tasks.spec.ts` and `e2e/versioning.spec.ts`
   guard `changed` this way, and it is the only guard that would have caught it.
2. **`node dist/…` after a build**, when the thing under test is not reachable over HTTP —
   `node dist/main.js` for DI, a throwaway script against `dist/` for a shape.
3. **A vitest test of the pure function**, with a comment saying what it cannot see and the
   measured numbers from (2) written down. `core/versioning/changed.test.ts` is the template: it
   tests `changedFields` against an object shaped the way the *compiled* DTO is, because running
   the real pipe under vitest would pass against the broken code.

A vitest test that appears to exercise the pipe, the container or a decorator is the dangerous
shape — it looks like the strongest test in the file and is the one that proves nothing. If a test
would only be meaningful under `tsc` semantics, say so in the test rather than writing it and
believing it.

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
`core/events` raises one of the named events in `core/events/catalogue.ts`; `AuditListener`
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

**`Object.keys(dto)` returns every declared field, not the ones the caller sent.** The other half
of the same mechanism, and it shipped for a whole wave before anybody saw it. `tsconfig.json`
targets ES2022, so `useDefineForClassFields` defines every `@IsOptional() foo?: string` as
`undefined` on the instance; `ValidationPipe` runs with `transform: true`, so the service receives
that instance rather than the parsed body. A `PATCH` carrying one field therefore produced a
version row whose `changed` listed all sixteen, and a `ProjectUpdated` event whose `fields` payload
was the whole DTO — so the history stopped reading as a sentence and a workflow rule on "somebody
moved the deadline" would fire on every save. Use **`changedFields(dto, VERSION_CONTROL_FIELDS)`**
from `core/versioning/changed.ts`, which keeps a `null` (that is a change) and drops an
`undefined`.

**And vitest cannot reproduce it**, which is why it survived 600 passing tests: esbuild does not
emit the class-field definitions, so the instance it builds has only the keys the request sent and
a unit test running the real pipe passes against the broken code. The same gap as the Nest DI note
below. `node dist/…` is the check — `changed.test.ts` records the measured numbers — and
`e2e/tasks.spec.ts` and `e2e/versioning.spec.ts` are the regression guards, because they run
against the build.

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

**PowerShell's backtick is its escape character, and it eats commit messages.** A message
containing `` `refuseProtocolEdit` `` arrives as `efuseProtocolEdit`, and `` `tasks.rules.ts` `` as a
literal tab followed by `asks.rules.ts` — `` `r `` is a carriage return and `` `t `` is a tab. Commit
`55abde5` is damaged in history this way and cannot be read as written. Backticks are unavoidable
here, because the messages in this repository name files and functions. **Write the message to a
file and use `git commit -F <file>`**, which passes no text through the shell at all; a
single-quoted here-string (`@'…'@`) also works but is one stray `@"` away from the same bug. Afterwards
`git log -1 --format=%B` is worth a glance — a tab in the output is the tell.

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

**`Field` clones its child to wire `aria-describedby`, and that was a claim before it was a
behaviour.** The component's own comment said it owned the label/hint/error relationship;
`FieldRenderer` wired the attribute itself, so every *content* form was correct, while every
hand-written `<Field><Input/></Field>` — the project dialogs and every module that copies them —
rendered an error with an `id` nothing referenced. The message was announced (`role="alert"`) and a
reader who tabbed back to the field heard nothing about why it was invalid. Found by writing a test
that tried to assert it. A call site that sets `aria-describedby` or `aria-invalid` itself still
wins, and a child that is not a single element is rendered untouched.

**`useId` contains colons, so `#id` is not a selector.** React produces `:r1:`, a colon is a
pseudo-class, and `#:r1:-error` matches nothing — Playwright reports it as an element that is not
visible, which reads as a missing error message. Use `[id="…"]`.

**A failed query used to retry itself forever.** `load` settles → `notify` → every subscriber's
`sync` → `load` again, and a failed entry was never *fresh*. One rail badge that answered 403 made
**a thousand requests** and exhausted the rate limit for everything else on the page — including the
save the user was trying to make. `RETRY_AFTER_MS` in `core/api/query.ts` is the loop-breaker, and
`failedAt` is deliberately separate from `updatedAt`: one is how old the data is, the other is how
long since we were refused, and conflating them would make a failure look like fresh data. It stayed
hidden because every query the shell issues had succeeded for every role that existed — only Super
Admin could reach the dashboard at all. **The other half of the fix is in the shell**: a badge is
gated on the permission rather than on being signed in, because one nobody can see should cost no
request.

**`updateMany` takes scalar fields; it has no relation operations at all.** `toProjectUpdateData`
emits `managerId`, never `manager: { connect }`, and that is forced rather than preferred: the
optimistic lock needs the version inside the `where`, only `updateMany` allows that, and a relation
operation there is rejected at runtime with *Unknown argument `manager`*. It **typechecks** — the
parameter was the looser `ProjectUpdateInput` and the object is spread into the call — and the e2e
suite passed, because every case in it changed a scalar. A matrix that only exercises the easy
column confirms what somebody already believed.

**An optimistic lock has to be one statement, or it is a race with extra steps.**
`ProjectsRepository.updateIfUnchanged` is `updateMany({ where: { id, version: expected } })` and
reads the returned count. Reading the version, comparing it, then writing looks equivalent and is
not: two callers both read 7, both find it equal to 7, and both write 8. Postgres's row lock on the
`UPDATE … WHERE version = 7` is what actually decides. `updateMany` rather than `update` because
`update` takes only a *unique* filter — the version cannot be part of it — and because a count is a
value this code can read where an exception would have to be parsed.

`expectedVersion` is **required** on `UpdateProjectDto`, not optional. A lock a caller may omit is
one every caller omits exactly once, and the failure is the single data-loss bug a user cannot
detect, report or work around: the second save wins silently and the first person's work is gone.
The client always has the number — `version` is on every row, list included, so an inline edit does
not have to fetch the record first, and that fetch is exactly the window the lock closes.

**409 and 404 are different answers and both are needed.** A stale write is a conflict; a write to a
project the caller cannot see is a 404, because whether a project exists is itself information.
`refuseStale` tells them apart by re-reading. On the client, a 409 is the one error the form cannot
be saved past: `ProjectEditDialog` offers *reload*, never "save anyway" — a button that resubmitted
with the new version would be a two-click way to do the overwrite the lock exists to prevent, and it
would look like the safe option.

**The version history is not the audit log, and both are kept.** The audit log records *the change*
— who did what, across the system, including failures and denials. `EntityVersion` records *the
state*: what the record said at v7, reconstructable without replaying anything. Rebuilding a project
from a hundred audit rows is not something anybody does under pressure, and "what did the contract
value say in March" is a question this firm is asked. One table for every entity rather than
nineteen, which costs the foreign key — the same trade `AuditLog` makes, and correct for the same
reason: everything is soft-deleted, and a history that vanished with its row would be a history of
nothing.

**A stored version payload is the mapped record, never the Prisma row.** `toProjectDetail(row)`, so
a document read in five years does not contain `{"s":1,"e":6,"d":[…]}` where a contract value should
be and does not depend on a schema that has since changed.

**Revision numbering is bijective base-26, which has no zero digit.** `core/versioning/revision.ts`:
after `Z` comes `AA`, not `[`, and `AA` is 27 rather than 26 because `A` means one. A naive
`String.fromCharCode(65 + n)` produces `[` in a title block on a drawing that has been issued to a
contractor. Two schemes, because the firm uses two — `NUMERIC` for projects, meetings and documents,
`ALPHA` for drawings and transmittals — and `revision.test.ts` round-trips the first thousand.

**A performance budget measured through the test harness measures the harness.**
`e2e/budgets.ts` holds the numbers; the *method* is most of what makes them a regression test. The
navigation budget first read 155 ms against a limit of 100 — driven from the test process with
`page.evaluate` and `expect(locator).toBeVisible()`, which costs two CDP round-trips plus `expect`'s
own retry interval and cannot resolve faster than that however quickly the page renders. Timed
*inside* the page with `performance.now()` and a `MutationObserver`, the same navigation is **40 ms**.
Raising the budget to 200 would have written 115 ms of overhead into the contract, where no
regression under that size could ever be seen again. The API budgets are measured against the live
API for the same reason: first paint in dev — unminified, uncached, cold transform — is an order of
magnitude off any number worth setting, so it is deliberately not budgeted.

**A budget over two rows proves reachability, not speed.** Every query is fast over two rows,
including the ones that will not be fast over two thousand — so `budgets.spec.ts` prints the row
count it measured against on every run and refuses to claim anything about scale below 100.
`SEED_LOAD_PROJECTS=500` is what makes the list queries work for their living. The N+1 check is the
one a wall-clock budget cannot make: it compares `perPage=1` against `perPage=50` and asserts the
*slope*, because a query per row is invisible at a small page size against a local database.

**The Gewerk colours are a closed set of six.** `disc-heat` `disc-air` `disc-water` `disc-power`
`disc-energy` `disc-model`, declared in `admin.css` for both themes and checked by
`theme.contrast.test.ts`. `Discipline.defaultColour` holds one of those **token names**, never a hex
literal — a Lüftung run has to be the same colour on a plan, in a schedule and in the 3D scene, and
a literal would be the one colour in the system that cannot answer to dark mode. A seventh name
does not fail: `disciplineColour()` returns `currentColor` and the dot renders in the text colour,
which is visible in both themes and wrong enough to notice. The seed once carried invented names
(`disc-heizung`) and every dot went grey with nothing reporting it.

**A derived figure is written by exactly one method, and reconciled nightly.** `progressPercent`
and `health` are stored on `Project` so a list can sort by them, which means they can go stale.
`ProjectsService.recompute` is the only writer, every route that can move them calls it, and
`ProjectsReconciler` runs it at 02:00 over every live project — **because two of the inputs are the
current date**, so a project nobody touches still changes. The seed deliberately does *not* set
either: a seeded derived value would hide a reconciler that had stopped working.

**A Nest DI mistake cannot be caught by a test in this toolchain.** Vitest transforms with esbuild,
which does not emit `emitDecoratorMetadata` — so `design:paramtypes` is `undefined` and
`Test.createTestingModule({imports:[AppModule]}).compile()` fails on every provider regardless. F12
broke the application twice this way (`ApplicationsModule` missing `MediaModule`, `UsersModule`
missing `AuthModule` and `MailModule`) with all 355 server tests passing. **`node dist/main.js` after
`npm run server:build` is the check**, and `nest start --watch` is not: it buffers bootstrap output,
so an `UnknownDependenciesException` looks like silence.

**An audit row that reads the wrong shape does not fail — it lies.** `toAuditSnapshot` takes the
manager as `managerId` *or* `manager.id`, because `findForRules` selects the column and the detail
select carries the relation. The first version read only the column, so every `before` had the
manager and every `after` did not, and every edit was recorded as removing them. Nothing threw. It
was found by reading a real row, and the guard is now a test rather than a type.

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

**`server/src/scheduler/` is the cron host; `server/src/tasks/` is Aufgaben.** The scheduler was
called `tasks/` until Wave 2 needed that name for a real module, and the rename was the cheap half
of the rule above: two folders called `tasks/`, one infrastructure and one a feature, would make
every `../tasks/…` resolve while telling a reader nothing about which of the two it meant.
`INFRASTRUCTURE` in `server/src/architecture.test.ts` lists `scheduler`, which is what makes the
scheduler's imports of `ApplicationsModule` and `ContentModule` legal — a timer commanding a
feature is not a feature reaching into a sibling.

**A feature may not import another feature, and `widgets/` may not import a feature at all.** Both
are in `src/architecture.test.ts`, and together they decide where the project detail's embedded
tabs are composed: not in `features/projects`, not in `widgets/`, but in `admin/pages/ProjectPage.tsx`
— the only layer above both. `ProjectDetail` takes an `embedded` map of slug → component and falls
back to `ModulePlaceholder` for a slug nobody supplied, so the seven remaining tabs need no change
as their modules arrive. The same pair is why `features/tasks/repository.ts` calls `/projects`,
`/employees` and `/disciplines` itself rather than importing `projectRepository`: **a repository
may know any endpoint**, and two repositories calling one endpoint is duplication while one feature
reaching into another is a mesh.

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

**Row-level visibility is a `where` fragment, never a filter over results.** `project.read` opens
the module; `project.readAll` is the separate grant that widens it from "the projects I manage or
sit on" to the firm's whole book. Expressing that as a second *permission* keeps the rule in the
catalogue, where it is grantable and auditable, instead of inside a service where nobody can ask who
has it. `projects.scope.ts` builds the predicate, the repository takes it as an argument and
**defaults to the narrow case**, so a query that forgets it returns the caller's own projects rather
than everyone's. Filtering after the fetch would give a page of eleven rows out of twenty-five, a
total that counts rows nobody can open, and a leak in any query that forgot the post-filter.

One asymmetry, because assuming otherwise is reasonable and wrong: the scope narrows **reads**.
Writes are guarded by `project.update` and friends, which are firm-wide — somebody with
`project.update` may edit any project they can *reach*, and reach is what the scope narrows.

`permissions.agreement.test.ts` compares the catalogue against every guard in the tree, in both
directions, and counts a `permissions.has(...)` check inside a handler as enforcement — those are
the row- and field-level `◐` rules in `docs/permissions.md` §4, and `settings.secrets` is one.

**The dashboard's URLs are German, and a project's tab is one of them.**
`/projekte/:id/gewerke` — the tab lives in the route, not in `useState`, so it is a link somebody
sends a colleague and a place a reload returns to. `routes.tsx` therefore carries *two* detail
patterns pointing at one component (`/projekte/:id/:tab` before `/projekte/:id`), and the screen
reads the trailing segment itself; a route per tab would be fourteen entries differing in one
string, and adding a module would mean editing the table as well as `screens/tabs.ts`.

## Known gaps

Documented in the audit performed on this repo, still open:

- **14 permissions in the catalogue are enforced on no route**, and they are a list rather than a
  paragraph: `KNOWN_UNENFORCED` in `server/src/rbac/permissions.agreement.test.ts`, one line each
  with what it is waiting for. A new one fails the build, and so does an entry that has started
  being enforced and was left on the list. (The audit said twelve; the test found a thirteenth on
  its first run and it was a false positive — `settings.secrets` is checked inside the handler
  rather than by a decorator, which is the documented `◐` pattern. `job.read`, `job.retry` and
  `job.cancel` were added with `core/jobs` and have no routes yet.) **The prose in that file still
  says "a thirteenth entry fails the build" and is one behind** — the list is what counts.
- `ContentEntry.scheduledAt` is read and cleared by the publish job but set by nothing — no
  endpoint, no UI. Scheduled publishing is half built.
- The `Notification` and `Redirect` Prisma models have tables and no implementation at all.
  `docs/data-model.md` §3.23 makes Notification a real domain; nothing reads it yet.
- No Department entity; the closest thing is a hardcoded option list on the team type's `group`.
- **The client renders any route to any signed-in user.** `routes.tsx` declares each route's
  permissions and `App.tsx` checks them, so the *shell* refuses — but that is a courtesy. The
  server's 403 is the control, as it has always been.

Opened by Wave 2 module 1, and each is a deliberate stop rather than an oversight:

- **`Task.spentHours` has no writer.** The column is declared because
  `docs/data-model.md` §3.9 lists it and Wave 2 module 14 (Time Tracking) fills it; nothing seeds
  it and no rule reads it, so a reconciler that stopped working cannot hide behind a plausible
  number.
- **`TaskOverdue` is raised and nothing consumes it.** `tasks.flagOverdue` runs at 06:00 and
  announces once per due date; Notifications is Wave 2 module 9. The event exists now so that
  module is a consumer rather than a reason to revisit this one.
- **`Comment` is polymorphic and only Tasks writes it.** The table takes `entity`/`entityId`, so
  Meetings and Drawings call it through their own repositories when they arrive. Editing a comment
  is not implemented — `editedAt` is a column nothing sets.
- **Ten feature folders report no metrics.** `WITHOUT_METRICS` in
  `server/src/architecture.test.ts`, one line each with what it is waiting for, and the list may
  only shrink.

Opened by Wave 2 module 2, and each is a deliberate stop rather than an oversight:

- **Nothing is actually sent.** `POST /meetings/:id/minutes/sent` stamps `minutesSentAt` and
  raises `MinutesSent`; the e-mail needs the Documents module and a PDF renderer, both later in
  the wave. The fact it records — which protocols have gone out — is useful on its own, which is
  why it ships rather than waiting, and the confirm dialog says plainly that the send itself still
  runs through somebody's own mailbox. **It is once only**: the route refuses a second send, so
  the button is gated on `minutesSentAt` as well as on the status. A button that could only ever
  produce that 400 reads as an offer.
- **`Attachment` is not built.** It was in the firm's entity list, and it is the one entity from
  that list deliberately not here: file storage, versions and preview are Wave 2 module 3, and a
  meeting-only uploader would be a second answer to a question Documents is about to answer
  properly. `MeetingItem` carries no file column, so nothing has to be migrated away later.
- **`Minutes` is not a table.** Also from the firm's list, and folded rather than dropped: the
  minutes *are* the meeting's `MeetingItem` rows plus `minutesSentAt` plus the `MeetingApproval`.
  A separate record would be a second place the protocol lives, and the first one to go stale.
- **The agenda cannot be reordered.** There is no `PUT /meetings/:id/agenda/order` — items take
  the order they were added in. `PUT /meetings/:id/items/order` exists for the protocol lines and
  renumbers their keys, but **no screen calls it yet**: reordering a line changes what `14.3`
  refers to, and a drag that silently renumbers citations wants an interaction designed for it
  rather than one inherited from the task board.
- **Editing a protocol line is not versioned.** `EntityVersion` covers the meeting record and the
  decision, not the lines. A protocol's integrity is defended by closing it on approval instead,
  which is the stronger guarantee and the one the firm actually relies on.

Opened by Wave 2 module 3, and each is a deliberate stop rather than an oversight:

- **The plan file is not uploaded.** `DrawingRevision` carries `storageKey`, `size`, `checksum`
  and `mimeType`, and `RevisionDialog` fills all four — the checksum is a **real SHA-256** computed
  in the browser from the chosen file, because it is how somebody later verifies that a file they
  were sent is the file that was issued. What is missing is the bytes: there is no upload route for
  plans, and inventing one that wrote into `MEDIA_ROOT` would publish the firm's drawings to anyone
  who can guess a URL — the allowlist in `main.ts` is a *positive* match for exactly that reason.
  The dialog says so rather than looking like an upload and storing nothing. Documents (module 4)
  brings the storage seam, and `storageKey` is already the shape it will use.
- **Geschoss, Anlage und Raum are not anchors yet.** `Floor`, `Room` and `BuildingSystem` are Wave 2
  module 6, so `docs/data-model.md` §3.13's four named queries are **two working and two waiting** —
  *alle Lüftungspläne* and *alles zu diesem Gebäude* work; *jeder Plan, auf dem Raum 2.14 vorkommt*
  and the expensive one, *was muss neu ausgegeben werden wenn OG2 sich ändert*, do not.
  `drawings.list.test.ts` asserts those filter keys are **refused** rather than silently matching
  nothing, because an empty list reads as "there are none".
- **Nothing is sent, again.** A Planversand records that plans went out; no e-mail leaves the
  building, the same stop `minutesSentAt` makes one module earlier. The rail icon is a sheet with an
  arrow rather than an envelope for that reason.
- **The Planversand dialog fetches a detail per selected plan.** A list row carries
  `currentRevision` as a *letter*, not a revision id, so ticking a plan fetches its detail to find
  the newest revision. One request per plan somebody actually selects, rather than a join on every
  row of the register — and the reason the dialog asks for a page of 100 instead of paginating.
- **There is no `Contact`, so a recipient is free text.** `TransmittalRecipient` takes an
  `employeeId` *or* a typed name, firm and e-mail — the same compromise `MeetingAttendee` makes, and
  it becomes a foreign key in Wave 3.

`README.md` → *Known limitations* carries the product-level list (no MFA flow, local-disk media,
placeholder legal pages, `CodeGate` is a display barrier and not security).

## Content rules

Copy is German, Swiss conventions: apostrophe thousands (`1'450`), true minus (`−38%`), `ss` not `ß`.
Derived figures stay derived — copy carries `{token}` placeholders resolved by `derive.ts`, and an
unknown token renders as itself rather than blanking a number on a live page.

Everything in the content is checkable against iem.ch. **If you add a number, add its source.** Do
not invent job titles for the team entries that have no published one — only the three
Geschäftsleitung members state a function.
