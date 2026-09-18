/**
 * Data — compositions that assume a *shape*, never a *meaning*.
 *
 * `DataTable` knows a row has columns; it does not know what a content entry
 * is. The moment a component here would need to, it belongs in `entities/`
 * (a type's own badge) or in `widgets/` (a block spanning features) instead.
 * The audit feed left this folder for exactly that reason: it had a table of
 * German phrases for audit actions, which is knowledge about the audit domain.
 */
export { DataTable, DataView, type Column, type SortState } from "./DataTable";
export { ColumnPicker, type PickableColumn } from "./ColumnPicker";
export { BulkBar } from "./BulkBar";
export { KpiCard, KpiUnavailable } from "./Kpi";
export { Pair } from "./Pair";
export { FilterBar, buildFilterChips, type FilterChip } from "./FilterBar";
export { BarChart } from "./BarChart";
