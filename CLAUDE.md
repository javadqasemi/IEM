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

Two further documents cover the **platform** rather than the business modules, and they are the
current ones — `docs/system-audit.md` below predates the foundation and its §0 premise is no
longer true:

| Document | |
| --- | --- |
| `docs/CURRENT_APPLICATION_AUDIT.md` | 19 September 2026. What is actually here now, counted from the source: routes, models, permissions, CMS coverage, testing, security posture, and the three stores of company data that had already drifted |
| `docs/ENTERPRISE_ROADMAP.md` | The remaining platform work as P0–P3, each with problem, impact, solution, dependencies and acceptance. Owns the *platform*; `docs/roadmap.md` still owns the business-module build order |
| `docs/COMPLETE_APPLICATION_AUDIT.md` | 23 September 2026. The product and security map: every route, nav item, role, form and table; the threat model and risk register; the proposed workspace navigation, role model and Edit Website blueprint. Awaiting review before the UX redesign starts |

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
| P0·1 | **Typed settings** — every setting declares a type and is validated on write; the one unclamped read is fixed |
| P1·1 | **Unternehmen** — `Organisation` + a real `Office`, and the website's `offices` derived from the table |
| P1·5 | **Security policy** — four kinds of security number, and only one of them is a setting. Clamped on read, so a policy can tighten an invariant and never loosen it |
| P2·9 | **Aktive Sitzungen** — no migration; a live session is one unrevoked `RefreshToken` row. Own sessions under `/auth/sessions` with no permission at all, somebody else's under `/users/:id/sessions` behind two new keys |
| P3·2 | **Zwei-Faktor-Authentisierung** — four tables, AES-256-GCM at rest, a challenge that issues nothing, ten single-use recovery codes, and a re-authentication window that is not MFA-specific. The brief that commissioned it calls it *P2.2*; the roadmap has always called it P3-2 |
| P2·2 | **Benachrichtigungen** — one platform, four tables, ten typed notifications, two channels, a bell, a centre, and the rule that **no business module sends an e-mail**. Nine domain events feed it and eight of them existed only on paper before it |
| P2·3 | **Publishing** — the three verbs the workflow was short. The transition table moved out of the service into `content.rules.ts` and is now asserted over all thirty-six pairs; `unpublish`, `schedule` and `cancelSchedule` take a **required** `expectedVersion`; `GET /content/queue` derives an effect per row; and a cron that recorded a failed publish as a successful job was fixed |
| P2·4 | **E-Mail-Betrieb** — a `MailProvider` seam with SMTP as its one implementation, nine sanitized failure categories, a connection test beside the test send, a template catalogue with previews, and secrets encrypted at rest under a key of their own. No migration, no new permission, and the first route to enforce `job.retry` |
| P2·5 | **Sicherung und Wiederherstellung** — three tables, `pg_dump`/`tar`/manifest with SHA-256, verification that parses the artifacts, retention that can never leave zero recovery points, and a **recovery drill** that restores into an isolated database and reads the records back. One new permission; `system.backup` finally enforced |
| P2·6 | **System Control Center und Job Operations** — no migration and no new permission. One health vocabulary where there were four, a capability model that decides what an operator may do with a job, eight active diagnostics, and a build identity stamped at build time. `job.read` and `job.cancel` finally enforced |
| P0·SEC | **Sicherheits-Härtung nach dem Gesamtaudit** — `docs/COMPLETE_APPLICATION_AUDIT.md` Part 34. A privilege ceiling (nobody grants more than they hold), a restore that runs once, an installer that writes `TRUST_PROXY` and the two real keys and whose nginx headers reach the documents, scope that fails closed with reach checked on create, and settings authority split three ways. One new permission, `settings.security`; no migration |

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

**Postgres is wherever `DATABASE_URL` says, and that is not necessarily 5432.** The
`docker run … -p 5432` line in `server/.env.example` is a suggestion, not a fact: read the
port out of `server/.env` before concluding the database is down, because a failed
connection on 5432 looks identical whether the service is stopped or listening elsewhere.
For ad-hoc SQL use `psql` rather than a throwaway Prisma script — this project is on
**Prisma 7**, where `new PrismaClient()` without a driver adapter throws immediately. Strip
the `?schema=public` off the URL (psql rejects it as an invalid URI parameter), and put the
statement in a file for `-f`: every table name is PascalCase and therefore needs double
quotes, which do not survive PowerShell's handling of `-c "…"`.

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
npm run e2e:p0         # the P0 matrix: privilege ceiling, restore, scope, settings authority
npm run deploy:test    # the installer's nginx config, statically; + live with NGINX_BIN set
npm run e2e:budgets    # the performance budgets, with the measurements printed
npm run e2e:versioning # the optimistic lock, including two writers racing
npm run e2e:publishing # the workflow end to end, asserted against the public document
npm run e2e:system     # the System Control Center, Job Operations and the diagnostics
npm run e2e:install    # once per machine: downloads the browser
npm run e2e:mail       # Email Operations, incl. a real SMTP transaction
npm run e2e:backup     # Backup and recovery, incl. the RECOVERY DRILL

