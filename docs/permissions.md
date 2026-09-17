# Permissions

**Date:** 17 September 2026
**Status:** design. Companion to [`enterprise-architecture.md`](./enterprise-architecture.md).

---

## 1. What exists, and what is wrong with it

`server/src/rbac/permissions.catalog.ts` holds 51 permissions as a hand-written
array and eleven seeded roles as hand-written key lists. The design is right —
permissions not pages, code as the source of truth, Super Admin by role key
rather than by holding every key — and it has two defects that nineteen modules
would multiply:

1. **Twelve of the 51 are enforced on no route.** They are selectable in the
   role editor and grant nothing. At 51 entries that is 24% dead; the mechanism
   that let it happen is a list nobody can cross-check against the guards.
2. **It is typed by hand.** Nineteen modules × seven actions is 133 entries,
   plus the ~25 that do not fit the grid. Hand-maintained, it will drift further
   and faster.

## 2. The rule: declare the resource, derive the catalogue

Each server feature module declares what it is and what can be done to it:

```ts
// modules/projects/projects.permissions.ts
export const PROJECT = resource({
  key: "project",
  label: "Projekte",
  category: "Projekte",
  actions: ["read", "create", "update", "delete", "export", "approve", "manage"],
});
```

`rbac/catalog.ts` imports every declaration and derives `PERMISSIONS`. Three
things follow that the current design cannot have:

- **A route cannot guard a permission that does not exist** — `perm()` already
  throws on an unknown key; now the key list is generated, so the throw is
  reachable at build time rather than only at first call.
- **A permission that no route guards is findable.** A test walks every
  `@RequirePermissions` in the module tree and compares it to the catalogue,
  failing on either direction. The twelve dead entries become a failing test
  instead of a paragraph in an audit.
- **The role editor groups itself.** `category` and `label` come from the
  declaration, so a new module appears in the editor correctly with no UI change.

### 2.1 The seven standard actions

| Action | Means |
| --- | --- |
| `read` | See the list and the detail |
| `create` | Add a record |
| `update` | Change a record |
| `delete` | Soft-delete / archive a record |
| `export` | Take data out — CSV, PDF, Excel |
| `approve` | Decide on something another person submitted |
| `manage` | Configure the module itself: its types, templates, categories |

`manage` is deliberately distinct from `update`. Editing a project is
`project.update`; changing the list of activity types every project uses is
`timeEntry.manage`. Conflating them is how an engineer ends up able to rename
the phase model.

### 2.2 Actions outside the grid

Some capabilities are not CRUD and get their own keys rather than being forced
into one:

```
project.reopen          reopen a COMPLETED project
offer.send              send to the customer — distinct from approve
offer.sign              record acceptance
contract.terminate
task.assign             assign to someone else
timeEntry.submit        submit own time
timeEntry.approveAll    bulk approval
timeEntry.reopen        reopen an APPROVED entry
absence.approve
employee.compensation   see and edit salary and hourly rate
employee.documents      see personnel files
document.approve
document.restore        from the recycle bin
bim.upload · bim.publish · bim.resolveIssue
invoice.send · invoice.recordPayment · invoice.credit
finance.viewMargins     see profitability, not just budget
report.schedule
system.backup · system.api · system.featureFlags · system.impersonate
```

`employee.compensation` and `employee.documents` exist because personal data
needs a boundary inside HR, not only around it. A team lead who may read the
employee list must not thereby read salaries.

---

## 3. The matrix

Modules × the seven standard actions × eight roles.

**● granted · ○ not granted · ◐ own records only**

`◐` is the row-level qualifier. An engineer may update *their* time entries and
*their* tasks, not everyone's. It is enforced in the service, not the guard —
the guard answers "may you touch this kind of thing", the service answers "may
you touch *this one*". Both are needed and they are different questions.

### 3.1 Super Admin

Holds `"*"`. Short-circuits on the **role key**, never on holding every
permission — a role that merely listed them all would stop being omnipotent the
moment a module was added, which is precisely when you least want the only
account that can fix things to lose access. This is already how the system
works and it does not change.

### 3.2 Management

| Module | read | create | update | delete | export | approve | manage |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Dashboard | ● | – | – | – | ● | – | – |
| Projects | ● | ● | ● | ○ | ● | ● | ○ |
| Customers | ● | ● | ● | ○ | ● | – | ○ |
| Contacts | ● | ● | ● | ○ | ● | – | – |
| Buildings | ● | ● | ● | ○ | ● | – | – |
| Offers | ● | ● | ● | ○ | ● | ● | ○ |
| Contracts | ● | ● | ● | ○ | ● | ● | ○ |
| Planning | ● | ● | ● | ○ | ● | ● | ○ |
| Tasks | ● | ● | ● | ○ | ● | ● | ○ |
| Calendar | ● | ● | ● | ○ | ● | – | ○ |
| Meetings | ● | ● | ● | ○ | ● | – | – |
| Documents | ● | ● | ● | ○ | ● | ● | ○ |
| BIM / CAD | ● | ○ | ○ | ○ | ● | ● | ○ |
| Employees | ● | ● | ● | ○ | ● | ● | ○ |
| Time Tracking | ● | ◐ | ◐ | ○ | ● | ● | ○ |
| Resources | ● | ● | ● | ○ | ● | ● | ○ |
| Quality | ● | ● | ● | ○ | ● | ● | ○ |
| Finance | ● | ● | ● | ○ | ● | ● | ○ |
| Reports | ● | ● | ● | ○ | ● | – | ○ |
| Company | ● | ○ | ● | ○ | ● | – | ○ |
| Administration | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

