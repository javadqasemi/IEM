import { useEffect, useId, useState } from "react";
import { toFailure } from "@/core/api";
import {
  DECISION_IMPACT_OPTIONS,
  DECISION_TYPE_OPTIONS,
  type DecisionDetail,
  type DecisionImpact,
  type DecisionType,
} from "@/entities/meeting";
import { Badge, Button } from "@/shared/ui/primitives";
import { Modal } from "@/shared/ui/overlays";
import { CONFLICT_BLOCKS_SAVE, ConflictNotice } from "@/shared/ui/feedback";
import {
  DateInput,
  EntityPicker,
  Field,
  Form,
  Input,
  Select,
  Textarea,
  type EntityOption,
} from "@/shared/ui/forms";
import { parseDateInput, toDateInput } from "@/shared/utils/format";
import { meetingRepository } from "../repository";
import { useMeetingMutations } from "../hooks/useMeetings";

/**
 * The form both dialogs share.
 *
 * **The rationale is required and the length rule is stated, not discovered.**
 * The server refuses anything under twenty characters, and that number is not
 * arbitrary bureaucracy: a decision record exists to answer *why*, and "ok so
 * vereinbart" answers nothing two years later when somebody asks who agreed to
 * the extra riser. Saying so on the field is the difference between a rule
 * people keep and a rule people route around by typing twenty full stops.
 *
 * **A cost belongs to a cost impact.** The server refuses a figure on an impact
 * of `KEINE`, so the two cost fields are hidden rather than left to be rejected
 * — a form that shows a field it will not accept is one people fill in twice.
 */
type Values = {
  title: string;
  rationale: string;
  type: DecisionType;
  impact: DecisionImpact;
  costImpact: string;
  scheduleImpactDays: string;
  decidedAt: string;
  decidedBy: EntityOption | null;
  decidedByExternal: string;
  discipline: string;
  project: EntityOption | null;
  meeting: EntityOption | null;
};

const RATIONALE_MIN = 20;

