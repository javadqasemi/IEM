import { Priority, TaskStatus } from "@prisma/client";
import type { ListSpec } from "../core/list/list.spec-types";

/**
 * What a caller may sort, filter and search tasks by.
 *
 * Derived from `PROJECT_LIST` rather than copied: the contract is the same, and
 * the *choices* differ wherever a task differs from a project.
 *
 * **`assignee` and `project` filter by name, through `path`.** The same
 * argument the project list makes: a filter is a URL somebody shares, and
 * `filter[assigneeId]=eq:cm9x…` is a cuid nobody can read or recognise in a
 * bookmark. The id-based filters exist beside them because the board already
 * has the id in hand.
 *
 * **`overdue` is not here, and it is not an oversight.** Overdue is
 * `dueDate < now AND status open`, which the client expresses as
 * `filter[dueDate]=lt:<today>&filter[status]=in:TODO,IN_PROGRESS,IN_REVIEW,BLOCKED`
 * — two filters the contract already supports. A dedicated key would be a
 * *third* place the definition of "overdue" lives, beside `isOverdue` in the
 * rules and the sweep in `tasks.overdue.ts`, and the day they disagree the
 * list and the notification would be about different tasks.
 *
 * **`description` is searchable and there is no `notes` field to exclude.** The
 * project list keeps `notes` out of search because it is where somebody records
 * a problem with a client. A task has no such field: everything on it is what
 * the work is, and the discussion is in `Comment`, which is a separate resource
 * with its own permission.
 */
export const TASK_LIST: ListSpec = {
  sortable: [
    "title",
    "status",
    "priority",
    "dueDate",
    "startDate",
    "completedAt",
    "estimateHours",
    /**
     * On the sortable list although the board never uses it.
     *
     * `position` orders a *column*; a flat list sorted by it across statuses is
     * meaningless. It is here because `GET /tasks?filter[status]=eq:TODO&sort=position`
     * is exactly how the board fetches one column, and the alternative — a
     * separate board endpoint with its own ordering — would be a second list
     * contract for the same rows.
     */
    "position",
    "updatedAt",
    "createdAt",
  ],

  filterable: {
    status: { kind: "enum", values: Object.values(TaskStatus) },
    priority: { kind: "enum", values: Object.values(Priority) },

    projectId: { kind: "string" },
    project: { kind: "string", path: "project.name" },
    assigneeId: { kind: "string" },
    assignee: { kind: "string", path: "assignee.lastName" },
    milestoneId: { kind: "string" },
    disciplineId: { kind: "string" },
    /** `filter[discipline]=eq:LFT` — every open Lüftung task, across projects. */
    discipline: { kind: "string", path: "discipline.code" },
    createdById: { kind: "string" },

    /**
     * The one that makes the subtask tree navigable.
     *
     * `filter[parentTaskId]=eq:<id>` is a task's children; `filter[parentTaskId]=isnull:`
     * is the top level, which is what a board must show — otherwise every
     * checklist-sized subtask appears as a card beside its parent.
     */
    parentTaskId: { kind: "string" },

    dueDate: { kind: "date" },
    startDate: { kind: "date" },
    completedAt: { kind: "date" },
    updatedAt: { kind: "date" },
    estimateHours: { kind: "number" },
  },

  searchable: ["title", "description"],

  /**
   * Due first, and this is the one place the task list deliberately disagrees
   * with the project list.
   *
   * A project list opens on "what you were last working on" because a project
   * is a thing you return to. A task list is a queue, and what somebody wants
   * on opening it is what is due — `updatedAt` would put the card they just
   * dragged at the top, which is the one card they have already dealt with.
   *
   * Tasks with no date sort last, because `dir: "asc"` on a nullable column in
   * Postgres puts NULLs last by default — which is the right end for "somebody
   * has not decided when this is due".
   */
  defaultSort: { field: "dueDate", dir: "asc" },
};

/**
 * The checklist sub-list, for `/tasks/:id/checklist`.
 *
 * A second spec rather than a shared one, for the reason `MILESTONE_LIST`
 * gives: "what a task's checklist may be filtered by" and "what tasks may be
 * filtered by" have nothing in common but the word list.
 */
export const CHECKLIST_LIST: ListSpec = {
  sortable: ["position", "createdAt"],
  filterable: {
    done: { kind: "boolean" },
  },
  searchable: ["text"],
  defaultSort: { field: "position", dir: "asc" },
};