# The development SMTP catcher. `e2e:mail` skips with a message without it.
npm run mail:catcher:install   # once per machine, into the gitignored var/tools/
npm run mail:catcher           # SMTP :1025, web UI and API on :8025
```

```bash
# One file, one test. Three toolchains, three spellings.
npx vitest run src/core/api/client.test.ts            # site + dashboard
npx vitest run src/core/api/client.test.ts -t "429"   # one case, by name
cd server && npx vitest run src/auth/sessions.rules.test.ts   # the API
npx playwright test sessions.spec.ts --project=desktop
npx playwright test sessions.spec.ts:123 --project=desktop   # one test, by line
```

**The API's single-test run is the one that needs `cd server`**, which is the
opposite of every other command here. `npm --prefix server exec -- vitest run
src/…` looks right and answers *"No test files found"*: the prefix chooses the
package but not the working directory, so the relative path and the root
config's `exclude: ["server/**"]` both resolve against the wrong place.

**Always pass `--project=desktop` to a single Playwright spec.** Without it the
spec runs at all three widths, which for anything in `RUN_ONCE` is both
meaningless and a way to spend the sign-in budget three times over.

**Two Playwright cautions that have each cost an hour.** Running specs
back-to-back as separate `npx playwright test` invocations exhausts
`/auth/login`: the budget in `fixtures.ts` is per *process*, so a second
invocation inside the same minute starts believing it has spent nothing and
meets real 429s. The symptom is a mass failure that looks like broken
permissions — wait a minute, or run the suite in one invocation. And a run
**wipes `test-results/` on start**, so copy a trace somewhere else before
re-running or the evidence for the failure you are investigating is gone.

**`e2e:security`, `e2e:budgets` and `mfa.spec.ts` need a seed that ordinary
development does not.** The first needs the role accounts (`SEED_TEST_USERS=true`
plus `SEED_TEST_PASSWORD`, both in `server/.env`) — six until `administrator` was
added for the `organisation.updateLegal` gate, and the seventh is what pushed
the sign-in total against its limit. The second is only meaningful with rows —
`SEED_LOAD_PROJECTS=500 npm run server:seed` creates them. Each **skips with a
message** rather than failing when its data is absent, because a red suite on a
machine that has not opted in is one people learn to ignore.

**The eighth account, `mfa@iem.test`, is used by two specs and is still not for
anybody else.** `notifications.spec.ts` shares it with `mfa.spec.ts`, and the sharing is
deliberate rather than convenient: the four security notifications are the only triggers in
the catalogue that are **fully reversible**, so producing one means changing a second
factor, and the account that exists for exactly that is the one to do it on. They run in
file order — `mfa` before `notifications` — and both clean up after themselves. Everything
in the paragraph below applies twice over.

**The eighth account, `mfa@iem.test`, exists for those two specs and must stay that
way.** `mfa.spec.ts` enables and disables a real second factor on a live
account, and MFA state is persistent and cross-cutting: doing that to
`gast@iem.test` breaks `sessions.spec.ts`, and doing it to the administrator
breaks *everything*, because that is the account the shared browser context
uses. It surfaces two files later as "Hauptnavigation not found" over a
screenshot of the login form — the misdiagnosis recorded three times above,
by a fourth route. The seed clears every test account's MFA rows on each run,
so re-seeding is what fixes a spec interrupted halfway.

**The API also needs `MFA_ENCRYPTION_KEY` in `server/.env`** before any of the
second factor works; without it the application starts normally and every MFA
route answers 503 naming the variable. Generate one with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
It is deliberately **not** derived from `JWT_ACCESS_SECRET`: rotating that one
is the documented way to sign everybody out, and if the two were linked, doing
the ordinary thing would silently destroy every enrolled authenticator.

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

  **It has happened a third time, by a route that running once does not
  cover.** `security.spec.ts` was already `API_ONLY`, so it signs in once per
  *run* — but adding a seventh role account to its matrix added one attempt to
  a total already sitting close to ten, and the failure surfaced in a
  `budgets.spec.ts` warm-up as `element(s) not found` over a screenshot of the
  login page. Same misdiagnosis, third way in. `apiToken` had ridden out a 429
  since the first occurrence; the *browser* `workerContext` had not, and now
  does. **If the suite ever pauses 61 seconds at startup, that is this, and it
  is working.** The lesson is narrower again: it is the total sign-ins per
  minute that is budgeted, so adding an *account* costs as much as adding a
  width.

  And the ride-out needs room to finish. The global `timeout` in
  `playwright.config.ts` is **90 s**, not the 45 s it was, because a
  45-second budget cannot contain a 61-second wait: a spec calling `apiAs` in
  a `beforeAll` reported *"beforeAll hook timeout of 45000ms exceeded"* while
  it was mid-sleep, which reads as a hung fixture and is a remedy being cut
  off. A per-spec timeout would have fixed the one spec that happened to
  fail; the throttle can strike any of them.

  **`mfa.spec.ts` is the exception that raises its own**, and it waits on
  *two* real controls at once: the sign-in throttle paces it, and the
  **replay guard** refuses a TOTP step at or below the one already accepted,
  so any test that authenticates twice with the same credential waits out a
  thirty-second step. The file sets three minutes and the full-journey test
  five. It runs about **4.7 minutes** and is the slowest spec in the suite by
  a distance.

  **And a timeout there was a symptom twice, not a budget.** The journey hit
  a six-minute ceiling and both times it was read as "this is legitimately
  slow" and answered with a bigger number. It was not slow: `page.goto` to a
  URL differing only in its **hash** is a *same-document* navigation, so the
  SPA never rebooted after the cookies were cleared, the login form never
  appeared, and a `fill` waited for it until the clock ran out. The
  screenshot showed a perfectly healthy dashboard, which is the tell. The
  test was passing through the part it exists to cover without executing it,
  and the fix — `page.reload()` in `signInAs` — took it from six minutes
  timing out to **sixty seconds passing**. Raising a timeout is what stops
  you finding the cause.

  **The MFA verification routes are a *separate* bucket from `/auth/login`.**
  Nest keys a throttle by class, handler and tracker, so
  `/auth/mfa/challenge`, `/auth/mfa/enroll/verify` and `/auth/reauthenticate`
  each get their own ten a minute. `spendMfa()` in `fixtures.ts` paces all
  three together and `login-budget.spec.ts` fails the build if a file reaches
  one of them without calling it — because a spec that paces its sign-ins
  perfectly and forgets this one meets a 429 that surfaces as *"the code is
  wrong"* on a screen showing a code that was right.
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
  number to watch — the warnings stood at 21 when this note was written, 35 at Wave 2 module 2,
  34 at P2-9 and **36 as of P3-2** (two more `set-state-in-effect`, both the reset-on-open that
  `ConfirmDialog` in the same folder already uses), because the count grows and shrinks with the dashboard rather than
  with any decision. Treat a rise in *errors* as a regression and a move in warnings as
  arithmetic; the figure is worth re-reading from `npm run lint` rather than from this line,
  which is a snapshot and will be stale again.
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

**That rule has teeth now, and applying it moved eight call sites.** Notifications (P2-2) needed
domain signals for MFA and for the content workflow, and both were writing audit rows by hand — MFA
out of consistency with the rest of `auth/` (which predates F8), content because the whole module
does. Eight `audit.record` calls became `events.publish`, and **the log is byte-identical**:
`auditActionFor` derives `content.submitted` from `ContentSubmitted` and `mfa.enabled` from
`MfaEnabled`, which are the strings the hand-written calls used.
`notifications.agreement.test.ts` pins all ten derivations to literals, because the day one of them
drifts is the day three months of log splits across two spellings of one fact.

Two consequences worth knowing before touching those services. **The failures stayed direct** —
`auth.mfa_failed` is an attempt, not a change. And **a method that publishes needs no `ctx`**:
`AuditListener` reads the IP and the user agent from `AsyncLocalStorage`, so five methods and three
controller handlers lost parameters that nothing read. A `ctx` on a method that only publishes is a
sign the migration was done halfway.

**No business module sends an e-mail.** A module announces a fact; `core/notifications` decides who
cares and how they are told. `MailService` keeps only the messages whose recipient is **not a user
of the dashboard** — an applicant's confirmation, an invitation, a password reset — because those
have no inbox, no preferences and nothing to mark read, so there is nothing for the platform to
govern. `sendApplicationNotice` and `sendReviewRequest` are gone; the second had been written and
called by nobody, which is what a per-feature mail method looks like once nobody is watching.

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

`publishEffect` in `content.rules.ts` is the per-entry form of the same question, and it is what
makes the invisible row visible: `PUBLISH` / `REPUBLISH` / `WITHDRAW` / `NONE`, derived from the
status and whether a published copy exists. A deleted entry that is still live reads `DRAFT` in
the status column and `WITHDRAW` here, which is the one an operator about to publish needs.

**Unpublishing is not a status change, and the obvious implementation is the worst one.** The
public site serves a **snapshot**, so an entry is live if it carries `publishedData`. Setting the
status to `DRAFT` without rebuilding the document leaves the entry reading as withdrawn in the
dashboard and **still visible to every visitor** — the exact failure this feature is bought to
prevent, arriving silently. `ContentService.unpublish` therefore clears the published copy and then
calls `publish()`, and `e2e/publishing.spec.ts` asserts against `GET /content/published` rather
than against the row.

It is also not `hidden`. Hiding is an editorial choice that survives a republish and toggles back;
unpublishing clears the published copy, so the entry returns to `DRAFT` and has to go through
review again. "Not showing this at the moment" and "this should not be on the site" are different
decisions, and the log has to be able to tell them apart.

**A schedule must be cleared *after* the publish, not before.** `doPublishScheduled` used to clear
`scheduledAt` first, for idempotency — and it achieved it by making the retry find nothing:
attempt 1 threw, attempt 2 saw an empty due set, returned `{ published: 0 }`, and the runner marked
the job **DONE**. A scheduled publish that failed was recorded as a job that succeeded, `JobFailed`
never fired because the job never reached `DEAD`, and the entries kept their approval with their
publication simply never having happened. Publishing twice is not the risk it looks like: the
publish is a snapshot build, so a second run over the same entries produces the same document.

**One denylist redacts everything that leaves the server.** `core/redaction/redact.ts` holds
`SECRET_KEYS` and `scrub`; `AuditService` used to own them privately and now imports them, because
P2-6 gave them a second reader — the Job Operations screen renders `Job.payload`, which is
arbitrary JSON written by whoever enqueued the job. The failure a second copy produces is quiet:
somebody adds a key to the audit list after an incident and the jobs screen goes on showing the
value that was just declared too dangerous to log. `scrubBounded` adds a **visible** size ceiling
on top — a payload silently cut in half is worse than none, because the reader believes they have
the whole thing.

**`NEVER_RETRYABLE` governs the queue, not only the button** (P0, SEC-2). It used to hide the
operator's Retry for `backup.restore` while the queue went on retrying it: the job was enqueued
with the default three attempts and `RestoreService.run` rethrew, so a failed in-place restore ran
twice more on its own, each time snapshotting the half-restored database as its pre-restore
backup. Now `JobService` reads the list in four places — `enqueue` forces one attempt, `fail`
goes straight to `DEAD`, `retry` refuses in its `where`, `reclaimStale` ends a stale one as `DEAD`
— and `RestoreService.run` executes only from `REQUESTED`. A job that replaces data joins the list
rather than getting a `maxAttempts` at its call site.

**`JobStatus.FAILED` is written by nothing, and a filter for it would lie.** `JobService.fail`
writes `DEAD` when the attempts are exhausted and `QUEUED` when they are not, so no row ever
sits in `FAILED` — while `JobService`'s own docstring calls it "the transient state between a
failed attempt and the retry", which describes a design the implementation did not follow. The
enum value is left alone, because removing one is a migration and it is inert either way. What
must not happen is a chip labelled *Fehlgeschlagen* that returns an empty list for ever, which
an operator reads as "there are no failures". `UNREACHABLE_STATUSES` in `core/jobs/jobs.rules.ts`
records it and the jobs screen offers *Nur aufgegebene* instead.

**A job's `phase` is derived and its `capabilities` are computed server-side.** `QUEUED` with
attempts already spent is `RETRYING` — the same row, opposite news, and the database cannot tell
them apart. `retryable`/`cancellable` travel with every row **with a refusal sentence each**,
because a dashboard that worked the rules out itself would hold a copy of `NEVER_RETRYABLE` that
is one entry behind on the day it matters. `backup.restore` is refused in every status: a restore
that died half way did not leave the database untouched, so "try again" is not the recovery path.

**`ContentPublishFailed` is the one event in the codebase flushed by hand.** `EventBus.publish`
queues onto the ambient context and `JobRunner` calls `discard()` on a failed job — correctly,
because an event describing work that did not finish is a lie. This event describes the *failure*,
so it is true precisely because the job failed, and leaving it in the queue would throw away the
only thing that tells anybody. All three attempts raise it under the job row's own correlation id,
so `Notification`'s `@@unique([eventKey, userId])` collapses them into one row per recipient — the
index doing the de-duplication a flag on the class would do worse.

**Comparing anything read back from Postgres `jsonb` needs canonicalisation.** `jsonb` does not
preserve key order, so a plain `JSON.stringify` comparison against a freshly built object reports
almost every object as changed. `snapshot.builder.ts` sorts keys recursively before comparing; reuse
that rather than writing a second comparison.

**There is one health vocabulary, and it used to be four.** `healthy | warning | critical |
not_configured | unknown` was written out in `mail.status.service.ts`,
`core/backup/backup.status.service.ts`, `features/mail/types.ts` and `features/backup/types.ts`.
All four agreed — which is what made it worth fixing, because they agreed by coincidence and
nothing compared them. It is now `core/health/health.ts` on the server and `entities/system` on
the client; the *labels and tones* are shared and the *explanatory sentence* stays per domain,
because "Es gibt fehlgeschlagene Zustellungen" is about mail and would be wrong under a backup
card. `unknown` is the value that earns the union: configured and never tested, drawn neutral
rather than green, because a green light meaning "the fields are filled in" teaches an operator
that green means nothing.

**The overall verdict is a maximum plus reasons, never a score.** `overallHealth` returns the
worst subsystem and the sentences behind it. A percentage — *Systemzustand: 93 %* — cannot be
acted on without expanding it back into the list it was computed from, it moves when nothing
anybody cares about has changed, and 93 % reads as "fine" on the morning the backups stopped.
`service.test.ts` asserts no `%` ever appears in the banner.

**A setting is a typed declaration, not a JSON blob under a string key.** `SettingDef` in
`core/settings/settings.service.ts` carries a `type`, `min`/`max`, `options` and `unit`, and
`settings.rules.ts` validates every write against it. Before that nothing checked the shape
anywhere — the controller's comment *claimed* the service did — and one unchecked value was a
deletion deadline: `applications.retentionDays` fed `retainUntil`, so a `0` made the 03:00 purge
delete every applicant dossier received that day and a non-numeric value produced
`new Date(NaN)`, which Prisma rejects, taking the public application form down with a 500. Both
were reachable from the settings form by a mistype. **The dashboard renders from the same
declaration**, so a control is no longer inferred from whatever the value happens to be. Adding a
setting without a type fails `settings.rules.test.ts`; adding an unbounded `number` fails it too.

**Use `settings.number(key, fallback, min, max)`, never `value<number>()`, for anything
arithmetic.** Validation stops a bad value being *stored*; the clamp stops one already in the
table — from a release before the type existed, from a migration, or typed straight into the
database — being *read*.

**A `secret: true` setting is encrypted at rest and readable by nothing that answers an
HTTP request.** `secret` used to mean only "masked unless the caller holds
`settings.secrets`" — a mask over a column holding the SMTP password in plaintext, beside a
permission that handed the plaintext back. Both halves were wrong. Now
`SettingsService.values()` decrypts for the *internal* consumer that needs the value
(`MailService` and nothing else), `list()` emits a fixed mask plus `configured`, and
`settings.secrets` means **manage** — replace and remove. The key was not renamed because a
permission key is what roles are granted; the description in `resources.ts` is what changed.

**A blank write to a secret means *keep*, and there is no spelling of "delete".** A settings
form posts every field it rendered, and a password field renders empty once it is no longer
readable — so "empty clears it" destroys a working credential on the next save of an
unrelated field, and the operator's first clue is mail not arriving. Removal is
`DELETE /settings/secrets/:key`, behind `settings.secrets` and a confirmation.
`classifySecretWrite` is the one reader, and it treats `""`, whitespace and the mask alike.

**Every setting declares the authority a *change* needs, and `settings.update` alone is only
ordinary configuration** (P0, SEC-5). `authority` sits beside `type` on `SettingDef`:
`security` (session lifetime, lockout, password length, four-eyes, auto-publish, applicant
retention) needs `settings.security`; `credential` (SMTP host, port, user, TLS) and `secret` (the
password) need `settings.secrets`. Until P0 `settings.secrets` guarded only *removal* —
`PATCH /settings` sealed any secret under plain `settings.update`, and the same key could point
the transport at a host that receives the stored password and every reset link, or switch off
four-eyes for an Administrator that also holds `content.approve`. **Only a changed value is
judged**, because a form posts every field it rendered and an untouched SMTP host must not stop
somebody saving the sender name. The list says per row whether the reader may change it
(`canEdit`), and the form renders the rest read-only with the reason as visible text. A new
security-relevant setting without an `authority` fails `settings.rules.test.ts`, which asserts
every `DANGEROUS_SETTINGS` key is non-ordinary.

**`APP_SECRETS_ENCRYPTION_KEY` is a second key, not a second cipher.** One AES-256-GCM
implementation (`KeyedCipher`), two purposes: `MFA_ENCRYPTION_KEY` for second factors, this
for everything else the application stores and must read back. Separate because the recovery
stories differ — losing this one costs a password somebody retypes, losing the other
de-enrols every employee — and sharing would tie those together, so rotating after an
integration credential leaked would sign the firm out. Same generator as the MFA key.

**Encrypted secrets with no key to read them are reported, never silently empty.**
`SettingsService.onModuleInit` migrates plaintext secrets, then calls `warnIfUnreadable`.
Without the second half the application boots perfectly, the settings page reports the SMTP
password as configured — because a row holding an envelope *is* configured — and mail stops
arriving with the cause several layers from the symptom. `MailStatusService` surfaces the
same fact as `secretsReadable: false`.

**A backup is `SUCCESS` only after it has been *read back*, and that is still not
recoverability.** Three claims, kept apart because collapsing any pair is how a backup
system becomes a folder of files nobody has opened: *written* (the job finished),
*verified* (`BackupRun.verification` — checksums re-match and `pg_restore --list` /
`tar -tzf` parse it), and *recoverable* (a **drill** restored it into
`<database>_restore_drill` and read back the migration state, a Super Admin, the
organisation, the settings and the content). `pg_restore` exiting 0 proves none of the
third: it reports ownership notices as errors and restores partially without complaint in
some failure modes. `refuseRestore` refuses an unverified backup outright — restoring from
one means discovering it was corrupt *after* replacing the database it was meant to replace.

**Retention may never leave zero recovery points, and `keep: 0` does not mean "delete
everything".** `planRetention` spares four kinds whatever the counts say: a protected run,
anything still running, every `PRE_RESTORE` backup, and **the last verified backup of each
type**. It is also the *same function* the preview calls — a preview computed differently
from the deletion it previews is a preview that lies exactly when somebody is relying on it.

**The write gate during a restore is a process flag, not `site.maintenanceMode`.** A flag
stored in the database cannot govern an operation that is *replacing that database*:
`pg_restore --clean` drops the `Setting` table partway through, so a guard reading it would
find the row missing, the table missing, or — worst — the **restored** value.
`MaintenanceService` is in-memory and `MaintenanceGuard` keys on the HTTP verb, so a new
mutating route inherits the protection without anybody remembering it. The cost is stated
rather than discovered: **it governs one process**, so a multi-instance deployment must stop
the others first.

**A backup download is a `POST` with the re-authentication window in its body** (P0, SEC-2).
`POST /backups/:id/artifacts/:kind/download` — it was a `GET` behind `system.restore` alone,
which made the route that hands over the whole database and every CV the one sensitive route
without a password prompt. The kind is validated first (a traversal probe stays a 400), the
window before the lookup (so an unknown id is not answered to somebody who has not proved who
they are), and the response is 200 rather than the 201 a `POST` defaults to.

**`PGPASSWORD` in the child's environment, never in `argv`.** An argument is visible in
`ps`, in a crash dump, and — the one that actually happens — in libpq's own error message,
which it builds by echoing the connection it attempted. `spawn` with an argument array and
`shell: false`; `redactToolOutput` is the second line of defence before anything reaches a
log, and `classifyBackupError` is what makes sure the *API* never sees the raw text at all.

**In the nginx configuration, every block that says `add_header` also says `include`** (P0,
SEC-3). nginx inherits `add_header` from the enclosing block only when the inner block declares
none of its own, and `/index.html`, `/admin.html` and `/stelle.html` each had a
`Cache-Control` line — so the documents themselves went out with no CSP, no frame protection and
no nosniff while the server block read as though they had all of them. The headers are three
snippets written by `nginx::write_header_snippets` (`iem-headers-base`, `-site`, `-media`), HSTS
is a fourth that `ssl.sh` writes, and `npm run deploy:test` renders the installer's own functions
and fails a block that breaks the rule. With `NGINX_BIN` set it also serves the result and reads
the real headers — nginx for Windows cannot open 8.3 short paths, so point `NGINX_WORK_DIR` at a
path with no spaces, and `BASH` at Git's `usr/bin/sh.exe` if `bash` is WSL's stub.

**The installer writes `TRUST_PROXY=loopback`, both encryption keys and `BACKUP_ROOT`, and
`main.ts` binds `HOST`** (P0, SEC-3). Without the first, every request behind nginx came from
127.0.0.1 — one throttle bucket for the internet, one IP in the audit log. The installer used to
generate `ENCRYPTION_KEY` and `SESSION_SECRET`, which nothing reads, instead of the two keys that
are read. **Neither key is ever rotated by a re-run**: an `overrides.env` value is adopted, then
`/etc/iem/credentials`, and only then is one generated — a new MFA key over an old database
de-enrols everybody. `/media/` is `^~` with the same positive allowlist `main.ts` applies; as a
plain prefix it lost to the image regex and every upload was a 404.

**`smtp.provider.ts` is the only file allowed to import nodemailer**, and
`server/src/architecture.test.ts` asserts it. Before P2-4 the library was imported straight
into `MailService`, so its error shapes and option names became the vocabulary the
notification platform, the settings screen and the audit log all spoke — and a second
provider would then have meant translating it *into nodemailer's idiom*. `MailProvider` is
the seam; `MailSendResult` and `MailFailure` are the only things that cross it.

**A raw provider error goes to the server log and nowhere else.** `classifyMailError` maps
it onto nine categories, and the sanitized sentence is what reaches the browser,
`NotificationDelivery.detail` and the `MailTested` audit payload. This is not tidiness: a
failed `AUTH PLAIN` echoes a base64 blob containing the username **and the password**, and
before P2-4 that string went to all three. `mail.failure.test.ts` asserts no part of the
input reaches the output.

**`MailTested` sets both `payload` and `after`, and they are different fields.** `payload`
is what a listener receives; `after` is what `AuditListener` writes into the row — and the
audit row is the storage `MailStatusService` reads back for "last connection test" and "last
test send". Setting only `payload` produced two `mail.tested` rows with an empty `after` and
a status panel that said the probes had never run.

**The two mail probes are their own throttle buckets, and `spendMailProbe` paces them.**
`/settings/mail/verify` and `/settings/mail/test` allow three a minute each. `ThrottlerGuard`
runs *before* `PermissionsGuard`, so an unpaced permission test asserting 403 meets **429**
and never reaches the permission — which reads as a broken RBAC rule over a screenshot of a
correct one. That is the sign-in-budget mistake arriving by a fourth route.

**`e2e/mail.spec.ts` needs a real SMTP server and skips without one.** `npm run mail:catcher`
starts Mailpit (SMTP 1025, HTTP 8025); `npm run mail:catcher:install` fetches it once into the
gitignored `var/tools/`. The spec asserts against **Mailpit's own API**, because a resolved
nodemailer promise proves a library call returned rather than that an SMTP transaction
happened. It also rewrites `mail.smtpHost` for the duration and restores it in `afterAll` —
leaving it set would make `notifications.spec.ts` attempt real sends.

**The firm is an entity, and `Office` is the website's Standorte.** `Organisation` is a singleton
whose id is the literal `org`, upserted on first read so no caller needs a null branch. The
published document's `offices` key is **injected into `buildSnapshot`** from the `Office` table
rather than written by a content type — so the header telephone number, the contact band, the
Standorte section and the `{telefonThun}` / `{standorte}` tokens all follow one source, and
`phoneHref` is derived by `telHref()` instead of being a second field an editor retypes by hand.
The `offices` content type is **retired**; the migration deletes its rows and the seed reports
any that survive. Before this there were three stores of the firm's address and two of them
already disagreed — the seed put Thun at Bierigutstrasse 6 while the live site said
Uttigenstrasse 49.

**`core/organisation` holds the service; `organisation/` holds the routes.** The same split
`settings/` is named for, and forced by the same rule: `MailService` reads the company name and
`ContentService` reads the offices, so the service has two callers outside its own feature and
belongs in `core/` — *before* the second caller appears, not after. The class names differ on
purpose (`OrganisationModule` in core, `OrganisationRoutesModule` in the feature), because Nest
would happily accept both in one import list and construct two different things.

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

**A form that stays open after saving is a shape this dashboard did not have, and three
pieces of shared infrastructure were wrong for it.** Every form before the settings
workspace was a dialog that closes on save, so all three were invisible:

- **`useForm`'s baseline is state, not a ref.** `dirty` is a `useMemo` over `[values]` and
  a ref is invisible to a dependency array, so moving the baseline on a successful save did
  not recompute it — the save bar went on saying *"Ungespeicherte Änderungen"* over a
  written record and the unsaved-changes guard fired on a clean screen. The hook's own
  comment already claimed this worked.
- **`invalidate()` takes the invalidated key's data off screen.** It sets `updatedAt = 0`,
  and `useQuery` gates `data` on `updatedAt > 0`, so `data` reads `null` between the
  invalidate and the refetch landing — and a screen that renders a skeleton when there is
  no data **unmounts**, losing everything the component held. `useQuery`'s comment promises
  the opposite (*"a refetch over data already on screen is not a loading state"*) and that
  promise holds for every key except the one being invalidated. Where a mutation's response
  *is* the new state, `prime` it back in the same tick; otherwise invalidate narrowly.
- **`SaveBar` carries no `onClick`.** `type="submit"` plus a handler is two submissions
  from one click, and the second `PATCH` 409s against the first — a save that worked
  reporting a conflict with itself. It must sit inside a `<Form>`; that is also what keeps
  Enter working, since a form with no submit button does not submit implicitly once it has
  more than one field.

**A notification's channels are resolved in one order and clamped on read.**
`security invariant → organisation policy → user preference`, the shape
`security.policy.ts` gives its numbers. Four types are `mandatory` and their **in-app copy
cannot be switched off by the firm or by the person** — a notification you can be talked
out of receiving is not a security control, it is a courtesy an attacker turns off first.
The API refuses such a write *and* `resolveChannels` re-applies the rule on read, which is
what covers a row that arrived from a migration or a hand-edit. Their **e-mail** copy stays
configurable, deliberately: refusing that is how somebody filters the sender, which would
take the security messages with it.

**The actor is removed from the recipients — except where the notification is about their
own account.** `suppressesActor` is false only for the `subject` strategy, and the
exception is the whole security argument: if somebody with your session disables your
second factor, they *are* you as far as the server can tell, so suppressing the message
because "the actor already knows" would suppress precisely the case it exists for.

**A skipped delivery is not a failed one.** `SKIPPED` records a deliberate non-send with a
reason — a preference, a rule, or no SMTP server configured. Collapsing it into `FAILED`
would put a wall of amber in front of an operator on every development machine, which is
how somebody learns to ignore the colour that matters. It is also why the stub case does
**not** throw: a retried send that cannot succeed fills the queue.

**`JobFailed` must never be able to notify about the notification channel.**
`SELF_INFLICTED` in `notifications.listener.ts` is one `Set` with one entry, and it is what
stops a mail outage becoming an unbounded queue of mail about mail: a dying
`notification.deliver` job raises no notification. The failure is still a `DEAD` row, an
audit entry and a log line — the three places an operator looks — and the one channel that
cannot report its own failure is the channel that is broken.

**`Notification` is per recipient, and idempotency is an index rather than a check.**
`@@unique([eventKey, userId])`, with the key built from the event's name, entity and
**correlation id** — so one fact reaching three people is three rows, the same fact
reaching one person twice is one row, and two *genuine* occurrences in two requests are two
rows. That last part is why the correlation id is in the key: without it, submitting the
same entry twice would be swallowed for ever, which is a worse failure than a duplicate
because it is silent and permanent. Nothing reads the key to decide whether to write; the
insert is attempted and `P2002` is the answer.

**The notification centre must never take its own data off screen** — the same `invalidate`
trap as `MfaCard`, and worth repeating because the shape recurs: every mutation in
`useNotifications.ts` primes the known outcome, and the unread count in particular is
primed rather than invalidated so the badge does not vanish and come back under the cursor
that just clicked it.

**A second factor issues nothing until it has been shown, and the type is what
enforces that.** `AuthService.login` returns a discriminated union —
`{ kind: "session", … }` or `{ kind: "mfa", challenge }` — rather than a
`LoginResult` with an optional `challenge` beside an optional `accessToken`.
The two outcomes have nothing in common: one carries a session and the other
deliberately carries none, no access token and **no `Set-Cookie`**. With an
optional-field shape a controller that forgot the branch would set a refresh
cookie on the second, and a second factor that can be skipped by forgetting an
`if` is not a second factor. The client mirrors it for the same reason.
`e2e/mfa.spec.ts` asserts the absence of the header, which is the only place
that can be checked.

**The decision "does this account need a factor" reads the credential, never
`User.mfaEnabled`.** The column is a denormalisation kept so the user list can
show a boolean without a join; `MfaService.requiresFactor` counts `VERIFIED`
rows. A `true` in the column with nothing behind it would lock somebody out of
their own account, and a `false` would silently skip the factor. Only
`MfaService` writes the column, and always in the same transaction as the
credential it mirrors — except in `UsersService.remove`, which is a *soft*
delete, so `onDelete: Cascade` does not fire and the credential, the recovery
codes and the column are cleared by hand.

**A `PENDING` credential is not a second factor.** Enrolment writes a row
before the first code is checked, so somebody who opens the dialog, looks at
the QR code and closes the tab must still sign in with their password alone.
`requiresFactor` counts `VERIFIED` only. Enabling MFA because a QR code was
drawn would lock out everyone who got as far as looking at it.

**Both single-use guarantees in MFA are one statement, for the reason
`updateIfUnchanged` is.** A recovery code is spent by
`updateMany({ where: { userId, tokenHash, consumedAt: null } })` and the
returned count is the answer; a TOTP step is claimed by an `updateMany` whose
`where` names the step being beaten. Read-then-write looks equivalent and is
not — two requests both read `null`, both proceed, and one code authenticates
twice. Postgres's row lock is what decides. `userId` is in the recovery
`where` as well as the hash: the hash is unique across the whole table, so
without it another account's code would be **consumed** while the sign-in
still failed, leaving them one code poorer for no visible reason.

**The MFA card must never take its own data off screen, and this is the
`invalidate` trap arriving somewhere expensive.** `MfaCard` renders a skeleton
while it has no status, and the enrolment wizard is its *child* — so
`invalidate(["mfa"])` after finishing an enrolment unmounts the dialog holding
**ten recovery codes that cannot be fetched again**. Every mutation in
`features/mfa/hooks/useMfa.ts` primes the known outcome instead; the server
has just said what it did, so there is nothing to ask. Found by
`e2e/mfa.spec.ts`, not by review.

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

**A colour pair that is only *sometimes* on screen belongs in `theme.contrast.test.ts`, because
the browser suite cannot be relied on to meet it.** The notification bell's unread badge was
`text-inverse` on `bg-brand-bronze`, which is `#75683C` in the light theme and **`#CDB37A` in
the dark one** — in dark mode the gold family is a *foreground* colour for dark surfaces, so
white on it measures **2.03:1** against the 4.5:1 that 10px text needs. It shipped with P2-2
and no axe run ever saw it, because the badge renders only when the count is non-zero and no
spec had produced an unread notification. P2-4's acceptance test raises real ones, so it
appeared — in `projects.spec.ts`, two specs away from anything to do with mail, as a contrast
failure on a selector (`.-right-0\.5`) that names no component. The badge is `brand-navy` now,
the pairing the primary button already uses, and the **pair is asserted in the unit suite** so
the next person to change it is told in seconds rather than twenty minutes into a browser run.

