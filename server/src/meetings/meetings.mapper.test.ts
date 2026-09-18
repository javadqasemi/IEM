import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  DECISION_DETAIL_SELECT,
  DECISION_LIST_SELECT,
  MEETING_DETAIL_SELECT,
  MEETING_LIST_SELECT,
  toDecisionAuditSnapshot,
  toDecisionCreateData,
  toDecisionDetail,
  toDecisionExportRow,
  toDecisionListItem,
  toDecisionUpdateData,
  toMeetingAuditSnapshot,
  toMeetingCreateData,
  toMeetingDetail,
  toMeetingExportRow,
  toMeetingListItem,
  toMeetingUpdateData,
  toMoney,
  toMoneyNumber,
} from "./meetings.mapper";

/**
 * The DTO boundary, both directions.
 *
 * Outbound first, because a `Decimal` that escapes renders as
 * `{"s":1,"e":6,"d":[…]}` — an object that reads in a network tab like a server
 * bug rather than a missing conversion. Inbound second, because that half is
 * where the silent failures are.
 */

const PERSON = { id: "e1", firstName: "Anna", lastName: "Meier", email: "anna@iem.ch" };

const meetingRow = (over: Record<string, unknown> = {}) =>
  ({
    id: "m1",
    title: "Bausitzung",
    type: "BAUSITZUNG",
    status: "HELD",
    location: "Baubüro",
    seriesNumber: 14,
    startsAt: new Date("2026-09-10T14:00:00Z"),
    endsAt: new Date("2026-09-10T15:30:00Z"),
    minutesSentAt: null,
    version: 2,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-11T00:00:00Z"),
    project: { id: "p1", number: "P-2026-001", name: "Guglera" },
    organiser: PERSON,
    _count: { attendees: 4, agenda: 3, items: 6, approvals: 1 },
    ...over,
  }) as never;

const meetingDetailRow = (over: Record<string, unknown> = {}) =>
  ({
    ...(meetingRow() as unknown as Record<string, unknown>),
    projectId: "p1",
    organiserId: "e1",
    createdById: "u1",
    updatedById: "u2",
    attendees: [],
    agenda: [],
    items: [],
    approvals: [],
    ...over,
  }) as never;

const decisionRow = (over: Record<string, unknown> = {}) =>
  ({
    id: "d1",
    number: "E-2026-017",
    title: "Lüftung OG2 wird umgebaut",
    type: "TECHNISCH",
    status: "ENTSCHIEDEN",
    impact: "KOSTEN",
    costImpact: new Prisma.Decimal("48000"),
    scheduleImpactDays: 10,
    decidedAt: new Date("2026-09-10T00:00:00Z"),
    decidedByExternal: null,
    version: 1,
    createdAt: new Date("2026-09-10T00:00:00Z"),
    updatedAt: new Date("2026-09-10T00:00:00Z"),
    supersedesId: null,
    project: { id: "p1", number: "P-2026-001", name: "Guglera" },
    decidedBy: PERSON,
    discipline: { id: "g1", code: "LFT", name: "Lüftung", defaultColour: "disc-air" },
    meeting: {
      id: "m1",
      title: "Bausitzung",
      seriesNumber: 14,
      startsAt: new Date("2026-09-10T14:00:00Z"),
    },
    ...over,
  }) as never;

const decisionDetailRow = (over: Record<string, unknown> = {}) =>
  ({
    ...(decisionRow() as unknown as Record<string, unknown>),
    rationale: "Weil die Nutzung wechselt.",
    projectId: "p1",
    meetingId: "m1",
    disciplineId: "g1",
    decidedById: "e1",
    createdById: "u1",
    updatedById: "u1",
    supersedes: null,
    supersededBy: null,
    item: null,
    ...over,
  }) as never;

/* ================================================================== */
/* The selects                                                         */
/* ================================================================== */

