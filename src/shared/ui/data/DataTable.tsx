import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";
import { EmptyState, SkeletonTable } from "@/shared/ui/primitives";
import { Pagination } from "@/shared/ui/navigation";

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
};

/**
 * The dashboard's one table.
 *
 * Every list screen uses it, which is what stops six slightly different tables
 * existing. Sorting is client-side and deliberately so: these lists are
 * paginated to at most 200 rows, and a round trip to reorder 40 projects
 * would be slower and more code than sorting the page in hand. A list that
 * outgrows that should sort on the server, and the `sortValue` hook is where
 * that change would land.
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
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      // `de-CH`, so Ä/Ö/Ü sort beside A/O/U rather than after Z — the same
      // rule the site's team roster uses.
      return String(av).localeCompare(String(bv), "de-CH") * factor;
    });
  }, [rows, columns, sort]);

  if (loading) return <SkeletonTable rows={6} cols={columns.length} />;

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
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn(
                    "eyebrow px-4 py-2.5 text-left font-medium text-muted",
                    c.numeric && "text-right",
                    c.secondary && "hidden sm:table-cell",
                    c.className,
                  )}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSort(
                          active && sort!.dir === "asc"
                            ? { key: c.key, dir: "desc" }
                            : { key: c.key, dir: "asc" },
                        )
                      }
                      className="inline-flex items-center gap-1 transition-colors hover:text-ink"
                    >
                      {c.header}
                      <span aria-hidden className={cn("text-[9px]", active ? "text-brand-blue" : "text-line-strong")}>
                        {active && sort!.dir === "desc" ? "▼" : "▲"}
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
                {columns.map((c) => (
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
      />
      {!loading && rows.length ? (
        <Pagination page={page} pages={pages} total={total} perPage={perPage} onChange={onPageChange} />
      ) : null}
    </div>
  );
}
