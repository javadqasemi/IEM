import { useId, useState } from "react";
import { ApiError } from "@/core/api";
import { useAuth } from "@/core/auth";
import {
  APPROVAL_DECISIONS,
  type AgendaDraft,
  type ApprovalDecision,
  type AttendanceEntry,
  type Attendee,
  type MeetingDetail,
} from "@/entities/meeting";
import { Badge, Button, Card, EmptyState } from "@/shared/ui/primitives";
import {
  Checkbox,
  EntityPicker,
  Field,
  Form,
  Input,
  Select,
  Textarea,
  type EntityOption,
} from "@/shared/ui/forms";
import { Modal } from "@/shared/ui/overlays";
import { useToast } from "@/shared/ui/feedback";
import { formatDateTime } from "@/shared/utils/format";
import { meetingRepository } from "../repository";
import { useMeetingMutations } from "../hooks/useMeetings";
import { attendanceIncomplete, splitAttendance } from "../service";

/* ================================================================== */
/* Attendance                                                          */
/* ================================================================== */

/**
 * Who was invited and who turned up.
 *
 * **Three states per person, not a checkbox**, and that is the whole design of
 * this panel. `null` is "not recorded", `false` is "invited and absent", and
 * they are different facts: a protocol that printed unrecorded people as absent
 * would make a claim nobody checked, on a document that gets quoted. The server
 * refuses to mark a meeting `HELD` while *nobody's* presence is recorded for
 * exactly that reason.
 *
 * Changes are collected and saved in one request — `recordAttendance` takes the
 * whole list — because attendance is taken once, at the top of a meeting, by
 * somebody going round the table. A request per click would be twelve requests
 * and twelve chances for one of them to fail unnoticed.
 */
