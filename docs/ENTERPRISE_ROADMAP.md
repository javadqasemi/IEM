# Enterprise roadmap

The remaining work to make this an operable enterprise platform, prioritised. Derived
from `docs/CURRENT_APPLICATION_AUDIT.md` (19 September 2026), which is the evidence for
every item here.

This is **not** a replacement for `docs/roadmap.md`. That document owns the *business
module* build order — Wave 2's remaining modules, Waves 3 and 4. This one owns the
platform: the things every module depends on and the firm's own configuration. Where the
two touch, the dependency is named.

**Priorities.**

| | |
| --- | --- |
| **P0** | Security, data loss, broken production flows, broken builds. Nothing else starts while one is open. |
| **P1** | Enterprise core — needed to operate the company and the CMS properly. |
| **P2** | Operational: workflows, administration, the things that turn "works" into "runnable at 2 a.m." |
| **P3** | Optimisation, polish, convenience. |

Each item states the problem, the impact, the fix, its dependencies and what "done" means.

Status keys: **✅ done in this pass** · **◐ partly done** · **○ open**.

---

## P0 — Critical

### P0-1 ✅ Settings are written with no schema, and one of them is a deletion deadline

**Problem.** `SettingDef` declares no type and `SettingsService.update` validates nothing
beyond "the key exists" and "the value is not `undefined`". `settings.controller.ts`
claims in a comment that *"the shape is checked against the setting's own definition in
the service"*; no such check exists. `applications.service.ts:155` then reads
`applications.retentionDays` with the raw untyped `value()` — no clamp, unlike
`maxFileBytes` two lines above it — and multiplies it into `retainUntil`.

**Business impact.** Setting the retention field to `0` or a negative number makes the
03:00 purge delete every applicant dossier received that day, files included, permanently.
Setting it to anything non-numeric yields `new Date(NaN)`, Prisma rejects the write, and
`POST /applications` 500s — the public careers form stops accepting candidates with no
visible cause. Both are reachable from the settings form by an ordinary mistype, and both
involve personal data.

**Technical impact.** The class is wider than the one call site: every setting is stored
as free-form JSON, so any consumer that does not go through `text`/`number`/`flag` has the
same exposure, and an operator can put a value into the store that silently does nothing.

**Solution.** Give every setting a declared `type` (`string`, `text`, `email`, `url`,
`number`, `boolean`, `stringList`, `select`) with `min`/`max`/`options` where they apply,
validate on write in a pure `settings.rules.ts`, and reject the wrong shape with a 400
that names the key. Clamp the retention read. Validation is pure, so it is exhaustively
testable without a database.

**Dependencies.** None.

**Acceptance.** A `PATCH /settings` carrying the wrong JSON type, an out-of-range number
or an unknown select option is refused with a message naming the key; the retention read
is clamped to a sane range; the comment in the controller is true; tests cover every
declared type including the mask-write no-op.

---

## P1 — Enterprise core

### P1-1 ✅ The firm is not an entity — Company / Organisation settings

**Problem.** Company data lives in three stores that do not know about each other: nine
`Setting` rows (eight of them `pending`, i.e. read by nothing), the `offices` CMS content
type, and the orphan Prisma `Office` table with no API and no screen. Two of them already
disagree about the firm's street address in Thun and in Bern.

**Business impact.** There is no answer to "what is our address" that the system will give
consistently. Changing the main phone number means finding every place it was typed. The
legal identity a Swiss company must publish — UID, commercial register, VAT, legal
address, data-protection contact — is not held anywhere.

**Technical impact.** Every future module that needs the firm's identity (invoicing,
offers, PDF title blocks, transmittal letterheads, e-mail footers) will either invent a
fourth store or hard-code it.

**Solution.** An `Organisation` singleton and a first-class `Office` entity, built to the
five-layer reference pattern with rules, events, audit, versioning, metrics and row-level
permission checks. The published website document then *derives* its `offices` from the
`Office` table instead of from a parallel content type, which makes the header phone, the
contact band, the Standorte section and the `{telefonThun}` / `{standorte}` tokens all
follow one source with no change to the site's components.

