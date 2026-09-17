import { useMemo, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Badge, EmptyState, Pagination, SkeletonTable, type BadgeTone } from "./primitives";

/**
 * Tables, KPI tiles, charts and the activity feed.
 *
 * Split from `primitives.tsx` because these are compositions — they assume a
 * shape of data — where the primitives assume nothing. Still no domain
 * knowledge: `DataTable` does not know what a content entry is, only that it
 * has columns.
 */

/* ================================================================== */
/* DataTable                                                           */
/* ================================================================== */

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

/* ================================================================== */
/* KPI                                                                 */
/* ================================================================== */

export function KpiCard({
  label,
  value,
  note,
  tone = "navy",
  href,
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: BadgeTone;
  href?: string;
}) {
  const toneText: Record<BadgeTone, string> = {
    neutral: "text-ink",
    navy: "text-accent",
    gold: "text-disc-power",
    bronze: "text-brand-bronze",
    energy: "text-disc-energy",
    water: "text-disc-water",
    air: "text-disc-air",
  };

  const inner = (
    <>
      <div className={cn("font-display text-[30px] font-semibold leading-none tnum", toneText[tone])}>
        {value}
      </div>
      <div className="eyebrow text-muted">{label}</div>
      {note ? <div className="text-[12px] leading-snug text-muted">{note}</div> : null}
    </>
  );

  const classes =
    "flex flex-col gap-2 rounded-lg bg-surface p-5 ring-1 ring-line transition-shadow";

  return href ? (
    <a href={`#${href}`} className={cn(classes, "hover:shadow-card")}>
      {inner}
    </a>
  ) : (
    <div className={classes}>{inner}</div>
  );
}

/**
 * A KPI tile with no data behind it.
 *
 * Shown instead of a zero for the figures the spec asks for that this system
 * has no source for — visitors, conversions, revenue. A zero would read as a
 * measurement; this reads as what it is. The whole page rests on its numbers
 * being checkable, and that has to include the dashboard.
 */
export function KpiUnavailable({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line-strong bg-surface/50 p-5">
      <div className="font-display text-[30px] font-semibold leading-none text-line-strong">—</div>
      <div className="eyebrow text-muted">{label}</div>
      <div className="text-[12px] leading-snug text-muted">{reason}</div>
    </div>
  );
}

/* ================================================================== */
/* Charts                                                              */
/* ================================================================== */

/**
 * A bar chart as inline SVG.
 *
 * No charting library: the dashboard shows two of these, both single-series
 * categorical, and a 140 kB dependency for that is not a trade worth making.
 * Values are labelled directly rather than read off an axis, which is both
 * more accurate and removes the need for gridlines.
 */