describe("the selects", () => {
  it("make each detail a superset of its list", () => {
    // The mappers spread the list item into the detail, so a field the list
    // select has and the detail lacks would be `undefined` on the detail —
    // which compiles and is invisible until somebody opens a record.
    for (const key of Object.keys(MEETING_LIST_SELECT)) {
      expect(MEETING_DETAIL_SELECT, key).toHaveProperty(key);
    }
    for (const key of Object.keys(DECISION_LIST_SELECT)) {
      expect(DECISION_DETAIL_SELECT, key).toHaveProperty(key);
    }
  });

  it("fetches counts and not rows on the meeting list", () => {
    // A list row shows "3 Traktanden · 6 Zeilen"; fetching the protocol for
    // every meeting on the page would be four joins per row for three numbers.
    expect(MEETING_LIST_SELECT).toHaveProperty("_count");
    expect(MEETING_LIST_SELECT).not.toHaveProperty("items");
    expect(MEETING_LIST_SELECT).not.toHaveProperty("attendees");
  });

  it("keeps the rationale off the decision list", () => {
    /**
     * It is up to 8'000 characters and a list of twenty-five would carry a
     * couple of hundred kilobytes of it to render a title. The detail has it,
     * and `DECISION_LIST.searchable` still searches it — searching a column is
     * not selecting it.
     */
    expect(DECISION_LIST_SELECT).not.toHaveProperty("rationale");
    expect(DECISION_DETAIL_SELECT).toHaveProperty("rationale");
  });
});

/* ================================================================== */
/* Outbound                                                            */
/* ================================================================== */

describe("toMeetingListItem", () => {
  it("assembles the label once", () => {
    /**
     * "Bausitzung 14" is how a meeting is referred to. Concatenating it in
     * every list, card and breadcrumb is three places that render
     * "Bausitzung null" the day a meeting has no series number.
     */
    expect(toMeetingListItem(meetingRow()).label).toBe("Bausitzung 14");
  });

  it("falls back to the title for a meeting with no series", () => {
    expect(toMeetingListItem(meetingRow({ seriesNumber: null })).label).toBe("Bausitzung");
  });

  it("turns dates into ISO strings with the timezone", () => {
    const out = toMeetingListItem(meetingRow());
    expect(out.startsAt).toBe("2026-09-10T14:00:00.000Z");
    expect(out.endsAt).toBe("2026-09-10T15:30:00.000Z");
    expect(out.minutesSentAt).toBeNull();
  });
});

describe("toMeetingDetail", () => {
  it("computes the citation key from the series number and the order", () => {
    /**
     * `14.3`, never stored — a stored key goes wrong the first time a line is
     * inserted, silently, in a document somebody quotes.
     */
    const out = toMeetingDetail(
      meetingDetailRow({
        items: [
          {
            id: "i1",
            order: 3,
            text: "Etwas",
            kind: "INFORMATION",
            agendaItemId: null,
            dueDate: null,
            responsible: null,
            discipline: null,
            task: null,
            decision: null,
          },
        ],
      }),
    );
    expect(out.items[0].key).toBe("14.3");
  });

  it("prints an external attendee by name and organisation", () => {
    /**
     * The Bauherr has no `Employee` row — the CRM is Wave 3 — and the protocol
     * has to print the attendance list whichever kind of attendee it is.
     */
    const out = toMeetingDetail(
      meetingDetailRow({
        attendees: [
          {
            id: "a1",
            required: true,
            invitedAt: null,
            attended: true,
            apologised: false,
            employee: null,
            externalName: "R. Bürgi",
            externalOrg: "Gemeinde Giffers",
          },
          {
            id: "a2",
            required: true,
            invitedAt: null,
            attended: true,
            apologised: false,
            employee: { ...PERSON, position: "Projektleiterin" },
            externalName: null,
            externalOrg: null,
          },
        ],
      }),
    );
    expect(out.attendees[0]).toMatchObject({ name: "R. Bürgi", organisation: "Gemeinde Giffers" });
    expect(out.attendees[1]).toMatchObject({ name: "Anna Meier", organisation: "IEM" });
  });

  it("renames defaultColour to colour on a protocol line's Gewerk", () => {
    // A token name, never a hex literal — the closed set of six.
    const out = toMeetingDetail(
      meetingDetailRow({
        items: [
          {
            id: "i1",
            order: 1,
            text: "Etwas",
            kind: "PENDENZ",
            agendaItemId: null,
            dueDate: new Date("2026-11-30T00:00:00Z"),
            responsible: PERSON,
            discipline: { id: "g1", code: "LFT", name: "Lüftung", defaultColour: "disc-air" },
            task: { id: "t1", title: "Etwas tun", status: "TODO", dueDate: null },
            decision: null,
          },
        ],
      }),
    );
    expect(out.items[0].discipline).toMatchObject({ colour: "disc-air" });
    expect(out.items[0].task).toMatchObject({ id: "t1", title: "Etwas tun" });
  });
});

