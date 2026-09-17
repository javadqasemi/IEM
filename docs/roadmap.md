# Roadmap

**Date:** 17 September 2026
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
| F3 | `core/api`: client, **query cache**, and the repository/service/hooks split per feature (architecture §3.1) | M | W1 + W2 + W10. Without the cache, cross-linked records show stale data; without the split, rules cannot be tested without mocking `fetch` |
| F4 | Nested router + breadcrumbs + route-declared actions | M | W11. Every module is `/x/:id/tab`; retrofitting nesting is a rewrite |
| F5 | Form layer: `useForm`, `EntityForm`, unsaved-changes guard | M | W9. Nineteen modules of forms |
| F6 | Server `core/list`: filter/sort/paginate contract | M | W5. Every list endpoint, one implementation |
| F7 | Generated permission catalogue + agreement test | S | W7. Cheap now, unmanageable at 133 entries |
| F8 | Feature modules on the server + domain event bus | M | W8 + W10. The seam Finance needs to hear Time Tracking |
| F9 | `EntityPicker`, `DatePicker`, `DateRangePicker`, `Combobox`, `Drawer`, `FilterBar` | M | The six inputs every module needs on day one |
| F10 | Job seam (`core/jobs`) | S | W12. Reports and BIM cannot run in a request |

**F2–F5 and F9 block everything. F6–F8 block the first server module. F10
blocks Reports and BIM only.**

---

## 3. Build order

Ordered by business value delivered per unit of dependency — not by the order
the modules were listed.

### Wave 1 — the project core

**Revised after review.** The first draft opened with Customers on the grounds
that it is the smallest real module and therefore the best place to establish
the pattern. That optimised for the *builder* rather than for the firm, and it
was the wrong trade: a customer record on its own supports no business process,
and the thing that connects almost every other entity is the **project**.

The correction, and the one constraint that survives it:

- **The project is the centre and the reference implementation.** The pattern
  every later module copies is established on Projects, not on a CRM table.
- **`Project.customerId` and the building are still required first** — not as
  modules, as *data*. An engineering project without a Bauherrschaft is not a
  project, so a minimal Customer and Building slice ships **inside** this wave,
  not as two preceding modules with full CRM screens.

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 1 | **Customer + Building (minimal)** | S | F2–F9 | DataTable, EntityForm, EntityPicker | `Customer`, `Building` core fields only | `/customers`, `/buildings` CRUD + search |
| 2 | **Employees** | M | F2–F9 | + PropertyList, FileList | `Employee`, `Department`, `Office`, `Skill`, `Certificate` | `/employees`, `/departments` |
| 3 | **Disciplines** | S | — | DataTable | `Discipline` master data | `/disciplines` |
| 4 | **Projects** | L | 1–3 | + DetailTabs, StatCard, ProgressRing, Timeline, Wizard | `Project`, `ProjectMember`, `ProjectDiscipline`, `Milestone` | `/projects` + sub-resources |
| 5 | **SIA phases & deliverables** | M | Projects, Disciplines | + Timeline, Checklist | `ProjectPhase`, `Deliverable`, `PhaseApproval` | `/projects/:id/phases` |

**Module 1 is a slice, not a module.** Name, number, address, Bauherrschaft,
one contact, the building's core identity — enough to create a project against.
The full CRM (communication history, pipeline, multiple contacts, segments) and
the full building model (floors, rooms, loads) come back in Waves 3 and 2
respectively, when there is something to hang them on.

**Module 3 is half a day and unblocks everything.** Eight rows of master data
with a code, a name and a colour. It is listed separately only because every
later module filters by it.

**Projects is L**, because it is where the derived fields live — `health`,
`progressPercent`, `currentPhase` — and derived-but-stored needs recomputation
on write, a nightly reconciliation and a test that the two agree.

**Module 5 is what makes this an engineering system** rather than a generic
project tool. Phases with fees, deliverables and client sign-off are how a Swiss
engineering office plans, delivers and bills; a project without them is a to-do
list with a customer attached.

### Wave 2 — the working day

The modules people open every morning. Highest usage per unit of build cost.

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 6 | **Tasks** | M | Projects, Employees | + KanbanBoard, Combobox | `Task`, `TaskDependency`, `ChecklistItem`, `Comment` | `/tasks` + board reorder |
| 7 | **Meetings** | M | Projects, Tasks | + RichText, PDF | `Meeting`, `MeetingAgendaItem`, `MeetingItem`, `MeetingAttendee`, `MeetingApproval` | `/meetings`, protocol, Pendenz → task |
| 8 | **Documents** | L | Projects | + FileTree, Uploader, FilePreview, VersionList | `Document`, `DocumentVersion`, `Folder` | `/documents`, upload, versions |
| 9 | **Drawings** | L | Projects, Disciplines, Documents | + FilePreview, VersionList, DataTable | `Drawing`, `DrawingRevision`, `Transmittal`, `TransmittalItem`, `TransmittalRecipient` | `/drawings`, revisions, `/transmittals` |
| 10 | **Time Tracking** | L | Projects, Tasks, Employees | + TimePicker, DateRangeFilter | `TimeEntry`, `ActivityType`, `Absence` | `/time-entries`, approval, `/absences` |
| 11 | **Calendar** | M | Tasks, Meetings, Time Tracking | + CalendarMonth/Week/Day | *(none — a view over others)* | `/calendar` aggregate |

