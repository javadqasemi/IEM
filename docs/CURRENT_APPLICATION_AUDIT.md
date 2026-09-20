# Current application audit — 19 September 2026

What is actually in this repository today, read from the source rather than from the
documentation. Where the two disagree the source wins and the disagreement is recorded.

> **This is the state the audit found, not the state of the repository now.** It is written in
> the present tense on purpose — a finding rewritten after it is fixed stops being evidence that
> it was ever true, and §5 in particular is the argument for the work that followed. What has
> since been repaired is listed in `docs/ENTERPRISE_ROADMAP.md` → *What this pass delivered*:
> §5.1 (the P0), §5.2 and §5.3 in full, and most of §5.4. Everything else below still stands.

This supersedes nothing. `docs/system-audit.md` was written before the enterprise
foundation existed and its §0 premise — *"there is no operational domain model"* — is no
longer true. `docs/PROJECT_IMPLEMENTATION_CHECKLIST.md` (14 September) covers the public
site only and predates `server/`. Both remain useful for the parts they describe.

**Method.** Every controller's routes were enumerated, every Prisma model listed, the
permission catalogue compared against its agreement test, the content model compared
against the site's `SiteContent` type, and `npm run verify` run to completion. Figures
below are counted, not estimated.

---

## 0. Headline

The platform is in materially better shape than an outside reading of the roadmap
suggests. Fourteen foundation stages, one Wave 1 module and three Wave 2 modules are
built to a consistent five-layer pattern, with 1'024 server tests and 117 architecture
assertions enforcing the layering rather than describing it.

The gap the brief names — **Company / Organisation settings** — is real, and it is worse
than "incomplete". It is *three* stores of company data that do not know about each
other, two of which already disagree about the firm's own street address.

One defect is severe enough to be P0: **settings are written with no schema validation,
and one of them is a deletion deadline for personal data.**

| | |
| --- | --- |
| Verify gate | ✅ green — typecheck, lint (0 errors), 1'024 server tests, site tests |
| Server modules | 19 controllers, ~173 route handlers |
| Prisma models | 49 models, 38 enums, 12 migrations |
| Permissions | 106 keys from 21 resources at the time of the audit; **116 today** (+8 for Unternehmen/Standorte in P1-1, +2 for sessions in P2-9). **14 enforced on no route**, unchanged — every key added since was enforced on the route that came with it |
| Domain events | 75 names; audit derived from them |
| Content types | 24 editable types covering all 38 keys of `SiteContent` |
| Public site CMS coverage | effectively complete — see §4 |

---

## 1. Architecture

### 1.1 What is enforced rather than agreed

Two test files do most of the work of keeping this codebase honest, and they are the
reason the audit below is short where it would otherwise be long.

`src/architecture.test.ts` — the DTO boundary (a DTO type may be named only in
`dto.ts`, `repository.ts`, `mapper.ts`), feature isolation, the `index.ts` boundary, and
the direction of every layer arrow. It also asserts the public site imports nothing from
the dashboard, which is what protects the visitor-facing bundle.

`server/src/architecture.test.ts` — 117 assertions: `app.module.ts` lists modules and
nothing else; every feature folder is a Nest module; no feature imports a sibling's
service; a service that has a repository holds no Prisma; Prisma types stay in
`repository`/`mapper`/`scope`; **every feature declares a `*.metrics.ts`**; every route
carries `@RequirePermissions` or `@Public()`; the audit controller exposes no write route.

Three debt lists are load-bearing and **may only shrink** — the test fails both when a
new offender appears *and* when a listed one is fixed and left on the list:

| List | Where | Entries |
| --- | --- | --- |
| `KNOWN_UNENFORCED` | `rbac/permissions.agreement.test.ts` | 14 |
| `KNOWN_CONTROLLER_PRISMA` | `server/src/architecture.test.ts` | 2 |
| `WITHOUT_METRICS` | `server/src/architecture.test.ts` | 10 |

This is the single best thing about the codebase and the reason most of the roadmap below
is *addition* rather than *repair*.

### 1.2 Layers

Server: `dto → rules → repository → mapper → service → controller`, with `*.metrics.ts`
and `*.list.ts` beside them. Client: `dto → repository → mapper → service → hooks →
screens` under `src/features/<name>/`, with `core/`, `entities/`, `shared/`, `widgets/`
below.

Four modules are built to the full pattern (`projects`, `tasks`, `meetings`, `drawings`);
four are read-only master-data slices (`customers`, `buildings`, `employees`,
`disciplines`); the rest (`content`, `media`, `users`, `applications`, `audit`,
`settings`, `dashboard`) predate it and are listed in the debt tables above.

