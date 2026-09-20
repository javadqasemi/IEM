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
2. **It is typed by hand.** Twenty-six modules × seven actions is 182 entries,
   plus the ~45 that do not fit the grid. Hand-maintained, it will drift further
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
bim.upload · bim.publish · bim.link
issue.assign · issue.resolve · issue.verify
decision.supersede
workflow.activate · workflow.testRun · workflow.viewRuns
notification.sendBroadcast
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

## 3.10 Resources added in review

The engineering entities added after the first draft — disciplines, SIA phases,
rooms, drawings — need permissions of their own, or they inherit whatever
happens to be nearest and the matrix stops describing reality.

| Resource | Standard actions | Extra keys | Notes |
| --- | --- | --- | --- |
| `discipline` | read, manage | — | Master data. Only `manage` writes; a Gewerk list is not edited per project |
| `projectDiscipline` | read, create, update, delete | `projectDiscipline.assignLead` | Scoped by the project's row-level rule |
| `projectPhase` | read, create, update, delete, approve | `projectPhase.skip`, `projectPhase.reopen` | `approve` is the phase sign-off |
| `deliverable` | read, create, update, delete | `deliverable.release`, `deliverable.waive` | `release` is distinct from `update`: it makes the artefact the phase's evidence |
| `building` | read, create, update, delete, export | — | |
| `room` | read, create, update, delete, export | `room.import` | Import matters more than the form — 480 rows per school |
| `roomLoad` | read, create, update, delete | `roomLoad.recalculate` | |
| `drawing` | read, create, update, delete, export | `drawing.check`, `drawing.release`, `drawing.issue`, `drawing.withdraw` | Four separate keys, see below |
| `transmittal` | read, create, export | — | Never updated or deleted; it is a record of something that happened |
| `modelFile` | read, create, update, delete, export | `bim.upload`, `bim.publish`, `bim.resolveIssue`, `bim.link` | |

**Why `drawing` has four extra keys.** Gezeichnet, geprüft, freigegeben and
ausgegeben are four different people's authority in an engineering office, and
collapsing them into `update` and `approve` loses the distinction that matters
most: `release` is internal and `issue` sends a plan to someone who will build
from it. A draftsman draws and may not check their own work; an engineer checks
and releases; issuing is usually the project manager's.

**`transmittal` has no `update` or `delete` by design.** A Planversand is a
statement about the past. Correcting one means issuing another — the same reason
`AuditLog` has no API to edit a row.

### By role

| Resource | Mgmt | PM | Engineer | Draftsman | HR | Finance |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `discipline` read / manage | ● / ○ | ● / ○ | ● / ○ | ● / ○ | ● / ○ | ● / ○ |
| `projectDiscipline` | ● | ● | ● read | ● read | ○ | ● read |
| `projectPhase` incl. approve | ● | ● ◐ | ● read | ● read | ○ | ● read |
| `deliverable` / release | ● / ● | ● / ● | ● / ● | ● / ○ | ○ | ● read |
| `building`, `room`, `roomLoad` | ● | ● | ● | ● | ○ | ● read |
| `drawing` read/create/update | ● read | ● | ● | ● | ○ | ● read |
| `drawing.check` | ○ | ● | ● | ○ | ○ | ○ |
| `drawing.release` | ○ | ● | ● | ○ | ○ | ○ |
| `drawing.issue` | ● | ● | ○ | ○ | ○ | ○ |
| `transmittal` | ● | ● | ● read | ● read | ○ | ● read |

`projectPhase.approve` is `◐` for the Project Manager — their own projects, and
the four-eyes rule still forbids approving a phase whose last deliverable they
released themselves. Only `management` and `super_admin` hold
`projectPhase.reopen`.

## 3.11 Resources added in the second review

Plants, decisions, issues, cost codes, notifications and workflow rules. Two of
these carry the only permissions in the catalogue that protect the *system* from
its own users rather than users from each other.

| Resource | Standard actions | Extra keys | Notes |
| --- | --- | --- | --- |
| `buildingSystem` | read, create, update, delete, export | `buildingSystem.decommission` | Taking a plant out of service is a fact about the building, not an edit |
| `decision` | read, create, update, delete | `decision.supersede` | `update` is corrections; reversing a decision is its own authority |
| `issue` | read, create, update, delete, export | `issue.assign`, `issue.resolve`, `issue.verify`, `issue.bulkImport` | `resolve` and `verify` are separate people — that separation *is* the entity |
| `costCode` | read, manage, export | `costCode.close` | Only `manage` writes; the tree is generated, not typed |
| `notification` | read | `notification.sendBroadcast`, `notification.managePreferences` | Everyone reads their own; `◐` is the only sensible default |
| `workflow` | read, create, update, delete | `workflow.activate`, `workflow.testRun`, `workflow.viewRuns` | The most dangerous resource in the system |