**On Time Tracking's position.** The review and this document agree on the
sequence — Project → Task → Time Entry — and always did: time books to a project
and optionally to a task, so it cannot precede them. The earlier claim was about
*value*, not order: it is the only module producing data nothing else can
reconstruct, because a plan can be rebuilt from memory and March's hours cannot.
Both things are true, and the order was never in dispute.

**Drawings is new to this roadmap** and sits here rather than inside Documents,
for the reasons in `data-model.md` §3.10b: revision letters, the
`RELEASED`/`ISSUED` split, and the transmittal record. It is L rather than M
almost entirely because of Planversand — the artefact is easy and the evidence
trail is not.

**Meetings moved up**, ahead of Documents. A Bausitzung protocol is produced
every week from the first active project onwards, and its Pendenzen are the
single biggest source of tasks. Waiting for the document module to hold the PDF
would leave the most frequent recurring output of the office unsupported.

**Documents is L** for the same reason media was hard: versioning, approval,
retention, preview and a storage seam that must work with S3 later.

### Wave 3 — the building in detail, and the commercial side

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 12 | **Buildings (full): floors, rooms, loads** | M | Wave 1 slice | + TreeView, spreadsheet import | `Floor`, `Room`, `RoomLoad` | `/buildings/:id/floors`, `/rooms`, import |
| 13 | **Customers (full CRM) + Contacts** | M | Wave 1 slice | + ActivityTimeline, EntityPicker | `Contact`, customer history fields | `/contacts`, `/customers/:id/activity` |
| 14 | **Offers** | L | Customers, Projects, Documents | + Wizard, MoneyInput, PDF | `Offer`, `OfferVersion` | `/offers`, versions, send, decide |
| 15 | **Contracts** | M | Offers | + PropertyList | `Contract` | `/contracts` |
| 16 | **Finance** | XL | Projects, Time Tracking, Contracts, Phases | + LineChart, DonutChart, MoneyInput | `Budget`, `BudgetLine`, `CostItem`, `Invoice`, `InvoiceLine`, `Payment` | `/budgets`, `/invoices`, `/payments` |

**Module 12 completes what Wave 1 started as a slice.** Rooms are where HVAC
design actually happens — loads are per room, and a `Raumbuch` is a contracted
deliverable. It needs a spreadsheet and IFC import from the first day: a school
with 120 rooms × four load kinds is 480 rows nobody will type.

**Module 13 likewise.** Communication history, multiple contacts, pipeline —
the parts of a CRM that need something to attach to, which by now exists.

**Finance gains a dependency: `ProjectPhase`.** Swiss engineering fees are
billed per SIA phase against a percentage of the total, so an invoice run
without the phase model is manual entry with extra steps.

**Finance is XL and should not be started early**, however loudly it is wanted.
It is the only module where a wrong number has legal consequences, it depends on
approved time entries being trustworthy, and it needs the domain event bus to
avoid Time Tracking and Finance importing each other. Built before Time Tracking
is solid, it produces confident wrong invoices.

### Wave 4 — coordination

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 17 | **Resources** | M | Employees | + DataTable, DatePicker | `Resource`, `Maintenance` | `/resources`, `/maintenance` |
| 18 | **Planning** | XL | Projects, Tasks, Employees, Resources, Phases | + **GanttChart**, ResourceCalendar | `Allocation` | `/allocations`, `/capacity` |
| 19 | **Quality** | M | Projects, Documents, Drawings | + ChecklistItem, PhotoUpload | `Inspection`, `Defect`, `Risk` | `/inspections`, `/defects`, `/risks` |

**Planning is XL because of the Gantt.** A dependency-aware, drag-resizable,
critical-path Gantt over a real project is the single most expensive component
in this architecture. Resources now precedes it in the numbering as well as in
the dependency — the earlier draft had them the other way round and had to
explain the inversion in prose, which is a sign the order was wrong rather than
subtle.

**Planning also depends on `ProjectPhase`.** The bars on the Gantt are phases
and deliverables before they are tasks; a schedule that cannot show "Bauprojekt
ends 14 March, Ausführungsprojekt starts" is not a plan an engineering office
recognises.

### Wave 5 — leverage and specialism

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 20 | **BIM / CAD** | XL | Projects, Drawings, Buildings, Documents | + FilePreview, viewer, `core/jobs` | `ModelFile`, `ModelVersion`, `ModelIssue`, `ModelLink` | `/models`, upload, issues, links |
| 21 | **Reports** | L | everything above | + all charts, Wizard | *(read-only + `ReportDefinition`)* | `/reports`, `/reports/:id/run`, export |
| 22 | **Company Administration** | M | Employees | + existing settings UI | `Office`, `HolidayCalendar`, `Template` | `/company/*` |
| 23 | **Dashboard (role-based)** | M | the modules it shows | + widget grid, all charts | `DashboardPreference` | `/dashboard/widgets` |