**`Pair` renders `<dt>`/`<dd>`, so its container must be a `<dl>`.** A grid of label/value
rows is the shape that invites a `<div className="grid">`, and axe's `dlitem` rule is
*serious*. Two of the three blocks on the mail status card were copied from the first and
kept its classes while losing its element.

**`Badge` tints itself against the *card*, so a `Badge` inside a `bg-surface-2` pill is a
different colour pair than the one that was checked.** `theme.contrast.test.ts` says so in its
own comment, and the mail status card's count pills were the first place it mattered: the same
`disc-energy` badge that clears AA on a card fell below it on the raised step.

**A scrollable region needs keyboard access, and axe only says so when the region has nothing
focusable in it.** `DataTable`'s pane is `overflow-x-auto`, which for a table wider than the
viewport is a region a mouse can scroll and a keyboard cannot reach — WCAG 2.1.1, and axe's
`scrollable-region-focusable` at *serious*. It sat there for the whole dashboard's life because
the rule fires only when the region **both** overflows **and** contains no focusable element, and
nearly every list here has a link or a button in its rows, which lets the keyboard in by accident.
The Zustellprotokoll is six columns of plain text with no control in any row, so it was the first
table to meet both conditions — at tablet and phone widths only, which is why three widths is not
three times the same run. The fix is in the shared component and is **measured**: a `ResizeObserver`
watches the pane and the table inside it, and `tabIndex`/`role="region"`/`aria-label` appear only
while `scrollWidth > clientWidth`. Unconditional `tabIndex={0}` would have been one line and would
have put a tab stop in front of every list in the dashboard, most of which have nothing to scroll to.

