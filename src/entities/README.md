# `entities/` — the shared business vocabulary

A `Project` is referenced by Projects, Tasks, Time Tracking, Planning, Finance,
Documents, Quality and Reports. Its **type**, its **statuses**, its **labels**
and its **validation schema** therefore belong to none of them.

This folder is what stops eight features each having their own idea of what a
project status is.

## The rule

**No UI, no fetching.** An entity module is data and pure functions. It may
import from `shared/types` and nothing else — not `core/`, not `features/`, not
`shared/ui`.

The one exception is a small, presentational component that *is* the entity's
shared representation — a `ProjectStatusBadge` used identically by six features.
It lives beside the status it renders because splitting them guarantees they
drift.

## The shape

```
entities/project/
  types.ts     Project, ProjectMember, Milestone — the domain types
  status.ts    the status enum, the allowed transitions, the tone for each
  labels.ts    German labels for every enum value, in one place
  schema.ts    the validation schema shared by create and edit forms
  index.ts
```

### Why `labels.ts` exists

The dashboard is German and the enums are English. `PROJECT_STATUS_LABELS` in
one file means "In Bearbeitung" is spelled one way everywhere; a `switch` in
each screen means it is spelled four ways and one of them is "In Arbeit".

### Why `status.ts` holds transitions

`ContentService` already proves the pattern: the allowed transitions are a
table, not `if` chains, because the question an auditor asks is "can an editor
go from IN_REVIEW straight to PUBLISHED?" and a table answers it by being read.
Every entity with a lifecycle gets one, and the server's copy is the
authoritative one — this is the client's, for disabling buttons that would be
refused anyway.

## Entities

Three exist, all created by the Stage B split rather than by a new module —
which is the useful proof that the rule has teeth. Each left `shared/ui`
because it broke the "no domain knowledge" rule there:

```
entities/application/  types.ts   the entity, its status union, its files
                       status.tsx labels, tones, the option list, the badge
entities/content/      WorkflowBadge — the six content states
entities/audit/        labels.ts  47 German phrases for audit actions
```

`application/types.ts` is the first written-down example of the difference
`entities/` exists for: dates are `Date`, the status is a closed union, and
nothing carries a field that exists only because of how JSON serialises.
`features/applications/dto.ts` holds the wire shape and `mapper.ts` is the only
file that has seen both.

The rest are defined in `docs/data-model.md` and created per entity as its
module is built: project, customer, contact, building, building-system,
discipline, offer, contract, task, meeting, decision, document, drawing,
model-file, issue, employee, department, time-entry, absence, resource,
allocation, cost-code, invoice, inspection, risk, notification, workflow, user,
role.
