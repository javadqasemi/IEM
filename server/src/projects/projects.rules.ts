import { MilestoneStatus, ProjectHealth, ProjectStatus } from "@prisma/client";

/**
 * What a project is allowed to do, and what its derived numbers are.
 *
 * **Pure.** No Prisma client, no Nest injection, nothing async. Every rule
 * below is reachable from a test with a constructed object, which is the point:
 * the transitions, the two derived figures and the fee-share arithmetic are
 * where this module's bugs will be, and a test that needed Postgres to reach
 * them would be testing Postgres.
 *
 * It is also the file the other eighteen modules copy the *shape* of. The rule
 * being demonstrated is that domain logic is a function of its inputs — not a
 * method on a service that happens to have a `PrismaService` in scope. A rule
 * written as a method drifts into reading one more row, and then it cannot be
 * tested without a database and stops being tested at all.
 */

/* ================================================================== */
/* The status machine                                                  */
/* ================================================================== */

/**
 * `PLANNED → ACTIVE → (ON_HOLD ↔ ACTIVE) → COMPLETED → ARCHIVED`, with
 * `CANCELLED` reachable from the three live states.
 *
 * A table rather than a `switch`, because it is data the UI needs too: the
 * status dropdown offers exactly `transitionsFrom(current)`, so an option that
 * the server would refuse is never drawn. A `switch` would have needed the same
 * knowledge expressed a second time on the client.
 *
 * **`COMPLETED → ACTIVE` is deliberately absent.** Reopening a finished project
 * is a real thing that happens, and it is a *new commission on the same
 * building* — which the building entity exists to make cheap. Allowing the
 * status to walk backwards would silently reuse the first project's budget,
 * hours and invoices for the second one's work.
 */
export const PROJECT_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  PLANNED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["ACTIVE", "CANCELLED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
  CANCELLED: ["ARCHIVED"],
};

export function transitionsFrom(status: ProjectStatus): readonly ProjectStatus[] {
  return PROJECT_TRANSITIONS[status];
}

/** `ARCHIVED` is read-only everywhere; `CANCELLED` keeps its record but takes no more work. */
export function isTerminal(status: ProjectStatus): boolean {
  return status === ProjectStatus.ARCHIVED;
}

export type TransitionInput = {
  managerId: string | null;
  startDate: Date | null;
  milestones: readonly { status: MilestoneStatus }[];
};

/**
 * Why a transition is refused, or `null` if it is allowed.
 *
 * Returns the reason rather than throwing, and returns *German* rather than a
 * code. The caller is a service that turns it into a `BadRequestException`, but
 * the same function backs the client's disabled-button tooltip — and a rule
 * that can only express itself as an exception cannot explain itself before the
 * user presses the button.
 */
export function refuseTransition(
  from: ProjectStatus,
  to: ProjectStatus,
  input: TransitionInput,
): string | null {
  if (from === to) return null;

  if (!PROJECT_TRANSITIONS[from].includes(to)) {
    const allowed = PROJECT_TRANSITIONS[from];
    if (!allowed.length) return "Ein archiviertes Projekt kann nicht mehr geändert werden.";
    // "A, B oder C", not "A oder B oder C" — the message is read by an editor,
    // and a list joined with the wrong word reads as a machine talking.
    const list =
      allowed.length === 1
        ? allowed[0]
        : `${allowed.slice(0, -1).join(", ")} oder ${allowed[allowed.length - 1]}`;
    return `Ein Projekt im Status ${from} kann nur nach ${list} wechseln.`;
  }

  /*
    The two lifecycle preconditions from `docs/data-model.md` §3.8.

    They are checked here and not by the database, and the schema says why: a
    manager leaving must not cascade away their projects, so `managerId` is
    nullable at the column. "Required" is a property of being *active*, not of
    the row existing — which is exactly the kind of rule a NOT NULL cannot
    express and a status machine can.
  */
  if (to === ProjectStatus.ACTIVE) {
    if (!input.managerId) return "Ein aktives Projekt braucht eine Projektleitung.";
    if (!input.startDate) return "Ein aktives Projekt braucht ein Startdatum.";
  }

  if (to === ProjectStatus.COMPLETED) {
    const open = input.milestones.filter(
      (m) => m.status !== MilestoneStatus.MET && m.status !== MilestoneStatus.WAIVED,
    ).length;
    if (open) {
      return `${open} Meilenstein(e) sind weder erreicht noch ausdrücklich erlassen.`;
    }
  }

  return null;
}

/* ================================================================== */
/* The derived figures                                                 */
/* ================================================================== */

/**
 * Progress, from milestone completion.
 *
 * `WAIVED` counts as done and `MISSED` does not, which is the distinction the
 * status enum exists for: a waived milestone was a decision, a missed one is
 * still outstanding work. Counting them the same way would let a project reach
 * 100% by missing everything.
 *
 * A project with no milestones is 0 and not 100. An empty plan is the start of
 * a project, not the end of one, and the alternative reads as "finished" on
 * every list the day it is created.
 */
export function deriveProgress(milestones: readonly { status: MilestoneStatus }[]): number {
  if (!milestones.length) return 0;
  const done = milestones.filter(
    (m) => m.status === MilestoneStatus.MET || m.status === MilestoneStatus.WAIVED,
  ).length;
  return Math.round((done / milestones.length) * 100);
}

