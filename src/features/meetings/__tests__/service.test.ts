import { describe, expect, it } from "vitest";
import type {
  AgendaItem,
  Attendee,
  Decision,
  DecisionDetail,
  Meeting,
  MeetingDetail,
  MeetingItem,
} from "@/entities/meeting";
import {
  attendanceIncomplete,
  daysUntil,
  focusMeeting,
  groupProtocol,
  isLive,
  isReadOnly,
  itemsOfKind,
  minutesPending,
  openPendenzen,
  splitAttendance,
  supersessionNotice,
  totalCost,
} from "../service";

/**
 * The service, with no mocks at all — which is the property the layer was built
 * for. Every function here is pure over entity types, so a test is an input and
 * an expectation and nothing else.
 *
 * **What is deliberately not tested here is as telling as what is.** The
 * transition table, whether a protocol is closed, the `14.3` key and the
 * approval rules all live on the server and arrive with the record. A test here
 * asserting any of them would be asserting a second copy, which is the copy that
 * goes stale.
 */

/* ---- Builders. Only the fields each test actually reads. ------------- */

function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    id: "m1",
    title: "Bausitzung",
    type: "BAUSITZUNG",
    status: "PLANNED",
    location: null,
    seriesNumber: 14,
    label: "Bausitzung 14",
    startsAt: new Date("2026-09-20T13:00:00Z"),
    endsAt: null,
    minutesSentAt: null,
    version: 1,
    createdAt: null,
    updatedAt: null,
    project: null,
    organiser: null,
    counts: { attendees: 0, agenda: 0, items: 0, approvals: 0 },
    ...over,
  };
}

function item(over: Partial<MeetingItem> = {}): MeetingItem {
  return {
    id: "i1",
    order: 1,
    key: "14.1",
    text: "Steigzone wird nach Norden verschoben",
    kind: "INFORMATION",
    agendaItemId: null,
    dueDate: null,
    responsible: null,
    discipline: null,
    task: null,
    decision: null,
    ...over,
  };
}

function agenda(over: Partial<AgendaItem> = {}): AgendaItem {
  return { id: "a1", order: 1, title: "Stand Lüftung", note: null, durationMinutes: null, presenter: null, ...over };
}

function attendee(over: Partial<Attendee> = {}): Attendee {
  return {
    id: "at1",
    required: true,
    invitedAt: null,
    attended: null,
    apologised: false,
    employee: null,
    externalName: "M. Brunner",
    externalOrg: null,
    name: "M. Brunner",
    organisation: null,
    ...over,
  };
}

/* ================================================================== */

