# Roadmap

**Date:** 18 September 2026
**Status:** plan. Companion to [`enterprise-architecture.md`](./enterprise-architecture.md),
[`data-model.md`](./data-model.md) and [`permissions.md`](./permissions.md).

---

## 1. How to read this

**Complexity** is a T-shirt size, not a date. This document deliberately gives
no dates: the estimates that matter depend on who builds it and at what
allocation, and a made-up week count would be the same kind of fabricated number
the dashboard refuses to show for revenue.

| Size | Means |
| --- | --- |
| **S** | One entity, CRUD, a list and a detail. No new shared components. |
| **M** | Two or three entities, a workflow or a state machine, one new shared component. |
| **L** | A new interaction surface (Gantt, calendar, board), background work, or money. |
| **XL** | A new subsystem: external formats, a viewer, or a compliance boundary. |

**Dependency** means *cannot start without*. **Reuses** lists shared components
the module consumes; anything it needs that is not listed must be built in the
Foundation stages first, not invented inside the module.

---

## 2. Foundation (before any module)

These are Stages B–H from the architecture's migration plan. None delivers a
business feature; every module depends on all of them.

| # | Stage | Size | Why it is first |
| --- | --- | :-: | --- |
| F1 | Folder skeleton + contracts | S | **Done.** Stage A. |
| F2 | Split `shared/ui` by family | M | Every module imports it; splitting later means touching every module |
| F3 | `core/api`: client, **query cache**, and the repository/**mapper**/service/hooks split per feature (architecture §3.1), with **one feature taken through all five layers** as the validated reference (§3.1.1) | M | W1 + W2 + W10. Without the cache, cross-linked records show stale data; without the split, rules cannot be tested without mocking `fetch`; without the mapper the DTO reaches the components anyway |
| F4 | Nested router + breadcrumbs + route-declared actions | M | W11. Every module is `/x/:id/tab`; retrofitting nesting is a rewrite |
| F5 | Form layer: `useForm`, `EntityForm`, unsaved-changes guard | M | W9. Twenty-odd modules of forms |
| F6 | Server `core/list`: filter/sort/paginate contract | M | W5. Every list endpoint, one implementation |
| F7 | Generated permission catalogue + agreement test | S | W7. Cheap now, unmanageable at 180 entries |
| F8 | Feature modules on the server + domain event bus | M | W8 + W10. The seam Finance needs to hear Time Tracking, and the one Notifications and Workflow are both built on |
| F9 | `EntityPicker`, `DatePicker`, `DateRangePicker`, `Combobox`, `Drawer`, `FilterBar` | M | The six inputs every module needs on day one |
| F10 | Job seam (`core/jobs`) | S | W12. Reports, BIM ingestion and notification digests cannot run in a request |

**F2–F5 and F9 block everything. F6–F8 block the first server module. F10
blocks Reports, BIM and the notification digest.**

### 2.1 Authentication and RBAC are done

The review's order opens *Foundation → Authentication → RBAC → Project*. The
first is these ten stages; the middle two **already exist and are the strongest
part of the server**, so they are a gate to re-verify rather than work to
schedule:

| Exists today | Still owed |
| --- | --- |
| Argon2id, rotating refresh tokens with replay detection, per-account lockout, per-IP throttle | MFA flow (columns and toggle exist, the flow does not) |
| Deny-by-default `JwtAuthGuard`, permissions resolved per request, Super Admin by role key | F7's generated catalogue — 12 of 51 permissions are enforced nowhere |
| 11 seeded roles, a working role editor | The engineering roles, seeded when the modules they grant exist |
| — | **Route-level enforcement on the client**: `renderRoute` renders any page to any signed-in user and the server's 403 is what stops the data |

That last row is the one that matters before the first business module: a screen
the user may not have should not render and then fail, and F4 is where the route
table gains the guard.

### 2.2 The reference-implementation gate

Adopted from the review, verbatim:

> Every architectural layer — Repository, Mapper, Service, Hooks and UI — must
> include at least one fully tested reference implementation before migrating
> additional modules. Do not duplicate patterns until the reference
> implementation has been validated.

It lands inside **F3**, not after it, and it is proven on a feature the
application already runs — so the shape is validated against the existing e2e
suite rather than against a module written to fit it. Architecture §3.1.1 holds
the checklist.

