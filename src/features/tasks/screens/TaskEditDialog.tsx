import { useId, useState } from "react";
import { toFailure } from "@/core/api";
import { CONFLICT_BLOCKS_SAVE, ConflictNotice } from "@/shared/ui/feedback";
import { useAuth } from "@/core/auth";
import { PRIORITY_OPTIONS, type Priority } from "@/entities/project";
import type { TaskDetail } from "@/entities/task";
import { Badge, Button } from "@/shared/ui/primitives";
import { Modal } from "@/shared/ui/overlays";
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
import { useQuery } from "@/core/api";
import { taskRepository } from "../repository";
import { useTaskMutations } from "../hooks/useTasks";

/**
 * The eight Gewerke, as a plain `<select>`.
 *
 * Not an `EntityPicker`: a picker searches, and eight rows fit on the screen at
 * once — a search box over eight options is a control that makes a fast choice
 * slow. The endpoint returns them unpaginated for the same reason.
 *
 * Cached under `masterdata`, **not** under `tasks`: saving a task must not evict
 * the Gewerk list, which every form in the system reads. The key is already the
 * one the disciplines feature will take in Wave 1.
 */
function DisciplineSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const options = useQuery(["masterdata", "disciplines"], () =>
    taskRepository.disciplineOptions(),
  );

  return (
    <Select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={[
        { value: "", label: "Kein Gewerk" },
        ...(options.data ?? []).map((row) => ({
          value: row.id,
          label: `${row.code} · ${row.name}`,
        })),
      ]}
    />
  );
}

/**
 * Editing the task record — and the screen the optimistic lock is for.
 *
 * **It opens on a version and submits that version back.** `expectedVersion` is
 * `task.version` as it was when the dialog opened, not as it is when the user
 * presses save; if somebody else saved in between, the server's `updateMany`
 * matches no row and answers **409**. Reading the current version at submit time
 * would defeat the whole mechanism — it would always match.
 *
 * A 409 is handled differently from every other error here, and that is the
 * point of the status being distinct: a 400 means "fix your input" and leaves
 * the form alone, while a 409 means "somebody else got there first" and the
 * only safe thing is to stop and reload. The dialog says so and offers the
 * reload; it does **not** silently re-submit with the new version, which would
 * be a two-click way to do exactly the overwrite the lock exists to prevent.
 *
 * `status` and `position` are not here. Both have their own routes — see
 * `UpdateTaskDto` on the server.
 */
export function TaskEditDialog({
  task,
  onClose,
  onSaved,
}: {
  task: TaskDetail;
  onClose: () => void;
  onSaved: (next: TaskDetail) => void;
}) {
  const ids = {
    title: useId(),
    description: useId(),
    assignee: useId(),
    discipline: useId(),
    priority: useId(),
    start: useId(),
    due: useId(),
    estimate: useId(),
    note: useId(),
  };

  const { can } = useAuth();
  const mutations = useTaskMutations();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [assignee, setAssignee] = useState<EntityOption | null>(
    task.assignee ? { value: task.assignee.id, label: task.assignee.name } : null,
  );
  const [discipline, setDiscipline] = useState<string>(task.disciplineId ?? "");
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [startDate, setStartDate] = useState(toDateInput(task.startDate));
  const [dueDate, setDueDate] = useState(toDateInput(task.dueDate));
  const [estimateHours, setEstimateHours] = useState(task.estimateHours ?? "");
  const [versionNote, setVersionNote] = useState("");

  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  /** Set only by a 409. It is the one error the form cannot be saved past. */
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldError = (field: string) => errors[field]?.[0];
  const mayAssign = can("task.assign");

  async function submit() {
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      const next = await mutations.update(task.id, {
        // The version this dialog *opened* on.
        expectedVersion: task.version,
        versionNote: versionNote.trim() || undefined,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        startDate: parseDateInput(startDate),
        dueDate: parseDateInput(dueDate),
        estimateHours: estimateHours.trim() || null,
        // `""` is the "kein Gewerk" option and means clear it, which is `null`
        // on the wire — the distinction `defined` in the mapper preserves.
        disciplineId: discipline || null,
        /*
          Sent only when the caller may assign.

          Otherwise a user with `task.updateOwn` and no `task.assign` would send
          the field unchanged on every save and be refused by the server for a
          reassignment they did not make — the service checks the *field's
          presence* against the current value, but sending it at all is noise
          that would read as a permissions bug the first time the two disagreed.
        */
        assigneeId: mayAssign ? (assignee?.value ?? null) : undefined,
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
    : title.trim().length < 2
      ? "Der Titel braucht mindestens zwei Zeichen."
      : null;

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Aufgabe bearbeiten"
      description="Status, Position und Abhängigkeiten haben eigene Bedienelemente."
      size="lg"
      hint={blocked}
      footer={
        <>
          <Badge tone="neutral">v{task.version}</Badge>
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
            compareHint="Der Verlauf der Aufgabe zeigt, was geändert wurde."
            onReload={() => {
              mutations.reload(task.id);
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

        <Field label="Beschreibung" htmlFor={ids.description} optional>
          <Textarea
            id={ids.description}
            value={description}
            rows={4}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        {mayAssign ? (
          <Field label="Zuständig" htmlFor={ids.assignee} optional error={fieldError("assigneeId")}>
            <EntityPicker
              id={ids.assignee}
              value={assignee?.value ?? null}
              selected={assignee}
              onChange={(_next, option) => setAssignee(option)}
              search={async (q) => {
                const page = await taskRepository.employeeOptions(q || undefined);
                return page.items.map((row) => ({
                  value: row.id,
                  label: row.name,
                  hint: row.position ?? row.email,
                }));
              }}
              placeholder="Person suchen …"
            />
          </Field>
        ) : null}

        <Field
          label="Gewerk"
          htmlFor={ids.discipline}
          optional
          error={fieldError("disciplineId")}
          hint="Damit „alle offenen Lüftungs-Aufgaben“ eine Abfrage ist und keine Durchsicht."
        >
          <DisciplineSelect id={ids.discipline} value={discipline} onChange={setDiscipline} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Priorität" htmlFor={ids.priority}>
            <Select
              id={ids.priority}
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
              options={PRIORITY_OPTIONS}
            />
          </Field>
          <Field label="Start" htmlFor={ids.start} optional error={fieldError("startDate")}>
            <DateInput id={ids.start} value={startDate} onChange={setStartDate} />
          </Field>
          <Field label="Fällig" htmlFor={ids.due} optional error={fieldError("dueDate")}>
            <DateInput
              id={ids.due}
              value={dueDate}
              onChange={setDueDate}
              invalid={Boolean(fieldError("dueDate"))}
            />
          </Field>
        </div>

        <Field
          label="Aufwand"
          htmlFor={ids.estimate}
          optional
          error={fieldError("estimateHours")}
          hint="Stunden, mit Punkt — 4.25 für eineinviertel Stunden."
        >
          <Input
            id={ids.estimate}
            value={estimateHours}
            inputMode="decimal"
            onChange={(event) => setEstimateHours(event.target.value)}
            invalid={Boolean(fieldError("estimateHours"))}
          />
        </Field>

        <Field
          label="Notiz zur Änderung"
          htmlFor={ids.note}
          optional
          hint="Steht im Verlauf. Der Verlauf zeigt von selbst, *was* geändert wurde — nur eine Person kann sagen, wofür."
        >
          <Input
            id={ids.note}
            value={versionNote}
            onChange={(event) => setVersionNote(event.target.value)}
            placeholder="z. B. Nach Bausitzung 14"
          />
        </Field>
      </Form>
    </Modal>
  );
}
