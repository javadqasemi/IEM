import { useState } from "react";
import { toFailure } from "@/core/api";
import { useAuth } from "@/core/auth";
import { formatDate } from "@/shared/utils/format";
import {
  Button,
  Card,
  DownloadButton,
  EmptyState,
  PageHeader,
} from "@/shared/ui/primitives";
import { SearchInput } from "@/shared/ui/forms";
import { BulkBar, ColumnPicker, DataView, KpiCard, type Column } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { PRIORITY_OPTIONS, PriorityBadge, DisciplineDot } from "@/entities/project";
import {
  OverdueBadge,
  TASK_STATUS_OPTIONS,
  TaskStatusBadge,
  type Task,
} from "@/entities/task";
import { useDebounced, useListView } from "@/shared/hooks";
import { useTaskBoard, useTaskList, useTaskMutations, useTaskStats } from "../hooks/useTasks";
import type { TaskQuery } from "../repository";
import { daysOverdue, formatHours } from "../service";
import { TaskBoard } from "./TaskBoard";
import { TaskCreateDialog } from "./TaskCreateDialog";
import { TaskDrawer } from "./TaskDrawer";

/**
 * Every task the reader may see, as a table or as a board.
 *
 * **"May see" is doing real work in that sentence.** `task.read` opens the
 * screen; the *rows* are narrowed by the server to tasks on the reader's
 * projects, assigned to them, or written by them — unless they hold
 * `task.readAll`. Nothing here filters anything, which is the only arrangement
 * where forgetting a clause cannot leak.
 *
 * ---
 *
 * **Two views of one query, and the toggle is not cosmetic.** A board answers
 * "what is the state of the work" and a table answers "find me the one about
 * the Steigzone". They need different sorts — `position` within a column versus
 * `dueDate` across everything — and different densities, and a single view that
 * tried to be both would be a board with a search box that reorders it.
 *
 * The **filters are shared**, which is the half that matters: switching view
 * keeps the project, the Gewerk and the search, so the toggle is a change of
 * presentation rather than a change of subject.
 */
