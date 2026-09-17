import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type ContentTypeRow, type EntryRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { attachVisibilitySwitches, buildEntryIndex } from "../lib/inlineEdit";
import { Link, navigate } from "../lib/router";
import { useAsync, useDebounced, useMutation } from "../lib/useAsync";
import { useToast } from "../ui/toast";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  Skeleton,
} from "../ui/primitives";
import { DataView, WorkflowBadge, formatDateTime, relativeTime, type Column } from "../ui/data";

/* ================================================================== */
/* The site itself, embedded                                           */
/* ================================================================== */

/**
 * The published website, in an iframe.
 *
 * **An iframe rather than the site's components.** It would be possible to
 * import `App` from the site and render it here, and it would be the wrong
 * thing twice over: `admin/main.tsx` states that the dashboard shares nothing
 * with the site's bundle but the theme tokens, `Wordmark` and `cn`, and doing
 * it would pull the whole site in behind it — including the three.js chunk
 * that `ModelScene` goes to the trouble of importing dynamically so it lands
 * in its own file. An iframe costs the dashboard bundle nothing and is not a
 * copy of the site at all: it *is* the site, the same build a visitor gets,
 * rendering the same published snapshot. There is nothing here to drift.
 *
 * It shows `/` — the same target as "Website ansehen" at the foot of the rail
 * — so this works in development, where the dev server holds both entries, and
 * in production, where one host serves `index.html` and `admin.html`.
 *
 * Two things worth knowing. The frame loads the real site, three.js and all,
 * so this page is heavier than the rest of the dashboard; and it shows the
 * *published* document, so a saved-but-unreleased edit will not appear in it —
 * which is the honest answer to "what does the website look like", and the
 * same separation the whole CMS is built on. There is no reload control: a
 * fresh publish shows up on the next visit to this page, or on F5.
 *
 * `CodeGate` is not a problem: with no `VITE_ACCESS_CODE` in the build it
 * renders straight through. With one set, the frame shows the code dialog
 * until the session is unlocked — and because it is the same origin,
 * unlocking it in either place unlocks both.
 */