**`issue.resolve` and `issue.verify` are two keys because they are two people.**
The fixer says it is fixed; someone else confirms it. Granting both to the same
role by default would quietly undo the four-eyes rule this codebase applies to
content, documents and time entries — so the matrix below grants `verify` more
narrowly than `resolve`, and the service refuses `verifiedById === resolvedById`
regardless of what the role holds.

**`workflow.activate` is separate from `workflow.update` deliberately.** Writing
a rule is drafting; switching it on makes it act on everybody's records without
anybody clicking anything. `workflow.testRun` exists so a rule can be exercised
against a real past event *without performing its actions* — the alternative is
that the only way to find out what a rule does is to let it do it.

**`notification.sendBroadcast` is not `notification.create`.** Nothing creates a
notification by hand in the normal path — they come from events and rules
(`data-model.md` §3.23). A broadcast is the exception, it reaches every user at
once, and it is the one that needs a name in the audit log.

**`costCode` has `manage` and no `update`.** The tree is generated from a
project's disciplines and phases; editing a node in a list is not the operation,
maintaining the structure is. `costCode.close` stops postings while keeping
history, and it is refused while an open `BudgetLine` references the node.

### By role

| Resource | Mgmt | PM | Engineer | Draftsman | HR | Finance |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `buildingSystem` read / write | ● / ○ | ● / ● | ● / ● | ● / ○ | ○ | ● / ○ |
| `decision` read / create | ● / ● | ● / ● | ● / ● | ● / ○ | ○ | ● / ○ |
| `decision.supersede` | ● | ● ◐ | ○ | ○ | ○ | ○ |
| `issue` read / create | ● / ● | ● / ● | ● / ● | ● / ● | ○ | ● / ○ |
| `issue.assign` | ● | ● | ● | ○ | ○ | ○ |
| `issue.resolve` | ○ | ● | ● | ● ◐ | ○ | ○ |
| `issue.verify` | ● | ● | ● | ○ | ○ | ○ |
| `costCode` read / manage | ● / ○ | ● / ○ | ● read | ○ | ○ | ● / ● |
| `notification` | ● ◐ | ● ◐ | ● ◐ | ● ◐ | ● ◐ | ● ◐ |
| `notification.sendBroadcast` | ● | ○ | ○ | ○ | ● | ○ |
| `workflow` read | ● | ● | ○ | ○ | ○ | ○ |
| `workflow` create/update | ● | ○ | ○ | ○ | ○ | ○ |
| `workflow.activate` | ● | ○ | ○ | ○ | ○ | ○ |
| `workflow.viewRuns` | ● | ● | ○ | ○ | ○ | ○ |

`workflow.create` and `workflow.activate` sit with `management`,
`super_admin` and the `administrator` role and nowhere else. A rule engine whose
rules anybody can switch on is a way for one person to change how the system
behaves for everyone, and the blast radius does not match a project manager's
job. `workflow.viewRuns` is wider on purpose: *why did this task appear* is a
question its recipient is entitled to an answer to.

`issue.resolve` is `◐` for the Draftsman — issues assigned to them. Management
holds `verify` but not `resolve`, which is the correct shape for a role that
signs off rather than fixes.

## 3.12 The firm itself — `organisation` and `office`

Built with the Unternehmen module (`docs/ENTERPRISE_ROADMAP.md` → P1-1). Two
resources rather than one, because an office is a record people create and
archive while the organisation is a singleton that is only ever edited.

| Resource | Standard actions | Extra keys | Notes |
| --- | --- | --- | --- |
| `organisation` | read, update | `organisation.updateLegal` | No `create`, no `delete` — the row is upserted into existence and never removed |
| `office` | read, create, update, delete | `office.archive` | `archive` is the operation a closed office actually gets; `delete` is for a row created by mistake |

**`organisation.updateLegal` is separate from `organisation.update`, and it is
a field-level `◐`.** Changing the main telephone number and changing the UID
are both writes to the same row and are not the same authority: the second is
what appears in the commercial register, on every invoice and in the Impressum,
and getting it wrong is a legal problem rather than an inconvenience. The same
argument that splits `drawing.check` from `drawing.release` splits these.

It cannot be a route decorator. `@RequirePermissions` is AND across its
arguments and cannot ask *"only if the body touches these fields"*, and two
routes would put the choice of which one to call in the client — which is not
authorisation. So the gate is a `permissions.has` inside the handler, checked
against `LEGAL_FIELDS`, and it is the §4 pattern below. The response to `GET
/organisation` carries `canEditLegal` so the form can render those fields
read-only rather than letting somebody fill them in and meet a 403 on save.

**`office.archive` is separate from `office.delete`** for the reason Projects
separates the same pair: an office that has closed still has employees,
projects and buildings pointing at it, and its history has to keep resolving.
`refuseDeleteOffice` refuses outright once anything references it, so `delete`
is the rarer permission and archiving is the operation that exists in practice.

### By role

