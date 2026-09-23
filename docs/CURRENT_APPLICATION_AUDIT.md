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
| Permissions | 106 keys from 21 resources at the time of the audit; **119 today** (+8 for Unternehmen/Standorte in P1-1, +2 for sessions in P2-9, +1 for `user.resetMfa` in P3-2, +2 for notifications in P2-2). **14 enforced on no route**, unchanged — every key added since was enforced on the route that came with it |
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
| ~~Background jobs~~ | ~~`Job` table + runner + `job.read/retry/cancel` permissions, **no controller**~~ — **built (P2-1/P2-6).** A list with filters, a detail with the scrubbed payload, retry and cancel behind a server-computed capability model, and a System Control Center around it. Two findings on the way: `JobStatus.FAILED` is written by nothing, and the runner had no heartbeat |
| ~~Notifications~~ | ~~`Notification` model, **no implementation at all**~~ — **built (P2-2).** Four tables, ten typed notifications, two channels, a bell and a centre, nine domain events feeding it, and two new permissions. The row that stood here was right about more than the audit knew: the model had a `kind` column and a plaintext-shaped design, and replacing it was the first change |
| SEO / redirects | `Redirect` model + `seo.read/update` permissions, **no module** |
| Backups | `system.backup` permission, **no endpoint, no backup system** |
| API keys / integrations | `system.api` permission, **nothing** |
| ~~Content unpublish/schedule~~ | ~~permissions with no routes; `ContentEntry.scheduledAt` is read by the cron and set by nothing~~ — **built (P2-3).** Three verbs, a pure rules file with the whole transition matrix under test, a required `expectedVersion` on both writes, a publishing queue with a derived effect per row, and an e2e suite that checks the **public site** rather than the dashboard's opinion of it |
| Content import/export | 2 permissions, no routes. Left out of P2-3 deliberately: they are data portability rather than publishing, and need an interchange format decided |
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

~~**MFA is half-built**~~ — **built, as of P3-2.** The paragraph that stood here said
`User.mfaSecret` and `User.mfaEnabled` existed, `otpauth` was installed and unused, and
`security.requireMfaForAdmins` was a switch marked `pending`. The column is now **gone**,
and that was the first change rather than an afterthought: a plaintext Base32 TOTP secret
in the same row as the e-mail address it belongs to is readable by anyone with a database
console or a backup, so it is not a head start on the feature — it is the thing the
feature had to remove.

What is there instead: four tables (`MfaCredential`, `MfaRecoveryCode`, `MfaChallenge`,
`ReauthToken`), AES-256-GCM at rest with the key from `MFA_ENCRYPTION_KEY`, a sign-in that
returns **no token and no cookie** until the factor is shown, ten single-use recovery
codes stored as hashes, a per-challenge ceiling of five attempts, a ±1-step drift window
with replay protection on the accepted step, and a re-authentication window guarding the
two operations that weaken an account. `user.resetMfa` is the one new permission.

**The switch is still not enforceable, and now says so for a better reason.** Making
"required for everyone" true means refusing a session to somebody who has not enrolled,
which needs a forced-enrolment flow at sign-in. A setting without that flow is a row an
operator can read, believe, and not have — `docs/ENTERPRISE_ROADMAP.md` → P3-2b.

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
- ~~`Notification` and `Redirect` have tables and no code.~~ `Notification` is built (P2-2) and now has three siblings; `Redirect` still has a table and no code.
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
| Scheduled publishing | **Built (P2-3).** `PUT`/`DELETE entries/:id/schedule`, APPROVED only, a five-minute floor matching the cron's own interval |
| Unpublish | **Built (P2-3).** `POST entries/:id/unpublish` — clears the published copy *and republishes*, because the site serves a snapshot |
| Content import / export | Not implemented, and deliberately not part of P2-3 — see `docs/ENTERPRISE_ROADMAP.md` → P2-3 |

Publishing itself is sound: editing and publishing are separate acts, the publish screen
asks *what would the next publish produce* (`rowsForNextPublish` + `diffDocuments`) rather
than counting `APPROVED` rows, and `jsonb` key order is canonicalised before comparison.
Snapshots are versioned and restorable.

What P2-3 added on top of that, and the reason it was not simply three routes:

- **The state machine left the service.** `content/content.rules.ts` holds the transition
  table, and `content.rules.test.ts` asserts all thirty-six pairs against an
  independently written allow-list. The question an auditor asks — *can an editor move
  something from IN_REVIEW straight to PUBLISHED?* — is now answered by running a test
  rather than by reading code.