**A breadcrumb trail may repeat a word, so `key={item.label}` is a bug waiting for the second
two-segment route.** The last crumb's label comes from the screen through `usePageTitle` and the
middle one from the route's `parent`, so until the screen has mounted the two are the *same
string* — a transient duplicate on every `/x/y` route, made permanent on one where the child
publishes no title of its own. React answers with *"Encountered two children with the same key"*,
which is a console **error**, which `screens.spec.ts` fails the run over — so the symptom is six
red screen tests naming no screen. `Breadcrumb` keys by index now, which is right because the
list is positional and rebuilt from the route on every navigation. The other half was real too:
`/benachrichtigungen/einstellungen` was labelled "Benachrichtigungen" under a parent of the same
name, and a trail that says one word twice is worth fixing whatever React thinks of it.

**A duplicate `name` in `SCREENS` is not a harmless copy-paste.** Screenshots are filed by name, so
the second entry overwrites the first one's image; `a11y.spec.ts` keys its report by name, so one
screen's violations come back **twice under one id** and read as two separate faults. P2-3 added a
rebuilt section beside the stale entry it was meant to replace rather than over it, and the doubled
axe report is what sent the first hour looking for a second scroll container that did not exist.
`screens.spec.ts` now asserts the list has no duplicate name before it navigates anywhere.

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