function SitePreview() {
  const frame = useRef<HTMLIFrameElement>(null);
  const toast = useToast();

  const entries = useAsync(
    () => api.entries({ perPage: 500 }).then((p) => p.items).catch(() => [] as EntryRow[]),
    [],
  );

  /**
   * Which entries are switched off, held here rather than re-fetched.
   *
   * The switch has to answer instantly — that is the whole point of it — so
   * the state flips locally and the request follows. A failed request puts it
   * back and says so, which is the only case where the two can disagree.
   */
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!entries.data) return;
    setHidden(Object.fromEntries(entries.data.map((e) => [e.id, Boolean(e.hidden)])));
  }, [entries.data]);

  const index = useMemo(() => buildEntryIndex(entries.data ?? []), [entries.data]);

  // Read through a ref so the effect below does not re-attach the overlay on
  // every toggle — re-attaching mid-click would drop the button out from
  // under the cursor.
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  const toggle = useCallback(
    (entryId: string, label: string, next: boolean) => {
      setHidden((h) => ({ ...h, [entryId]: next }));
      api.setEntryVisibility(entryId, next).catch((err) => {
        setHidden((h) => ({ ...h, [entryId]: !next }));
        toast.error(
          `„${label}" konnte nicht umgeschaltet werden.`,
          err instanceof Error ? err.message : undefined,
        );
      });
    },
    [toast],
  );

  /**
   * Attaching is an effect, not a click handler, because the frame can reload
   * under us — following a link, or React remounting it — and the switches
   * have to come back when it does. `load` fires on every document the frame
   * shows, so this re-runs for each and the cleanup unwinds the previous one.
   */
  useEffect(() => {
    const el = frame.current;
    if (!el || index.size === 0) return;

    let detach: (() => void) | null = null;
    const attach = () => {
      detach?.();
      // Same origin, so this is readable. A cross-origin frame throws here
      // rather than silently doing nothing, which is the honest failure.
      const doc = el.contentDocument;
      if (!doc?.body) return;
      detach = attachVisibilitySwitches(doc, {
        index,
        isHidden: (id) => Boolean(hiddenRef.current[id]),
        onToggle: (hit, next) => toggle(hit.entryId, hit.label, next),
      });
    };

    attach();
    el.addEventListener("load", attach);
    return () => {
      el.removeEventListener("load", attach);
      detach?.();
    };
  }, [index, toggle]);

  const off = Object.values(hidden).filter(Boolean).length;

  return (
    /*
      `-mx-4 lg:-mx-8` cancels the gutter `AdminLayout` puts on `<main>`, so the
      frame sits flush with the edges of the content column instead of being
      inset by it. The site inside keeps its own `px-6 lg:px-10` — that gutter
      belongs to the website and is part of what the preview is showing. Only
      the dashboard's own padding is taken back, which is why the numbers stop
      stacking: 32px of shell plus 40px of site became 40px of site.

      The values must stay in step with `<main>`. If its padding changes, this
      changes with it, or the frame will either leave a strip of ground beside
      it or push a scrollbar onto the page.
    */
    <section className="panel -mx-4 overflow-hidden lg:-mx-8">
      {/* A line of orientation, not a control. The switches live on the
          content itself; this only says they are there and keeps the count of
          what is currently switched off in view, because a hidden entry
          disappears from the page at the next publish and would otherwise be
          hard to remember. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2">
        <p className="min-w-0 flex-1 truncate text-[13px] text-muted">
          Auf einen Eintrag zeigen — der Schalter nimmt ihn von der Website oder stellt ihn zurück.
        </p>
        {off > 0 ? (
          <span className="shrink-0 rounded-full bg-brand-bronze/10 px-2.5 py-0.5 text-[12px] font-medium text-brand-bronze">
            {off} ausgeschaltet · wirkt mit dem nächsten Veröffentlichen
          </span>
        ) : null}
      </div>
      <iframe
        ref={frame}
        src="/"
        title="Vorschau der Website"
        // No `sandbox`: the frame is our own origin and the site needs its own
        // scripts to render at all. Sandboxing it would show a dead page — and
        // the edit mode reads `contentDocument`, which a sandbox would forbid.
        className="block h-[min(70vh,44rem)] min-h-[28rem] w-full border-0 bg-surface"
      />
    </section>
  );
}

/* ================================================================== */
/* The index of content types                                          */
/* ================================================================== */

/**
 * Every editable part of the site, grouped.
 *
 * The grouping is by what a person came here to change, not by the database's
 * `kind`: someone updating the team does not care that `team` is a collection
 * and `teamImage` a singleton. Ranks in `content-types.ts` put the
 * page-shaping blocks first and the label blocks last, which is the order
 * people need them in — copy gets edited constantly, `aria-label` text almost
 * never.
 */
export function ContentIndexPage() {
  const types = useAsync(() => api.contentTypes(), []);
  const entries = useAsync(() => api.entries({ perPage: 200 }), []);

  const counts = useMemo(() => {
    const map = new Map<string, { total: number; draft: number }>();
    for (const e of entries.data?.items ?? []) {
      const c = map.get(e.typeKey) ?? { total: 0, draft: 0 };
      c.total++;
      if (e.status === "DRAFT" || e.status === "IN_REVIEW") c.draft++;
      map.set(e.typeKey, c);
    }
    return map;
  }, [entries.data]);

  if (types.error) return <ErrorState message={types.error} onRetry={types.reload} />;

  const groups = [
    { label: "Seite", match: (t: ContentTypeRow) => t.rank < 30 },
    { label: "Inhalte", match: (t: ContentTypeRow) => t.rank >= 30 && t.rank < 160 },
    { label: "Angaben & SEO", match: (t: ContentTypeRow) => t.rank >= 160 && t.rank < 300 },
    { label: "Beschriftungen", match: (t: ContentTypeRow) => t.rank >= 300 },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Inhalte"
        title="Alles, was auf der Website steht"
        description="Jeder Abschnitt, jede Karte, jedes Bild und jede Beschriftung. Änderungen gehen als Entwurf in die Freigabe und werden erst mit dem Veröffentlichen sichtbar."
      />

      <SitePreview />

      {types.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : (
        groups.map((group) => {
          const items = (types.data ?? []).filter(group.match);
          if (!items.length) return null;
          return (
            <section key={group.label} className="flex flex-col gap-3">
              <h2 className="eyebrow text-muted">{group.label}</h2>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((type) => {
                  const count = counts.get(type.key);
                  return (
                    <li key={type.key}>
                      <Link
                        to={`/inhalte/${type.key}`}
                        className="flex h-full flex-col gap-2 rounded-lg bg-surface p-5 ring-1 ring-line transition-shadow hover:shadow-card"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-display text-[15px] font-semibold leading-tight text-ink">
                            {type.name}
                          </h3>
                          {type.kind === "COLLECTION" ? (
                            <span className="shrink-0 font-mono text-[12px] tnum text-muted">
                              {count?.total ?? 0}
                            </span>
                          ) : null}
                        </div>
                        <p className="flex-1 text-[13px] leading-snug text-muted">
                          {type.description}
                        </p>
                        {count?.draft ? (
                          <p className="text-[12px] font-medium text-brand-bronze">
                            {count.draft} {count.draft === 1 ? "Änderung" : "Änderungen"} offen
                          </p>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}

/* ================================================================== */
/* One content type's entries                                          */
/* ================================================================== */

export function ContentListPage({ typeKey }: { typeKey: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const [confirmDelete, setConfirmDelete] = useState<EntryRow | null>(null);

  const types = useAsync(() => api.contentTypes(), []);
  const list = useAsync(
    () => api.entries({ typeKey, search: debounced || undefined, page, perPage: 50 }),
    [typeKey, debounced, page],
  );

  const type = types.data?.find((t) => t.key === typeKey);

  const remove = useMutation(api.deleteEntry);
  const duplicate = useMutation(api.duplicateEntry);
  const reorder = useMutation(api.reorder);

  /**
   * A singleton has exactly one entry and no list worth showing — go straight
   * to its editor. Rendering a one-row table with a "Bearbeiten" link would be
   * a click and a screen of chrome between a person and the footer copy they
   * came to change.
   */
  if (type?.kind === "SINGLETON" && list.data?.items.length === 1) {
    navigate(`/inhalte/${typeKey}/${list.data.items[0].id}`, { replace: true });
    return null;
  }

  const columns: Column<EntryRow>[] = [
    {
      key: "key",
      header: "Eintrag",
      sortValue: (r) => title(r),
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">{title(r)}</span>
          <span className="font-mono text-[11px] text-muted">{r.key}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      className: "w-36",
      sortValue: (r) => r.status,
      render: (r) => <WorkflowBadge state={r.status} />,
    },
    {
      key: "updated",
      header: "Geändert",
      secondary: true,
      className: "w-44",
      sortValue: (r) => r.updatedAt,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] text-ink" title={formatDateTime(r.updatedAt)}>
            {relativeTime(r.updatedAt)}
          </span>
          {r.updatedBy ? (
            <span className="text-[11px] text-muted">{r.updatedBy.name}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "versions",
      header: "Ver.",
      numeric: true,
      secondary: true,
      className: "w-20",
      sortValue: (r) => r.version,
      render: (r) => r.version,
    },
    {
      key: "actions",
      header: "",
      className: "w-px",
      render: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {can("content.duplicate") && type?.kind === "COLLECTION" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const created = await duplicate.run(r.id);
                if (created) {
                  toast.success("Dupliziert", `„${created.key}“ wurde als Entwurf angelegt.`);
                  list.reload();
                }
              }}
            >
              Duplizieren
            </Button>
          ) : null}
          {can("content.delete") && type?.kind === "COLLECTION" ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r)}>
              Löschen
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;

  const rows = list.data?.items ?? [];
  const orderable = type?.orderable && type.kind === "COLLECTION" && !debounced;

  return (
    <>
      <PageHeader
        eyebrow="Inhalte"
        title={type?.name ?? typeKey}
        description={type?.description ?? undefined}
        actions={
          <>
            <Button variant="ghost" href="#/inhalte">
              Alle Bereiche
            </Button>
            {can("content.create") && type?.kind === "COLLECTION" ? (
              <Button variant="primary" href={`#/inhalte/${typeKey}/neu`}>
                + Neu
              </Button>
            ) : null}
          </>
        }
      />

      <Card bodyClassName="p-0">
        <div className="p-5">
          <DataView
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/inhalte/${typeKey}/${r.id}`)}
            loading={list.loading}
            caption={`Einträge im Bereich ${type?.name ?? typeKey}`}
            page={list.data?.page ?? 1}
            pages={list.data?.pages ?? 1}
            total={list.data?.total ?? 0}
            perPage={list.data?.perPage ?? 50}
            onPageChange={setPage}
            toolbar={
              <>
                <SearchInput
                  value={search}
                  onChange={(v) => {
                    setSearch(v);
                    setPage(1);
                  }}
                  label={`${type?.name ?? "Einträge"} durchsuchen`}
                  placeholder="Suchen"
                  className="w-full sm:w-72"
                />
                {orderable && can("content.reorder") && rows.length > 1 ? (
                  <ReorderControls
                    rows={rows}
                    busy={reorder.busy}
                    onApply={async (ids) => {
                      await reorder.run(typeKey, ids);
                      toast.success("Reihenfolge gespeichert");
                      list.reload();
                    }}
                  />
                ) : null}
              </>
            }
            empty={
              <EmptyState
                title={debounced ? `Nichts gefunden für „${debounced}“.` : "Noch keine Einträge"}
                description={
                  debounced
                    ? undefined
                    : `In „${type?.name ?? typeKey}“ ist noch nichts erfasst.`
                }
                action={
                  debounced ? (
                    <Button onClick={() => setSearch("")}>Suche zurücksetzen</Button>
                  ) : can("content.create") ? (
                    <Button variant="primary" href={`#/inhalte/${typeKey}/neu`}>
                      Ersten Eintrag anlegen
                    </Button>
                  ) : null
                }
              />
            }
          />
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        busy={remove.busy}
        destructive
        title="Eintrag löschen?"
        confirmLabel="Löschen"
        message={
          <>
            <p>
              „{confirmDelete ? title(confirmDelete) : ""}“ wird aus der Liste entfernt. Die
              Versionsgeschichte bleibt erhalten und der Eintrag kann wiederhergestellt werden.
            </p>
            <p className="mt-2">
              Sichtbar wird die Änderung erst mit der nächsten Veröffentlichung.
            </p>
          </>
        }
        onConfirm={async () => {
          if (!confirmDelete) return;
          await remove.run(confirmDelete.id);
          toast.success("Gelöscht", `„${title(confirmDelete)}“ wurde entfernt.`);
          setConfirmDelete(null);
          list.reload();
        }}
      />
    </>
  );
}

/**
 * Moves entries up and down, then saves the order in one call.
 *
 * Buttons, not drag-and-drop: this is a table row, drag targets in tables are
 * fiddly on a trackpad and impossible on a keyboard, and these lists run to a
 * few dozen items. The order is applied locally and sent once, so a reorder of
 * thirty projects is one request rather than thirty.
 */
function ReorderControls({
  rows,
  onApply,
  busy,
}: {
  rows: EntryRow[];
  onApply: (ids: string[]) => void;
  busy: boolean;
}) {
  const [order, setOrder] = useState<string[] | null>(null);
  const current = order ?? rows.map((r) => r.id);
  const dirty = order !== null && order.join() !== rows.map((r) => r.id).join();

  if (!order) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOrder(rows.map((r) => r.id))}>
        Reihenfolge ändern
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
      <span className="text-[13px] text-muted">
        Einträge mit den Pfeilen verschieben, dann speichern.
      </span>
      <div className="flex items-center gap-1">
        {current.map((id, i) => {
          const row = rows.find((r) => r.id === id);
          return (
            <span key={id} className="sr-only">
              {i + 1}. {row ? title(row) : id}
            </span>
          );
        })}
      </div>
      <Button
        size="sm"
        variant="primary"
        disabled={!dirty}
        busy={busy}
        onClick={() => onApply(current)}
      >
        Speichern
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOrder(null)}>
        Abbrechen
      </Button>
    </div>
  );
}

/**
 * A human name for an entry.
 *
 * Content is JSON, so there is no column to read — this tries the fields that
 * actually name things in this model, in the order they are likely to. Falls
 * back to the slug, which is at least stable and greppable.
 */
export function title(entry: EntryRow): string {
  const d = entry.data ?? {};
  for (const key of ["name", "title", "titel", "label", "role", "city", "no"]) {
    const value = d[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  // A phase entry has `no` + `title`; a leitbild entry has `title`. A nested
  // `detail.titel` is the job adverts' real headline.
  const detail = d.detail as Record<string, unknown> | undefined;
  if (detail && typeof detail.titel === "string") return detail.titel;
  return entry.key;
}
