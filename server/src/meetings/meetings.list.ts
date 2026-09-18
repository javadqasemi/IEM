import {
  DecisionImpact,
  DecisionStatus,
  DecisionType,
  MeetingItemKind,
  MeetingStatus,
  MeetingType,
} from "@prisma/client";
import type { ListSpec } from "../core/list/list.spec-types";

/**
 * What a caller may sort, filter and search meetings by.
 *
 * **`startsAt` descending is the default, and it is the one place this list
 * disagrees with both of the others.** A project list opens on what you were
 * last working on and a task list on what is due; a meeting list opens on the
 * one that just happened, because the reason somebody opens it is to write up
 * or read the last Bausitzung. Ascending would show the Kickoff from 2024.
 */
export const MEETING_LIST: ListSpec = {
  sortable: ["startsAt", "title", "type", "status", "seriesNumber", "updatedAt", "createdAt"],

  filterable: {
    type: { kind: "enum", values: Object.values(MeetingType) },
    status: { kind: "enum", values: Object.values(MeetingStatus) },

    projectId: { kind: "string" },
    project: { kind: "string", path: "project.name" },
    organiserId: { kind: "string" },
    organiser: { kind: "string", path: "organiser.lastName" },

    /** `filter[seriesNumber]=eq:14` — "Bausitzung 14", as it is asked for. */
    seriesNumber: { kind: "number" },

    startsAt: { kind: "date" },
    updatedAt: { kind: "date" },

    /**
     * Whether the minutes have gone out.
     *
     * `filter[minutesSentAt]=isnull:true` on a held meeting is the queue a
     * Projektleiter works through on a Friday, and it is the question the
     * module was asked for. Expressed with the contract's own operator rather
     * than a dedicated `pending` key, for the reason `TASK_LIST` gives about
     * `overdue`: a second definition is one that can disagree with the first.
     */
    minutesSentAt: { kind: "date" },
  },

  searchable: ["title", "location"],
  defaultSort: { field: "startsAt", dir: "desc" },
};

/**
 * The protocol sub-list, for `/meetings/:id/items`.
 *
 * Its own spec rather than a shared one — "what a protocol's lines may be
 * filtered by" and "what meetings may be filtered by" have nothing in common
 * but the word list.
 *
 * **`disciplineId` is the field this spec exists for.** "Alle offenen Pendenzen
 * für Lüftung über alle Bausitzungen" is the question `data-model.md` §3.11
 * names, and it is a filter on `kind` and `disciplineId` rather than a person
 * re-reading twelve protocols.
 */
export const MEETING_ITEM_LIST: ListSpec = {
  sortable: ["order", "dueDate", "createdAt"],
  filterable: {
    kind: { kind: "enum", values: Object.values(MeetingItemKind) },
    disciplineId: { kind: "string" },
    discipline: { kind: "string", path: "discipline.code" },
    responsibleId: { kind: "string" },
    agendaItemId: { kind: "string" },
    taskId: { kind: "string" },
    dueDate: { kind: "date" },
  },
  searchable: ["text"],
  defaultSort: { field: "order", dir: "asc" },
};

/**
 * What a caller may sort, filter and search decisions by.
 *
 * A separate list because a decision is a separate record with a separate life:
 * it is found by number, by Gewerk and by what it cost, months after the
 * meeting that produced it — which is the whole argument for it not being a
 * line inside a protocol.
 */
export const DECISION_LIST: ListSpec = {
  sortable: ["number", "decidedAt", "title", "status", "type", "impact", "updatedAt"],

  filterable: {
    status: { kind: "enum", values: Object.values(DecisionStatus) },
    type: { kind: "enum", values: Object.values(DecisionType) },
    impact: { kind: "enum", values: Object.values(DecisionImpact) },

    projectId: { kind: "string" },
    project: { kind: "string", path: "project.name" },
    meetingId: { kind: "string" },
    disciplineId: { kind: "string" },
    discipline: { kind: "string", path: "discipline.code" },
    decidedById: { kind: "string" },

    decidedAt: { kind: "date" },
    costImpact: { kind: "number" },
    scheduleImpactDays: { kind: "number" },

    /**
     * `filter[supersedesId]=isnull:false` — every decision that reversed
     * another. The shortest possible answer to "was haben wir zurückgenommen",
     * and it needs no key of its own.
     */
    supersedesId: { kind: "string" },
  },

  /**
   * The rationale is searchable, and that is the point of requiring it.
   *
   * "Warum haben wir damals die Lüftung umgebaut" is answered by searching the
   * *reasons*, not the titles — a title says what was decided and the rationale
   * says why, and only one of them contains the word somebody remembers.
   */
  searchable: ["number", "title", "rationale"],
  defaultSort: { field: "decidedAt", dir: "desc" },
};
