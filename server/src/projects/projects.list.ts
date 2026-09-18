import {
  MilestoneStatus,
  Priority,
  ProjectHealth,
  ProjectStatus,
  SiaPhase,
} from "@prisma/client";
import type { ListSpec } from "../core/list/list.spec-types";

/**
 * What a caller may sort, filter and search projects by.
 *
 * The list every other module's list is measured against, so the choices are
 * argued rather than listed.
 *
 * **`customer` and `manager` filter by name, through `path`.** A filter is a
 * URL somebody shares, and `filter[customerId]=eq:cm9x…` is a cuid nobody can
 * read, type or recognise in a bookmark. `filter[customer]=like:gemeinde`
 * answers the question people actually have. The id-based filters exist too,
 * because the *dashboard* has the id in hand when it links from a customer
 * page, and making it resolve a name first would be a round-trip to build a
 * link.
 *
 * **`health` is filterable although it is derived.** It is stored precisely so
 * that it can be — "show me the red projects" is the first thing a
 * Geschäftsleitung member asks, and a derived-but-unstored figure can only
 * answer it by reading every project into memory.
 *
 * **`notes` is in neither list.** It is the internal comment field; the same
 * reasoning the applications spec gives for `note` applies, and more strongly
 * here, because a project note is where somebody records a problem with a
 * client.
 */
export const PROJECT_LIST: ListSpec = {
  sortable: [
    "number",
    "name",
    "status",
    "priority",
    "health",
    "progressPercent",
    "startDate",
    "plannedEndDate",
    "contractValue",
    "updatedAt",
    "createdAt",
  ],

  filterable: {
    status: { kind: "enum", values: Object.values(ProjectStatus) },
    priority: { kind: "enum", values: Object.values(Priority) },
    health: { kind: "enum", values: Object.values(ProjectHealth) },
    currentPhase: { kind: "enum", values: Object.values(SiaPhase) },

    customerId: { kind: "string" },
    customer: { kind: "string", path: "customer.name" },
    buildingId: { kind: "string" },
    managerId: { kind: "string" },
    manager: { kind: "string", path: "manager.lastName" },
    officeId: { kind: "string" },
    /** `filter[discipline]=eq:LFT` — every project with a Lüftung scope. */
    discipline: { kind: "string", path: "disciplines.some.discipline.code" },

    startDate: { kind: "date" },
    /**
     * The one that earns the contract here, as `retainUntil` does for
     * applications: `filter[plannedEndDate]=lte:2026-12-31` combined with
     * `filter[status]=in:ACTIVE,ON_HOLD` is "what is contractually due this
     * year and not finished", and the rows are never on the first page.
     */
    plannedEndDate: { kind: "date" },
    updatedAt: { kind: "date" },
    contractValue: { kind: "number" },
    progressPercent: { kind: "number" },
  },

  searchable: ["number", "name", "description"],

  /**
   * Recently touched first.
   *
   * Not `number`, which would be creation order wearing a business key, and not
   * `plannedEndDate`, which sorts the dateless to one end. What somebody wants
   * on opening the list is what they were last working on.
   */
  defaultSort: { field: "updatedAt", dir: "desc" },

  /** The row is small and the screen is a table; the global 200 is right. */
};

/**
 * The milestone sub-list, for `/projects/:id/milestones`.
 *
 * A second spec rather than a shared one, because "what a project's milestones
 * may be filtered by" and "what projects may be filtered by" have nothing in
 * common but the word list. Sharing it would be the same mistake W5 names.
 */
export const MILESTONE_LIST: ListSpec = {
  sortable: ["dueDate", "name", "status"],
  filterable: {
    status: { kind: "enum", values: Object.values(MilestoneStatus) },
    dueDate: { kind: "date" },
    isBillingTrigger: { kind: "boolean" },
    phase: { kind: "enum", values: Object.values(SiaPhase) },
  },
  searchable: ["name"],
  defaultSort: { field: "dueDate", dir: "asc" },
};