describe("toDecisionListItem", () => {
  it("turns money into a string at the column's scale", () => {
    // `.toFixed(2)`: a Decimal stored as `48000.00` prints `48000` from
    // `.toString()`, and a figure that renders two ways reads as two numbers.
    expect(toDecisionListItem(decisionRow()).costImpact).toBe("48000.00");
  });

  it("returns null for no cost rather than zero", () => {
    // Zero is a figure somebody entered; null is one nobody did.
    expect(toDecisionListItem(decisionRow({ costImpact: null })).costImpact).toBeNull();
  });

  it("carries supersedesId so a list can mark a reversal", () => {
    expect(toDecisionListItem(decisionRow({ supersedesId: "d0" })).supersedesId).toBe("d0");
  });
});

describe("toDecisionDetail", () => {
  it("carries both ends of a reversal", () => {
    /**
     * `supersededBy` is the one that matters when reading an *old* decision:
     * "this was replaced by E-2026-031" is the sentence somebody needs, and
     * without it they act on a decision that no longer stands.
     */
    const out = toDecisionDetail(
      decisionDetailRow({
        status: "AUFGEHOBEN",
        supersededBy: { id: "d2", number: "E-2026-031", title: "Doch anders", status: "ENTSCHIEDEN" },
      }),
    );
    expect(out.supersededBy).toMatchObject({ number: "E-2026-031" });
  });
});

describe("the audit snapshots", () => {
  it("read the organiser from the column or the relation", () => {
    /**
     * The bug `projects.mapper.ts` documents: reading one shape only means
     * every `after` loses the field and the log records it being removed on
     * every edit. Nothing throws — it lies.
     */
    const fromColumn = toMeetingAuditSnapshot({
      title: "B",
      status: "HELD",
      startsAt: new Date(),
      organiserId: "e1",
    });
    const fromRelation = toMeetingAuditSnapshot({
      title: "B",
      status: "HELD",
      startsAt: new Date(),
      organiser: { id: "e1" },
    });
    expect(fromColumn.organiserId).toBe("e1");
    expect(fromRelation.organiserId).toBe("e1");
  });

  it("keep the rationale in a decision's snapshot", () => {
    /**
     * Changing *why* is the change a dispute cares about. A diff that omitted
     * it would show a decision being edited without saying what moved.
     */
    const snapshot = toDecisionAuditSnapshot({
      number: "E-2026-017",
      title: "T",
      status: "ENTSCHIEDEN",
      rationale: "Weil.",
    });
    expect(snapshot.rationale).toBe("Weil.");
  });
});

describe("the export rows", () => {
  it("name their own columns and write empty strings for nulls", () => {
    // A CSV cell holding `null` renders the four letters, and Excel sorts it
    // among the names.
    const row = toMeetingExportRow(
      meetingRow({ project: null, organiser: null, location: null, seriesNumber: null }),
    );
    expect(row.Projekt).toBe("");
    expect(row.Leitung).toBe("");
    expect(row.Nummer).toBe("");
  });

  it("fall back to the external decider when there is no employee", () => {
    const row = toDecisionExportRow(
      decisionRow({ decidedBy: null, decidedByExternal: "R. Bürgi" }),
    );
    expect(row["Entschieden von"]).toBe("R. Bürgi");
  });

  it("answer the reversal column in German", () => {
    expect(toDecisionExportRow(decisionRow({ supersedesId: "d0" })).Ersetzt).toBe("ja");
    expect(toDecisionExportRow(decisionRow()).Ersetzt).toBe("nein");
  });
});

