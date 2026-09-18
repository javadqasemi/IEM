import { afterEach, describe, expect, it, vi } from "vitest";
import {
  toAttendanceBody,
  toCreateDecisionBody,
  toCreateMeetingBody,
  toDecision,
  toDecisionDetail,
  toItemBody,
  toItemUpdateBody,
  toMeeting,
  toMeetingDetail,
  toMeetingStats,
  toUpdateMeetingBody,
  toVersion,
} from "../mapper";
import type { DecisionDetailDto, DecisionDto, MeetingDetailDto, MeetingDto } from "../dto";

/**
 * The mapper, in both directions.
 *
 * This is the layer that decides what a screen is allowed to assume, and every
 * test here guards a bug that would otherwise happen *somewhere else*:
 *
 * | | |
 * | --- | --- |
 * | Dates | `"2026-09-10T…" < someDate` compares a string to an object and never throws |
 * | `null` dates | `new Date(null)` is 1 January 1970, silently |
 * | Open strings | a `switch` with no case for a value the server already sends |
 * | `costImpact` | parsing it is the first step toward adding it up in floating point |
 * | `undefined` vs `null` | a naive spread destroys the distinction that makes `PATCH` work |
 * | Local date parts | `toISOString()` shifts a date typed in Zürich back a day for most of the year |
 */

/* ---- Builders ------------------------------------------------------- */

function meetingDto(over: Partial<MeetingDto> = {}): MeetingDto {
  return {
    id: "m1",
    title: "Bausitzung",
    type: "BAUSITZUNG",
    status: "PLANNED",
    location: "Baubüro",
    seriesNumber: 14,
    label: "Bausitzung 14",
    startsAt: "2026-09-20T13:00:00.000Z",
    endsAt: null,
    minutesSentAt: null,
    version: 1,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: null,
    project: null,
    organiser: null,
    counts: { attendees: 0, agenda: 0, items: 0, approvals: 0 },
    ...over,
  };
}