**Reports is deliberately last of the data modules.** A report over three
modules is a chart; a report over fifteen is a product. Building it early means
rebuilding it as each module lands.

**BIM/CAD is XL and has a large head start.** `cad/` already parses the firm's
IFC files, audits them for clashes, penetrations and missing data, and exports a
scene — 7'786 components accounted for with a reason for every one excluded.
That toolchain is the hard part and it exists. The module is: run it as a job,
land its findings in `ModelIssue`, and show them. A viewer is a separate,
optional decision — the existing three.js scene proves the geometry pipeline
works.

**The role-based Dashboard is last on purpose.** It is a view over every other
module; built first it would be nineteen `KpiUnavailable` tiles.

---

## 4. Critical path

```
                    ┌─ Customer+Building (slice) ─┐
F2─F3─F4─F5─F9 ─────┼─ Employees ────────────────┼─→ PROJECT ─→ Phases ─┐
F6─F7─F8       ─────┴─ Disciplines ──────────────┘      │               │
                                                        │               │
                          ┌─────────────────────────────┤               │
                          ├─→ Tasks ─→ Meetings ─→ Calendar             │
                          ├─→ Documents ─→ Drawings ─→ BIM              │
                          ├─→ Time Tracking ──────────────────┐         │
                          ├─→ Buildings (full) ─→ Rooms       │         │
                          ├─→ Customers (full) ─→ Offers ─→ Contracts   │
                          ├─→ Resources ─→ Planning ←────────────────────┘
                          ├─→ Quality
                          └─────────────────────────→ FINANCE ←─────────┘
                                                        │
                                                  Reports ─→ Dashboard
```

The longest chain is **Foundation → Project → Time Tracking → Finance**, with
`ProjectPhase` feeding Finance and Planning as a second strand.

**Project is the fan-out point.** Almost nothing can be parallelised before it
and almost everything can be parallelised after it, which makes it the moment a
second developer starts paying for themselves — and the reason it, rather than a
customer table, is where the reference implementation belongs.

---

## 5. Definition of done, per module

A module is done when all of these are true. It is not done when the screens
work.

1. Entities, migration and seed data.
2. Permissions declared, guarded, row-level rules implemented and tested.
3. Server: feature module, list contract, audit entries, domain events raised.
4. Frontend: feature folder, routes, list, detail, create/edit, filters, export.
5. Uses only shared UI. Any new component landed in `shared/ui` first, with its
   contrast pairs added to `theme.contrast.test.ts`.
6. Unit tests for the domain rules and the DTO whitelist — the settings and
   content DTOs have both been silently stripped by `whitelist: true` once each.
7. Playwright: the screens in both themes at three widths, an axe pass with no
   violations, and the module's primary workflow end to end.
8. Rail entry, breadcrumbs, quick actions, global search registration.
9. `npm run verify` and `npm run e2e` green.
10. The non-obvious decisions written down *in the code*, in the style the rest
    of this repository uses.

---

## 6. Risks

| Risk | Why it matters here | Mitigation |
| --- | --- | --- |
| **Foundation skipped under pressure** | The first module ships faster and the next eighteen inherit its shortcuts | F2–F9 are a gate, not a suggestion. Customers is the proof they hold |
| **Finance built on unapproved time** | Confident wrong invoices | Finance does not start until time approval has run for a real month |
| **Gantt underestimated** | Planning stalls the wave behind it | Prototype the Gantt as a spike before committing Planning's scope |
| **Permission drift** | Already happened: 12 of 51 enforced nowhere | F7's two-way agreement test |
| **The CMS regresses** | It is live and it works | It becomes a feature folder and keeps its tests; `e2e` covers it every run |
| **Personal data** | Employees, salaries, dossiers, revDSG | `employee.compensation` / `employee.documents` separated from day one; retention on every personal entity |
| **Legal blockers shipped past** | No privacy consent on a form already collecting personal data | Fixed before any new personal data is collected, not after |

---

## 7. What is *not* in this roadmap

Named so nobody assumes they were forgotten:

- **MFA.** Columns, a settings toggle and the `otpauth` dependency exist; the
  flow does not. It belongs before external users, not before internal modules.
- **S3 / Azure media.** The `StorageAdapter` seam exists. Local disk is fine
  until Documents and BIM make it not.
- **Real multi-tenancy.** Explicitly rejected — architecture §7.6.
- **A mobile app.** The dashboard is responsive and tested at 390px. A native
  app is a separate product decision.
- **Google / Outlook calendar sync.** Designed for (Calendar is a view over
  other entities) and not scheduled.
- **The public website.** Untouched by all of this, by design.
