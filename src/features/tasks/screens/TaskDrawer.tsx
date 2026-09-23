import { useState } from "react";
import { toFailure } from "@/core/api";
import { useAuth } from "@/core/auth";
import {
  OverdueBadge,
  TaskStatusBadge,
  dependencyHint,
  dependencyLabel,
  gatesCompletion,
  lagLabel,
  taskStatusLabel,
  type TaskDetail,
  type TaskStatus,
} from "@/entities/task";
import { DisciplineDot, PriorityBadge } from "@/entities/project";
import { Badge, Button, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { Drawer } from "@/shared/ui/overlays";
import { Checkbox, Input, Textarea } from "@/shared/ui/forms";
import { Pair } from "@/shared/ui/data";
import { Tabs } from "@/shared/ui/navigation";
import { useToast } from "@/shared/ui/feedback";
import { formatDate, formatDateTime } from "@/shared/utils/format";
import { cn } from "@/shared/utils/cn";
import { useTask, useTaskComments, useTaskHistory, useTaskMutations } from "../hooks/useTasks";
import { blockingLinks, checklistProgress, daysOverdue, formatHours, whyNotDone } from "../service";
import { TaskEditDialog } from "./TaskEditDialog";

/**
 * One task, beside the board rather than over it.
 *
 * A **drawer and not a route**, which is the opposite of the choice
 * `ProjectDetail` makes, and the difference is what each is for: a project has
 * fourteen tabs and a URL people paste into e-mails, while a task is a card
 * somebody opens, ticks something on, and closes — often four in a row. Twelve
 * full-screen interruptions to tick twelve boxes is the interaction a drawer
 * exists to avoid, and losing your place on the board each time is the cost.
 *
 * The consequence is stated rather than discovered: **a task has no shareable
 * URL**. That is a real loss and it is the right trade for now — a task is
 * referred to by its title in a meeting, not by a link — and the day it is
 * wrong, the drawer becomes a route without anything else moving.
 */
export function TaskDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const task = useTask(id);
  const mutations = useTaskMutations();

  const [tab, setTab] = useState("uebersicht");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Non-null while the reason for blocking is being asked for. */
  const [blocking, setBlocking] = useState<string | null>(null);

  const mayWrite = can("task.update") || can("task.updateOwn");

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
    } catch (err) {
      toast.error(toFailure(err).message);
    } finally {
      setBusy(false);
    }
  }

  const detail = task.data;

  return (
    <>
      <Drawer
        open={id !== null}
        onClose={onClose}
        busy={busy}
        width="lg"
        title={detail?.title ?? "Aufgabe"}
        description={detail?.project ? `${detail.project.number} · ${detail.project.name}` : undefined}
        footer={
          detail ? (
            <>
              <Badge tone="neutral">v{detail.version}</Badge>
              <div className="flex-1" />
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Schliessen
              </Button>
              {mayWrite ? (
                <Button onClick={() => setEditing(true)} disabled={busy}>
                  Bearbeiten
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {task.error ? <ErrorState message={task.error} onRetry={task.refetch} /> : null}
        {task.loading && !detail ? <Skeleton className="h-64 w-full rounded-lg" /> : null}

        {detail ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <TaskStatusBadge status={detail.status} />
              <PriorityBadge priority={detail.priority} />
              {detail.discipline ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                  <DisciplineDot colour={detail.discipline.colour} />
                  {detail.discipline.code} · {detail.discipline.name}
                </span>
              ) : null}
              <OverdueBadge overdue={detail.isOverdue} days={daysOverdue(detail)} />
            </div>

            {detail.status === "BLOCKED" ? (
              <BlockedPanel
                detail={detail}
                busy={busy}
                mayWrite={mayWrite}
                onUnblock={() =>
                  void run(
                    () => mutations.unblock(detail.id),
                    `Entsperrt — zurück auf „${taskStatusLabel(detail.blockedFrom ?? "TODO")}“`,
                  )
                }
              />
            ) : null}

            {mayWrite ? (
              <StatusControl
                detail={detail}
                busy={busy}
                onChange={(next) => {
                  if (next === "BLOCKED") {
                    setBlocking("");
                    return;
                  }
                  void run(
                    () => mutations.changeStatus(detail.id, { status: next }),
                    `Status: ${taskStatusLabel(next)}`,
                  );
                }}
              />
            ) : null}

            <Tabs
              label="Aufgabe"
              tabs={[
                { value: "uebersicht", label: "Übersicht" },
                {
                  value: "checkliste",
                  label: "Checkliste",
                  // The count in the tab, so somebody can see there is
                  // something there without opening it.
                  count: detail.checklist.length || undefined,
                },
                {
                  value: "abhaengig",
                  label: "Abhängigkeiten",
                  count: detail.dependsOn.length || undefined,
                },
                { value: "diskussion", label: "Diskussion" },
                { value: "verlauf", label: "Verlauf" },
              ]}
              active={tab}
              onChange={setTab}
            />

            {tab === "uebersicht" ? <OverviewPanel detail={detail} /> : null}
            {tab === "checkliste" ? (
              <ChecklistPanel detail={detail} busy={busy} mayWrite={mayWrite} run={run} />
            ) : null}
            {tab === "abhaengig" ? <DependencyPanel detail={detail} /> : null}
            {tab === "diskussion" ? <CommentPanel taskId={detail.id} run={run} busy={busy} /> : null}
            {tab === "verlauf" ? <HistoryPanel taskId={detail.id} /> : null}
          </div>
        ) : null}
      </Drawer>

      {blocking !== null && detail ? (
        <BlockDialog
          value={blocking}
          onChange={setBlocking}
          busy={busy}
          onCancel={() => setBlocking(null)}
          onConfirm={() => {
            const reason = blocking.trim();
            setBlocking(null);
            void run(
              () => mutations.changeStatus(detail.id, { status: "BLOCKED", reason }),
              "Blockiert",
            );
          }}
        />
      ) : null}

      {editing && detail ? (
        <TaskEditDialog
          task={detail}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast.success("Gespeichert");
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The status control, offering exactly what the server would accept.
 *
 * `allowedTransitions` arrives **with the record**, so the buttons are the
 * server's answer rather than a second copy of the transition table — and
 * `DONE` is additionally disabled with a *reason* when a subtask or a
 * dependency is holding it up. A greyed button with no explanation is the
 * commonest way a rule becomes invisible; the server's refusal only arrives
 * after the click.
 */
function StatusControl({
  detail,
  busy,
  onChange,
}: {
  detail: TaskDetail;
  busy: boolean;
  onChange: (next: TaskStatus) => void;
}) {
  const refusal = whyNotDone(detail);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {detail.allowedTransitions.map((next) => {
        const blocked = next === "DONE" && refusal !== null;
        return (
          <Button
            key={next}
            size="sm"
            variant={next === "DONE" ? "primary" : "secondary"}
            disabled={busy || blocked}
            title={blocked ? refusal! : undefined}
            onClick={() => onChange(next)}
          >
            {taskStatusLabel(next)}
          </Button>
        );
      })}
      {refusal ? (
        // Beside the buttons as well as in the tooltip: a `title` is invisible
        // on a touch device and to a screen reader that does not announce it.
        <p className="w-full text-[12px] text-muted">{refusal}</p>
      ) : null}
    </div>
  );
}

function BlockedPanel({
  detail,
  busy,
  mayWrite,
  onUnblock,
}: {
  detail: TaskDetail;
  busy: boolean;
  mayWrite: boolean;
  onUnblock: () => void;
}) {
  return (
    <div className="rounded-lg bg-surface-sunken p-3 ring-1 ring-line">
      <p className="text-[13px] leading-relaxed text-ink">{detail.blockedReason}</p>
      {mayWrite ? (
        <Button size="sm" variant="secondary" className="mt-3" disabled={busy} onClick={onUnblock}>
          {/* Names where it goes back to, because `blockedFrom` is the whole
              reason unblocking is a *return* rather than a reset. */}
          Entsperren → {taskStatusLabel(detail.blockedFrom ?? "TODO")}
        </Button>
      ) : null}
    </div>
  );
}

function OverviewPanel({ detail }: { detail: TaskDetail }) {
  const progress = checklistProgress(detail.checklist);
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      <Pair label="Zuständig">{detail.assignee?.name ?? "nicht zugewiesen"}</Pair>
      <Pair label="Fällig">{detail.dueDate ? formatDate(detail.dueDate) : "—"}</Pair>
      <Pair label="Start">{detail.startDate ? formatDate(detail.startDate) : "—"}</Pair>
      <Pair label="Aufwand">{formatHours(detail.estimateHours)}</Pair>
      <Pair label="Meilenstein">{detail.milestone?.name ?? "—"}</Pair>
      <Pair label="Fortschritt">
        {detail.progressPercent}%{progress ? ` · Checkliste ${progress.label}` : ""}
      </Pair>
      {detail.parentTask ? (
        <Pair label="Übergeordnet">{detail.parentTask.title}</Pair>
      ) : null}
      {detail.description ? (
        <div className="sm:col-span-2">
          <dt className="text-[12px] font-medium text-muted">Beschreibung</dt>
          <dd className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink">
            {detail.description}
          </dd>
        </div>
      ) : null}
      {detail.subtasks.length ? (
        <div className="sm:col-span-2">
          <dt className="text-[12px] font-medium text-muted">Teilaufgaben</dt>
          <dd className="mt-1 flex flex-col gap-1">
            {detail.subtasks.map((sub) => (
              <span key={sub.id} className="flex items-center gap-2 text-[13px]">
                <TaskStatusBadge status={sub.status} />
                <span className="text-ink">{sub.title}</span>
                {sub.assignee ? (
                  <span className="text-[12px] text-muted">{sub.assignee.name}</span>
                ) : null}
              </span>
            ))}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function ChecklistPanel({
  detail,
  busy,
  mayWrite,
  run,
}: {
  detail: TaskDetail;
  busy: boolean;
  mayWrite: boolean;
  run: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const mutations = useTaskMutations();
  const [text, setText] = useState("");
  const progress = checklistProgress(detail.checklist);

  return (
    <div className="flex flex-col gap-3">
      {progress ? (
        <p className="text-[12px] text-muted">
          {progress.done} von {progress.total} erledigt
        </p>
      ) : null}

      {detail.checklist.map((item) => (
        <div
          key={item.id}
          className={cn("text-[13px]", item.done && "text-muted [&_span]:line-through")}
        >
          {/*
            `Checkbox` owns its own label and its own id — a second `<label>`
            wrapped around it would give the control two labels, and a screen
            reader announces whichever it finds first. The strike-through is
            applied from here because only this screen knows a ticked point
            should read as done.
          */}
          <Checkbox
            label={item.text}
            checked={item.done}
            disabled={busy || !mayWrite}
            onChange={(next) =>
              void run(
                () => mutations.setChecklistItem(detail.id, item.id, next),
                next ? "Abgehakt" : "Wieder offen",
              )
            }
          />
        </div>
      ))}

      {!detail.checklist.length ? (
        <p className="text-[13px] text-muted">Keine Punkte.</p>
      ) : null}

      {mayWrite ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = text.trim();
            if (!value) return;
            setText("");
            void run(() => mutations.addChecklistItem(detail.id, value), "Punkt hinzugefügt");
          }}
        >
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Neuer Punkt"
            aria-label="Neuer Checklistenpunkt"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !text.trim()}>
            Hinzufügen
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * The two directions of the graph, in one panel.
 *
 * `dependsOn` is what this task waits for and `blocks` is what waits for it, and
 * both matter to the reader for different reasons: the first is what to chase,
 * the second is what breaks if this slips. A panel showing only the first —
 * which is the obvious half — hides the consequence of the card being late.
 *
 * The edges that are actually holding this task up are marked; the rest are
 * dimmed. Four dependencies of which one is blocking is the normal case.
 */
function DependencyPanel({ detail }: { detail: TaskDetail }) {
  const blocking = new Set(blockingLinks(detail).map((link) => link.id));

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h4 className="text-[12px] font-medium text-muted">Wartet auf</h4>
        {detail.dependsOn.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {detail.dependsOn.map((link) => (
              <li
                key={link.id}
                className={cn(
                  "flex flex-wrap items-center gap-2 text-[13px]",
                  !blocking.has(link.id) && "text-muted",
                )}
              >
                <TaskStatusBadge status={link.task.status} />
                <span>{link.task.title}</span>
                <span className="text-[11px] text-muted" title={dependencyHint(link.type)}>
                  {dependencyLabel(link.type)}
                  {lagLabel(link.lagDays) ? ` · ${lagLabel(link.lagDays)}` : ""}
                </span>
                {blocking.has(link.id) ? <Badge tone="gold">blockiert</Badge> : null}
                {!gatesCompletion(link.type) ? (
                  <span className="text-[11px] text-muted">hält nicht auf</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-muted">Keine Abhängigkeiten.</p>
        )}
      </section>

      <section>
        <h4 className="text-[12px] font-medium text-muted">Blockiert</h4>
        {detail.blocks.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {detail.blocks.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                <TaskStatusBadge status={link.task.status} />
                <span>{link.task.title}</span>
                <span className="text-[11px] text-muted">{dependencyLabel(link.type)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-muted">Nichts wartet auf diese Aufgabe.</p>
        )}
      </section>
    </div>
  );
}

function CommentPanel({
  taskId,
  run,
  busy,
}: {
  taskId: string;
  run: (action: () => Promise<unknown>, success: string) => Promise<void>;
  busy: boolean;
}) {
  const { can } = useAuth();
  const comments = useTaskComments(taskId);
  const mutations = useTaskMutations();
  const [body, setBody] = useState("");

  return (
    <div className="flex flex-col gap-4">
      {comments.loading && !comments.data ? <Skeleton className="h-20 w-full rounded" /> : null}

      {comments.data?.map((comment) => (
        <article key={comment.id} className="rounded-lg bg-surface-sunken p-3">
          <header className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-medium text-ink">
              {comment.authorName ?? "Unbekannt"}
            </span>
            <time className="text-[11px] text-muted" dateTime={comment.createdAt.toISOString()}>
              {formatDateTime(comment.createdAt)}
            </time>
          </header>
          <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed">{comment.body}</p>
        </article>
      ))}

      {comments.data && !comments.data.length ? (
        <p className="text-[13px] text-muted">Noch keine Kommentare.</p>
      ) : null}

      {/*
        `task.comment`, not `task.update`.

        Asking a question on somebody else's card is the point of a thread, and
        the server allows it on any task the reader may see. Gating the box on
        write access would mean an engineer can see a blocked card and not ask
        why it is blocked.
      */}
      {can("task.comment") ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = body.trim();
            if (!value) return;
            setBody("");
            void run(() => mutations.addComment(taskId, { body: value }), "Kommentar gespeichert");
          }}
        >
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            placeholder="Frage oder Hinweis"
            aria-label="Kommentar"
          />
          <Button type="submit" size="sm" className="self-end" disabled={busy || !body.trim()}>
            Kommentieren
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function HistoryPanel({ taskId }: { taskId: string }) {
  const history = useTaskHistory(taskId);

  if (history.loading && !history.data) return <Skeleton className="h-20 w-full rounded" />;
  if (!history.data?.length) {
    return (
      <p className="text-[13px] text-muted">
        Noch keine Änderungen. Der Verlauf beginnt mit der ersten Bearbeitung.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {history.data.map((version) => (
        <li key={version.version} className="flex gap-3 text-[13px]">
          <Badge tone="neutral">{version.label}</Badge>
          <div className="flex flex-col gap-0.5">
            <span className="text-ink">{version.changed.join(", ") || "—"}</span>
            {version.note ? <span className="text-[12px] text-muted">{version.note}</span> : null}
            <span className="text-[11px] text-muted">
              {version.changedByName ?? "Unbekannt"} · {formatDateTime(version.createdAt)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Blocking asks for a reason, because the server refuses without one.
 *
 * A separate dialog rather than a prompt on the button: the reason is the only
 * thing that makes a blocked column readable, and a required field belongs in a
 * form rather than in a browser prompt that cannot be styled, translated or
 * validated.
 */
function BlockDialog({
  value,
  onChange,
  busy,
  onCancel,
  onConfirm,
}: {
  value: string;
  onChange: (next: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Drawer
      open
      onClose={onCancel}
      busy={busy}
      width="sm"
      title="Warum blockiert?"
      description="Ohne Grund ist eine blockierte Spalte nicht lesbar — und der Server nimmt sie nicht an."
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={onConfirm} disabled={busy || !value.trim()}>
            Blockieren
          </Button>
        </>
      }
    >
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        autoFocus
        aria-label="Grund"
        placeholder="z. B. Wartet auf den definitiven Küchenausbau der Bauherrschaft."
      />
    </Drawer>
  );
}
