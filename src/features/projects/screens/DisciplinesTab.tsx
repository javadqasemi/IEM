import { useId, useState } from "react";
import { toFailure } from "@/core/api";
import { useAuth } from "@/core/auth";
import {
  DisciplineDot,
  SCOPE_STATUS_OPTIONS,
  scopeStatusLabel,
  type ProjectDetail,
  type ProjectDiscipline,
} from "@/entities/project";
import { Badge, Button, Card, EmptyState } from "@/shared/ui/primitives";
import { Modal } from "@/shared/ui/overlays";
import {
  EntityPicker,
  Field,
  Form,
  Input,
  Select,
  Textarea,
  Checkbox,
  type EntityOption,
} from "@/shared/ui/forms";
import { useToast } from "@/shared/ui/feedback";
import { formatMoney, formatNumber } from "@/shared/utils/format";
import { useDisciplineOptions, useProjectMutations } from "../hooks/useProjects";
import { projectRepository } from "../repository";
import { toEmployeeOption } from "../mapper";
import { scopedDisciplines, totalFeeShare } from "../service";

/**
 * The Gewerke on this project: who leads each, what it is worth, what it costs.
 *
 * This is the table that earns its existence — it answers *what is the Lüftung
 * budget on Guglera and who owns it*, which an enum on the project could not.
 * `docs/data-model.md` §3.4 makes the argument in full; the screen is where it
 * becomes visible.
 *
 * **The fee-share total is shown while somebody types.** The rule is the
 * server's — over 100% needs an explicit override — and showing the running sum
 * means the reader sees the problem before the request rather than after the
 * 400. `totalFeeShare` returns a number and deliberately not a verdict, so it
 * cannot drift into being a second, kinder copy of the rule.
 */
