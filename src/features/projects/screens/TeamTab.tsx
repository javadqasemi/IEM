import { useId, useState } from "react";
import { useAuth } from "@/core/auth";
import {
  MEMBER_ROLE_OPTIONS,
  memberRoleLabel,
  type MemberRole,
  type ProjectDetail,
} from "@/entities/project";
import { Badge, Button, Card, EmptyState } from "@/shared/ui/primitives";
import { ConfirmDialog } from "@/shared/ui/overlays";
import { DateInput, EntityPicker, Field, Input, Select, type EntityOption } from "@/shared/ui/forms";
import { useToast } from "@/shared/ui/feedback";
import { formatDate, parseDateInput } from "@/shared/utils/format";
import { useProjectMutations } from "../hooks/useProjects";
import { projectRepository } from "../repository";
import { toEmployeeOption } from "../mapper";
import { teamOf } from "../service";

/**
 * Who is on the project.
 *
 * **The Projektleitung is not a member row.** It is `Project.managerId`, and
 * the team tab has to compose the two — leaving them out because the schema
 * keeps them elsewhere would be the data model leaking onto the page. They are
 * shown first, marked, and cannot be removed here: changing the manager is an
 * edit to the project, and the status rules depend on it.
 *
 * Allocation is a share of that person's Pensum, not of the project. "60% auf
 * diesem Projekt" is what a Swiss engineering office plans with, and summing
 * the column to more than 100 is meaningful rather than wrong — it is several
 * people.
 */
export function TeamTab({ project, readOnly }: { project: ProjectDetail; readOnly: boolean }) {
  const toast = useToast();
  const { can } = useAuth();
  const mutations = useProjectMutations();
  const { manager, members } = teamOf(project);

  const ids = { person: useId(), role: useId(), allocation: useId(), from: useId() };
  const [person, setPerson] = useState<EntityOption | null>(null);
  const [role, setRole] = useState<MemberRole>("ENGINEER");
  const [allocation, setAllocation] = useState("100");
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  const mayEdit = can("project.manageTeam") && !readOnly;

  async function add() {
    if (!person) return;
    setBusy(true);
    try {
      await mutations.addMember(project.id, {
        employeeId: person.value,
        role,
        allocationPercent: Number(allocation) || 100,
        from: parseDateInput(from),
      });
      setPerson(null);
      setAllocation("100");
      setFrom("");
      toast.success("Zum Team hinzugefügt");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Nicht möglich.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Team"
        description={`${members.length + (manager ? 1 : 0)} Personen auf diesem Projekt.`}
      >
        {manager || members.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {manager ? (
              <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{manager.name}</span>
                    <Badge tone="navy">Projektleitung</Badge>
                  </div>
                  <p className="text-[12px] text-muted">{manager.email}</p>
                </div>
                {/*
                  No remove button, and the sentence says why rather than the
                  control simply being absent — an action that is missing with
                  no explanation reads as a bug.
                */}
                <span className="text-[12px] text-muted">
                  Wird über die Projektdaten geändert
                </span>
              </li>
            ) : null}

            {members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{member.employee.name}</span>
                  <p className="text-[12px] text-muted">
                    {member.employee.position ?? member.employee.email}
                  </p>
                </div>
                <span className="text-[13px]">{memberRoleLabel(member.role)}</span>
                <span className="font-mono text-[13px] tnum text-muted">
                  {member.allocationPercent}%
                </span>
                <span className="text-[12px] text-muted">
                  seit {formatDate(member.from)}
                  {member.to ? ` bis ${formatDate(member.to)}` : ""}
                </span>
                {mayEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRemoving({ id: member.id, name: member.employee.name })}
                  >
                    Entfernen
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Noch niemand zugewiesen"
            description="Ein Projekt ohne Team ist ein Projekt, an dem niemand arbeitet."
          />
        )}
      </Card>

      {mayEdit ? (
        <Card title="Person hinzufügen">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Person" htmlFor={ids.person} className="sm:col-span-2">
              <EntityPicker
                id={ids.person}
                value={person?.value ?? null}
                selected={person}
                onChange={(_next, option) => setPerson(option)}
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
            <Field label="Rolle" htmlFor={ids.role}>
              <Select
                id={ids.role}
                value={role}
                onChange={(e) => setRole(e.target.value as MemberRole)}
                options={MEMBER_ROLE_OPTIONS}
              />
            </Field>
            <Field label="Pensum auf dem Projekt" htmlFor={ids.allocation}>
              <Input
                id={ids.allocation}
                type="number"
                min={1}
                max={100}
                value={allocation}
                onChange={(e) => setAllocation(e.target.value)}
              />
            </Field>
            <Field label="Ab" htmlFor={ids.from} optional hint="Leer bedeutet ab heute.">
              <DateInput id={ids.from} value={from} onChange={setFrom} />
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => void add()} busy={busy} disabled={!person}>
              Hinzufügen
            </Button>
          </div>
        </Card>
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Aus dem Team entfernen?"
        message={
          removing
            ? `${removing.name} wird von diesem Projekt genommen. Erfasste Stunden und Zuweisungen bleiben erhalten.`
            : ""
        }
        confirmLabel="Entfernen"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await mutations.removeMember(project.id, removing.id);
            toast.success("Entfernt");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Nicht möglich.");
          } finally {
            setRemoving(null);
          }
        }}
      />
    </div>
  );
}
