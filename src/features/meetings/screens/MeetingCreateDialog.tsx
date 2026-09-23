import { useId, useState } from "react";
import { toFailure } from "@/core/api";
import {
  MEETING_TYPE_OPTIONS,
  type MeetingDetail,
  type MeetingType,
} from "@/entities/meeting";
import { Button } from "@/shared/ui/primitives";
import { Modal } from "@/shared/ui/overlays";
import {
  EntityPicker,
  Field,
  Form,
  Input,
  Select,
  type EntityOption,
} from "@/shared/ui/forms";
import { meetingRepository } from "../repository";
import { useMeetingMutations } from "../hooks/useMeetings";

/**
 * A new meeting.
 *
 * **Title and start are the only required fields**, and the rest of the form is
 * arranged around one fact: a meeting is usually created *before* anybody knows
 * who is coming. Attendees, agenda and protocol are all added on the detail
 * screen afterwards, so this dialog asks for the four things that go in a
 * calendar invitation and stops.
 *
 * ---
 *
 * **`seriesNumber` is typed, not generated**, and that is the one decision here
 * worth explaining. The server *offers* the next number for the project and type
 * — `nextSeriesNumber` — but it does not impose one, because a firm that has run
 * eleven Bausitzungen on paper starts this system at twelve. Prefilling from the
 * server and letting it be overwritten is the arrangement that works for both
 * the new project and the one already under way.
 */
export function MeetingCreateDialog({
  projectId,
  onClose,
  onCreated,
}: {
  /** Fixed when the dialog opens from a project's Sitzungen tab. */
  projectId?: string | null;
  onClose: () => void;
  onCreated: (meeting: MeetingDetail) => void;
}) {
  const ids = {
    title: useId(),
    type: useId(),
    series: useId(),
    starts: useId(),
    ends: useId(),
    location: useId(),
    project: useId(),
    organiser: useId(),
  };

  const mutations = useMeetingMutations();

  const [title, setTitle] = useState("");
  const [type, setType] = useState<MeetingType>("BAUSITZUNG");
  const [seriesNumber, setSeriesNumber] = useState("");
  const [startsAt, setStartsAt] = useState(defaultStart());
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [project, setProject] = useState<EntityOption | null>(null);
  const [organiser, setOrganiser] = useState<EntityOption | null>(null);

  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldError = (field: string) => errors[field]?.[0];

  async function submit() {
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      const meeting = await mutations.create({
        title: title.trim(),
        type,
        startsAt: new Date(startsAt),
        endsAt: endsAt ? new Date(endsAt) : null,
        location: location.trim() || null,
        projectId: projectId ?? project?.value ?? null,
        organiserId: organiser?.value ?? null,
        /*
          `null` means "allocate one", not "do not number this".

          The server reads `dto.seriesNumber ?? nextSeriesNumber(…)`, so leaving
          the field empty continues the series for this project and type — which
          is what somebody expects after Bausitzung 13. There is deliberately no
          way to refuse a number from this dialog: the one case for that is a
          meeting that is not part of a series, and the server has no such
          concept, so inventing one here would be a client-side rule the API
          would overrule on the next edit.
        */
        seriesNumber: seriesNumber.trim() ? Number(seriesNumber) : null,
      });
      onCreated(meeting);
    } catch (err) {
      const failure = toFailure(err);
      setErrors(failure.fields);
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  /** Why "Anlegen" cannot be pressed yet, in the order the form asks. */
  const blocked =
    title.trim().length < 2
      ? "Der Titel braucht mindestens zwei Zeichen."
      : !startsAt
        ? "Beginn fehlt."
        : null;

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Neue Sitzung"
      description="Titel und Beginn genügen. Teilnehmende, Traktanden und Protokoll kommen auf der Sitzung selbst dazu."
      size="lg"
      hint={blocked}
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            onClick={() => void submit()}
            busy={busy}
            disabled={Boolean(blocked)}
            disabledReason={blocked}
          >
            Anlegen
          </Button>
        </>
      }
    >
      <Form onSubmit={() => void submit()} error={error}>
        <Field label="Titel" htmlFor={ids.title} error={fieldError("title")}>
          <Input
            id={ids.title}
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            invalid={Boolean(fieldError("title"))}
            placeholder="Bausitzung Sanierung Schulhaus"
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
            hint="Leer lassen führt die Reihe fort. Eine Nummer eintragen, wenn die Sitzungen bisher auf Papier gezählt wurden."
          >
            <Input
              id={ids.series}
              value={seriesNumber}
              inputMode="numeric"
              onChange={(event) => setSeriesNumber(event.target.value)}
              invalid={Boolean(fieldError("seriesNumber"))}
              placeholder="fortlaufend"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Beginn" htmlFor={ids.starts} error={fieldError("startsAt")}>
            {/*
              `datetime-local` rather than a date picker plus a time field: a
              meeting is a point in time, and splitting it into two controls is
              two chances to save a Bausitzung at midnight.
            */}
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
            placeholder="Baubüro, Sitzungszimmer 2 oder ein Link"
          />
        </Field>

        {projectId === undefined || projectId === null ? (
          <Field
            label="Projekt"
            htmlFor={ids.project}
            optional
            error={fieldError("projectId")}
            hint="Ohne Projekt ist es eine interne Sitzung."
          >
            <EntityPicker
              id={ids.project}
              value={project?.value ?? null}
              selected={project}
              onChange={(_next, option) => setProject(option)}
              search={async (q) => {
                const page = await meetingRepository.projectOptions(q || undefined);
                return page.items.map((row) => ({
                  value: row.id,
                  label: row.name,
                  hint: row.number,
                }));
              }}
              placeholder="Projekt suchen …"
            />
          </Field>
        ) : null}

        <Field
          label="Leitung"
          htmlFor={ids.organiser}
          optional
          error={fieldError("organiserId")}
          hint="Wer einlädt und das Protokoll verantwortet."
        >
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
      </Form>
    </Modal>
  );
}

/**
 * The next whole hour, as `datetime-local` wants it.
 *
 * A prefilled start beats an empty one on the field people are most likely to
 * leave alone — and "now" to the minute would put `14:37` in a calendar.
 */
function defaultStart(): string {
  const next = new Date();
  next.setHours(next.getHours() + 1, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`;
}
