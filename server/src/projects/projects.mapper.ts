import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/**
 * Prisma row → what the API returns. The server's DTO boundary.
 *
 * **This is where a `Decimal` stops being a `Decimal` and a `Date` stops being
 * a `Date`**, and it is the only place either happens. Without a mapper both
 * leak: `JSON.stringify` turns a Prisma `Decimal` into `{"s":1,"e":6,"d":[…]}`
 * — an object the client cannot read and which looks, in a network tab, like a
 * server bug rather than a missing conversion.
 *
 * Money is a **string**, not a number. `contractValue: 1234567.89` survives
 * `JSON.parse` today and will not the day a project is worth more than
 * 2^53 Rappen — but the real reason is smaller and more common: a client that
 * receives a number will do arithmetic on it, and float arithmetic on money is
 * how a total ends in `.0000000001`. A string cannot be added by accident.
 *
 * Dates are ISO 8601 with the timezone, because `2026-09-18` read in Zürich and
 * in UTC are different days and the difference lands on a contracted deadline.
 *
 * The `select` objects below are **exported and used by the repository**. That
 * coupling is deliberate: a mapper that reads a field the query did not select
 * compiles perfectly and returns `undefined` at runtime, and keeping the shape
 * in one place is what makes that impossible rather than merely unlikely.
 */

/* ================================================================== */
/* What the queries select                                             */
/* ================================================================== */

/** The related rows a list row shows. Deliberately small — a list is 25 of these. */
export const PROJECT_LIST_SELECT = {
  id: true,
  number: true,
  name: true,
  status: true,
  priority: true,
  health: true,
  progressPercent: true,
  currentPhase: true,
  startDate: true,
  plannedEndDate: true,
  actualEndDate: true,
  contractValue: true,
  currency: true,
  budgetHours: true,
  updatedAt: true,
  createdAt: true,
  archivedAt: true,
  customer: { select: { id: true, number: true, name: true } },
  building: { select: { id: true, number: true, name: true, city: true } },
  manager: { select: { id: true, firstName: true, lastName: true, email: true } },
  office: { select: { id: true, name: true } },
} satisfies Prisma.ProjectSelect;

/**
 * The detail select — the list row plus everything the overview tab needs.
 *
 * One query rather than four round-trips, and the reason is not speed: the four
 * separate reads would be four points at which a concurrent write makes the
 * page internally inconsistent — a team list that includes a member the
 * progress figure was computed without.
 */
export const PROJECT_DETAIL_SELECT = {
  ...PROJECT_LIST_SELECT,
  description: true,
  notes: true,
  createdById: true,
  updatedById: true,
  architect: { select: { id: true, number: true, name: true } },
  members: {
    where: { deletedAt: null },
    orderBy: [{ role: "asc" }, { from: "asc" }] as Prisma.ProjectMemberOrderByWithRelationInput[],
    select: {
      id: true,
      role: true,
      allocationPercent: true,
      from: true,
      to: true,
      employee: {
        select: { id: true, firstName: true, lastName: true, email: true, position: true },
      },
    },
  },
  disciplines: {
    where: { deletedAt: null },
    orderBy: { discipline: { order: "asc" } } as Prisma.ProjectDisciplineOrderByWithRelationInput,
    select: {
      id: true,
      status: true,
      feeShare: true,
      feeShareOverride: true,
      budgetHours: true,
      budgetCost: true,
      hourlyRate: true,
      scopeNote: true,
      discipline: { select: { id: true, code: true, name: true, defaultColour: true } },
      leadEngineer: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  },
  milestones: {
    where: { deletedAt: null },
    orderBy: { dueDate: "asc" } as Prisma.MilestoneOrderByWithRelationInput,
    select: {
      id: true,
      name: true,
      dueDate: true,
      metAt: true,
      status: true,
      phase: true,
      isBillingTrigger: true,
    },
  },
} satisfies Prisma.ProjectSelect;

export type ProjectListRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_LIST_SELECT }>;
export type ProjectDetailRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_DETAIL_SELECT }>;

/* ================================================================== */
/* The conversions                                                     */
/* ================================================================== */

