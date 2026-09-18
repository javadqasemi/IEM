import { useState } from "react";
import { navigate } from "@/core/router";
import { useAuth } from "@/core/auth";
import { formatDate, formatMoneyShort } from "@/shared/utils/format";
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
  PRIORITY_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  PriorityBadge,
  ProjectHealthDot,
  ProjectStatusBadge,
  phaseLabel,
  type Project,
} from "@/entities/project";
import { useDebounced, useListView } from "@/shared/hooks";
import { useProjectList, useProjectMutations, useProjectStats } from "../hooks/useProjects";
import type { ProjectQuery } from "../repository";
import { daysUntil, isOverdue } from "../service";
import { ProjectCreateDialog } from "./ProjectCreateDialog";

/**
 * Every project the reader may see.
 *
 * **"May see" is doing real work in that sentence.** `project.read` opens the
 * screen; the *rows* are narrowed by the server to the projects the caller
 * manages or sits on, unless they hold `project.readAll`. Nothing here filters
 * anything — the list simply shows what came back, which is the only
 * arrangement where forgetting a clause cannot leak.
 *
 * Rendering only: no fetch call and no rule. Both come in through the hooks and
 * the service, which is the contract the five layers exist for.
 */
export function ProjectList() {
  const toast = useToast();
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const debounced = useDebounced(search);

  /**
   * The saved view, and the sort that comes with it (foundation stage F11).
   *
   * Sorting is the **server's**: the list is paginated, so reordering the
   * twenty-five rows on screen would show the wrong twenty-five at the top. The
   * default is the one the server would have used anyway, stated here so the
   * header arrow is right before the first response arrives.
   */
  const view = useListView("project", {
    sort: { field: "updatedAt", dir: "desc" },
  });

  const query: ProjectQuery = {
    search: debounced || undefined,
    statuses: statuses.length ? statuses : undefined,
    sort: view.view.sort,
    page,
    perPage: 25,
  };

  const list = useProjectList(query);
  const stats = useProjectStats();
  const mutations = useProjectMutations();

  const toggleStatus = (value: string) => {
    setStatuses((current) =>
      current.includes(value) ? current.filter((s) => s !== value) : [...current, value],
    );
    setPage(1);
  };

  const columns: Column<Project>[] = [
    {
      key: "project",
      header: "Projekt",
      sortField: "number",
      // The row's identity. The column picker cannot hide it — a table of
      // anonymous cells is one nobody can read.
      required: true,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">{r.name}</span>
          <span className="font-mono text-[12px] text-muted">{r.number}</span>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Bauherrschaft",
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span>{r.customer?.name ?? "—"}</span>
          {r.building ? (
            <span className="text-[12px] text-muted">
              {r.building.name}
              {r.building.city ? ` · ${r.building.city}` : ""}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "manager",
      header: "Projektleitung",
      sortField: "name",
      secondary: true,
      render: (r) => r.manager?.name ?? <span className="text-muted">nicht zugewiesen</span>,
    },
    {
      key: "status",
      header: "Status",
      className: "w-32",
      sortField: "status",
      render: (r) => <ProjectStatusBadge status={r.status} />,
    },
    {
      /**
       * Health as a dot **with its label**, never colour alone.
       *
       * Red/amber/green is the one encoding that fails for roughly one man in
       * twelve, and "which projects are in trouble" is exactly the question
       * this column answers.
       */
      key: "health",
      header: "Zustand",
      className: "w-36",
      sortField: "health",
      render: (r) => <ProjectHealthDot health={r.health} />,
    },
    {
      key: "progress",
      header: "Fortschritt",
      className: "w-36",
      sortField: "progressPercent",
      render: (r) => (
        <div className="flex items-center gap-2">
          {/*
            A bar and the number. The bar is `aria-hidden` and the number is the
            accessible content: a progressbar role here would announce "40
            percent" twice, and the figure is what a reader actually compares.
          */}
          <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${r.progressPercent}%` }}
            />
          </span>
          <span className="font-mono text-[12px] tnum text-muted">{r.progressPercent}%</span>
        </div>
      ),
    },
    {
      key: "phase",
      header: "Phase",
      className: "w-40",
      secondary: true,
      render: (r) => <span className="text-[13px]">{phaseLabel(r.currentPhase)}</span>,
    },
    {
      key: "due",
      header: "Geplantes Ende",
      className: "w-40",
      sortField: "plannedEndDate",
      render: (r) => {
        if (!r.plannedEndDate) return <span className="text-muted">—</span>;
        const days = daysUntil(r.plannedEndDate);
        return (
          <span title={formatDate(r.plannedEndDate)} className="flex items-center gap-2">
            {formatDate(r.plannedEndDate)}
            {isOverdue(r) ? (
              <Badge tone="bronze">{Math.abs(days ?? 0)} T. überfällig</Badge>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "value",
      header: "Auftragswert",
      numeric: true,
      className: "w-40",
      secondary: true,
      sortField: "contractValue",
      // `formatMoneyShort` takes the string the server sent. It is never parsed
      // into a number anywhere that could add it up — see the mapper.
      render: (r) => formatMoneyShort(r.contractValue, r.currency),
    },
    {
      key: "priority",
      header: "Priorität",
      className: "w-32",
      secondary: true,
      sortField: "priority",
      render: (r) => <PriorityBadge priority={r.priority} />,
    },
  ];

  if (list.error) return <ErrorState message={list.error} onRetry={list.refetch} />;

  return (
    <>
      <PageHeader
        eyebrow="Projekte"
        title="Projekte"
        description="Jedes Projekt hat eine Bauherrschaft, ein Objekt und eine verantwortliche Person. Zustand und Fortschritt werden berechnet, nicht erfasst."
        actions={
          can("project.create") ? (
            <Button onClick={() => setCreating(true)}>Neues Projekt</Button>
          ) : null
        }
      />

      {stats.data ? (
        <div className="flex flex-wrap gap-2">
          {PROJECT_STATUS_OPTIONS.map((option) => {
            // Never `undefined`: the mapper fills every status, because the
            // endpoint only returns the ones with rows and a missing key would
            // render as nothing where 0 is the answer.
            const count = stats.data!.byStatus[option.value];
            const on = statuses.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleStatus(option.value)}
                aria-pressed={on}
                className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  on
                    ? "bg-ink text-inverse"
                    : "bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-line-strong"
                }`}
              >
                {option.label}
                {/* No `opacity-*` on the count — see the note on the same chip
                    in `ApplicationList`: opacity is the one property that
                    carries information and takes contrast away. Mono and
                    smaller distinguishes it without dimming it. */}
                <span className="font-mono text-[11px] tnum">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <BulkBar count={selection.size} onClear={() => setSelection(new Set())} noun="Projekte">
        {/*
          Priority and nothing else, deliberately.

          A bulk *status* change would run the transition rules on every row and
          either fail the whole request on one bad project or half-apply it, and
          "half of what you selected changed" is the worst possible answer. The
          server's `bulkPriority` is the only bulk write for the same reason.
        */}
        {can("project.update")
          ? PRIORITY_OPTIONS.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant="secondary"
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const changed = await mutations.bulkPriority([...selection], option.value);
                    setSelection(new Set());
                    toast.success(`${changed} geändert`);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Nicht möglich.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Priorität „{option.label}“
              </Button>
            ))
          : null}
      </BulkBar>

      <Card bodyClassName="p-5">
        <DataView
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          // A route, not a drawer. A project has fourteen tabs and a URL people
          // paste into e-mails; a panel over the list could carry neither.
          onRowClick={(r) => navigate(`/projekte/${r.id}`)}
          loading={list.loading}
          caption="Projekte"
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
            // Back to page one: the row at the top of page three is somewhere
            // else entirely under a different order, and staying put shows the
            // reader an arbitrary slice.
            setPage(1);
          }}
          hiddenColumns={view.hidden}
          toolbar={
            <>
              <SearchInput
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                label="Projekte durchsuchen"
                placeholder="Nummer, Name oder Beschreibung"
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
                {can("project.export") ? (
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
              title={debounced || statuses.length ? "Nichts gefunden" : "Noch keine Projekte"}
              description={
                debounced || statuses.length
                  ? undefined
                  : "Ein Projekt braucht eine Bauherrschaft und ein Objekt. Beide werden beim Anlegen ausgewählt."
              }
            />
          }
        />
      </Card>

      {creating ? (
        <ProjectCreateDialog
          onClose={() => setCreating(false)}
          onCreated={(project) => {
            setCreating(false);
            toast.success(`${project.number} angelegt`);
            navigate(`/projekte/${project.id}`);
          }}
        />
      ) : null}
    </>
  );
}
