import { useId, useState } from "react";
import { toFailure } from "@/core/api";
import { useAuth } from "@/core/auth";
import { PRIORITY_OPTIONS, type Priority } from "@/entities/project";
import type { TaskDetail } from "@/entities/task";
import { Button } from "@/shared/ui/primitives";
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
import { parseDateInput } from "@/shared/utils/format";
import { taskRepository } from "../repository";
import { useTaskMutations } from "../hooks/useTasks";

/**
 * A new task.
 *
 * **Only the title is required**, and that is the module's shape rather than a
 * lax form: a task is written down the moment somebody notices it, on a site
 * visit or halfway through a meeting, and a create dialog that demanded a
 * project, an assignee and a date would be one people work around by not using
 * it. Everything else is added when it is known.
 *
 * `projectId` is passed in rather than picked when the dialog opens from a
 * project's board — the context already answers the question, and asking again
 * is the sort of form that makes people click through without reading.
 *
 * The pickers go through **this feature's own repository**, which calls
 * `/projects` and `/employees` itself. That is the rule rather than a
 * workaround: a repository may know any endpoint, and the projects feature's
 * repository calls the same three master-data endpoints for the same reason.
 * Importing *its* repository — which the first version of this file did — is
 * what `architecture.test.ts` refuses, because two repositories calling one
 * endpoint is duplication while one feature reaching into another is a mesh.
 * The three lists become their own features in Wave 1 modules 1–3.
 */
export function TaskCreateDialog({
  projectId,
  initialStatus,
  onClose,
  onCreated,
}: {
  /** Fixed when the dialog opens from a project's board. */
  projectId?: string | null;
  /**
   * The column the "+ Aufgabe" button sat in.
   *
   * Recorded but **not** sent: a task is always created `TODO`, because every
   * other status has preconditions the create route does not evaluate. Creating
   * straight into `IN_PROGRESS` would be a way past `refuseTransition`. The
   * column is here so the screen can say where the card will appear.
   */
  initialStatus?: string;
  onClose: () => void;
  onCreated: (task: TaskDetail) => void;
}) {
  const ids = {
    title: useId(),
    description: useId(),
    project: useId(),
    assignee: useId(),
    discipline: useId(),
    priority: useId(),
    due: useId(),
    estimate: useId(),
  };

  const { can } = useAuth();
  const mutations = useTaskMutations();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [project, setProject] = useState<EntityOption | null>(null);
  const [assignee, setAssignee] = useState<EntityOption | null>(null);
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [estimateHours, setEstimateHours] = useState("");

  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldError = (field: string) => errors[field]?.[0];
  const mayAssign = can("task.assign");

  async function submit() {
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      const task = await mutations.create({
        title: title.trim(),
        description: description.trim() || null,
        projectId: projectId ?? project?.value ?? null,
        assigneeId: assignee?.value ?? null,
        /*
          The Gewerk is deliberately not on the create form.

          It is one field too many on a dialog whose whole argument is that a
          task gets written down the moment somebody notices it — and unlike the
          project or the date, it is the one a Projektleiter sets afterwards when
          sorting the backlog. The edit dialog has it; this one does not.
        */
        priority,
        dueDate: parseDateInput(dueDate),
        estimateHours: estimateHours.trim() || null,
      });
      onCreated(task);
    } catch (err) {
      const failure = toFailure(err);
      setErrors(failure.fields);
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const TITLE_TOO_SHORT = "Der Titel braucht mindestens zwei Zeichen.";

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Neue Aufgabe"
      description={
        initialStatus
          ? "Sie erscheint in „Offen“ — jede andere Spalte hat Bedingungen, die erst beim Verschieben geprüft werden."
          : "Nur der Titel ist Pflicht. Projekt, Termin und Zuständigkeit können später dazukommen."
      }
      size="lg"
      hint={title.trim().length < 2 ? TITLE_TOO_SHORT : null}
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary"
            onClick={() => void submit()}
            busy={busy}
            disabled={title.trim().length < 2}
            disabledReason={TITLE_TOO_SHORT}
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
            placeholder="Was ist zu tun?"
          />
        </Field>

        <Field label="Beschreibung" htmlFor={ids.description} optional>
          <Textarea
            id={ids.description}
            value={description}
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        {/* Only when the dialog was not opened from a project. */}
        {projectId === undefined || projectId === null ? (
          <Field
            label="Projekt"
            htmlFor={ids.project}
            optional
            error={fieldError("projectId")}
            hint="Ohne Projekt ist es eine firmeninterne Aufgabe."
          >
            <EntityPicker
              id={ids.project}
              value={project?.value ?? null}
              selected={project}
              onChange={(_next, option) => setProject(option)}
              search={async (q) => {
                const page = await taskRepository.projectOptions(q || undefined);
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priorität" htmlFor={ids.priority}>
            <Select
              id={ids.priority}
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
              options={PRIORITY_OPTIONS}
            />
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
            placeholder="4.25"
          />
        </Field>
      </Form>
    </Modal>
  );
}