/**
 * `Decimal | null` → `string | null`.
 *
 * `.toFixed()` rather than `.toString()`: Prisma's Decimal prints `1200` for a
 * value stored as `1200.00`, and a contract value that renders as "CHF 1200"
 * on one screen and "CHF 1'200.00" on another reads as two different numbers to
 * the person signing it. The scale belongs to the column, so it is applied
 * here, once.
 */
function money(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

/** `Decimal | null` → `number | null`, for a ratio. Percentages are not money. */
function ratio(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function person(
  employee: { id: string; firstName: string; lastName: string; email: string } | null,
) {
  if (!employee) return null;
  return {
    id: employee.id,
    name: `${employee.firstName} ${employee.lastName}`,
    email: employee.email,
  };
}

export function toProjectListItem(row: ProjectListRow) {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    status: row.status,
    priority: row.priority,
    health: row.health,
    progressPercent: row.progressPercent,
    currentPhase: row.currentPhase,
    startDate: iso(row.startDate),
    plannedEndDate: iso(row.plannedEndDate),
    actualEndDate: iso(row.actualEndDate),
    contractValue: money(row.contractValue),
    currency: row.currency,
    budgetHours: row.budgetHours,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    archivedAt: iso(row.archivedAt),
    customer: row.customer && {
      id: row.customer.id,
      number: row.customer.number,
      name: row.customer.name,
    },
    building: row.building && {
      id: row.building.id,
      number: row.building.number,
      name: row.building.name,
      city: row.building.city,
    },
    manager: person(row.manager),
    office: row.office && { id: row.office.id, name: row.office.name },
  };
}

export function toProjectDetail(row: ProjectDetailRow) {
  return {
    ...toProjectListItem(row),
    description: row.description,
    notes: row.notes,
    architect: row.architect && {
      id: row.architect.id,
      number: row.architect.number,
      name: row.architect.name,
    },
    members: row.members.map((member) => ({
      id: member.id,
      role: member.role,
      allocationPercent: member.allocationPercent,
      from: iso(member.from),
      to: iso(member.to),
      employee: {
        ...person(member.employee)!,
        position: member.employee.position,
      },
    })),
    disciplines: row.disciplines.map((entry) => ({
      id: entry.id,
      status: entry.status,
      feeShare: ratio(entry.feeShare),
      feeShareOverride: entry.feeShareOverride,
      budgetHours: entry.budgetHours,
      budgetCost: money(entry.budgetCost),
      hourlyRate: money(entry.hourlyRate),
      scopeNote: entry.scopeNote,
      discipline: {
        id: entry.discipline.id,
        code: entry.discipline.code,
        name: entry.discipline.name,
        colour: entry.discipline.defaultColour,
      },
      leadEngineer: person(entry.leadEngineer),
    })),
    milestones: row.milestones.map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
      dueDate: iso(milestone.dueDate),
      metAt: iso(milestone.metAt),
      status: milestone.status,
      phase: milestone.phase,
      isBillingTrigger: milestone.isBillingTrigger,
    })),
  };
}

export type ProjectListItem = ReturnType<typeof toProjectListItem>;
export type ProjectDetail = ReturnType<typeof toProjectDetail>;

/**
 * A milestone on its own, for `/projects/:id/milestones`.
 *
 * It exists although `JSON.stringify` would already turn those `Date`s into ISO
 * strings, and that is the point: relying on the serialiser means the sub-list
 * and the detail tab return the *same* milestone in two shapes the day one of
 * them gains a `Decimal`. A row leaves this module through a mapper or it does
 * not leave it.
 */
export function toMilestone(row: {
  id: string;
  name: string;
  dueDate: Date;
  metAt: Date | null;
  status: string;
  phase: string | null;
  isBillingTrigger: boolean;
}) {
  return {
    id: row.id,
    name: row.name,
    dueDate: row.dueDate.toISOString(),
    metAt: iso(row.metAt),
    status: row.status,
    phase: row.phase,
    isBillingTrigger: row.isBillingTrigger,
  };
}