---

## 3. Build order

Revised after the second domain review. The order below is the firm's, with
three places where a dependency forced a deviation — each one flagged where it
occurs rather than silently reordered.

### Wave 1 — the project core

The project is the centre and the reference implementation. The one constraint
that survives: **`Project.customerId`, a building and a manager are required
*data*.** An engineering project without a Bauherrschaft, an object and a
responsible person is not a project — so a minimal Customer and Building slice
and the Employee table ship **inside** this wave, not as preceding CRM modules.

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 1 | **Customer + Building (minimal)** | S | F2–F9 | DataTable, EntityForm, EntityPicker | `Customer`, `Building` core fields only | `/customers`, `/buildings` CRUD + search |
| 2 | **Employees** | M | F2–F9 | + PropertyList, FileList | `Employee`, `Department`, `Office`, `Skill`, `Certificate` | `/employees`, `/departments` |
| 3 | **Disciplines** | S | Employees | DataTable | `Discipline` master data | `/disciplines` |
| 4 | **Projects** | L | 1–3 | + DetailTabs, StatCard, ProgressRing, Timeline, Wizard | `Project`, `ProjectMember`, `ProjectDiscipline`, `Milestone` | `/projects` + sub-resources |
| 5 | **SIA phases & deliverables** | M | Projects, Disciplines | + Timeline, Checklist | `ProjectPhase`, `Deliverable`, `PhaseApproval` | `/projects/:id/phases` |

**Deviation 1 — Employees precedes Disciplines**, where the review has
Disciplines first. `Discipline.managerId` is the Fachbereichsleiter and it was
the review's own addition; a discipline table with a manager column and no
employees to put in it is a table that gets filled in twice.

**Module 1 is a slice, not a module.** Name, number, address, Bauherrschaft, one
contact, the building's core identity — enough to create a project against. The
full CRM and the full building model come back in Waves 3 and 2.

**Module 3 is half a day and unblocks everything.** Eight rows of master data
with a code, a name, a colour token, a manager and a default budget share. It is
listed separately only because every later module filters by it.

**Projects is L**, because it is where the derived fields live — `health`,
`progressPercent`, `currentPhase` — and derived-but-stored needs recomputation
on write, a nightly reconciliation and a test that the two agree.

**Module 5 is what makes this an engineering system** rather than a generic
project tool. Phases with fees, deliverables and client sign-off are how a Swiss
engineering office plans, delivers and bills; a project without them is a to-do
list with a customer attached.

### Wave 2 — the building, and the working day

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 6 | **Buildings (full): floors, systems, rooms, loads** | L | Wave 1 slice | + TreeView, spreadsheet import | `Floor`, `BuildingSystem`, `RoomSystem`, `Room`, `RoomLoad` | `/buildings/:id/*`, import |
| 7 | **Meetings + Decisions** | L | Projects, Employees | + RichText, PDF | `Meeting`, `MeetingAgendaItem`, `MeetingItem`, `MeetingAttendee`, `MeetingApproval`, `Decision` | `/meetings`, protocol, Pendenz → task |
| 8 | **Tasks** | M | Projects, Employees | + KanbanBoard, Combobox | `Task`, `TaskDependency`, `ChecklistItem`, `Comment` | `/tasks` + board reorder |
| 9 | **Notifications** | M | F8, F10, Tasks | + bell, NotificationList, preferences pane | `Notification`, `NotificationDelivery`, `NotificationPreference` | `/notifications`, mark-read, preferences |
| 10 | **Drawings + Transmittals** | L | Projects, Disciplines, Buildings | + FilePreview, VersionList, DataTable | `Drawing`, `DrawingRoom`, `DrawingRevision`, `Transmittal`, `TransmittalItem`, `TransmittalRecipient` | `/drawings`, revisions, `/transmittals` |
| 11 | **Documents** | L | Projects | + FileTree, Uploader, FilePreview, VersionList | `Document`, `DocumentVersion`, `Folder` | `/documents`, upload, versions |
| 12 | **Issues** | M | Drawings, Buildings, Disciplines | + FilterBar, PhotoUpload, DataTable | `Issue` | `/issues`, resolve, verify |
| 13 | **BIM / CAD** | XL | Projects, Drawings, Buildings, Issues, F10 | + FilePreview, viewer, `core/jobs` | `ModelFile`, `ModelVersion`, `ModelLink` | `/models`, upload, links, clash run |
| 14 | **Time Tracking** | L | Projects, Tasks, Employees | + TimePicker, DateRangeFilter | `TimeEntry`, `ActivityType`, `Absence` | `/time-entries`, approval, `/absences` |
| 15 | **Calendar** | M | Tasks, Meetings, Time Tracking | + CalendarMonth/Week/Day | *(none — a view over others)* | `/calendar` aggregate |