export function DisciplinesTab({
  project,
  readOnly,
}: {
  project: ProjectDetail;
  readOnly: boolean;
}) {
  const { can } = useAuth();
  const [editing, setEditing] = useState<ProjectDiscipline | "new" | null>(null);
  const scoped = scopedDisciplines(project.disciplines);
  const total = totalFeeShare(project.disciplines);
  const mayEdit = can("project.manageDisciplines") && !readOnly;

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Gewerke"
        description="Der Umfang je Fachbereich auf diesem Projekt, mit Fachverantwortung und Budget."
        action={
          mayEdit ? (
            <Button size="sm" onClick={() => setEditing("new")}>
              Gewerk beauftragen
            </Button>
          ) : null
        }
      >
        {project.disciplines.length ? (
          <>
            <ul className="flex flex-col divide-y divide-line">
              {project.disciplines.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                  {/*
                    The discipline's own token, so a Lüftung run is the same
                    colour here, on a plan, in a schedule and in the 3D scene.
                    `aria-hidden`; the code beside it is the label.
                  */}
                  <DisciplineDot colour={row.discipline.colour} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold text-muted">
                        {row.discipline.code}
                      </span>
                      <span className="font-medium text-ink">{row.discipline.name}</span>
                      {row.status === "NOT_IN_SCOPE" ? (
                        <Badge tone="neutral">{scopeStatusLabel(row.status)}</Badge>
                      ) : null}
                      {row.feeShareOverride ? <Badge tone="gold">Freigabe &gt; 100%</Badge> : null}
                    </div>
                    <p className="text-[12px] text-muted">
                      {row.leadEngineer ? (
                        row.leadEngineer.name
                      ) : (
                        <span className="text-brand-bronze">
                          keine Fachverantwortung
                        </span>
                      )}
                      {row.scopeNote ? ` · ${row.scopeNote}` : ""}
                    </p>
                  </div>
                  <span className="w-20 text-right font-mono text-[13px] tnum">
                    {row.feeShare === null ? "—" : `${row.feeShare}%`}
                  </span>
                  <span className="w-24 text-right font-mono text-[13px] tnum text-muted">
                    {row.budgetHours === null ? "—" : `${formatNumber(row.budgetHours)} h`}
                  </span>
                  <span className="w-32 text-right font-mono text-[13px] tnum text-muted">
                    {formatMoney(row.budgetCost, project.currency)}
                  </span>
                  {mayEdit ? (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                      Bearbeiten
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[13px]">
              <span className="text-muted">
                {scoped.length} von {project.disciplines.length} Gewerken beauftragt
              </span>
              <span
                className={
                  total > 100 ? "font-medium text-brand-bronze" : "text-muted"
                }
              >
                Honoraranteile insgesamt: <span className="font-mono tnum">{total.toFixed(1)}%</span>
                {total > 100 ? " — über 100% braucht es eine ausdrückliche Freigabe" : ""}
              </span>
            </div>
          </>
        ) : (
          <EmptyState
            title="Noch keine Gewerke"
            description="Welche Fachbereiche dieses Projekt umfasst, entscheidet, wer Pläne, Mängel und Stunden darauf buchen kann."
          />
        )}
      </Card>

      {editing ? (
        <ScopeDialog
          project={project}
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Beauftragen or correct one Gewerk.
 *
 * One dialog for both, because the endpoint is one `PUT` that upserts on
 * `(projectId, disciplineId)` — a Gewerk is either in scope or it is not, and
 * the interaction is "make this the state" rather than "append a row". A
 * separate create and edit would be two forms describing one operation.
 */
function ScopeDialog({
  project,
  existing,
  onClose,
}: {
  project: ProjectDetail;
  existing: ProjectDiscipline | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const mutations = useProjectMutations();
  const options = useDisciplineOptions();

  const ids = {
    discipline: useId(),
    lead: useId(),
    status: useId(),
    fee: useId(),
    hours: useId(),
    cost: useId(),
    rate: useId(),
    note: useId(),
  };

  const [disciplineId, setDisciplineId] = useState(existing?.discipline.id ?? "");
  const [lead, setLead] = useState<EntityOption | null>(
    existing?.leadEngineer
      ? { value: existing.leadEngineer.id, label: existing.leadEngineer.name }
      : null,
  );
  const [status, setStatus] = useState(existing?.status ?? "PLANNED");
  const [feeShare, setFeeShare] = useState(existing?.feeShare?.toString() ?? "");
  const [budgetHours, setBudgetHours] = useState(existing?.budgetHours?.toString() ?? "");
  const [budgetCost, setBudgetCost] = useState(existing?.budgetCost ?? "");
  const [hourlyRate, setHourlyRate] = useState(existing?.hourlyRate ?? "");
  const [override, setOverride] = useState(existing?.feeShareOverride ?? false);
  const [note, setNote] = useState(existing?.scopeNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The total *with this row's new value substituted*, not added to it.
   *
   * The same arithmetic the server does, and for the same reason: lowering one
   * Gewerk's share from 60 to 30 must not be refused because 60 plus the others
   * already exceeded 100.
   */
  const others = project.disciplines
    .filter((row) => row.discipline.id !== disciplineId)
    .reduce((sum, row) => sum + (row.feeShare ?? 0), 0);
  const projected = others + (Number(feeShare) || 0);

  /**
   * Proposals from the master data, not defaults.
   *
   * `defaultBudgetShare` is the firm's own experience of how a fee splits
   * across Gewerke, which is what makes a new project's budget breakdown a
   * starting point rather than an empty form. It fills the field only when the
   * field is empty, so it can never overwrite something somebody typed.
   */
  const proposal = options.data?.find((option) => option.id === disciplineId);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await mutations.scopeDiscipline(project.id, {
        disciplineId,
        status,
        leadEngineerId: lead?.value ?? null,
        feeShare: feeShare === "" ? null : Number(feeShare),
        feeShareOverride: override,
        budgetHours: budgetHours === "" ? null : Number(budgetHours),
        budgetCost: budgetCost || null,
        hourlyRate: hourlyRate || null,
        scopeNote: note.trim() || null,
      });
      toast.success("Gespeichert");
      onClose();
    } catch (err) {
      setError(toFailure(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={existing ? `${existing.discipline.name} bearbeiten` : "Gewerk beauftragen"}
      description="Umfang, Fachverantwortung und Budget dieses Gewerks auf diesem Projekt."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={() => void submit()} busy={busy} disabled={!disciplineId}>
            Speichern
          </Button>
        </>
      }
    >
      <Form onSubmit={() => void submit()} error={error}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gewerk" htmlFor={ids.discipline}>
            <Select
              id={ids.discipline}
              value={disciplineId}
              // Disabled when editing: the pair is the row's identity, and
              // changing it would silently move a budget from one Gewerk to
              // another rather than correcting this one.
              disabled={Boolean(existing)}
              onChange={(e) => {
                const next = e.target.value;
                setDisciplineId(next);
                const option = options.data?.find((o) => o.id === next);
                if (option && feeShare === "" && option.defaultBudgetShare !== null) {
                  setFeeShare((option.defaultBudgetShare * 100).toFixed(1));
                }
                if (option && hourlyRate === "" && option.defaultHourlyRate) {
                  setHourlyRate(option.defaultHourlyRate);
                }
                if (option && !lead && option.manager) {
                  setLead({ value: option.manager.id, label: option.manager.name });
                }
              }}
              placeholder="Gewerk wählen …"
              options={(options.data ?? []).map((o) => ({
                value: o.id,
                label: `${o.code} · ${o.name}`,
              }))}
            />
          </Field>

          <Field label="Status" htmlFor={ids.status}>
            <Select
              id={ids.status}
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              options={SCOPE_STATUS_OPTIONS}
            />
          </Field>

          <Field
            label="Fachverantwortung"
            htmlFor={ids.lead}
            optional
            hint={
              proposal?.manager
                ? `Vorschlag aus den Stammdaten: ${proposal.manager.name}`
                : undefined
            }
            className="sm:col-span-2"
          >
            <EntityPicker
              id={ids.lead}
              value={lead?.value ?? null}
              selected={lead}
              onChange={(_next, option) => setLead(option)}
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

          <Field
            label="Honoraranteil %"
            htmlFor={ids.fee}
            optional
            hint={`Übrige Gewerke: ${others.toFixed(1)}% · zusammen ${projected.toFixed(1)}%`}
          >
            <Input
              id={ids.fee}
              type="number"
              min={0}
              max={200}
              step="0.1"
              value={feeShare}
              onChange={(e) => setFeeShare(e.target.value)}
              invalid={projected > 100 && !override}
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

          <Field label="Budget" htmlFor={ids.cost} optional hint="Format 1234.50">
            <Input
              id={ids.cost}
              value={budgetCost}
              onChange={(e) => setBudgetCost(e.target.value)}
              inputMode="decimal"
            />
          </Field>

          <Field
            label="Stundensatz"
            htmlFor={ids.rate}
            optional
            hint={
              proposal?.defaultHourlyRate
                ? `Standard: ${formatMoney(proposal.defaultHourlyRate)}`
                : undefined
            }
          >
            <Input
              id={ids.rate}
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              inputMode="decimal"
            />
          </Field>
        </div>

        {projected > 100 ? (
          <Checkbox
            checked={override}
            onChange={setOverride}
            label={`Über 100% ausdrücklich freigeben (zusammen ${projected.toFixed(1)}%)`}
            hint="Bei vergebenem Umfang legitim — die Freigabe hält fest, dass es eine Entscheidung war und kein Tippfehler."
          />
        ) : null}

        <Field label="Bemerkung zum Umfang" htmlFor={ids.note} optional>
          <Textarea
            id={ids.note}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Was in diesem Gewerk enthalten ist — und was nicht."
          />
        </Field>
      </Form>
    </Modal>
  );
}