/**
 * What an audit row records about a project. A diff, not a dump.
 *
 * It takes the manager **either way** — `managerId` from the rule read,
 * `manager.id` from the detail read — and that is not defensive typing. The
 * first version took only `managerId`, the detail select has no such column, and
 * so every `after` came back without it while every `before` had it: the audit
 * log recorded a manager being removed on every edit that did not touch the
 * manager. It was found by reading a real audit row, not by a type error, because
 * reading the wrong shape here does not fail — it **lies**, and a log that lies
 * about a change is worse than one that omits it.
 *
 * In the mapper rather than private on the service for exactly that reason: it
 * is a row-to-shape conversion, and it needed to be reachable from a test.
 */
export function toAuditSnapshot(row: {
  name: string;
  status: string;
  managerId?: string | null;
  manager?: { id: string } | null;
  startDate: Date | null;
  plannedEndDate: Date | null;
}) {
  return {
    name: row.name,
    status: row.status,
    managerId: row.managerId ?? row.manager?.id ?? null,
    startDate: iso(row.startDate),
    plannedEndDate: iso(row.plannedEndDate),
  };
}

/* ================================================================== */
/* Inbound: DTO → what Prisma writes                                   */
/* ================================================================== */

/**
 * The other direction, and the reason the mapper is a *seam* rather than a
 * formatter.
 *
 * `projects.service.ts` holds no `Prisma` import at all — not the client, not
 * the namespace, not `Decimal`. Every conversion from what a request said to
 * what a column holds is in this half of the file, which means the service's
 * rules can be read without knowing what a `Decimal` is and the persistence
 * details can change without touching a rule. `architecture.test.ts` asserts
 * the import is absent, because "the service holds no Prisma types" is the kind
 * of rule that decays the first time somebody needs one small thing.
 *
 * Converting here is also what makes the error message right. A malformed
 * amount is a *bad request*, and the only place that knows a string was
 * supposed to be a decimal is the conversion itself.
 */

/** `"1234.50"` → `Decimal`. Throws with the field named, never silently zero. */
export function toMoney(value: string | null | undefined, field: string): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  // A leading `+`, a thousands separator or a comma decimal are all things a
  // person types. Rejecting them with the field named beats accepting
  // `1'200.00` as NaN and storing null.
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(value)) {
    throw new BadRequestException(
      `„${value}“ ist kein gültiger Betrag für ${field}. Erwartet: 1234.50`,
    );
  }
  return new Prisma.Decimal(value);
}

/** `"2026-09-18"` or a full ISO timestamp → `Date`. The DTO has already checked the shape. */
export function toDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  return new Date(value);
}

/**
 * `undefined` means "not supplied"; `null` means "clear it".
 *
 * The distinction is the whole reason `PATCH` works at all, and it is the one
 * thing a naive spread destroys: `{ ...dto }` on a body that omitted
 * `managerId` writes `managerId: undefined`, which Prisma reads as "leave
 * alone" — correct by accident — while a body that sent `null` to clear it
 * takes the same path only because `null` survives. Writing it out once, here,
 * is what stops each field guessing.
 */
function patch<T>(value: T | null | undefined, convert: (v: T) => unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return convert(value);
}

export type ProjectWriteInput = {
  name?: string;
  architectId?: string | null;
  buildingId?: string | null;
  managerId?: string | null;
  officeId?: string | null;
  priority?: string;
  currentPhase?: string | null;
  startDate?: string | null;
  plannedEndDate?: string | null;
  actualEndDate?: string | null;
  contractValue?: string | null;
  budgetHours?: number | null;
  description?: string | null;
  notes?: string | null;
};

/**
 * The edit body → a Prisma update.
 *
 * Relations are written as `connect`/`disconnect` rather than as raw foreign
 * keys, so a `null` clears the link instead of failing the type. The repository
 * could have taken the scalar and done this itself; it is here because "how a
 * link is cleared" is a persistence *shape* decision, and the repository's job
 * is to run the statement, not to decide what the statement means.
 */
