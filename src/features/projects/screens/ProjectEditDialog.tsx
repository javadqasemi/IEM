import { useId, useState } from "react";
import { toFailure } from "@/core/api";
import {
  PRIORITY_OPTIONS,
  SIA_PHASE_OPTIONS,
  type Priority,
  type ProjectDetail,
  type SiaPhase,
} from "@/entities/project";
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
import { useProjectMutations } from "../hooks/useProjects";
import { projectRepository } from "../repository";
import { toEmployeeOption } from "../mapper";

/**
 * Editing the project record itself — and the screen the optimistic lock is for.
 *
 * **It opens on a version and submits that version back.** `expectedVersion` is
 * `project.version` as it was when the dialog opened, not as it is when the
 * user presses save; if somebody else saved in between, the server's
 * `updateMany` matches no row and answers **409**. Reading the current version
 * at submit time would defeat the whole mechanism — it would always match.
 *
 * A 409 is handled differently from every other error here, and that is the
 * point of the status being distinct: a 400 means "fix your input" and leaves
 * the form alone, while a 409 means "somebody else got there first" and the
 * only safe thing is to stop and reload. The dialog says so above the form —
 * which stays, so the input is not lost from view — and offers the newer
 * version (`ConflictNotice`); it does **not** silently re-submit with the new
 * version, which would be a two-click way to do exactly the overwrite the lock
 * exists to prevent. The reload refetches the project in place rather than
 * reloading the whole application, which is what it used to do.
 *
 * `status` is not here. It has its own route, its own permission and its own
 * preconditions — see `ProjectDetail`'s status control.
 */
export function ProjectEditDialog({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectDetail;
  onClose: () => void;
  onSaved: (next: ProjectDetail) => void;
}) {
  const ids = {
    name: useId(),
    manager: useId(),
    priority: useId(),
    phase: useId(),
    start: useId(),
    end: useId(),
    value: useId(),
    hours: useId(),
    description: useId(),
    notes: useId(),
    note: useId(),
  };

  const mutations = useProjectMutations();

  const [name, setName] = useState(project.name);
  const [manager, setManager] = useState<EntityOption | null>(
    project.manager ? { value: project.manager.id, label: project.manager.name } : null,
  );
  const [priority, setPriority] = useState<Priority>(project.priority);
  const [phase, setPhase] = useState<SiaPhase | "">(project.currentPhase ?? "");
  const [startDate, setStartDate] = useState(toDateInput(project.startDate));
  const [plannedEndDate, setPlannedEndDate] = useState(toDateInput(project.plannedEndDate));
  const [contractValue, setContractValue] = useState(project.contractValue ?? "");
  const [budgetHours, setBudgetHours] = useState(project.budgetHours?.toString() ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [notes, setNotes] = useState(project.notes ?? "");
  const [versionNote, setVersionNote] = useState("");

  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  /** Set only by a 409. It is the one error the form cannot be saved past. */
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldError = (field: string) => errors[field]?.[0];

  async function submit() {
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      const next = await mutations.update(project.id, {
        // The version this dialog *opened* on.
        expectedVersion: project.version,
        versionNote: versionNote.trim() || undefined,
        name: name.trim(),
        managerId: manager?.value ?? null,
        priority,
        currentPhase: phase || null,
        startDate: parseDateInput(startDate),
        plannedEndDate: parseDateInput(plannedEndDate),
        contractValue: contractValue.trim() || null,
        budgetHours: budgetHours.trim() === "" ? null : Number(budgetHours),
        description: description.trim() || null,
        notes: notes.trim() || null,
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
  const blocked = conflict ? CONFLICT_BLOCKS_SAVE : !name.trim() ? "Projektname fehlt." : null;

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`${project.number} bearbeiten`}
      description="Status, Team, Gewerke und Termine haben eigene Ansichten."
      size="lg"
      hint={blocked}
      footer={
        <>
          <Badge tone="neutral">v{project.version}</Badge>
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
          /*
            Reload, not "save anyway" — see `ConflictNotice`. The form stays
            below it so the reader can see, and copy, what they typed.
          */
          <ConflictNotice
            message={conflict}
            compareHint="Der Verlauf des Projekts zeigt, was geändert wurde."
            onReload={() => {
              mutations.reload(project.id);
              onClose();
            }}
          />
        ) : null}
        <Field label="Projektname" htmlFor={ids.name} error={fieldError("name")}>
          <Input
            id={ids.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            invalid={Boolean(fieldError("name"))}
          />
        </Field>

        <Field
          label="Projektleitung"
          htmlFor={ids.manager}
          optional
          error={fieldError("managerId")}
          hint="Für den Status „Laufend“ ist sie Pflicht."
        >
          <EntityPicker
            id={ids.manager}
            value={manager?.value ?? null}
            selected={manager}
            onChange={(_next, option) => setManager(option)}
            search={async (q) => {
              const page = await projectRepository.employeeOptions(q || undefined);
              return page.items.map(toEmployeeOption).map((e) => ({
                value: e.id,
                label: e.name,
                hint: e.position ?? e.email,
              }));
            }}
            placeholder="Person suchen …"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priorität" htmlFor={ids.priority}>
            <Select
              id={ids.priority}
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              options={PRIORITY_OPTIONS}
            />
          </Field>
          <Field
            label="Aktuelle Phase"
            htmlFor={ids.phase}
            optional
            hint="Wird mit den SIA-Phasen berechnet, sobald das Modul da ist."
          >
            <Select
              id={ids.phase}
              value={phase}
              onChange={(e) => setPhase(e.target.value as SiaPhase | "")}
              placeholder="Keine Phase"
              options={SIA_PHASE_OPTIONS}
            />
          </Field>

          <Field label="Start" htmlFor={ids.start} optional error={fieldError("startDate")}>
            <DateInput id={ids.start} value={startDate} onChange={setStartDate} />
          </Field>
          <Field
            label="Geplantes Ende"
            htmlFor={ids.end}
            optional
            error={fieldError("plannedEndDate")}
          >
            <DateInput id={ids.end} value={plannedEndDate} onChange={setPlannedEndDate} />
          </Field>

          <Field
            label="Auftragswert"
            htmlFor={ids.value}
            optional
            error={fieldError("contractValue")}
            hint="Format 1234.50"
          >
            <Input
              id={ids.value}
              value={contractValue}
              onChange={(e) => setContractValue(e.target.value)}
              inputMode="decimal"
              invalid={Boolean(fieldError("contractValue"))}
            />
          </Field>
          <Field label="Sollstunden" htmlFor={ids.hours} optional>
            <Input
              id={ids.hours}
              type="number"
              min={0}
              value={budgetHours}
              onChange={(e) => setBudgetHours(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Beschreibung" htmlFor={ids.description} optional>
          <Textarea
            id={ids.description}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field label="Interne Notizen" htmlFor={ids.notes} optional>
          <Textarea
            id={ids.notes}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <Field
          label="Grund der Änderung"
          htmlFor={ids.note}
          optional
          hint="Erscheint im Verlauf. Bei einem Baustopp oder einer Terminverschiebung die wichtigste Zeile."
        >
          <Input
            id={ids.note}
            value={versionNote}
            onChange={(e) => setVersionNote(e.target.value)}
            placeholder="z. B. Termin nach Rücksprache mit der Bauherrschaft verschoben"
          />
        </Field>
      </Form>
    </Modal>
  );
}