**Dependencies.** P0-1 (the settings groups are re-homed into the same workspace).

**Acceptance.** Super Admin can edit organisation identity, legal data, contacts and
offices; an unauthorised user cannot; changes persist, are versioned, are audited and
reach the public site on the next publish; the old duplicate is removed rather than left
behind; offices CRUD includes archive/restore and refuses to orphan employees or projects.

### P1-2 ✅ The settings screen is one long form

**Problem.** No sections, no sub-navigation, no search, no unsaved-changes guard, no
per-field validation, no confirmation on dangerous switches. Field types are guessed from
the stored JSON.

**Business impact.** Configuration is where an administrator does the most damage with the
least feedback. The switch that lifts the four-eyes principle currently takes one click
with no confirmation and no indication anything important happened.

**Solution.** A settings workspace: left sub-navigation, one section per subject, a save
bar that reports dirty/saving/saved per section, field types from the declaration rather
than from the value, an unsaved-changes guard, and confirmation on the changes that
weaken a control.

**Dependencies.** P0-1 (typed definitions are what the renderer reads).

**Acceptance.** Every group reachable from a sub-navigation; leaving with unsaved changes
warns; validation errors appear on the field; dangerous changes confirm; the layout works
at phone width with no horizontal overflow.

### P1-3 ◐ Operational visibility: system, storage, integrations

**Problem.** `/dashboard/health` reports database latency, seed sync and process figures.
There is no application version, no migration state, no queue state, no storage
consumption, and no statement of which integrations are configured.

**Business impact.** "Is mail actually configured?" and "did the last migration apply?"
are unanswerable without shell access.

**Solution.** A read-only System panel in the settings workspace fed by a real endpoint —
versions, migration count and latest name, database latency, job queue by state, media
count and bytes, and an integration list whose status is *derived from configuration that
actually exists* rather than from a table of intentions.

**Done in this pass:** the panel, the endpoint, storage and queue figures, and integration
status for mail, storage, cache and the two that are genuinely absent.
**Still open:** deployment identity (commit/build time) — needs a build-time stamp.

**Acceptance.** No secret is exposed; every figure is measured rather than declared; an
absent integration says *absent*, never *ok*.

### P1-4 ✅ Mail cannot be proven to work

**Problem.** SMTP is configurable from the dashboard and degrades to logging when
unconfigured — so a wrong password looks exactly like a correct one.

**Solution.** A test-send route behind `settings.update`, which resolves the *stored*
configuration, sends to the caller's own address, and reports the transport error
verbatim on failure. Audited, and rate-limited.

**Acceptance.** A wrong host produces a named error in the UI within the request; a
correct one produces a mail; the attempt appears in the audit log either way.

### P1-5 ○ Security configuration is constant

**Problem.** Lockout threshold, lockout duration and password minimum length are constants
in `auth.rules.ts`. `security.allowedOrigins` is inert. There is no active-session view.

**Business impact.** An incident cannot be responded to without a deploy, and neither a
user nor an administrator can end a suspicious session short of deleting the account.

**Solution.** Move the three constants behind clamped settings read through
`auth.rules.ts` (keeping the rules pure — the numbers become arguments). Add a sessions
list and a revoke action over `RefreshToken`. Leave CORS at bootstrap: making it dynamic
costs a database read per preflight and locks the dashboard out of its own API when it is
wrong — that is a deliberate deferral, not an oversight.

**Dependencies.** P0-1 for the clamps.

**Acceptance.** Changing the lockout threshold takes effect on the next attempt without a
restart; a user can see and revoke their own sessions; an administrator can revoke
another's; every revocation is audited.

### P1-6 ○ Fourteen permissions guard nothing

**Problem.** `KNOWN_UNENFORCED` lists 14 keys selectable in the role editor that no route
checks. Harmless while the routes do not exist; misleading the moment one does.

