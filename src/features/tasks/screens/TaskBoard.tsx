import { useState } from "react";
import { toFailure } from "@/core/api";
import { useAuth } from "@/core/auth";
import {
  BOARD_COLUMNS,
  OverdueBadge,
  boardColumnLabel,
  taskStatusLabel,
  type BoardColumn,
  type Task,
} from "@/entities/task";
import { PriorityBadge, DisciplineDot } from "@/entities/project";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { useToast } from "@/shared/ui/feedback";
import { formatDate } from "@/shared/utils/format";
import { cn } from "@/shared/utils/cn";
import { useTaskBoard, useTaskMutations } from "../hooks/useTasks";
import type { TaskQuery } from "../repository";
import { daysOverdue, neighboursAt, toBoard } from "../service";

/**
 * The Kanban board.
 *
 * ---
 *
 * **Every card is draggable *and* movable from the keyboard**, and the second
 * half is not a courtesy. A drag is a pointer gesture with no keyboard
 * equivalent the platform provides — `draggable` elements are not focusable, do
 * not announce themselves, and cannot be dropped without a mouse. A board that
 * only dragged would be a module an engineer using a keyboard, a screen reader
 * or a touch device could look at and not use, and "move this card" is the
 * single thing the screen is for.
 *
 * So each card carries a small move control: the column it should go to, and
 * one step up or down inside it. Both paths end in the *same* call —
 * `neighboursAt` computes the two neighbour ids and the server does the
 * arithmetic — so they cannot drift into behaving differently.
 *
 * **The client never computes a position.** `neighboursAt` answers "between
 * which two cards", and that is all. A client that computed the number itself
 * would hold a second copy of the server's gap arithmetic, including the
 * renumber case it cannot perform, and two people dragging into the same gap
 * would both compute the same value.
 *
 * **A drop that changes column is also a transition**, so the server runs
 * `refuseTransition` on it — dropping a card into `Erledigt` past an open
 * subtask is refused exactly as the status control would refuse it. The board
 * shows the refusal as a toast and the card stays where it was, because the
 * board re-reads from the server rather than moving the card itself.
 */