- **Both new writes take a required `expectedVersion`**, answering 409 on a stale one.
  The `UpdateProjectDto` argument: a lock a caller may omit is one every caller omits
  exactly once.
- **`GET /content/queue` derives an effect per row.** `PUBLISH` / `REPUBLISH` /
  `WITHDRAW` / `NONE`, computed from the status and whether a published copy exists —
  which is how a deleted-but-still-live entry becomes visible at all. It reads `DRAFT` and
  is about to disappear from the site.
- **A silent failure in the cron was found and fixed.** `doPublishScheduled` cleared
  `scheduledAt` before publishing, so a failed publish's retry found nothing due and the
  job was marked **DONE**. The failure was recorded as a success.
- **`e2e/publishing.spec.ts` asserts against the public document**, fetched without a
  token the way a visitor's browser fetches it, plus one browser check that the site
  renders it. Every other assertion in the area is about an intermediate.

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

~~Secrets are handled correctly: redacted on read behind a separate `settings.secrets`
permission, and writing the mask back is a no-op so saving the form does not blank the
SMTP password.~~

**This paragraph was wrong on its central claim, and P2-4 is the correction.** Redaction
is a *display* property; the value was stored in the clear, and `settings.secrets` existed
precisely so that a holder could read it back. UI masking is not storage security, and an
API that returns a credential is one screenshot away from leaking it. A `secret: true`
setting is now encrypted at rest under `APP_SECRETS_ENCRYPTION_KEY`, returned by no route
at all, and `settings.secrets` means *manage* rather than *read*. The one part that was
right is still true and is now load-bearing: a blank write means **keep**, and removal is a
separate confirmed action.

### 5.4 Against the brief's thirteen groups

| Group | Today |
| --- | --- |
| 1 General | Partial — name only; no short name, description, founded year, locale, timezone, currency, status |
| 2 Legal & identity | Split and mostly dead — `company.legalName` is `pending`; `vatId`/`legalForm`/`ownership` live in the CMS `facts` type; no UID, no commercial register, no legal/invoice address, no data-protection contact |
| 3 Offices & locations | **Missing as a module.** Table with no API; CMS copy with no relationship |
| 4 Contact & communication | Scattered — `contactEmail` (CMS), `applications.notifyEmail` (setting), office phones (CMS), socials (CMS). No single source |
| 5 Website defaults | Partial — the `seo` content type covers title/description/OG/robots well; no fallback pattern, no favicon wiring |
| 6 E-mail | **Built (P2-4)** — a `MailProvider` seam with SMTP as its one implementation, the password encrypted at rest and readable by nothing, a connection test *and* a test send with sanitized nine-category diagnostics, a template catalogue with previews, and a status panel whose figures are all measured. The delivery log is the notification platform's and is reused rather than duplicated. The row that stood here called the old state "Good" and named three gaps; the fourth — that the SMTP password was stored in plaintext — is the one it missed |
| 7 Notifications | **Built (P2-2)** — organisation rules under Einstellungen, personal preferences in the notification centre, and the two kept deliberately apart: one is governance, the other is a personal choice |
| 8 Recruitment | Partial — notify address, retention, file size (see §5.1); no allowed-types or candidate-status configuration |
| 9 Security | Partial — session timeout, lockout threshold, lockout duration and password length are all configurable and clamped (P1-5); active sessions are visible and revocable for oneself and, behind `user.readSessions`/`user.revokeSessions`, for another account (P2-9); **MFA is built and self-service** (P3-2), with an administrative reset behind `user.resetMfa`, and every security change now **notifies the account holder** (P2-2). Origins stay inert; the MFA *policy* switch stays `pending` until there is a forced-enrolment flow to make it true (P3-2b) |
| 10 Integrations | Missing |
| 11 Storage & media | Missing as configuration; real limits are constants |
| 12 Backup & recovery | **Built (P2-5)** — three tables, `pg_dump` + `tar` + a manifest with SHA-256 per artifact, verification that parses the archives rather than trusting the exit code, retention that can never leave zero recovery points, and a **recovery drill** that restores into an isolated database and reads the records back. Configuration under *Einstellungen → Sicherung*, operations at `/sicherungen`. Local storage only and no encryption at rest — both stated in the UI and in `docs/BACKUP_RECOVERY_RUNBOOK.md` rather than implied away |
| 13 System information | **Complete (P2-6).** `/dashboard/system/overview` gives eight subsystem verdicts with reasons and links, build identity (version, commit, build time, source), migration state, queue state, disk, security aggregates and the two subsystems that honestly do not exist. `/jobs` is the operator surface; `POST /diagnostics` runs eight active checks. **No score** — a maximum plus reasons, because a percentage cannot be acted on |

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
3. ~~No MFA flow (switch exists, inert).~~ **Closed 20 September 2026 (P3-2.)**
   Enrolment, TOTP sign-in, recovery codes, self-service disable and an administrative
   reset all work, and the plaintext `mfaSecret` column is gone. Two things are still
   owed and both are deliberate: the **policy** switch cannot be enforced without a
   forced-enrolment flow (P3-2b), and `MFA_ENCRYPTION_KEY` is a new environment variable
   a deployment has to set — without it the application runs and the feature answers 503
   naming it, which is the right direction but is a step somebody has to take.
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

