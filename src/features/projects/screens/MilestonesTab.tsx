import { useId, useState } from "react";
import { useAuth } from "@/core/auth";
import {
  MILESTONE_STATUS_OPTIONS,
  MilestoneBadge,
  SIA_PHASE_OPTIONS,
  phaseLabel,
  type Milestone,
  type MilestoneStatus,
  type ProjectDetail,
  type SiaPhase,
} from "@/entities/project";
import { Badge, Button, Card, EmptyState } from "@/shared/ui/primitives";
import { Modal } from "@/shared/ui/overlays";
import { Checkbox, DateInput, Field, Form, Input, Select } from "@/shared/ui/forms";
import { useToast } from "@/shared/ui/feedback";
import { formatDate, parseDateInput, toDateInput } from "@/shared/utils/format";
import { useProjectMutations } from "../hooks/useProjects";
import { daysUntil } from "../service";

/**
 * The dated commitments this project is measured against.
 *
 * **This tab is what moves `progressPercent` and `health`.** Marking one met
 * recomputes both on the server, which is why every write here returns the
 * whole project and why the figures on the overview change without a reload.
 * Saying so on the screen is deliberate: a number that moves when you touch
 * something else looks like a bug until somebody explains it once.
 *
 * `isBillingTrigger` is not decoration. Meeting such a milestone raises
 * `MilestoneReached` with the flag set, and Finance may create an invoice draft
 * from it (`docs/data-model.md` §3.10) — which is why the flag is shown in the
 * list rather than hidden in the edit form.
 */
export function MilestonesTab({
  project,
  readOnly,
}: {
  project: ProjectDetail;
  readOnly: boolean;
}) {
  const { can } = useAuth();
  const [editing, setEditing] = useState<Milestone | "new" | null>(null);
  const mayEdit = can("project.manageMilestones") && !readOnly;

  const done = project.milestones.filter(
    (m) => m.status === "MET" || m.status === "WAIVED",
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Meilensteine"
        description={
          project.milestones.length
            ? `${done} von ${project.milestones.length} erledigt — daraus wird der Fortschritt berechnet.`
            : "Termine, an denen dieses Projekt gemessen wird."
        }
        action={
          mayEdit ? (
            <Button size="sm" onClick={() => setEditing("new")}>
              Meilenstein
            </Button>
          ) : null
        }
      >
        {project.milestones.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {project.milestones.map((milestone) => {
              const days = daysUntil(milestone.dueDate);
              const settled = milestone.status === "MET" || milestone.status === "WAIVED";
              return (
                <li
                  key={milestone.id}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{milestone.name}</span>
                      {milestone.isBillingTrigger ? (
                        <Badge tone="water">Rechnungsauslöser</Badge>
                      ) : null}
                    </div>
                    <p className="text-[12px] text-muted">
                      {phaseLabel(milestone.phase)}
                      {milestone.metAt ? ` · erreicht am ${formatDate(milestone.metAt)}` : ""}
                    </p>
                  </div>
                  <span className="text-[13px]">{formatDate(milestone.dueDate)}</span>
                  {!settled && days !== null ? (
                    <span
                      className={`text-[12px] ${
                        days < 0 ? "text-brand-bronze" : "text-muted"
                      }`}
                    >
                      {days < 0 ? `${Math.abs(days)} T. überfällig` : `in ${days} T.`}
                    </span>
                  ) : null}
                  <MilestoneBadge status={milestone.status} />
                  {mayEdit ? (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(milestone)}>
                      Bearbeiten
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title="Noch keine Meilensteine"
            description="Ohne Meilensteine steht der Fortschritt auf 0% — ein leerer Plan ist der Anfang eines Projekts, nicht sein Ende."
          />
        )}
      </Card>

      {editing ? (
        <MilestoneDialog
          projectId={project.id}
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function MilestoneDialog({
  projectId,
  existing,
  onClose,
}: {
  projectId: string;
  existing: Milestone | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const mutations = useProjectMutations();
  const ids = { name: useId(), due: useId(), phase: useId(), status: useId() };

  const [name, setName] = useState(existing?.name ?? "");
  const [dueDate, setDueDate] = useState(toDateInput(existing?.dueDate));
  const [phase, setPhase] = useState<SiaPhase | "">(existing?.phase ?? "");
  const [status, setStatus] = useState<MilestoneStatus>(existing?.status ?? "OPEN");
  const [billing, setBilling] = useState(existing?.isBillingTrigger ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (existing) {
        await mutations.updateMilestone(projectId, existing.id, {
          name,
          dueDate: parseDateInput(dueDate) ?? undefined,
          // `""` is how a select says "none". The domain says `null`, and the
          // two are not the same value — sending the empty string would fail
          // the enum check rather than clearing the phase.
          phase: phase || null,
          status,
          isBillingTrigger: billing,
        });
      } else {
        await mutations.createMilestone(projectId, {
          name,
          dueDate: parseDateInput(dueDate)!,
          phase: phase || undefined,
          isBillingTrigger: billing,
        });
      }
      toast.success(existing ? "Gespeichert" : "Meilenstein angelegt");
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
      title={existing ? "Meilenstein bearbeiten" : "Neuer Meilenstein"}
      description="Der Fortschritt des Projekts wird aus den Meilensteinen berechnet."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            onClick={() => void submit()}
            busy={busy}
            disabled={!name.trim() || !dueDate}
          >
            Speichern
          </Button>
        </>
      }
    >
      <Form onSubmit={() => void submit()} error={error}>
        <Field label="Bezeichnung" htmlFor={ids.name}>
          <Input
            id={ids.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bauprojekt abgegeben"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Termin" htmlFor={ids.due}>
            <DateInput id={ids.due} value={dueDate} onChange={setDueDate} />
          </Field>
          <Field label="SIA-Phase" htmlFor={ids.phase} optional>
            <Select
              id={ids.phase}
              value={phase}
              onChange={(e) => setPhase(e.target.value as SiaPhase | "")}
              placeholder="Keiner Phase zugeordnet"
              options={SIA_PHASE_OPTIONS}
            />
          </Field>
        </div>

        {existing ? (
          <Field
            label="Status"
            htmlFor={ids.status}
            hint="„Erreicht“ stempelt das Datum und meldet es an die Finanzen, wenn es ein Rechnungsauslöser ist."
          >
            <Select
              id={ids.status}
              value={status}
              onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
              options={MILESTONE_STATUS_OPTIONS}
            />
          </Field>
        ) : null}

        <Checkbox
          checked={billing}
          onChange={setBilling}
          label="Rechnungsauslöser"
          hint="Beim Erreichen entsteht ein Ereignis, aus dem die Finanzen einen Rechnungsentwurf erstellen können."
        />
      </Form>
    </Modal>
  );
}