export function AttendancePanel({ meeting }: { meeting: MeetingDetail }) {
  const { can } = useAuth();
  const toast = useToast();
  const mutations = useMeetingMutations();

  const [pending, setPending] = useState<Map<string, AttendanceEntry>>(new Map());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  /*
    `protocolLocked`, not a hand-rolled status test.

    The first version of this line read `status !== "CANCELLED"`, which is a
    weaker condition than the server's: `refuseWhenClosed` guards *every* write
    on a meeting — attendance included — and an approved protocol closes them
    all. So this panel offered three attendance buttons on an approved meeting
    that answered 403 on click.

    The record already carries the answer, computed by the one rule that decides
    it. Any second expression of it here is a second answer, and this one was
    wrong within an hour of being written.
  */
  const mayWrite = can("meeting.update") && !meeting.protocolLocked;

  /** The record plus whatever is not saved yet — what the panel renders. */
  const shown: Attendee[] = meeting.attendees.map((attendee) => {
    const change = pending.get(attendee.id);
    if (!change) return attendee;
    return {
      ...attendee,
      attended: change.attended ?? null,
      apologised: change.apologised ?? false,
    };
  });

  const groups = splitAttendance(shown);
  const dirty = pending.size > 0;

  function set(attendee: Attendee, attended: boolean | null, apologised: boolean) {
    setPending((current) => {
      const next = new Map(current);
      next.set(attendee.id, { attendeeId: attendee.id, attended, apologised });
      return next;
    });
  }

  async function save() {
    setBusy(true);
    try {
      await mutations.recordAttendance(meeting.id, [...pending.values()]);
      setPending(new Map());
      toast.success("Anwesenheit erfasst");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Nicht möglich.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Teilnehmende"
      description={`${meeting.attendees.length} eingeladen · ${groups.present.length} anwesend`}
      action={
        mayWrite ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              Person hinzufügen
            </Button>
            {dirty ? (
              <Button size="sm" busy={busy} onClick={() => void save()}>
                Anwesenheit speichern
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      {meeting.attendees.length === 0 ? (
        <EmptyState
          title="Noch niemand eingeladen"
          description="Teilnehmende können aus dem Personal oder als externe Person mit Firma erfasst werden — die Bauherrschaft und der Architekt sind selten im System."
        />
      ) : (
        <>
          {attendanceIncomplete(shown) && meeting.status === "PLANNED" ? (
            <p className="mb-4 rounded-lg bg-surface-sunken p-3 text-[13px] leading-relaxed ring-1 ring-line">
              Für niemanden ist die Anwesenheit erfasst. Ohne mindestens eine Erfassung lässt sich
              die Sitzung nicht auf „durchgeführt“ setzen — wer im Raum war, ist hinterher nicht
              mehr rekonstruierbar.
            </p>
          ) : null}

          <ul className="flex flex-col divide-y divide-line">
            {shown.map((attendee) => (
              <li key={attendee.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <span className="text-[14px] font-medium text-ink">{attendee.name}</span>
                  {attendee.organisation ? (
                    <span className="ml-2 text-[13px] text-muted">{attendee.organisation}</span>
                  ) : null}
                  {!attendee.employee ? (
                    <Badge tone="neutral" className="ml-2">
                      Extern
                    </Badge>
                  ) : null}
                  {attendee.required ? null : (
                    <span className="ml-2 text-[12px] text-muted">optional</span>
                  )}
                </div>

                {mayWrite ? (
                  <div
                    role="group"
                    aria-label={`Anwesenheit ${attendee.name}`}
                    className="flex rounded-lg bg-surface-sunken p-0.5"
                  >
                    {(
                      [
                        { key: "present", label: "Anwesend", attended: true, apologised: false },
                        { key: "apologised", label: "Entschuldigt", attended: false, apologised: true },
                        { key: "absent", label: "Abwesend", attended: false, apologised: false },
                      ] as const
                    ).map((option) => {
                      const on =
                        option.key === "present"
                          ? attendee.attended === true
                          : option.key === "apologised"
                            ? attendee.attended !== true && attendee.apologised
                            : attendee.attended === false && !attendee.apologised;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => set(attendee, option.attended, option.apologised)}
                          className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                            on ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <AttendanceLabel attendee={attendee} />
                )}

                {mayWrite ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await mutations.removeAttendee(meeting.id, attendee.id);
                        toast.success("Entfernt");
                      } catch (err) {
                        toast.error(err instanceof ApiError ? err.message : "Nicht möglich.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Entfernen
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          {groups.unrecorded.length ? (
            <p className="mt-3 text-[12px] text-muted">
              {groups.unrecorded.length} ohne Erfassung. Nicht erfasst heisst nicht abwesend — im
              Protokoll erscheinen sie getrennt.
            </p>
          ) : null}
        </>
      )}

      {adding ? (
        <AddAttendeeDialog meetingId={meeting.id} onClose={() => setAdding(false)} />
      ) : null}
    </Card>
  );
}

/** The read-only rendering of the same three states, plus the fourth. */
function AttendanceLabel({ attendee }: { attendee: Attendee }) {
  if (attendee.attended === true) return <Badge tone="energy">Anwesend</Badge>;
  if (attendee.apologised) return <Badge tone="gold">Entschuldigt</Badge>;
  if (attendee.attended === false) return <Badge tone="bronze">Abwesend</Badge>;
  return <span className="text-[12px] text-muted">nicht erfasst</span>;
}

/**
 * Adding somebody to the room.
 *
 * **Two kinds of attendee, one table.** An employee is a foreign key; the
 * Bauherrschaft, the architect and the Unternehmer are a name and a firm typed
 * in, because they are not users of this system and never will be. The server's
 * `AddAttendeeDto` requires exactly one of the two, so the form is a toggle
 * rather than two optional halves somebody can fill both of.
 */
function AddAttendeeDialog({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const ids = { employee: useId(), name: useId(), org: useId(), required: useId() };
  const toast = useToast();
  const mutations = useMeetingMutations();

  const [external, setExternal] = useState(false);
  const [employee, setEmployee] = useState<EntityOption | null>(null);
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [required, setRequired] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = external ? name.trim().length >= 2 : Boolean(employee);

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Person hinzufügen"
      description="Aus dem Personal oder extern — die Bauherrschaft und der Architekt sind keine Benutzer dieses Systems."
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            busy={busy}
            disabled={!ready}
            onClick={async () => {
              setError(null);
              setBusy(true);
              try {
                await mutations.addAttendee(meetingId, {
                  employeeId: external ? undefined : employee!.value,
                  externalName: external ? name.trim() : undefined,
                  externalOrg: external ? org.trim() || undefined : undefined,
                  required,
                });
                toast.success("Hinzugefügt");
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Nicht möglich.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Hinzufügen
          </Button>
        </>
      }
    >
      <Form onSubmit={() => undefined} error={error}>
        <div role="group" aria-label="Art" className="flex rounded-lg bg-surface-sunken p-0.5">
          {(
            [
              { value: false, label: "Aus dem Personal" },
              { value: true, label: "Extern" },
            ] as const
          ).map((option) => (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={external === option.value}
              onClick={() => setExternal(option.value)}
              className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                external === option.value
                  ? "bg-surface text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {external ? (
          <>
            <Field label="Name" htmlFor={ids.name}>
              <Input
                id={ids.name}
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                placeholder="M. Brunner"
              />
            </Field>
            <Field label="Firma" htmlFor={ids.org} optional>
              <Input
                id={ids.org}
                value={org}
                onChange={(event) => setOrg(event.target.value)}
                placeholder="Bauherrschaft, Architektur, Unternehmung"
              />
            </Field>
          </>
        ) : (
          <Field label="Person" htmlFor={ids.employee}>
            <EntityPicker
              id={ids.employee}
              value={employee?.value ?? null}
              selected={employee}
              onChange={(_next, option) => setEmployee(option)}
              search={async (q) => {
                const page = await meetingRepository.employeeOptions(q || undefined);
                return page.items.map((row) => ({
                  value: row.id,
                  label: row.name,
                  hint: row.position ?? row.email,
                }));
              }}
              placeholder="Person suchen …"
            />
          </Field>
        )}

        <Checkbox
          label="Erforderlich"
          hint="Eine optionale Person fehlt, ohne dass die Sitzung deswegen unvollständig ist."
          checked={required}
          onChange={setRequired}
        />
      </Form>
    </Modal>
  );
}

/* ================================================================== */
/* The agenda                                                          */
/* ================================================================== */

/**
 * What is to be discussed — set *before* the meeting, unlike the protocol.
 *
 * Numbered, because the numbers are what the protocol lines hang off:
 * `14.3` is agenda item 3 of Bausitzung 14, and `ProtocolPanel` groups by
 * exactly this list. An agenda item removed takes no lines with it — the server
 * sets their `agendaItemId` to null and they surface under "Ohne Traktandum" —
 * which is the one behaviour worth knowing before deleting one.
 */
export function AgendaPanel({ meeting }: { meeting: MeetingDetail }) {
  const { can } = useAuth();
  const toast = useToast();
  const mutations = useMeetingMutations();

  const [editing, setEditing] = useState<string | null | false>(false);
  const [busy, setBusy] = useState(false);

  const mayWrite = can("meeting.update") && !meeting.protocolLocked;
  const total = meeting.agenda.reduce((sum, item) => sum + (item.durationMinutes ?? 0), 0);

  return (
    <Card
      title="Traktanden"
      description={
        total
          ? `${meeting.agenda.length} Traktanden · ${total} Minuten geplant`
          : `${meeting.agenda.length} Traktanden`
      }
      action={
        mayWrite ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
            Traktandum hinzufügen
          </Button>
        ) : null
      }
    >
      {meeting.agenda.length === 0 ? (
        <EmptyState
          title="Keine Traktanden"
          description="Eine Sitzung kann ohne Traktandenliste protokolliert werden — die Zeilen erscheinen dann unter „Ohne Traktandum“."
        />
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {meeting.agenda.map((item) => {
            const lines = meeting.items.filter((line) => line.agendaItemId === item.id).length;
            return (
              <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <span className="w-6 shrink-0 font-mono text-[13px] tnum text-muted">
                  {item.order}.
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-[14px] font-medium text-ink">{item.title}</span>
                  {item.note ? (
                    <p className="mt-0.5 whitespace-pre-line text-[13px] text-muted">{item.note}</p>
                  ) : null}
                </div>
                {item.presenter ? (
                  <span className="text-[13px] text-muted">{item.presenter.name}</span>
                ) : null}
                {item.durationMinutes ? (
                  <span className="text-[12px] text-muted">{item.durationMinutes} min</span>
                ) : null}
                <span className="font-mono text-[11px] tnum text-muted">
                  {lines} {lines === 1 ? "Zeile" : "Zeilen"}
                </span>

                {mayWrite ? (
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(item.id)}>
                      Ändern
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await mutations.removeAgendaItem(meeting.id, item.id);
                          toast.success("Traktandum entfernt");
                        } catch (err) {
                          toast.error(err instanceof ApiError ? err.message : "Nicht möglich.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Entfernen
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {editing !== false ? (
        <AgendaDialog
          meeting={meeting}
          agendaItemId={editing}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </Card>
  );
}

function AgendaDialog({
  meeting,
  agendaItemId,
  onClose,
}: {
  meeting: MeetingDetail;
  agendaItemId: string | null;
  onClose: () => void;
}) {
  const existing = agendaItemId ? meeting.agenda.find((a) => a.id === agendaItemId) : undefined;
  const ids = { title: useId(), note: useId(), presenter: useId(), duration: useId() };
  const toast = useToast();
  const mutations = useMeetingMutations();

  const [title, setTitle] = useState(existing?.title ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [presenter, setPresenter] = useState<EntityOption | null>(
    existing?.presenter ? { value: existing.presenter.id, label: existing.presenter.name } : null,
  );
  const [duration, setDuration] = useState(existing?.durationMinutes?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    const draft: AgendaDraft = {
      title: title.trim(),
      note: note.trim() || null,
      presenterId: presenter?.value ?? null,
      durationMinutes: duration.trim() === "" ? null : Number(duration),
    };
    try {
      if (existing) await mutations.updateAgendaItem(meeting.id, existing.id, draft);
      else await mutations.addAgendaItem(meeting.id, draft);
      toast.success(existing ? "Traktandum geändert" : "Traktandum hinzugefügt");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nicht möglich.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={existing ? "Traktandum ändern" : "Neues Traktandum"}
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button busy={busy} disabled={title.trim().length < 2} onClick={() => void submit()}>
            {existing ? "Speichern" : "Hinzufügen"}
          </Button>
        </>
      }
    >
      <Form onSubmit={() => void submit()} error={error}>
        <Field label="Titel" htmlFor={ids.title}>
          <Input
            id={ids.title}
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Stand Lüftung Obergeschoss"
          />
        </Field>
        <Field label="Notiz" htmlFor={ids.note} optional hint="Was vorbereitet werden muss.">
          <Textarea
            id={ids.note}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vortrag" htmlFor={ids.presenter} optional>
            <EntityPicker
              id={ids.presenter}
              value={presenter?.value ?? null}
              selected={presenter}
              onChange={(_next, option) => setPresenter(option)}
              search={async (q) => {
                const page = await meetingRepository.employeeOptions(q || undefined);
                return page.items.map((row) => ({
                  value: row.id,
                  label: row.name,
                  hint: row.position ?? row.email,
                }));
              }}
              placeholder="Person suchen …"
            />
          </Field>
          <Field label="Dauer" htmlFor={ids.duration} optional hint="Minuten.">
            <Input
              id={ids.duration}
              value={duration}
              inputMode="numeric"
              onChange={(event) => setDuration(event.target.value)}
              placeholder="15"
            />
          </Field>
        </div>
      </Form>
    </Modal>
  );
}

/* ================================================================== */
/* The approval                                                        */
/* ================================================================== */

/**
 * The act that turns a draft into the record.
 *
 * **One protocol, one approval — of either kind.** An amendment is not a step
 * before the approval, it *is* the approval of a record that was corrected in
 * the saying, and both leave the protocol closed. That symmetry was wrong in the
 * first version of the server's rules and was found by an e2e assertion; this
 * panel states it in a sentence so nobody has to discover it from a 400.
 *
 * Approving is deliberately a **modal with a consequence written in it** rather
 * than a button in a row of buttons: it is the one irreversible act in the
 * module, and the thing it makes impossible — editing the minutes — is not
 * obvious from the word "genehmigen".
 */
export function ApprovalPanel({ meeting }: { meeting: MeetingDetail }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);

  const mayApprove = can("meeting.approve") && meeting.status === "HELD" && !meeting.approvals.length;

  return (
    <Card
      title="Genehmigung"
      description="Ein genehmigtes Protokoll ist der Stand und lässt sich nicht mehr ändern."
      action={
        mayApprove ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            Protokoll genehmigen
          </Button>
        ) : null
      }
    >
      {meeting.approvals.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {meeting.approvals.map((approval) => (
            <li key={approval.id} className="flex flex-col gap-1 py-2.5 first:pt-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <Badge tone={approval.decision === "AMENDED" ? "gold" : "energy"}>
                  {approval.decision === "AMENDED" ? "Mit Änderung genehmigt" : "Genehmigt"}
                </Badge>
                <span className="text-[14px] font-medium text-ink">
                  {approval.decidedBy?.name ?? "—"}
                </span>
                <span className="text-[12px] text-muted">
                  {formatDateTime(approval.decidedAt)}
                </span>
              </div>
              {approval.note ? (
                <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink">
                  {approval.note}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : meeting.status !== "HELD" ? (
        <EmptyState
          title="Noch nichts zu genehmigen"
          description="Erst das Protokoll einer durchgeführten Sitzung kann genehmigt werden."
        />
      ) : (
        <EmptyState
          title="Protokoll noch nicht genehmigt"
          description="Üblicherweise wird das Protokoll zu Beginn der nächsten Sitzung genehmigt — unverändert oder mit einer beschriebenen Änderung."
        />
      )}

      {open ? <ApproveDialog meeting={meeting} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

function ApproveDialog({ meeting, onClose }: { meeting: MeetingDetail; onClose: () => void }) {
  const ids = { decision: useId(), note: useId() };
  const toast = useToast();
  const mutations = useMeetingMutations();

  const [decision, setDecision] = useState<ApprovalDecision>("APPROVED");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The server's rule, before the request rather than after the 400.
  const needsNote = decision === "AMENDED" && !note.trim();

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Protokoll genehmigen"
      description="Danach ist das Protokoll der Stand. Es lässt sich nicht mehr bearbeiten."
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            busy={busy}
            disabled={needsNote}
            onClick={async () => {
              setError(null);
              setBusy(true);
              try {
                await mutations.approve(meeting.id, {
                  decision,
                  note: note.trim() || undefined,
                });
                toast.success("Protokoll genehmigt");
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Nicht möglich.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Genehmigen
          </Button>
        </>
      }
    >
      <Form onSubmit={() => undefined} error={error}>
        <Field label="Entscheid" htmlFor={ids.decision}>
          <Select
            id={ids.decision}
            value={decision}
            onChange={(event) => setDecision(event.target.value as ApprovalDecision)}
            options={APPROVAL_DECISIONS.map((value) => ({
              value,
              label: value === "AMENDED" ? "Mit Änderung genehmigt" : "Unverändert genehmigt",
            }))}
          />
        </Field>

        <Field
          label="Änderung"
          htmlFor={ids.note}
          optional={decision !== "AMENDED"}
          error={needsNote ? "Eine Genehmigung mit Änderung braucht eine Beschreibung." : undefined}
          hint="Was gegenüber dem versandten Protokoll korrigiert wurde. Beides bleibt auf dem Record."
        >
          <Textarea
            id={ids.note}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>

        <p className="text-[13px] leading-relaxed text-muted">
          {meeting.counts.items} {meeting.counts.items === 1 ? "Zeile" : "Zeilen"} werden damit
          festgeschrieben. Eine spätere Korrektur wird als Änderung an der nächsten Sitzung
          genehmigt und steht neben dem ursprünglichen Text.
        </p>
      </Form>
    </Modal>
  );
}
