# Enterprise architecture

**Date:** 17 September 2026
**Status:** design. Nothing in Phases 3–8 is implemented; this document and its
three companions are the contract that the implementation will follow.

| Document | Covers |
| --- | --- |
| this file | current architecture, weaknesses, target architecture, folder structure, navigation, dashboards, UI system, migration |
| [`data-model.md`](./data-model.md) | every business entity, its fields, relationships, lifecycle and states, with an ER diagram |
| [`permissions.md`](./permissions.md) | the RBAC catalogue and the role × module × action matrix |
| [`roadmap.md`](./roadmap.md) | build order, complexity, dependencies, database and API impact |

It builds on [`system-audit.md`](./system-audit.md), whose §0 is the premise of
everything here: **the application today is a marketing website with a CMS
behind it, and contains no operational domain model.** Of the nineteen modules
this architecture must carry, one and a half exist.

---

## 1. Current architecture

### 1.1 The shape

```
index.html   ─→ src/main.tsx      ─→ App               the public site
stelle.html  ─→ src/stelle.tsx    ─→ StelleSeite       one job advert
admin.html   ─→ src/admin/main.tsx ─→ App              the dashboard
                                          │
                                          ▼
server/  NestJS · Prisma 7 · PostgreSQL · /api/v1
```

Content flows one way and only one way: editors write `ContentEntry` rows → a
publish assembles a single `ContentSnapshot` → the site fetches that document.
The public site never reads the content tables. That is the strongest idea in
the codebase and it is **orthogonal** to everything this architecture adds: the
enterprise modules are operational data, read live by authenticated users, and
must not touch the publish pipeline.

### 1.2 What is genuinely reusable

Measured, not assumed — line counts are from the current tree.

**Layout and shell** — `layout/AdminLayout.tsx` (377), `ui/Sidebar.tsx` (674).
Rail, top bar, responsive drawer, theme host, skip link. Reusable as-is; the
only change nineteen modules force is the shape of the navigation model it
renders, not the shell.

**Navigation as data** — `lib/navigation.ts` (446). Sections, zones, permission
filtering, favourites, search, `activeSection`, `flattenNavigation`. Already
builds itself from what the server reports. This scales to nineteen modules with
a different source list and no structural change, and is the single best-prepared
piece of the frontend.

**Component library** — `ui/primitives.tsx` (879) and `ui/data.tsx` (550).
Button, Field, Input, Select, Checkbox, Toggle, SearchInput, Card, PageHeader,
Badge, Tabs, Pagination, Breadcrumb, Modal, ConfirmDialog, EmptyState,
ErrorState, Skeleton, SkeletonTable, Spinner; DataTable, DataView, KpiCard,
KpiUnavailable, BarChart, ActivityFeed, WorkflowBadge, Swiss formatters. All
domain-free by rule — nothing in `primitives.tsx` imports the API client. §7
lists what is missing.

**Schema-driven forms** — `ui/FieldRenderer.tsx` (520). Renders a form from a
field-descriptor list. Today it is driven by `ContentType.schema`; the mechanism
is general and is the seed of the `EntityForm` in §7.

**Cross-cutting frontend services** — `lib/api.ts` request core (token
attachment, single-flight refresh, envelope unwrapping, `ApiError` with
per-field messages), `lib/auth.tsx`, `lib/router.tsx`, `lib/useAsync.ts`,
`lib/theme.ts`, `lib/cn.ts`, `ui/toast.tsx`, `ui/ErrorBoundary.tsx`.

**Server cross-cutting** — `common/http.ts` (envelope, error shape,
`paginate`), `common/decorators.ts` (`@Public`, `@RequirePermissions`,
`@CurrentUser`, `@ClientIp`), `auth/guards.ts` (deny-by-default JWT guard +
permission guard), `common/prisma.service.ts`, `common/redis.ts`,
`common/throttler.storage.ts`, `audit/audit.service.ts`, `mail/mail.service.ts`,
`media/storage.ts` (the `StorageAdapter` seam), `settings/settings.service.ts`.

**API patterns worth keeping** — the unconditional `{ data: … }` envelope; one
error shape with `code` + `fields`; path versioning; `Paginated<T>`; permissions
resolved per request; append-only audit with before/after; soft delete via
`deletedAt` everywhere.

**Data-model patterns worth keeping** — `deletedAt` on everything mutable;
`createdById`/`updatedById`; an append-only audit trail with denormalised actor
email; versioned rows where history matters.

### 1.3 Weaknesses

These are the things that would each become nineteen problems.

**W1 — The API client is one object.** `lib/api.ts` is 633 lines and every
endpoint is a property of a single `api` const. Nineteen modules would make it
~4'000 lines, every screen would import the whole surface, and the transport
types (`EntryRow`, `MediaRow`, …) live in the same file as the transport. There
is no per-feature slice and no seam for caching.

**W2 — No data-fetching cache.** `useAsync` re-runs on every mount, dedupes
nothing, caches nothing, and has no invalidation. Every list screen re-fetches
on every visit, and a mutation cannot tell a sibling screen that its data is
stale. At four screens this is invisible; at nineteen modules with cross-linked
records it is the dominant source of wrong data on screen.

**W3 — Pages bundle unrelated screens.** `pages/Operations.tsx` is 1'009 lines
and contains **four** screens — Applications, Settings, Audit, Profile.
`People.tsx` is Users + Roles; `Workflow.tsx` is Reviews + Publish. Layer-based
folders (`pages/`, `lib/`, `ui/`) put everything about one feature in three
places and everything about three features in one file.

