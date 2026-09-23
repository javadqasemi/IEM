import { useEffect, useId, useState } from "react";
import { toFailure } from "@/core/api";
import { CONFLICT_BLOCKS_SAVE, ConflictNotice } from "@/shared/ui/feedback";
import {
  DRAWING_FORMAT_OPTIONS,
  DRAWING_TYPE_OPTIONS,
  PHASE_OPTIONS,
  type DrawingDetail,
  type DrawingFormat,
  type DrawingType,
  type SiaPhase,
} from "@/entities/drawing";
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
import { drawingRepository } from "../repository";
import { useDrawingMutations } from "../hooks/useDrawings";
import { violatesFourEyes } from "../service";

/**
 * Editing the plan record — and the screen the optimistic lock is for.
 *
 * **It opens on a version and submits that version back.** `expectedVersion` is
 * the plan's version as it was when the dialog opened, not as it is when the
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
 * **`status` and the revisions are not here.** Each is its own act with its own
 * permission — `check`, `release`, `issue`, `withdraw` are four different
 * people's authority — and a dialog that did both would run the transition
 * rules on a save that only corrected a Massstab.
 *
 * **`projectId` is absent and cannot be changed.** The number is unique within
 * its project; moving a plan would make `4723-HZG-EG-101` mean two things.
 */
export function DrawingEditDialog({
  drawing,
  onClose,
  onSaved,
}: {
  drawing: DrawingDetail;
  onClose: () => void;
  onSaved: (next: DrawingDetail) => void;
}) {
  const ids = {
    number: useId(),
    title: useId(),
    discipline: useId(),
    type: useId(),
    format: useId(),
    scale: useId(),
    phase: useId(),
    building: useId(),
    drawnBy: useId(),
    checkedBy: useId(),
    note: useId(),
  };

  const mutations = useDrawingMutations();

  const [number, setNumber] = useState(drawing.number);
  const [title, setTitle] = useState(drawing.title);
  const [discipline, setDiscipline] = useState(drawing.disciplineId);
  const [type, setType] = useState<DrawingType>(drawing.type);
  const [format, setFormat] = useState<DrawingFormat>(drawing.format);
  const [scale, setScale] = useState(drawing.scale ?? "");
  const [phase, setPhase] = useState<SiaPhase | "">(drawing.phase ?? "");
  const [building, setBuilding] = useState<EntityOption | null>(
    drawing.building ? { value: drawing.building.id, label: drawing.building.name } : null,
  );
  const [drawnBy, setDrawnBy] = useState<EntityOption | null>(
    drawing.drawnBy ? { value: drawing.drawnBy.id, label: drawing.drawnBy.name } : null,
  );
  const [checkedBy, setCheckedBy] = useState<EntityOption | null>(
    drawing.checkedBy ? { value: drawing.checkedBy.id, label: drawing.checkedBy.name } : null,
  );
  const [versionNote, setVersionNote] = useState("");

  const [disciplines, setDisciplines] = useState<{ id: string; code: string; name: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  /** Set only by a 409. The one error this form cannot be saved past. */
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void drawingRepository
      .disciplineOptions()
      .then((rows) => {
        if (live) setDisciplines(rows);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const fieldError = (field: string) => errors[field]?.[0];

  /**
   * The four-eyes rule, said before the button rather than after the 400.
   *
   * A courtesy — `drawings.rules.ts` refuses the *check* regardless of what the
   * caller holds — but naming the same person in both columns is an easy
   * mistake to make in a dropdown, and finding out at the transition is two
   * screens later.
   */
  const fourEyes = violatesFourEyes({
    drawnById: drawnBy?.value ?? null,
    checkedById: checkedBy?.value ?? null,
  });

  async function submit() {
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      const next = await mutations.update(drawing.id, {
        // The version this dialog *opened* on.
        expectedVersion: drawing.version,
        versionNote: versionNote.trim() || undefined,
        number: number.trim(),
        title: title.trim(),
        disciplineId: discipline,
        type,
        format,
        scale: scale.trim() || null,
        phase: phase || null,
        buildingId: building?.value ?? null,
        drawnById: drawnBy?.value ?? null,
        checkedById: checkedBy?.value ?? null,
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
    : !number.trim()
      ? "Plannummer fehlt."
      : !title.trim()
        ? "Titel fehlt."
        : !discipline
          ? "Gewerk fehlt."
          : null;

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`${drawing.number} bearbeiten`}
      description="Status, Revisionen und Versand haben eigene Vorgänge."
      size="lg"
      hint={blocked}
      footer={
        <>
          <Badge tone="neutral">v{drawing.version}</Badge>
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
            compareHint="Der Verlauf des Plans zeigt, was geändert wurde."
            onReload={() => {
              mutations.reload(drawing.id);
              onClose();
            }}
          />
        ) : null}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Field label="Plannummer" htmlFor={ids.number} error={fieldError("number")}>
            <Input
              id={ids.number}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              invalid={Boolean(fieldError("number"))}
              className="font-mono"
            />
          </Field>
          <Field label="Titel" htmlFor={ids.title} error={fieldError("title")}>
            <Input
              id={ids.title}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              invalid={Boolean(fieldError("title"))}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gewerk" htmlFor={ids.discipline} error={fieldError("disciplineId")}>
            <Select
              id={ids.discipline}
              value={discipline}
              onChange={(event) => setDiscipline(event.target.value)}
              options={disciplines.map((row) => ({
                value: row.id,
                label: `${row.code} · ${row.name}`,
              }))}
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

        <Field label="Gebäude" htmlFor={ids.building} optional>
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

        <div className="grid gap-4 sm:grid-cols-2">
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
          <Field
            label="Geprüft von"
            htmlFor={ids.checkedBy}
            optional
            error={
              fourEyes
                ? "Wer den Plan gezeichnet hat, kann ihn nicht selbst prüfen."
                : fieldError("checkedById")
            }
          >
            <EntityPicker
              id={ids.checkedBy}
              value={checkedBy?.value ?? null}
              selected={checkedBy}
              onChange={(_next, option) => setCheckedBy(option)}
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
        </div>

        <Field
          label="Grund der Änderung"
          htmlFor={ids.note}
          optional
          hint="Steht im Verlauf neben der Version. Für eine neue Zeichnung gehört die Beschreibung stattdessen in die Revision."
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
