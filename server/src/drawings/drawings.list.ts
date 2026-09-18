import { DrawingFormat, DrawingStatus, DrawingType, SiaPhase } from "@prisma/client";
import { RevisionReason, TransmittalMedium, TransmittalPurpose } from "@prisma/client";
import type { ListSpec } from "../core/list/list.spec-types";

/**
 * What a caller may sort, filter and search plans by.
 *
 * **This is the module's headline feature, not its plumbing.**
 * `docs/data-model.md` §3.13 puts it plainly: discipline, building, floor,
 * system and rooms are not metadata for their own sake, they are what turn the
 * questions the office asks out loud into filters —
 *
 * > *Alle Lüftungspläne für OG2* · *jeder Plan, auf dem Raum 2.14 vorkommt* ·
 * > *alles zur Anlage H1* · *was muss neu ausgegeben werden, wenn OG2 sich ändert*
 *
 * Of those four, **two work today and two do not**, and the reason is
 * `Floor`, `Room` and `BuildingSystem` being Wave 2 module 6. Discipline and
 * building are here; floor, room and plant are not, and the last question —
 * the expensive one, whose answer is a transmittal list — waits with them.
 * Saying so is better than a filter key that quietly matches nothing.
 *
 * `number` ascending is the default, and it disagrees with all three modules
 * before it. A project list opens on what you were last working on, a task list
 * on what is due, a meeting list on what just happened; a **plan list opens as a
 * plan set**, because that is the artefact — `4723-HZG-EG-101` then `-102` then
 * `-103`, in the order they hang on the wall. Sorting by `updatedAt` would
 * shuffle a drawing register every time somebody fixed a title.
 */
export const DRAWING_LIST: ListSpec = {
  sortable: [
    "number",
    "title",
    "status",
    "type",
    "currentRevision",
    "issuedRevision",
    "updatedAt",
    "createdAt",
  ],

  filterable: {
    status: { kind: "enum", values: Object.values(DrawingStatus) },
    type: { kind: "enum", values: Object.values(DrawingType) },
    format: { kind: "enum", values: Object.values(DrawingFormat) },
    phase: { kind: "enum", values: Object.values(SiaPhase) },

    projectId: { kind: "string" },
    project: { kind: "string", path: "project.name" },

    /**
     * Two keys for one Gewerk, as the other modules have.
     *
     * `disciplineId` is a picker's answer; `discipline` is `LFT` typed into a
     * search box, which is how somebody actually asks for *alle Lüftungspläne*.
     */
    disciplineId: { kind: "string" },
    discipline: { kind: "string", path: "discipline.code" },

    buildingId: { kind: "string" },
    building: { kind: "string", path: "building.name" },

    drawnById: { kind: "string" },
    checkedById: { kind: "string" },
    approvedById: { kind: "string" },

    currentRevision: { kind: "string" },

    /**
     * What is *out there*, as opposed to what the office is drawing.
     *
     * A `string` filter rather than an enum for the same reason
     * `currentRevision` is one: a plan set may start at `C`, so the set of
     * labels is not closed. Filtering it to a letter answers *"welche Pläne
     * sind bei den Unternehmern auf Rev. B"*, and sorting on it beside
     * `currentRevision` is how the register shows the plans whose two columns
     * disagree — the ones that need reissuing.
     */
    issuedRevision: { kind: "string" },

    updatedAt: { kind: "date" },
    createdAt: { kind: "date" },
  },

  /**
   * The number first, and the title second.
   *
   * A plan is looked up by number far more often than by name — somebody has it
   * written on a printout or quoted in an e-mail. `changeNote` is deliberately
   * *not* searchable from here: it belongs to a revision, and a plan matching
   * because of something written in revision B three years ago is a result
   * nobody expects. `/drawings/revisions` searches those.
   */
  searchable: ["number", "title"],
  defaultSort: { field: "number", dir: "asc" },
};

/**
 * The revision sub-list, for `/drawings/revisions`.
 *
 * Its own endpoint because the interesting questions cross plans: *"was ist
 * diese Woche freigegeben worden"*, *"welche Revisionen gingen wegen eines
 * Fehlers raus"*. A revision list nested under one drawing answers none of them.
 */
export const REVISION_LIST: ListSpec = {
  sortable: ["revision", "createdAt", "releasedAt"],

  filterable: {
    drawingId: { kind: "string" },
    reason: { kind: "enum", values: Object.values(RevisionReason) },
    /**
     * `filter[releasedAt]=isnull:false` — everything released, without a second
     * boolean column. The same trick `minutesSentAt` uses, and it is why
     * `isnull` is one of the ten operators.
     */
    releasedAt: { kind: "date" },
    supersededAt: { kind: "date" },
    createdAt: { kind: "date" },
    drawnById: { kind: "string" },
    checkedById: { kind: "string" },
    discipline: { kind: "string", path: "drawing.discipline.code" },
    projectId: { kind: "string", path: "drawing.projectId" },
  },

  /** What changed, which is the whole point of the row. */
  searchable: ["changeNote", "revision"],
  defaultSort: { field: "createdAt", dir: "desc" },
};

/**
 * Planversand.
 *
 * `sentAt` descending, because the question is nearly always *"was ist zuletzt
 * rausgegangen"* — and, when it is not, it is *"was ging am 14. März raus"*,
 * which is a date filter rather than a sort.
 */
export const TRANSMITTAL_LIST: ListSpec = {
  sortable: ["number", "sentAt", "createdAt"],

  filterable: {
    projectId: { kind: "string" },
    project: { kind: "string", path: "project.name" },
    purpose: { kind: "enum", values: Object.values(TransmittalPurpose) },
    medium: { kind: "enum", values: Object.values(TransmittalMedium) },
    sentById: { kind: "string" },
    sentAt: { kind: "date" },
    /**
     * Who received it — a path through the join, so *"alles was an Müller ging"*
     * is a filter rather than a scan. Matching on the free-text name because
     * there is no `Contact` table to point at yet.
     */
    recipient: { kind: "string", path: "recipients.some.externalName" },
  },

  searchable: ["number", "note"],
  defaultSort: { field: "sentAt", dir: "desc" },
};