**W4 — No entity layer.** Types are transport DTOs declared beside their fetch
function. There is no place for a business type, its invariants, its status
machine, its label, or its formatting — so each would be re-invented per screen.

**W5 — Every list endpoint re-implements listing.** `content.listEntries`,
`media.list`, `users.list`, `audit.list`, `applications.list` each hand-roll
page/perPage/search/where/count. A nineteen-module system needs one list
contract: filter, sort, paginate, and a consistent response.

**W6 — `DataTable` sorts client-side only.** Documented as deliberate for ≤200
rows. Projects, time entries and audit rows will not be ≤200. The `sortValue`
hook is the intended seam and nothing uses it yet.

**W7 — Permissions are a hand-written flat list.** 51 entries today, 12 of them
enforced nowhere. Nineteen modules × seven actions is 133; maintained by hand
that will drift, and the audit already shows drift at 51.

**W8 — `app.module.ts` is flat.** Six controllers and five services are declared
directly on the root module; only auth, media, mail and settings are real Nest
modules. Nineteen features declared this way is a root module nobody can read
and no boundary anywhere.

**W9 — No form abstraction.** `FieldRenderer` renders fields; there is no form
*state*: no dirty tracking, no unsaved-changes guard, no submit/validation
lifecycle, no server-error-to-field mapping beyond what each screen writes.

**W10 — No domain layer, on either side.** Business rules live in services
alongside Prisma calls. `ContentService` is 815 lines of workflow, validation,
persistence and audit — and the rules in it are good, they are simply not
reachable without a database. The frontend has the mirror problem: a rule would
land in a component or beside a `fetch`. Both halves need a pure layer that can
be tested with no mocks, and §3.1 is the answer on the client, `domain/` in
§3.2 on the server.

**W11 — The router has no nesting.** 175 lines, flat patterns, no nested
routes, no loaders, no scroll restoration. Every enterprise module is a
master/detail with tabs — `/projekte/:id/budget` — which is exactly what it
cannot express.

**W12 — No background job story.** `@Cron` in-process with a Redis lock, and
`main.ts` refuses to start clustered without Redis. Reports, exports and BIM
ingestion are long-running work that cannot live in a request.

---

## 2. Target architecture

### 2.1 Principles

1. **A feature owns its stack.** Its routes, screens, components, hooks, API
   slice, types and tests sit in one folder. Adding a module is adding a folder;
   deleting one is deleting a folder.
2. **Dependencies point inwards.** `features/*` may import from `shared`,
   `entities`, `core`. They may **not** import from each other. Cross-feature
   needs go through `entities` (types, labels, status) or an explicit, named
   integration in `core`.
3. **Entities are the shared vocabulary.** A `Project` type, its statuses, its
   label function and its zod schema live in `entities/project/` and are imported
   by Projects, Tasks, Time Tracking, Finance and Reports alike.
4. **The server mirrors it.** One Nest module per feature, each with its
   controller, service, DTOs and domain rules. `app.module.ts` lists modules,
   never controllers.
5. **Generic over bespoke.** A module that needs a table uses `DataTable`. If it
   cannot, the table changes — not the module. §7 exists so this is possible.
6. **Permissions are generated, not typed.** A module declares its resource and
   its actions; the catalogue is derived. 133 permissions nobody hand-maintains.
7. **Nothing that exists is broken to get there.** The CMS keeps working
   throughout; §8 is a migration in stages, each independently shippable.
8. **A pattern is proven once before it is copied.** Every layer ships with one
   fully tested reference implementation, and no second module adopts the shape
   until that one is validated — §3.1.1. An architecture error that reaches ten
   modules is ten modules to re-cut.
9. **A DTO stops at the mapper.** The wire format is a detail of the transport,
   and a detail that reaches a component is no longer a detail.

### 2.2 Layers

```
                 ┌─────────────────────────────────────────┐
   app/          │  entry, providers, router, error walls  │
                 └───────────────────┬─────────────────────┘
                                     │
                 ┌───────────────────▼─────────────────────┐
   features/     │  projects · customers · tasks · …       │   19 folders
                 │  routes · screens · hooks · api · parts │   no sibling imports
                 └────────┬─────────────────┬──────────────┘
                          │                 │
         ┌────────────────▼──────┐   ┌──────▼───────────────┐
 widgets/│ composed, cross-      │   │ entities/            │
         │ feature blocks        │   │ types · status ·     │
         │ (dashboard tiles)     │   │ labels · schemas     │
         └────────────────┬──────┘   └──────┬───────────────┘
                          │                 │
                 ┌────────▼─────────────────▼──────────────┐
   shared/       │  ui · hooks · utils · types             │  domain-free
                 └───────────────────┬─────────────────────┘
                                     │
                 ┌───────────────────▼─────────────────────┐
   core/         │  api client · auth · permissions ·      │
                 │  router · theme · query cache · config  │
                 └─────────────────────────────────────────┘
```

The rule that makes it hold: **an arrow never points upwards and never
sideways between features.**

---

## 3. Folder structure (Phase 2)

