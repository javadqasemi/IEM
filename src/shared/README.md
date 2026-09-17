# `shared/` — the design system and the plumbing under it

Reusable, domain-free, testable in isolation. This is where `DataTable`,
`Button`, `Drawer`, `useDebounced` and `formatMoney` live.

## The rule

**Nothing here knows what a project is.**

`src/admin/ui/primitives.tsx` already states it — *"No domain knowledge.
Nothing here imports the API client or knows what a content entry is"* — and it
is the rule that has kept that file reusable through the whole CMS. It now
applies to the folder.

A component that needs the domain belongs in `features/<module>/components/`
(if one module uses it) or `entities/<thing>/` (if several do).

`shared/` may import from `shared/`. Nothing else.

## The shape

```
shared/
  ui/
    primitives/   Button, Badge, Card, Field, Input, Select, Toggle, Tabs,
                  Pagination, Breadcrumb, Skeleton, EmptyState, ErrorState
    data/         DataTable, DataView, ColumnDef, TableToolbar, BulkBar,
                  KpiCard, ActivityFeed
    forms/        Form, FormField, FormSection, useForm, EntityForm,
                  DatePicker, Combobox, MoneyInput, FileDropzone
    overlays/     Modal, ConfirmDialog, Drawer, Popover, Menu, Tooltip,
                  CommandPalette
    charts/       BarChart, LineChart, DonutChart, Sparkline, ProgressRing
    views/        DetailLayout, PropertyList, Timeline, KanbanBoard,
                  GanttChart, CalendarMonth, FileTree
  hooks/          useDebounced, useDisclosure, useLocalStorage
  utils/          format, date, number, file, sort
  types/          Paginated<T>, ApiError, ID, Money
```

The full inventory, including what exists today and what must be built before a
module can use it, is in `docs/enterprise-architecture.md` §6.

## Two standing constraints

**Tokens only — never a literal colour.** `theme.tokens.test.ts` asserts the
three-way agreement between `admin.css`, the Tailwind config and every class
written. A class that does not resolve is not an error; it simply styles
nothing, and this is the only thing that catches it.

**Contrast is tested, not judged.** Every new foreground/background pair goes
into `theme.contrast.test.ts` — including the composition it actually renders
in. That qualification is there because the test once asserted a badge tone
against a plain card and reported 5.0:1 while the badge sat on a 10% wash of
itself on a hovered row and measured 4.13:1.

## Migration

Populated in Stage B from `src/admin/ui/`, splitting `primitives.tsx` (879
lines) and `data.tsx` (550) by family. The 274 existing tests are the safety
net for that move.