**Buildings moves up to open this wave**, as the review has it, and it grew from
M to L: `BuildingSystem` and `RoomSystem` were the review's additions and they
are the part that sells the next commission — a plant inventory with
`yearInstalled + expectedLifetimeYears` across the portfolio is a replacement
forecast. It needs spreadsheet and IFC import from day one: a school with 120
rooms × four load kinds is 480 rows nobody will type.

**Meetings ahead of Tasks**, which is the review's order and the right one. A
Bausitzung produces Pendenzen and Entscheide from the first active project
onwards; it is the single biggest source of tasks, so the module that *creates*
the work comes before the board that shows it. Tasks stays right behind it
because a Pendenz with nowhere to go is a line in a PDF.

**Deviation 2 — Notifications is inserted at 9**, which the review places last
under Automation. The bell is what makes Tasks, Meetings and Issues visible to
the people who are not looking at them; shipping three modules that silently
assign work and then adding notifications afterwards means three modules'
assignment paths get revisited. It is M, not L, because `core/events` (F8) and
`core/jobs` (F10) already exist by then and it is a consumer of both.

**Drawings before Documents**, as the review has it. It is the more expensive of
the two and it pulls the storage-and-version seam forward with it — which is the
real cost, and which Documents then inherits rather than establishes. L rather
than M almost entirely because of Planversand: the artefact is easy and the
evidence trail is not.

**Issues is new to this roadmap** and absorbs two tables the first draft had
separately: `Defect` from Quality and `ModelIssue` from BIM (`data-model.md`
§3.22). It sits before BIM because a clash run with nowhere to put its findings
is a PDF, and after Drawings because *where* an issue is — room, plan, element —
is what distinguishes it from a task.

**BIM has a large head start.** `cad/` already parses the firm's IFC files,
audits them for clashes, penetrations and missing data, and exports a scene —
7'786 components accounted for with a reason for every one excluded. That
toolchain is the hard part and it exists. The module is: run it as a job, land
its findings in `Issue`, link them through `ModelLink`, and show them. A viewer
is a separate, optional decision.

**On Time Tracking's position.** Project → Task → Time Entry was never in
dispute: time books to a project and optionally to a task, so it cannot precede
them. It is the only module producing data nothing else can reconstruct — a plan
can be rebuilt from memory and March's hours cannot — which is an argument about
value, not about order.

### Wave 3 — planning and the commercial side

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 16 | **Resources** | M | Employees | + DataTable, DatePicker | `Resource`, `Maintenance` | `/resources`, `/maintenance` |
| 17 | **Planning** | XL | Projects, Tasks, Employees, Resources, Phases | + **GanttChart**, ResourceCalendar | `Allocation` | `/allocations`, `/capacity` |
| 18 | **Customers (full CRM) + Contacts** | M | Wave 1 slice | + ActivityTimeline, EntityPicker | `Contact`, customer history fields | `/contacts`, `/customers/:id/activity` |
| 19 | **Offers** | L | Customers, Projects, Documents | + Wizard, MoneyInput, PDF | `Offer`, `OfferVersion` | `/offers`, versions, send, decide |
| 20 | **Contracts** | M | Offers | + PropertyList | `Contract` | `/contracts` |
| 21 | **Finance + Cost codes** | XL | Projects, Time Tracking, Contracts, Phases, Disciplines | + LineChart, DonutChart, MoneyInput | `CostCode`, `Budget`, `BudgetLine`, `CostItem`, `Forecast`, `Invoice`, `InvoiceLine`, `Payment` | `/cost-codes`, `/budgets`, `/invoices`, `/payments` |

