/**
 * What a project *is*, on the client.
 *
 * `entities/` and not `features/projects/`, and the distinction is the one the
 * folder's README makes: a **feature** is a set of screens and the calls behind
 * them; an **entity** is a shape other features will hold. Tasks, meetings,
 * drawings, time entries and invoices are all scoped by project, and every one
 * of them will want to render a project's number, its status badge and its
 * health dot. If that lived in `features/projects` they would each import a
 * feature's internals, which `architecture.test.ts` forbids — correctly.
 *
 * Dates are `Date`, money is `string`. The server sends ISO strings and decimal
 * strings; `features/projects/mapper.ts` is the only place either is converted,
 * and the money stays a string on purpose — a number invites arithmetic, and
 * float arithmetic on Rappen is how a total ends in `.0000000001`.
 */

export const PROJECT_STATUSES = [
  "PLANNED",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
  "CANCELLED",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value);
}

export const PROJECT_HEALTHS = ["GREEN", "AMBER", "RED"] as const;
export type ProjectHealth = (typeof PROJECT_HEALTHS)[number];

export function isProjectHealth(value: string): value is ProjectHealth {
  return (PROJECT_HEALTHS as readonly string[]).includes(value);
}

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** SIA 112. The vocabulary the firm plans in — see `docs/data-model.md` §1.1. */
export const SIA_PHASES = ["P31", "P32", "P33", "P41", "P51", "P52", "P53"] as const;
export type SiaPhase = (typeof SIA_PHASES)[number];

