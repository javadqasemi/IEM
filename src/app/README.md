# `app/` — the dashboard application

The entry point, the providers, the route table and the error walls. Thin by
design: everything it does is wire other folders together.

```
app/
  main.tsx        entry — creates the root and renders
  App.tsx         the shell: rail, top bar, route outlet
  providers.tsx   Auth, Theme, Toast, Query, ErrorBoundary — in one place,
                  in the order they must nest
  routes.tsx      the route table, assembled from features/*/index.ts
  styles/
    admin.css     the token block and the component layer
```

## The rule

`app/` may import from everywhere. **Nothing may import from `app/`.**

It is the top of the graph. A file that needs something from here — the current
route, the session, a toast — needs it from `core/` instead, which is where
those actually live.

## `routes.tsx`

Assembled, not written:

```ts
import { routes as customers } from "@/features/customers";
import { routes as projects }  from "@/features/projects";

export const ROUTES = [...customers, ...projects, /* … */];
```

A feature ships its own routes with their permissions and breadcrumbs, so
adding a module does not edit this file beyond one import. The existing
`routes.tsx` already carries the permission-per-route model and the tests that
check it agrees with the navigation — both survive the move unchanged.

## Why `admin.css` moves here

It is the application's stylesheet, not a shared component's. It declares the
token block that `shared/ui` consumes and `tailwind.admin.config.ts` maps —
which makes it an application-level concern that happens to be a file.

The public site keeps its own entry, its own stylesheet and its own components
entirely outside this folder. They are a different application sharing a
repository, and its stylesheet hash has been unchanged for ten commits.

## Migration

Stage C–D. Today's `src/admin/{main,App,routes}.tsx` and `admin.css` move here
with their imports rewritten; `admin.html` points at the new entry.