```
src/
  app/                        the dashboard application itself
    main.tsx                  entry: providers, root render
    App.tsx                   shell + route outlet
    providers.tsx             Auth, Theme, Toast, Query, ErrorBoundary
    routes.tsx                the route table, assembled from features
    styles/admin.css          tokens + component layer

  core/                       infrastructure. No domain knowledge.
    api/
      client.ts               request core: token, refresh, envelope, ApiError
      download.ts             authenticated blob downloads
      query.ts                cache, dedup, invalidation (W2)
      list.ts                 the shared list contract: filter/sort/page
    auth/
      AuthProvider.tsx        session, can(), canAny()
      useAuth.ts
    permissions/
      catalog.ts              generated from module declarations (W7)
      can.ts                  the client-side check
    router/
      router.tsx              nested routes, params, guards (W11)
      breadcrumbs.ts
    theme/
      theme.ts                light/dark/system
    config/
      env.ts

  entities/                   the shared business vocabulary. No UI, no fetch.
    project/  { types.ts  status.ts  labels.ts  schema.ts  index.ts }
    customer/ contact/ building/ offer/ contract/ task/ meeting/
    document/ employee/ department/ time-entry/ resource/ invoice/
    notification/ user/ role/
    index.ts

  features/                   one folder per module. Owns its whole stack.
    projects/
      index.ts                the feature's public surface: routes + nav
      routes.tsx              this feature's routes + permissions
      dto.ts                  the wire shapes. Imported by repository + mapper
      repository.ts           HTTP only — the one file that knows URLs  §3.1
      mapper.ts               DTO ⇄ entity. The DTO boundary ends here
      service.ts              domain only — pure rules, no React, no fetch
      validators.ts           form rules, shared by create and edit
      events.ts               the server events this feature reacts to
      types.ts                feature-internal types. The *entity* is in entities/
      hooks/                  useProjects, useProject, useProjectBudget
      screens/                ProjectList, ProjectDetail, ProjectCreate
      components/             ProjectStatusBadge, ProjectHealthBar
      __tests__/
    customers/ contacts/ buildings/ offers/ contracts/ planning/
    tasks/ calendar/ meetings/ documents/ bim/ employees/ time-tracking/
    resources/ finance/ reports/ company/ administration/ settings/
    dashboard/
    content/                  the existing CMS, moved wholesale
    media/                    the existing media library

  widgets/                    composed blocks that span features
    dashboard/                the role dashboards' tiles
    activity/                 the audit feed
    search/                   global search

  shared/                     domain-free, reusable, testable in isolation
    ui/                       the design system — §7
      primitives/  data/  forms/  overlays/  charts/  views/
    hooks/                    useDebounced, useDisclosure, useLocalStorage
    utils/                    format, date, number, file, sort
    types/                    Paginated<T>, ApiError, ID, Money

  components/                 the PUBLIC SITE's components. Unchanged.
  content/                    the PUBLIC SITE's content layer. Unchanged.
  lib/                        the public site's cn/tokens/search. Unchanged.
```

**The public site is not touched.** `src/components`, `src/content`, `src/lib`,
`src/App.tsx`, `src/main.tsx`, `src/stelle.tsx` stay exactly where they are.
They are a different application that happens to share a repository, their
stylesheet is the one every visitor downloads, and its content hash has been
unchanged through ten commits. Moving them would buy nothing and risk that.

### 3.1 Five layers inside a feature

The first draft gave each feature a single `api.ts`. That is three layers too
few: it leaves transport, wire format, domain rules and React state in one file,
so an API change reaches the components and the rules cannot be tested without
mocking `fetch`.

```
repository.ts   HTTP only. URLs, methods, status codes. Speaks DTOs.
      ↓         Returns wire shapes; knows nothing about the domain.
mapper.ts       Translation only. DTO → entity and entity → DTO.
      ↓         The last file in which a DTO type is legal.
service.ts      Domain only. Pure functions over entity types —
      ↓         canTransition(), deriveHealth(), validatePhaseApproval().
                No React, no fetch, therefore testable with no mocks at all.
hooks/          React only. Cache keys, loading state, invalidation,
      ↓         optimistic updates. Calls the repository through the mapper.
screens/        Rendering only. No fetch call and no rule. Never sees a DTO.
```

| Layer | Changeable without touching | Tested with |
| --- | --- | --- |
| `repository` | screens, hooks, rules, mapping | a stubbed client |
| `mapper` | everything above and below it | plain unit tests, no mocks |
| `service` | transport, wire format and UI | plain unit tests, no mocks |
| `hooks` | screens | the cache + a stubbed repository |
| `screens` | — | render tests and Playwright |

**The mapper was added after domain review and it is the layer that makes the
rest hold.** Without it `repository.ts` returns wire shapes straight into the
hooks and the DTO reaches the components anyway — the split exists on paper and
not in the import graph. The rule is therefore stated as a boundary, not as a
folder:

> **A DTO type may be named in `repository.ts` and `mapper.ts` and nowhere
> else.** Not in a hook, not in a screen, not in `entities/`.

That single rule is what buys the thing the review asked for: an API change
— a renamed field, `snake_case` becoming `camelCase`, a date arriving as a
string, one endpoint splitting into two — is absorbed in two files whose tests
run in milliseconds. It also removes the most common class of bug in a system
like this, the one where `"2026-03-14"` is compared to a `Date` and nothing
throws. The mapper is where the string becomes a `Date`, the `"1450.00"` becomes
a number, the `null` becomes `undefined`, and the open enum becomes a closed
one.

`service.ts` is the layer that matters most and the one easiest to skip. The
transitions table, the derived `health`, the four-eyes check on a phase approval
— all pure, and all belonging somewhere testable without a browser or a server.
The **server holds the authoritative copy of every rule**; the client's exists so
a button that would be refused is disabled rather than clicked.

