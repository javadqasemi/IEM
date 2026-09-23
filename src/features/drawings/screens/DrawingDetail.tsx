import { useState } from "react";
import { toFailure } from "@/core/api";
import { Link, navigate, useRoute, usePageTitle } from "@/core/router";
import { useAuth } from "@/core/auth";
import {
  DrawingStatusBadge,
  RevisionBadge,
  IssuedRevisionBadge,
  drawingStatusLabel,
  drawingStatusTone,
  drawingTypeLabel,
  formatLabel,
  phaseLabel,
  revisionReasonLabel,
  type DrawingDetail as Drawing,
  type DrawingStatus,
  type Revision,
} from "@/entities/drawing";
import { DisciplineDot } from "@/entities/project";
import { Badge, Button, Card, ErrorState, PageHeader, Skeleton } from "@/shared/ui/primitives";
import {
  ConfirmDialog,
  RecordActions,
  StatusTransitionDialog,
  type TransitionTarget,
} from "@/shared/ui/overlays";
import { Pair } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { formatDate, formatDateTime, relativeTime } from "@/shared/utils/format";
import { cn } from "@/shared/utils/cn";
import { useDrawing, useDrawingHistory, useDrawingMutations } from "../hooks/useDrawings";
import { currentRevision, formatSize, violatesFourEyes } from "../service";
import { DrawingEditDialog } from "./DrawingEditDialog";
import { RevisionDialog } from "./RevisionDialog";
import { FIELD_LABELS } from "./fieldLabels";

/**
 * One plan, its revisions and its history.
 *
 * **A route, not a drawer** — the same argument Sitzungen made and for the same
 * reason: a plan is cited by number, and *"siehe 4723-HZG-EG-101 Rev. C"* has
 * to be a link somebody can paste into an e-mail.
 *
 * **The tab is in the address too**, so a reload comes back to the revision
 * history rather than to the overview.
 *
 * The strip is anchors in a `<nav>` and deliberately **not** `role="tab"`: it
 * changes the route rather than swapping a panel, and telling a screen reader
 * otherwise would describe something that does not happen.
 */