export function TaskBoard({
  query,
  onOpen,
  onCreate,
}: {
  /** What the board shows. A project's tab passes its own `projectId`. */
  query: Omit<TaskQuery, "page" | "perPage" | "sort">;
  onOpen: (task: Task) => void;
  onCreate?: (column: BoardColumn) => void;
}) {
  const toast = useToast();
  const { can } = useAuth();
  const board = useTaskBoard(query);
  const mutations = useTaskMutations();

  /** The card being dragged, and the column it is hovering over. */
  const [dragging, setDragging] = useState<Task | null>(null);
  const [over, setOver] = useState<BoardColumn | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const mayMove = can("task.update") || can("task.updateOwn");
  const columns = toBoard(board.data?.items ?? []);

  async function move(task: Task, column: BoardColumn, index: number) {
    const target = columns.find((c) => c.column === column)?.tasks ?? [];
    const { afterId, beforeId } = neighboursAt(target, index, task.id);

    setBusyId(task.id);
    try {
      await mutations.move(task.id, {
        // Omitted when the column has not changed, so a reorder is not also a
        // transition — the server would refuse `DONE → DONE` no differently,
        // but the audit log would carry a status change that did not happen.
        status: column === task.status ? undefined : column,
        afterId,
        beforeId,
      });
    } catch (err) {
      /*
        The refusal is shown and the card is not moved.

        There is no optimistic update here on purpose: a card that jumps into
        `Erledigt` and then jumps back is a worse answer than one that does not
        move, because the reader has already started reading the new column.
      */
      const message =
        toFailure(err).message;
      toast.error(message);
    } finally {
      setBusyId(null);
      setDragging(null);
      setOver(null);
    }
  }

  if (board.error) return <ErrorState message={board.error} onRetry={board.refetch} />;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {columns.map(({ column, tasks }) => (
        <section
          key={column}
          aria-label={`${boardColumnLabel(column)} — ${tasks.length} Aufgaben`}
          onDragOver={(event) => {
            // `preventDefault` is what makes an element a drop target at all.
            // Without it the drop never fires and the card silently returns.
            if (!dragging || !mayMove) return;
            event.preventDefault();
            setOver(column);
          }}
          onDragLeave={() => setOver((current) => (current === column ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            if (!dragging || !mayMove) return;
            void move(dragging, column, tasks.length);
          }}
          className={cn(
            "flex flex-col gap-3 rounded-xl p-3 ring-1 transition-colors",
            over === column ? "bg-accent/5 ring-accent" : "bg-surface-sunken ring-line",
          )}
        >
          <header className="flex items-center justify-between gap-2 px-1">
            <h3 className="text-[13px] font-semibold text-ink">{boardColumnLabel(column)}</h3>
            <span className="font-mono text-[11px] tnum text-muted">{tasks.length}</span>
          </header>

          {board.loading && !tasks.length ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : null}

          {tasks.map((task, index) => (
            <BoardCard
              key={task.id}
              task={task}
              column={column}
              index={index}
              count={tasks.length}
              busy={busyId === task.id}
              movable={mayMove}
              onOpen={() => onOpen(task)}
              onDragStart={() => setDragging(task)}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onMove={(nextColumn, nextIndex) => void move(task, nextColumn, nextIndex)}
            />
          ))}

          {!board.loading && !tasks.length ? (
            <p className="px-1 py-6 text-center text-[12px] text-muted">Keine Aufgaben</p>
          ) : null}

          {onCreate && can("task.create") ? (
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => onCreate(column)}
            >
              + Aufgabe
            </Button>
          ) : null}
        </section>
      ))}

      {!board.loading && !board.data?.items.length ? (
        <div className="md:col-span-2 xl:col-span-5">
          <Card bodyClassName="p-5">
            <EmptyState
              title="Noch keine Aufgaben"
              description="Eine Aufgabe braucht nur einen Titel. Projekt, Termin und Zuständigkeit können später dazukommen."
            />
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One card.
 *
 * A `<button>` wrapping the content rather than a `<div>` with an `onClick`:
 * opening a card is an action, so it needs to be reachable by Tab, activated by
 * Enter and announced as a control. The move buttons are separate controls
 * *inside* it, which is why the card's own button is not the outermost element —
 * a button inside a button is invalid and the inner one stops working.
 */
function BoardCard({
  task,
  column,
  index,
  count,
  busy,
  movable,
  onOpen,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  task: Task;
  column: BoardColumn;
  index: number;
  count: number;
  busy: boolean;
  movable: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (column: BoardColumn, index: number) => void;
}) {
  return (
    <article
      draggable={movable && !busy}
      onDragStart={(event) => {
        // Firefox refuses to start a drag without data on the transfer.
        event.dataTransfer.setData("text/plain", task.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group rounded-lg bg-surface p-3 ring-1 ring-line transition-shadow",
        movable && "cursor-grab active:cursor-grabbing",
        busy && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="text-[13px] font-medium leading-snug text-ink">{task.title}</span>

        <span className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={task.priority} />
          {task.discipline ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
              <DisciplineDot colour={task.discipline.colour} />
              {task.discipline.code}
            </span>
          ) : null}
          {/* The project, because a board is often filtered to none. A card with
              no project is the firm-level to-do and says nothing here rather
              than "—", which would read as missing data. */}
          {task.project ? (
            <span className="font-mono text-[11px] text-muted">{task.project.number}</span>
          ) : null}
        </span>

        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          {task.dueDate ? <span>{formatDate(task.dueDate)}</span> : null}
          {/* Counts, not a `3/7` — the board fetched counts and not rows, which
              is what keeps a fifty-card board one query. The drawer has the
              rows and shows the fraction. */}
          {task.counts.checklist ? <span>☑ {task.counts.checklist}</span> : null}
          {task.counts.subtasks ? <span>⊞ {task.counts.subtasks}</span> : null}
          {task.counts.dependsOn ? <span>⇢ {task.counts.dependsOn}</span> : null}
          {task.assignee ? <span className="ml-auto">{task.assignee.name}</span> : null}
        </span>

        <OverdueBadge overdue={task.isOverdue} days={daysOverdue(task)} />

        {task.status === "BLOCKED" && task.blockedReason ? (
          <span className="rounded bg-surface-sunken px-2 py-1 text-[11px] leading-snug text-muted">
            {task.blockedReason}
          </span>
        ) : null}
      </button>

      {movable ? (
        /**
         * The keyboard path.
         *
         * Hidden until the card is hovered or something inside it has focus —
         * `focus-within` is what keeps it reachable by Tab while invisible to a
         * mouse user who is not pointing at this card. `opacity` alone would
         * leave the buttons clickable while invisible, which is worse than
         * showing them.
         */
        <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <label className="sr-only" htmlFor={`${task.id}-column`}>
            Spalte für „{task.title}“
          </label>
          <select
            id={`${task.id}-column`}
            value={column}
            disabled={busy}
            // To the top of the target column: that is where the reader will
            // look for the card they just moved, and appending it to a column
            // of forty means it lands off-screen.
            onChange={(event) => onMove(event.target.value as BoardColumn, 0)}
            className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-muted"
          >
            {BOARD_COLUMNS.map((value) => (
              <option key={value} value={value}>
                {taskStatusLabel(value)}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={busy || index === 0}
            onClick={() => onMove(column, index - 1)}
            aria-label={`„${task.title}“ nach oben`}
            className="rounded px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-line disabled:opacity-40"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={busy || index >= count - 1}
            /*
              `index + 1`, not `index + 2`, and the off-by-one is the whole
              reason `neighboursAt` excludes the moving card before counting:
              in [A, B, C] moving B down means B lands between C and the end,
              which is slot 2 of [A, C] — and slot 2 of the *original* list is
              C's own place, which would be a no-op.
            */
            onClick={() => onMove(column, index + 1)}
            aria-label={`„${task.title}“ nach unten`}
            className="rounded px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-line disabled:opacity-40"
          >
            ↓
          </button>
        </div>
      ) : null}
    </article>
  );
}