export function BarChart({
  data,
  format = (n) => String(n),
  label,
  tone = "navy",
}: {
  data: { label: string; value: number }[];
  format?: (value: number) => string;
  label: string;
  tone?: "navy" | "gold" | "energy";
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const fills = {
    navy: "bg-brand-navy",
    gold: "bg-disc-power",
    energy: "bg-disc-energy",
  };

  if (!data.length) {
    return <p className="py-6 text-center text-[13px] text-muted">Keine Daten.</p>;
  }

  return (
    // A list, not a canvas: every value is in the DOM as text, so the chart is
    // readable by a screen reader without a parallel table.
    <ul className="flex flex-col gap-2.5" aria-label={label}>
      {data.map((d) => (
        <li key={d.label} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-[13px] text-muted" title={d.label}>
            {d.label}
          </span>
          <span className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-sm bg-surface-2">
            <span
              className={cn("absolute inset-y-0 left-0 rounded-sm transition-all duration-500", fills[tone])}
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </span>
          <span className="w-16 shrink-0 text-right font-mono text-[12px] tnum text-ink">
            {format(d.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ================================================================== */
/* Activity feed                                                       */
/* ================================================================== */

export type ActivityItem = {
  id: string;
  action: string;
  actor: string;
  target?: string;
  message?: string | null;
  outcome?: "SUCCESS" | "FAILURE" | "DENIED";
  at: string;
};

/**
 * Maps an audit action to a readable German phrase.
 *
 * A lookup rather than a mechanical de-dotting of the key, because the log is
 * the one screen a non-developer reads in an incident and
 * "content.rolled_back" is not a sentence. Unknown actions fall through to the
 * raw key — visible and greppable, rather than hidden behind a generic label.
 */
const ACTION_LABELS: Record<string, string> = {
  "auth.login": "hat sich angemeldet",
  "auth.logout": "hat sich abgemeldet",
  "auth.logout_all": "hat alle Sitzungen beendet",
  "auth.login_failed": "Anmeldung fehlgeschlagen",
  "auth.login_locked": "Konto gesperrt nach Fehlversuchen",
  "auth.login_suspended": "Anmeldung eines gesperrten Kontos",
  "auth.refresh_reuse_detected": "Wiederverwendetes Sitzungstoken erkannt",
  "auth.password_changed": "hat das Passwort geändert",
  "auth.password_reset_requested": "hat ein neues Passwort angefordert",
  "auth.password_reset_completed": "hat das Passwort zurückgesetzt",
  "content.created": "hat angelegt",
  "content.updated": "hat bearbeitet",
  "content.deleted": "hat gelöscht",
  "content.restored": "hat wiederhergestellt",
  "content.duplicated": "hat dupliziert",
  "content.reordered": "hat die Reihenfolge geändert",
  "content.submitted": "hat zur Freigabe eingereicht",
  "content.approved": "hat freigegeben",
  "content.rejected": "hat abgelehnt",
  "content.published": "hat veröffentlicht",
  "content.rolled_back": "hat zurückgesetzt",
  "content.snapshot_restored": "hat einen früheren Stand wiederhergestellt",
  "content.scheduled_publish_failed": "Zeitgesteuerte Veröffentlichung fehlgeschlagen",
  "media.uploaded": "hat hochgeladen",
  "media.updated": "hat Metadaten geändert",
  "media.replaced": "hat die Datei ersetzt",
  "media.deleted": "hat gelöscht",
  "media.bulk_deleted": "hat mehrere Dateien gelöscht",
  "media.folder_created": "hat einen Ordner angelegt",
  "media.folder_deleted": "hat einen Ordner gelöscht",
  "user.invited": "hat eingeladen",
  "user.updated": "hat bearbeitet",
  "user.roles_changed": "hat Rollen geändert",
  "user.deleted": "hat gelöscht",
  "user.password_reset_sent": "hat einen Passwortlink verschickt",
  "role.created": "hat eine Rolle angelegt",
  "role.updated": "hat eine Rolle geändert",
  "role.deleted": "hat eine Rolle gelöscht",
  "settings.updated": "hat Einstellungen geändert",
  "application.received": "Neue Bewerbung eingegangen",
  "application.viewed": "hat eine Bewerbung geöffnet",
  "application.updated": "hat eine Bewerbung bearbeitet",
  "application.file_downloaded": "hat Unterlagen heruntergeladen",
  "application.deleted": "hat eine Bewerbung gelöscht",
  "application.retention_purge": "Aufbewahrungsfrist abgelaufen",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) {
    return <p className="py-6 text-center text-[13px] text-muted">Noch keine Aktivität.</p>;
  }
  return (
    <ol className="flex flex-col">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 border-b border-line py-3 last:border-0">
          <span
            aria-hidden
            className={cn(
              "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
              item.outcome === "FAILURE" || item.outcome === "DENIED"
                ? "bg-brand-bronze"
                : "bg-brand-blue/50",
            )}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-[13px] leading-snug text-ink">
              <span className="font-medium">{item.actor}</span> {actionLabel(item.action)}
              {item.target ? <span className="text-muted"> · {item.target}</span> : null}
            </p>
            {item.message ? (
              <p className="truncate text-[12px] text-muted" title={item.message}>
                {item.message}
              </p>
            ) : null}
          </div>
          <time
            dateTime={item.at}
            className="shrink-0 font-mono text-[11px] tnum text-muted"
            title={new Date(item.at).toLocaleString("de-CH")}
          >
            {relativeTime(item.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

/**
 * "vor 3 Min." — relative for anything inside a week, absolute beyond it.
 *
 * Relative timestamps are easier to scan in a feed but useless for anything a
 * person might have to reference later, which is exactly what an audit trail
 * is for. The `title` attribute always carries the exact value.
 */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 45) return "gerade eben";
  if (seconds < 3600) return `vor ${Math.round(seconds / 60)} Min.`;
  if (seconds < 86400) return `vor ${Math.round(seconds / 3600)} Std.`;
  if (seconds < 604800) return `vor ${Math.round(seconds / 86400)} T.`;
  return new Date(iso).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/* ================================================================== */
/* Status                                                              */
/* ================================================================== */

const WORKFLOW_TONES: Record<string, { tone: BadgeTone; label: string }> = {
  DRAFT: { tone: "neutral", label: "Entwurf" },
  IN_REVIEW: { tone: "gold", label: "In Prüfung" },
  APPROVED: { tone: "water", label: "Freigegeben" },
  PUBLISHED: { tone: "energy", label: "Veröffentlicht" },
  REJECTED: { tone: "bronze", label: "Abgelehnt" },
  ARCHIVED: { tone: "neutral", label: "Archiviert" },
};

export function WorkflowBadge({ state }: { state: string }) {
  const meta = WORKFLOW_TONES[state] ?? { tone: "neutral" as BadgeTone, label: state };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const APPLICATION_TONES: Record<string, { tone: BadgeTone; label: string }> = {
  NEW: { tone: "navy", label: "Neu" },
  IN_REVIEW: { tone: "gold", label: "In Prüfung" },
  INTERVIEW: { tone: "water", label: "Gespräch" },
  HIRED: { tone: "energy", label: "Eingestellt" },
  REJECTED: { tone: "bronze", label: "Abgelehnt" },
  WITHDRAWN: { tone: "neutral", label: "Zurückgezogen" },
};

export function ApplicationBadge({ status }: { status: string }) {
  const meta = APPLICATION_TONES[status] ?? { tone: "neutral" as BadgeTone, label: status };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export const APPLICATION_STATUS_OPTIONS = Object.entries(APPLICATION_TONES).map(([value, m]) => ({
  value,
  label: m.label,
}));

/* ================================================================== */
/* Formatting                                                          */
/* ================================================================== */

/** Swiss convention: apostrophe thousands separator. */
export function formatNumber(n: number): string {
  return n.toLocaleString("de-CH");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toLocaleString("de-CH", { maximumFractionDigits: 1 })} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toLocaleString("de-CH", { maximumFractionDigits: 2 })} GB`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
