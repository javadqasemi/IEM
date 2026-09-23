import { useState } from "react";
import { toFailure } from "@/core/api";
import { Link, navigate, useRoute } from "@/core/router";
import { useAuth } from "@/core/auth";
import { usePageTitle } from "@/core/router";
import {
  MeetingStatusBadge,
  MinutesBadge,
  meetingStatusLabel,
  meetingStatusTone,
  type MeetingDetail as Meeting,
  type MeetingStatus,
} from "@/entities/meeting";
import { Badge, Button, Card, ErrorState, PageHeader, Skeleton } from "@/shared/ui/primitives";
import {
  ConfirmDialog,
  RecordActions,
  StatusTransitionDialog,
  type TransitionTarget,
} from "@/shared/ui/overlays";
import { useToast } from "@/shared/ui/feedback";
import { Pair } from "@/shared/ui/data";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import { cn } from "@/shared/utils/cn";
import { useMeeting, useMeetingHistory, useMeetingMutations } from "../hooks/useMeetings";
import { openPendenzen } from "../service";
import { ProtocolPanel } from "./ProtocolPanel";
import { AgendaPanel, ApprovalPanel, AttendancePanel } from "./MeetingPanels";
import { MeetingEditDialog } from "./MeetingEditDialog";
import { FIELD_LABELS } from "./fieldLabels";

/**
 * One meeting, and the five things a meeting is.
 *
 * **A route, not a drawer** — and that is the opposite of the choice Aufgaben
 * made, deliberately. A task is opened, ticked and closed, often four in a row,
 * so a drawer keeps the board underneath; a protocol is read, quoted and sent to
 * people who were not in the room. *"Siehe Bausitzung 14, Punkt 3"* has to be a
 * link somebody can paste into an e-mail, and a drawer has no URL to paste. The
 * cost is the mirror of the one Aufgaben accepted: opening two protocols means
 * going back.
 *
 * **The tab is in the URL too**, for the same reason — `/sitzungen/:id/protokoll`
 * is where a reload returns to, and `routes.tsx` carries two patterns pointing
 * here so the bare `/sitzungen/:id` works as well.
 *
 * The strip is anchors in a `<nav>` and deliberately **not** `role="tab"`: it
 * changes the route rather than swapping a panel, and telling a screen reader
 * otherwise would describe something that does not happen.
 */
