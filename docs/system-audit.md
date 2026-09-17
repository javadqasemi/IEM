# System audit

**Date:** 17 September 2026
**Scope:** the whole repository — public site, dashboard, API, database, auth, RBAC, media, build.
**Status:** revised the same day. Three corrections and two new findings are marked *(added in
revision)* below; they came out of running the seed and exercising the API while fixing Stage 0,
which is also the honest record of what a source-only read missed.
**Method:** source read of all ~28'000 lines of first-party code, plus a live run of both processes
(Vite on 5173, NestJS on 3100, PostgreSQL on 5433) and the two typecheck gates and the production
build. Every claim below names the file it came from.

This document exists because a redesign was requested toward an enterprise Engineering Management
System (projects, customers, offers, orders, planning, tasks, documents, BIM/CAD, employees, time
tracking, resources, quality, finance, reports). Phase 1 is the audit of what is actually here. It
is written to be read before any of that is built, because the single most consequential finding
changes the shape of the whole programme.

---

## 0. The finding that governs everything else

**This application is a marketing website with a content-management system behind it. It is not a
business system, and it contains no operational domain model at all.**

`server/prisma/schema.prisma` defines 20 models. Every one of them is identity, content, media,
audit or site-facing intake:

| Group | Models |
| --- | --- |
| Identity & access | `User`, `Role`, `Permission`, `RolePermission`, `UserRole`, `RefreshToken`, `PasswordReset` |
| Content | `ContentType`, `ContentEntry`, `ContentVersion`, `ReviewRequest`, `ContentSnapshot` |
| Media | `MediaFolder`, `MediaAsset`, `MediaVariant`, `MediaAssetVersion` |
| Operations | `Setting`, `AuditLog`, `Notification` |
| Site-facing | `JobApplication`, `Redirect` |

There is no `Project`, `Customer`, `Contact`, `Offer`, `Order`, `Task`, `Milestone`, `Employee`,
`TimeEntry`, `Absence`, `Invoice`, `Payment`, `Budget`, `CostItem`, `Resource`, `Reservation`,
`Document`, `Inspection`, `Defect`, `CalendarEvent`, `Department` or `Team` entity. None.

The words "Projekte" and "Team" do appear, and this is the trap. They are **content types**, not
business objects:

- `projects` (`server/src/content/content-types.ts:363`) is the 30 *reference projects* shown in the
  Referenzen section of the public website — marketing case studies with a client name, a photo and
  a build sum, published to visitors.
- `team` (`server/src/content/content-types.ts:402`) is the 41 *portraits* on the public team page —
  name, city, photo. `README.md` is explicit that only three of them state a function, and that job
  titles must not be invented for the rest.

Both are rows in `ContentEntry` whose `data` is an untyped JSON blob validated against a field
descriptor list. They are designed to be **published to the public internet**. They are structurally
unable to carry a budget, a time entry, an internal cost, a risk register or an employee's salary
band, and they should not be extended to — the publish pipeline would put any field added to them on
iem.ch.

The consequence for the requested Phase 2: of the 19 requested navigation areas, **one and a half
exist**. Documents partially exists as a media library. Administration and Settings exist. Everything
else — Projects, Customers, Offers, Orders, Planning, Tasks, Calendar, BIM/CAD, Employees, Time
Tracking, Resources, Quality, Finance, Reports, Company — is greenfield. This is not a redesign of an
existing system; it is a new system that will reuse this one's foundations.

What *is* reusable is substantial and genuinely good, and section 6 says exactly what.

---

## 1. Inventory

### Stack

| | |
| --- | --- |
| Frontend | React 18.3, TypeScript 5.7 (`strict`, `noUnusedLocals`, `noEmit`), Vite 6.4, Tailwind 3.4 |
| API | NestJS 11, Prisma 7.10 (`pg` driver adapter, no Rust engine), Express 5, PostgreSQL |
| Auth | Argon2id, JWT access token (15 min), opaque rotating refresh token in an `httpOnly` cookie |
| Media | `sharp`, local disk via a `StorageAdapter` seam |
| Other | `helmet`, `@nestjs/throttler`, `@nestjs/schedule`, `nodemailer`, `redis` (optional), `otpauth` (unused) |

Three Vite entries, none of them a route: `index.html` (site), `stelle.html` (one job advert),
`admin.html` (dashboard).

### Size