Plus `finance.viewMargins`, `employee.compensation`, `project.reopen`,
`timeEntry.approveAll`, `absence.approve`, `report.schedule`.
**Not** `employee.documents` — reading the workforce is not reading personnel
files; HR holds that.

### 3.3 Project Manager

| Module | read | create | update | delete | export | approve | manage |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Dashboard | ● | – | – | – | ○ | – | – |
| Projects | ● | ● | ◐ | ○ | ● | ○ | ○ |
| Customers | ● | ● | ● | ○ | ○ | – | ○ |
| Contacts | ● | ● | ● | ○ | ○ | – | – |
| Buildings | ● | ● | ● | ○ | ○ | – | – |
| Offers | ● | ● | ● | ○ | ● | ○ | ○ |
| Contracts | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| Planning | ● | ● | ◐ | ○ | ● | ○ | ○ |
| Tasks | ● | ● | ● | ● | ● | ● | ○ |
| Calendar | ● | ● | ● | ● | ○ | – | ○ |
| Meetings | ● | ● | ● | ● | ● | – | – |
| Documents | ● | ● | ● | ○ | ● | ● | ○ |
| BIM / CAD | ● | ● | ● | ○ | ● | ● | ○ |
| Employees | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| Time Tracking | ● | ◐ | ◐ | ◐ | ● | ● | ○ |
| Resources | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| Quality | ● | ● | ● | ○ | ● | ● | ○ |
| Finance | ◐ | ○ | ○ | ○ | ◐ | ○ | ○ |
| Reports | ● | ● | ◐ | ◐ | ● | – | ○ |
| Company | ● | ○ | ○ | ○ | ○ | – | ○ |
| Administration | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

`◐` on Projects and Finance means **projects they manage**. A PM sees the budget
of their own projects and not the firm's margin; `finance.viewMargins` is
withheld. `timeEntry.approve` is granted because approving their team's hours
on their project is the job — and the four-eyes rule still forbids approving
their own.

### 3.4 Engineer

| Module | read | create | update | delete | export | approve | manage |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Dashboard | ● | – | – | – | ○ | – | – |
| Projects | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| Customers | ● | ○ | ○ | ○ | ○ | – | ○ |
| Contacts | ● | ○ | ○ | ○ | ○ | – | – |
| Buildings | ● | ○ | ● | ○ | ○ | – | – |
| Offers | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| Contracts | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Planning | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| Tasks | ● | ● | ◐ | ○ | ○ | ○ | ○ |
| Calendar | ● | ● | ◐ | ◐ | ○ | – | ○ |
| Meetings | ● | ● | ◐ | ○ | ○ | – | – |
| Documents | ● | ● | ● | ○ | ● | ○ | ○ |
| BIM / CAD | ● | ● | ● | ○ | ● | ○ | ○ |
| Employees | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| Time Tracking | ◐ | ◐ | ◐ | ◐ | ◐ | ○ | ○ |
| Resources | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| Quality | ● | ● | ● | ○ | ● | ○ | ○ |
| Finance | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Reports | ● | ○ | ○ | ○ | ● | – | ○ |
| Company | ● | ○ | ○ | ○ | ○ | – | ○ |
| Administration | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

Engineers see no financial data at all. `bim.upload` yes, `bim.publish` no —
publishing a model is a coordination decision.

### 3.5 Draftsman

As Engineer, with these differences: **Planning** read-only; **Quality**
`create`/`update` withheld (they record defects through tasks, not inspections);
**Reports** export withheld; **BIM/CAD** identical — it is their primary module.

### 3.6 HR

| Module | read | create | update | delete | export | approve | manage |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Dashboard | ● | – | – | – | ○ | – | – |
| Projects | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| Customers | ○ | ○ | ○ | ○ | ○ | – | ○ |
| Planning | ● | ○ | ○ | ○ | ● | ○ | ○ |
| Tasks | ● | ● | ◐ | ○ | ○ | ○ | ○ |
| Calendar | ● | ● | ◐ | ◐ | ○ | – | ○ |
| Documents | ● | ● | ● | ○ | ● | ○ | ○ |
| **Employees** | ● | ● | ● | ● | ● | ● | ● |
| Time Tracking | ● | ○ | ○ | ○ | ● | ● | ● |
| Resources | ● | ● | ● | ○ | ● | ○ | ○ |
| Finance | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Reports | ● | ● | ◐ | ◐ | ● | – | ○ |
| Company | ● | ● | ● | ○ | ● | – | ● |
| Administration | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