/* ================================================================== */
/* Inbound                                                             */
/* ================================================================== */

describe("toMoney", () => {
  it("accepts a plain figure and two decimals", () => {
    expect(toMoney("48000", "Kostenfolge")!.toFixed(2)).toBe("48000.00");
    expect(toMoney("48000.50", "Kostenfolge")!.toFixed(2)).toBe("48000.50");
  });

  it("accepts a negative figure — a decision that saves money", () => {
    expect(toMoney("-12000", "Kostenfolge")!.toFixed(2)).toBe("-12000.00");
  });

  it("refuses a thousands separator with the field named", () => {
    // What a person types. Accepting it as NaN and storing null turns a typo
    // into a missing figure nobody notices until a report is short.
    expect(() => toMoney("48'000.00", "Kostenfolge")).toThrow(BadRequestException);
    try {
      toMoney("48'000.00", "Kostenfolge");
    } catch (error) {
      expect((error as Error).message).toContain("Kostenfolge");
    }
  });

  it("reads nothing as no figure", () => {
    expect(toMoney(null, "x")).toBeNull();
    expect(toMoney("", "x")).toBeNull();
  });

  it("returns a plain number through toMoneyNumber, so the rules never meet a Decimal", () => {
    // `meetings.rules.ts` is pure and `meetings.service.ts` imports no `Prisma`.
    const value = toMoneyNumber("48000.00", "Kostenfolge");
    expect(typeof value).toBe("number");
    expect(value).toBe(48000);
  });
});

describe("toMeetingUpdateData", () => {
  it("writes only what the body named", () => {
    const data = toMeetingUpdateData({ title: "Neu" }, "u1");
    expect(data).toEqual({ updatedById: "u1", title: "Neu" });
    expect(data).not.toHaveProperty("startsAt");
  });

  it("uses no relation operations at all", () => {
    /**
     * **Scalar foreign keys, never `connect`.** The optimistic lock needs the
     * version in the `where`, only `updateMany` allows that, and
     * `MeetingUncheckedUpdateInput` has no relation operations — a body
     * carrying `organiser: { connect: … }` is a runtime 500 that typechecks.
     * That exact failure shipped in Projects.
     */
    const data = toMeetingUpdateData({ organiserId: "e1" }, "u1");
    expect(data.organiserId).toBe("e1");
    expect(JSON.stringify(data)).not.toContain("connect");
  });

  it("clears the end time and the series number with null", () => {
    const data = toMeetingUpdateData({ endsAt: null, seriesNumber: null }, "u1");
    expect(data.endsAt).toBeNull();
    expect(data.seriesNumber).toBeNull();
  });
});

describe("toDecisionUpdateData", () => {
  it("refuses a malformed cost rather than writing zero", () => {
    expect(() => toDecisionUpdateData({ costImpact: "achtundvierzigtausend" }, "u1")).toThrow(
      BadRequestException,
    );
  });

  it("clears a cost with null", () => {
    expect(toDecisionUpdateData({ costImpact: null }, "u1").costImpact).toBeNull();
  });

  it("uses no relation operations", () => {
    const data = toDecisionUpdateData({ decidedById: "e1", disciplineId: "g1" }, "u1");
    expect(JSON.stringify(data)).not.toContain("connect");
  });
});

describe("the create mappers", () => {
  it("record the author as the first editor too", () => {
    // So `updatedById` is never null on a fresh row, which is what the conflict
    // message reads to say who saved first.
    const meeting = toMeetingCreateData(
      { title: "B", startsAt: "2026-10-01T14:00:00Z", projectId: null, seriesNumber: 1 },
      "u1",
    );
    expect(meeting.createdById).toBe("u1");
    expect(meeting.updatedById).toBe("u1");
  });

  it("write scalar foreign keys on a decision too", () => {
    const decision = toDecisionCreateData(
      {
        number: "E-2026-001",
        title: "T",
        rationale: "R",
        projectId: "p1",
        decidedAt: "2026-09-10",
      },
      "u1",
    );
    expect(decision.projectId).toBe("p1");
    expect(JSON.stringify(decision)).not.toContain("connect");
  });
});