**A feature with no domain logic omits `service.ts`.** Disciplines is master
data; inventing an empty service for symmetry is ceremony. **`mapper.ts` is not
optional**, even when it is nearly an identity function: it is the seam, and a
seam that exists only when convenient is not a seam. An identity mapper is four
lines and one test, and the day the API changes it is the only file that moves.

### 3.0.1 One shape for every feature, and two names that did not survive

The firm set the rule that every feature has the same folders, and it is right:
at twenty modules, the value of a layout is that a reader who has seen one has
seen them all. The list above is that shape, with two deliberate differences
from the one proposed, and both are worth stating rather than quietly applying.

**`api/` and `repositories/` are the same folder.** A feature has one thing
that speaks HTTP and one file is enough for it; two names for it would have
people guessing which half a call belongs in. It is `repository.ts`, because
that is what the five layers call it.

**`pages/` is `screens/`, and that is not a preference.** `pages/Operations.tsx`
in the old structure was 1'009 lines and held *four* unrelated screens —
Applications, Settings, Audit and Profile. The word "page" is what made that
seem reasonable; a page is a place you put things. A **screen is one route**,
and calling it that is the rule rather than a label for it. Renaming the folder
back would reintroduce the word that carried the anti-pattern.

**A file until it needs to be a folder.** `repository.ts` becomes
`repository/` the day a feature genuinely has two — Projects will, for the
project and its members. A folder with one file in it is ceremony; the split is
allowed and it is not mandatory, and `architecture.test.ts` accepts either.

**A feature omits what it has nothing to put in.** `service.ts` when there are
no domain rules, `events.ts` when it listens for nothing. The one exception
stays `mapper.ts`: a seam that exists only when convenient is not a seam.

### 3.1.1 The reference-implementation gate

**Set by the firm at review, and adopted verbatim:**

> Every architectural layer — Repository, Mapper, Service, Hooks and UI — must
> include at least one fully tested reference implementation before migrating
> additional modules. Do not duplicate patterns until the reference
> implementation has been validated.

It is the right constraint and it is cheap to state, so it is written here as a
gate rather than as advice:

| Gate | Satisfied by |
| --- | --- |
| The five layers exist, in one feature, end to end | the reference feature, not a sketch |
| Each layer has tests that fail if the layer is bypassed | not just tests that pass |
| The DTO boundary is enforced by a test, not by discipline | a lint rule or an import test |
| The feature's screens pass axe and the Playwright matrix | `npm run e2e` |
| Only then does a second feature adopt the shape | reviewed against the reference |

The cost of getting this wrong is the reason: a shape copied into ten modules
before it has been driven once is ten modules to re-cut, and the mistake will
not be in the parts anybody looked at.

**The reference is built on an existing feature, not an invented one.** The
foundation stages may not ship business modules, so the pattern is proven by
migrating something the application already runs and the e2e suite already
covers — which also means the gate is enforced by tests that existed before the
pattern did.

### 3.2 Server structure

```
server/src/
  main.ts  app.module.ts
  common/       http · decorators · prisma · redis · throttler · storage
  core/
    list/       the shared list contract: DTO, where-builder, paginate (W5)
    domain/     base types: Money, DateRange, StatusMachine
    events/     the in-process domain event bus
    jobs/       the queue seam (W12)
  modules/      one Nest module per feature, mirroring features/
    projects/   projects.module.ts
                projects.controller.ts    HTTP, DTOs, guards
                projects.service.ts       orchestration, transactions,
                                          audit, domain events
                projects.repository.ts    Prisma access, list contract,
                                          the where-builder
                projects.mapper.ts        Prisma row ⇄ domain type; the
                                          server's DTO boundary, and where
                                          Decimal stops being a Decimal
                domain/                   pure rules — the same transitions
                                          table the client's service holds
                dto/
    customers/ contacts/ buildings/ offers/ contracts/ planning/
    tasks/ calendar/ meetings/ documents/ bim/ employees/ time-tracking/
    resources/ finance/ reports/ company/
    auth/ users/ rbac/ audit/ settings/ mail/ media/ content/ applications/
  rbac/
    resources.ts   each module's resource + actions
    catalog.ts     PERMISSIONS, derived from resources.ts (W7)
```

---

## 4. Navigation blueprint (Phase 5)

### 4.1 The model

`navigation.ts` already expresses sections, zones, permissions, badges, exact
matching and search. The enterprise version keeps every one of those and adds
two fields:

```ts
type NavSection = {
  id, label, icon, zone, to?, permissions, badge?, exact?, hideBarTitle?,
  items: NavItem[],
  /** NEW: pinned above the zones, ordered, for the three or four a role lives in. */
  primary?: boolean,
  /** NEW: hidden until the feature ships, so the blueprint can land before the module. */
  comingSoon?: boolean,
};
```

### 4.2 Zones and order

The rail's order is the working day, not the database — the rule the current
rail already follows. With nineteen modules the zones become five:

| Zone | Contains | Why here |
| --- | --- | --- |
| *(unlabelled)* | Dashboard, Tasks, Calendar, Notifications | What is waiting for you |
| **Projekte** | Projects, Planning, Meetings, Documents, BIM/CAD, Quality | The work |
| **Kunden** | Customers, Contacts, Buildings, Offers, Contracts | Who it is for |
| **Betrieb** | Employees, Time Tracking, Resources, Finance, Reports | Running the firm |
| **Verwaltung** | Website (the CMS), Media, Applications, Company, Administration, Settings | Administering it |
| *hidden* | My account | Searchable, never drawn |