export function MeetingDetail({ meetingId }: { meetingId: string }) {
  const route = useRoute();
  const { can } = useAuth();
  const meeting = useMeeting(meetingId);
  const [deleting, setDeleting] = useState(false);

  const record = meeting.data ?? null;
  usePageTitle(record?.label ?? null);

  if (meeting.error) return <ErrorState message={meeting.error} onRetry={meeting.refetch} />;

  if (!record) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-16 w-full max-w-lg" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const open = openPendenzen(record).length;

  const tabs = [
    { slug: "protokoll", label: "Protokoll", count: record.counts.items },
    { slug: "traktanden", label: "Traktanden", count: record.counts.agenda },
    { slug: "teilnehmende", label: "Teilnehmende", count: record.counts.attendees },
    { slug: "genehmigung", label: "Genehmigung", count: undefined },
    { slug: "verlauf", label: "Verlauf", count: record.version },
  ] as const;

  const segments = route.path.split("/").filter(Boolean);
  const slug = segments.length > 2 ? segments[2] : tabs[0].slug;
  const active = tabs.find((tab) => tab.slug === slug) ?? tabs[0];

  return (
    <>
      <PageHeader
        eyebrow={record.project ? `${record.project.number} · ${record.project.name}` : "Intern"}
        title={record.label}
        description={[
          formatDateTime(record.startsAt),
          record.location,
          record.organiser ? `Leitung ${record.organiser.name}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MeetingStatusBadge status={record.status} />
            <MinutesBadge meeting={record} />
            {record.protocolLocked ? <Badge tone="bronze">Schreibgeschützt</Badge> : null}
            <RecordActions
              secondary={
                <>
                  {can("meeting.update") && !record.protocolLocked ? (
                    <EditButton meeting={record} />
                  ) : null}
                  {record.allowedTransitions.length ? <StatusButton meeting={record} /> : null}
                </>
              }
              more={
                can("meeting.delete")
                  ? [{ id: "delete", label: "Löschen", destructive: true, onSelect: () => setDeleting(true) }]
                  : []
              }
              /*
                Gated on `minutesSentAt` as well as the status, because the
                server refuses a second send outright — "Dieses Protokoll wurde
                bereits versandt." A button that can only ever produce that 400
                is worse than no button: it reads as an offer. Found by reading
                `sendMinutes`, after this screen had already been written with
                an "Erneut versenden" variant. It is the meeting's next step,
                so it is the record's primary action.
              */
              primary={
                can("meeting.sendMinutes") && record.status === "HELD" && !record.minutesSentAt ? (
                  <SendMinutesButton meeting={record} />
                ) : null
              }
            />
          </div>
        }
      />
      <DeleteDialog meeting={record} open={deleting} onClose={() => setDeleting(false)} />

      {/*
        The one figure on this page somebody acts on, and it is deliberately not
        a KPI card: it belongs to the protocol, not to the meeting, and a card
        beside "5 Traktanden" would put it in a row of counts nobody reads.
      */}
      {open > 0 ? (
        <div className="rounded-lg bg-surface-sunken px-4 py-3 text-[13px] ring-1 ring-line">
          <strong className="font-medium text-ink">
            {open} {open === 1 ? "offene Pendenz" : "offene Pendenzen"}
          </strong>{" "}
          aus dieser Sitzung. Jede steht als Aufgabe auf dem Board der zuständigen Person.
        </div>
      ) : null}

      <nav
        aria-label="Sitzungsbereiche"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1"
      >
        {tabs.map((tab) => {
          const isActive = tab.slug === active.slug;
          return (
            <Link
              key={tab.slug}
              to={`/sitzungen/${record.id}/${tab.slug}`}
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

      {active.slug === "protokoll" ? (
        <Card
          title="Protokoll"
          description={
            record.minutesSentAt
              ? `Versandt ${formatDateTime(record.minutesSentAt)}.`
              : "Noch nicht versandt."
          }
        >
          <ProtocolPanel meeting={record} />
        </Card>
      ) : null}
      {active.slug === "traktanden" ? <AgendaPanel meeting={record} /> : null}
      {active.slug === "teilnehmende" ? <AttendancePanel meeting={record} /> : null}
      {active.slug === "genehmigung" ? <ApprovalPanel meeting={record} /> : null}
      {active.slug === "verlauf" ? <HistoryPanel meeting={record} /> : null}
    </>
  );
}

/**
 * The status change.
 *
 * The options are **`record.allowedTransitions`**, which the server computed and
 * sent with the meeting — not a table on the client. The transitions and their
 * preconditions live in `server/src/meetings/meetings.rules.ts`, and a second
 * copy here would go stale without anything failing: the dropdown would simply
 * start offering something the API refuses.
 *
 * `meeting.hold` rather than `meeting.update` guards the button, because
 * declaring that a meeting took place is its own authority — the same split the
 * permissions catalogue makes.
 */
function StatusButton({ meeting }: { meeting: Meeting }) {
  const { can } = useAuth();
  const toast = useToast();
  const mutations = useMeetingMutations();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // `HELD` is the one transition behind its own permission; `CANCELLED` is an
  // ordinary edit. Offering a list the user cannot act on would be a dialog
  // that fails on submit.
  const allowed = meeting.allowedTransitions.filter((value) =>
    value === "HELD" ? can("meeting.hold") : can("meeting.update"),
  );
  if (!allowed.length) return null;

  const targets: TransitionTarget[] = allowed.map((value: MeetingStatus) => ({
    value,
    label: meetingStatusLabel(value),
    tone: meetingStatusTone(value),
    confirmLabel:
      value === "HELD" ? "Als durchgeführt markieren" : value === "CANCELLED" ? "Sitzung absagen" : undefined,
    destructive: value === "CANCELLED",
    reason: {
      label: "Begründung",
      hint: "Wird im Verlauf und im Audit-Log festgehalten — bei einer Absage die wichtigste Zeile.",
    },
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
        description="Nur die Übergänge, die der Server für diese Sitzung jetzt zulässt."
        from={{ label: meetingStatusLabel(meeting.status), tone: meetingStatusTone(meeting.status) }}
        targets={targets}
        busy={busy}
        error={error}
        onConfirm={async (status, text) => {
          setError(null);
          setBusy(true);
          try {
            await mutations.changeStatus(meeting.id, {
              status: status as MeetingStatus,
              reason: text || undefined,
            });
            toast.success(`Status: ${meetingStatusLabel(status)}`);
            setOpen(false);
          } catch (err) {
            // The server's refusal, verbatim: "Für keine eingeladene Person ist
            // die Anwesenheit erfasst." says what to do next, which nothing
            // this screen could compose would.
            setError(toFailure(err).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

function EditButton({ meeting }: { meeting: Meeting }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Bearbeiten
      </Button>
      {open ? (
        <MeetingEditDialog
          meeting={meeting}
          onClose={() => setOpen(false)}
          onSaved={(next) => {
            setOpen(false);
            toast.success(`Gespeichert — v${next.version}`);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Marking the minutes as sent — **an act, not a field**, and once only.
 *
 * `minutesSentAt` is stamped by this route and typed nowhere, which is what
 * makes "welche Protokolle muss ich noch versenden" answerable at all: a date
 * somebody can edit is a date that gets set to make a queue look empty.
 *
 * **The sending itself is not built.** An e-mail with the protocol attached
 * needs the Documents module and a PDF renderer, both later in the wave; what
 * this records is the fact somebody needs on a Friday afternoon. The dialog says
 * so rather than letting a button called "versenden" imply an envelope left the
 * building.
 */
function SendMinutesButton({ meeting }: { meeting: Meeting }) {
  const toast = useToast();
  const mutations = useMeetingMutations();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        Protokoll versenden
      </Button>
      <ConfirmDialog
        open={open}
        busy={busy}
        onClose={() => setOpen(false)}
        title="Protokoll als versandt festhalten?"
        message={
          <>
            <p>
              {meeting.counts.items} {meeting.counts.items === 1 ? "Zeile" : "Zeilen"} an{" "}
              {meeting.counts.attendees}{" "}
              {meeting.counts.attendees === 1 ? "eingeladene Person" : "eingeladene Personen"}.
            </p>
            <p className="mt-2 text-muted">
              Der Versand selbst läuft noch über das eigene Postfach — hier wird festgehalten,
              dass er stattgefunden hat. Danach zählt die Sitzung nicht mehr zu den offenen
              Protokollen, und der Eintrag lässt sich nicht zurücknehmen. Bearbeiten bleibt
              möglich, bis das Protokoll genehmigt ist.
            </p>
          </>
        }
        confirmLabel="Festhalten"
        onConfirm={async () => {
          setBusy(true);
          try {
            await mutations.sendMinutes(meeting.id);
            toast.success("Protokoll versandt");
          } catch (err) {
            toast.error(toFailure(err).message);
          } finally {
            setBusy(false);
            setOpen(false);
          }
        }}
      />
    </>
  );
}

/** Deleting the meeting — opened from the record's "Mehr" menu (P1C). */
function DeleteDialog({
  meeting,
  open,
  onClose,
}: {
  meeting: Meeting;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const mutations = useMeetingMutations();
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
        title="Sitzung löschen?"
        message={
          <>
            <p>
              {meeting.label} mit Traktanden, Teilnehmenden und {meeting.counts.items}{" "}
              {meeting.counts.items === 1 ? "Protokollzeile" : "Protokollzeilen"}.
            </p>
            {/*
              The rule before the request rather than after the 400, and the two
              halves that surprise people: an approved protocol cannot be
              deleted at all, and the tasks a Pendenz created outlive the line
              that made them — deleting the meeting does not clear somebody's
              board.
            */}
            <p className="mt-2 text-muted">
              Ein genehmigtes Protokoll lässt sich nicht löschen — es ist der Stand.
            </p>
          </>
        }
        // MEDIUM level: the effect beyond the meeting itself, stated first.
        consequence={<p>Aufgaben, die aus Pendenzen entstanden sind, bleiben bestehen.</p>}
        confirmLabel="Löschen"
        destructive
        onConfirm={async () => {
          setBusy(true);
          setError(null);
          try {
            await mutations.remove(meeting.id);
            toast.success("Gelöscht");
            setOpen(false);
            navigate("/sitzungen");
          } catch (err) {
            setError(toFailure(err).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

/**
 * What this meeting record has said, version by version.
 *
 * **Not the protocol's history** — the protocol is versioned by being closed,
 * which is what approval does. This is the meeting: its date, its room, its
 * leitung. The line that matters in practice is a Verschiebung, and the version
 * note is where the reason for it lives.
 */
function HistoryPanel({ meeting }: { meeting: Meeting }) {
  const history = useMeetingHistory(meeting.id);

  if (history.error) return <ErrorState message={history.error} onRetry={history.refetch} />;

  return (
    <Card
      title="Verlauf"
      description={`Die Sitzung steht auf v${meeting.version}. Jede Änderung am Sitzungsrecord erzeugt eine Version.`}
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Pair label="Angesetzt">{formatDateTime(meeting.createdAt)}</Pair>
        <Pair label="Zuletzt geändert">{formatDateTime(meeting.updatedAt)}</Pair>
        <Pair label="Protokoll versandt">
          {meeting.minutesSentAt ? formatDateTime(meeting.minutesSentAt) : "—"}
        </Pair>
      </div>

      {history.loading && !history.data ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : history.data?.length ? (
        <ol className="flex flex-col divide-y divide-line">
          {history.data.map((entry) => (
            <li
              key={entry.version}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 first:pt-0"
            >
              <Badge tone={entry.version === meeting.version ? "navy" : "neutral"}>
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
          Die Sitzung steht auf ihrer ersten Fassung. Sobald sie verschoben oder umbenannt wird,
          erscheint hier jede Version.
        </p>
      )}
    </Card>
  );
}
