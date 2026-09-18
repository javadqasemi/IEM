import { ApplicationStatus } from "@prisma/client";
import type { ListSpec } from "../core/list/list.spec-types";

/**
 * What a caller may sort, filter and search this resource by.
 *
 * The reference `ListSpec` — one of these sits beside every resource once F11
 * has been copied outward, and it is the whole of what a module has to decide
 * about its list.
 *
 * **It is an allowlist and the omissions are deliberate.** `note` is the
 * internal comment and `message` is the applicant's own text; neither is
 * filterable, because a filter is a URL somebody can share and both are free
 * text that may contain anything a person wrote about a person. `q` searches
 * the four identifying fields and not those two, for the same reason.
 */
export const APPLICATION_LIST: ListSpec = {
  sortable: ["createdAt", "lastName", "position", "status", "retainUntil"],

  filterable: {
    status: { kind: "enum", values: Object.values(ApplicationStatus) },
    position: { kind: "string" },
    createdAt: { kind: "date" },
    /**
     * The one that earns the whole contract.
     *
     * `filter[retainUntil]=lte:2026-10-01` is "everything that will be deleted
     * within the month", which is the question the retention rule creates and
     * which no amount of client-side sorting could answer — the rows are on
     * page nine.
     */
    retainUntil: { kind: "date" },
    email: { kind: "string" },
    lastName: { kind: "string" },
  },

  searchable: ["firstName", "lastName", "email", "position"],

  defaultSort: { field: "createdAt", dir: "desc" },

  /**
   * Fifty rather than the global two hundred.
   *
   * A dossier row carries the applicant's name, address and file list; two
   * hundred of them is a lot of personal data in one response for a screen
   * that shows twenty.
   */
  maxPerPage: 50,
};
