import { useState } from "react";
import { navigate } from "@/core/router";
import { useAuth } from "@/core/auth";
import {
  DECISION_STATUS_OPTIONS,
  DecisionStatusBadge,
  decisionTypeLabel,
  formatDecimalString,
  impactSummary,
  type Decision,
} from "@/entities/meeting";
import { DisciplineDot } from "@/entities/project";
import {
  Button,
  Card,
  DownloadButton,
  EmptyState,
  PageHeader,
} from "@/shared/ui/primitives";
import { SearchInput } from "@/shared/ui/forms";
import { ColumnPicker, DataView, KpiCard, KpiUnavailable, type Column } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { useDebounced, useListView } from "@/shared/hooks";
import { formatDate } from "@/shared/utils/format";
import { useDecisionList, useDecisionStats, useMeetingMutations } from "../hooks/useMeetings";
import type { DecisionQuery } from "../repository";
import { totalCost } from "../service";
import { DecisionCreateDialog } from "./DecisionDialogs";

/**
 * Every decision this firm has taken, as a register.
 *
 * **This is the screen the module was built for.** A protocol is read once; a
 * decision register is read two years later, by somebody who needs to know what
 * was agreed about the Steigzone and who agreed it. So the list is a register
 * rather than a feed: it is searchable, it is exportable, every row has a
 * citable number, and nothing ever leaves it — a decision that no longer applies
 * is `AUFGEHOBEN` and still here.
 *
 * ---
 *
 * **There is no `decision.readAll`.** A decision is always about a project, so
 * "which decisions may I see" is already answered by `project.readAll`; a second
 * widening key would be one more row in the role editor meaning the same thing.
 * The server's `seesAllDecisions` reads the project key, and this screen filters
 * nothing.
 */
export function DecisionList() {
  const toast = useToast();
  const { can } = useAuth();

  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);

  const listView = useListView("decision", { sort: { field: "decidedAt", dir: "desc" } });

  const query: DecisionQuery = {
    search: debounced || undefined,
    statuses: statuses.length ? statuses : undefined,
    sort: listView.view.sort,
    page,
    perPage: 25,
  };

  const list = useDecisionList(query);
  const stats = useDecisionStats();
  const mutations = useMeetingMutations();

  /*
    The cost of what is on screen, summed in integer Rappen.

    Deliberately *of the page*, and the label says so — a total that silently
    covered only twenty-five of two hundred rows would be a figure somebody
    quotes. The alternative, a server-side sum over the whole filter, is a real
    feature and belongs in the reporting module rather than in a table footer.
  */
  const pageCost = totalCost(list.data?.items ?? []);

  const columns: Column<Decision>[] = [
    {
      key: "number",
      header: "Nummer",
      className: "w-32",
      sortField: "number",
      required: true,
      render: (r) => <span className="font-mono text-[13px] tnum text-ink">{r.number}</span>,
    },
    {
      key: "decision",
      header: "Entscheid",
      sortField: "title",
      required: true,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">{r.title}</span>
          <span className="text-[12px] text-muted">{decisionTypeLabel(r.type)}</span>
        </div>
      ),
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
      key: "status",
      header: "Status",
      className: "w-32",
      sortField: "status",
      render: (r) => <DecisionStatusBadge status={r.status} />,
    },
    {
      key: "impact",
      header: "Auswirkung",
      render: (r) => <span className="text-[13px]">{impactSummary(r)}</span>,
    },
    {
      key: "decidedAt",
      header: "Entschieden",
      className: "w-32",
      sortField: "decidedAt",
      render: (r) => formatDate(r.decidedAt),
    },
    {
      key: "discipline",
      header: "Gewerk",
      className: "w-28",
      secondary: true,
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
      key: "meeting",
      header: "Sitzung",
      secondary: true,
      render: (r) =>
        r.meeting ? (
          <span className="text-[13px]">
            {r.meeting.seriesNumber === null
              ? r.meeting.title
              : `${r.meeting.title} ${r.meeting.seriesNumber}`}
          </span>
        ) : (
          <span className="text-[12px] text-muted">ausserhalb</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Projekte"
        title="Entscheide"
        description="Was entschieden wurde, von wem und warum. Ein aufgehobener Entscheid bleibt lesbar — er gilt nur nicht mehr."
        actions={
          can("decision.create") ? (
            <Button variant="primary" onClick={() => setCreating(true)}>Entscheid festhalten</Button>
          ) : null
        }
      />

      {stats.data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiCard label="Entscheide" value={stats.data.total} />
          <KpiCard label="Offen" value={stats.data.byStatus.OFFEN ?? 0} />
          {/*
            The cost of the page, not of the register — and it says so, because
            a total whose scope is unstated is a total somebody quotes wrongly.
            `KpiUnavailable` for a page where nothing carries a figure: zero
            francs and "nobody priced any of these" are different answers.
          */}
          {pageCost ? (
            <KpiCard label="Kostenfolge dieser Seite" value={`CHF ${formatDecimalString(pageCost)}`} />
          ) : (
            <KpiUnavailable label="Kostenfolge dieser Seite" reason="Keine Beträge erfasst" />
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {DECISION_STATUS_OPTIONS.map((option) => {
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
      </div>

      <Card bodyClassName="p-5">
        <DataView
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          open={{ href: (r) => `#/entscheide/${r.id}` }}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          caption="Entscheide"
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
                label="Entscheide durchsuchen"
                placeholder="Nummer, Titel oder Begründung"
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
                {can("decision.export") ? (
                  <DownloadButton
                    variant="secondary"
                    label="Als CSV exportieren"
                    onDownload={() => mutations.exportDecisionsCsv(query)}
                  />
                ) : null}
              </div>
            </>
          }
          empty={
            <EmptyState
              title={debounced || statuses.length ? "Nichts gefunden" : "Noch keine Entscheide"}
              description={
                debounced || statuses.length
                  ? undefined
                  : "Ein Entscheid braucht einen Titel, ein Projekt und eine Begründung. Die Nummer wird vergeben."
              }
            />
          }
        />
      </Card>

      {creating ? (
        <DecisionCreateDialog
          onClose={() => setCreating(false)}
          onCreated={(decision) => {
            setCreating(false);
            toast.success(`${decision.number} festgehalten`);
            navigate(`/entscheide/${decision.id}`);
          }}
        />
      ) : null}
    </>
  );
}
