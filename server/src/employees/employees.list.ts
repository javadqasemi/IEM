import { EmployeeStatus, EmploymentType } from "@prisma/client";
import type { ListSpec } from "../core/list/list.spec-types";

/**
 * `status` defaults to nothing, so a plain list includes people who have left.
 *
 * That is correct and it is the opposite of what a picker wants — so the
 * picker sends `filter[status]=eq:ACTIVE` rather than the list hiding rows by
 * default. A default filter nobody can see is how a screen ends up unable to
 * show a record that exists.
 */
export const EMPLOYEE_LIST: ListSpec = {
  sortable: ["lastName", "personnelNumber", "hireDate", "status"],
  filterable: {
    status: { kind: "enum", values: Object.values(EmployeeStatus) },
    employmentType: { kind: "enum", values: Object.values(EmploymentType) },
    departmentId: { kind: "string" },
    officeId: { kind: "string" },
    managerId: { kind: "string" },
  },
  searchable: ["firstName", "lastName", "email", "personnelNumber", "position"],
  defaultSort: { field: "lastName", dir: "asc" },
};
