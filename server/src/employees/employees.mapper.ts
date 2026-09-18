import type { Prisma } from "@prisma/client";

/**
 * The Wave 1 employee slice — and the one mapper in the codebase that **drops a
 * field on purpose**.
 *
 * `hourlyRate` is personal data. `docs/data-model.md` §3.15 makes it readable
 * only with `employee.compensation`, a permission deliberately separate from
 * `employee.read`, and the enforcement is here rather than in the query for a
 * reason worth stating: a `select` that varies by caller is a second query
 * shape, and the day somebody adds a third caller they will copy the wrong one.
 * One shape, one place that removes a field, one thing to check.
 *
 * The permission itself is not declared yet — `resources.ts` says why a
 * resource grows when its routes do, and the salary route is Wave 1 module 2.
 * Until then the field is dropped **unconditionally**, which is the safe
 * default and not an oversight: nothing can currently grant access to it.
 */

export const EMPLOYEE_SELECT = {
  id: true,
  personnelNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  mobile: true,
  position: true,
  employmentType: true,
  workloadPercent: true,
  status: true,
  hireDate: true,
  exitDate: true,
  department: { select: { id: true, code: true, name: true } },
  office: { select: { id: true, name: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
  userId: true,
} satisfies Prisma.EmployeeSelect;

type Row = Prisma.EmployeeGetPayload<{ select: typeof EMPLOYEE_SELECT }>;

export function toEmployee(row: Row) {
  return {
    id: row.id,
    personnelNumber: row.personnelNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    name: `${row.firstName} ${row.lastName}`,
    email: row.email,
    phone: row.phone,
    mobile: row.mobile,
    position: row.position,
    employmentType: row.employmentType,
    workloadPercent: row.workloadPercent,
    status: row.status,
    hireDate: row.hireDate.toISOString(),
    exitDate: row.exitDate?.toISOString() ?? null,
    department: row.department && {
      id: row.department.id,
      code: row.department.code,
      name: row.department.name,
    },
    office: row.office && { id: row.office.id, name: row.office.name },
    manager: row.manager && {
      id: row.manager.id,
      name: `${row.manager.firstName} ${row.manager.lastName}`,
    },
    /** Whether this person can sign in — not *which* account, which is nobody's business here. */
    hasLogin: row.userId !== null,
  };
}

export type EmployeeView = ReturnType<typeof toEmployee>;