---

## Addendum — 23 September 2026

`docs/COMPLETE_APPLICATION_AUDIT.md` is the wider audit written four days later, and it found
things this one did not look for. §8 above called the security posture *good* and listed six open
items, none of them a hole; that stands as what this audit saw. The later one read the role
assignment path, the repository scopes, the job queue's retry and the deployment scripts, and
found five P0 gaps there — a privilege escalation from Administrator to Super Admin, a restore
that retried itself, an installer that left rate limiting and MFA non-functional behind nginx,
repository scopes that defaulted to every row, and `settings.update` reaching secrets and the
four-eyes switch. All five were closed the same day; the evidence is that document's Part 34 and
`docs/ENTERPRISE_ROADMAP.md` → P0-2.

Two figures above have moved and are recorded here rather than edited in place: the catalogue
now holds **121** permissions (`settings.security` was added), and `KNOWN_UNENFORCED` holds
**8** entries.

**P1A, same day.** The UX defect sweep of the wider audit (its Part 27, band `UX-0`) is also
done — silent success toasts, detail screens that dropped to a skeleton on every write, Enter
that did nothing in dialogs, list rows a keyboard could not open, failed requests shown as empty
lists, a home page that counted approvals instead of pending changes, conflicts answered with a
full reload, and a content reorder that could never be saved. No schema change, no new
permission. Evidence: `COMPLETE_APPLICATION_AUDIT.md` Part 35 and `ENTERPRISE_ROADMAP.md` → P1A.
The client test count in §7 has moved to **902** (41 files) and the server's to **1725**.

**P1B, same day.** The dashboard's navigation is now seven role-aware workspaces:
- Übersicht, Aufgaben, Projekte, Website, Personal, Unternehmen, System.

These replace 21 rail rows and 73 destinations.

What changed:
- The 35 content types left the rail. They are reached from Website › Inhalte and a Ctrl/Cmd+K command palette.
- The settings page's and the System screen's own sub-navigations were removed in favour of one workspace pattern.
- `system.health` alone no longer opens a System workspace. It had been doing so for 12 of the 15 roles.

What did not change:
- No URL, no permission, no endpoint and no schema.
- One test account, `redaktion@iem.test`, was added to the seed.

Evidence: `COMPLETE_APPLICATION_AUDIT.md` Part 36 and `ENTERPRISE_ROADMAP.md` → P1B. The client
test count has moved to **983** (42 files).

**P1C, same day.** The dashboard now has one interaction standard for forms and actions:

- **Three kinds of form**: page, dialog and filter.
- **Fields** are required unless marked, and assistive technology is told so.
- **SaveBar** states say unsaved, saving, saved, failed or conflict.
- **Conflicts** go through one `ConflictNotice`.
- **Buttons** follow an action hierarchy with a destructive trigger (`danger-quiet`) distinct from its confirmation (`danger`). Rare actions sit in a "Mehr" menu.
- **Status transitions** use one dialog that says what follows.
- **Confirmations** come in three levels.
- **Vocabulary** gives one verb per act.
- **Page actions** stay in the sticky bar.

Other changes:

- `useAsync` is retired from the home page, the shell, the audit log and the profile.
- Permission keys no longer reach a person.
- No schema, permission, endpoint or backend rule changed.

Evidence: `COMPLETE_APPLICATION_AUDIT.md` Part 37 and `ENTERPRISE_ROADMAP.md` → P1C. The client
test count has moved to **1005** (42 files).