**Two tabs restoring a session is not a stolen token.** Refresh tokens rotate on
every use and a rotated one presented again revokes the whole family — correct, and
the only defence against a stolen cookie. But the replacement travels back in a
`Set-Cookie`, so anything already in flight is still carrying the old value: every tab
refreshes when it boots, two opened together sent the same cookie twice, and the second
was read as a replay. **The answer to a replay is to revoke every session the account
has**, so opening a second tab signed the user out of every device they owned, including
the tab that had just succeeded. Nothing failed, nothing logged an error, and no client
could fix it alone because the second request was sent before the first reply existed.
Two halves, each argued on its own: `REFRESH_GRACE_MS` in `server/src/auth/auth.rules.ts`
serves a token rotated within thirty seconds and audits it as
`auth.refresh_concurrent`, and `withRefreshLock` in `core/api/client.ts` makes tabs take
turns through `navigator.locks` so the race mostly does not happen. Outside the window
the family still goes, and `e2e/auth.spec.ts` proves both directions against the running
API — the unit tests cannot, because one process has one cookie jar.

**A `false` from a refresh used to mean two different things.** "The server refused this
session" and "the request never arrived" were the same value, so a restart, a laptop
changing network or a 502 from a proxy ended a session nobody had asked about — and
ended it expensively, because the access token lives in memory and cannot come back
without a password. `RefreshOutcome` is three-valued (`renewed`/`rejected`/`offline`)
and only `rejected` signs anybody out; `App.tsx` renders a *"Server antwortet nicht"*
screen with a retry rather than a login form, because a login form is the one screen
that cannot help when the API is unreachable.

