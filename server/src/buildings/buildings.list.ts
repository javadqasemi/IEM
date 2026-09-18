import { BuildingUsage, ConstructionType, EnergyStandard } from "@prisma/client";
import type { ListSpec } from "../core/list/list.spec-types";

/**
 * `customerId` is filterable because the commonest way into this list is from a
 * customer page — "what else do we look after for them" is the question the
 * building table exists to answer cheaply.
 */
export const BUILDING_LIST: ListSpec = {
  sortable: ["number", "name", "city", "yearBuilt", "createdAt"],
  filterable: {
    customerId: { kind: "string" },
    city: { kind: "string" },
    usage: { kind: "enum", values: Object.values(BuildingUsage) },
    constructionType: { kind: "enum", values: Object.values(ConstructionType) },
    energyStandard: { kind: "enum", values: Object.values(EnergyStandard) },
    yearBuilt: { kind: "number" },
    officeId: { kind: "string" },
  },
  searchable: ["number", "name", "address", "city", "egid"],
  defaultSort: { field: "name", dir: "asc" },
};
