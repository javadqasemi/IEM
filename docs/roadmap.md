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
| F3 | `core/api`: client, per-feature slices, **query cache** | M | W1 + W2. Without the cache, cross-linked records show stale data |
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

### Wave 1 — the spine

Nothing else can be built on top of an empty customer table.

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 1 | **Customers** | S | F2–F9 | DataTable, EntityForm, FilterBar, DetailLayout | `Customer` | `/customers` CRUD + search |
| 2 | **Contacts** | S | Customers | as above + EntityPicker | `Contact` | `/contacts`, nested under customer |
| 3 | **Buildings** | S | Customers | as above | `Building` | `/buildings` |
| 4 | **Projects** | L | 1–3 | + DetailTabs, StatCard, ProgressRing, Timeline | `Project`, `ProjectMember`, `Milestone` | `/projects` + 6 sub-resources |
| 5 | **Employees** | M | F2–F9 | + PropertyList, FileList | `Employee`, `Department`, `Office`, `Skill`, `Certificate` | `/employees`, `/departments` |

**Customers is the reference implementation** (architecture Stage H). It is
deliberately the smallest real module: list, detail, create, edit, archive,
search, filter, export, permissions, row-level rules, audit and tests. Every
later module is built by copying its shape. Getting it right is worth more than
getting it quickly.

**Projects is L, not M**, because it is where the derived fields live — `health`
and `progressPercent` — and derived-but-stored needs recomputation on write, a
nightly reconciliation and a test that the two agree.

### Wave 2 — daily work

The modules people open every morning. Highest usage per unit of build cost.

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 6 | **Tasks** | M | Projects, Employees | + KanbanBoard, Combobox | `Task`, `TaskDependency`, `ChecklistItem`, `Comment` | `/tasks` + board reorder |
| 7 | **Time Tracking** | L | Projects, Tasks, Employees | + TimePicker, DateRangeFilter | `TimeEntry`, `ActivityType`, `Absence` | `/time-entries`, approval, `/absences` |
| 8 | **Documents** | L | Projects | + FileTree, Uploader, FilePreview, VersionList | `Document`, `DocumentVersion`, `Folder` | `/documents`, upload, versions |
| 9 | **Calendar** | M | Tasks, Meetings, Time Tracking | + CalendarMonth/Week/Day | *(none — a view over others)* | `/calendar` aggregate |
| 10 | **Meetings** | M | Projects, Calendar | + RichText | `Meeting`, `MeetingAttendee`, `MeetingItem` | `/meetings`, minutes → tasks |

**Time Tracking is the highest-value module in the system** and the argument is
worth stating: it is the only one that produces data nothing else can
reconstruct. A project's plan can be rebuilt from memory; the hours somebody
worked in March cannot. It is also the input Finance needs to be anything other
than manual entry. If only three modules are ever built, they are Customers,
Projects and Time Tracking.

**Documents is L** for the same reason media was hard: versioning, approval,
retention, preview and a storage seam that must work with S3 later.

### Wave 3 — commercial

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 11 | **Offers** | L | Customers, Projects, Documents | + Wizard, MoneyInput, PDF | `Offer`, `OfferVersion` | `/offers`, versions, send, decide |
| 12 | **Contracts** | M | Offers | + PropertyList | `Contract` | `/contracts` |
| 13 | **Finance** | XL | Projects, Time Tracking, Contracts | + LineChart, DonutChart, MoneyInput | `Budget`, `BudgetLine`, `CostItem`, `Invoice`, `InvoiceLine`, `Payment` | `/budgets`, `/invoices`, `/payments` |

**Finance is XL and should not be started early**, however loudly it is wanted.
It is the only module where a wrong number has legal consequences, it depends on
approved time entries being trustworthy, and it needs the domain event bus to
avoid Time Tracking and Finance importing each other. Built before Time Tracking
is solid, it produces confident wrong invoices.

### Wave 4 — coordination

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 14 | **Planning** | XL | Projects, Tasks, Employees, Resources | + **GanttChart**, ResourceCalendar | `Allocation` | `/allocations`, `/capacity` |
| 15 | **Resources** | M | Employees | + DataTable, DatePicker | `Resource`, `Maintenance` | `/resources`, `/maintenance` |
| 16 | **Quality** | M | Projects, Documents | + ChecklistItem, PhotoUpload | `Inspection`, `Defect`, `Risk` | `/inspections`, `/defects`, `/risks` |

**Planning is XL because of the Gantt.** A dependency-aware, drag-resizable,
critical-path Gantt over a real project is the single most expensive component
in this architecture. Resources (15) should ship *before* Planning even though
it is listed after, because Planning allocates them — the numbering follows
value, the build follows the dependency.

### Wave 5 — leverage and specialism

| # | Module | Size | Depends on | Reuses | DB impact | API impact |
| --- | --- | :-: | --- | --- | --- | --- |
| 17 | **Reports** | L | everything above | + all charts, Wizard | *(read-only + `ReportDefinition`)* | `/reports`, `/reports/:id/run`, export |
| 18 | **BIM / CAD** | XL | Projects, Documents | + FilePreview, viewer | `ModelFile`, `ModelVersion`, `ModelIssue` | `/models`, upload, issues |
| 19 | **Company Administration** | M | Employees | + existing settings UI | `Office`, `HolidayCalendar`, `Template` | `/company/*` |
| 20 | **Dashboard (role-based)** | M | the modules it shows | + widget grid, all charts | `DashboardPreference` | `/dashboard/widgets` |

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
F2 ─ F3 ─ F4 ─ F5 ─ F9 ──┬─→ Customers ─→ Contacts ─┐
                          │                          ├─→ Projects ─┬─→ Tasks ─→ Calendar
F6 ─ F7 ─ F8 ────────────┤                Buildings ─┘             │
                          └─→ Employees ──────────────────────────┤
                                                                   ├─→ Time Tracking ─→ Finance
                                                    Resources ─────┤
                                                                   ├─→ Documents ─→ BIM
                                                                   ├─→ Planning
                                                                   ├─→ Quality
                                                                   ├─→ Offers ─→ Contracts
                                                                   └─→ Reports ─→ Dashboard
```

The longest chain is **Foundation → Customers → Projects → Time Tracking →
Finance**. Everything else can be parallelised once Projects exists, which makes
Projects the point at which a second developer starts paying for themselves.

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