export function toProjectUpdateData(
  input: ProjectWriteInput,
  updatedById: string | null,
): Prisma.ProjectUpdateInput {
  const data: Prisma.ProjectUpdateInput = { updatedById };

  if (input.name !== undefined) data.name = input.name;
  if (input.priority !== undefined) data.priority = input.priority as Prisma.ProjectUpdateInput["priority"];
  if (input.currentPhase !== undefined) {
    data.currentPhase = input.currentPhase as Prisma.ProjectUpdateInput["currentPhase"];
  }
  if (input.budgetHours !== undefined) data.budgetHours = input.budgetHours;
  if (input.description !== undefined) data.description = input.description;
  if (input.notes !== undefined) data.notes = input.notes;

  if (input.startDate !== undefined) data.startDate = patch(input.startDate, toDate) as Date | null;
  if (input.plannedEndDate !== undefined) {
    data.plannedEndDate = patch(input.plannedEndDate, toDate) as Date | null;
  }
  if (input.actualEndDate !== undefined) {
    data.actualEndDate = patch(input.actualEndDate, toDate) as Date | null;
  }
  if (input.contractValue !== undefined) {
    data.contractValue = input.contractValue === null
      ? null
      : toMoney(input.contractValue, "Auftragswert");
  }

  link(data, "architect", input.architectId);
  link(data, "building", input.buildingId);
  link(data, "manager", input.managerId);
  link(data, "office", input.officeId);

  return data;
}

function link(
  data: Record<string, unknown>,
  relation: string,
  id: string | null | undefined,
): void {
  if (id === undefined) return;
  data[relation] = id === null ? { disconnect: true } : { connect: { id } };
}

export type ProjectCreateInput = ProjectWriteInput & {
  number: string;
  name: string;
  customerId: string;
};

export function toProjectCreateData(
  input: ProjectCreateInput,
  createdById: string | null,
): Prisma.ProjectCreateInput {
  const data: Prisma.ProjectCreateInput = {
    number: input.number,
    name: input.name,
    customer: { connect: { id: input.customerId } },
    createdById,
    updatedById: createdById,
    priority: input.priority as Prisma.ProjectCreateInput["priority"],
    startDate: toDate(input.startDate),
    plannedEndDate: toDate(input.plannedEndDate),
    contractValue: toMoney(input.contractValue, "Auftragswert"),
    budgetHours: input.budgetHours ?? null,
    description: input.description ?? null,
    notes: input.notes ?? null,
  };

  link(data as Record<string, unknown>, "architect", input.architectId);
  link(data as Record<string, unknown>, "building", input.buildingId);
  link(data as Record<string, unknown>, "manager", input.managerId);
  link(data as Record<string, unknown>, "office", input.officeId);

  return data;
}

/**
 * The flat shape the CSV export writes.
 *
 * Separate from `toProjectListItem` on purpose: an export is read by Excel, not
 * by the dashboard, and nesting `customer.name` inside an object means the
 * column header is decided by whoever writes the CSV loop. Naming the columns
 * here keeps the export's contract next to the rest of the module's.
 */
export function toProjectExportRow(row: ProjectListRow): Record<string, string> {
  return {
    Nummer: row.number,
    Projekt: row.name,
    Status: row.status,
    Priorität: row.priority,
    Zustand: row.health,
    "Fortschritt %": String(row.progressPercent),
    Phase: row.currentPhase ?? "",
    Kunde: row.customer?.name ?? "",
    Gebäude: row.building?.name ?? "",
    Ort: row.building?.city ?? "",
    Projektleitung: row.manager ? `${row.manager.firstName} ${row.manager.lastName}` : "",
    Standort: row.office?.name ?? "",
    Start: row.startDate?.toISOString().slice(0, 10) ?? "",
    "Geplantes Ende": row.plannedEndDate?.toISOString().slice(0, 10) ?? "",
    "Tatsächliches Ende": row.actualEndDate?.toISOString().slice(0, 10) ?? "",
    Auftragswert: money(row.contractValue) ?? "",
    Währung: row.currency,
    Sollstunden: row.budgetHours === null ? "" : String(row.budgetHours),
  };
}