export const MILESTONE_STATUSES = ["OPEN", "AT_RISK", "MET", "MISSED", "WAIVED"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MEMBER_ROLES = [
  "MANAGER",
  "ENGINEER",
  "DRAFTSMAN",
  "CONSULTANT",
  "APPRENTICE",
] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const DISCIPLINE_SCOPE_STATUSES = [
  "PLANNED",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "NOT_IN_SCOPE",
] as const;
export type DisciplineScopeStatus = (typeof DISCIPLINE_SCOPE_STATUSES)[number];

/** A person, reduced to what a list row shows. */
export type PersonRef = {
  id: string;
  name: string;
  email: string;
};

export type CustomerRef = { id: string; number: string; name: string };
export type BuildingRef = { id: string; number: string; name: string; city: string | null };
export type OfficeRef = { id: string; name: string };

export type Project = {
  id: string;
  number: string;
  name: string;
  status: ProjectStatus;
  priority: Priority;
  /** Derived on the server. Never edited here — see the schema's note. */
  health: ProjectHealth;
  progressPercent: number;
  currentPhase: SiaPhase | null;
  startDate: Date | null;
  plannedEndDate: Date | null;
  actualEndDate: Date | null;
  /** A decimal string, e.g. `"1450000.00"`. Format it; do not add it up. */
  contractValue: string | null;
  currency: string;
  budgetHours: number | null;
  /**
   * The record's own revision — P-2026-014 v12 (F13).
   *
   * Carried on every row, not only on the detail, because an edit has to send
   * back the version it read. A version available only on the detail would
   * make every inline edit fetch the record first, and that fetch is the
   * window the lock exists to close.
   */
  version: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  archivedAt: Date | null;
  customer: CustomerRef | null;
  building: BuildingRef | null;
  manager: PersonRef | null;
  office: OfficeRef | null;
};

export type ProjectMember = {
  id: string;
  role: MemberRole;
  allocationPercent: number;
  from: Date | null;
  to: Date | null;
  employee: PersonRef & { position: string | null };
};

export type ProjectDiscipline = {
  id: string;
  status: DisciplineScopeStatus;
  /** Percent of the project fee. A ratio, so a number — unlike money. */
  feeShare: number | null;
  feeShareOverride: boolean;
  budgetHours: number | null;
  budgetCost: string | null;
  hourlyRate: string | null;
  scopeNote: string | null;
  discipline: {
    id: string;
    code: string;
    name: string;
    /** A **token name**, resolved per theme. Never a hex literal. */
    colour: string;
  };
  leadEngineer: PersonRef | null;
};

export type Milestone = {
  id: string;
  name: string;
  dueDate: Date;
  metAt: Date | null;
  status: MilestoneStatus;
  phase: SiaPhase | null;
  /** What connects planning to finance — `docs/data-model.md` §3.10. */
  isBillingTrigger: boolean;
};

export type ProjectDetail = Project & {
  description: string | null;
  notes: string | null;
  architect: CustomerRef | null;
  members: ProjectMember[];
  disciplines: ProjectDiscipline[];
  milestones: Milestone[];
  /**
   * What this project may become, right now, **decided by the server**.
   *
   * Sent with the record rather than computed here on purpose. The transition
   * table and its preconditions live in `server/src/projects/projects.rules.ts`;
   * a second copy on the client is a copy that goes stale, because nothing
   * fails when it does — the dropdown simply starts offering something the API
   * refuses, and the user finds out by pressing the button.
   */
  allowedTransitions: ProjectStatus[];
};

export type ProjectStats = {
  total: number;
  byStatus: Record<ProjectStatus, number>;
};

/* ================================================================== */
/* What a screen submits                                               */
/* ================================================================== */

/**
 * The **entity-shaped** inputs, and the reason they exist at all.
 *
 * > DTOs gehören nur Repository + Mapper. Die UI kennt niemals DTOs.
 *
 * The rule the firm set, and `architecture.test.ts` enforces it — it is what
 * caught the first version of the hooks, which passed `CreateProjectBody`
 * straight through from a screen. That looks harmless and it is the exact point
 * at which the layering stops being real: once a screen names a wire type, an
 * API change reaches the screen.
 *
 * So these are the domain's own shapes. Dates are `Date`, statuses are the
 * closed unions, and `features/projects/mapper.ts` is the only thing that turns
 * them into a request body. They live in `entities/` rather than in the feature
 * because a form in another module — a meeting that creates a follow-up
 * project — would need the same shape without importing the feature.
 *
 * Money stays a **string** on the way in as well as out. A number field invites
 * float arithmetic, and the server refuses anything that is not `1234.50`.
 */
export type ProjectDraft = {
  name: string;
  customerId: string;
  architectId?: string | null;
  buildingId?: string | null;
  managerId?: string | null;
  officeId?: string | null;
  priority?: Priority;
  startDate?: Date | null;
  plannedEndDate?: Date | null;
  contractValue?: string | null;
  budgetHours?: number | null;
  description?: string | null;
  notes?: string | null;
};

/**
 * An edit.
 *
 * **`status` and `customerId` are absent**, and both deliberately. A status
 * change is a transition with preconditions, its own permission and its own
 * event, so it has its own shape below. Moving a project to another client is a
 * commercial act with invoices attached, not a field edit. The server refuses
 * both; the type refuses them first, where the compiler can say so.
 */
export type ProjectEdit = Partial<Omit<ProjectDraft, "customerId">> & {
  currentPhase?: SiaPhase | null;
  actualEndDate?: Date | null;
  /**
   * The version the screen was showing. **Required** (F13).
   *
   * Not optional, and the type is where that is enforced first: a caller who
   * cannot supply it has not read the record, and one who has read it holds it.
   * The server refuses a body without it, but a compile error is a better place
   * to find out than a 400.
   */
  expectedVersion: number;
  /** Why, for the history. Only a person can supply this. */
  versionNote?: string;
};

/** One recorded state of a project, as the history lists it. */
export type ProjectVersion = {
  id: string;
  version: number;
  /** The rendered form — `v7`. Stored, so a list needs no lookup. */
  label: string;
  /** Which fields the writer touched, for a one-line summary. */
  changed: string[];
  note: string | null;
  changedById: string | null;
  changedByEmail: string | null;
  changedByName: string | null;
  correlationId: string | null;
  createdAt: Date;
};

export type StatusChange = {
  status: ProjectStatus;
  /** Recorded on the event, so the audit row explains a hold or a cancellation. */
  reason?: string;
};

export type MemberDraft = {
  employeeId: string;
  role?: MemberRole;
  allocationPercent?: number;
  from?: Date | null;
  to?: Date | null;
};

export type DisciplineScopeDraft = {
  disciplineId: string;
  status?: DisciplineScopeStatus;
  leadEngineerId?: string | null;
  feeShare?: number | null;
  feeShareOverride?: boolean;
  budgetHours?: number | null;
  budgetCost?: string | null;
  hourlyRate?: string | null;
  scopeNote?: string | null;
};

export type MilestoneDraft = {
  name: string;
  dueDate: Date;
  phase?: SiaPhase | null;
  isBillingTrigger?: boolean;
};

export type MilestoneEdit = Partial<MilestoneDraft> & { status?: MilestoneStatus };

/** The pickers a project form needs. Thin by design — see the server's slices. */
export type CustomerOption = { id: string; number: string; name: string; city: string | null };
export type BuildingOption = {
  id: string;
  number: string;
  name: string;
  city: string | null;
  customerId: string;
};
export type EmployeeOption = { id: string; name: string; email: string; position: string | null };
export type DisciplineOption = {
  id: string;
  code: string;
  name: string;
  colour: string;
  defaultBudgetShare: number | null;
  defaultHourlyRate: string | null;
  manager: PersonRef | null;
};