The existing CMS collapses into one **Website** group under Verwaltung: thirty-six
content types become one rail row with a fold, which is what the fold was built
for.

### 4.3 Per width

| | Desktop ≥1024 | Tablet 768–1023 | Mobile <768 |
| --- | --- | --- | --- |
| Rail | pinned, 12.96rem, groups fold | off-canvas drawer | off-canvas drawer |
| Collapsed rail | **new**: 3.5rem icon rail, labels on hover | n/a | n/a |
| Top bar | group name · breadcrumbs · quick actions · search · account | name · search · account | toggle · name · account |
| Context nav | tabs across a detail record | tabs, scrollable | tabs, scrollable |
| Breadcrumbs | full path | last two | current only |
| Quick actions | inline buttons | overflow menu | floating action button |
| Global search | ⌘K palette + inline box | ⌘K | full-screen sheet |

All three are already exercised by the Playwright matrix; the collapsed rail is
the one genuinely new state and needs its own case.

### 4.4 Context navigation

A detail record is `/<module>/:id/<tab>`. The tabs are the record's own sections
and render in the sticky top bar beneath the breadcrumb — this is where the
segmented control removed in the rail rework returns, correctly, because now it
describes *one record* rather than duplicating the menu.

```
Projekte  ›  4723 Guglera  ›  Budget
[Übersicht] [Team] [Aufgaben] [Termine] [Meilensteine] [Budget] [Zeit] …
```

### 4.4.1 The project is the container, not the owner

Set by the firm, and it resolves a tension the tab strip above would otherwise
hide. A project's detail screen shows fourteen things, and **eight of them
belong to *other modules*** — as built:

```
/projekte/:id/…
  uebersicht  team  gewerke  termine  kunde  gebaeude
  ───────────── the project module owns these six ─────────────
  phasen  aufgaben  sitzungen  dokumente  plaene  bim  finanzen  aktivitaet
  ────────── embedded from the module that owns them ──────────
```

The split moved by two from the draft above it, and in the honest direction:
`phasen` is Wave 1 module 5 and `aktivitaet` is the audit log filtered by
project. Both looked like the project's own until it was time to write them, and
neither is — a phase has a fee, deliverables and a client sign-off, and the
activity feed is the audit module's data with a `resourceId` on it.

The list is **data**, in `features/projects/screens/tabs.ts`, rather than a
`switch` in the detail screen: replacing a placeholder with a real screen is
then a one-line change, and the roadmap and the navigation cannot disagree about
what is coming.

**The distinction is ownership, not placement.** `features/projects` does not
fetch tasks, does not know a task's statuses and does not import
`features/tasks` — that would be the mesh `features/README.md` forbids. The tab
renders a **widget** the owning feature exports, scoped by `projectId`:

**Two of the six it owns are the clearest case of the rule**, and they are worth
naming because they look like exceptions and are not. `kunde` and `gebaeude`
show the project's *link* to those records — the Bauherrschaft's name and
number, the object's SIA 416 figures — and then a `ModulePlaceholder` for the
module that will own the rest. Neither record is the project's data: a customer
exists before the project and outlives it, and a building outlives every project
on it, which is the whole reason it is an entity and not an address field.

```
widgets/project-tabs/TasksTab.tsx   →  imports features/tasks' public surface
```

`widgets/` is the folder for exactly this, and it is why it exists: a block that
spans features, composed by neither of them. The alternative — Projects
importing seven siblings — is the architecture failing in the first module.

### 4.4.2 A tab for a module that does not exist yet

**No empty tabs**, and no hidden ones either. A tab that vanishes teaches the
reader the feature is not planned; a tab that is blank teaches them it is
broken. Both are wrong, and the second is worse in a demonstration.

Every not-yet-built tab renders the same `ModulePlaceholder`: the module's name,
one sentence on what will be there, a status (`Geplant` / `In Entwicklung`), and
**the card and column layout the real screen will use**. That last part is the
one that is easy to skip and the reason this is specified rather than left to
taste — a placeholder that looks nothing like the eventual screen makes the
navigation feel provisional, and when the module lands the page appears to jump.

It is the same principle `KpiUnavailable` already applies to a figure with no
source: state the gap rather than showing a zero, and state it in the shape the
answer will take.

### 4.5 Breadcrumbs, quick actions, favourites, search

- **Breadcrumbs** derive from the route table — each route declares
  `crumb: (params, data) => string`. No parallel structure to maintain.
- **Quick actions** are declared per route (`actions: [{ label, permission,
  run }]`) so the top bar renders them and the ⌘K palette can offer the same
  set. One declaration, two surfaces.
- **Favourites** already work per browser; unchanged, now covering records as
  well as screens (`project:clx…`).
- **Global search** becomes a server endpoint per module — each feature module
  registers a `search(term, user)` that returns `{ kind, id, label, href }`,
  permission-filtered. The palette is a shared widget.

---

## 5. Dashboard blueprint (Phase 6)

One `/` route; the widgets on it are chosen by permission, not by role name.
That is the same rule the rail already follows and it is what makes a custom
role built in the role editor get a sensible dashboard with nobody editing code.

The role columns below are therefore a *description of what those roles will
see*, not a switch statement.