**Solution.** Not a single change — each entry retires with the module that earns it
(jobs, SEO, backup, import/export, impersonation). The list is already the tracking
mechanism and the test already fails on a stale entry. What this roadmap adds is the
*order*: `job.*` with P2-1, `seo.*` with P2-4, `content.export/import/unpublish/schedule`
with P2-3, `system.backup` with P2-5, `user.impersonate` deliberately last or never.

**Acceptance.** The list only shrinks, and each removal lands in the commit that adds the
route.

---

## P2 — Important

### P2-1 ○ Background jobs have no operator surface
`core/jobs` is durable, retried and attributable, and the `Job` table is the row an
operator needs when an export never arrives — but there is no controller and no screen,
and `job.read`/`retry`/`cancel` guard nothing. **Fix:** a jobs list with state filter,
payload, attempts, last error, and retry/cancel actions. **Acceptance:** a failed job can
be diagnosed and retried from the dashboard; three permissions leave `KNOWN_UNENFORCED`.

### P2-2 ○ Notifications are a table and nothing else
`Notification` exists; `TaskOverdue` is raised and consumed by nobody; the notification
settings group in the settings workspace is rendered as explicitly not-yet-connected.
This is Wave 2 module 9 in `docs/roadmap.md` and the dependency is the event bus, which is
done. **Acceptance:** at least one real consumer (overdue tasks), a bell with unread
counts, and the settings group stops being inert.

### P2-3 ○ Publishing is missing four verbs
No unpublish, no import, no export, and scheduling is half built — `scheduledAt` is read
by the 5-minute cron and set by nothing. **Acceptance:** an editor can schedule a publish
and see it pending; an entry can be withdrawn from the live site without a rollback; four
permissions leave `KNOWN_UNENFORCED`.

### P2-4 ○ SEO and redirects
`Redirect` has a table, hits counter and enable flag; `seo.read`/`seo.update` guard
nothing. The `seo` content type already covers per-site meta well, so this item is
redirects plus robots.txt plus the fallback patterns from the organisation's website
defaults. **Acceptance:** a redirect can be created and is served; two permissions leave
the list.

### P2-5 ○ Backup and recovery
There is no backup system. The settings workspace says so rather than showing an empty
panel, which is the honest interim. **Fix:** a scheduled `pg_dump` to the storage adapter
as a `core/jobs` job, a retention policy, a restore that requires elevated confirmation.
**Acceptance:** last/next backup and status are real figures; restore is audited and
gated; `system.backup` leaves the list.

### P2-6 ○ Departments
A `Department` table with a tree and a head, no API, no screen — and the site's team type
still carries a hardcoded `group` option list. **Acceptance:** departments are managed in
Company Settings and the team content type reads them.

### P2-7 ○ The pre-pattern screens
`Content.tsx`, `ContentEditor.tsx`, `Media.tsx`, `People.tsx`, `Workflow.tsx` and
`Operations.tsx` are 15k–29k-line multi-screen files predating the five-layer pattern and
the `DataView`/`useListView` contract. `ContentEditor` also hand-writes a breadcrumb the
router derives. **Acceptance:** each becomes a feature folder; `WITHOUT_METRICS` shrinks by
the same number.

### P2-8 ○ Media library gaps
Checksums are stored and indexed but duplicates are never surfaced; there is no
replace-with-history UI, no bulk metadata edit, no orphan report. **Acceptance:** an upload
of an identical file offers the existing asset.

---

## P3 — Optimisation

