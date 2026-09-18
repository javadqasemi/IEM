# `shared/` — the design system and the plumbing under it

Reusable, domain-free, testable in isolation. This is where `DataTable`,
`Button`, `Drawer`, `useDebounced` and `formatMoney` live.

## The rule

**Nothing here knows what a project is.**

`primitives.tsx` already stated it — *"No domain knowledge. Nothing here
imports the API client or knows what a content entry is"* — and it is the rule
that kept that file reusable through the whole CMS. It now applies to the
folder, and the split enforced it: three things left during the move because
they broke it.

| Left for | Because |
| --- | --- |
| `entities/content/WorkflowBadge` | it decides that `APPROVED` reads "Freigegeben" |
| `entities/application/status` | six statuses, their labels and their tones |
| `entities/audit/labels` + `widgets/activity` | a table of German phrases for audit actions |

`Badge` stayed: it supplies the *tone scale* and holds no opinion about what is
being shown. That is the line — a shape is shared, a meaning is not.

A component that needs the domain belongs in `features/<module>/components/`
(if one module uses it) or `entities/<thing>/` (if several do).

`shared/` may import from `shared/`. Nothing else.

## The shape

Bold is what exists today. The rest is the inventory in
`docs/enterprise-architecture.md` §6.2, built as the modules that need it land.

```
shared/
  ui/
    primitives/   Button, Spinner, Badge, Card, PageHeader,
                  Skeleton, SkeletonTable, EmptyState, ErrorState
    forms/        Field, Input, Textarea, Select, Checkbox, Toggle,
                  SearchInput, FieldRenderer,
                  Form, FormSection, FormActions, EntityForm, useForm,
                  Combobox, EntityPicker, DatePicker, DateRangePicker
                  — later: MoneyInput, MultiSelect, RichText, FileDropzone,
                    TagInput, TimePicker
    navigation/   Tabs, Pagination, Breadcrumb
    overlays/     Modal, ConfirmDialog, Drawer
                  — later: Popover, Menu, Tooltip, CommandPalette
    data/         DataTable, DataView, Column, Pair, KpiCard, KpiUnavailable,
                  BarChart, FilterBar
                  — later: TableToolbar, BulkBar, SavedViews
    feedback/     ToastProvider, useToast, ErrorBoundary
                  — later: charts/, views/ (Timeline, Kanban, Gantt, Calendar)
  utils/          cn, format
                  — later: date, number, file, sort
  hooks/          useDebounced, useMutation, useUnsavedGuard
                  — later: useDisclosure, useLocalStorage
  types/          — later: Paginated<T>, ApiError, ID, Money
```

**Native until native genuinely cannot.** `Select`, `DatePicker` and every text
input are the platform's own, styled — they bring keyboard handling, the mobile
picker, form association and screen-reader semantics that a custom widget has to
rebuild and usually rebuilds incompletely. `Combobox` is the one exception and
the reason is narrow: `<select>` cannot filter, and a list of 400 employees is a
scroll nobody can use. Because it is hand-built, its keyboard is written out in
the file rather than assumed.

**`shared/` may import `core/`.** The layer diagram puts `core` underneath, so
that is a downward arrow — `useMutation` reads `ApiError` for its per-field
messages, and `useUnsavedGuard` registers the router's navigation blocker.
`architecture.test.ts` enforces the direction.

**Each family has its own barrel and there is no barrel above them.** A call
site imports `@/shared/ui/forms`, not `@/shared/ui`, so the import line says
which family it reached for. One barrel over everything would have made the
split invisible at exactly the place it is supposed to be visible.

`Spinner` sits in `primitives/Button.tsx` rather than with the other loading
states, because `Button` renders it for `busy` and the two would otherwise
import each other across families.

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

**One more that is easy to miss.** `tailwind.admin.config.ts` scans this folder
explicitly. Tailwind emits an `@layer components` class only when its name
appears in a scanned file, so a `panel` or a `field-input` used *only* from here
would simply not be in the stylesheet — no error, just a card with no border.
`theme.tokens.test.ts` asserts that the folders it scans and the folders
Tailwind scans are the same list, in both directions.

## Migration

**Done (Stage B).** `primitives.tsx` (879 lines) and `data.tsx` (550) were split
by family, `toast`, `ErrorBoundary`, `FieldRenderer` and `cn` moved here, and
three domain pieces left for `entities/` and `widgets/`. The public site's
stylesheet hash — `globals-B1c5Zfq1.css` — is unchanged, which is the check
that none of it leaked into the bundle a visitor downloads.
