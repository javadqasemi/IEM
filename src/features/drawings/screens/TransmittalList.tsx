import { useState } from "react";
import { navigate } from "@/core/router";
import { useAuth } from "@/core/auth";
import {
  PurposeBadge,
  TRANSMITTAL_PURPOSE_OPTIONS,
  mediumLabel,
  type Transmittal,
} from "@/entities/drawing";
import {
  Card,
  DownloadButton,
  EmptyState,
  ErrorState,
  PageHeader,
} from "@/shared/ui/primitives";
import { SearchInput, Select } from "@/shared/ui/forms";
import { DataView, type Column } from "@/shared/ui/data";
import { useDebounced, useListView } from "@/shared/hooks";
import { formatDate } from "@/shared/utils/format";
import { useDrawingMutations, useTransmittalList } from "../hooks/useDrawings";
import type { TransmittalQuery } from "../repository";

/**
 * Planversand — the register that makes the liability question answerable.
 *
 * **This screen is the module's whole argument in one table.** Six months later
 * the question is *"welche Revision hatte der Sanitär am 14. März"*, and the
 * answer has to be a row rather than a search through somebody's mailbox.
 *
 * It opens on what went out last, because that is nearly always the question —
 * and when it is not, it is a date, which is a filter rather than a sort.
 *
 * **There is no "Neuer Versand" button here**, and the absence is deliberate: a
 * Planversand is assembled from *plans*, so it starts on a project's Pläne tab
 * where the revisions are. A button here would open a dialog whose first
 * question is "which project", and the answer is always already known
 * somewhere else.
 */
export function TransmittalList() {
  const { can } = useAuth();

  const [search, setSearch] = useState("");
  const [purpose, setPurpose] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  const listView = useListView("transmittal", { sort: { field: "sentAt", dir: "desc" } });

  const query: TransmittalQuery = {
    search: debounced || undefined,
    purpose: purpose || undefined,
    sort: listView.view.sort,
    page,
    perPage: 25,
  };

  const list = useTransmittalList(query);
  const mutations = useDrawingMutations();

  const columns: Column<Transmittal>[] = [
    {
      key: "number",
      header: "Nummer",
      className: "w-40",
      sortField: "number",
      required: true,
      render: (r) => <span className="font-mono text-[13px] text-ink">{r.number}</span>,
    },
    {
      key: "sentAt",
      header: "Versandt",
      className: "w-36",
      sortField: "sentAt",
      required: true,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span>{formatDate(r.sentAt)}</span>
          <span className="text-[12px] text-muted">{mediumLabel(r.medium)}</span>
        </div>
      ),
    },
    {
      key: "purpose",
      header: "Zweck",
      className: "w-44",
      // The most consequential field: *zur Ausführung* means somebody is
      // building from it, and *zur Information* does not.
      render: (r) => <PurposeBadge purpose={r.purpose} />,
    },
    {
      key: "project",
      header: "Projekt",
      render: (r) =>
        r.project ? (
          <div className="flex flex-col gap-0.5">
            <span>{r.project.name}</span>
            <span className="font-mono text-[12px] text-muted">{r.project.number}</span>
          </div>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "scope",
      header: "Umfang",
      numeric: true,
      className: "w-32",
      render: (r) => (
        <span className="font-mono text-[12px] tnum text-muted" title="Pläne / Empfänger">
          {r.counts.items} / {r.counts.recipients}
        </span>
      ),
    },
    {
      key: "sentBy",
      header: "Durch",
      secondary: true,
      render: (r) => r.sentBy?.name ?? <span className="text-muted">—</span>,
    },
    {
      key: "note",
      header: "Bemerkung",
      secondary: true,
      render: (r) =>
        r.note ? (
          <span className="line-clamp-2 text-[13px]">{r.note}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ];

  if (list.error) return <ErrorState message={list.error} onRetry={list.refetch} />;

  return (
    <>
      <PageHeader
        eyebrow="Projekte"
        title="Planversand"
        description="Wer welche Revision wann bekommen hat. Ein Versand wird nicht korrigiert, sondern durch einen neuen ersetzt."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={purpose}
          onChange={(event) => {
            setPurpose(event.target.value);
            setPage(1);
          }}
          aria-label="Zweck"
          className="w-52"
          options={[{ value: "", label: "Alle Zwecke" }, ...TRANSMITTAL_PURPOSE_OPTIONS]}
        />
      </div>

      <Card bodyClassName="p-5">
        <DataView
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/planversand/${r.id}`)}
          loading={list.loading}
          caption="Planversand"
          page={list.data?.page ?? 1}
          pages={list.data?.pages ?? 1}
          total={list.data?.total ?? 0}
          perPage={list.data?.perPage ?? 25}
          onPageChange={setPage}
          sort={listView.view.sort}
          onSortChange={(next) => {
            listView.setSort(next);
            setPage(1);
          }}
          hiddenColumns={listView.hidden}
          toolbar={
            <>
              <SearchInput
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                label="Planversand durchsuchen"
                placeholder="Nummer oder Bemerkung"
                className="w-full sm:w-80"
              />
              <div className="ml-auto flex items-center gap-2">
                {can("transmittal.export") ? (
                  <DownloadButton
                    variant="secondary"
                    label="Als CSV exportieren"
                    onDownload={() => mutations.exportTransmittalsCsv(query)}
                  />
                ) : null}
              </div>
            </>
          }
          empty={
            <EmptyState
              title={debounced || purpose ? "Nichts gefunden" : "Noch kein Planversand"}
              description={
                debounced || purpose
                  ? undefined
                  : "Ein Versand entsteht aus freigegebenen Revisionen — auf dem Projekt, im Register Pläne."
              }
            />
          }
        />
      </Card>
    </>
  );
}