function decisionDto(over: Partial<DecisionDto> = {}): DecisionDto {
  return {
    id: "d1",
    number: "E-2026-017",
    title: "Steigzone Ost",
    type: "TECHNISCH",
    status: "ENTSCHIEDEN",
    impact: "KOSTEN",
    costImpact: "48000.00",
    scheduleImpactDays: 10,
    decidedAt: "2026-09-10T00:00:00.000Z",
    decidedByExternal: null,
    version: 1,
    createdAt: null,
    updatedAt: null,
    supersedesId: null,
    project: null,
    decidedBy: null,
    discipline: null,
    meeting: null,
    ...over,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/* ================================================================== */

describe("toMeeting", () => {
  it("turns every timestamp into a Date", () => {
    const meeting = toMeeting(meetingDto({ minutesSentAt: "2026-09-21T09:00:00.000Z" }));
    expect(meeting.startsAt).toBeInstanceOf(Date);
    expect(meeting.minutesSentAt).toBeInstanceOf(Date);
    expect(meeting.createdAt).toBeInstanceOf(Date);
  });

  /**
   * The one that is silent. `new Date(null)` is 1 January 1970 — a meeting
   * whose minutes "were sent" during the Nixon administration, rendered without
   * complaint in a column somebody scans.
   */
  it("keeps a null date as null rather than as 1970", () => {
    const meeting = toMeeting(meetingDto({ endsAt: null, minutesSentAt: null, updatedAt: null }));
    expect(meeting.endsAt).toBeNull();
    expect(meeting.minutesSentAt).toBeNull();
    expect(meeting.updatedAt).toBeNull();
  });

  /**
   * `label` is the server's. A second assembly on this side is the one that
   * renders "Bausitzung null" the day a meeting has no series number.
   */
  it("passes the label through rather than assembling it", () => {
    expect(toMeeting(meetingDto({ label: "Kickoff", seriesNumber: null })).label).toBe("Kickoff");
  });

  it("narrows an unknown status to a default and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const meeting = toMeeting(meetingDto({ status: "POSTPONED" }));

    // The least-bad of three options: throwing would blank the list because one
    // row came from a newer server, and mapping it silently would hide a
    // deployment skew.
    expect(meeting.status).toBe("PLANNED");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("copies nested objects rather than sharing the cache's", () => {
    const dto = meetingDto({ counts: { attendees: 3, agenda: 2, items: 9, approvals: 0 } });
    const meeting = toMeeting(dto);
    meeting.counts.items = 0;
    // An entity sharing a DTO's object is one mutation away from changing what
    // another screen is reading.
    expect(dto.counts.items).toBe(9);
  });
});

describe("toMeetingStats", () => {
  it("fills every status key, so a status with no rows reads as 0", () => {
    // The endpoint returns only the statuses that have rows; a missing key would
    // render as nothing where 0 is the answer.
    const stats = toMeetingStats({ byStatus: { HELD: 4 }, total: 4, minutesPending: 2 });
    expect(stats.byStatus.PLANNED).toBe(0);
    expect(stats.byStatus.CANCELLED).toBe(0);
    expect(stats.byStatus.HELD).toBe(4);
    expect(stats.minutesPending).toBe(2);
  });
});

describe("toDecision", () => {
  /**
   * The money rule, and it is the one worth a test of its own: `costImpact`
   * stays the decimal string the server sent. Parsing it is the first step
   * toward adding it up, and a column of decision costs that ends in eleven
   * decimals is a column nobody trusts.
   */
  it("leaves costImpact a string", () => {
    const decision = toDecision(decisionDto({ costImpact: "48000.00" }));
    expect(decision.costImpact).toBe("48000.00");
    expect(typeof decision.costImpact).toBe("string");
  });

  it("keeps an unpriced decision unpriced rather than zero", () => {
    expect(toDecision(decisionDto({ costImpact: null })).costImpact).toBeNull();
  });

  it("keeps a schedule impact of zero, which is not the same as none", () => {
    // "wir haben geprüft, es kostet keine Zeit" and "niemand hat es angeschaut"
    // are different answers.
    expect(toDecision(decisionDto({ scheduleImpactDays: 0 })).scheduleImpactDays).toBe(0);
    expect(toDecision(decisionDto({ scheduleImpactDays: null })).scheduleImpactDays).toBeNull();
  });

  it("turns decidedAt into a Date", () => {
    expect(toDecision(decisionDto()).decidedAt).toBeInstanceOf(Date);
  });
});

describe("toDecisionDetail", () => {
  function detailDto(over: Partial<DecisionDetailDto> = {}): DecisionDetailDto {
    return {
      ...decisionDto(),
      rationale: "Weil der Schacht sonst durch den Lift läuft.",
      projectId: "p1",
      meetingId: null,
      disciplineId: null,
      decidedById: null,
      createdById: null,
      updatedById: null,
      supersedes: null,
      supersededBy: null,
      item: null,
      ...over,
    };
  }

  it("maps both directions of a supersession", () => {
    const decision = toDecisionDetail(
      detailDto({
        supersedes: { id: "d0", number: "E-2026-004", title: "alt", status: "AUFGEHOBEN" },
        supersededBy: { id: "d2", number: "E-2026-031", title: "neu", status: "ENTSCHIEDEN" },
      }),
    );

    // Both, because they answer different questions: what this one replaced,
    // and — the one that matters when reading an old decision — what replaced
    // it.
    expect(decision.supersedes?.number).toBe("E-2026-004");
    expect(decision.supersededBy?.number).toBe("E-2026-031");
  });

  it("keeps the rationale verbatim", () => {
    const text = "Zeile eins.\n\nZeile zwei.";
    expect(toDecisionDetail(detailDto({ rationale: text })).rationale).toBe(text);
  });
});

describe("toMeetingDetail", () => {
  function detailDto(over: Partial<MeetingDetailDto> = {}): MeetingDetailDto {
    return {
      ...meetingDto(),
      projectId: null,
      organiserId: null,
      createdById: null,
      updatedById: null,
      attendees: [],
      agenda: [],
      items: [],
      approvals: [],
      allowedTransitions: ["HELD", "CANCELLED"],
      protocolLocked: false,
      ...over,
    };
  }

  /**
   * Both come from the server with the record, and neither is recomputed here.
   * A second copy of the transition table would go stale without anything
   * failing — the dropdown would simply start offering something the API
   * refuses.
   */
  it("passes allowedTransitions and protocolLocked through", () => {
    const meeting = toMeetingDetail(detailDto({ protocolLocked: true }));
    expect(meeting.allowedTransitions).toEqual(["HELD", "CANCELLED"]);
    expect(meeting.protocolLocked).toBe(true);
  });

  it("keeps a protocol line's key rather than assembling it", () => {
    const meeting = toMeetingDetail(
      detailDto({
        items: [
          {
            id: "i1",
            order: 3,
            key: "14.3",
            text: "x",
            kind: "PENDENZ",
            agendaItemId: null,
            dueDate: "2026-10-01T00:00:00.000Z",
            responsible: null,
            discipline: null,
            task: null,
            decision: null,
          },
        ],
      }),
    );

    // `14.3` is derived on the server from the series number and the order. A
    // second derivation here goes wrong the first time a line is inserted, and
    // it goes wrong silently, in a document somebody quotes.
    expect(meeting.items[0].key).toBe("14.3");
    expect(meeting.items[0].dueDate).toBeInstanceOf(Date);
  });

  it("keeps `attended: false` distinct from `attended: null`", () => {
    const meeting = toMeetingDetail(
      detailDto({
        attendees: [
          {
            id: "a1",
            required: true,
            invitedAt: null,
            attended: false,
            apologised: false,
            employee: null,
            externalName: "M. Brunner",
            externalOrg: null,
            name: "M. Brunner",
            organisation: null,
          },
          {
            id: "a2",
            required: true,
            invitedAt: null,
            attended: null,
            apologised: false,
            employee: null,
            externalName: "R. Frei",
            externalOrg: null,
            name: "R. Frei",
            organisation: null,
          },
        ],
      }),
    );

    // Invited-and-absent versus not-recorded. A mapper that coerced either into
    // a boolean would make the protocol claim something nobody checked.
    expect(meeting.attendees[0].attended).toBe(false);
    expect(meeting.attendees[1].attended).toBeNull();
  });
});

describe("toVersion", () => {
  it("copies `changed` rather than sharing the DTO's array", () => {
    const dto = {
      version: 3,
      label: "v3",
      changed: ["startsAt"],
      note: null,
      changedByName: null,
      createdAt: "2026-09-02T08:00:00.000Z",
    };
    const version = toVersion(dto);
    version.changed.push("title");
    expect(dto.changed).toEqual(["startsAt"]);
    expect(version.createdAt).toBeInstanceOf(Date);
  });
});

/* ================================================================== */
/* Entity → request body                                               */
/* ================================================================== */

describe("toCreateMeetingBody", () => {
  it("sends the start as a full instant, because a meeting has a time", () => {
    const body = toCreateMeetingBody({
      title: "Bausitzung",
      startsAt: new Date("2026-09-20T13:00:00.000Z"),
    });
    // A date part would put every Bausitzung at midnight.
    expect(body.startsAt).toBe("2026-09-20T13:00:00.000Z");
  });

  it("omits what was not supplied rather than sending null", () => {
    const body = toCreateMeetingBody({
      title: "Bausitzung",
      startsAt: new Date("2026-09-20T13:00:00.000Z"),
      location: null,
      projectId: null,
      seriesNumber: null,
    });

    // The create endpoint has no "clear it" case, so a `null` from a form
    // control becomes omission rather than an explicit null the DTO rejects.
    // `seriesNumber` absent is what makes the server allocate the next one.
    expect("location" in body).toBe(false);
    expect("projectId" in body).toBe(false);
    expect("seriesNumber" in body).toBe(false);
  });
});

describe("toUpdateMeetingBody", () => {
  /**
   * The distinction the whole `PATCH` rests on, and the one a naive spread
   * destroys. It is also the shape of the bug that made a version row list all
   * sixteen fields for a one-field edit — see `core/versioning/changed.ts`.
   */
  it("keeps an explicit null but drops an absent field", () => {
    const body = toUpdateMeetingBody({ expectedVersion: 7, location: null });

    expect(body.expectedVersion).toBe(7);
    expect(body.location).toBeNull();
    expect("title" in body).toBe(false);
    expect("organiserId" in body).toBe(false);
    expect("seriesNumber" in body).toBe(false);
  });

  it("never drops the expected version", () => {
    // A lock a caller may omit is one every caller omits exactly once, and the
    // failure is the single data-loss bug a user cannot detect or report.
    const body = toUpdateMeetingBody({ expectedVersion: 1 });
    expect(body.expectedVersion).toBe(1);
  });
});

describe("toItemBody", () => {
  /**
   * A protocol line's date is a **day** — "bis zur nächsten Sitzung" — unlike
   * the meeting's own start time. It crosses as a local date part, because
   * `toISOString()` on a date typed in Zürich lands on the previous day for
   * most of the year.
   */
  it("sends a due date as a local date part", () => {
    const body = toItemBody({
      text: "Offerte einholen",
      kind: "PENDENZ",
      // Local midnight — the value an `<input type="date">` produces.
      dueDate: new Date(2026, 9, 1),
    });
    expect(body.dueDate).toBe("2026-10-01");
  });

  it("omits the date entirely when there is none", () => {
    const body = toItemBody({ text: "Information", dueDate: null });
    expect("dueDate" in body).toBe(false);
  });
});

describe("toItemUpdateBody", () => {
  it("can clear a line's date, unlike the create body", () => {
    // On an update, `null` is a real instruction: "die Frist ist weg".
    const body = toItemUpdateBody({ dueDate: null });
    expect(body.dueDate).toBeNull();
  });

  it("drops fields the caller did not touch", () => {
    const body = toItemUpdateBody({ text: "korrigiert" });
    expect(body.text).toBe("korrigiert");
    expect("kind" in body).toBe(false);
    expect("responsibleId" in body).toBe(false);
  });
});

describe("toCreateDecisionBody", () => {
  it("sends decidedAt as a day, not an instant", () => {
    // "Entschieden am 10. September". The time it was said is not recorded and
    // would be invented by an ISO timestamp.
    const body = toCreateDecisionBody({
      title: "Steigzone",
      rationale: "x".repeat(25),
      projectId: "p1",
      decidedAt: new Date(2026, 8, 10),
    });
    expect(body.decidedAt).toBe("2026-09-10");
  });
});

describe("toAttendanceBody", () => {
  it("sends the whole room in one body", () => {
    const body = toAttendanceBody([
      { attendeeId: "a1", attended: true },
      { attendeeId: "a2", attended: null, apologised: true },
    ]);

    expect(body.attendance).toHaveLength(2);
    // `null` survives: it is "not recorded", which the server stores as such.
    expect(body.attendance[1].attended).toBeNull();
  });
});