**A rate-limited refresh is not a refused session, and that was the fourth side of the
same mistake.** `RefreshOutcome` is three-valued so that "the server refused this session"
and "we could not ask" stop sharing a value; a 5xx and a thrown `fetch` were both moved to
`offline` when that was fixed. **A 429 was not**, and it is the one case where the server
does reply — so `if (!res.ok) return "rejected"` swallowed it and signed people out.
`ThrottlerGuard` runs *before* the controller, so a throttled refresh never reaches
`AuthService`: the cookie is never examined, nothing is revoked and **no audit row is
written**. That absence is the fingerprint — a session that ended with a live, unrevoked
token still in the table and nothing in the log did not end on the server's say-so.
Reachable in production because `POST /auth/refresh` allows 60/min **per IP** and the firm
shares one office address. The e2e suite reaches it reliably for a different reason: every
`page.goto` reboots the SPA and every boot refreshes, which measured 16.3/minute average
and **62 at peak**. It surfaced twice as `Hauptnavigation not found` over a screenshot of
the login form, in two *different* specs, which is why it read as an unrelated flake both
times. The suite is paced by `spendRefresh` in `e2e/fixtures.ts`; the limit was not raised.

**An expired lockout used to keep its count.** `failedLogins` was cleared only by a
successful sign-in, so an account locked once came back holding five: the first mistype
after the fifteen minutes took it to six, six is still over the threshold, and it locked
again. For ever. It reads as an account that locks at random and stays locked, and it is
`afterFailedLogin` in `auth.rules.ts` that makes five attempts mean five attempts every
time rather than only the first time.

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
has it. `projects.scope.ts` builds the predicate and the repository **requires** it. Filtering
after the fetch would give a page of eleven rows out of twenty-five, a total that counts rows nobody
can open, and a leak in any query that forgot the post-filter.

**A scope is a `Scope<W>` value with no default, and "every row" has to be asked for by name**
(P0, SEC-4). This paragraph used to say the repository "defaults to the narrow case, so a query
that forgets it returns the caller's own projects". It was false: thirty-two signatures defaulted
`scope = {}`, and `{}` in a `where` is every row — `GET /drawings/:id/versions` had forgotten it
and served any plan's history to anyone with `drawing.read`. `core/scope/scope.ts` now offers
`restrictedTo(where)`, `nothing()` and `unrestricted(because)`, the last with a sentence at the
call site (`"Super Admin"`, `"project.readAll"`, `"re-read of the row this transaction just
wrote"`). `server/src/architecture.test.ts` fails a repository whose scope is optional, defaulted
or a raw `WhereInput`, and a feature scope file that returns `{}` itself. Grep `unrestricted(` to
list every place that sees the whole firm.