### 1.3 Cross-cutting infrastructure — all present and wired

`core/api` (query cache with a retry breaker), `core/router` (derived breadcrumbs,
route-published actions), `core/events` (78-name catalogue, request-scoped queue, flushed
on success), `core/audit` (derived from events), `core/jobs` (durable, retried, capped
backoff), `core/list` (one paginate/filter/sort/search contract + saved views, columns,
export, bulk), `core/metrics` (records, latency percentiles, error rate, per module),
`core/versioning` (`EntityVersion`, optimistic lock, two revision schemes),
`core/settings` (key/value store — **the weak one, see §5**).

---

## 2. Backend

### 2.1 Route surface

Roughly 173 route handlers across 19 controllers. Fully built: meetings + decisions (35),
content (24), tasks (24), projects (18), drawings + transmittals (18), media (11),
applications (9), auth (8), users (7), rbac (6).

**Absent entirely** — no controller, though the permission or the table exists:

| Missing | Evidence |
| --- | --- |
| Offices / locations | `Office` model exists, is seeded, and has **no API and no screen** |
| Departments | `Department` model exists, is seeded, **no API, no screen**; the site still uses a hardcoded option list |
| Background jobs | `Job` table + runner + `job.read/retry/cancel` permissions, **no controller** |
| Notifications | `Notification` model, **no implementation at all** |
| SEO / redirects | `Redirect` model + `seo.read/update` permissions, **no module** |
| Backups | `system.backup` permission, **no endpoint, no backup system** |
| API keys / integrations | `system.api` permission, **nothing** |
| Content import/export/unpublish/schedule | 4 permissions, no routes; `ContentEntry.scheduledAt` is read by the cron and set by nothing |
| Impersonation | `user.impersonate`, no flow |
| Test e-mail send | mail is configurable from the dashboard with **no way to prove it works** |

### 2.2 Authentication and sessions — strong

Global `JwtAuthGuard` denying by default; permissions resolved from the database on every
request, so revocation is immediate; Super Admin short-circuits on the role key.

Refresh-token rotation with family revocation on replay, plus the two fixes that make it
survivable in practice: a 30-second `REFRESH_GRACE_MS` window audited as
`auth.refresh_concurrent`, and `withRefreshLock` serialising tabs through
`navigator.locks`. A three-valued `RefreshOutcome` distinguishes "refused" from
"unreachable", so a proxy hiccup no longer signs people out.

**And a 429 is now "unreachable" too** — the fourth side of that same mistake, found on
20 September 2026 and the only one where the server did reply. `ThrottlerGuard` runs
before the controller, so a rate-limited refresh never reaches `AuthService`: the cookie
is not examined, nothing is revoked and no audit row is written. It was being read as a
refusal and signing people out of live sessions. Reachable in production because the
60/min limit is **per IP** and the firm shares one office address; found in the e2e suite,
which peaks at 62 refreshes a minute because every `page.goto` reboots the SPA. Two
regression tests in `client.test.ts`, and `spendRefresh` paces the suite rather than the
limit being raised.

Lockout: five attempts, cleared on expiry as well as on success. Password minimum 12
characters. Login throttled 10/min; refresh 60/min; the public application form 5/hour/IP.