**Deviation 3 — Resources precedes Planning**, which the review's list does not
mention. Planning allocates people *and* things against the same calendar, and
`Allocation` is one table for both (`data-model.md` §3.19); building the Gantt
first means building it twice.

**Planning is XL because of the Gantt.** A dependency-aware, drag-resizable,
critical-path Gantt over a real project is the single most expensive component
in this architecture. Its bars are phases and deliverables before they are
tasks; a schedule that cannot show "Bauprojekt ends 14 March, Ausführungsprojekt
starts" is not a plan an engineering office recognises.

**Customers late, as the review has it.** Communication history, multiple
contacts, pipeline — the parts of a CRM that need something to attach to, which
by now exists.

**Finance grew a prerequisite and shrank a risk.** `CostCode` was the review's
correction and it is the reason this module is now *buildable*: one axis that
budget, hours, cost items, invoice lines and forecasts all reference, instead of
four vocabularies over the same franc. It still depends on `ProjectPhase` —
Swiss engineering fees are billed per SIA phase against a percentage of the
total.

**Finance is XL and should not be started early**, however loudly it is wanted.
It is the only module where a wrong number has legal consequences, it depends on
approved time entries being trustworthy, and it needs the domain event bus to
avoid Time Tracking and Finance importing each other. Built before Time Tracking
is solid, it produces confident wrong invoices.

### Wave 4 — leverage

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 22 | **Quality** | M | Projects, Issues, Documents | + ChecklistItem, PhotoUpload | `Inspection`, `Risk`, `ChecklistItem` | `/inspections`, `/risks` |
| 23 | **Reports** | L | everything above | + all charts, Wizard, `core/jobs` | *(read-only + `ReportDefinition`)* | `/reports`, `/reports/:id/run`, export |
| 24 | **Automation (Workflow)** | L | F8, Notifications, and the modules whose events it reacts to | + rule builder, FilterBar, Drawer | `WorkflowRule`, `WorkflowCondition`, `WorkflowAction`, `WorkflowRun` | `/workflows`, test-run, `/workflow-runs` |
| 25 | **Company Administration** | M | Employees | + existing settings UI | `Office`, `HolidayCalendar`, `Template` | `/company/*` |
| 26 | **Dashboard (role-based)** | M | the modules it shows | + widget grid, all charts | `DashboardPreference` | `/dashboard/widgets` |

**Quality shrank.** `Defect` folded into `Issue`, so what remains is the
inspection itself, the risk register and the checklist — genuinely M now.

**Reports is deliberately late.** A report over three modules is a chart; a
report over twenty is a product. Building it early means rebuilding it as each
module lands.

**Automation is last of the functional modules, as the review has it, and that
is the right place for a reason worth stating.** A rule engine built before the
events it reacts to exist is a configuration screen with an empty dropdown; one
built after them is a way for the firm to encode habits a developer would
otherwise be asked for one at a time. The line under it does not move:
`data-model.md` §3.24 and architecture §7.6 — a rule may notify, assign, create
or set a free field, and may **not** perform a transition that has a rule.

**The role-based Dashboard is last on purpose.** It is a view over every other
module; built first it would be twenty `KpiUnavailable` tiles.

---

## 4. Critical path

```
  F2─F3─F4─F5─F9 ──┬─ Customer+Building (slice) ─┐
  F6─F7─F8─F10  ───┼─ Employees ─→ Disciplines ──┼─→ PROJECT ─→ Phases ─┐
                   └─────────────────────────────┘      │               │
                                                        │               │
                    ┌───────────────────────────────────┤               │
                    ├─→ Buildings (full) ─→ Systems, Rooms               │
                    ├─→ Meetings ─→ Decisions                            │
                    ├─→ Tasks ─→ Notifications ─→ Calendar               │
                    ├─→ Drawings ─→ Documents ─→ Issues ─→ BIM           │
                    ├─→ Time Tracking ──────────────────┐               │
                    ├─→ Resources ─→ Planning ←──────────────────────────┤
                    ├─→ Customers (full) ─→ Offers ─→ Contracts          │
                    ├─→ Quality (Inspections, Risks) ←── Issues          │
                    └───────────────────────→ FINANCE + Cost codes ←─────┘
                                                        │
                                          Reports ─→ Automation ─→ Dashboard
```