describe("groupProtocol", () => {
  it("files each line under the agenda item it was discussed against", () => {
    const groups = groupProtocol({
      agenda: [agenda({ id: "a1", order: 1 }), agenda({ id: "a2", order: 2, title: "Termine" })],
      items: [
        item({ id: "i1", agendaItemId: "a2", order: 1 }),
        item({ id: "i2", agendaItemId: "a1", order: 2 }),
      ],
    });

    // Agenda order, not line order: the document is read top to bottom by
    // Traktandum, whatever order the lines were typed in.
    expect(groups.map((g) => g.agenda?.id)).toEqual(["a1", "a2"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["i2"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["i1"]);
  });

  /**
   * The half that gets forgotten, and the reason this function exists at all.
   *
   * A naive group-by would silently drop every line that belongs to no agenda
   * item — and a Bausitzung produces "und noch etwas" every single time. The
   * reader would only notice by counting.
   */
  it("keeps lines that belong to no agenda item, in a group of their own, last", () => {
    const groups = groupProtocol({
      agenda: [agenda({ id: "a1" })],
      items: [item({ id: "i1", agendaItemId: "a1" }), item({ id: "i2", agendaItemId: null })],
    });

    expect(groups).toHaveLength(2);
    expect(groups[1].agenda).toBeNull();
    expect(groups[1].items.map((i) => i.id)).toEqual(["i2"]);
  });

  it("keeps an agenda item that was never reached, with no lines", () => {
    // An empty Traktandum is a fact about the meeting — it was on the list and
    // did not get discussed. Dropping it would rewrite the agenda after the
    // event.
    const groups = groupProtocol({ agenda: [agenda({ id: "a1" })], items: [] });
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toEqual([]);
  });

  it("rescues a line whose agenda item is gone rather than losing it", () => {
    // Belt and braces: the server nulls `agendaItemId` when an agenda item is
    // deleted, so this branch should never fire. It is the branch that keeps a
    // line visible if it ever does.
    const groups = groupProtocol({
      agenda: [agenda({ id: "a1" })],
      items: [item({ id: "orphan", agendaItemId: "deleted" })],
    });

    expect(groups[groups.length - 1].agenda).toBeNull();
    expect(groups[groups.length - 1].items.map((i) => i.id)).toEqual(["orphan"]);
  });

  it("produces no loose group when every line has a home", () => {
    const groups = groupProtocol({
      agenda: [agenda({ id: "a1" })],
      items: [item({ agendaItemId: "a1" })],
    });
    expect(groups.every((g) => g.agenda !== null)).toBe(true);
  });
});

describe("openPendenzen", () => {
  const base = { items: [] as MeetingItem[] };

  it("counts only Pendenzen, never Informationen or Entscheide", () => {
    const result = openPendenzen({
      items: [
        item({ id: "p", kind: "PENDENZ" }),
        item({ id: "i", kind: "INFORMATION" }),
        item({ id: "e", kind: "ENTSCHEID" }),
      ],
    });
    expect(result.map((i) => i.id)).toEqual(["p"]);
  });

  it("drops a Pendenz whose task is done or cancelled", () => {
    const result = openPendenzen({
      items: [
        item({ id: "done", kind: "PENDENZ", task: { id: "t", title: "x", status: "DONE", dueDate: null } }),
        item({
          id: "cancelled",
          kind: "PENDENZ",
          task: { id: "t", title: "x", status: "CANCELLED", dueDate: null },
        }),
        item({
          id: "doing",
          kind: "PENDENZ",
          task: { id: "t", title: "x", status: "IN_PROGRESS", dueDate: null },
        }),
      ],
    });
    expect(result.map((i) => i.id)).toEqual(["doing"]);
  });

  /**
   * The judgement call, asserted so it cannot be "simplified" away.
   *
   * A Pendenz with no task counts as **open**: the line says somebody owes
   * something, and "no task" means the link was declined, not that the work is
   * done. Treating it as closed would let a protocol under-report itself by
   * exactly the lines somebody chose not to track.
   */
  it("counts a Pendenz with no task as open", () => {
    const result = openPendenzen({ items: [item({ kind: "PENDENZ", task: null })] });
    expect(result).toHaveLength(1);
  });

  it("is empty for a meeting with no lines", () => {
    expect(openPendenzen(base)).toEqual([]);
  });
});

describe("itemsOfKind", () => {
  it("keeps protocol order", () => {
    const result = itemsOfKind(
      { items: [item({ id: "b", order: 2, kind: "PENDENZ" }), item({ id: "a", order: 1, kind: "PENDENZ" })] },
      "PENDENZ",
    );
    // The service does not sort — the server sends them ordered, and a second
    // sort here would be a second opinion about a sequence the key depends on.
    expect(result.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("splitAttendance", () => {
  /**
   * Four groups, not three, and the fourth is the whole point: `null` is not
   * `false`. A protocol that printed unrecorded people as absent would make a
   * claim nobody checked, on a document that gets quoted.
   */
  it("separates unrecorded from absent", () => {
    const groups = splitAttendance([
      attendee({ id: "present", attended: true }),
      attendee({ id: "absent", attended: false }),
      attendee({ id: "unrecorded", attended: null }),
    ]);

    expect(groups.present.map((a) => a.id)).toEqual(["present"]);
    expect(groups.absent.map((a) => a.id)).toEqual(["absent"]);
    expect(groups.unrecorded.map((a) => a.id)).toEqual(["unrecorded"]);
  });

  it("puts an apologised person in one group only, whatever `attended` says", () => {
    const groups = splitAttendance([
      attendee({ id: "a", attended: false, apologised: true }),
      attendee({ id: "b", attended: null, apologised: true }),
    ]);

    expect(groups.apologised.map((a) => a.id)).toEqual(["a", "b"]);
    expect(groups.absent).toEqual([]);
    expect(groups.unrecorded).toEqual([]);
  });

  it("counts somebody who apologised and then turned up as present", () => {
    // It happens, and "anwesend" is what the protocol should say — the apology
    // was overtaken by the fact.
    const groups = splitAttendance([attendee({ attended: true, apologised: true })]);
    expect(groups.present).toHaveLength(1);
    expect(groups.apologised).toEqual([]);
  });
});

describe("attendanceIncomplete", () => {
  it("is true only when nobody at all is recorded", () => {
    expect(attendanceIncomplete([attendee(), attendee({ id: "b" })])).toBe(true);
    expect(attendanceIncomplete([attendee(), attendee({ id: "b", attended: true })])).toBe(false);
  });

  it("is false for an empty list", () => {
    // Nobody invited is not the same as nobody recorded, and the server's rule
    // says the same: it only refuses when there *are* attendees.
    expect(attendanceIncomplete([])).toBe(false);
  });
});

describe("minutesPending", () => {
  it("is true only for a held meeting whose minutes have not gone out", () => {
    expect(minutesPending({ status: "HELD", minutesSentAt: null })).toBe(true);
    expect(minutesPending({ status: "HELD", minutesSentAt: new Date() })).toBe(false);
    expect(minutesPending({ status: "PLANNED", minutesSentAt: null })).toBe(false);
    expect(minutesPending({ status: "CANCELLED", minutesSentAt: null })).toBe(false);
  });
});

describe("daysUntil", () => {
  const now = new Date("2026-09-18T22:00:00");

  it("counts whole days from midnight, so today is 0 all day", () => {
    // From *now* would make a meeting at 09:00 today read as "-1 Tage" by the
    // afternoon, which is the bug this measures against midnight to avoid.
    expect(daysUntil(new Date("2026-09-18T09:00:00"), now)).toBe(0);
    expect(daysUntil(new Date("2026-09-19T08:00:00"), now)).toBe(1);
    expect(daysUntil(new Date("2026-09-15T08:00:00"), now)).toBe(-3);
  });

  it("is null for no date", () => {
    expect(daysUntil(null, now)).toBeNull();
  });
});

describe("focusMeeting", () => {
  const now = new Date("2026-09-18T12:00:00Z");

  it("prefers the next planned meeting", () => {
    const result = focusMeeting(
      [
        meeting({ id: "far", startsAt: new Date("2026-10-01T08:00:00Z") }),
        meeting({ id: "near", startsAt: new Date("2026-09-20T08:00:00Z") }),
        meeting({ id: "past", status: "HELD", startsAt: new Date("2026-09-10T08:00:00Z") }),
      ],
      now,
    );
    expect(result?.id).toBe("near");
  });

  it("falls back to the most recent one held", () => {
    const result = focusMeeting(
      [
        meeting({ id: "old", status: "HELD", startsAt: new Date("2026-08-01T08:00:00Z") }),
        meeting({ id: "recent", status: "HELD", startsAt: new Date("2026-09-10T08:00:00Z") }),
      ],
      now,
    );
    expect(result?.id).toBe("recent");
  });

  it("ignores a planned meeting that is already in the past", () => {
    // A Bausitzung nobody marked as held is not "the next one" — it is an
    // oversight, and pointing at it as the next meeting would hide the real one.
    const result = focusMeeting(
      [
        meeting({ id: "stale", status: "PLANNED", startsAt: new Date("2026-09-01T08:00:00Z") }),
        meeting({ id: "held", status: "HELD", startsAt: new Date("2026-09-10T08:00:00Z") }),
      ],
      now,
    );
    expect(result?.id).toBe("held");
  });

  it("is null when there is nothing to point at", () => {
    expect(focusMeeting([], now)).toBeNull();
    expect(focusMeeting([meeting({ status: "CANCELLED" })], now)).toBeNull();
  });
});

/* ================================================================== */
/* Decisions                                                           */
/* ================================================================== */

function decision(over: Partial<DecisionDetail> = {}): DecisionDetail {
  return {
    id: "d1",
    number: "E-2026-017",
    title: "Steigzone Ost",
    type: "TECHNISCH",
    status: "ENTSCHIEDEN",
    impact: "KEINE",
    costImpact: null,
    scheduleImpactDays: null,
    decidedAt: new Date("2026-09-10T00:00:00Z"),
    decidedByExternal: null,
    version: 1,
    createdAt: null,
    updatedAt: null,
    supersedesId: null,
    project: null,
    decidedBy: null,
    discipline: null,
    meeting: null,
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

describe("isLive", () => {
  it("counts everything but a reversal", () => {
    expect(isLive("OFFEN")).toBe(true);
    expect(isLive("ENTSCHIEDEN")).toBe(true);
    expect(isLive("UMGESETZT")).toBe(true);
    expect(isLive("AUFGEHOBEN")).toBe(false);
  });
});

describe("isReadOnly", () => {
  it("closes a reversed decision and nothing else", () => {
    expect(isReadOnly({ status: "AUFGEHOBEN" })).toBe(true);
    expect(isReadOnly({ status: "UMGESETZT" })).toBe(false);
  });
});

describe("supersessionNotice", () => {
  /**
   * The case that matters. Somebody opening an old decision needs to be told
   * before they act on it, and the sentence names the successor because the next
   * question is always "by what".
   */
  it("names the successor of a reversed decision", () => {
    const notice = supersessionNotice(
      decision({
        status: "AUFGEHOBEN",
        supersededBy: { id: "d2", number: "E-2026-031", title: "x", status: "ENTSCHIEDEN" },
      }),
    );
    expect(notice).toContain("E-2026-031");
    expect(notice).toContain("aufgehoben");
  });

  it("says so plainly when a reversal has no successor attached", () => {
    // Should not happen — the server only reaches `AUFGEHOBEN` through
    // `supersede`, which always attaches one. Said out loud rather than hidden,
    // because a reversal with no successor is a data problem somebody needs to
    // see.
    const notice = supersessionNotice(decision({ status: "AUFGEHOBEN", supersededBy: null }));
    expect(notice).toContain("nicht verknüpft");
  });

  it("names what a decision replaces, looking the other way", () => {
    const notice = supersessionNotice(
      decision({ supersedes: { id: "d0", number: "E-2026-004", title: "x", status: "AUFGEHOBEN" } }),
    );
    expect(notice).toContain("ersetzt E-2026-004");
  });

  it("is null for an ordinary decision", () => {
    expect(supersessionNotice(decision())).toBeNull();
  });
});

describe("totalCost", () => {
  /**
   * Summed in integer Rappen and rendered back as a string, so nothing is ever
   * a float. `"48000.00" + "26500.00"` as numbers is `74500.00000000001` often
   * enough to appear in a report.
   */
  it("sums decimal strings without going through a float", () => {
    const total = totalCost([
      { costImpact: "48000.00" },
      { costImpact: "26500.50" },
      { costImpact: "0.50" },
    ]);
    expect(total).toBe("74501.00");
  });

  it("handles a negative figure as a saving", () => {
    expect(totalCost([{ costImpact: "10000.00" }, { costImpact: "-2500.25" }])).toBe("7499.75");
  });

  it("returns a negative total when the savings win", () => {
    expect(totalCost([{ costImpact: "-500.00" }, { costImpact: "100.00" }])).toBe("-400.00");
  });

  it("carries the Rappen correctly", () => {
    expect(totalCost([{ costImpact: "0.99" }, { costImpact: "0.02" }])).toBe("1.01");
  });

  it("treats a figure with no decimal part as whole francs", () => {
    expect(totalCost([{ costImpact: "1200" }])).toBe("1200.00");
  });

  /**
   * `null` rather than `"0.00"`, and the distinction is the point: a total of
   * zero and "nobody priced any of these" are different answers, and only one of
   * them should be printed as a figure.
   */
  it("is null when nothing in the set carries a figure", () => {
    expect(totalCost([{ costImpact: null }, { costImpact: null }])).toBeNull();
    expect(totalCost([])).toBeNull();
  });

  it("ignores the unpriced rows rather than counting them as zero", () => {
    expect(totalCost([{ costImpact: "100.00" }, { costImpact: null }])).toBe("100.00");
  });
});

/* A compile-time check that the builders match the real types. */
const _detail: MeetingDetail = {
  ...meeting(),
  projectId: null,
  organiserId: null,
  createdById: null,
  updatedById: null,
  attendees: [],
  agenda: [],
  items: [],
  approvals: [],
  allowedTransitions: [],
  protocolLocked: false,
};
const _decision: Decision = decision();
void _detail;
void _decision;