**Reach is checked on create, and a hidden project answers like a missing one.** `POST /tasks`,
`/meetings`, `/decisions`, `/drawings`, `/transmittals` and moving a task ask
`core/scope/project.scope.ts` whether the target project is within reach *before* checking that
it exists, so both are one 404, *"Projekt nicht gefunden."* The project rule lives in `core/`
because the modules that hang off a project need it and may not import a sibling feature. A
protocol line, a supersede target, a predecessor and a parent task are likewise read through the
caller's scope.

**Membership ends on its end date.** `activeMembership` in `core/scope/membership.scope.ts` is the
one copy of "is on this project" — it was written out six times — and it excludes a
`ProjectMember` whose `to` has passed (inclusive of the day). `from` is deliberately not enforced:
somebody staffed ahead reads the project to prepare for it.

One asymmetry, because assuming otherwise is reasonable and wrong: the scope narrows **reads**.
Writes are guarded by `project.update` and friends, which are firm-wide — somebody with
`project.update` may edit any project they can *reach*, and reach is what the scope narrows. P0
left this as it is and pinned it in `projects.scope.test.ts`: narrowing writes to *managed*
projects is a business-model decision, not a bug fix.

**Nobody grants more than they hold** (P0, SEC-1). `rbac/privilege.rules.ts` is the one rule for
every change to somebody else's authority: a role or a permission may be handed out only by
somebody who holds all of it, `super_admin` only by a Super Admin, and an account that holds
anything the actor lacks may not be suspended, demoted, deleted, reset or signed out by them.
**Containment, not `Role.rank`** — rank is display order, and Geschäftsleitung (5) and
Administrator (10) each hold something the other does not, so a rank comparison would let one of
them escalate whichever way it pointed. Before this, any `user.assign` holder — the seeded
Administrator — could grant itself `super_admin`. Granting a privileged permission (the set is in
the same file) or touching Super Admin needs the `ReauthService` window; the server answers
`reauth_required` and the dashboard asks for the password and retries. `GET /roles` carries
`grantable` per role for the caller, computed by the same rule, so the picker offers only what the
write path accepts.

`permissions.agreement.test.ts` compares the catalogue against every guard in the tree, in both
directions, and counts a `permissions.has(...)` check inside a handler as enforcement — those are
the row- and field-level `◐` rules in `docs/permissions.md` §4, and `settings.secrets` is one.

**`notification.configure` and `notification.readDeliveries` are two keys, and reading one's
own inbox is neither.** Configuring which events notify whom is governance and is not folded
into `settings.update`; reading the delivery log is a disclosure about *people* rather than
about policy — who was told what and when — so it is separate again, the way `readSessions`
is separate from `revokeSessions`. A person's own notifications and preferences carry **no
key at all**, like `/auth/me`, `/auth/sessions` and `/auth/mfa`: the routes take the account
from the verified token, and a key every role had to hold for the bell to work would mean
nothing. `routes.test.ts` names the three open routes explicitly rather than allowing any,
because the next one added without thinking is the one that should have had a permission.

**`user.resetMfa` exists and `user.readMfa` deliberately does not.** Clearing somebody
else's second factor is an intervention — it removes a control from an account that is not
the caller's and ends every session it holds — so it gets a key, the same argument that
split `revokeSessions` from `readSessions`. *Reading* the flag does not: `mfaEnabled` is a
boolean already on the row `GET /users` returns, and it reveals nothing the way a session's
device, IP and working hours do, so a second key would be one whose removal changes nothing
a reader could notice. `administrator` **holds** the reset key, unlike `organisation.updateLegal`
below — clearing a lost authenticator is support work, it grants no access (the password is
still required), and putting it behind the single Super Admin account is how a locked-out
Geschäftsleitung ends up with somebody editing the database.

**A permission is not the only gate on the security-weakening routes.** Disabling one's own
factor, regenerating recovery codes and resetting somebody else's all additionally require a
**re-authentication window** — `POST /auth/reauthenticate` with the password and, if the
account has one, the second factor — presented in the request *body*. A key says who may; it
does not say that the person holding the session is the one asking, and an unlocked laptop at
a shared desk must not be a way to strip a colleague's second factor. `ReauthService` is
deliberately not MFA-specific: backup restore, API secrets and destructive administration are
its next callers. It is in the body rather than a header because a custom header would mean
widening `allowedHeaders` in `main.ts` for one feature.

**`organisation.updateLegal` and `office.delete` are withheld from `administrator` on purpose.**
Changing the main telephone number and changing the UID are both writes to one row and are not
the same authority: the second is what appears in the commercial register, on every invoice and
in the Impressum. The gate cannot be a route decorator — `@RequirePermissions` is AND and cannot
ask "only if the body touches these fields" — so it is a `permissions.has` inside
`OrganisationController.update`, which is the documented `◐` pattern and which
`permissions.agreement.test.ts` counts as enforcement. `canEditLegal` travels back with the
record so the form renders those fields read-only rather than letting somebody fill them in and
meet a 403 on save. The seed's `adm@iem.test` exists for this row alone: every other test account
holds both keys or neither, so the gate was unobservable until `administrator` was added.

**The dashboard's URLs are German, and a project's tab is one of them.**
`/projekte/:id/gewerke` — the tab lives in the route, not in `useState`, so it is a link somebody
sends a colleague and a place a reload returns to. `routes.tsx` therefore carries *two* detail
patterns pointing at one component (`/projekte/:id/:tab` before `/projekte/:id`), and the screen
reads the trailing segment itself; a route per tab would be fourteen entries differing in one
string, and adding a module would mean editing the table as well as `screens/tabs.ts`.

## Known gaps

Documented in the audit performed on this repo, still open:

- **A handful of permissions in the catalogue are enforced on no route**, and they are a list
  rather than a
  paragraph: `KNOWN_UNENFORCED` in `server/src/rbac/permissions.agreement.test.ts`, one line each
  with what it is waiting for. A new one fails the build, and so does an entry that has started
  being enforced and was left on the list. (The audit said twelve; the test found a thirteenth on
  its first run and it was a false positive — `settings.secrets` is checked inside the handler
  rather than by a decorator, which is the documented `◐` pattern.) **`job.retry` left the list
  in P2-4**: `POST /notifications/deliveries/:id/retry` re-runs a failed e-mail delivery, which
  is exactly "re-run failed background work" — so the key was reused rather than a
  `notification.*` twin being minted beside it. **`job.read` and `job.cancel` left it in P2-6**,
  which is where the runner finally got the operator surface F6 declared them for; all three job
  keys are now enforced by `core/jobs/jobs.controller.ts`. **`system.backup` left it in P2-5**, where it was finally enforced by
  the backup module — and P2-5 minted `system.restore` beside it rather than reusing it,
  because taking a backup and replacing the production database with one are not the same
  authority. **`content.schedule` and `content.unpublish` left it in P2-3**, both describing the
  same half-built feature from opposite ends. **Neither that file nor this line states a count any
  more**, and that is the fix rather than an omission: the test's prose said "a thirteenth entry
  fails the build" and was one behind, then two, because removing an entry and editing a sentence
  about how many entries there are is two edits for one fact. Read the list.
