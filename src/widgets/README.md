# `widgets/` — composed blocks that span features

The escape hatch for the one thing the feature rule forbids: a block that
legitimately needs several modules at once.

There are only three of them, and that is the point — if this folder grows, the
feature boundaries are wrong.

```
widgets/
  dashboard/    the role dashboard's tiles: open tasks, budget usage,
                utilisation, deadlines. Each reads one feature's API and
                declares the permission that shows it.
  activity/     the audit feed, which renders events from every module
  search/       the ⌘K palette, which queries every module's search endpoint
```

## The rule

A widget may import from `features/*/api`, `entities/`, `shared/` and `core/`.
A feature may **not** import from `widgets/`.

That direction is what keeps it an escape hatch rather than a second mesh: the
dashboard knows about Projects; Projects does not know it is on a dashboard.

## When something belongs here

Three tests, all of which must pass:

1. It reads from **two or more** features.
2. It is **presentational** — it shows and links; it does not own a workflow.
   Anything that owns a workflow is a feature.
3. Removing a feature it reads from should degrade it, not break it. A
   dashboard tile for a module that is not built yet renders as
   `KpiUnavailable`, not as an error.

If it fails any of the three, it is a feature or it is `shared/`.

## Why the dashboard is here and not in `features/dashboard`

There is a thin `features/dashboard/` that owns the route, the widget grid and
the per-user arrangement. The **tiles** are here, because each one is about
another module. Splitting it that way is what lets a new module ship its
dashboard tile inside its own wave without editing the dashboard feature.