| | |
| --- | --- |
| P3-1 ○ | **Legal pages** are placeholders (`README.md` → Known limitations). Now that the organisation holds UID, register and data-protection contact, an Impressum can be generated from it rather than typed. |
| P3-2 ○ | **MFA enrolment.** Columns, dependency and switch exist; the flow does not. Until it does the switch must stay inert — enforcing it would lock out every administrator. |
| P3-3 ○ | **Structured data.** The organisation now holds everything a schema.org `Organization` / `LocalBusiness` block needs. Emitting it is invisible to the design and good for search. |
| P3-4 ○ | **Lint backlog.** 0 errors is the bar and holds; 35 warnings (28 React-Compiler, 8 `exhaustive-deps`) are a countable backlog that grows with the dashboard. |
| P3-5 ○ | **Prettier.** Configured, deliberately not run across the tree. A one-commit reformat is a decision to take once, on its own. |
| P3-6 ○ | **Performance budgets over real volume.** `budgets.spec.ts` refuses to claim anything below 100 rows; `SEED_LOAD_PROJECTS=500` is opt-in. Making it the default for CI would turn the slope check into a standing regression gate. |
| P3-7 ○ | **The e2e suite now sits at the login-throttle ceiling.** `/auth/login` allows 10/min per IP; a full run needs roughly that many, because `security.spec.ts` signs in one account per role and `auth.spec.ts` deliberately spends attempts on failures. The seventh role account (`adm@iem.test`, added for the `organisation.updateLegal` gate) is what closed the margin, and the 61-second ride-out in `apiToken`/`workerContext` now fires often enough to be felt. **Do not raise the limit** — it is a real control and CLAUDE.md records three separate misdiagnoses of it. The two honest levers are to run `auth.spec.ts` last so its deliberate failures do not starve the rest, or to drop the seventh account: `organisation.controller.test.ts` already covers the legal gate as a pure unit test, so only the `office.delete` route cell would be lost, and that one is a plain decorator the agreement test already checks. |

---

## Order of work

```
P0-1  settings validation            ← blocks everything
  └─ P1-1  Organisation + Offices    ← the module
       ├─ P1-2  settings workspace
       ├─ P1-3  system/storage/integrations panel
       └─ P1-4  mail test send
  └─ P1-5  security configuration
P2-1 jobs → P2-2 notifications → P2-3 publishing verbs → P2-4 SEO → P2-5 backup
P2-6 departments · P2-7 screen migration · P2-8 media
```

P1-1 comes before every P2 because five of them need somewhere to be configured, and
because the alternative is each inventing its own.

---

## What this pass delivered

**P0-1, P1-1, P1-2 and P1-4 in full; P1-3 apart from deployment identity.** Nothing was
marked done that is not wired to a reader — the three groups the brief asks for that this
system genuinely cannot serve (Notifications, Backup, Analytics/Maps) render as explicitly
not built rather than as empty forms.

| | |
| --- | --- |
| Database | `Organisation` (singleton, id `org`) and fifteen new columns on `Office`; `address` **renamed** to `street` rather than dropped, so the two existing rows kept their data. Migration `20260919000000_organisation_and_offices` |
| API | `/organisation` (GET, PATCH, versions), `/offices` (full CRUD + archive), `POST /settings/mail/test`, `GET /dashboard/system` |
| Permissions | `organisation` ×3 and `office` ×5 — 106 keys → 114, all eight enforced on a route. `KNOWN_UNENFORCED` is unchanged at 14 |
| Events | `OrganisationUpdated`, `OfficeCreated/Updated/Archived/Restored/Deleted`, `MailTested` — 75 → 82, all audited through `AuditListener` |
| Single source of truth | The published document's `offices` is **injected from the `Office` table**; the `offices` content type is retired, its rows removed by the migration. The header phone, contact band, Standorte section and the `{telefonThun}` / `{standorte}` tokens all follow it, with no change to any site component |
| Frontend | `features/organisation/` on the five-layer pattern, `entities/organisation/`, and two new shared primitives (`SideNav`, `SaveBar`). The old one-page settings screen left `pages/Operations.tsx` |
| Tests | +126 server (settings rules 33, organisation rules 38, DTO 20, controller gate 22, metrics 13), +56 client, +14 e2e matrix cells, 2 behavioural e2e tests and a 6-test `organisation.spec.ts`. 1'890 unit tests, 0 lint errors, 34 warnings — one below the previous baseline |

**Seven defects were found by writing the tests rather than by reading the code**, and
three of them were in code that predates this work — a settings section is simply the
first screen in the dashboard that is a **form which stays open after saving**, and that
is the shape they were all hiding behind:

