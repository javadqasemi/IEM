import type {
  Milestone,
  Project,
  ProjectDetail,
  ProjectDiscipline,
  ProjectStatus,
} from "@/entities/project";

/**
 * Domain only. Pure functions over entity types — no React, no fetch, and
 * therefore testable with no mocks at all.
 *
 * This is the layer that matters most and the one easiest to skip. Everything
 * here would otherwise be an inline expression in a tab, where it is untestable
 * and where the second tab that needs it writes its own slightly different
 * copy.
 *
 * **What is deliberately not here.** The status transitions and the two derived
 * figures. `allowedTransitions` arrives *with* the record because the server
 * decides it, and `progressPercent` and `health` are computed there and stored.
 * A second copy of either on the client is a copy that goes stale, because
 * nothing fails when it does — see `docs/data-model.md` §3.8. What follows is
 * presentation logic the server has no reason to compute and the screens have
 * every reason not to duplicate.
 */

/** Whether anything may still be edited. `ARCHIVED` is read-only everywhere. */
export function isReadOnly(project: Pick<Project, "status">): boolean {
  return project.status === "ARCHIVED";
}

const LIVE: readonly ProjectStatus[] = ["PLANNED", "ACTIVE", "ON_HOLD"];

/** Live work, as opposed to a record being kept. Drives the default filter. */
export function isLive(status: ProjectStatus): boolean {
  return LIVE.includes(status);
}

/**
 * Days until the planned end — negative once it has passed.
 *
 * Whole days from midnight, not from *now*: "due in 0 days" has to mean today
 * all day, and a millisecond difference deciding between "today" and
 * "yesterday" is how a deadline badge flickers at lunchtime.
 */
export function daysUntil(date: Date | null, now: Date = new Date()): number | null {
  if (!date) return null;
  const start = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((start - today) / 86_400_000);
}

export function isOverdue(project: Pick<Project, "plannedEndDate" | "status">, now?: Date): boolean {
  if (!isLive(project.status as ProjectStatus)) return false;
  const days = daysUntil(project.plannedEndDate, now);
  return days !== null && days < 0;
}

/**
 * The milestone a reader should look at next.
 *
 * The earliest one still outstanding — `MET` and `WAIVED` are settled, and a
 * `MISSED` one is still outstanding work, which is the distinction the status
 * enum exists for. `null` when the plan is complete or empty, and the tab says
 * so in words rather than rendering a blank row.
 */
export function nextMilestone(milestones: readonly Milestone[]): Milestone | null {
  const open = milestones
    .filter((m) => m.status !== "MET" && m.status !== "WAIVED")
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return open[0] ?? null;
}

export function overdueMilestones(
  milestones: readonly Milestone[],
  now: Date = new Date(),
): Milestone[] {
  return milestones.filter(
    (m) => m.status !== "MET" && m.status !== "WAIVED" && (daysUntil(m.dueDate, now) ?? 0) < 0,
  );
}

/**
 * The fee shares, totalled — the same arithmetic the server refuses on.
 *
 * Here so the form can show the running total *while* somebody types, and warn
 * before the request rather than after the 400. It is **not** the rule: the
 * server's `refuseFeeShares` is, and this deliberately returns a number rather
 * than a verdict so it cannot drift into being a second, kinder copy of it.
 */
export function totalFeeShare(disciplines: readonly ProjectDiscipline[]): number {
  return disciplines.reduce((sum, row) => sum + (row.feeShare ?? 0), 0);
}

/** Gewerke actually in scope. `NOT_IN_SCOPE` rows exist to record the decision. */
export function scopedDisciplines(
  disciplines: readonly ProjectDiscipline[],
): ProjectDiscipline[] {
  return disciplines.filter((row) => row.status !== "NOT_IN_SCOPE");
}

/**
 * Hours planned across the Gewerke, against the project's own budget.
 *
 * Returns both rather than the difference: "480 of 2'400 h verplant" is the
 * sentence a Projektleiter reads, and a single delta hides which of the two
 * numbers moved. `null` when the project carries no budget — an unknown budget
 * is not a budget of zero, and rendering 100% over on an empty field is the
 * kind of false alarm that teaches people to ignore the indicator.
 */
export function hoursAllocated(project: ProjectDetail): {
  planned: number;
  budget: number | null;
  ratio: number | null;
} {
  const planned = scopedDisciplines(project.disciplines).reduce(
    (sum, row) => sum + (row.budgetHours ?? 0),
    0,
  );
  const budget = project.budgetHours;
  return {
    planned,
    budget,
    ratio: budget && budget > 0 ? planned / budget : null,
  };
}

/**
 * Whether the team has a lead for every Gewerk in scope.
 *
 * "Which projects have no Elektro lead" is one of the three questions
 * `ProjectDiscipline` was made a table to answer, and this is the single-project
 * half of it.
 */
export function disciplinesWithoutLead(project: ProjectDetail): ProjectDiscipline[] {
  return scopedDisciplines(project.disciplines).filter((row) => !row.leadEngineer);
}

/**
 * Everyone on the project, manager first, then by role and name.
 *
 * The manager is **not** a `ProjectMember` row — they are `Project.managerId`,
 * which is why the team tab has to compose the two. Leaving them out of the
 * team list because the schema keeps them elsewhere would be the data model
 * leaking into the page.
 */
export function teamOf(project: ProjectDetail): {
  manager: ProjectDetail["manager"];
  members: ProjectDetail["members"];
} {
  const members = [...project.members].sort(
    (a, b) =>
      a.role.localeCompare(b.role, "de-CH") || a.employee.name.localeCompare(b.employee.name, "de-CH"),
  );
  return { manager: project.manager, members };
}