**Active sessions are now visible and revocable** (P2-9, 20 September 2026), which is the
one thing this section used to say was missing. `GET /auth/sessions` lists the caller's
own — one unrevoked `RefreshToken` row per live session, since rotation revokes as it
issues — with the current one marked by comparing the presented cookie's hash. A user
ends one (`DELETE /auth/sessions/:id`) or all the others
(`POST /auth/sessions/revoke-others`, distinct from `logout-all` because "sign out my
other devices" presumes you are staying). An administrator holding `user.readSessions` /
`user.revokeSessions` does the same for another account under `/users/:id/sessions`.
No token, hash or `replacedById` ever reaches a response body — the view is built from an
explicit key list so a new column cannot widen it.

**Not configurable.** Lockout threshold, lockout duration and password length are
constants in `auth.rules.ts` / `auth.service.ts`. Session lifetime *is* configurable
(`security.sessionTimeoutMinutes`, clamped 1–240).

**MFA is half-built**: `User.mfaSecret` and `User.mfaEnabled` exist, the `otpauth`
dependency is installed, and `security.requireMfaForAdmins` is a stored switch marked
`pending` — there is no enrolment or verification flow, and enforcing the switch would
lock every administrator out. Marked honestly rather than hidden, which is the right call.

### 2.3 Data protection

Applicant dossiers are stored outside the media allowlist and served only through a
permission-checked route. The static-media guard is a *positive* match against
`req.path`, which is what defeats the `%62ewerbungen` and `bewerbungen%2f` bypasses.
Retention is enforced by a 03:00 purge against `JobApplication.retainUntil`.

**This is where the P0 lives** — see §5.1. The retention window is written from an
unvalidated settings row and read without a clamp.

---

## 3. Database

49 models and 38 enums. Soft delete (`deletedAt`) on everything that a history could outlive;
`EntityVersion` as one history table for every entity, deliberately without a foreign key
for the same reason `AuditLog` has none. Optimistic locking via a `version` column plus
`updateMany({ where: { id, version } })`, which is one statement and therefore actually a
lock.

Observations:

- **`Office` is a stub.** `name`, `address`, `zip`, `city`, `phone`, `isHeadquarters`.
  No street/canton/country split, no e-mail, no coordinates, no opening hours, no public
  visibility, no ordering, no archive. It is referenced by `Employee`, `Project` and
  `Building`, so it is real master data — it simply has no owner.
- **There is no `Organisation` model at all.** The firm itself is not an entity.
- `Notification` and `Redirect` have tables and no code.
- `Department` has a table, a tree and a head, and no API.
- Media: checksum, alt text with an explicit `altDecorative`, variants and versions —
  a good model. No duplicate-detection *surface* despite the checksum index.

---

## 4. CMS coverage of the public website

Better than expected, and the checklist document undersells it. 24 content types write
all 38 keys of `SiteContent`, including the twelve label blocks that would normally be
hardcoded strings (`stelleLabels`, `searchLabels`, `projectDialogLabels`, …).
`assertComplete` refuses a publish that would leave any of them empty, so the failure
mode is a blocked publish rather than a blank band on a live page.

| Area | State |
| --- | --- |
| Hero, sections, services, phases, Bauakte, references, team, openings, sponsorships, socials, nav, Leitbild, facts, contact, footer, SEO, all label blocks | **Fully editable** |
| Offices (Standorte) | Editable — but as *website copy*, duplicated against the `Office` table (§5.2) |
| Departments | **Hardcoded** option list on the team type's `group` field |
| Legal pages (Impressum / Datenschutz) | Placeholders — `README.md` → Known limitations |
| Scheduled publishing | Half built: `scheduledAt` read by the cron, set by nothing |
| Unpublish | Not implemented; rollback is the nearest thing |

Publishing itself is sound: editing and publishing are separate acts, the publish screen
asks *what would the next publish produce* (`rowsForNextPublish` + `diffDocuments`) rather
than counting `APPROVED` rows, and `jsonb` key order is canonicalised before comparison.
Snapshots are versioned and restorable.

---

## 5. Company / Organisation settings — the subject of the brief

### 5.1 The defect (P0)

`SettingDef` in `core/settings/settings.service.ts` declares `key`, `group`, `value`,
`description`, `secret`, `pending`. **It declares no type.** `SettingsService.update`
checks three things — that the key exists, that a written-back mask is a no-op, and that
the value is not `undefined` — and then writes arbitrary JSON into the row.

`settings.controller.ts` says of its `@Allow()` decorator that *"the shape is checked
against the setting's own definition in the service"*. **It is not.** There is no such
check anywhere.

Most readers survive this because the typed accessors (`text`, `number`, `flag`) fall back
on anything unexpected. One does not:

```ts
// applications.service.ts:155
const retentionDays = await this.settings.value<number>("applications.retentionDays", 180);
…
retainUntil: new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000),
```

`value()` is the raw read: no type check, no clamp. Two reachable failures, both from the
settings form alone:

1. **`0` or a negative number** → `retainUntil` is now or in the past → the 03:00
   `purge-applications` cron deletes every dossier received that day, permanently, with
   the files. That is personal data and there is no undo.
2. **A non-numeric value** → `NaN` → `new Date(NaN)` → Prisma rejects the write and
   **`POST /applications` 500s**, so the public application form silently stops accepting
   candidates.

Two lines away, `maxFileBytes` does it correctly with `settings.number(key, fallback, min,
max)`. The omission is local, and the general fix — typed setting definitions validated on
write — closes the whole class.

### 5.2 Three stores of company data, already disagreeing

| Store | Holds | Read by | State |
| --- | --- | --- | --- |
| `Setting` rows `company.*`, `brand.*`, `site.*` | name, legal name, e-mail, website, logo, favicon, colour, base URL, locale | `company.name` → mail sender. **The other eight: nothing.** | 8 of 9 marked `pending` |
| `ContentEntry` type `offices` | city, street, zip, phone, phoneHref, kind | The published site: header phone, contact band, Standorte section, `{telefonThun}` and `{standorte}` tokens | Live |
| Prisma `Office` | name, address, zip, city, phone, isHeadquarters | `Employee.officeId`, `Project.officeId`, `Building.officeId` | Live, invisible in the dashboard |

They already disagree:

| | Website (`src/content/defaults.ts`) | Database (`prisma/seed.ts`) |
| --- | --- | --- |
| Thun | Uttigenstrasse 49, 3600 | Bierigutstrasse 6, 3608 |
| Bern | Sandrainstrasse 3, 3007 | Belpstrasse 48, 3007 |

The website values are the checkable ones (CLAUDE.md: content is verifiable against
iem.ch). The database values are what a project record points at. Nothing reconciles them
and nothing reports the divergence — which is the exact failure mode the brief describes
in the abstract, present in the repository in the concrete.

### 5.3 What the settings screen is today

One page, one card per group, one Save button. Field types are *inferred from the stored
JSON* — a boolean gets a toggle, a number a numeric input, an array a comma list. There is:

- no sub-navigation, no sections, no settings search;
- no unsaved-changes guard (navigating away loses the form silently — the dashboard *has*
  `useUnsavedGuard`, this screen does not use it);
- no per-field validation and no server validation to surface;
- no confirmation on anything, including the switch whose own description says it lifts
  the four-eyes principle;
- 26 keys, of which **10 are marked `pending`** — stored, editable, read by nothing. The
  screen says so with a badge, which is the honest handling of a half-built feature, but
  it means well under half the page does anything.

Secrets are handled correctly: redacted on read behind a separate `settings.secrets`
permission, and writing the mask back is a no-op so saving the form does not blank the
SMTP password.

### 5.4 Against the brief's thirteen groups

| Group | Today |
| --- | --- |
| 1 General | Partial — name only; no short name, description, founded year, locale, timezone, currency, status |
| 2 Legal & identity | Split and mostly dead — `company.legalName` is `pending`; `vatId`/`legalForm`/`ownership` live in the CMS `facts` type; no UID, no commercial register, no legal/invoice address, no data-protection contact |
| 3 Offices & locations | **Missing as a module.** Table with no API; CMS copy with no relationship |
| 4 Contact & communication | Scattered — `contactEmail` (CMS), `applications.notifyEmail` (setting), office phones (CMS), socials (CMS). No single source |
| 5 Website defaults | Partial — the `seo` content type covers title/description/OG/robots well; no fallback pattern, no favicon wiring |
| 6 E-mail | **Good** — configurable, environment fallback, secrets redacted, read per send. Missing: test send, templates, delivery status |
| 7 Notifications | Missing — table exists, nothing reads it |
| 8 Recruitment | Partial — notify address, retention, file size (see §5.1); no allowed-types or candidate-status configuration |
| 9 Security | Partial — session timeout, lockout threshold, lockout duration and password length are all configurable and clamped (P1-5); active sessions are visible and revocable for oneself and, behind `user.readSessions`/`user.revokeSessions`, for another account (P2-9). Origins stay inert; MFA is still `pending` |
| 10 Integrations | Missing |
| 11 Storage & media | Missing as configuration; real limits are constants |
| 12 Backup & recovery | **Missing entirely** — no backup system exists |
| 13 System information | Partial — `/dashboard/health` gives database latency, seed sync, snapshot and audit counts, uptime, memory, Node version. No app version, no migration state, no queue state |

---

## 6. Frontend

### 6.1 Component system — strong, and the reason the settings work is mostly composition

`shared/ui` is split into six families: `primitives` (Button, Card, Badge, PageHeader,
EmptyState, ErrorState, Skeleton, DownloadButton), `forms` (Field, Input, Select, Toggle,
Combobox, EntityPicker, DatePicker, DateRangePicker, `useForm`, `EntityForm`,
`FieldRenderer`), `data` (DataTable/DataView, FilterBar, ColumnPicker, BulkBar,
Pagination, Kpi, BarChart, Pair), `overlays` (Modal, Drawer), `navigation` (Tabs,
Breadcrumb, Pagination), `feedback` (ErrorBoundary, toast, ModulePlaceholder).
`shared/hooks` adds `useListView`, `useMutation`, `useDebounced`, `useUnsavedGuard`.

Almost every primitive the brief asks for already exists. The ones that genuinely do not:
`SettingsLayout`, `SettingsNavigation`, `SettingsSection`, `SaveBar`, `AddressEditor`,
`MediaPicker` (the `FieldRenderer` has an image field; there is no standalone picker),
`PermissionGuard` (the shell does the check, there is no component form).

### 6.2 Consistency

Good, with one clear outlier. The four feature modules share `PageHeader`, `DataView`,
`FilterBar`, `useListView` and the same dialog shape. The three screens still living in
`pages/Operations.tsx` (Settings, Audit, Profile) and the CMS screens
(`Content.tsx`, `ContentEditor.tsx`, `Media.tsx`, `People.tsx`, `Workflow.tsx`) are
pre-pattern: 22k–29k-line files holding several screens each, hand-rolled forms, and — in
the settings case — no use of the form infrastructure that exists.

`ContentEditor` also writes its own `<Breadcrumb>`, which the derived-trail design
explicitly warns against.

### 6.3 Error, loading and empty states

`ErrorBoundary` wraps every route and `Suspense` gives a page skeleton, so a lazy chunk
failure does not white-screen. `ErrorState`, `EmptyState` and `Skeleton` are used widely.
Route-level permission checks render a `NoAccess` screen rather than a wall of 403s.

`Field` clones its child to wire `aria-describedby` — this was a *claim* in a comment until
recently and is now a behaviour, with a test.

### 6.4 Accessibility and responsive

Playwright runs every screen at three widths in two themes with an axe pass — 78
screenshots. Contrast tokens are asserted by `theme.contrast.test.ts`. The one systemic
weakness the audit can see without running it is §6.2's outlier: the pre-pattern screens
were not built against `DataView`, so their responsive strategy is per-screen.

---

## 7. Testing

| Suite | Count |
| --- | --- |
| Server vitest | 1'024 tests, 38 files |
| Client vitest | routes, navigation, theme, architecture, `useForm`, FilterBar, DateRangePicker, query cache, client, download, mappers/repositories/services for `projects` |
| Playwright | every screen × 3 widths × 2 themes + axe; plus `security.spec.ts` (role × verb × resource against the live API), `budgets.spec.ts` (with an N+1 slope check), `versioning.spec.ts` (two writers racing) |

The rule about *which toolchain a test runs in* (CLAUDE.md) is the most valuable piece of
testing knowledge in the repository and is correctly applied: esbuild does not emit
`emitDecoratorMetadata` or ES2022 class fields, so a vitest test of the Nest container or
of a transformed DTO proves nothing, and the guards for both live in e2e instead.

**Gap:** there are no tests for `core/settings` beyond `settings.dto.test.ts` (7 tests,
which check the pipe, not the service). The service has no test file at all — which is how
§5.1 survived.

---

## 8. Security posture

Good, and better than most codebases at this stage: deny-by-default authorisation, a
live role × verb × resource e2e matrix, permissions resolved per request, audit rows
derived from events with a correlation id, secrets redacted behind their own permission,
positive-match static media guard, rotation with replay detection, rate limits on the two
public endpoints.

Open items, in order:

1. §5.1 — unvalidated settings reaching a destructive deadline.
2. 14 permissions grantable in the role editor that guard nothing. The role editor is
   therefore making promises the server does not keep; harmless today because the routes
   do not exist, misleading the moment one does.
3. No MFA flow (switch exists, inert).
4. ~~No active-session management.~~ **Closed 20 September 2026 (P2-9.)** Both halves
   ship: a user sees and ends their own sessions, and an administrator ends another's
   without deleting the account. The one thing still owed is a *place* for the
   administrator's view — it is a panel inside the user dialog, because this application
   has no user detail page yet (P2-7), so a user's sessions have no shareable URL.
5. ~~Lockout and password policy are constants.~~ **Closed (P1-5.)** All four numbers are
   settings now, validated on write and clamped on read so a policy can tighten an
   invariant and never loosen it.
6. `security.allowedOrigins` is inert; CORS is resolved once at bootstrap.

None of 2–6 is a hole. They are the difference between *secure* and *operable under
pressure*.

---

## 9. What this audit concludes

Three sentences.

The foundation is genuinely enterprise-grade and its self-enforcing tests are the reason
it will stay that way. The company's own identity is the one domain the platform does not
model — it is scattered across a dead key/value store, a CMS content type and an orphan
table that already disagree — and that is both the brief's subject and the correct next
piece of work. One defect in that same area is a P0 data-loss path and is fixed first.

The prioritised plan is `docs/ENTERPRISE_ROADMAP.md`.