| | Found by | |
| --- | --- | --- |
| 1 | mapper test | `toOfficeCreateBody` trimmed every optional field and not `name`, `kind` or `country`. `city` is what the site's team filter groups by and what `crossCheck` compares at publish time, so a trailing space would have emptied the filter for everyone at that office *and* produced a warning naming a Standort that visibly exists. |
| 2 | axe, all widths | The System panel wrapped a full-width row in a `<div>` inside a `<dl>` — a `definition-list` violation. Fixed by giving the shared `Pair` a `className`, which is the better shape anyway. |
| 3 | live API probe | `VersioningService.conflict` templates `${label} wurde inzwischen geändert`, so a plural label produced "Die Unternehmensangaben **wurde**". |
| 4 | e2e, request count | **`SaveBar` fired the save twice.** The button was `type="submit"` *and* carried an `onClick`, so inside a form one click sent two `PATCH`es — and the second, with the now-stale `expectedVersion`, came back **409**. A save that had worked reported a conflict with itself. |
| 5 | e2e, pre-existing | **`useForm.dirty` never recomputed after a save.** The baseline was a `useRef` and `dirty` a `useMemo` over `[values]`, and a ref is invisible to a dependency array. Harmless in a dialog that closes on save; on a form that stays open it kept saying "Ungespeicherte Änderungen" over a written record and made the guard fire on a clean screen. The hook's own comment already claimed this worked. |
| 6 | e2e, pre-existing | **`invalidate()` takes the data off screen.** It zeroes `updatedAt`, and `useQuery` gates `data` on `updatedAt > 0` — so a key's own data reads `null` between invalidating and refetching, and a screen that renders a skeleton without data unmounts. `useQuery`'s comment promises the opposite. Worked around by priming the response the server already returned, and by narrowing each mutation's invalidation. |
| 7 | e2e, pre-existing | **The login-throttle ride-out could not finish.** `apiToken` answers a 429 by waiting 61 s; the global Playwright timeout was 45 s, so a spec authenticating in `beforeAll` reported a hung hook while the remedy was mid-sleep. Adding a seventh role account is what made the suite reach the limit at all. |

5, 6 and 7 are the interesting ones: each was latent, each is in shared infrastructure, and
none was reachable from any screen that existed before. They are written up where they live
— `useForm.ts`, `useOrganisation.ts` and `playwright.config.ts` — and CLAUDE.md records the
third occurrence of the throttle misdiagnosis.

**Verified against the running system**, not only in unit tests: every bad retention value
refused with the correct status (400 for a value, 404 for an unknown key, all-or-nothing on
a batch); the UID check digit refusing a correctly-shaped wrong number; the optimistic lock
refusing a replay; `administrator` writing the company but refused on the legal fields and
on `office.delete`; and the publish screen reporting "Standorte" as changed when an office
is edited and nothing when it is put back. The public stylesheet still hashes to
`globals-B1c5Zfq1.css`, which is the check that the locked brand design was not touched.

**State of the gates, stated exactly.** `npm run verify` is green: 0 lint errors, 34
warnings (one *below* the previous baseline of 35), 726 client and 1'164 server unit tests.
The browser suite was run per spec on the final code — `organisation` 6/6, `screens` and
`a11y` at all three widths in both themes, `security` 45/45, `budgets` 11/11, `project-edit`
10/10 — and each passed. The one *full* `npm run e2e` on the final code ended **318 passed,
6 failed**, and all six are the login throttle (P3-7 above) plus trace-artifact `ENOENT`
cascading from it; the dev servers were also killed for host memory pressure during that
run. No failure was an assertion about behaviour, and none has been dismissed as flaky
without a cause: the cause is named and is now a roadmap item.

The reasoning for each decision that was argued rather than inherited lives where it
applies — `server/src/core/organisation/organisation.rules.ts`,
`server/src/core/settings/settings.rules.ts` and `src/features/organisation/service.ts` —
in the same form the other modules use.
