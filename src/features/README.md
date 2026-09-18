# `features/` — one folder per module

A feature owns its whole stack: routes, screens, components, hooks, API slice
and tests. **Adding a module is adding a folder. Deleting one is deleting a
folder.**

## The rule that matters most

**A feature may not import from another feature.** Not once, not "just this
one", not through a barrel. `features/tasks` may not import
`features/projects`.

That rule is the entire point of this folder. Nineteen modules that import each
other is not an architecture, it is a mesh with folders. When a feature needs
something from another:

| Need | Where it goes |
| --- | --- |
| A type, a status list, a label, a colour | `entities/<thing>/` |
| A component that shows one of those | `entities/<thing>/` or `shared/ui` |
| Data from another module's API | its own API slice, calling the same endpoint |
| A reaction to something that happened | a **domain event** on the server, never a client import |
| A block that genuinely spans features | `widgets/` |

If two features need to share behaviour and none of those fit, the shared thing
is not a feature concern — promote it to `entities/`, `shared/` or `core/`.

## The shape

Every feature looks the same. That is deliberate: one existing feature is taken
through all five layers first, as the validated reference, and every later
module is a copy of its shape.

```
features/projects/
  index.ts           the public surface: routes + nav entries. Nothing else
                     leaves the folder.
  routes.tsx         route definitions with their permissions and breadcrumbs
  dto.ts             the wire shapes. Imported by repository.ts and mapper.ts
  repository.ts      HTTP only — the one file that knows URLs
  mapper.ts          DTO ⇄ entity. The last file where a DTO type is legal
  service.ts         domain only — pure rules, no React, no fetch
  hooks/             React only — cache, loading state, invalidation
  screens/           ProjectList.tsx, ProjectDetail.tsx, ProjectCreate.tsx
  components/        ProjectStatusBadge, ProjectHealthBar — feature-specific
  __tests__/
```

### The five layers

```
repository.ts  →  mapper.ts  →  service.ts  →  hooks/  →  screens/
   HTTP           DTO⇄entity     pure rules      React      rendering
```

Each is replaceable without touching the ones above it.

**The rule that makes the split real:** a DTO type may be named in
`repository.ts` and `mapper.ts` and **nowhere else**. Not in a hook, not in a
screen, not in `entities/`. Without that line the repository returns wire shapes
straight into the hooks, the DTO reaches the components anyway, and the layering
exists on paper but not in the import graph.

The mapper is where `"2026-03-14"` becomes a `Date`, `"1450.00"` becomes a
number, `null` becomes `undefined`, and an open string enum becomes a closed
one. A renamed field, a casing change or one endpoint splitting into two is then
absorbed in two files whose tests run in milliseconds.

`service.ts` — the transitions table, the derived values, the four-eyes checks —
is testable with no mocks at all, because it touches neither the network nor
React. That is the layer worth being strict about; it is also the one easiest to
skip.

**A feature with no domain logic omits `service.ts`.** Disciplines is master
data; an empty service for symmetry is ceremony. **`mapper.ts` is not
optional**, even when it is nearly an identity function: it is the seam, and a
seam that exists only when convenient is not a seam. Four lines and one test,
and the day the API changes it is the only file that moves.

The server holds the authoritative copy of every rule. The client's copy exists
so a button that would be refused is disabled rather than clicked.

### The gate before the shape is copied

Set by the firm at review and enforced here: every layer ships **one fully
tested reference implementation** before a second feature adopts the shape
(`docs/enterprise-architecture.md` §3.1.1). An architecture error copied into
twenty modules is twenty modules to re-cut, and the mistake will not be in the
part anybody looked at.

`index.ts` is the boundary. `app/routes.tsx` imports `features/*/index.ts` and
nothing deeper; if something outside the folder needs a file two levels in, the
boundary is wrong.

## Screens, not pages

A screen is one route. `pages/Operations.tsx` in the old structure was 1'009
lines and held **four** unrelated screens — Applications, Settings, Audit and
Profile. One file per screen, named for the route it serves.

## The modules

Listed in `docs/roadmap.md` with their build order. The existing CMS becomes
`features/content/` and `features/media/` and keeps working throughout.

## Migration

Folders are created as their modules are built — an empty folder for a module
nobody is writing is noise. The existing screens move here in Stage D
(`docs/enterprise-architecture.md` §8).