The longest chain is **Foundation → Project → Time Tracking → Finance**, with
`ProjectPhase` feeding Finance and Planning as a second strand and `Issue`
feeding both BIM and Quality as a third.

**Project is the fan-out point.** Almost nothing can be parallelised before it
and almost everything can be parallelised after it, which makes it the moment a
second developer starts paying for themselves — and the reason it, rather than a
customer table, is where the business reference implementation belongs.

---

## 5. Definition of done, per module

A module is done when all of these are true. It is not done when the screens
work.

1. Entities, migration and seed data.
2. Permissions declared, guarded, row-level rules implemented and tested.
3. Server: feature module, list contract, mapper, audit entries, domain events
   raised.
4. Frontend: feature folder with all five layers (§3.1), routes, list, detail,
   create/edit, filters, export.
5. **No DTO type named outside `repository.ts` and `mapper.ts`**, enforced by a
   test rather than by review.
6. Uses only shared UI. Any new component landed in `shared/ui` first, with its
   contrast pairs added to `theme.contrast.test.ts`.
7. Unit tests for the domain rules, the mapper in both directions, and the DTO
   whitelist — the settings and content DTOs have both been silently stripped by
   `whitelist: true` once each.
8. Playwright: the screens in both themes at three widths, an axe pass with no
   violations, and the module's primary workflow end to end.
9. Rail entry, breadcrumbs, quick actions, global search registration.
10. `npm run verify` and `npm run e2e` green.
11. The non-obvious decisions written down *in the code*, in the style the rest
    of this repository uses.

---

## 6. Risks

| Risk | Why it matters here | Mitigation |
| --- | --- | --- |
| **Foundation skipped under pressure** | The first module ships faster and the next twenty inherit its shortcuts | F2–F9 are a gate, not a suggestion |
| **The pattern copied before it is proven** | An architecture error reaches twenty modules and the mistake is not in the part anybody looked at | §2.2's gate: five layers, one feature, fully tested, before the second |
| **The DTO boundary erodes** | It erodes silently — one import, and the mapper is decorative | An import test, in `verify`, from the first feature |
| **Finance built on unapproved time** | Confident wrong invoices | Finance does not start until time approval has run for a real month |
| **Cost codes typed by hand** | A four-level tree per project means the third project stops using it, and a half-used cost structure is worse than none | Generated from the project's disciplines and phases, never typed |
| **Gantt underestimated** | Planning stalls the wave behind it | Prototype the Gantt as a spike before committing Planning's scope |
| **Permission drift** | Already happened: 12 of 51 enforced nowhere | F7's two-way agreement test |
| **Notification fatigue** | A bell nobody reads is worse than no bell, and it is not recoverable | `groupKey` collapses at the record level; preferences and digests ship *with* the module, not after |
| **Automation hiding business rules** | "Why was this approved" becomes a database row somebody edited | A rule may not perform a guarded transition — architecture §7.6 |
| **The CMS regresses** | It is live and it works | It becomes a feature folder and keeps its tests; `e2e` covers it every run |
| **Personal data** | Employees, salaries, dossiers, revDSG | `employee.compensation` / `employee.documents` separated from day one; retention on every personal entity |
| **Legal blockers shipped past** | No privacy consent on a form already collecting personal data | Fixed before any new personal data is collected, not after |

---

## 7. What is *not* in this roadmap

Named so nobody assumes they were forgotten:

- **MFA.** Columns, a settings toggle and the `otpauth` dependency exist; the
  flow does not. It belongs before external users, not before internal modules.
- **S3 / Azure media.** The `StorageAdapter` seam exists. Local disk is fine
  until Drawings and BIM make it not — which is Wave 2, so this is the one
  deferred item with a known expiry.
- **Real multi-tenancy.** Explicitly rejected — architecture §7.7.
- **A mobile app.** The dashboard is responsive and tested at 390px. A native
  app is a separate product decision.
- **Google / Outlook calendar sync.** Designed for (Calendar is a view over
  other entities) and not scheduled.
- **BCF import/export.** `Issue` is modelled to fit it (`elementGuid`, viewpoint
  anchor) and the exchange itself is not scheduled.
- **The public website.** Untouched by all of this, by design.
