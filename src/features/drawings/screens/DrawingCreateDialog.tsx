import { useEffect, useId, useState } from "react";
import { ApiError } from "@/core/api";
import {
  DRAWING_FORMAT_OPTIONS,
  DRAWING_TYPE_OPTIONS,
  PHASE_OPTIONS,
  type DrawingDetail,
  type DrawingFormat,
  type DrawingType,
  type SiaPhase,
} from "@/entities/drawing";
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
import { drawingRepository } from "../repository";
import { useDrawingMutations } from "../hooks/useDrawings";

/**
 * A new plan.
 *
 * **Four fields are required and the rest are not**: a number, a title, a
 * project and a Gewerk. That is not a lax form — it is the smallest thing that
 * can answer the questions the register exists for. A plan without a Gewerk
 * cannot appear in *alle Lüftungspläne*, and a number without a project cannot
 * be unique.
 *
 * **`status` is not on this form and cannot be.** Every plan starts `WIP`; the
 * other statuses have preconditions `refuseTransition` evaluates and the create
 * route evaluates none of them. The same trap `TaskCreateDialog` documents.
 *
 * The pickers go through **this feature's own repository**. A repository may
 * know any endpoint; importing another feature's is what
 * `architecture.test.ts` refuses.
 */
export function DrawingCreateDialog({
  projectId,
  onClose,
  onCreated,
}: {
  /** Fixed when the dialog opens from a project's Pläne tab. */
  projectId?: string | null;
  onClose: () => void;
  onCreated: (drawing: DrawingDetail) => void;
}) {
  const ids = {
    number: useId(),
    title: useId(),
    project: useId(),
    discipline: useId(),
    type: useId(),
    format: useId(),
    scale: useId(),
    phase: useId(),
    building: useId(),
    drawnBy: useId(),
  };

  const mutations = useDrawingMutations();

  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [project, setProject] = useState<EntityOption | null>(null);
  const [discipline, setDiscipline] = useState("");
  const [type, setType] = useState<DrawingType>("GRUNDRISS");
  const [format, setFormat] = useState<DrawingFormat>("A1");
  const [scale, setScale] = useState("1:50");
  const [phase, setPhase] = useState<SiaPhase | "">("");
  const [building, setBuilding] = useState<EntityOption | null>(null);
  const [drawnBy, setDrawnBy] = useState<EntityOption | null>(null);

  const [disciplines, setDisciplines] = useState<{ id: string; code: string; name: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void drawingRepository
      .disciplineOptions()
      .then((rows) => {
        if (!live) return;
        setDisciplines(rows);
        // Preselected only when there is exactly one sensible answer — with
        // eight Gewerke there is not, so the field stays empty and required.
        if (rows.length === 1) setDiscipline(rows[0].id);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const fieldError = (field: string) => errors[field]?.[0];
  const ready = number.trim().length >= 1 && title.trim().length >= 2 && Boolean(discipline);

  async function submit() {
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      const drawing = await mutations.create({
        number: number.trim(),
        title: title.trim(),
        projectId: (projectId ?? project?.value)!,
        disciplineId: discipline,
        type,
        format,
        scale: scale.trim() || null,
        phase: phase || null,
        buildingId: building?.value ?? null,
        drawnById: drawnBy?.value ?? null,
      });
      onCreated(drawing);
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
      title="Neuer Plan"
      description="Nummer, Titel, Projekt und Gewerk. Die erste Revision kommt mit der Datei."
      size="lg"
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            onClick={() => void submit()}
            busy={busy}
            disabled={!ready || (!projectId && !project)}
          >
            Anlegen
          </Button>
        </>
      }
    >
      <Form onSubmit={() => void submit()} error={error}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Field
            label="Plannummer"
            htmlFor={ids.number}
            error={fieldError("number")}
            hint="Die Nummer des Hauses — kein Format wird erzwungen."
          >
            <Input
              id={ids.number}
              value={number}
              autoFocus
              onChange={(event) => setNumber(event.target.value)}
              invalid={Boolean(fieldError("number"))}
              placeholder="4723-HZG-EG-101"
              className="font-mono"
            />
          </Field>
          <Field label="Titel" htmlFor={ids.title} error={fieldError("title")}>
            <Input
              id={ids.title}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              invalid={Boolean(fieldError("title"))}
              placeholder="Grundriss EG — Heizung"
            />
          </Field>
        </div>

        {projectId === undefined || projectId === null ? (
          <Field label="Projekt" htmlFor={ids.project} error={fieldError("projectId")}>
            <EntityPicker
              id={ids.project}
              value={project?.value ?? null}
              selected={project}
              onChange={(_next, option) => setProject(option)}
              search={async (q) => {
                const page = await drawingRepository.projectOptions(q || undefined);
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
          <Field
            label="Gewerk"
            htmlFor={ids.discipline}
            error={fieldError("disciplineId")}
            hint="Pflicht — ohne Gewerk erscheint der Plan in keiner Gewerkeliste."
          >
            <Select
              id={ids.discipline}
              value={discipline}
              onChange={(event) => setDiscipline(event.target.value)}
              invalid={Boolean(fieldError("disciplineId"))}
              options={[
                { value: "", label: "Gewerk wählen …" },
                ...disciplines.map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` })),
              ]}
            />
          </Field>
          <Field label="Typ" htmlFor={ids.type}>
            <Select
              id={ids.type}
              value={type}
              onChange={(event) => setType(event.target.value as DrawingType)}
              options={DRAWING_TYPE_OPTIONS}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Format" htmlFor={ids.format}>
            <Select
              id={ids.format}
              value={format}
              onChange={(event) => setFormat(event.target.value as DrawingFormat)}
              options={DRAWING_FORMAT_OPTIONS}
            />
          </Field>
          <Field label="Massstab" htmlFor={ids.scale} optional>
            <Input
              id={ids.scale}
              value={scale}
              onChange={(event) => setScale(event.target.value)}
              placeholder="1:50 oder o.M."
            />
          </Field>
          <Field label="SIA-Phase" htmlFor={ids.phase} optional>
            <Select
              id={ids.phase}
              value={phase}
              onChange={(event) => setPhase(event.target.value as SiaPhase | "")}
              options={[{ value: "", label: "Keine" }, ...PHASE_OPTIONS]}
            />
          </Field>
        </div>

        <Field
          label="Gebäude"
          htmlFor={ids.building}
          optional
          hint="Ein Prinzipschema zeigt oft kein einzelnes Gebäude. Geschoss, Anlage und Räume folgen mit dem Gebäudemodul."
        >
          <EntityPicker
            id={ids.building}
            value={building?.value ?? null}
            selected={building}
            onChange={(_next, option) => setBuilding(option)}
            search={async (q) => {
              const page = await drawingRepository.buildingOptions(q || undefined);
              return page.items.map((row) => ({
                value: row.id,
                label: row.name,
                hint: row.number,
              }));
            }}
            placeholder="Gebäude suchen …"
          />
        </Field>

        <Field label="Gezeichnet von" htmlFor={ids.drawnBy} optional>
          <EntityPicker
            id={ids.drawnBy}
            value={drawnBy?.value ?? null}
            selected={drawnBy}
            onChange={(_next, option) => setDrawnBy(option)}
            search={async (q) => {
              const page = await drawingRepository.employeeOptions(q || undefined);
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