export type HealthInput = {
  status: ProjectStatus;
  progressPercent: number;
  startDate: Date | null;
  plannedEndDate: Date | null;
  milestones: readonly { status: MilestoneStatus; dueDate: Date }[];
  now?: Date;
};

/**
 * Health: green, amber or red.
 *
 * **The rule is elapsed time against progress**, plus the milestones that have
 * already gone wrong. Budget burn belongs in it too and is deliberately not
 * here yet — time entries are Wave 2 module 14, and a health figure that
 * pretended to include a number it cannot see would be worse than one that
 * documents what it weighs.
 *
 * The thresholds are the firm's, not arithmetic: more than 15 points behind
 * schedule is the point at which a Projektleiter starts explaining, and 30 is
 * the point at which somebody else needs to know.
 */
export function deriveHealth(input: HealthInput): ProjectHealth {
  const now = input.now ?? new Date();

  // A finished project has no health to report. Leaving it on whatever it was
  // the day it completed means an archived list permanently full of red rows
  // describing problems that are over.
  if (
    input.status === ProjectStatus.COMPLETED ||
    input.status === ProjectStatus.ARCHIVED ||
    input.status === ProjectStatus.CANCELLED
  ) {
    return ProjectHealth.GREEN;
  }

  // A missed milestone is a fact, not a projection, and it outranks the
  // schedule estimate below — a project can be ahead on elapsed time and still
  // have failed a contracted date.
  if (input.milestones.some((m) => m.status === MilestoneStatus.MISSED)) {
    return ProjectHealth.RED;
  }

  const overdue = input.milestones.filter(
    (m) =>
      m.dueDate.getTime() < now.getTime() &&
      m.status !== MilestoneStatus.MET &&
      m.status !== MilestoneStatus.WAIVED,
  ).length;
  if (overdue >= 2) return ProjectHealth.RED;

  const expected = expectedProgress(input.startDate, input.plannedEndDate, now);
  if (expected === null) {
    // No dates means nothing to be behind. `AT_RISK` milestones are still
    // worth an amber, because somebody has already flagged them by hand.
    return input.milestones.some((m) => m.status === MilestoneStatus.AT_RISK) || overdue
      ? ProjectHealth.AMBER
      : ProjectHealth.GREEN;
  }

  const behind = expected - input.progressPercent;
  if (behind > 30) return ProjectHealth.RED;
  if (behind > 15 || overdue) return ProjectHealth.AMBER;
  if (input.milestones.some((m) => m.status === MilestoneStatus.AT_RISK)) return ProjectHealth.AMBER;
  return ProjectHealth.GREEN;
}

/**
 * Where a project *should* be, as a share of its planned duration.
 *
 * `null` when it cannot be known — no dates, or a planned end that is not after
 * the start. Returning 0 for "unknown" would mark every dateless project
 * healthy, and returning 100 would mark them all red; a nullable answer forces
 * the caller to decide, which it does above.
 */
export function expectedProgress(
  startDate: Date | null,
  plannedEndDate: Date | null,
  now: Date,
): number | null {
  if (!startDate || !plannedEndDate) return null;
  const span = plannedEndDate.getTime() - startDate.getTime();
  if (span <= 0) return null;
  const elapsed = now.getTime() - startDate.getTime();
  return Math.min(100, Math.max(0, Math.round((elapsed / span) * 100)));
}

/* ================================================================== */
/* Validation that is not a transition                                 */
/* ================================================================== */

/** `plannedEndDate` after `startDate` — the one date rule the schema cannot hold. */
export function refuseDates(startDate: Date | null, plannedEndDate: Date | null): string | null {
  if (!startDate || !plannedEndDate) return null;
  return plannedEndDate.getTime() > startDate.getTime()
    ? null
    : "Das geplante Ende muss nach dem Start liegen.";
}

/**
 * The fee shares across a project's Gewerke.
 *
 * May exceed 100% **only** with an explicit override on at least one row, and
 * that is not a loophole: subcontracted scope legitimately pushes the total
 * past the fee, and a rule that refused it outright would make the honest case
 * impossible to record. Requiring the flag means the number is a decision
 * somebody made rather than a typo nobody caught.
 */
export function refuseFeeShares(
  rows: readonly { feeShare: number | null; feeShareOverride: boolean }[],
): string | null {
  const total = rows.reduce((sum, row) => sum + (row.feeShare ?? 0), 0);
  if (total <= 100) return null;
  if (rows.some((row) => row.feeShareOverride)) return null;
  return `Die Honoraranteile ergeben ${total.toFixed(1)}%. Über 100% braucht es eine ausdrückliche Freigabe.`;
}

/* ================================================================== */
/* The business key                                                    */
/* ================================================================== */

/** `P-2026-014` — the firm's own project number. */
export function formatProjectNumber(year: number, sequence: number): string {
  return `P-${year}-${String(sequence).padStart(3, "0")}`;
}

/**
 * The next sequence for a year, from the numbers already issued.
 *
 * Derived from the **maximum**, not from the count. A deleted or cancelled
 * project still consumed its number — it is on drawings, in e-mails and on
 * invoices — and counting rows would hand the next project a number that
 * already means something else.
 */
export function nextSequence(existing: readonly string[], year: number): number {
  const prefix = `P-${year}-`;
  let max = 0;
  for (const number of existing) {
    if (!number.startsWith(prefix)) continue;
    const n = Number(number.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}
