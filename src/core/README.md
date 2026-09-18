# `core/` — infrastructure

Everything the dashboard needs that is **not** about the business: the HTTP
client, the session, the router, the theme, the permission check, the query
cache, configuration.

## The rule

**`core/` knows nothing about the domain.** Nothing here may import from
`features/`, `entities/`, `widgets/` or `shared/`. It is the bottom layer, so
every arrow points *into* it. `architecture.test.ts` enforces that.

If a file here mentions a project, a customer or an invoice, it is in the wrong
folder.

## What goes here

```
core/
  api/
    client.ts       request core: token attachment, single-flight refresh,
                    envelope unwrapping, ApiError with per-field messages
    download.ts     authenticated blob downloads
    query.ts        cache, in-flight dedup, stale-while-revalidate, invalidate
    list.ts         the client half of the list contract (filter/sort/page)
  auth/             AuthProvider, useAuth — session and can()/canAny()
  permissions/      the generated key list and the client-side check
  router/           nested routes, params, guards, breadcrumb derivation
  theme/            light / dark / system
  config/           env access, in one place
```

## Why it is separate from `shared/`

`shared/` is *reusable*; `core/` is *singular*. There is one API client, one
session, one router, one theme — and each has state. A component in `shared/ui`
can be rendered a hundred times; `AuthProvider` is mounted once.

## Why `auth/` has a repository and features have theirs

`core/auth/repository.ts` is the one repository not owned by a feature folder.
Login, refresh, `me` and the password flows are what the router guards on, what
the client refreshes against, and what every screen depends on existing — so
they sit *below* the features rather than beside them. Everything else that
talks to the API belongs to the feature that owns the resource.

`clearQueryCache()` is called on sign-in and on sign-out, and that is a
correctness property rather than housekeeping: the cache is per-tab and in
memory, so a second user signing in on the same tab would otherwise be handed
the previous user's rows on the first render.

## Migration

**Done for `api/` and `auth/`** (Stage C, partial). `permissions/`, `router/`,
`theme/` and `config/` still live in `src/admin/lib/` and move with the screens
that use them.

`api/` deliberately does **not** own the endpoint list. `src/admin/lib/api.ts`
still holds eight endpoint groups, and exactly one — applications — has moved
to a feature folder, because the firm's review set the rule that a pattern is
proven once before it is copied (`docs/enterprise-architecture.md` §3.1.1).
