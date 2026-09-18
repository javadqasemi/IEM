import type { Paginated } from "@/core/api";
import {
  DISCIPLINE_SCOPE_STATUSES,
  MEMBER_ROLES,
  MILESTONE_STATUSES,
  PRIORITIES,
  PROJECT_HEALTHS,
  PROJECT_STATUSES,
  SIA_PHASES,
  type BuildingOption,
  type CustomerOption,
  type DisciplineScopeDraft,
  type DisciplineOption,
  type DisciplineScopeStatus,
  type EmployeeOption,
  type MemberDraft,
  type MemberRole,
  type Milestone,
  type MilestoneDraft,
  type MilestoneEdit,
  type MilestoneStatus,
  type Priority,
  type Project,
  type ProjectDetail,
  type ProjectDiscipline,
  type ProjectDraft,
  type ProjectEdit,
  type ProjectHealth,
  type ProjectMember,
  type ProjectStats,
  type ProjectStatus,
  type ProjectVersion,
  type SiaPhase,
  type StatusChange,
} from "@/entities/project";
import type {
  AddMemberBody,
  BuildingOptionDto,
  ChangeStatusBody,
  CreateMilestoneBody,
  CreateProjectBody,
  CustomerOptionDto,
  DisciplineOptionDto,
  EmployeeOptionDto,
  MilestoneDto,
  ProjectDetailDto,
  ProjectDisciplineDto,
  ProjectDto,
  ProjectMemberDto,
  ProjectStatsDto,
  ProjectVersionDto,
  ScopeDisciplineBody,
  UpdateMilestoneBody,
  UpdateProjectBody,
} from "./dto";

/**
 * DTO ⇄ entity. **The last file in which a DTO type is legal.**
 *
 * The layer the firm's review added, and the one that makes the split real
 * rather than decorative: without it `repository.ts` returns wire shapes
 * straight into the hooks and the DTO reaches the components anyway.
 *
 * Three translations happen here, and each is a bug that otherwise happens
 * somewhere else:
 *
 * | Wire | Entity | What goes wrong without it |
 * | --- | --- | --- |
 * | `"2026-01-15T…"` | `Date` | `"2026-01-15" < someDate` compares a string to an object and never throws |
 * | open `string` | closed union | a `switch` with no case for a value the server already sends |
 * | `null` date | `null` | `new Date(null)` is 1 January 1970, silently |
 *
 * **`contractValue` is deliberately *not* converted.** It stays the decimal
 * string the server sent. Every other date-looking or number-looking field here
 * is parsed; this one is not, because parsing it is the first step toward
 * adding it up, and float arithmetic on Rappen is the one error this codebase
 * refuses to make. `formatMoney` takes the string and renders it.
 */

/** `null` in, `null` out — `new Date(null)` is the epoch, which is not "unknown". */
function toDate(iso: string): Date;
function toDate(iso: string | null): Date | null;
function toDate(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}

/**
 * Narrows an open string from the server to a closed union.
 *
 * An unrecognised value falls back **and says so in the console**, which is the
 * least-bad of three options. Throwing would blank a list because one row came
 * from a newer server; leaving it a `string` would push the problem into every
 * `switch`; mapping it silently would hide a real deployment skew. The row
 * still renders, the badge falls through to the raw key — every badge in
 * `entities/project` does that deliberately — and the mismatch is visible.
 */
function narrow<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T,
  field: string,
): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  console.warn(
    `[projects] Unbekannter Wert „${value}“ für ${field} — erwartet: ${allowed.join(", ")}`,
  );
  return fallback;
}

function narrowNullable<T extends string>(
  value: string | null,
  allowed: readonly T[],
  field: string,
): T | null {
  if (value === null) return null;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  console.warn(
    `[projects] Unbekannter Wert „${value}“ für ${field} — erwartet: ${allowed.join(", ")}`,
  );
  return null;
}

export function toProject(dto: ProjectDto): Project {
  return {
    id: dto.id,
    number: dto.number,
    name: dto.name,
    status: narrow<ProjectStatus>(dto.status, PROJECT_STATUSES, "PLANNED", "status"),
    priority: narrow<Priority>(dto.priority, PRIORITIES, "MEDIUM", "priority"),
    health: narrow<ProjectHealth>(dto.health, PROJECT_HEALTHS, "GREEN", "health"),
    progressPercent: dto.progressPercent,
    currentPhase: narrowNullable<SiaPhase>(dto.currentPhase, SIA_PHASES, "currentPhase"),
    startDate: toDate(dto.startDate),
    plannedEndDate: toDate(dto.plannedEndDate),
    actualEndDate: toDate(dto.actualEndDate),
    contractValue: dto.contractValue,
    currency: dto.currency,
    budgetHours: dto.budgetHours,
    version: dto.version,
    createdAt: toDate(dto.createdAt),
    updatedAt: toDate(dto.updatedAt),
    archivedAt: toDate(dto.archivedAt),
    // Copied rather than passed through: the DTO objects belong to the cache,
    // and an entity that shares one with its wire shape is one mutation away
    // from changing what another screen is reading.
    customer: dto.customer && { ...dto.customer },
    building: dto.building && { ...dto.building },
    manager: dto.manager && { ...dto.manager },
    office: dto.office && { ...dto.office },
  };
}