export function TaskList() {
  const toast = useToast();
  const { can } = useAuth();

  const [view, setView] = useState<"board" | "table">("board");
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const debounced = useDebounced(search);

  /**
   * The saved view, and the sort that comes with it (foundation stage F11).
   *
   * Sorting is the **server's**: the list is paginated, so reordering the
   * twenty-five rows on screen would show the wrong twenty-five at the top.
   */
  const listView = useListView("task", { sort: { field: "dueDate", dir: "asc" } });

  const filters = {
    search: debounced || undefined,
    statuses: statuses.length ? statuses : undefined,
  };

  const query: TaskQuery = {
    ...filters,
    sort: listView.view.sort,
    page,
    perPage: 25,
  };

  const list = useTaskList(query);
  const stats = useTaskStats();
  const mutations = useTaskMutations();

  // Mounted in both views so the toggle does not refetch what the cache
  // already holds; the hook is a no-op beyond a cache read when the board is
  // not rendered.
  const board = useTaskBoard(filters);

  /**
   * The chip counts, and **they are not `stats` when the board is showing.**
   *
   * Found by looking at the screen: the chip said "Offen 6" above a column
   * headed "Offen 5". Both numbers were right and they answer different
   * questions — `/tasks/stats` counts every task, while the board shows
   * top-level cards only, because a subtask rendered beside its parent is a
   * board nobody can read. Two figures that disagree by one, side by side,
   * read as a card that failed to load.
   *
   * So the chips count what the view in front of the reader contains. The board
   * already has every one of its cards in one page, so this costs nothing; the
   * list is paginated and cannot count itself, which is exactly what `stats` is
   * for.
   */
  const chipCounts = (value: string): number => {
    if (view === "board") {
      return (board.data?.items ?? []).filter((task) => task.status === value).length;
    }
    return stats.data?.byStatus[value] ?? 0;
  };

  const toggleStatus = (value: string) => {
    setStatuses((current) =>
      current.includes(value) ? current.filter((s) => s !== value) : [...current, value],
    );
    setPage(1);
  };

  const columns: Column<Task>[] = [
    {
      key: "task",
      header: "Aufgabe",
      sortField: "title",
      // The row's identity. The column picker cannot hide it — a table of
      // anonymous cells is one nobody can read.
      required: true,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">{r.title}</span>
          <OverdueBadge overdue={r.isOverdue} days={daysOverdue(r)} />
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
          // Not "—": a task with no project is a deliberate kind of task, and a
          // dash reads as missing data.
          <span className="text-[12px] text-muted">firmenintern</span>
        ),
    },
    {
      key: "assignee",
      header: "Zuständig",
      secondary: true,
      render: (r) => r.assignee?.name ?? <span className="text-muted">nicht zugewiesen</span>,
    },
    {
      key: "status",
      header: "Status",
      className: "w-32",
      sortField: "status",
      render: (r) => <TaskStatusBadge status={r.status} />,
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
      key: "due",
      header: "Fällig",
      className: "w-36",
      sortField: "dueDate",
      render: (r) =>
        r.dueDate ? formatDate(r.dueDate) : <span className="text-muted">—</span>,
    },
    {
      key: "estimate",
      header: "Aufwand",
      numeric: true,
      className: "w-28",
      secondary: true,
      sortField: "estimateHours",
      // `formatHours` takes the string the server sent. It is never parsed into
      // a number anywhere that could add it up — see the mapper.
      render: (r) => formatHours(r.estimateHours),
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

  return (
    <>
      <PageHeader
        eyebrow="Projekte"
        title="Aufgaben"
        description="Was zu tun ist — auf einem Projekt oder firmenintern. Der Status wird verschoben, nicht erfasst."
        actions={
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Ansicht" className="flex rounded-lg bg-surface-sunken p-0.5">
              {(["board", "table"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={view === value}
                  onClick={() => setView(value)}
                  className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    view === value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  {value === "board" ? "Board" : "Liste"}
                </button>
              ))}
            </div>
            {can("task.create") ? (
              <Button onClick={() => setCreating(true)}>Neue Aufgabe</Button>
            ) : null}
          </div>
        }
      />

      {stats.data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiCard label="Offen" value={stats.data.open} />
          <KpiCard
            label="Überfällig"
            value={stats.data.overdue}
            // The one figure on this screen somebody should act on, and the
            // only one toned when it is not zero. A KPI that is always
            // highlighted is one people stop reading — so zero gets the neutral
            // tone rather than a quieter shade of the warning.
            tone={stats.data.overdue > 0 ? "bronze" : "neutral"}
          />
          <KpiCard label="Insgesamt" value={stats.data.total} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {TASK_STATUS_OPTIONS.map((option) => {
          // Never `undefined`: `chipCounts` returns a number for a status with
          // no rows, because the mapper fills every key — the endpoint returns
          // only the ones that have rows, and a missing key would render as
          // nothing where 0 is the answer.
          const count = chipCounts(option.value);
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
              {/* No `opacity-*` on the count — opacity is the one property that
                  carries information and takes contrast away. Mono and smaller
                  distinguishes it without dimming it. */}
              <span className="font-mono text-[11px] tnum">{count}</span>
            </button>
          );
        })}
      </div>

      {view === "board" ? (
        <TaskBoard
          query={filters}
          onOpen={(task) => setOpen(task.id)}
          onCreate={() => setCreating(true)}
        />
      ) : (
        <>
          <BulkBar count={selection.size} onClear={() => setSelection(new Set())} noun="Aufgaben">
            {/*
              Priority, and deliberately not status.

              A bulk status change would run the transition rules on every row
              and either fail the whole request on one bad task or half-apply
              it, and "half of what you selected changed" is the worst possible
              answer. The server's `bulk` accepts priority and assignee for the
              same reason: neither has preconditions.
            */}
            {can("task.update")
              ? PRIORITY_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    size="sm"
                    variant="secondary"
                    busy={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const changed = await mutations.bulk([...selection], {
                          priority: option.value,
                        });
                        setSelection(new Set());
                        toast.success(`${changed} geändert`);
                      } catch (err) {
                        toast.error(toFailure(err).message);
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
              // A drawer, not a route — see the note on `TaskDrawer`.
              open={{ onOpen: (r) => setOpen(r.id) }}
              loading={list.loading}
              error={list.error}
              onRetry={list.refetch}
              caption="Aufgaben"
              page={list.data?.page ?? 1}
              pages={list.data?.pages ?? 1}
              total={list.data?.total ?? 0}
              perPage={list.data?.perPage ?? 25}
              onPageChange={setPage}
              selection={selection}
              onSelectionChange={setSelection}
              sort={listView.view.sort}
              onSortChange={(next) => {
                listView.setSort(next);
                // Back to page one: the row at the top of page three is
                // somewhere else entirely under a different order.
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
                    label="Aufgaben durchsuchen"
                    placeholder="Titel oder Beschreibung"
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
                    {can("task.export") ? (
                      <DownloadButton
                        variant="secondary"
                        label="Als CSV exportieren"
                        // The query, not nothing: an export that quietly
                        // contains more than the filtered view is a document
                        // somebody will act on (architecture §7.2).
                        onDownload={() => mutations.exportCsv(query)}
                      />
                    ) : null}
                  </div>
                </>
              }
              empty={
                <EmptyState
                  title={debounced || statuses.length ? "Nichts gefunden" : "Noch keine Aufgaben"}
                  description={
                    debounced || statuses.length
                      ? undefined
                      : "Eine Aufgabe braucht nur einen Titel. Projekt, Termin und Zuständigkeit können später dazukommen."
                  }
                />
              }
            />
          </Card>
        </>
      )}

      <TaskDrawer id={open} onClose={() => setOpen(null)} />

      {creating ? (
        <TaskCreateDialog
          onClose={() => setCreating(false)}
          onCreated={(task) => {
            setCreating(false);
            toast.success("Aufgabe angelegt");
            setOpen(task.id);
          }}
        />
      ) : null}
    </>
  );
}
