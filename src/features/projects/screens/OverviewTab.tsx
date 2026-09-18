import type { ProjectDetail } from "@/entities/project";
import { ProjectHealthDot, phaseLabel, priorityLabel } from "@/entities/project";
import { Card } from "@/shared/ui/primitives";
import { Pair } from "@/shared/ui/data";
import { formatDate, formatMoney, formatNumber } from "@/shared/utils/format";
import { daysUntil, disciplinesWithoutLead, hoursAllocated, nextMilestone, overdueMilestones } from "../service";

/**
 * What a Projektleiter wants on opening the project.
 *
 * Three cards: what it is, where it stands, and what is wrong. The third one is
 * the reason this tab is not a property list — "there is no Elektro lead" and
 * "two milestones are overdue" are the facts somebody opens a project to find,
 * and a table of twenty fields buries both.
 *
 * Every number here comes from `service.ts` rather than from an expression in
 * the JSX, which is what makes them testable. The two the *server* derives —
 * `health` and `progressPercent` — are read as given: a second copy of either
 * on the client is one that goes stale, because nothing fails when it does.
 */
export function OverviewTab({ project }: { project: ProjectDetail }) {
  const next = nextMilestone(project.milestones);
  const overdue = overdueMilestones(project.milestones);
  const withoutLead = disciplinesWithoutLead(project);
  const hours = hoursAllocated(project);
  const daysLeft = daysUntil(project.plannedEndDate);

  const attention: string[] = [];
  if (!project.manager) attention.push("Dem Projekt ist keine Projektleitung zugewiesen.");
  if (overdue.length) {
    attention.push(
      overdue.length === 1
        ? `Der Meilenstein „${overdue[0].name}“ ist überfällig.`
        : `${overdue.length} Meilensteine sind überfällig.`,
    );
  }
  if (withoutLead.length) {
    attention.push(
      `Ohne Fachverantwortung: ${withoutLead.map((d) => d.discipline.name).join(", ")}.`,
    );
  }
  if (daysLeft !== null && daysLeft < 0 && project.status === "ACTIVE") {
    attention.push(`Das geplante Ende liegt ${Math.abs(daysLeft)} Tage zurück.`);
  }
  if (hours.ratio !== null && hours.ratio > 1) {
    attention.push(
      `Die Gewerke planen ${formatNumber(hours.planned)} h gegen ein Budget von ${formatNumber(hours.budget!)} h.`,
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Auftrag">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Pair label="Bauherrschaft">{project.customer?.name ?? "—"}</Pair>
          <Pair label="Architektur">{project.architect?.name ?? "—"}</Pair>
          <Pair label="Objekt">
            {project.building ? (
              <span>
                {project.building.name}
                {project.building.city ? (
                  <span className="text-muted"> · {project.building.city}</span>
                ) : null}
              </span>
            ) : (
              "—"
            )}
          </Pair>
          <Pair label="Standort">{project.office?.name ?? "—"}</Pair>
          <Pair label="Projektleitung">
            {project.manager ? project.manager.name : <span className="text-muted">offen</span>}
          </Pair>
          <Pair label="Priorität">{priorityLabel(project.priority)}</Pair>
          <Pair label="Auftragswert">{formatMoney(project.contractValue, project.currency)}</Pair>
          <Pair label="Sollstunden">
            {project.budgetHours === null ? "—" : `${formatNumber(project.budgetHours)} h`}
          </Pair>
        </dl>
        {project.description ? (
          <p className="mt-4 max-w-prose text-[14px] leading-relaxed text-muted">
            {project.description}
          </p>
        ) : null}
      </Card>

      <Card title="Stand">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Pair label="Zustand">
            <ProjectHealthDot health={project.health} />
          </Pair>
          <Pair label="Fortschritt">
            {/*
              The figure, then the bar. `aria-hidden` on the bar because the
              number beside it already says the same thing, and a progressbar
              role would announce it twice.
            */}
            <span className="flex items-center gap-2">
              <span className="font-mono tnum">{project.progressPercent}%</span>
              <span aria-hidden className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${project.progressPercent}%` }}
                />
              </span>
            </span>
          </Pair>
          <Pair label="Phase">{phaseLabel(project.currentPhase)}</Pair>
          <Pair label="Start">{formatDate(project.startDate)}</Pair>
          <Pair label="Geplantes Ende">
            {formatDate(project.plannedEndDate)}
            {daysLeft !== null && project.status === "ACTIVE" ? (
              <span className="ml-2 text-[13px] text-muted">
                {daysLeft >= 0 ? `noch ${daysLeft} T.` : `${Math.abs(daysLeft)} T. überfällig`}
              </span>
            ) : null}
          </Pair>
          <Pair label="Tatsächliches Ende">{formatDate(project.actualEndDate)}</Pair>
          <Pair label="Nächster Meilenstein">
            {next ? (
              <span>
                {next.name}
                <span className="text-muted"> · {formatDate(next.dueDate)}</span>
              </span>
            ) : (
              <span className="text-muted">keiner offen</span>
            )}
          </Pair>
          <Pair label="Stunden verplant">
            {hours.budget === null ? (
              <span className="text-muted">kein Budget hinterlegt</span>
            ) : (
              `${formatNumber(hours.planned)} von ${formatNumber(hours.budget)} h`
            )}
          </Pair>
        </dl>
        {/*
          Stated once, where it is: `health` and `progressPercent` are computed
          on the server and recomputed nightly. Saying so on the screen stops
          somebody looking for the field to edit.
        */}
        <p className="mt-4 text-[12px] text-muted">
          Zustand und Fortschritt werden aus den Meilensteinen und den Terminen berechnet und
          nächtlich neu bewertet. Sie sind kein Eingabefeld.
        </p>
      </Card>

      <Card title="Aufmerksamkeit" className="lg:col-span-2">
        {attention.length ? (
          <ul className="flex flex-col gap-2">
            {attention.map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-[14px]">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-bronze" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted">
            Nichts Offenes. Termine, Gewerke und Zuständigkeiten sind vollständig.
          </p>
        )}
      </Card>

      {project.notes ? (
        <Card title="Interne Notizen" className="lg:col-span-2">
          {/*
            `whitespace-pre-wrap`: the field is a textarea and people put line
            breaks in it. Collapsing them turns a list of points into a
            paragraph.
          */}
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{project.notes}</p>
        </Card>
      ) : null}
    </div>
  );
}
