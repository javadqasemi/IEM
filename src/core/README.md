# `core/` — infrastructure

Everything the dashboard needs that is **not** about the business: the HTTP
client, the session, the router, the theme, the permission check, the query
cache, configuration.

## The rule

**`core/` knows nothing about the domain.** Nothing here may import from
`features/`, `entities/` or `widgets/`. It may import from `shared/`.

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

## Migration

Populated in Stage C of the migration plan
(`docs/enterprise-architecture.md` §8), from today's `src/admin/lib/`. Empty
until then, deliberately: the folder and its contract land before the move, so
the move has somewhere correct to go.
