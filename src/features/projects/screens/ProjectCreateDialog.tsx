import { useId, useState } from "react";
import { ApiError } from "@/core/api";
import type { Priority, ProjectDetail } from "@/entities/project";
import { PRIORITY_OPTIONS } from "@/entities/project";
import { parseDateInput } from "@/shared/utils/format";
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
import { useProjectMutations } from "../hooks/useProjects";
import { projectRepository } from "../repository";
import { toBuildingOption, toCustomerOption, toEmployeeOption } from "../mapper";

/**
 * Creating a project.
 *
 * **A dialog, not a wizard, and not the full form.** A project has twenty
 * editable fields and exactly three a person can supply before it exists: what
 * it is called, who it is for, and which building. Everything else — the
 * Gewerke, the team, the milestones, the fee — is decided *on* the project once
 * it has a number, which is why those are tabs rather than steps. Asking for
 * twenty fields up front produces twenty fields filled with guesses.
 *
 * The three pickers search the server rather than loading every record: the
 * customer list is already two hundred rows and will be two thousand.
 *
 * Errors come back per field. `ApiError.fields` carries the server's
 * class-validator messages and each lands beside its input — a single "Fehler
 * beim Speichern" over a form with eight inputs makes the reader hunt.
 */
export function ProjectCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: ProjectDetail) => void;
}) {
  const ids = {
    name: useId(),
    customer: useId(),
    building: useId(),
    manager: useId(),
    priority: useId(),
    start: useId(),
    end: useId(),
    description: useId(),
  };

  const mutations = useProjectMutations();
  const [name, setName] = useState("");
  const [customer, setCustomer] = useState<EntityOption | null>(null);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [managerId, setManagerId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [startDate, setStartDate] = useState("");
  const [plannedEndDate, setPlannedEndDate] = useState("");
  const [description, setDescription] = useState("");

  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldError = (field: string) => errors[field]?.[0];

  async function submit() {
    setErrors({});
    setError(null);

    // Checked here as well as on the server, because the server's answer for a
    // missing customer arrives after the button has been pressed. This is the
    // same rule stated earlier, not a second one.
    if (!customer) {
      setErrors({ customerId: ["Ein Projekt braucht eine Bauherrschaft."] });
      return;
    }

    setBusy(true);
    try {
      const project = await mutations.create({
        name: name.trim(),
        customerId: customer.value,
        buildingId: buildingId ?? undefined,
        managerId: managerId ?? undefined,
        priority,
        // `parseDateInput` rather than `new Date(value)`: the latter parses as
        // UTC midnight and would shift a date typed in Zürich back a day.
        startDate: parseDateInput(startDate),
        plannedEndDate: parseDateInput(plannedEndDate),
        description: description.trim() || undefined,
      });
      onCreated(project);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setError(err instanceof Error ? err.message : "Anlegen nicht möglich.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Neues Projekt"
      description="Die Nummer wird beim Anlegen vergeben. Gewerke, Team und Termine kommen danach."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={() => void submit()} busy={busy} disabled={!name.trim() || !customer}>
            Projekt anlegen
          </Button>
        </>
      }
    >
      <Form onSubmit={() => void submit()} error={error}>
        <Field label="Projektname" htmlFor={ids.name} error={fieldError("name")}>
          <Input
            id={ids.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Schulhaus Guglera — Sanierung HLKS"
            invalid={Boolean(fieldError("name"))}
          />
        </Field>

        <Field
          label="Bauherrschaft"
          htmlFor={ids.customer}
          error={fieldError("customerId")}
          hint="Wer das Objekt besitzt und den Auftrag erteilt."
        >
          <EntityPicker
            id={ids.customer}
            value={customer?.value ?? null}
            selected={customer}
            onChange={(_next, option) => {
              setCustomer(option);
              // The building goes with it: a building belongs to exactly one
              // customer, and a stale selection would submit a pair the server
              // refuses with a message about the wrong field.
              setBuildingId(null);
            }}
            search={async (q) => {
              const page = await projectRepository.customerOptions(q || undefined);
              return page.items.map(toCustomerOption).map((c) => ({
                value: c.id,
                label: c.name,
                hint: [c.number, c.city].filter(Boolean).join(" · "),
              }));
            }}
            placeholder="Kunde suchen …"
            invalid={Boolean(fieldError("customerId"))}
          />
        </Field>

        <Field
          label="Gebäude"
          htmlFor={ids.building}
          optional
          error={fieldError("buildingId")}
          hint={customer ? "Nur Gebäude dieser Bauherrschaft." : "Zuerst die Bauherrschaft wählen."}
        >
          <EntityPicker
            id={ids.building}
            value={buildingId}
            onChange={(next) => setBuildingId(next)}
            disabled={!customer}
            search={async (q) => {
              const page = await projectRepository.buildingOptions(
                q || undefined,
                customer?.value,
              );
              return page.items.map(toBuildingOption).map((b) => ({
                value: b.id,
                label: b.name,
                hint: [b.number, b.city].filter(Boolean).join(" · "),
              }));
            }}
            placeholder="Gebäude suchen …"
            emptyLabel="Kein Gebäude für diese Bauherrschaft"
          />
        </Field>

        <Field
          label="Projektleitung"
          htmlFor={ids.manager}
          optional
          error={fieldError("managerId")}
          hint="Kann später gesetzt werden — für den Status „Laufend“ ist sie Pflicht."
        >
          <EntityPicker
            id={ids.manager}
            value={managerId}
            onChange={(next) => setManagerId(next)}
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
          <Field label="Start" htmlFor={ids.start} optional error={fieldError("startDate")}>
            <DateInput id={ids.start} value={startDate} onChange={setStartDate} />
          </Field>
          <Field
            label="Geplantes Ende"
            htmlFor={ids.end}
            optional
            error={fieldError("plannedEndDate")}
            hint="Muss nach dem Start liegen."
          >
            <DateInput id={ids.end} value={plannedEndDate} onChange={setPlannedEndDate} />
          </Field>
        </div>

        <Field label="Priorität" htmlFor={ids.priority}>
          <Select
            id={ids.priority}
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            options={PRIORITY_OPTIONS}
          />
        </Field>

        <Field
          label="Beschreibung"
          htmlFor={ids.description}
          optional
          error={fieldError("description")}
        >
          <Textarea
            id={ids.description}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Was umfasst der Auftrag?"
          />
        </Field>
      </Form>
    </Modal>
  );
}
