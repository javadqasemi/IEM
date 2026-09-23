import { useState } from "react";
import { navigate } from "@/core/router";
import { useAuth } from "@/core/auth";
import {
  DRAWING_STATUS_OPTIONS,
  DRAWING_TYPE_OPTIONS,
  DrawingStatusBadge,
  RevisionBadge,
  IssuedRevisionBadge,
  drawingTypeLabel,
  formatLabel,
  type Drawing,
} from "@/entities/drawing";
import { DisciplineDot } from "@/entities/project";
import {
  Button,
  Card,
  DownloadButton,
  EmptyState,
  PageHeader,
} from "@/shared/ui/primitives";
import { SearchInput, Select } from "@/shared/ui/forms";
import { ColumnPicker, DataView, KpiCard, type Column } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { useDebounced, useListView } from "@/shared/hooks";
import { formatDate } from "@/shared/utils/format";
import { useDrawingList, useDrawingMutations, useDrawingStats } from "../hooks/useDrawings";
import type { DrawingQuery } from "../repository";
import { DrawingCreateDialog } from "./DrawingCreateDialog";

/**
 * The plan register.
 *
 * **It opens as a plan set, not as a feed** — `number` ascending, the way the
 * sheets hang on the wall, which disagrees with all three modules before it.
 * A project list opens on what you were last working on and a task list on what
 * is due; sorting a drawing register by `updatedAt` would reshuffle it every
 * time somebody fixed a title.
 *
 * **"May see" is doing real work.** `drawing.read` opens the screen; the rows
 * are narrowed by the server to the reader's projects unless they hold
 * `drawing.readAll`. Nothing here filters anything, which is the only
 * arrangement where forgetting a clause cannot leak.
 */
