import { useId, useState } from "react";
import { toFailure } from "@/core/api";
import { CONFLICT_BLOCKS_SAVE, ConflictNotice } from "@/shared/ui/feedback";
import {
  MEETING_TYPE_OPTIONS,
  type MeetingDetail,
  type MeetingType,
} from "@/entities/meeting";
import { Badge, Button } from "@/shared/ui/primitives";
import { Modal } from "@/shared/ui/overlays";
import {
  EntityPicker,
  Field,
  Form,
  Input,
  Select,
  Textarea,
  type EntityOption,
} from "@/shared/ui/forms";
import { meetingRepository } from "../repository";
import { useMeetingMutations } from "../hooks/useMeetings";

/**
 * Editing the meeting record — and the screen the optimistic lock is for.
 *
 * **It opens on a version and submits that version back.** `expectedVersion` is
 * the meeting's version as it was when the dialog opened, not as it is when the
 * user presses save. Reading the current version at submit time would always
 * match and defeat the mechanism entirely.
 *
 * A 409 is handled apart from every other error: a 400 means "fix your input"
 * and leaves the form alone, a 409 means somebody else got there first and the
 * only safe move is to stop and reload. There is deliberately no "trotzdem
 * speichern" — it would be a two-click way to do the overwrite the lock exists
 * to prevent, and it would look like the safe option.
 *
 * ---
 *
 * **Status, protocol, attendance and agenda are not here.** Each is its own act
 * with its own route and its own preconditions on the server — moving a meeting
 * to `HELD` is not the same kind of thing as correcting its room, and a dialog
 * that did both would run the transition rules on a save that only changed the
 * location.
 */
export function MeetingEditDialog({
  meeting,
  onClose,
  onSaved,
}: {
  meeting: MeetingDetail;
  onClose: () => void;
  onSaved: (next: MeetingDetail) => void;
}) {
  const ids = {
    title: useId(),
    type: useId(),
    series: useId(),
    starts: useId(),
    ends: useId(),
    location: useId(),
    organiser: useId(),
    note: useId(),
  };

  const mutations = useMeetingMutations();

  const [title, setTitle] = useState(meeting.title);
  const [type, setType] = useState<MeetingType>(meeting.type);
  const [seriesNumber, setSeriesNumber] = useState(meeting.seriesNumber?.toString() ?? "");
  const [startsAt, setStartsAt] = useState(toLocalInput(meeting.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(meeting.endsAt));
  const [location, setLocation] = useState(meeting.location ?? "");
  const [organiser, setOrganiser] = useState<EntityOption | null>(
    meeting.organiser ? { value: meeting.organiser.id, label: meeting.organiser.name } : null,
  );
  const [versionNote, setVersionNote] = useState("");

  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  /** Set only by a 409. The one error this form cannot be saved past. */
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldError = (field: string) => errors[field]?.[0];

  async function submit() {
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      const next = await mutations.update(meeting.id, {
        // The version this dialog *opened* on.
        expectedVersion: meeting.version,
        versionNote: versionNote.trim() || undefined,
        title: title.trim(),
        type,
        seriesNumber: seriesNumber.trim() === "" ? null : Number(seriesNumber),
        startsAt: new Date(startsAt),
        endsAt: endsAt ? new Date(endsAt) : null,
        location: location.trim() || null,
        organiserId: organiser?.value ?? null,
      });
      onSaved(next);
    } catch (err) {
      const failure = toFailure(err);
      if (failure.kind === "conflict") {
        setConflict(failure.message);
      } else {
        setErrors(failure.fields);
        setError(failure.message);
      }
    } finally {
      setBusy(false);
    }
  }

  /** Why "Speichern" cannot be pressed, most important first. */
  const blocked = conflict
    ? CONFLICT_BLOCKS_SAVE
    : !title.trim()
      ? "Titel fehlt."
      : !startsAt
        ? "Beginn fehlt."
        : null;

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Sitzung bearbeiten"
      description="Protokoll, Teilnehmende und Traktanden haben eigene Bereiche."
      size="lg"
      hint={blocked}
      footer={
        <>
          <Badge tone="neutral">v{meeting.version}</Badge>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary"
            onClick={() => void submit()}
            busy={busy}
            disabled={Boolean(blocked)}
            disabledReason={blocked}
          >
            Speichern
          </Button>
        </>
      }
    >
      <Form onSubmit={() => void submit()} error={error}>
        {conflict ? (
          // Reload, not "save anyway" — see `ConflictNotice`.
          <ConflictNotice
            message={conflict}
            compareHint="Der Verlauf der Sitzung zeigt, was geändert wurde."
            onReload={() => {
              mutations.reloadMeeting(meeting.id);
              onClose();
            }}
          />
        ) : null}
        <Field label="Titel" htmlFor={ids.title} error={fieldError("title")}>
          <Input
            id={ids.title}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            invalid={Boolean(fieldError("title"))}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Art" htmlFor={ids.type}>
            <Select
              id={ids.type}
              value={type}
              onChange={(event) => setType(event.target.value as MeetingType)}
              options={MEETING_TYPE_OPTIONS}
            />
          </Field>
          <Field
            label="Nummer"
            htmlFor={ids.series}
            optional
            error={fieldError("seriesNumber")}
            hint="Eine vergebene Nummer bleibt vergeben — sie steht in den E-Mails, die schon draussen sind."
          >
            <Input
              id={ids.series}
              value={seriesNumber}
              inputMode="numeric"
              onChange={(event) => setSeriesNumber(event.target.value)}
              invalid={Boolean(fieldError("seriesNumber"))}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Beginn" htmlFor={ids.starts} error={fieldError("startsAt")}>
            <Input
              id={ids.starts}
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              invalid={Boolean(fieldError("startsAt"))}
            />
          </Field>
          <Field label="Ende" htmlFor={ids.ends} optional error={fieldError("endsAt")}>
            <Input
              id={ids.ends}
              type="datetime-local"
              value={endsAt}
              min={startsAt}
              onChange={(event) => setEndsAt(event.target.value)}
              invalid={Boolean(fieldError("endsAt"))}
            />
          </Field>
        </div>

        <Field label="Ort" htmlFor={ids.location} optional error={fieldError("location")}>
          <Input
            id={ids.location}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </Field>

        <Field label="Leitung" htmlFor={ids.organiser} optional error={fieldError("organiserId")}>
          <EntityPicker
            id={ids.organiser}
            value={organiser?.value ?? null}
            selected={organiser}
            onChange={(_next, option) => setOrganiser(option)}
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

        <Field
          label="Grund der Änderung"
          htmlFor={ids.note}
          optional
          hint="Steht im Verlauf neben der Version. Bei einer Verschiebung die nützlichste Zeile."
        >
          <Textarea
            id={ids.note}
            rows={2}
            value={versionNote}
            onChange={(event) => setVersionNote(event.target.value)}
          />
        </Field>
      </Form>
    </Modal>
  );
}

/**
 * `Date` → what `datetime-local` wants, in local time.
 *
 * Not `toISOString().slice(0, 16)`, which is UTC: a Bausitzung at 14:00 in
 * Zürich would open the form at 12:00 and a save with nothing touched would move
 * it two hours. The same reason `toDateInput` in `shared/utils/format` builds its
 * string from the local getters — this is its datetime sibling, kept here
 * because it is the only place in the dashboard that needs one.
 */
function toLocalInput(value: Date | null): string {
  if (!value) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