| Widget | Needs | Management | Proj. Mgr | Engineer | Draftsman | HR | Finance | Admin |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| My open tasks | `task.read` | ○ | ● | ● | ● | ● | ○ | ○ |
| My week (calendar) | `calendar.read` | ● | ● | ● | ● | ● | ○ | ○ |
| Time not yet booked | `timeEntry.create` | ○ | ● | ● | ● | ● | ○ | ○ |
| My projects | `project.read` | ○ | ● | ● | ● | ○ | ○ | ○ |
| Deadlines (14 d) | `project.read` | ● | ● | ● | ○ | ○ | ○ | ○ |
| Project health | `project.read` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| Budget usage | `finance.read` | ● | ● | ○ | ○ | ○ | ● | ○ |
| Revenue & forecast | `finance.report` | ● | ○ | ○ | ○ | ○ | ● | ○ |
| Open invoices / receivables | `invoice.read` | ● | ○ | ○ | ○ | ○ | ● | ○ |
| Resource utilisation | `planning.read` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| Capacity next 4 weeks | `planning.read` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| Absences & vacation | `absence.read` | ● | ● | ○ | ○ | ● | ○ | ○ |
| Headcount & skills | `employee.read` | ● | ○ | ○ | ○ | ● | ○ | ○ |
| Open offers / pipeline | `offer.read` | ● | ○ | ○ | ○ | ○ | ● | ○ |
| Risks needing attention | `risk.read` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| Recent drawings | `bim.read` | ○ | ● | ● | ● | ○ | ○ | ○ |
| Documents awaiting approval | `document.approve` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| Applications (new) | `application.read` | ○ | ○ | ○ | ○ | ● | ○ | ● |
| Content awaiting review | `content.approve` | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| System health | `system.health` | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| Recent activity | `audit.read` | ● | ○ | ○ | ○ | ○ | ○ | ● |

● default on · ○ available, off by default

**Configurability** — the spec asks for reorder, resize, hide and restore
defaults. The model: a widget declares `id`, `permission`, `defaultSpan` (1–4
columns) and `defaultOrder`; the user's arrangement is a per-user JSON
preference, stored server-side so it follows the account rather than the
browser. Restoring defaults deletes the row.

**The honest-gap rule carries over.** `KpiUnavailable` exists because the
current dashboard shows visitors, conversions and revenue as explicitly
unmeasured rather than as zeros. Every figure above that has no source yet gets
the same treatment. A fabricated KPI on the first screen would undo the argument
the whole system rests on.

---

## 6. UI system (Phase 7)

### 6.1 What exists

`Button` `Spinner` `Skeleton` `SkeletonTable` `EmptyState` `ErrorState` `Card`
`PageHeader` `Badge` `Field` `Input` `Textarea` `Select` `Checkbox` `Toggle`
`SearchInput` `Tabs` `Pagination` `Breadcrumb` `Modal` `ConfirmDialog`
`DataTable` `DataView` `KpiCard` `KpiUnavailable` `BarChart` `ActivityFeed`
`WorkflowBadge` `ApplicationBadge` · Swiss formatters · `FieldRenderer` ·
`ToastProvider` · `ErrorBoundary`

### 6.2 What must exist before a module is built

| Family | Components | Notes |
| --- | --- | --- |
| **Data tables** | `DataTable` (extend), `ColumnDef`, `TableToolbar`, `BulkBar`, `ColumnPicker`, `SavedViews` | Server sort + filter (W6); column pin/resize; row selection already present |
| **Detail views** | `DetailLayout`, `DetailHeader`, `DetailTabs`, `PropertyList`, `RelatedList`, `ActivityTimeline` | The master/detail frame all 19 modules share |
| **Cards** | `Card` (have), `StatCard`, `MetricCard`, `EntityCard`, `CardGrid` | |
| **Charts** | `BarChart` (have), `LineChart`, `AreaChart`, `DonutChart`, `Sparkline`, `ProgressRing`, `ChartLegend`, `ChartTooltip` | Finance and Reports force real charting; pick one library and wrap it so call sites never import it |
| **Forms** | `Form`, `FormField`, `FormSection`, `FormActions`, `useForm`, `EntityForm` | Dirty tracking, unsaved-changes guard, server-error→field mapping (W9). Built on `FieldRenderer` |
| **Inputs** | `DatePicker`, `DateRangePicker`, `TimePicker`, `Combobox`, `MultiSelect`, `EntityPicker`, `MoneyInput`, `NumberInput`, `RichText`, `FileDropzone`, `TagInput` | `EntityPicker` is the one that matters: "pick a customer" appears in a dozen modules |
| **Filters** | `FilterBar`, `FilterChip`, `FacetFilter`, `DateRangeFilter`, `useFilters` | Filters serialise to the URL so a filtered list is linkable |
| **Overlays** | `Modal` (have), `ConfirmDialog` (have), `Drawer`, `SidePanel`, `Popover`, `Menu`, `Tooltip`, `CommandPalette` | `Drawer` is the quick-edit surface that keeps the list behind it |
| **Wizards** | `Wizard`, `WizardStep`, `useWizard` | Offer creation, project setup, BIM import |
| **Timeline** | `Timeline`, `TimelineItem`, `Milestones` | |
| **Kanban** | `KanbanBoard`, `KanbanColumn`, `KanbanCard`, `useDragDrop` | Tasks, offers |
| **Gantt** | `GanttChart`, `GanttRow`, `GanttBar`, `DependencyArrow` | Planning. The single most expensive component here |
| **Calendar** | `CalendarMonth`, `CalendarWeek`, `CalendarDay`, `EventChip`, `ResourceCalendar` | |
| **File manager** | `FileTree`, `FileList`, `FileCard`, `Uploader`, `FilePreview`, `VersionList` | Documents and BIM; the media library is its ancestor |
| **Feedback** | `Toast` (have), `InlineAlert`, `ProgressBar`, `StatusDot`, `EmptyState` (have) | |