export function DrawingList() {
  const toast = useToast();
  const { can } = useAuth();

  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);

  const listView = useListView("drawing", { sort: { field: "number", dir: "asc" } });

  const query: DrawingQuery = {
    search: debounced || undefined,
    statuses: statuses.length ? statuses : undefined,
    type: type || undefined,
    sort: listView.view.sort,
    page,
    perPage: 25,
  };

  const list = useDrawingList(query);
  const stats = useDrawingStats();
  const mutations = useDrawingMutations();

  const columns: Column<Drawing>[] = [
    {
      key: "number",
      header: "Plannummer",
      className: "w-48",
      sortField: "number",
      // The row's identity, and how a plan is looked up — somebody has it
      // written on a printout. The column picker cannot hide it.
      required: true,
      render: (r) => <span className="font-mono text-[13px] text-ink">{r.number}</span>,
    },
    {
      key: "title",
      header: "Titel",
      sortField: "title",
      required: true,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">{r.title}</span>
          <span className="text-[12px] text-muted">
            {drawingTypeLabel(r.type)}
            {r.scale ? ` · ${r.scale}` : ""}
          </span>
        </div>
      ),
    },
    {
      key: "discipline",
      header: "Gewerk",
      className: "w-28",
      render: (r) =>
        r.discipline ? (
          <span className="inline-flex items-center gap-1.5 text-[13px]">
            <DisciplineDot colour={r.discipline.colour} />
            {r.discipline.code}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "revision",
      header: "Revision",
      className: "w-32",
      sortField: "currentRevision",
      render: (r) => <RevisionBadge revision={r.currentRevision} />,
    },
    {
      // Beside the internal revision rather than instead of it: the pair is the
      // information. Two columns showing the same letter means the plan set on
      // site matches the office; two showing different letters is the list of
      // plans somebody has to reissue, and that list has no other home.
      key: "issued",
      header: "Ausgegeben",
      className: "w-40",
      sortField: "issuedRevision",
      render: (r) => <IssuedRevisionBadge issued={r.issuedRevision} current={r.currentRevision} />,
    },
    {
      key: "status",
      header: "Status",
      className: "w-36",
      sortField: "status",
      render: (r) => <DrawingStatusBadge status={r.status} />,
    },
    {
      key: "project",
      header: "Projekt",
      secondary: true,
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
      key: "format",
      header: "Format",
      className: "w-24",
      secondary: true,
      render: (r) => <span className="text-[13px]">{formatLabel(r.format)}</span>,
    },
    {
      key: "drawnBy",
      header: "Gezeichnet",
      secondary: true,
      render: (r) => r.drawnBy?.name ?? <span className="text-muted">—</span>,
    },
    {
      key: "updatedAt",
      header: "Geändert",
      className: "w-32",
      secondary: true,
      sortField: "updatedAt",
      render: (r) => (r.updatedAt ? formatDate(r.updatedAt) : <span className="text-muted">—</span>),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Projekte"
        title="Pläne"
        description="Der Planbestand mit Revisionen. Freigegeben ist intern, ausgegeben heisst, jemand baut danach."
        actions={
          can("drawing.create") ? (
            <Button onClick={() => setCreating(true)}>Neuer Plan</Button>
          ) : null
        }
      />

      {stats.data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiCard label="Pläne" value={stats.data.total} />
          <KpiCard
            label="In Prüfung"
            value={stats.data.awaitingCheck}
            // The one figure here somebody should act on, and the only one
            // toned when it is not zero. A KPI that is always highlighted is
            // one people stop reading.
            tone={stats.data.awaitingCheck > 0 ? "gold" : "neutral"}
          />
          <KpiCard label="Freigegeben" value={stats.data.released} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {DRAWING_STATUS_OPTIONS.map((option) => {
          const on = statuses.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setStatuses((current) =>
                  current.includes(option.value)
                    ? current.filter((s) => s !== option.value)
                    : [...current, option.value],
                );
                setPage(1);
              }}
              className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                on
                  ? "bg-ink text-inverse"
                  : "bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-line-strong"
              }`}
            >
              {option.label}
              <span className="font-mono text-[11px] tnum">
                {stats.data?.byStatus[option.value] ?? 0}
              </span>
            </button>
          );
        })}

        {/*
          The plan type as a select rather than eight more chips.

          Eight statuses and eight types is sixteen chips, which is a filter bar
          nobody reads. The status is what a reader scans by; the type is what
          they occasionally narrow to.
        */}
        <Select
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
          aria-label="Plantyp"
          className="ml-auto w-44"
          options={[{ value: "", label: "Alle Typen" }, ...DRAWING_TYPE_OPTIONS]}
        />
      </div>

      <Card bodyClassName="p-5">
        <DataView
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          // A route, not a drawer: a plan is cited by number and its URL gets
          // pasted into an e-mail, the same argument Sitzungen made.
          open={{ href: (r) => `#/plaene/${r.id}` }}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          caption="Pläne"
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
                label="Pläne durchsuchen"
                placeholder="Plannummer oder Titel"
                className="w-full sm:w-80"
              />
              <div className="ml-auto flex items-center gap-2">
                <ColumnPicker
                  columns={columns.map((c) => ({
                    key: c.key,
                    header: c.header,
                    required: c.required,
                  }))}
                  hidden={listView.hidden}
                  onChange={listView.setHidden}
                  onReset={listView.reset}
                />
                {can("drawing.export") ? (
                  <DownloadButton
                    variant="secondary"
                    label="Als CSV exportieren"
                    // The query, not nothing: an export that quietly contains
                    // more than the filtered view is a document somebody will
                    // act on.
                    onDownload={() => mutations.exportCsv(query)}
                  />
                ) : null}
              </div>
            </>
          }
          empty={
            <EmptyState
              title={debounced || statuses.length || type ? "Nichts gefunden" : "Noch keine Pläne"}
              description={
                debounced || statuses.length || type
                  ? undefined
                  : "Ein Plan braucht eine Nummer, einen Titel, ein Projekt und ein Gewerk. Die Revision kommt mit der ersten Datei."
              }
            />
          }
        />
      </Card>

      {creating ? (
        <DrawingCreateDialog
          onClose={() => setCreating(false)}
          onCreated={(drawing) => {
            setCreating(false);
            toast.success(`${drawing.number} angelegt`);
            navigate(`/plaene/${drawing.id}`);
          }}
        />
      ) : null}
    </>
  );
}