Plus `employee.compensation`, `employee.documents`, `absence.approve`,
`application.read`, `application.update`, `application.download`,
`application.export`, and the CMS keys the current `hr` role already holds for
the careers pages. Modules not listed are all `○`.

### 3.7 Finance

| Module | read | create | update | delete | export | approve | manage |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Dashboard | ● | – | – | – | ● | – | – |
| Projects | ● | ○ | ○ | ○ | ● | ○ | ○ |
| Customers | ● | ● | ● | ○ | ● | – | ○ |
| Contacts | ● | ● | ● | ○ | ● | – | – |
| Offers | ● | ○ | ○ | ○ | ● | ○ | ○ |
| Contracts | ● | ● | ● | ○ | ● | ● | ○ |
| Tasks | ● | ● | ◐ | ○ | ○ | ○ | ○ |
| Calendar | ● | ● | ◐ | ◐ | ○ | – | ○ |
| Documents | ● | ● | ● | ○ | ● | ○ | ○ |
| Employees | ● | ○ | ○ | ○ | ● | ○ | ○ |
| Time Tracking | ● | ○ | ○ | ○ | ● | ● | ● |
| Resources | ● | ○ | ● | ○ | ● | ○ | ○ |
| **Finance** | ● | ● | ● | ● | ● | ● | ● |
| Reports | ● | ● | ● | ◐ | ● | – | ● |
| Company | ● | ○ | ○ | ○ | ● | – | ○ |
| Administration | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

Plus `finance.viewMargins`, `invoice.send`, `invoice.recordPayment`,
`invoice.credit`, `employee.compensation`, `report.schedule`.
Not `employee.documents` — Finance needs rates, not personnel files.

### 3.8 Guest

`read` on Dashboard only, and `◐ read` on Documents explicitly shared with
them. Every other cell `○`. It exists for a client or an external partner given
a narrow window, and the narrowness is the point.

### 3.9 Administrator (the existing CMS role, extended)

Keeps everything it has for content, media, users, roles, settings and audit.
Gains `read` and `export` across the business modules for support purposes,
plus `system.*`. Gains **no** `finance.viewMargins`, **no**
`employee.compensation`, **no** `employee.documents` — an administrator
maintains the system; that is not the same as being entitled to its most
sensitive contents, and the audit log records any attempt.

---

## 4. Row-level rules (`◐`)

The guard is coarse and the service is fine-grained. The `◐` cells resolve to
these rules, each implemented once in the owning service and covered by a test:

| Rule | Applies to |
| --- | --- |
| **Own record** — `employeeId === actor.employeeId` | TimeEntry, Absence, own Tasks |
| **Managed project** — actor is the project's `managerId` or a `ProjectMember` with role `MANAGER` | Project update, Planning, project Finance |
| **Assigned** — actor is `assigneeId` | Task update |
| **Member** — actor is any `ProjectMember` | project Documents, project BIM |
| **Shared** — an explicit share row names the actor | Guest documents |

Two rules that override all of the above and are absolute:

- **Four eyes.** Nobody approves what they submitted, whatever their
  permissions. Super Admin is exempt and the audit log records that they were
  both. `workflow.requireApproval` can lift it deliberately — this already works
  for content and extends unchanged to offers, documents, time and absence.
- **Archived is read-only.** A completed project, an issued invoice and an
  approved time entry refuse writes regardless of permission. State beats role.

---

## 5. Seeded roles

The eleven CMS roles today become these eight plus the CMS-specific ones kept
for the website:

| Role | Key | Rank | Notes |
| --- | --- | --- | --- |
| Super Admin | `super_admin` | 0 | `"*"`, unchanged |
| Management | `management` | 10 | new |
| Administrator | `administrator` | 15 | existing, extended |
| Project Manager | `project_manager` | 20 | new |
| Finance | `finance` | 30 | new |
| HR | `hr` | 35 | existing, extended |
| Engineer | `engineer` | 40 | new — replaces the CMS `engineering` role |
| Draftsman | `draftsman` | 45 | new |
| Marketing | `marketing` | 60 | existing, website only |
| Support | `support` | 70 | existing |
| Viewer | `viewer` | 90 | existing |
| Guest | `guest` | 100 | existing, narrowed |

`content_editor` and `sales` fold into Marketing and Project Manager. Removing
a seeded role needs a migration that reassigns its users; the seeder reports
orphans rather than deleting, as it does now.

**These roles do not exist yet and will not be seeded until the modules they
address do.** A role called Project Manager that can only edit website copy is
exactly the "permission that grants nothing" problem the audit raised — it is
added in the same commit as the module that gives it something to do.

---

## 6. Enforcement checklist

Every module ships with all six, or it is not done:

1. `@RequirePermissions` on every route; no route without one unless `@Public()`.
2. Row-level rule in the service, with a test for the denial path.
3. The route in the frontend route table naming the same keys (§2).
4. The rail entry naming keys the route also accepts — already tested by
   `routes.test.ts`.
5. Audit entries for create, update, delete, approve and export.
6. A test asserting the catalogue and the guards agree in both directions.