### 6.3 The rules that keep it one system

1. **No domain knowledge in `shared/ui`.** The rule `primitives.tsx` already
   states, extended to the whole folder. A component that needs to know what a
   project is belongs in `features/projects/components/`.
2. **Tokens only.** No literal colour, ever. `theme.tokens.test.ts` enforces the
   three-way agreement between declaration, config and use.
3. **Contrast is tested, not judged.** `theme.contrast.test.ts` covers every new
   foreground/background pair, including the composition it actually renders in —
   the badge-on-wash finding is why that qualification is in this sentence.
4. **Every overlay is a native `<dialog>` or a real popover.** The platform
   gives the focus trap, the top layer and Esc.
5. **A module may not write a table, a form or a dialog of its own.** If the
   shared one cannot do it, the shared one changes.

---

## 7. Cross-cutting decisions

### 7.1 Data fetching (W2)

A small query cache in `core/api/query.ts`: keyed by `[resource, params]`,
in-flight dedup, stale-while-revalidate, and `invalidate(resource)` called by
mutations. `useAsync` stays for the uncached cases and is re-implemented on top
of the cache for the rest. **Not a new dependency unless it earns one** — the
project has written its own router, throttler store and class merger for the
same reason. The decision point is documented in `roadmap.md` Stage F.

### 7.2 The list contract (W5)

One DTO and one response shape for every collection endpoint:

```
GET /api/v1/<resource>?
      page, perPage, sort=<field>:<asc|desc>, q=<search>,
      filter[<field>]=<op>:<value>          eq, ne, in, gt, gte, lt, lte, like, between
  →   { data: { items, total, page, perPage, pages } }
```

`core/list/` on the server turns that into a Prisma `where`/`orderBy` with an
allowlist of filterable fields per resource — an allowlist, because a filter
parameter that reaches Prisma unchecked is a query-injection surface.

**The nine capabilities every list has**, set by the firm and worth listing in
full, because the point of a contract is that no module gets to decide it has
eight of them:

| | Where it lives | Note |
| --- | --- | --- |
| Server-side pagination | `core/list` | |
| Server-side filtering | `core/list` + a per-resource allowlist | |
| Server-side sorting | `core/list` + a per-resource allowlist | |
| Full-text search | the resource's `searchable` fields | Postgres `tsvector` where volume needs it, `contains` where it does not |
| Multiple filters at once | `filter[a]=…&filter[b]=…` | ANDed; a repeated field is ORed |
| Column selection | `shared/ui/data` | Client-side. The server always sends the row |
| A saved view | `ListPreference`, per user and resource | Server-side, so it follows the account rather than the browser |
| Export | `GET /<resource>/export` | **Honours the same filters**, or the export and the screen disagree |
| Bulk actions | `shared/ui/data` + `POST /<resource>/bulk` | |

Three of those carry a decision rather than an implementation.

**Column selection is client-side and the server still sends every field.**
Letting the client ask for a subset would make the response shape depend on the
query, which breaks the mapper's contract — `toProject(dto)` has to know what
it is receiving. The saving would be bytes on a row that is already small; the
cost would be a DTO that is sometimes partial, which is the kind of type nobody
can rely on.

**A saved view is server-side.** A column arrangement that lives in
`localStorage` is lost when the person opens the dashboard on the other machine
in the meeting room, which is exactly when they need it. It is a row keyed by
user and resource, and deleting it restores the default.

**Export honours the filters that are on screen.** It is written here rather
than left to each module because the failure is silent and serious: an audit
CSV that quietly contains more than the filtered view is a document somebody
will act on. `/audit/export` already does this and its e2e test asserts it.

### 7.3 Permissions (W7)

Each server module declares its resource:

```ts
// modules/projects/projects.permissions.ts
export const PROJECT = resource("project", ["read","create","update","delete","export","approve","manage"]);
```

`rbac/catalog.ts` derives `PERMISSIONS` from those declarations. The seeder
reconciles as it does today. The frontend imports the generated key list, so a
typo in a route guard fails a test rather than silently granting nothing —
which is the state twelve permissions are in right now.

### 7.4 Domain events (W10)

**A named catalogue, not just a bus.** The firm's review is right that the
difference matters: a bus with free-text event names is a mesh that has learned
to use strings, and the first typo produces a listener that never fires and an
event nobody handles — both silent.

So `core/events/catalogue.ts` declares every event with its payload type, and
`publish` accepts nothing else:

```
ProjectCreated · ProjectArchived · PhaseApproved · DrawingIssued
MeetingApproved · IssueResolved · TimeEntryApproved · InvoiceSent
CertificateExpiring · OfferAccepted …
```

Four consumers are already known and none of them may be reached by an import:
notifications, the audit log, reporting, and the workflow engine. A time entry
approved raises `TimeEntryApproved`; Finance listens and updates project cost.
Without the bus, `TimeTrackingService` imports `FinanceService` and the module
graph becomes exactly the mesh `features/README.md` forbids on the client.

Two rules that are not negotiable, because both failures are quiet:

1. **An event is published after its transaction commits**, never inside it. A
   listener that reads the record mid-transaction sees the old row or deadlocks;
   one that sends an e-mail for a transaction that then rolls back has told the
   world about something that did not happen.