~28'000 lines of first-party source. Largest files: `src/content/defaults.ts` (1'693),
`server/src/content/content-types.ts` (1'015), `src/admin/ui/primitives.tsx` (914),
`src/admin/pages/Operations.tsx` (902), `server/src/content/content.service.ts` (858).

### Current gate status — all green, verified this session

```
npm run typecheck               → exit 0
npm --prefix server run typecheck → exit 0   (includes the seed under tsconfig.seed.json)
npm run build                   → exit 0, built in 20.39s
```

Production bundle, measured:

| Chunk | Raw | gzip |
| --- | --- | --- |
| `three.module` (dynamic, site only) | 734.52 kB | 189.60 kB |
| `scene_guglera.json` (dynamic asset) | 656.17 kB | 117.96 kB |
| `admin` (the entire dashboard, one chunk) | 153.11 kB | 42.42 kB |
| shared vendor (`Wordmark-*`) | 145.94 kB | 47.16 kB |
| `index` (site) | 71.85 kB | 21.47 kB |
| `globals.css` (public) | 39.06 kB | 7.91 kB |
| `admin.css` | 36.76 kB | 7.28 kB |

The two-Tailwind-config split works: the public stylesheet does not carry admin utilities. The
three.js dynamic import works: it is in its own chunk and off the critical path.

### Runtime check

Both processes started cleanly. `GET /api/v1/content/published` returns snapshot **version 8**
(published 17.09.2026 14:55 UTC), 53 KB, 38 content keys, all sections populated. `GET /api/v1/users`
unauthenticated returns **401**. The `/media` dev proxy returns **404** for a missing file rather
than the SPA fallback. The database is real and seeded.

---

## 2. Module-by-module

### 2.1 Public website (`src/`, `index.html`)

**Purpose.** A single-page marketing site for IEM AG: hero with a WebGL building model, services,
SIA phase walkthrough, 30 reference projects, 41-person team, sponsorships, careers, offices,
contact.

**Status.** Complete and working. Renders from a content snapshot compiled into the bundle, then
swaps in a newer published snapshot after first paint (`src/content/store.ts`). No loading state, no
layout shift, and with no API configured it makes no network request at all.

**Working correctly.** Content/presentation separation is clean. `{token}` placeholders
(`src/content/derive.ts`) keep derived figures — years since founding, open-position counts,
copyright year — computed while the surrounding copy stays editable, and an unknown token renders as
itself rather than blanking a number on a live page. Search index shared between the header box and
the Referenzen filter (`src/lib/search.ts`). Custom events as the seam between sibling sections.
Native `<dialog>` for the project modal.

**Missing.** No router — anchors only, by design. No responsive `srcset` on site images (the CMS
generates variants; the site markup does not consume them). No sitemap, no structured data. Legal
pages (Datenschutz, Impressum) are placeholder links and the application form carries no
privacy-consent line — `README.md` flags both as required before this collects personal data in
public.

**Bugs.** None found.

**UX.** Strong and deliberate. Filters expose `aria-pressed` with an `aria-live` count; the
discipline matrix marks uncovered disciplines struck-through rather than omitting them, with
`sr-only` text for both states.

**Security.** `CodeGate` (`src/components/CodeGate.tsx`) is a display barrier only — the code is in
the shipped bundle. `README.md` says so plainly. Not a defect, but it must never be mistaken for
access control.

**Performance.** The hero backdrop costs ~190 kB gzipped of three.js plus ~118 kB of scene JSON for
something decorative. It is deferred to idle, skipped under Save-Data, frozen under reduced motion
and paused off-screen — but on a phone it sits behind a near-solid scrim. Worth deciding whether it
should load on small screens at all.

**Improvements.** Consume the media `srcset` the CMS already produces. Add the legal pages. Decide
the mobile backdrop question.

---

### 2.2 Job advert page (`stelle.html`, `src/stelle.tsx`)

**Purpose.** One vacancy as its own printable, forwardable page.

**Status.** Working. Its own React root, so it cannot rely on the landing page's event seams — which
is why `StelleDetail` hosts `BewerbungDialog` directly. An unknown `?id=` renders a
"not found" state rather than a blank page.

**Missing / bugs / security.** Nothing found.

---

### 2.3 CMS content model (`server/src/content/`, `src/content/`)

**Purpose.** Typed rows rather than tables: `ContentType` describes a shape, `ContentEntry` holds one
value of it as JSON, `ContentVersion` keeps every value it has ever had.

**Status.** Complete, ~36 content types, all wired end to end.

**Working correctly.** The one-way flow is airtight: editors write `ContentEntry` rows → publishing
assembles one complete `ContentSnapshot` → the site fetches that. A visitor's page load is one
indexed read of one row. An editor's draft cannot reach a visitor. Publishing is atomic and refuses
to write an incomplete document (`REQUIRED_KEYS` in `snapshot.builder.ts`). `jsonb` comparison is
canonicalised by sorting keys recursively before comparing, which is the only correct way to diff
something read back from Postgres.

**Missing.** `content.export` and `content.import` exist as permissions with no endpoint.
`ContentEntry.scheduledAt` is read and cleared by the cron job (`scheduled.tasks.ts`) but **set by
nothing** — no endpoint, no UI. Scheduled publishing is half built.

**Bugs.** None found. The two historical traps are documented and currently correct: the envelope is
unconditional (`common/http.ts:176`), and every DTO field carries a class-validator decorator.

**Performance.** Entry search falls back to `jsonb` `string_contains` on two hardcoded paths
(`content.service.ts:88-106`) with no index and no full-text search. The file says so and it is right
for collections of a few dozen rows. It will not survive thousands.

**Improvements.** For the target system, do not extend this model to business objects — see §0. Keep
it for website copy, where it is the right design.

---

### 2.4 Approval workflow

**Purpose.** Draft → In Prüfung → Freigegeben → Veröffentlicht, plus Abgelehnt and Archiviert.

**Status.** Complete and correct.

**Working correctly.** The transition table (`content.service.ts:33-40`) is written as data, so the
question "can an editor go from IN_REVIEW straight to PUBLISHED?" is answered by reading it. Review
requests point at a **version**, not an entry, so approving cannot approve whatever the entry happens
to say later. Self-approval is refused (`content.service.ts:553`), with Super Admin explicitly exempt
and the exemption recorded in the audit log. `pendingChanges` asks what the next publish would
*produce* rather than counting APPROVED rows — which is the only way a deletion or a reordering shows
up, because neither ever becomes APPROVED.

**Missing.** `content.unpublish` is a permission with no endpoint. No bulk approve. No delegation or
out-of-office reassignment.

**Improvements.** `rowsForNextPublish` is a pure model of what `publish()` does in its transaction,
and `publish()` deliberately does not call it. That is a documented duplication with a stated reason;
if the promotion rule changes it must change in both. Worth a comment-linked test once a test runner
exists.

---

### 2.5 Media library (`server/src/media/`, `src/admin/pages/Media.tsx`)

**Purpose.** Upload, organise, version and serve images and PDFs.

**Status.** Complete and well built.

**Working correctly.** Type is decided by **magic bytes**, not the client's declared `Content-Type`
(`media.service.ts:532`). EXIF is stripped on upload — portraits routinely carry GPS. Files are
hashed and deduplicated, so uploading the same portrait twice returns the existing row. WebP
derivatives at 400/800/1600 with a ready-made `srcset`, generated down only, never upscaled. Replace
keeps the id so a re-shot portrait appears everywhere without editing 41 entries, and the superseded
bytes stay as a version. Soft delete, because a content entry may still reference the file.

The static serving guard in `main.ts:96-114` is a **positive** allowlist match on
`^/\d{4}/<name>.<ext>` — the only key shape `MediaService.upload` writes — evaluated against a
decoded path. That is correct, and the comment explains that a `bewerbungen/` denial was tried and
leaked via `%62ewerbungen` and `bewerbungen%2f`. Do not weaken it.

**Missing.** No `media.download` route (the permission exists, nothing checks it). No prune of
soft-deleted bytes. No usage/reference view ("which entries use this file?"). No focal point or
crop. Folders exist as a database relation but are not part of the storage key, so the "folder
structure" a document module would want is only a tag.

**Security.** See **F-02** — `image/svg+xml` is an allowed upload type and SVG can carry script.

**Performance.** Variant generation is synchronous inside the request. A 25 MB upload blocks the
request for the duration of three `sharp` resizes. Acceptable at CMS volume; not at document-
management volume.

---

### 2.6 Authentication (`server/src/auth/`)

**Purpose.** Sign-in, sessions, password reset, invitations.

**Status.** Complete except MFA.

**Working correctly.** Argon2id at the OWASP baseline (19 MiB, 2 passes). One identical failure
message for unknown address, wrong password and unactivated account, so the form is not an address
oracle. Per-account lockout (5 attempts, 15 min) **and** per-IP throttling — one bounds the attacker,
the other bounds the target. Refresh tokens are opaque random bytes stored as a hash, rotated on
every use, with **reuse detection**: presenting an already-revoked token revokes the whole family.
The refresh token never appears in a JSON body. Password reset always returns the same response
whether or not the address exists. Changing a password ends every other session. Length-over-
composition password policy (12 chars, no class rules, plus a short obvious-password list) — which is
the correct modern choice.

**Missing.** **MFA is not implemented.** `User.mfaSecret` and `User.mfaEnabled` columns exist,
`security.requireMfaForAdmins` is a seeded setting, `otpauth` is a declared dependency — and there is
no enrolment, no verification, no import of `otpauth` anywhere in `server/src`. The scaffolding
reads as a feature that exists. It does not. No device/session list for the user, no "sign out this
device", no SSO/OIDC, no API keys (`system.api` is a permission with no implementation).

**Bugs.** None functional. Two pieces of dead code that mislead — **F-09** and **F-10**.

---

### 2.7 Authorisation / RBAC (`server/src/rbac/`, `server/src/auth/guards.ts`)

**Purpose.** 51 permissions, 11 seeded roles, custom roles assembled from the same catalogue
*(corrected in revision: the seed reports 11 roles; `README.md` says ten)*.

**Status.** Backend complete and correct. **Frontend half is not implemented.**

**Working correctly.** The catalogue in code is the source of truth; the seeder reconciles and
*reports* orphans rather than deleting them. `JwtAuthGuard` is global and **denies by default** — a
route is protected unless it carries `@Public()`, so a controller added by someone who has not read
the file is closed rather than open. Guard order in `app.module.ts:73-75` is load-bearing and
documented: throttle, then authenticate, then authorise. Permissions are resolved from the database
on **every request**, so revoking a role takes effect immediately rather than at token expiry. Super
Admin short-circuits on the role key, never on holding every permission — so adding a permission
cannot quietly de-power the only account that can fix things. The 403 names the missing permission,
which is the right call: an administrator debugging someone else's access needs to know which one.

**Missing.** `renderRoute` in `src/admin/App.tsx:98` renders **any page to any signed-in user**. The
rail hides what a user cannot reach, but that is a courtesy — the server's 403 is the only control.
This is currently acceptable because every screen's data comes from a guarded endpoint. It stops
being acceptable the moment Finance and HR screens exist. See **F-07**.

12 of the 51 permissions are enforced on no route. See **F-06** for the verified list.

The 11 seeded roles are **CMS roles** — `content_editor`, `marketing`, `viewer`, `guest`. None of
Management, Project Manager, Engineer, Draftsman or Finance exists. `hr` exists but is scoped to
content and applications.

---

### 2.8 Job applications (`server/src/applications/`)

**Purpose.** Receiving end for the public application form.

**Status.** Complete.

**Working correctly.** The one unauthenticated write endpoint in the system, and it is defended
accordingly: rate limit (5/hour/IP), a honeypot that answers 202 rather than an error so a bot cannot
learn what gave it away, hard caps enforced by Multer before the body is buffered (5 files, 10 MB
each), magic-byte checks in the service. Dossiers are stored under `bewerbungen/` and are
**deliberately excluded** from static serving by the allowlist in `main.ts`; the only route to them
is the permission-checked download, which forces `Content-Disposition: attachment` and
`X-Content-Type-Options: nosniff`. Records carry their own `retainUntil` and a cron job purges both
record and files.

**Missing.** `application.export` is a permission with no endpoint.

**Bug.** The upload size limit is hardcoded at `10 * 1024 * 1024` in the controller decorator
(`applications.controller.ts:68`) while `applications.maxFileBytes` is an editable setting that
nothing reads. Part of **F-03**.

---

### 2.9 Settings (`server/src/settings/`)

**Purpose.** Global configuration, one row per key, with secrets masked.

**Status.** The *mechanism* is complete and correct. The *content* is almost entirely inert.

**Working correctly.** `secret` is a column rather than a hand-maintained list in code. Secret values
come back as a fixed mask with a `hasValue` flag, and writing the mask back is a no-op — so saving
the SMTP form without retyping the password does not blank it.

**Bug — and it is the most user-visible defect in the system.** 23 of the 25 seeded settings are
**write-only** *(corrected in revision: the seed reports 25 settings, not 26)*. Verified by grepping
every read of `SettingsService.value` across `server/src`: the
only two consumers are `applications.retentionDays` and `applications.notifyEmail`
(`applications.service.ts:109` and `:150`). Everything else — `workflow.requireApproval`,
`workflow.autoPublishApproved`, `site.maintenanceMode`, `security.sessionTimeoutMinutes`,
`security.requireMfaForAdmins`, `security.allowedOrigins`, all seven `mail.*`,
`applications.maxFileBytes`, all three `brand.*`, all four `company.*`, `site.baseUrl`,
`site.defaultLocale` — is presented in the dashboard as an editable control and changes nothing. See
**F-03**.

`workflow.requireApproval` is the dangerous one. Its own description says switching it off "hebt den
Vier-Augen-Grundsatz auf". An operator could reasonably believe they had turned the four-eyes
principle **on**. Mail settings are the second: SMTP is configured from `server/.env`, so an operator
who fills in the dashboard's SMTP form and finds mail still not sending has no way to tell why.

**And it is worse than the source read showed** *(added in revision)*. Exercising the endpoint
revealed that the settings page **cannot save at all** — not just that the values are unread. See
**F-22**. Both halves are now fixed.

---

### 2.10 Audit log (`server/src/audit/`)

**Purpose.** Append-only record of every sign-in, change, approval, download and deletion.

**Status.** Complete and well designed.

**Working correctly.** Explicit rather than interceptor-driven, so entries carry the before and after
of a record — which is the thing anyone actually asks a log for. It never throws (a failed audit
write must not roll back the action) and never blocks the response. `actorEmail` is denormalised on
purpose so the log stays readable after the user record is gone. Values are scrubbed on the way in by
a key denylist covering passwords, hashes, tokens, secrets and cookies. Append-only in the strong
sense: there is no API to edit or delete a row. CSV export bypasses the envelope interceptor by using
`@Res()` without `passthrough`, which is correct.

**Weakness.** The recorded `ip` is unreliable — see **F-04**. `scrub` is a denylist, which the file
itself acknowledges is the weaker choice, with a stated reason (the values are arbitrary content
documents).

**Missing.** No retention policy or partitioning. `AuditLog` grows without bound and is queried with
`ORDER BY createdAt DESC` on an indexed column, which is fine for now and will need partitioning at
enterprise volume.

---

### 2.11 Dashboard shell, navigation and routing (`src/admin/`)

**Purpose.** The CMS operator interface: 11 routes.

**Status.** Complete for the CMS. Architecturally the strongest part of the frontend.

**Working correctly.** Navigation is **data, not JSX** (`src/admin/lib/navigation.ts`): the Website
groups are built at runtime from the content types the server reports, sorted by each type's own
rank, slotted by a `GROUP_OF` map, and a type missing from that map still appears under "Weitere
Inhalte" rather than vanishing. Permissions *filter* the menu rather than decorating it, and a group
emptied by filtering disappears with its heading. Three zones order the rail by the editor's working
day. Favourites and history persist per browser, every `localStorage` access wrapped. Keyboard
navigation (arrows, Home, End) reads off the DOM rather than an index into the model, so it stays
correct while a search filters the list. The `exact` flag exists because a destination that is the
parent of other destinations breaks prefix matching.

The hash router (`src/admin/lib/router.tsx`) is ~80 lines and deliberately not `react-router`: no
server rewrite rule is needed for a static `admin.html`, and the invitation and reset mails already
link to `admin.html#/einladung?token=…`. `Link` correctly lets modified clicks through to the
browser.

**Missing against the Phase 2 spec.** The rail lists **main groups only**; a group's entries render
in the sticky top bar as anchors, deliberately not `role="tab"`. The spec asks for *expandable
groups* in the rail. That is a real conflict with a documented rationale on the existing side (36
content types nested under folding headings was "a menu you had to operate before you could read
it"), and it needs an explicit decision rather than being changed by default. See **F-20**.

**Limits.** No nested routes, no data loaders, no scroll restoration — the file says so. 19 top-level
modules with tabbed detail pages will need nested routing. This is the point at which replacing the
router is justified, and the surface to replace is exactly three exports.

---

### 2.12 Dashboard component library (`src/admin/ui/`)

**Purpose.** Every screen is built from these and adds no chrome of its own.

**Status.** Good, and honest about its own boundaries — nothing in `primitives.tsx` imports the API
client or knows what a content entry is.

**Present.** `Button` (5 variants, 3 sizes, renders `<a>` when given `href`), `Spinner`, `Skeleton`,
`SkeletonTable`, `EmptyState`, `ErrorState`, `Card`, `PageHeader`, `Badge` (7 tones), `Field`,
`Input`, `Textarea`, `Select` (native, on purpose), `Checkbox`, `Toggle`, `SearchInput`, `Tabs`,
`Pagination`, `Breadcrumb`, `Modal` (native `<dialog>`), `ConfirmDialog` (with type-to-confirm for
the genuinely unrecoverable), `DataTable`, `DataView`, `KpiCard`, `KpiUnavailable`, `BarChart`,
`ActivityFeed`, `WorkflowBadge`, `ApplicationBadge`, Swiss number/byte/date formatters.

`EmptyState` always says what would be here and offers the action that creates it. `ErrorState` shows
the **server's own message** rather than replacing it with "something went wrong" — which is right,
because "Fehlende Berechtigung: content.publish" is the only useful part.

**Missing for the target system.** No Drawer/SidePanel, Menu/Popover, Tooltip, Combobox/Autocomplete,
MultiSelect, DatePicker, DateRangePicker, TimePicker, FileDropzone (upload is inline in `Media.tsx`),
Stepper, Timeline, TreeView, Accordion, Avatar group, Progress/Meter, Rich-text editor, Kanban board,
Gantt chart, resource/capacity grid, or multi-series charting. `BarChart` is a single-series HTML bar
list — deliberately no charting library, which was right for two charts and will not be right for a
Finance module. `DataTable` sorts **client-side only**, with no column resize, pin, group, or
server-side sort wired (the `sortValue` hook is where that change would land, and the file says so).

**Weakness.** `cn()` is plain `clsx` with **no tailwind-merge** (`src/lib/cn.ts`, 5 lines). A
`className` passed to a component is appended, so a call site cannot reliably override a `bg-` or
`text-` in the base — stylesheet order decides. This is survivable with 30 components and will be a
constant source of subtle bugs with 80. See **F-16**.

**Missing.** No dark mode anywhere. `tailwind.config.ts` has no `darkMode` key, colours are hardcoded
hex, and there is no CSS-custom-property indirection. The requested Settings → Dark Mode is not a
toggle to add; it is a token-system change. See **F-14**.

---

### 2.13 Dashboard pages

11 routes, all working:

| Route | Page | Notes |
| --- | --- | --- |
| `/` | Dashboard | KPIs, activity feed, last publish, recent edits, health |
| `/inhalte` | Content index | Embeds the live site with an edit overlay |
| `/inhalte/:type` | Content list | Search, reorder, duplicate, hide, delete |
| `/inhalte/:type/:id` | Content editor | Form generated from the content type's schema |
| `/freigaben` | Reviews | Approve/reject with a diff |
| `/veroeffentlichen` | Publish | Pending-change diff, snapshot history, restore |
| `/medien` | Media | Grid, folders, upload, replace, detail, bulk delete |
| `/bewerbungen` | Applications | List, detail, status, dossier download |
| `/benutzer` | Users | Invite, edit, roles, reset link |
| `/rollen` | Roles | Permission matrix by category |
| `/einstellungen` | Settings | Grouped, secrets masked |
| `/audit` | Audit log | Filters, CSV export |
| `/profil` | Profile | Password change |

**Notable strength.** The dashboard KPI tiles show visitors, conversions, revenue and customers as
**explicitly unavailable** with a stated reason rather than as zeros
(`dashboard.controller.ts:127-132`, rendered by `KpiUnavailable`). A zero reads as a measurement.
This is exactly the right instinct and it should survive into the new system — the Finance and
Reports modules will be full of figures that are not yet connected.

**Missing.** Forms are generated from the content schema, which is right for content and will not
carry business forms — there is no general form abstraction (no resolver, no schema validation
library, no dirty tracking, no unsaved-changes guard on navigate).

**Performance.** All 11 pages are **statically imported** in `src/admin/App.tsx:10-17`. The dashboard
ships as one 153 kB chunk. At 19 modules with detail tabs this becomes a multi-megabyte first load.
See **F-12**.

---

### 2.14 Scheduled jobs (`server/src/tasks/`)

**Status.** Working, with one dead feature.

In-process `@Cron` timers guarded by an optional Redis lock. `main.ts:254` refuses to start in
cluster mode without `REDIS_URL`, because scheduled publishing is not idempotent and four workers
would produce four snapshots seconds apart with no error anywhere. That is a well-chosen fail-fast.

The scheduled-publish job reads and clears `ContentEntry.scheduledAt` — which nothing ever sets.

---

### 2.15 Build, tooling and process

**There is no test runner, linter or formatter.** Nothing in either `package.json` pulls in vitest,
jest, eslint, prettier or playwright. The automated gates are `npm run build`, `npm run server:build`
and `npm --prefix server run typecheck`, and they catch type errors only.

For the current system — a design study with an unusually disciplined author and exhaustive
in-code documentation — that has evidently worked. For a system with invoices, time sheets, budgets
and approval chains it is the largest single process risk in this audit. See **F-17**.

**Two source files contain a literal NUL byte** (verified: exactly one each in
`src/components/ProjectRegister.tsx` and `src/components/TeamGrid.tsx`, the `ALLE` filter sentinel).
Git classifies both as binary: `git diff` prints "Binary files differ", `git add -p` cannot stage
them by hunk, and review tooling sees no change. The sentinel works and re-typing the line by hand
silently degrades it to a plain `"alle"`. See **F-19**.

---

## 3. Findings register

Severity is about this system as it stands *and* about the risk it carries into the target system.

| # | Sev | Area | Finding |
| --- | --- | --- | --- |
| F-01 | **Critical** | Scope | No operational domain model exists. §0. |
| F-02 | **High** | Security | SVG upload + same-origin static serving + CSP disabled → stored XSS on the API origin, where the refresh cookie lives. |
| F-03 | **High** | Correctness | 24 of 26 settings are write-only. `workflow.requireApproval` reads as a governance control and is inert. |
| F-04 | Medium | Security | `X-Forwarded-For` trusted unconditionally; audit-log IPs are attacker-controlled. |
| F-05 | Medium | Scalability | Rate limiter has no shared storage; limits are per-process. `RedisService.raw()` is dead code. |
| F-06 | Medium | RBAC | 12 of 51 permissions are enforced nowhere yet selectable in the role editor. |
| F-07 | Medium | Security | No client-side route authorisation; `renderRoute` renders every page to every signed-in user. |
| F-08 | Medium | Security | MFA scaffolding present (columns, setting, dependency), implementation absent. |
| F-09 | Low | Clarity | Access-token `v` claim documented as role-change versioning; hardcoded to `1`, never read. |
| F-10 | Low | Clarity | `bearer()` accepts an `access_token` cookie that nothing sets. |
| F-11 | Medium | Dead weight | `Notification` and `Redirect` tables have no implementation; `scheduledAt` is cleared but never set. |
| F-12 | Medium | Performance | No client cache/dedup; no route-level code splitting in the dashboard. |
| F-13 | Low | Performance | Content search is unindexed `jsonb` containment on two fixed paths. |
| F-14 | Medium | Design system | No dark mode; tokens are hardcoded hex with no CSS-variable layer. |
| F-15 | Medium | Design system | ~15 component categories the target UI needs do not exist. |
| F-16 | Low | Design system | `cn()` has no tailwind-merge; call-site overrides are order-dependent. |
| F-17 | **High** | Process | No test runner, linter or formatter. Two typecheck gates are the only automation. |
| F-18 | Low | RBAC | Seeded roles are CMS roles; the requested engineering-company roles do not exist. |
| F-19 | Low | Tooling | Two source files are binary to git because of a NUL sentinel. |
| F-20 | — | UX decision | Rail shows groups only; spec asks for expandable groups. Needs a decision, not a default. |
| F-21 | **High** | Correctness | *(added in revision)* Both dashboard download links — audit CSV and application dossiers — return 401 and have never worked. |
| F-22 | **High** | Correctness | *(added in revision)* The settings page cannot save. `value` is stripped by the validation pipe; the endpoint answers 200 and the audit log records a change that did not happen. |

### F-21 and F-22 in detail *(added in revision)*

Neither was in the audit as first written, and the reason is worth recording: both are **runtime**
failures on paths that read correctly. A source-only review sees a guarded route and a link to it, or
a DTO and a service that writes it, and both look right. This is the concrete cost of the missing
browser/API pass noted in §7.

**F-21 — the download links send no credential.** `api.ts` carried the comment "the link carries the
session cookie and the server checks the permission on the way through". There is no such cookie: the
only one issued is `refresh_token`, scoped to `path=/api/v1/auth`. `JwtAuthGuard` had an
`access_token` cookie fallback that would have covered it, and nothing has ever set that cookie
either (**F-10** — which turned out not to be merely dead, but dead in a load-bearing place).

```
GET /api/v1/audit/export   (browser, session cookies) -> 401
GET /api/v1/audit/export   (Authorization: Bearer …)  -> 200, 15'350 bytes
```

It failed silently because a failed navigation is not something the page can catch — the operator
clicked and nothing happened.

**F-22 — the settings page cannot save.** `SettingUpdate.value` in `settings.controller.ts` carried
**no class-validator decorator**, and the global pipe runs with `whitelist: true`, which strips
exactly that. The service then wrote `value: undefined`, which Prisma reads as "leave this column
alone".

```
PATCH /api/v1/settings  {updates:[{key:"applications.retentionDays", value:999}]}
  -> 200
  -> audit row: settings.updated by admin@iem.ch, after {"keys":["applications.retentionDays"]}
  -> stored value: still 180
```

A success response, an audit entry asserting the change, and no change. This is the **second**
occurrence of the identical trap in this codebase — the first is written up in `CLAUDE.md` against
the content DTOs, where it blanked the editor. A scan of every class property in `server/src` found
no third instance.

### F-02 in detail

`media.service.ts:34` admits `image/svg+xml`. SVG has no magic number, so it is admitted on the
declared type plus an `<svg>`/`<?xml` root check — which is the best available check and does not
stop script inside the SVG. `main.ts:42-47` disables `contentSecurityPolicy` for this process, with a
stated reason ("serves JSON and file downloads, never HTML") that the media mount makes untrue.
Uploaded files are served by `express.static` from the API origin with their stored MIME type.

The chain: a user holding `media.upload` (Content Editor and above) uploads a scripted SVG. If an
administrator **navigates directly to** that `/media/<year>/<name>.svg` URL, the script executes on
the API origin. The refresh cookie is scoped to `path=/api/v1/auth` (`auth.controller.ts:70`), and a
same-origin `fetch('/api/v1/auth/refresh')` matches that path — so the script can mint an access
token and act as that administrator.

Mitigating: an `<img>` tag does not execute SVG script, so the media grid's thumbnails are safe;
direct navigation is required. Not mitigating: "open in new tab" on a media item is an ordinary thing
for an operator to do.

Fixes, cheapest first: (a) send `Content-Security-Policy: default-src 'none'` and
`Content-Disposition: attachment` on `image/svg+xml` responses; (b) sanitise SVG on upload; (c) drop
SVG from `ALLOWED` and rasterise; (d) serve media from a separate origin. (a) is one middleware and
closes it.

---

## 4. What is genuinely good, and must survive the redesign

Recording this deliberately, because a rewrite that discards it would be a net loss:

1. **Deny-by-default authorisation with a code-owned permission catalogue.** Adding a controller
   without thinking about auth produces a locked route, not an open one.
2. **Per-request permission resolution.** Revocation is immediate. Keep it; it is a read Postgres
   serves from cache.
3. **Super Admin by role key, not by permission set.** Adding a permission cannot de-power the
   recovery account.
4. **The unconditional `{ data: … }` envelope**, and the documented reason a shape test is
   forbidden. The `ContentEntry.data` collision is the kind of bug that costs a day.
5. **Explicit, scrubbed, non-throwing, non-blocking audit logging with before/after.**
6. **Refresh-token rotation with reuse detection.**
7. **Magic-byte type sniffing, EXIF stripping, checksum dedup, positive-match media allowlist.**
8. **Navigation as data, filtered by permission.** This scales to 19 modules essentially unchanged.
9. **"No data source" tiles instead of fabricated zeros.**
10. **The in-code documentation standard.** Nearly every non-obvious decision carries the reason and
    the failure it prevents. This is why the audit could be this specific. It must not lapse.

---

## 5. Gap analysis against the requested architecture

| Requested area | Exists? | Nearest thing today |
| --- | --- | --- |
| Dashboard | Partial | One CMS overview, not role-based, widgets not configurable |
| Projects | **No** | `projects` content type = public marketing case studies |
| Customers (CRM) | **No** | — |
| Offers | **No** | — |
| Orders | **No** | — |
| Planning | **No** | — |
| Tasks | **No** | — |
| Calendar | **No** | — |
| Documents | Partial | Media library: folders, versions, tags, soft delete. No approvals, comments, previews, recycle bin |
| BIM / CAD | **No** | Offline Python toolchain in `cad/`, not connected to the app |
| Employees | **No** | `team` content type = public portraits; `User` = login accounts |
| Time Tracking | **No** | — |
| Resources | **No** | — |
| Quality | **No** | — |
| Finance | **No** | — |
| Reports | **No** | Audit CSV export only |
| Company | Partial | Settings has `company.*` keys — all inert (F-03) |
| Administration | **Yes** | Users, roles, permissions, audit. Missing: API keys, backups, feature flags, MFA, system logs |
| Settings | Partial | Global settings exist; per-user preferences do not (no language, theme, notification or a11y prefs) |

Role coverage: Super Admin ✓, HR ✓ (CMS-scoped). Management, Project Manager, Engineer, Draftsman,
Administration, Finance — none exist.

---

## 6. Recommended sequencing

This is a recommendation, not a decision. The scope above is a multi-quarter programme; what follows
is the order that minimises rework and gets something usable soonest.

**Stage 0 — close the audit's own findings (small, independent, no design dependency).**
F-02, F-03, F-04, F-05, F-09, F-10. Each is hours, not days, and F-02/F-03 are things that would be
embarrassing to carry into a larger system.

**Stage 1 — foundations the whole programme depends on.**
Test runner + linter + formatter (F-17). CSS-variable token layer and dark mode (F-14).
tailwind-merge in `cn()` (F-16). Route-level code splitting and a data-fetch cache (F-12). Nested
routing. Client-side route authorisation (F-07). New roles (F-18). These are all changes to *existing*
code and they are cheapest now, before 19 modules depend on them.

**Stage 2 — the domain core.**
`Customer`/`Contact`, `Project` (the operational one, deliberately separate from the `projects`
content type and named so nobody confuses them), `Employee`, `Task`, `TimeEntry`. Plus the component
library additions those five need. Nothing after this stage is cheap until it exists.

**Stage 3 onward — module by module**, each delivered whole: schema → permissions → API →
dashboard screens → seed → typecheck → commit, with the design decisions and changed files written up
per module as requested.

Two things worth settling before Stage 2 starts, because they change the schema:
multi-tenancy/locations (one company or several?), and whether time tracking must reconcile against a
payroll system that already exists.

---

## 7. Method and limits of this audit

Read in full: the Prisma schema, all 34 API source files, all 24 dashboard source files, the three
Tailwind/Vite/TS configs, both `package.json`s, `README.md` and the architecture doc's relevant
sections. Verified at runtime: both processes boot, the published snapshot, the 401 on a guarded
route, the media proxy, both typecheck gates, the production build and its bundle sizes.

Not covered: the Python CAD toolchain in `cad/` (offline, not part of the build, and not part of the
requested application); the IFC models; visual/browser QA of the dashboard, because no browser
automation was available in this session — every UI statement above comes from reading the source,
not from watching it run. A browser pass over the 11 dashboard screens is worth doing before Stage 1
and is the one gap in this audit's evidence.

*(added in revision)* That gap has already proved expensive. **F-21** and **F-22** were both found in
the first hour of Stage 0, by exercising endpoints rather than reading them, and both are High: two
download links that have never worked, and a settings page that reports success while saving nothing.
Both sit on code that reads correctly. Treat the remaining unexercised paths — the media upload and
replace flows, the review and publish screens, the reorder endpoint, the invitation flow end to end —
as unverified rather than as working, and exercise them before building on them. The first three
Stage 0 commits added the API-level habit; a browser pass is still owed.

`docs/PROJECT_IMPLEMENTATION_CHECKLIST.md` (14 September 2026) remains valid for the public site's
own coverage. It predates `server/` and knows nothing about the CMS; nothing in it is superseded by
this document, and nothing in this document is drawn from it.