export function toProjectPage(page: Paginated<ProjectDto>): Paginated<Project> {
  return { ...page, items: page.items.map(toProject) };
}

export function toMember(dto: ProjectMemberDto): ProjectMember {
  return {
    id: dto.id,
    role: narrow<MemberRole>(dto.role, MEMBER_ROLES, "ENGINEER", "role"),
    allocationPercent: dto.allocationPercent,
    from: toDate(dto.from),
    to: toDate(dto.to),
    employee: { ...dto.employee },
  };
}

export function toDisciplineScope(dto: ProjectDisciplineDto): ProjectDiscipline {
  return {
    id: dto.id,
    status: narrow<DisciplineScopeStatus>(
      dto.status,
      DISCIPLINE_SCOPE_STATUSES,
      "PLANNED",
      "Gewerk-Status",
    ),
    feeShare: dto.feeShare,
    feeShareOverride: dto.feeShareOverride,
    budgetHours: dto.budgetHours,
    budgetCost: dto.budgetCost,
    hourlyRate: dto.hourlyRate,
    scopeNote: dto.scopeNote,
    discipline: { ...dto.discipline },
    leadEngineer: dto.leadEngineer && { ...dto.leadEngineer },
  };
}

export function toMilestone(dto: MilestoneDto): Milestone {
  return {
    id: dto.id,
    name: dto.name,
    dueDate: toDate(dto.dueDate),
    metAt: toDate(dto.metAt),
    status: narrow<MilestoneStatus>(dto.status, MILESTONE_STATUSES, "OPEN", "Meilenstein-Status"),
    phase: narrowNullable<SiaPhase>(dto.phase, SIA_PHASES, "phase"),
    isBillingTrigger: dto.isBillingTrigger,
  };
}

export function toProjectDetail(dto: ProjectDetailDto): ProjectDetail {
  return {
    ...toProject(dto),
    description: dto.description,
    notes: dto.notes,
    architect: dto.architect && { ...dto.architect },
    members: dto.members.map(toMember),
    disciplines: dto.disciplines.map(toDisciplineScope),
    milestones: dto.milestones.map(toMilestone),
    /**
     * Filtered rather than narrowed with a fallback.
     *
     * A transition the client does not recognise must **disappear**, not become
     * `PLANNED` — offering the wrong button is worse than offering one fewer.
     * This is the one place the fallback strategy above is the wrong one, and
     * it is worth the exception.
     */
    allowedTransitions: dto.allowedTransitions.filter((value): value is ProjectStatus =>
      (PROJECT_STATUSES as readonly string[]).includes(value),
    ),
  };
}

/**
 * Fills every status, including the ones the server left out.
 *
 * `/projects/stats` groups by status, so it returns only statuses that have at
 * least one row: a fresh database sends `{ PLANNED: 1 }`. The filter chips read
 * this map directly, and `undefined` renders as nothing where `0` is the
 * truthful answer.
 */
export function toProjectStats(dto: ProjectStatsDto): ProjectStats {
  const byStatus = Object.fromEntries(
    PROJECT_STATUSES.map((status) => [status, dto.byStatus[status] ?? 0]),
  ) as Record<ProjectStatus, number>;
  return { total: dto.total, byStatus };
}

/**
 * One row of the version history.
 *
 * A mapper for a read-only list looks like ceremony until the dates: the
 * history is sorted and grouped by `createdAt`, and a string that sorts
 * correctly by luck is a bug waiting for a timezone.
 */
export function toProjectVersion(dto: ProjectVersionDto): ProjectVersion {
  return {
    id: dto.id,
    version: dto.version,
    label: dto.label,
    changed: [...dto.changed],
    note: dto.note,
    changedById: dto.changedById,
    changedByEmail: dto.changedByEmail,
    changedByName: dto.changedByName,
    correlationId: dto.correlationId,
    createdAt: new Date(dto.createdAt),
  };
}

/* ---- The pickers --------------------------------------------------- */

export function toCustomerOption(dto: CustomerOptionDto): CustomerOption {
  return { id: dto.id, number: dto.number, name: dto.name, city: dto.city };
}

/** Flattens `customer` to an id: a picker filters by it, it never renders it. */
export function toBuildingOption(dto: BuildingOptionDto): BuildingOption {
  return {
    id: dto.id,
    number: dto.number,
    name: dto.name,
    city: dto.city,
    customerId: dto.customer.id,
  };
}

export function toEmployeeOption(dto: EmployeeOptionDto): EmployeeOption {
  return { id: dto.id, name: dto.name, email: dto.email, position: dto.position };
}

export function toDisciplineOption(dto: DisciplineOptionDto): DisciplineOption {
  return {
    id: dto.id,
    code: dto.code,
    name: dto.name,
    colour: dto.colour,
    defaultBudgetShare: dto.defaultBudgetShare,
    defaultHourlyRate: dto.defaultHourlyRate,
    manager: dto.manager && { ...dto.manager },
  };
}