| Resource | Mgmt | Admin | PM | Engineer | HR | Finance | Guest |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `organisation.read` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `organisation.update` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `organisation.updateLegal` | ● | **○** | ○ | ○ | ○ | ○ | ○ |
| `office.read` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `office.create` / `update` / `archive` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `office.delete` | ● | **○** | ○ | ○ | ○ | ○ | ○ |

The two bold cells are the whole point of the split, and they are the reason
the seed grows a seventh test account (`adm@iem.test`): `administrator` is the
only role holding one key of each pair without the other, so every other
account stops at the route guard and the field-level gate is unobservable.
`e2e/security.spec.ts` covers it with that account.

`Manager` and the CMS-only roles get `organisation.read` and `office.read` and
nothing more: the company's address is context they need while working, and
changing it is not their job.

## 3.13 The second factor — `user.resetMfa`, and the key that is not there

Built with MFA (`docs/ENTERPRISE_ROADMAP.md` → P3-2). **One new key, and the
absence of a second is the decision worth recording.**

| Resource | Extra key | Notes |
| --- | --- | --- |
| `user` | `user.resetMfa` | Clears somebody else's second factor. Account recovery, and the only administrative operation the module has |

**Why reset is its own key.** The same argument that split `revokeSessions`
from `readSessions`: it is an *intervention*. It removes a security control
from an account that is not the caller's, it ends every session that account
holds, and it is the first thing an attacker holding an administrator session
would reach for. It is not something every role that can edit a name should
inherit with `user.update`.

**Why there is no `user.readMfa`.** Sessions earned a read key because they
expose a colleague's devices, their IP addresses and their working hours.
`mfaEnabled` is a boolean that exposes none of that, it is already on the row
`GET /users` returns, and stripping it conditionally would create a permission
whose removal changes nothing a reader could notice — the dead-permission
problem §2 exists to end. The audit log records a reset either way.

**Why the caller's own factor carries no permission at all.**
`/auth/mfa`, `/auth/mfa/enroll`, `…/enroll/verify`, `…/disable` and
`…/recovery-codes` are operations on the caller's own account, like
`/auth/me` and `/auth/sessions`. A key such as `mfa.manage` would be one every
role had to be granted for the dashboard to work, which is a key that means
nothing. The scope is the control: each route takes the account from the
verified token and never from the request, so there is no parameter through
which one account could reach another's factor.

**A permission is not the only gate here.** `user.resetMfa` says *who may*;
it does not say that the person holding the session is the one asking. Both
administrative reset and the two self-service operations that weaken the
account additionally require a **re-authentication window** — the caller's own
password, plus their own second factor if they have one — opened at
`POST /auth/reauthenticate` and presented in the body. An administrator's
laptop left unlocked at a shared desk must not be a way to strip a colleague's
second factor. That is not a `◐` rule (it is not about *which rows*), which is
why it is here rather than in §4.

### By role

| Key | Super Admin | Mgmt | Admin | PM | Engineer | HR | Finance | Guest |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `user.resetMfa` | ● | ○ | **●** | ○ | ○ | ○ | ○ | ○ |

**`administrator` holds it and `management` does not**, which is the opposite
way round from `organisation.updateLegal` two sections above, and the
difference is what the key is *for*. Clearing a lost authenticator is support
work — it is the answer to "my phone is in a river", it happens on a Tuesday
morning, and putting it behind the single Super Admin account is how a
locked-out Geschäftsleitung ends up with somebody editing the database. It
also grants no access: the password is still required afterwards, and the
account's sessions are revoked rather than opened. `administrator` already
holds `user.update`, which can suspend the account outright — a strictly more
disruptive act.

`management` is the interesting refusal and the one `e2e/security.spec.ts`
uses: it holds `user.read`, so the cell separates *"may look at the user
list"* from *"may strip somebody's second factor"*.

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
| **Own notification** — `recipientUserId === actor.userId` | Notification read, dismiss, preferences |
| **Assigned issue** — actor is `assigneeId` | `issue.resolve` for the Draftsman |
| **Not the resolver** — `actor.id !== issue.resolvedById` | `issue.verify`, always, whatever the role |
| **Not the releaser** — actor did not release the phase's last deliverable | `projectPhase.approve` |
| **Legal fields** — the body touches none of `LEGAL_FIELDS` unless the actor holds `organisation.updateLegal` | `PATCH /organisation` |

The last one is a **field-level** `◐` rather than a row-level one, and it is
the only one in the catalogue: there is one row, and what varies is which of
its columns the caller may write. It is listed here because the mechanism is
the same — a `permissions.has` inside the handler, which
`permissions.agreement.test.ts` counts as enforcement — and because a reader
looking for "where are the rules a decorator cannot express" should find it in
one place.

The last two are the four-eyes rule, written twice because it applies to two
entities. It is enforced in the service in both cases and holds regardless of
which permissions the role carries — a rule a permission can lift is not a rule,
and `workflow.requireApproval` is the one place this codebase makes that
exception explicit and deliberate.

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