- ~~`ContentEntry.scheduledAt` is read and cleared by the publish job but set by nothing — no
  endpoint, no UI.~~ **Built (P2-3)** — `PUT`/`DELETE /content/entries/:id/schedule`, `APPROVED`
  only, with a five-minute floor matching the cron's own interval so a schedule cannot be set
  inside the window that would make it look like it fired late. `content.export` and
  `content.import` are the two content keys still on the unenforced list, deliberately: they are
  data portability rather than publishing, and need an interchange format decided first.
- ~~The `Notification` and `Redirect` Prisma models have tables and no implementation at all.~~
  **Notification is built (P2-2)** — one platform, four tables, ten types, two channels.
  `Redirect` still has a table, a hits counter, an enable flag and no implementation of any
  kind; `seo.read` and `seo.update` are two of the unenforced keys (P2-4).
- **There is no application log store**, and the System Control Center says so rather than
  rendering an empty table. Nest's `Logger` writes to stdout and whatever supervises the
  process keeps it or does not — there is no `LogEntry` model, no winston and no pino. A
  "Logs" screen listing nothing is indistinguishable from a quiet system, which is the
  single most misleading thing an operations page can do. It is also deliberately **not**
  the audit log wearing a different hat: audit answers *who changed what*, logs answer
  *what happened technically*, and merging them produces a table that is bad at both and a
  retention policy that cannot be right for either.
- **There is no updater.** `/system` reports the mechanism as absent; updates happen through
  the deployment. A button that appeared to update the application and did not would be
  worse than the sentence.
- **A running job cannot be cancelled**, and the refusal says why rather than hiding the
  button: there is no cancellation token in this queue, so marking a row cancelled while
  the worker carries on writing to it would be a status the system cannot deliver.
- **`JobRunner.lastTick` answers for one process.** It is in memory, so on a multi-instance
  deployment the diagnostics' worker check describes whichever instance served the request.
  A heartbeat column would be a write per tick per worker for a value nobody reads between
  incidents.
- `Department` has a table, a tree and a head, and **no API and no screen**; the team content
  type's `group` is still a hardcoded option list. Standorte got their module first because the
  website reads them; Abteilungen are `docs/ENTERPRISE_ROADMAP.md` → P2-6.
- **The client renders any route to any signed-in user.** `routes.tsx` declares each route's
  permissions and `App.tsx` checks them, so the *shell* refuses — but that is a courtesy. The
  server's 403 is the control, as it has always been.

Opened by Wave 2 module 1, and each is a deliberate stop rather than an oversight:

- **`Task.spentHours` has no writer.** The column is declared because
  `docs/data-model.md` §3.9 lists it and Wave 2 module 14 (Time Tracking) fills it; nothing seeds
  it and no rule reads it, so a reconciler that stopped working cannot hide behind a plausible
  number.
- **`TaskOverdue` is raised and nothing consumes it — still**, and P2-2 is where that stopped
  being about the platform and started being about the catalogue. Notifications exists and
  consumes nine events; this is not one of them, because a task notification needs a
  recipient strategy the catalogue does not have — **the assignee** — and inventing a fifth
  strategy for one event was more speculation than the slice needed. It is one entry in
  `core/notifications/catalogue.ts` and one line in the listener the day Aufgaben asks.
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

Opened by **Unternehmen**, and each is a deliberate stop rather than an oversight:

- **Three of the thirteen settings groups the brief asks for are not built, and say so.**
  *Benachrichtigungen* renders a `ModulePlaceholder` because the `Notification` table has no
  consumer (Wave 2 module 9); *Sicherung* is an integration row reading "Nicht gebaut", because
  there is no backup system in this application at all; *Analytics* and *Karten* the same. The
  three states on that panel — `configured`, `unconfigured`, `unbuilt` — are distinct on purpose:
  a missing feature and a missing setting look identical as one grey dot, and the first gets
  waited on for ever.
- **The application version is reported as absent.** Nothing stamps a build here, so
  `/dashboard/system` returns `version: null` with a reason rather than `package.json`'s `0.0.1`,
  which would be a number that never changes and looks like one that does.
- ~~**Lockout threshold, lockout duration and password length are still constants.**~~ **Both
  halves of this are now closed** and the entry is kept because the shape of the answer is worth
  finding again. `server/src/auth/security.policy.ts` (P1-5) sorts every security number into
  four kinds — invariant, environment, organisation policy, user — and makes exactly *one* kind
  configurable, because moving all of them into the settings table would turn every security
  property into something an attacker holding a Super Admin session can switch off first. The
  rule that makes it safe: **a policy may tighten an invariant and may not loosen it**, clamped
  on *read* rather than trusted from the write path. The active-sessions view is P2-9, also done
  — see below.
- **`security.allowedOrigins` stays inert.** CORS is resolved once at bootstrap; making it
  dynamic costs a database read per preflight and locks the dashboard out of its own API when it
  is wrong. A deliberate deferral, not an oversight.
- **The organisation's website defaults are stored and not yet consumed.** `seoTitlePattern`,
  `seoDescription`, `ogImageUrl` and `faviconUrl` are columns the `seo` content type does not
  fall back to yet. They are *not* marked `pending` the way a setting would be, because the
  section says in its own description that the content type remains authoritative.

Opened by **Zwei-Faktor-Authentisierung** (P3-2), and each is a deliberate stop:

- **MFA cannot be made compulsory.** There is no `security.mfaRequirement` setting, and
  adding one without a **forced-enrolment flow** at sign-in would produce a row saying
  "required for everyone" while everyone without it carries on signing in — a security
  property an operator can read, believe, and not have, which is precisely what the
  four-category split in `security.policy.ts` was written against. The seam is
  `AuthService.login`, which already branches on `MfaService.requiresFactor`; nothing in
  the module has to change. `docs/ENTERPRISE_ROADMAP.md` → P3-2b.
- **`MFA_ENCRYPTION_KEY` is a new environment variable a deployment has to set.** Without
  it the application boots normally and every MFA route answers 503 naming it — the right
  direction, and still a step somebody has to take. Losing it is not recoverable by
  generating a new one: the stored secrets become unreadable, enrolled users fall back to
  their **recovery codes** (hashed, so unaffected), and anyone holding `user.resetMfa`
  can clear a credential. Back it up *with* the database, never in it.
- **TOTP is the only method.** `MfaMethod` is an enum with one value and `MfaCredential`
  is keyed `(userId, type)` so WebAuthn is a value and a branch in `mfa.rules.ts` rather
  than a second table — but nothing is built. A phone is the only second factor.
- ~~**Nothing tells anybody their factor changed.**~~ **Closed twice over.** P2-2 gave the
  four MFA facts real notifications — `subject` strategy, `mandatory`, so the in-app copy
  cannot be switched off by the firm or by the person. P2-4 closed the other half: with an
  SMTP server configured the e-mail copy now actually leaves the building, which until then
  resolved to `SKIPPED` on every machine in existence.
- **`security.requireMfaForAdmins` is still a `pending` switch in the settings table** and
  is read by nothing. It predates this module and is the placeholder P3-2b will replace;
  it is left alone rather than deleted because removing a settings row is a migration and
  the row is inert either way.

`README.md` → *Known limitations* carries the product-level list (no MFA flow, local-disk media,
placeholder legal pages, `CodeGate` is a display barrier and not security).

## Content rules

Copy is German, Swiss conventions: apostrophe thousands (`1'450`), true minus (`−38%`), `ss` not `ß`.
Derived figures stay derived — copy carries `{token}` placeholders resolved by `derive.ts`, and an
unknown token renders as itself rather than blanking a number on a live page.

Everything in the content is checkable against iem.ch. **If you add a number, add its source.** Do
not invent job titles for the team entries that have no published one — only the three
Geschäftsleitung members state a function.