/* ================================================================== */
/* The other direction: entity → request body                          */
/* ================================================================== */

/**
 * **The only place an entity shape becomes a request body.**
 *
 * The half of the DTO boundary that is easy to skip, and `architecture.test.ts`
 * caught the first version of this feature skipping it: the hooks took
 * `CreateProjectBody` and passed it through, so a screen named a wire type. It
 * compiles, it works, and it is the exact point at which the layering stops
 * being real — an API change then reaches the screen.
 *
 * Two rules run through everything below.
 *
 * **`undefined` means "not supplied"; `null` means "clear it".** The
 * distinction is the whole reason `PATCH` works, and a naive `{ ...values }`
 * destroys it: a body that omitted `managerId` would send `managerId:
 * undefined`, which is correct by accident, while the field that was genuinely
 * cleared takes the same path only because `null` survives. Writing it out once
 * stops each field guessing — the server's mapper makes the same argument.
 *
 * **A date crosses as a plain `yyyy-mm-dd` in local time.** `toISOString()`
 * would shift a date typed in Zürich back a day for most of the year, and the
 * day it lands on is a contracted deadline.
 */

/** `Date` → `yyyy-mm-dd`, in **local** time. Preserves `undefined` and `null`. */
export function toDatePart(value: Date | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Drops the keys that were not supplied, so `PATCH` stays a patch. */
function defined<T extends Record<string, unknown>>(body: T): T {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as T;
}

export function toCreateBody(draft: ProjectDraft): CreateProjectBody {
  return defined({
    name: draft.name,
    customerId: draft.customerId,
    // `?? undefined`: the create endpoint has no "clear it" case — a field that
    // is absent is simply absent — so a `null` from a form control becomes
    // omission rather than an explicit null the DTO would reject.
    architectId: draft.architectId ?? undefined,
    buildingId: draft.buildingId ?? undefined,
    managerId: draft.managerId ?? undefined,
    officeId: draft.officeId ?? undefined,
    priority: draft.priority,
    startDate: toDatePart(draft.startDate) ?? undefined,
    plannedEndDate: toDatePart(draft.plannedEndDate) ?? undefined,
    contractValue: draft.contractValue ?? undefined,
    budgetHours: draft.budgetHours ?? undefined,
    description: draft.description ?? undefined,
    notes: draft.notes ?? undefined,
  });
}

export function toUpdateBody(edit: ProjectEdit): UpdateProjectBody {
  return defined({
    // Never dropped by `defined`, because it is never `undefined`: the type
    // requires it and the server refuses a body without it.
    expectedVersion: edit.expectedVersion,
    versionNote: edit.versionNote,
    name: edit.name,
    architectId: edit.architectId,
    buildingId: edit.buildingId,
    managerId: edit.managerId,
    officeId: edit.officeId,
    priority: edit.priority,
    currentPhase: edit.currentPhase,
    startDate: toDatePart(edit.startDate),
    plannedEndDate: toDatePart(edit.plannedEndDate),
    actualEndDate: toDatePart(edit.actualEndDate),
    contractValue: edit.contractValue,
    budgetHours: edit.budgetHours,
    description: edit.description,
    notes: edit.notes,
  });
}

export function toStatusBody(change: StatusChange): ChangeStatusBody {
  return defined({ status: change.status, reason: change.reason });
}

export function toMemberBody(draft: MemberDraft): AddMemberBody {
  return defined({
    employeeId: draft.employeeId,
    role: draft.role,
    allocationPercent: draft.allocationPercent,
    from: toDatePart(draft.from) ?? undefined,
    to: toDatePart(draft.to) ?? undefined,
  });
}

export function toScopeBody(draft: DisciplineScopeDraft): ScopeDisciplineBody {
  return defined({
    disciplineId: draft.disciplineId,
    status: draft.status,
    leadEngineerId: draft.leadEngineerId,
    feeShare: draft.feeShare,
    feeShareOverride: draft.feeShareOverride,
    budgetHours: draft.budgetHours,
    budgetCost: draft.budgetCost,
    hourlyRate: draft.hourlyRate,
    scopeNote: draft.scopeNote,
  });
}

export function toMilestoneCreateBody(draft: MilestoneDraft): CreateMilestoneBody {
  return defined({
    name: draft.name,
    dueDate: toDatePart(draft.dueDate)!,
    phase: draft.phase ?? undefined,
    isBillingTrigger: draft.isBillingTrigger,
  });
}

export function toMilestoneUpdateBody(edit: MilestoneEdit): UpdateMilestoneBody {
  return defined({
    name: edit.name,
    dueDate: toDatePart(edit.dueDate) ?? undefined,
    status: edit.status,
    // Not `?? undefined`: `null` is how a milestone is taken out of a phase,
    // and the edit endpoint accepts it.
    phase: edit.phase,
    isBillingTrigger: edit.isBillingTrigger,
  });
}
