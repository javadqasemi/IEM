import { CustomerStatus, CustomerType } from "@prisma/client";
import type { ListSpec } from "../core/list/list.spec-types";

/** `number` sorts before `name` by default: a customer key is how the firm refers to them. */
export const CUSTOMER_LIST: ListSpec = {
  sortable: ["number", "name", "city", "status", "createdAt"],
  filterable: {
    status: { kind: "enum", values: Object.values(CustomerStatus) },
    type: { kind: "enum", values: Object.values(CustomerType) },
    city: { kind: "string" },
    ownerId: { kind: "string" },
  },
  searchable: ["number", "name", "legalName", "city"],
  defaultSort: { field: "name", dir: "asc" },
};
