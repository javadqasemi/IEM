import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";
import { EmptyState, SkeletonTable } from "@/shared/ui/primitives";
import { Pagination } from "@/shared/ui/navigation";

export type SortState = { field: string; dir: "asc" | "desc" };

export type Column<T> = {
  key: string;
  header: string;
  /** Rendered cell. Return a string and it is wrapped for you. */
  render: (row: T) => ReactNode;
  /** Tailwind width/alignment for the column. */
  className?: string;
  /** Right-aligned numeric column with tabular figures. */
  numeric?: boolean;
  /** Hidden below `sm`. Use for anything that is not the row's identity. */
  secondary?: boolean;
  /** Returns a sortable value. Omit to make the column unsortable. */
  sortValue?: (row: T) => string | number;
  /**
   * The field name the *server* sorts by, when it differs from `key`.
   *
   * Given `sort`/`onSortChange`, this is what the table sends. Absent, `key`
   * is used — which is the common case and why this is optional.
   */
  sortField?: string;
  /** Never hidden by the column picker. The row's identity. */
  required?: boolean;
};

/**
 * The dashboard's one table.
 *
 * Every list screen uses it, which is what stops six slightly different tables
 * existing.
 *
 * **Sorting happens on whichever side the caller wires up** (weakness W6).
 * Pass `sort` and `onSortChange` and the header buttons report the field to
 * the caller, which puts it in the query — that is the only correct answer
 * once a list is paginated, because sorting the *page* reorders twenty rows
 * out of four hundred and shows the wrong twenty at the top. Pass neither and
 * it sorts the rows it has, which is still right for a list that is never
 * paginated.
 *
 * The comment that used to stand here said the `sortValue` hook was where
 * server sorting would land. It is `sortField`, beside it.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  loading,
  empty,
  selection,
  onSelectionChange,
  caption,
  sort: serverSort,
  onSortChange,
  hiddenColumns,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  /** Selected keys. Pass with `onSelectionChange` to enable checkboxes. */
  selection?: Set<string>;
  onSelectionChange?: (next: Set<string>) => void;
  caption: string;
  /** Given with `onSortChange`, sorting is the server's. */
  sort?: SortState;
  onSortChange?: (next: SortState) => void;
  /** Column keys the reader has hidden. `required` columns are never hidden. */
  hiddenColumns?: Set<string>;
}) {
  const [localSort, setLocalSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const serverSorted = Boolean(onSortChange);

  const visibleColumns = useMemo(
    () => columns.filter((c) => c.required || !hiddenColumns?.has(c.key)),
    [columns, hiddenColumns],
  );

  const sorted = useMemo(() => {
    // The server already ordered them. Re-sorting here would reorder the page
    // by a different rule and make the result look random across pages.
    if (serverSorted) return rows;
    if (!localSort) return rows;
    const column = columns.find((c) => c.key === localSort.key);
    if (!column?.sortValue) return rows;
    const factor = localSort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      // `de-CH`, so Ä/Ö/Ü sort beside A/O/U rather than after Z — the same
      // rule the site's team roster uses.
      return String(av).localeCompare(String(bv), "de-CH") * factor;
    });
  }, [rows, columns, localSort, serverSorted]);

  /** Which column the arrow is on, from whichever side owns the sort. */
  const activeKey = serverSorted
    ? visibleColumns.find((c) => (c.sortField ?? c.key) === serverSort?.field)?.key
    : localSort?.key;
  const activeDir = serverSorted ? serverSort?.dir : localSort?.dir;

  const toggleSort = (column: Column<T>) => {
    const next: "asc" | "desc" = activeKey === column.key && activeDir === "asc" ? "desc" : "asc";
    if (onSortChange) onSortChange({ field: column.sortField ?? column.key, dir: next });
    else setLocalSort({ key: column.key, dir: next });
  };

  if (loading) return <SkeletonTable rows={6} cols={visibleColumns.length} />;

  if (!rows.length) {
    return <>{empty ?? <EmptyState title="Keine Einträge" />}</>;
  }

  const selectable = Boolean(selection && onSelectionChange);
  const allSelected = selectable && rows.every((r) => selection!.has(rowKey(r)));

  const toggleAll = () => {
    const next = new Set(selection);
    if (allSelected) rows.forEach((r) => next.delete(rowKey(r)));
    else rows.forEach((r) => next.add(rowKey(r)));
    onSelectionChange!(next);
  };

  const toggleOne = (key: string) => {
    const next = new Set(selection);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange!(next);
  };

  return (
    // Its own horizontal scroll container, so a wide table scrolls rather than
    // pushing the whole page sideways.
    <div className="scroll-thin overflow-x-auto rounded-lg ring-1 ring-line">
      <table className="w-full border-collapse bg-surface text-[14px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-surface-2/60">
            {selectable ? (
              <th scope="col" className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Alle auswählen"
                  className="h-4 w-4 cursor-pointer rounded border-line-strong text-accent focus:ring-2 focus:ring-accent"
                />
              </th>
            ) : null}
            {visibleColumns.map((c) => {
              const active = activeKey === c.key;
              // Sortable when the caller gave it a client comparator, or when
              // the server owns the sort and the column names a field.
              const sortable = serverSorted ? Boolean(c.sortField ?? c.key) : Boolean(c.sortValue);
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (activeDir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn(
                    "eyebrow px-4 py-2.5 text-left font-medium text-muted",
                    c.numeric && "text-right",
                    c.secondary && "hidden sm:table-cell",
                    c.className,
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c)}
                      className="inline-flex items-center gap-1 transition-colors hover:text-ink"
                    >
                      {c.header}
                      <span aria-hidden className={cn("text-[9px]", active ? "text-brand-blue" : "text-line-strong")}>
                        {active && activeDir === "desc" ? "▼" : "▲"}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b border-line last:border-0 transition-colors",
                  onRowClick && "cursor-pointer hover:bg-surface-2/60",
                  selectable && selection!.has(key) && "bg-accent/[0.04]",
                )}
              >
                {selectable ? (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selection!.has(key)}
                      onChange={() => toggleOne(key)}
                      aria-label="Zeile auswählen"
                      className="h-4 w-4 cursor-pointer rounded border-line-strong text-accent focus:ring-2 focus:ring-accent"
                    />
                  </td>
                ) : null}
                {visibleColumns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "cell",
                      c.numeric && "text-right font-mono text-[13px] tnum",
                      c.secondary && "hidden sm:table-cell",
                      c.className,
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A table with its pagination bar — the shape every list screen wants. */
export function DataView<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  loading,
  empty,
  selection,
  onSelectionChange,
  caption,
  page,
  pages,
  total,
  perPage,
  onPageChange,
  toolbar,
  sort,
  onSortChange,
  hiddenColumns,
}: Parameters<typeof DataTable<T>>[0] & {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  onPageChange: (next: number) => void;
  toolbar?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {toolbar ? <div className="flex flex-wrap items-center gap-3">{toolbar}</div> : null}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={rowKey}
        onRowClick={onRowClick}
        loading={loading}
        empty={empty}
        selection={selection}
        onSelectionChange={onSelectionChange}
        caption={caption}
        sort={sort}
        onSortChange={onSortChange}
        hiddenColumns={hiddenColumns}
      />
      {!loading && rows.length ? (
        <Pagination page={page} pages={pages} total={total} perPage={perPage} onChange={onPageChange} />
      ) : null}
    </div>
  );
}