2. **A listener never fails its publisher.** Handlers run detached and their
   errors are logged, not propagated. Finance being down must not roll back an
   approved time entry.

### 7.5 Audit as infrastructure

Today `AuditService.record` is called by hand from each service that performs an
action, and the file argues for that: only the service has both versions of the
record in hand. That argument is sound and it is also why the log has holes —
every new write is a place someone can forget.

The firm's requirement, adopted: **audit is derived from domain events.** An
event carries `entity`, `entityId`, `before`, `after`, `actor` and a
`correlationId`; the audit listener writes the row. A module that raises its
events correctly is audited without writing a line of audit code.

`correlationId` is the addition that makes the log usable rather than merely
complete. One request can produce eight rows — a publish touches entries,
versions, a snapshot and a settings read — and without a shared id they are
eight unrelated facts. It is generated per request in `AsyncLocalStorage`, so
nothing has to thread it through a call chain, and a job inherits the id of the
request that enqueued it.

The explicit call survives for the cases an event cannot express: a **failed**
action (`auth.login_failed` has no entity and no after), and a denial. Those
stay direct, and the reason is written where the method is.

### 7.6 Jobs (W12)

`core/jobs/` with one `enqueue(name, payload)` seam. Promoted out of "later" at
the firm's request, and the argument for doing it now rather than when the first
long-running feature lands is that every one of these is *already* known to be
coming: PDF generation, exports, IFC analysis and BIM import, backups,
reminders, report runs, the notification digest, and scheduled publishing, which
exists today as a `@Cron` with a Redis lock.

The properties a request cannot provide and a job must:

| | |
| --- | --- |
| **Durable** | a restart mid-run does not lose the work |
| **Retried** | with backoff, and a dead-letter state after the last attempt |
| **Attributable** | it carries the `correlationId` and the actor of whatever asked for it |
| **Visible** | a row an operator can read, because "the export never arrived" needs an answer |

Backed by a `Job` table and the existing `@Cron` + Redis lock rather than a
queue server: one table and a poller is ~200 lines, and Redis is already a
documented dependency for clustered deployments. The seam is `enqueue`, so
moving to BullMQ later changes one file.

### 7.7 Automation, and the line under it

`data-model.md` §3.24 adds a workflow engine — trigger, conditions, actions —
and §3.23 makes notifications a domain. Both sit *on top of* the event bus in
§7.4, and the boundary between them is the decision that keeps this from
becoming a second application hiding in a settings screen:

```
domain/         decides whether a transition is legal      ← tested, in code
core/events/    announces that it happened                 ← a fact
workflow/       reacts: notify, assign, create, set        ← configurable
```

A rule may **not** perform a transition that has a rule. It may create a task,
notify a person, set a free field or call a webhook; it may not approve a phase,
release a drawing or accept an offer, because those have transition tables that
live in `domain/` and are tested there. Without that line, "why did this get
approved" becomes a question whose answer is in a database row somebody edited,
and the transitions table stops being the truth.

`WorkflowRun` is append-only for the same reason `AuditLog` is: an automation
whose history cannot be read is an automation nobody trusts, and *"why did this
task appear"* has to be answerable.

### 7.8 Multi-tenancy

**Single tenant, multiple locations.** IEM is one firm with Thun and Bern. Every
entity gets an optional `officeId`, not a `tenantId`. Adding real multi-tenancy
later is a schema migration; pretending to need it now costs a join on every
query for a second company that does not exist.

---

## 8. Migration strategy

Each stage is independently shippable and leaves the application working.
`npm run verify` and `npm run e2e` are green at the end of every one.

| Stage | What | Risk | Reversible |
| --- | --- | --- | --- |
| **A** | Create `app/ core/ entities/ features/ shared/ widgets/` with their README contracts. Move **nothing**. | none | trivially |
| **B** | Move the domain-free UI into `shared/ui/*`, split `primitives.tsx` and `data.tsx` by family. Imports updated mechanically; 274 tests are the net. | low | yes |
| **C** | Move `lib/*` into `core/*` and split `api.ts`: request core to `core/api/client.ts`, endpoint groups into each owning feature's `repository.ts` + `mapper.ts` (§3.1). One feature goes all five layers as the reference; the rest get repository + mapper only. | medium — touches every screen | yes |
| **D** | Move each existing screen into a feature folder. `Operations.tsx` splits into `applications/`, `settings/`, `audit/`, `account/`. | medium | yes |
| **E** | Server: wrap the flat controllers in feature modules; add `core/list`, `core/events`, generated permissions. | medium | yes |
| **F** | Add the query cache, the nested router and the form layer — the three that every module depends on. | medium | yes |
| **G** | Build the UI families in §6.2 that Stage 1 modules need. | low | yes |
| **H** | First business module (**Projects**), end to end. | — | — |

**Stage A is done.** B–H are sequenced in `roadmap.md`.

**Stage H is no longer the first time the pattern is exercised.** The
reference-implementation gate (§3.1.1) moves that into Stage C, on a feature the
application already runs and the e2e suite already covers — so the shape is
validated by tests that predate it, and Projects inherits a proven pattern
rather than establishing one.

### 8.1 What must not change

- The publish pipeline and the one-way content flow.
- The unconditional `{ data: … }` envelope.
- Deny-by-default authorisation and per-request permission resolution.
- The public site: its files, its stylesheet hash, its bundle.
- `npm run verify` staying fast and server-free.