function DecisionFields({
  values,
  set,
  fieldError,
  showProject,
  showMeeting,
}: {
  values: Values;
  set: <K extends keyof Values>(key: K, value: Values[K]) => void;
  fieldError: (field: string) => string | undefined;
  showProject: boolean;
  showMeeting: boolean;
}) {
  const ids = {
    title: useId(),
    rationale: useId(),
    type: useId(),
    impact: useId(),
    cost: useId(),
    days: useId(),
    decidedAt: useId(),
    decidedBy: useId(),
    external: useId(),
    discipline: useId(),
    project: useId(),
    meeting: useId(),
  };

  const [disciplines, setDisciplines] = useState<{ id: string; code: string; name: string }[]>([]);
  useEffect(() => {
    let live = true;
    void meetingRepository
      .disciplineOptions()
      .then((rows) => {
        if (live) setDisciplines(rows);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const costly = values.impact !== "KEINE";
  const short = values.rationale.trim().length > 0 && values.rationale.trim().length < RATIONALE_MIN;

  return (
    <>
      <Field label="Entscheid" htmlFor={ids.title} error={fieldError("title")}>
        <Input
          id={ids.title}
          value={values.title}
          autoFocus
          onChange={(event) => set("title", event.target.value)}
          invalid={Boolean(fieldError("title"))}
          placeholder="Steigzone Ost wird nach Norden verschoben"
        />
      </Field>

      <Field
        label="Begründung"
        htmlFor={ids.rationale}
        error={
          fieldError("rationale") ??
          (short ? `Mindestens ${RATIONALE_MIN} Zeichen — der Entscheid soll das Warum beantworten.` : undefined)
        }
        hint="Weshalb so entschieden wurde, und was die Alternative war. In zwei Jahren ist das der ganze Wert dieses Eintrags."
      >
        <Textarea
          id={ids.rationale}
          rows={4}
          value={values.rationale}
          onChange={(event) => set("rationale", event.target.value)}
          invalid={Boolean(fieldError("rationale")) || short}
        />
      </Field>

      {showProject ? (
        <Field label="Projekt" htmlFor={ids.project} error={fieldError("projectId")}>
          <EntityPicker
            id={ids.project}
            value={values.project?.value ?? null}
            selected={values.project}
            onChange={(_next, option) => set("project", option)}
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Art" htmlFor={ids.type}>
          <Select
            id={ids.type}
            value={values.type}
            onChange={(event) => set("type", event.target.value as DecisionType)}
            options={DECISION_TYPE_OPTIONS}
          />
        </Field>
        <Field label="Gewerk" htmlFor={ids.discipline} optional>
          <Select
            id={ids.discipline}
            value={values.discipline}
            onChange={(event) => set("discipline", event.target.value)}
            options={[
              { value: "", label: "Kein Gewerk" },
              ...disciplines.map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` })),
            ]}
          />
        </Field>
      </div>

      <Field
        label="Auswirkung"
        htmlFor={ids.impact}
        hint="Was der Entscheid kostet — in Geld, in Zeit, in Qualität oder in nichts davon."
      >
        <Select
          id={ids.impact}
          value={values.impact}
          onChange={(event) => set("impact", event.target.value as DecisionImpact)}
          options={DECISION_IMPACT_OPTIONS}
        />
      </Field>

      {costly ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Kostenfolge"
            htmlFor={ids.cost}
            optional
            error={fieldError("costImpact")}
            hint="Franken, mit Punkt. Negativ für eine Einsparung."
          >
            <Input
              id={ids.cost}
              value={values.costImpact}
              inputMode="decimal"
              onChange={(event) => set("costImpact", event.target.value)}
              invalid={Boolean(fieldError("costImpact"))}
              placeholder="48000.00"
            />
          </Field>
          <Field
            label="Terminfolge"
            htmlFor={ids.days}
            optional
            error={fieldError("scheduleImpactDays")}
            hint="Tage. Negativ, wenn der Entscheid Zeit spart."
          >
            <Input
              id={ids.days}
              value={values.scheduleImpactDays}
              inputMode="numeric"
              onChange={(event) => set("scheduleImpactDays", event.target.value)}
              invalid={Boolean(fieldError("scheduleImpactDays"))}
              placeholder="10"
            />
          </Field>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Entschieden am" htmlFor={ids.decidedAt} error={fieldError("decidedAt")}>
          <DateInput
            id={ids.decidedAt}
            value={values.decidedAt}
            onChange={(next) => set("decidedAt", next)}
            invalid={Boolean(fieldError("decidedAt"))}
          />
        </Field>
        <Field label="Entschieden durch" htmlFor={ids.decidedBy} optional>
          <EntityPicker
            id={ids.decidedBy}
            value={values.decidedBy?.value ?? null}
            selected={values.decidedBy}
            onChange={(_next, option) => set("decidedBy", option)}
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
      </div>

      <Field
        label="Entschieden durch (extern)"
        htmlFor={ids.external}
        optional
        hint="Wenn die Bauherrschaft oder der Architekt entschieden hat — die entscheiden die teuren Fragen und stehen nicht im Personal."
      >
        <Input
          id={ids.external}
          value={values.decidedByExternal}
          onChange={(event) => set("decidedByExternal", event.target.value)}
          placeholder="Bauherrschaft, vertreten durch M. Brunner"
        />
      </Field>

      {showMeeting ? (
        <Field
          label="Sitzung"
          htmlFor={ids.meeting}
          optional
          hint="Wo der Entscheid gefallen ist. Ein Entscheid vom Bauplatz braucht keine."
        >
          <EntityPicker
            id={ids.meeting}
            value={values.meeting?.value ?? null}
            selected={values.meeting}
            onChange={(_next, option) => set("meeting", option)}
            search={async (q) => {
              const page = await meetingRepository.list({
                search: q || undefined,
                projectId: values.project?.value,
                perPage: 20,
                sort: { field: "startsAt", dir: "desc" },
              });
              return page.items.map((row) => ({
                value: row.id,
                label: row.label,
                hint: new Date(row.startsAt).toLocaleDateString("de-CH"),
              }));
            }}
            placeholder="Sitzung suchen …"
          />
        </Field>
      ) : null}
    </>
  );
}

function emptyValues(projectId?: string | null, meetingId?: string | null): Values {
  return {
    title: "",
    rationale: "",
    type: "TECHNISCH",
    impact: "KEINE",
    costImpact: "",
    scheduleImpactDays: "",
    decidedAt: toDateInput(new Date()),
    decidedBy: null,
    decidedByExternal: "",
    discipline: "",
    project: projectId ? { value: projectId, label: "" } : null,
    meeting: meetingId ? { value: meetingId, label: "" } : null,
  };
}

/**
 * A new decision.
 *
 * **Its own dialog rather than a field on a protocol line**, and the two-step is
 * the module's central claim: a decision has a number, a rationale, an impact
 * and a life longer than the meeting it was taken in. Creating one as a side
 * effect of typing "wir machen es so" is how rationales end up empty — which is
 * the one thing that would make this table worthless.
 *
 * The number is the server's. `E-2026-017` is allocated per project and year and
 * never reused, for the same reason a cancelled Bausitzung keeps its number: it
 * has been cited in an e-mail.
 */
export function DecisionCreateDialog({
  projectId,
  meetingId,
  onClose,
  onCreated,
}: {
  projectId?: string | null;
  meetingId?: string | null;
  onClose: () => void;
  onCreated: (decision: DecisionDetail) => void;
}) {
  const mutations = useMeetingMutations();
  const [values, setValues] = useState<Values>(() => emptyValues(projectId, meetingId));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const fieldError = (field: string) => errors[field]?.[0];

  const ready =
    values.title.trim().length >= 2 &&
    values.rationale.trim().length >= RATIONALE_MIN &&
    Boolean(projectId ?? values.project?.value) &&
    Boolean(values.decidedAt);

  async function submit() {
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      const decision = await mutations.createDecision({
        title: values.title.trim(),
        rationale: values.rationale.trim(),
        projectId: (projectId ?? values.project?.value)!,
        decidedAt: parseDateInput(values.decidedAt)!,
        meetingId: meetingId ?? values.meeting?.value ?? null,
        decidedById: values.decidedBy?.value ?? null,
        decidedByExternal: values.decidedByExternal.trim() || null,
        type: values.type,
        disciplineId: values.discipline || null,
        impact: values.impact,
        costImpact: values.impact === "KEINE" ? null : values.costImpact.trim() || null,
        scheduleImpactDays:
          values.impact === "KEINE" || values.scheduleImpactDays.trim() === ""
            ? null
            : Number(values.scheduleImpactDays),
      });
      onCreated(decision);
    } catch (err) {
      const failure = toFailure(err);
      setErrors(failure.fields);
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Entscheid festhalten"
      description="Die Nummer wird beim Speichern vergeben und bleibt zitierbar — auch wenn der Entscheid später aufgehoben wird."
      size="lg"
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={() => void submit()} busy={busy} disabled={!ready}>
            Festhalten
          </Button>
        </>
      }
    >
      <Form onSubmit={() => void submit()} error={error}>
        <DecisionFields
          values={values}
          set={set}
          fieldError={fieldError}
          showProject={projectId === undefined || projectId === null}
          showMeeting={meetingId === undefined || meetingId === null}
        />
      </Form>
    </Modal>
  );
}

/**
 * Correcting a decision.
 *
 * **Correcting, not reversing.** `decision.update` fixes what the record *says*
 * — a typo in the rationale, a cost figure that came in later. Declaring that
 * the firm no longer stands by what it agreed is `supersede`, which is a
 * separate permission, a separate route and a separate button, because it is a
 * separate authority. The dialog says so rather than leaving somebody to edit a
 * decision into saying the opposite of what was decided.
 *
 * The project cannot be changed here — the server's `UpdateDecisionDto` omits it
 * — because the number encodes it. `E-2026-017` on project A moved to project B
 * would be a number that means two things.
 */
export function DecisionEditDialog({
  decision,
  onClose,
  onSaved,
}: {
  decision: DecisionDetail;
  onClose: () => void;
  onSaved: (next: DecisionDetail) => void;
}) {
  const noteId = useId();
  const mutations = useMeetingMutations();

  const [values, setValues] = useState<Values>(() => ({
    title: decision.title,
    rationale: decision.rationale,
    type: decision.type,
    impact: decision.impact,
    costImpact: decision.costImpact ?? "",
    scheduleImpactDays: decision.scheduleImpactDays?.toString() ?? "",
    decidedAt: toDateInput(decision.decidedAt),
    decidedBy: decision.decidedBy
      ? { value: decision.decidedBy.id, label: decision.decidedBy.name }
      : null,
    decidedByExternal: decision.decidedByExternal ?? "",
    discipline: decision.disciplineId ?? "",
    project: decision.project ? { value: decision.project.id, label: decision.project.name } : null,
    meeting: decision.meeting
      ? { value: decision.meeting.id, label: decision.meeting.title }
      : null,
  }));
  const [versionNote, setVersionNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const fieldError = (field: string) => errors[field]?.[0];

  async function submit() {
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      const next = await mutations.updateDecision(decision.id, {
        // The version this dialog *opened* on — see `MeetingEditDialog`.
        expectedVersion: decision.version,
        versionNote: versionNote.trim() || undefined,
        title: values.title.trim(),
        rationale: values.rationale.trim(),
        decidedAt: parseDateInput(values.decidedAt) ?? undefined,
        meetingId: values.meeting?.value ?? null,
        decidedById: values.decidedBy?.value ?? null,
        decidedByExternal: values.decidedByExternal.trim() || null,
        type: values.type,
        disciplineId: values.discipline || null,
        impact: values.impact,
        costImpact: values.impact === "KEINE" ? null : values.costImpact.trim() || null,
        scheduleImpactDays:
          values.impact === "KEINE" || values.scheduleImpactDays.trim() === ""
            ? null
            : Number(values.scheduleImpactDays),
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
    : values.title.trim().length < 2
      ? "Der Titel braucht mindestens zwei Zeichen."
      : values.rationale.trim().length < RATIONALE_MIN
        ? `Die Begründung braucht mindestens ${RATIONALE_MIN} Zeichen.`
        : null;

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`${decision.number} korrigieren`}
      description="Korrektur, nicht Widerruf. Ein Entscheid, der nicht mehr gilt, wird aufgehoben und ersetzt."
      size="lg"
      hint={blocked}
      footer={
        <>
          <Badge tone="neutral">v{decision.version}</Badge>
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
            compareHint="Der Verlauf des Entscheids zeigt, was geändert wurde."
            onReload={() => {
              mutations.reloadDecision(decision.id);
              onClose();
            }}
          />
        ) : null}
        <DecisionFields
          values={values}
          set={set}
          fieldError={fieldError}
          showProject={false}
          showMeeting
        />
        <Field
          label="Grund der Korrektur"
          htmlFor={noteId}
          optional
          hint="Steht im Verlauf neben der Version. Bei einem Entscheid die Zeile, die eine Nachfrage erspart."
        >
          <Textarea
            id={noteId}
            rows={2}
            value={versionNote}
            onChange={(event) => setVersionNote(event.target.value)}
          />
        </Field>
      </Form>
    </Modal>
  );
}