export function DrawingDetail({ drawingId }: { drawingId: string }) {
  const route = useRoute();
  const { can } = useAuth();
  const drawing = useDrawing(drawingId);
  const [deleting, setDeleting] = useState(false);

  const record = drawing.data ?? null;
  usePageTitle(record ? `${record.number} — ${record.title}` : null);

  if (drawing.error) return <ErrorState message={drawing.error} onRetry={drawing.refetch} />;

  if (!record) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-16 w-full max-w-lg" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const tabs = [
    { slug: "uebersicht", label: "Übersicht", count: undefined },
    { slug: "revisionen", label: "Revisionen", count: record.counts.revisions },
    { slug: "verlauf", label: "Verlauf", count: record.version },
  ] as const;

  const segments = route.path.split("/").filter(Boolean);
  const slug = segments.length > 2 ? segments[2] : tabs[0].slug;
  const active = tabs.find((tab) => tab.slug === slug) ?? tabs[0];

  return (
    <>
      <PageHeader
        eyebrow={record.project ? `${record.project.number} · ${record.project.name}` : undefined}
        title={record.title}
        description={[
          drawingTypeLabel(record.type),
          record.scale,
          formatLabel(record.format),
          record.phase ? phaseLabel(record.phase) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral" className="font-mono">
              {record.number}
            </Badge>
            <RevisionBadge revision={record.currentRevision} />
            {/*
              Only once something has been issued. Before that, "nicht
              ausgegeben" beside a plan still being drawn states the obvious and
              costs a reader a glance; the register's column carries it for the
              rows where the absence is the point.
            */}
            {record.issuedRevision ? (
              <IssuedRevisionBadge
                issued={record.issuedRevision}
                current={record.currentRevision}
              />
            ) : null}
            <DrawingStatusBadge status={record.status} />
            {record.readOnly ? <Badge tone="bronze">Schreibgeschützt</Badge> : null}
            <RecordActions
              secondary={
                <>
                  {can("drawing.update") && !record.readOnly ? <EditButton drawing={record} /> : null}
                  {can("drawing.create") ? <RevisionButton drawing={record} /> : null}
                  {record.allowedTransitions.length ? <StatusButton drawing={record} /> : null}
                </>
              }
              more={
                can("drawing.delete")
                  ? [{ id: "delete", label: "Löschen", destructive: true, onSelect: () => setDeleting(true) }]
                  : []
              }
            />
          </div>
        }
      />
      <DeleteDialog drawing={record} open={deleting} onClose={() => setDeleting(false)} />

      {/*
        The four-eyes warning, above everything.

        The server refuses the *check* — this is the courtesy that says so
        before somebody tries, because the two names are set on a different
        screen from the one where the refusal happens.
      */}
      {violatesFourEyes(record) ? (
        <div className="rounded-lg bg-surface-sunken px-4 py-3 text-[13px] ring-1 ring-line">
          <strong className="font-medium text-ink">
            Gezeichnet und geprüft ist dieselbe Person.
          </strong>{" "}
          Der Plan lässt sich so nicht auf „geprüft“ setzen — das Vieraugenprinzip gilt unabhängig
          von Berechtigungen.
        </div>
      ) : null}

      <nav
        aria-label="Planbereiche"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1"
      >
        {tabs.map((tab) => {
          const isActive = tab.slug === active.slug;
          return (
            <Link
              key={tab.slug}
              to={`/plaene/${record.id}/${tab.slug}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[14px] font-medium transition-colors",
                isActive
                  ? "border-accent text-ink"
                  : "border-transparent text-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {tab.label}
              {tab.count !== undefined ? (
                <span className="font-mono text-[11px] tnum">{tab.count}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {active.slug === "uebersicht" ? <OverviewTab drawing={record} /> : null}
      {active.slug === "revisionen" ? <RevisionsTab drawing={record} /> : null}
      {active.slug === "verlauf" ? <HistoryTab drawing={record} /> : null}
    </>
  );
}

function OverviewTab({ drawing }: { drawing: Drawing }) {
  const current = currentRevision(drawing);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card
        title="Aktuelle Revision"
        description={
          current
            ? `Rev. ${current.revision} — ${revisionReasonLabel(current.reason)}`
            : "Noch keine Revision."
        }
      >
        {current ? (
          <div className="flex flex-col gap-4">
            <p className="max-w-prose whitespace-pre-line text-[14px] leading-relaxed text-ink">
              {current.changeNote}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Pair label="Datei">
                <span className="break-all">{current.fileName}</span>
              </Pair>
              <Pair label="Grösse">{formatSize(current.size)}</Pair>
              <Pair label="Freigegeben">
                {current.releasedAt ? formatDate(current.releasedAt) : "noch nicht"}
              </Pair>
              <Pair label="Erstellt">
                {current.createdAt ? formatDate(current.createdAt) : "—"}
              </Pair>
            </div>
            {/*
              The checksum, in full and selectable. It is how somebody verifies
              that a file they were sent is the file that was issued, which is
              the question a Planversand exists to answer — so it has to be
              copyable rather than truncated.
            */}
            <Pair label="Prüfsumme (SHA-256)">
              <code className="block break-all font-mono text-[11px] text-muted">
                {current.checksum}
              </code>
            </Pair>
          </div>
        ) : (
          <p className="text-[13px] leading-relaxed text-muted">
            Der Plan ist angelegt und noch nicht gezeichnet. Ohne Revision lässt er sich weder
            prüfen noch freigeben — das ist Absicht: der Status beschreibt die Zeichnung, und es
            gibt noch keine.
          </p>
        )}
      </Card>

      <Card title="Eckdaten">
        <div className="flex flex-col gap-3">
          <Pair label="Gewerk">
            {drawing.discipline ? (
              <span className="inline-flex items-center gap-1.5">
                <DisciplineDot colour={drawing.discipline.colour} />
                {drawing.discipline.code} · {drawing.discipline.name}
              </span>
            ) : (
              "—"
            )}
          </Pair>
          <Pair label="Gebäude">{drawing.building?.name ?? "—"}</Pair>
          <Pair label="Typ">{drawingTypeLabel(drawing.type)}</Pair>
          <Pair label="Massstab">{drawing.scale ?? "—"}</Pair>
          <Pair label="Format">{formatLabel(drawing.format)}</Pair>
          <Pair label="Gezeichnet">{drawing.drawnBy?.name ?? "—"}</Pair>
          <Pair label="Geprüft">{drawing.checkedBy?.name ?? "—"}</Pair>
          <Pair label="Freigegeben">{drawing.approvedBy?.name ?? "—"}</Pair>
        </div>

        {/*
          The anchors that are not here yet, named rather than left as an
          absence somebody wonders about.
        */}
        <p className="mt-4 text-[12px] leading-relaxed text-muted">
          Geschoss, Anlage und Räume kommen mit dem Gebäudemodul. Bis dahin sind Gewerk und Gebäude
          die Filter, mit denen sich ein Planbestand eingrenzen lässt.
        </p>
      </Card>
    </div>
  );
}

/**
 * The revision history — **append-only**, newest first.
 *
 * The bytes of every revision survive, which is what makes "welche Revision
 * hatte der Sanitär am 14. März" answerable at all. A superseded revision is
 * toned down rather than hidden: it is history, not an error.
 */
function RevisionsTab({ drawing }: { drawing: Drawing }) {
  if (!drawing.revisions.length) {
    return (
      <Card title="Revisionen">
        <p className="text-[13px] text-muted">
          Noch keine Revision. Die erste entsteht, sobald eine Zeichnung erfasst wird.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Revisionen"
      description={`${drawing.revisions.length} — die neueste zuoberst. Nichts wird überschrieben.`}
    >
      <ol className="flex flex-col divide-y divide-line">
        {drawing.revisions.map((revision, index) => (
          <RevisionRow key={revision.id} revision={revision} newest={index === 0} />
        ))}
      </ol>
    </Card>
  );
}

function RevisionRow({ revision, newest }: { revision: Revision; newest: boolean }) {
  return (
    <li className={cn("flex flex-col gap-2 py-3 first:pt-0", !newest && "opacity-80")}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <RevisionBadge revision={revision.revision} superseded={revision.supersededAt !== null} />
        <span className="text-[13px] text-muted">{revisionReasonLabel(revision.reason)}</span>
        {revision.releasedAt ? (
          <Badge tone="navy">Freigegeben {formatDate(revision.releasedAt)}</Badge>
        ) : (
          <span className="text-[12px] text-muted">nicht freigegeben</span>
        )}
        {revision.supersededAt ? (
          <span className="text-[12px] text-muted">
            überholt seit {formatDate(revision.supersededAt)}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-[12px] text-muted">
          {revision.createdAt ? relativeTime(revision.createdAt) : ""}
        </span>
      </div>

      <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink">
        {revision.changeNote}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
        <span className="break-all">{revision.fileName}</span>
        <span>{formatSize(revision.size)}</span>
        {revision.drawnBy ? <span>gez. {revision.drawnBy.name}</span> : null}
        {revision.checkedBy ? <span>gepr. {revision.checkedBy.name}</span> : null}
        {revision.approvedBy ? <span>frei. {revision.approvedBy.name}</span> : null}
      </div>
    </li>
  );
}

function HistoryTab({ drawing }: { drawing: Drawing }) {
  const history = useDrawingHistory(drawing.id);

  if (history.error) return <ErrorState message={history.error} onRetry={history.refetch} />;

  return (
    <Card
      title="Verlauf"
      description={`Der Plan steht auf v${drawing.version}. Jede Änderung am Planrecord erzeugt eine Version.`}
    >
      {/*
        Said plainly, because the two are easy to confuse on this screen of all
        screens: a *version* is what the record said, a *revision* is what was
        drawn. They count separately and neither is the other.
      */}
      <p className="mb-4 text-[12px] leading-relaxed text-muted">
        Die Version ist der Stand des Datensatzes — Titel, Gewerk, Zuständigkeiten. Was gezeichnet
        wurde, steht unter Revisionen.
      </p>

      {history.loading && !history.data ? (
        <Skeleton className="h-16 w-full" />
      ) : history.data?.length ? (
        <ol className="flex flex-col divide-y divide-line">
          {history.data.map((entry) => (
            <li
              key={entry.version}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 first:pt-0"
            >
              <Badge tone={entry.version === drawing.version ? "navy" : "neutral"}>
                {entry.label}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{entry.changedByName ?? "System"}</span>{" "}
                <span className="text-muted">
                  {entry.changed.length
                    ? `änderte ${entry.changed.map((f) => FIELD_LABELS[f] ?? f).join(", ")}`
                    : "speicherte ohne Änderung"}
                </span>
                {entry.note ? (
                  <span className="mt-0.5 block text-[13px] text-ink">„{entry.note}“</span>
                ) : null}
              </span>
              <span
                className="shrink-0 text-[12px] text-muted"
                title={formatDateTime(entry.createdAt)}
              >
                {relativeTime(entry.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-muted">
          Der Plan steht auf seiner ersten Fassung. Sobald er umbenannt oder umgehängt wird,
          erscheint hier jede Version.
        </p>
      )}
    </Card>
  );
}

/**
 * The status change, behind whichever key the target demands.
 *
 * The options are **`record.allowedTransitions`**, computed by the server. Not
 * a table on the client: `ISSUED` and `SUPERSEDED` are not settable at all, and
 * a second copy here would start offering them the day somebody added a case.
 */
function StatusButton({ drawing }: { drawing: Drawing }) {
  const { can } = useAuth();
  const toast = useToast();
  const mutations = useDrawingMutations();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The key each target needs — the same map the controller applies. */
  const keyFor = (target: DrawingStatus) =>
    target === "CHECKED"
      ? "drawing.check"
      : target === "RELEASED"
        ? "drawing.release"
        : target === "WITHDRAWN"
          ? "drawing.withdraw"
          : "drawing.update";

  const allowed = drawing.allowedTransitions.filter((target) => can(keyFor(target)));
  if (!allowed.length) return null;

  /*
    One target per allowed transition, each named for the act it performs
    (the glossary: "Freigeben" alone is content approval; a plan is released
    *for construction*). A withdrawal needs a reason — the server refuses
    without one, because everybody holding the plan has to be told why — and
    it is the one destructive target.
  */
  const targets: TransitionTarget[] = allowed.map((value: DrawingStatus) => ({
    value,
    label: drawingStatusLabel(value),
    tone: drawingStatusTone(value),
    confirmLabel:
      value === "IN_CHECK"
        ? "Zur Prüfung geben"
        : value === "CHECKED"
          ? "Als geprüft markieren"
          : value === "RELEASED"
            ? "Zur Ausführung freigeben"
            : value === "WITHDRAWN"
              ? "Plan zurückziehen"
              : undefined,
    destructive: value === "WITHDRAWN",
    reason:
      value === "WITHDRAWN"
        ? {
            label: "Begründung",
            required: true,
            hint: "Wer den Plan hat, muss wissen, warum er nicht mehr gilt.",
          }
        : { label: "Begründung", hint: "Wird im Verlauf und im Audit-Log festgehalten." },
    consequence:
      value === "WITHDRAWN" ? (
        <p>
          Der Plan gilt danach nicht mehr. Zurückgezogen ist endgültig: der Status lässt sich
          danach nicht mehr ändern.
        </p>
      ) : value === "RELEASED" ? (
        <p>Freigegeben heisst: intern geprüft und bereit zum Versand. Ausgegeben ist er erst mit einem Planversand.</p>
      ) : undefined,
  }));

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Status ändern
      </Button>
      <StatusTransitionDialog
        open={open}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
        title="Status ändern"
        description="Ausgegeben und überholt werden nicht gesetzt, sondern verursacht — durch einen Planversand und eine neuere Revision."
        from={{ label: drawingStatusLabel(drawing.status), tone: drawingStatusTone(drawing.status) }}
        targets={targets}
        busy={busy}
        error={error}
        onConfirm={async (status, text) => {
          setError(null);
          setBusy(true);
          try {
            await mutations.changeStatus(drawing.id, {
              status: status as DrawingStatus,
              reason: text || undefined,
            });
            toast.success(`Status: ${drawingStatusLabel(status)}`);
            setOpen(false);
          } catch (err) {
            // The server's refusal, verbatim: "Wer den Plan gezeichnet hat,
            // kann ihn nicht selbst prüfen." says what to do next.
            setError(toFailure(err).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

function EditButton({ drawing }: { drawing: Drawing }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Bearbeiten
      </Button>
      {open ? (
        <DrawingEditDialog
          drawing={drawing}
          onClose={() => setOpen(false)}
          onSaved={(next) => {
            setOpen(false);
            toast.success(`Gespeichert — ${next.number} v${next.version}`);
          }}
        />
      ) : null}
    </>
  );
}

function RevisionButton({ drawing }: { drawing: Drawing }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Neue Revision
      </Button>
      {open ? (
        <RevisionDialog
          drawing={drawing}
          onClose={() => setOpen(false)}
          onCreated={(revision) => {
            setOpen(false);
            toast.success(`Rev. ${revision.revision} angelegt`);
            navigate(`/plaene/${drawing.id}/revisionen`);
          }}
        />
      ) : null}
    </>
  );
}

/** Deleting the plan — opened from the record's "Mehr" menu (P1C). HIGH level: the number is typed. */
function DeleteDialog({
  drawing,
  open,
  onClose,
}: {
  drawing: Drawing;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const mutations = useDrawingMutations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setOpen = (next: boolean) => {
    if (!next) {
      setError(null);
      onClose();
    }
  };

  return (
    <>
      <ConfirmDialog
        open={open}
        busy={busy}
        error={error}
        onClose={() => setOpen(false)}
        title="Plan löschen?"
        message={
          <>
            <p>
              {drawing.number} — {drawing.title}, mit {drawing.counts.revisions}{" "}
              {drawing.counts.revisions === 1 ? "Revision" : "Revisionen"}.
            </p>
            {/*
              The rule before the request rather than after the 400, and it is
              the distinction people get wrong: an issued plan is somebody
              else's record too.
            */}
            <p className="mt-2 text-muted">
              Ein ausgegebener Plan lässt sich nicht löschen — er ist bei den Empfängern. Er wird
              <strong> zurückgezogen</strong>, damit alle, die ihn haben, es erfahren.
            </p>
          </>
        }
        confirmLabel="Löschen"
        destructive
        confirmText={drawing.number}
        onConfirm={async () => {
          setBusy(true);
          setError(null);
          try {
            await mutations.remove(drawing.id);
            toast.success("Gelöscht");
            setOpen(false);
            navigate("/plaene");
          } catch (err) {
            // In the dialog: an issued plan's refusal says to withdraw it instead.
            setError(toFailure(err).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
