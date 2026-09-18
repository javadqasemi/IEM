import { useState } from "react";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import {
  Badge,
  Button,
  Card,
  DownloadButton,
  EmptyState,
  ErrorState,
  PageHeader,
} from "@/shared/ui/primitives";
import { SearchInput } from "@/shared/ui/forms";
import { BulkBar, ColumnPicker, DataView, type Column } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import {
  APPLICATION_STATUS_OPTIONS,
  ApplicationBadge,
  type Application,
} from "@/entities/application";
import { useDebounced, useListView } from "@/shared/hooks";
import { useAuth } from "@/core/auth";
import {
  useApplicationList,
  useApplicationMutations,
  useApplicationStats,
} from "../hooks/useApplications";
import type { ApplicationQuery } from "../repository";
import { isRetentionExpiring, retentionDaysLeft, sortName } from "../service";
import { ApplicationDetail } from "./ApplicationDetail";

/**
 * Incoming job applications.
 *
 * Personal data under the revDSG, and the screen says so: every record shows
 * its deletion date, dossiers download through a permission-checked route
 * rather than a public URL, and opening one is itself recorded in the audit
 * log.
 *
 * Rendering only — no fetch call and no rule. Both come in through the hooks
 * and the service, which is the contract the five layers exist for.
 */
export function ApplicationList() {
  const toast = useToast();
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const debounced = useDebounced(search);

  /**
   * The saved view, and the sort that comes with it (foundation stage F11).
   *
   * Sorting is the **server's** now: the list is paginated, so reordering the
   * twenty rows on screen would show the wrong twenty at the top. The default
   * is the one the server would have used anyway, stated here so the header
   * arrow is correct before the first response.
   */
  const view = useListView("application", {
    sort: { field: "createdAt", dir: "desc" },
  });

  const query: ApplicationQuery = {
    search: debounced || undefined,
    status: status || undefined,
    sort: view.view.sort,
    page,
    perPage: 25,
  };

  const list = useApplicationList(query);
  const stats = useApplicationStats();
  const mutations = useApplicationMutations();

  const columns: Column<Application>[] = [
    {
      key: "name",
      header: "Bewerber:in",
      // `sortField` is what the *server* orders by; `sortValue` is what a
      // client-side sort would have compared. Both are kept: the first is in
      // use, the second documents the intent and is what a non-paginated list
      // of these would use.
      sortField: "lastName",
      sortValue: sortName,
      // The row's identity. The column picker cannot hide it — a table of
      // anonymous cells is one nobody can read.
      required: true,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">
            {r.firstName} {r.lastName}
          </span>
          <span className="text-[12px] text-muted">{r.email}</span>
        </div>
      ),
    },
    {
      key: "position",
      header: "Position",
      sortField: "position",
      render: (r) => r.position,
    },
    {
      key: "files",
      header: "Dateien",
      numeric: true,
      secondary: true,
      className: "w-24",
      // No `sortField`: `files` is a jsonb column and ordering by its length
      // is not something Postgres will do from an index. Leaving it out is
      // honest; adding it and having the server refuse would be worse.
      render: (r) => r.files.length,
    },
    {
      key: "status",
      header: "Status",
      className: "w-36",
      sortField: "status",
      render: (r) => <ApplicationBadge status={r.status} />,
    },
    {
      key: "created",
      header: "Eingegangen",
      className: "w-36",
      sortField: "createdAt",
      render: (r) => (
        <span title={formatDateTime(r.receivedAt)}>{relativeTime(r.receivedAt)}</span>
      ),
    },
    {
      /**
       * The column the service layer paid for.
       *
       * Deletion is not a policy statement here — a nightly job removes the
       * row and its files on `retainUntil`, and there is no recycle bin for
       * personal data. Thirty days' warning is roughly how long it takes to
       * restart a conversation with someone.
       */
      key: "retention",
      header: "Löschung",
      className: "w-32",
      secondary: true,
      sortField: "retainUntil",
      render: (r) => {
        const days = retentionDaysLeft(r);
        if (days === null) return <span className="text-muted">—</span>;
        return isRetentionExpiring(r) ? (
          <Badge tone="bronze">in {days} T.</Badge>
        ) : (
          <span className="text-muted">in {days} T.</span>
        );
      },
    },
  ];

  if (list.error) return <ErrorState message={list.error} onRetry={list.refetch} />;

  return (
    <>
      <PageHeader
        eyebrow="Bewerbungen"
        title="Eingegangene Bewerbungen"
        description="Über das Formular auf der Website. Unterlagen werden nicht öffentlich abgelegt und nach Ablauf der Aufbewahrungsfrist automatisch gelöscht."
      />

      {stats.data ? (
        <div className="flex flex-wrap gap-2">
          {APPLICATION_STATUS_OPTIONS.map((o) => {
            // Never `undefined`: the mapper fills every status, because the
            // endpoint only returns the ones with rows and a missing key
            // renders as nothing where 0 is the answer.
            const n = stats.data!.byStatus[o.value];
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  setStatus(status === o.value ? "" : o.value);
                  setPage(1);
                }}
                aria-pressed={status === o.value}
                className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  status === o.value
                    ? "bg-ink text-inverse"
                    : "bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-line-strong"
                }`}
              >
                {o.label}
                {/*
                  No `opacity-70`.

                  It was there, and axe measured what it cost: the count is
                  `text-muted` on `surface`, and seven tenths of that is below
                  4.5:1 in both themes. Opacity is the one property that carries
                  information *and* takes contrast away, which is the same
                  finding as the settings screen's "noch nicht angebunden"
                  mark — dimmed to 2.54:1 to say something a label says better.

                  It is a pre-existing failure that this refactor *exposed*
                  rather than caused: the chips only render once the stats have
                  loaded, and before the query cache the axe pass usually
                  reached this screen before the request landed. Cached, they
                  are reliably on screen — and reliably measured.

                  The count stays distinguishable by being mono and smaller.
                */}
                <span className="font-mono text-[11px] tnum">{n}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/*
        The bulk bar sits above the table rather than floating over it.

        A sticky bar across the bottom hides a row, and the row it hides is the
        one somebody is about to tick.
      */}
      <BulkBar
        count={selection.size}
        onClear={() => setSelection(new Set())}
        noun="Bewerbungen"
      >
        {can("application.update")
          ? (["IN_REVIEW", "REJECTED"] as const).map((next) => (
              <Button
                key={next}
                size="sm"
                variant="secondary"
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const changed = await mutations.bulkStatus([...selection], next);
                    setSelection(new Set());
                    toast.success(`${changed} geändert`);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Nicht möglich.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Auf „{APPLICATION_STATUS_OPTIONS.find((o) => o.value === next)!.label}“ setzen
              </Button>
            ))
          : null}
      </BulkBar>

      <Card bodyClassName="p-5">
        <DataView
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => setOpenId(r.id)}
          loading={list.loading}
          caption="Bewerbungen"
          page={list.data?.page ?? 1}
          pages={list.data?.pages ?? 1}
          total={list.data?.total ?? 0}
          perPage={list.data?.perPage ?? 25}
          onPageChange={setPage}
          selection={selection}
          onSelectionChange={setSelection}
          sort={view.view.sort}
          onSortChange={(next) => {
            view.setSort(next);
            // Back to page one: the row that was at the top of page three is
            // somewhere else entirely under a different order, and staying put
            // shows the reader an arbitrary slice.
            setPage(1);
          }}
          hiddenColumns={view.hidden}
          toolbar={
            <>
              <SearchInput
                value={search}
                onChange={(v) => {
                  setSearch(v);
                  setPage(1);
                }}
                label="Bewerbungen durchsuchen"
                placeholder="Name, E-Mail oder Position"
                className="w-full sm:w-80"
              />
              <div className="ml-auto flex items-center gap-2">
                <ColumnPicker
                  columns={columns.map((c) => ({
                    key: c.key,
                    header: c.header,
                    required: c.required,
                  }))}
                  hidden={view.hidden}
                  onChange={view.setHidden}
                  onReset={view.reset}
                />
                {can("application.export") ? (
                  <DownloadButton
                    variant="secondary"
                    label="Als CSV exportieren"
                    // The query, not nothing: an export that quietly contains
                    // more than the filtered view is a document somebody will
                    // act on (architecture §7.2).
                    onDownload={() => mutations.exportCsv(query)}
                  />
                ) : null}
              </div>
            </>
          }
          empty={
            <EmptyState
              title={debounced || status ? "Nichts gefunden" : "Noch keine Bewerbungen"}
              description={
                debounced || status
                  ? undefined
                  : "Sobald jemand das Formular auf der Website absendet, erscheint die Bewerbung hier."
              }
            />
          }
        />
      </Card>

      <ApplicationDetail
        id={openId}
        onClose={() => setOpenId(null)}
        onSaved={() => toast.success("Gespeichert")}
        onDeleted={() => toast.success("Gelöscht")}
      />
    </>
  );
}
