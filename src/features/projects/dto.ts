/**
 * The wire shapes. **This file and `mapper.ts` are the only two that may name
 * them** (`docs/enterprise-architecture.md` §3.1), and `architecture.test.ts`
 * enforces that rather than leaving it to review.
 *
 * Everything here is exactly what `/api/v1/projects` sends, including the parts
 * that are wrong for the domain and right for JSON:
 *
 * - **Dates are ISO strings.** `"2026-01-15T00:00:00.000Z" < someDate` compares
 *   a string to an object and never throws; it just answers wrongly.
 * - **Money is a decimal string.** Deliberate on both sides — a number invites
 *   arithmetic, and a client that adds up `contractValue` in floats produces a
 *   portfolio total ending in `.0000000001`. The mapper keeps it a string.
 * - **Enums are open `string`s.** The server's Postgres enums and this client's
 *   unions are two declarations of the same set with nothing keeping them in
 *   step; the server may ship a seventh status before this bundle is
 *   redeployed. Typing them as the union *here* would be a lie the compiler
 *   believes. `mapper.ts` is where the narrowing happens and where an unknown
 *   value has somewhere to go.
 */

export type PersonRefDto = { id: string; name: string; email: string };
export type CustomerRefDto = { id: string; number: string; name: string };
export type BuildingRefDto = {
  id: string;
  number: string;
  name: string;
  city: string | null;
};
export type OfficeRefDto = { id: string; name: string };

export type ProjectDto = {
  id: string;
  number: string;
  name: string;
  status: string;
  priority: string;
  health: string;
  progressPercent: number;
  currentPhase: string | null;
  startDate: string | null;
  plannedEndDate: string | null;
  actualEndDate: string | null;
  contractValue: string | null;
  currency: string;
  budgetHours: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
  customer: CustomerRefDto | null;
  building: BuildingRefDto | null;
  manager: PersonRefDto | null;
  office: OfficeRefDto | null;
};

export type ProjectMemberDto = {
  id: string;
  role: string;
  allocationPercent: number;
  from: string | null;
  to: string | null;
  employee: PersonRefDto & { position: string | null };
};

export type ProjectDisciplineDto = {
  id: string;
  status: string;
  feeShare: number | null;
  feeShareOverride: boolean;
  budgetHours: number | null;
  budgetCost: string | null;
  hourlyRate: string | null;
  scopeNote: string | null;
  discipline: { id: string; code: string; name: string; colour: string };
  leadEngineer: PersonRefDto | null;
};

export type MilestoneDto = {
  id: string;
  name: string;
  dueDate: string;
  metAt: string | null;
  status: string;
  phase: string | null;
  isBillingTrigger: boolean;
};

export type ProjectDetailDto = ProjectDto & {
  description: string | null;
  notes: string | null;
  architect: CustomerRefDto | null;
  members: ProjectMemberDto[];
  disciplines: ProjectDisciplineDto[];
  milestones: MilestoneDto[];
  allowedTransitions: string[];
};

export type ProjectStatsDto = {
  total: number;
  byStatus: Record<string, number>;
};

/* ---- Bodies ------------------------------------------------------- */

export type CreateProjectBody = {
  name: string;
  customerId: string;
  architectId?: string;
  buildingId?: string;
  managerId?: string;
  officeId?: string;
  priority?: string;
  startDate?: string;
  plannedEndDate?: string;
  contractValue?: string;
  budgetHours?: number;
  description?: string;
  notes?: string;
};

/**
 * `status` is absent, and that is the server's contract rather than an
 * oversight: `PATCH /projects/:id` cannot change a status, because a transition
 * has preconditions, its own permission and its own event. Including it here
 * would produce a field the API silently strips.
 */
export type UpdateProjectBody = Partial<{
  name: string;
  architectId: string | null;
  buildingId: string | null;
  managerId: string | null;
  officeId: string | null;
  priority: string;
  currentPhase: string | null;
  startDate: string | null;
  plannedEndDate: string | null;
  actualEndDate: string | null;
  contractValue: string | null;
  budgetHours: number | null;
  description: string | null;
  notes: string | null;
}>;

export type ChangeStatusBody = { status: string; reason?: string };

export type AddMemberBody = {
  employeeId: string;
  role?: string;
  allocationPercent?: number;
  from?: string;
  to?: string;
};

export type ScopeDisciplineBody = {
  disciplineId: string;
  status?: string;
  leadEngineerId?: string | null;
  feeShare?: number | null;
  feeShareOverride?: boolean;
  budgetHours?: number | null;
  budgetCost?: string | null;
  hourlyRate?: string | null;
  scopeNote?: string | null;
};

export type CreateMilestoneBody = {
  name: string;
  dueDate: string;
  phase?: string;
  isBillingTrigger?: boolean;
};

export type UpdateMilestoneBody = Partial<{
  name: string;
  dueDate: string;
  status: string;
  phase: string | null;
  isBillingTrigger: boolean;
}>;

/* ---- The master-data pickers --------------------------------------- */

export type CustomerOptionDto = {
  id: string;
  number: string;
  name: string;
  city: string | null;
};

export type BuildingOptionDto = {
  id: string;
  number: string;
  name: string;
  city: string | null;
  customer: CustomerRefDto;
};

export type EmployeeOptionDto = {
  id: string;
  name: string;
  email: string;
  position: string | null;
};

export type DisciplineOptionDto = {
  id: string;
  code: string;
  name: string;
  colour: string;
  defaultBudgetShare: number | null;
  defaultHourlyRate: string | null;
  manager: PersonRefDto | null;
};
