import { describe, expect, it } from "vitest";
import { DecisionStatus, MeetingItemKind, MeetingStatus } from "@prisma/client";
import {
  DECISION_TRANSITIONS,
  MEETING_TRANSITIONS,
  formatDecisionNumber,
  itemKey,
  nextDecisionSequence,
  nextSeriesNumber,
  refuseApproval,
  refuseApprovalTiming,
  refuseDecision,
  refuseDecisionDate,
  refuseDecisionStatus,
  refuseItem,
  refuseProtocolEdit,
  refuseSupersede,
  refuseTimes,
  refuseTransition,
  transitionsFrom,
  wouldSupersedeCycle,
} from "./meetings.rules";

/**
 * The module's rules, exhaustively — because they can be.
 *
 * Two of them are the reason this module exists rather than a meetings table
 * with a text field, and both are the kind that get quietly relaxed if they
 * live inside a service: **an approved protocol cannot be edited**, and **a
 * reversal names its successor**. Everything else here is scaffolding around
 * those two.
 */

const nothing = { items: [], attendees: [] };

/* ================================================================== */
/* The meeting                                                         */
/* ================================================================== */

describe("the meeting transition table", () => {
  it("covers every status", () => {
    // A status added to the enum without a row would return `undefined` from
    // `MEETING_TRANSITIONS[from]`, and `refuseTransition` would throw on
    // `.includes` rather than refusing — a 500 where a 400 belongs.
    expect(Object.keys(MEETING_TRANSITIONS).sort()).toEqual(Object.values(MeetingStatus).sort());
  });

  it("cannot walk back from HELD to PLANNED", () => {
    /**
     * **The important absence.** Moving a held meeting back to planned would
     * let somebody reopen an approved protocol by changing a status, which is
     * the whole thing `refuseProtocolEdit` exists to prevent. A meeting marked
     * held by mistake is cancelled and re-created, which leaves both facts on
     * the record.
     */
    expect(transitionsFrom(MeetingStatus.HELD)).not.toContain(MeetingStatus.PLANNED);
    expect(transitionsFrom(MeetingStatus.HELD)).toEqual([MeetingStatus.CANCELLED]);
  });

  it("makes CANCELLED terminal", () => {
    // An uncancelled meeting is a new meeting.
    expect(MEETING_TRANSITIONS.CANCELLED).toEqual([]);
  });
});

describe("refuseTransition", () => {
  it("allows a no-op", () => {
    expect(refuseTransition(MeetingStatus.PLANNED, MeetingStatus.PLANNED, nothing)).toBeNull();
  });

  it("refuses a move the table does not list", () => {
    const refusal = refuseTransition(MeetingStatus.HELD, MeetingStatus.PLANNED, nothing);
    expect(refusal).toContain("HELD");
  });

  it("says a cancelled meeting is finished with rather than listing nothing", () => {
    expect(refuseTransition(MeetingStatus.CANCELLED, MeetingStatus.HELD, nothing)).toBe(
      "Eine abgesagte Sitzung kann nicht mehr geändert werden.",
    );
  });

  it("allows holding a meeting with an empty protocol", () => {
    /**
     * **Deliberate, and the rule people expect to be the other way round.**
     * Minutes are written in the days *after* a Bausitzung. Refusing to mark it
     * held until a protocol exists would mean the status lies for a week — or
     * that somebody types three placeholder lines to get past the check.
     */
    expect(refuseTransition(MeetingStatus.PLANNED, MeetingStatus.HELD, nothing)).toBeNull();
  });

  it("refuses a blank protocol line", () => {
    // A blank row is not a fact about anything.
    const refusal = refuseTransition(MeetingStatus.PLANNED, MeetingStatus.HELD, {
      items: [
        { kind: MeetingItemKind.INFORMATION, text: "Gut" },
        { kind: MeetingItemKind.INFORMATION, text: "   " },
      ],
      attendees: [{ attended: true }],
    });
    expect(refusal).toBe("1 Protokollzeile(n) haben keinen Text.");
  });

  it("refuses holding a meeting where nobody's attendance was recorded", () => {
    /**
     * "Wer war da" is the second question a protocol answers and the one that
     * is never reconstructable afterwards. `null` is not recorded; `false` is
     * invited and absent, which *is* a recorded fact.
     */
    const refusal = refuseTransition(MeetingStatus.PLANNED, MeetingStatus.HELD, {
      items: [],
      attendees: [{ attended: null }, { attended: null }],
    });
    expect(refusal).toContain("Anwesenheit");
  });

  it("accepts an attendance list where everybody was absent", () => {
    // Absent is recorded. A meeting nobody came to is a fact worth having.
    expect(
      refuseTransition(MeetingStatus.PLANNED, MeetingStatus.HELD, {
        items: [],
        attendees: [{ attended: false }, { attended: false }],
      }),
    ).toBeNull();
  });

  it("does not ask about attendance when there is nobody to ask about", () => {
    expect(
      refuseTransition(MeetingStatus.PLANNED, MeetingStatus.HELD, { items: [], attendees: [] }),
    ).toBeNull();
  });

  it("checks nothing extra when cancelling", () => {
    // A meeting is cancelled precisely when it did not happen; demanding an
    // attendance list would be asking who was not at a meeting nobody held.
    expect(
      refuseTransition(MeetingStatus.PLANNED, MeetingStatus.CANCELLED, {
        items: [{ kind: MeetingItemKind.INFORMATION, text: "  " }],
        attendees: [{ attended: null }],
      }),
    ).toBeNull();
  });
});

describe("refuseProtocolEdit", () => {
  it("allows editing an unapproved protocol", () => {
    expect(refuseProtocolEdit({ status: MeetingStatus.HELD, approvals: [] })).toBeNull();
    expect(refuseProtocolEdit({ status: MeetingStatus.PLANNED, approvals: [] })).toBeNull();
  });

  it("closes an approved protocol", () => {
    /**
     * **The rule that makes minutes worth keeping.** A protocol that can still
     * be edited after approval is a document whose contents at the time of
     * approval are unknowable — which is precisely the property a dispute needs
     * it to have. The message says how to correct it, because a refusal with no
     * way forward is a refusal people route around.
     */
    const refusal = refuseProtocolEdit({
      status: MeetingStatus.HELD,
      approvals: [{ decision: "APPROVED" }],
    });
    expect(refusal).toContain("genehmigt");
    expect(refusal).toContain("nächsten Sitzung");
  });

  it("closes it after an amendment too", () => {
    // An amendment is itself an approval of a corrected record; a protocol that
    // reopened after one would be editable for ever by amending it once.
    expect(
      refuseProtocolEdit({ status: MeetingStatus.HELD, approvals: [{ decision: "AMENDED" }] }),
    ).not.toBeNull();
  });

  it("closes a cancelled meeting", () => {
    expect(refuseProtocolEdit({ status: MeetingStatus.CANCELLED, approvals: [] })).toContain(
      "abgesagte",
    );
  });
});

describe("itemKey", () => {
  it("is the number said out loud on site", () => {
    expect(itemKey(14, 3)).toBe("14.3");
  });

  it("falls back to the position for a meeting with no series", () => {
    // A Kickoff or an Abnahme has no series number, and `null.3` is not a key.
    expect(itemKey(null, 3)).toBe("3");
  });
});

describe("nextSeriesNumber", () => {
  it("starts a series at 1", () => {
    expect(nextSeriesNumber([])).toBe(1);
  });

  it("reads the maximum, not the count", () => {
    /**
     * A cancelled Bausitzung still consumed its number — it was called
     * "Bausitzung 12" in an e-mail. Counting rows would hand the next meeting a
     * number that already means something else.
     */
    expect(nextSeriesNumber([1, 2, 3, 12])).toBe(13);
  });

  it("ignores meetings with no series number", () => {
    expect(nextSeriesNumber([null, 4, null])).toBe(5);
  });
});

/* ================================================================== */
/* The protocol                                                        */
/* ================================================================== */

describe("refuseItem", () => {
  const base = {
    kind: MeetingItemKind.INFORMATION,
    text: "Etwas wurde besprochen.",
    responsibleId: null,
    dueDate: null,
    decisionId: null,
  };

  it("refuses a line with no text", () => {
    expect(refuseItem({ ...base, text: "   " })).toBe("Eine Protokollzeile braucht einen Text.");
  });

  it("allows an information line with nothing else", () => {
    expect(refuseItem(base)).toBeNull();
  });

  it("refuses a Pendenz with no owner", () => {
    /**
     * The rule people will want relaxed, and the one worth keeping: "wird noch
     * angeschaut" with nobody's name against it is the line that is still open
     * at Bausitzung 20.
     */
    expect(refuseItem({ ...base, kind: MeetingItemKind.PENDENZ, dueDate: new Date() })).toBe(
      "Eine Pendenz braucht eine zuständige Person.",
    );
  });

  it("refuses a Pendenz with no date", () => {
    expect(refuseItem({ ...base, kind: MeetingItemKind.PENDENZ, responsibleId: "e1" })).toBe(
      "Eine Pendenz braucht einen Termin.",
    );
  });

  it("allows a complete Pendenz", () => {
    expect(
      refuseItem({
        ...base,
        kind: MeetingItemKind.PENDENZ,
        responsibleId: "e1",
        dueDate: new Date(),
      }),
    ).toBeNull();
  });

  it("refuses an Entscheid that is only text", () => {
    // The whole argument for `Decision` being a table: a line inside a protocol
    // cannot be cited, linked to, filtered or reversed.
    expect(refuseItem({ ...base, kind: MeetingItemKind.ENTSCHEID })).toContain("Entscheid anlegen");
  });

  it("refuses a decision attached to a line that is not an Entscheid", () => {
    // Otherwise a Pendenz could carry a decision, and "which line records this
    // decision" would have two answers.
    expect(refuseItem({ ...base, decisionId: "d1" })).toContain("Nur eine Zeile vom Typ Entscheid");
  });

  it("allows an Entscheid with its decision", () => {
    expect(
      refuseItem({ ...base, kind: MeetingItemKind.ENTSCHEID, decisionId: "d1" }),
    ).toBeNull();
  });
});

describe("refuseApproval", () => {
  it("allows a plain approval with no note", () => {
    expect(refuseApproval("APPROVED", null)).toBeNull();
  });

  it("refuses an amendment nobody described", () => {
    // An amendment nobody described is an amendment nobody can act on.
    expect(refuseApproval("AMENDED", null)).not.toBeNull();
    expect(refuseApproval("AMENDED", "   ")).not.toBeNull();
  });

  it("allows an amendment with a note", () => {
    expect(refuseApproval("AMENDED", "Ziffer 12.3 betrifft OG3, nicht OG2.")).toBeNull();
  });
});

describe("refuseApprovalTiming", () => {
  it("refuses approving a meeting that has not been held", () => {
    expect(
      refuseApprovalTiming({ status: MeetingStatus.PLANNED, approvals: [] }),
    ).toContain("durchgeführten");
  });

  it("allows the first approval of a held meeting", () => {
    expect(refuseApprovalTiming({ status: MeetingStatus.HELD, approvals: [] })).toBeNull();
  });

  it("refuses approving twice", () => {
    /**
     * The second row would be a second "the record is now this", and which one
     * stands would become a question about row order.
     */
    expect(
      refuseApprovalTiming({ status: MeetingStatus.HELD, approvals: [{ decision: "APPROVED" }] }),
    ).toBe("Dieses Protokoll ist bereits genehmigt.");
  });

  it("refuses approving after an amendment, and names it", () => {
    /**
     * **This assertion used to say the opposite, and the opposite was wrong.**
     *
     * Letting an `APPROVED` follow an `AMENDED` contradicted
     * `refuseProtocolEdit` one screen away, which closes the protocol on *any*
     * approval — the minutes would have been locked and then approvable again.
     * An amendment is not a step before the approval; it **is** the approval,
     * of a record that was corrected in the saying.
     *
     * Both halves were individually plausible and only their combination was
     * wrong, which is why an e2e assertion found it and neither unit test did.
     */
    expect(
      refuseApprovalTiming({ status: MeetingStatus.HELD, approvals: [{ decision: "AMENDED" }] }),
    ).toBe("Dieses Protokoll wurde bereits mit Änderung genehmigt.");
  });
});

/* ================================================================== */
/* Decisions                                                           */
/* ================================================================== */

describe("the decision number", () => {
  it("is per project and per year", () => {
    expect(formatDecisionNumber(2026, 17)).toBe("E-2026-017");
  });

  it("reads the maximum, not the count", () => {
    // A deleted decision still consumed its number; it is quoted in e-mails.
    expect(nextDecisionSequence(["E-2026-001", "E-2026-009"], 2026)).toBe(10);
  });

  it("restarts per year", () => {
    expect(nextDecisionSequence(["E-2025-044"], 2026)).toBe(1);
  });

  it("ignores a number it does not recognise", () => {
    expect(nextDecisionSequence(["E-2026-003", "Altbestand-7"], 2026)).toBe(4);
  });
});

describe("the decision transition table", () => {
  it("covers every status", () => {
    expect(Object.keys(DECISION_TRANSITIONS).sort()).toEqual(Object.values(DecisionStatus).sort());
  });

  it("makes AUFGEHOBEN terminal", () => {
    expect(DECISION_TRANSITIONS.AUFGEHOBEN).toEqual([]);
  });

  it("lets a decision go back to OFFEN from ENTSCHIEDEN", () => {
    // A decision reopened for discussion is a real thing that happens at the
    // next Bausitzung, and it is not the same as reversing it.
    expect(DECISION_TRANSITIONS.ENTSCHIEDEN).toContain(DecisionStatus.OFFEN);
  });
});

describe("refuseDecisionStatus", () => {
  it("allows a no-op", () => {
    expect(refuseDecisionStatus(DecisionStatus.OFFEN, DecisionStatus.OFFEN)).toBeNull();
  });

  it("refuses AUFGEHOBEN as a direct transition, and says what to do instead", () => {
    /**
     * **The rule that makes `AUFGEHOBEN` a fact rather than a claim.** A status
     * anybody could type would let a decision read as withdrawn with nothing to
     * point at; going through `supersede` always leaves a successor attached.
     */
    const refusal = refuseDecisionStatus(DecisionStatus.ENTSCHIEDEN, DecisionStatus.AUFGEHOBEN);
    expect(refusal).toContain("ersetzt");
    expect(refusal).not.toBeNull();
  });

  it("allows it when the supersede path is what asked", () => {
    expect(
      refuseDecisionStatus(DecisionStatus.ENTSCHIEDEN, DecisionStatus.AUFGEHOBEN, true),
    ).toBeNull();
  });

  it("refuses changing an already-reversed decision", () => {
    expect(refuseDecisionStatus(DecisionStatus.AUFGEHOBEN, DecisionStatus.OFFEN)).toContain(
      "aufgehobener",
    );
  });

  it("refuses a move the table does not list", () => {
    expect(refuseDecisionStatus(DecisionStatus.OFFEN, DecisionStatus.UMGESETZT)).not.toBeNull();
  });
});

describe("refuseDecision", () => {
  const base = {
    title: "Lüftung OG2 wird umgebaut",
    rationale: "Die Nutzung wechselt und die zentrale Regelung führt zu Zug.",
    impact: "KEINE",
    costImpact: null as number | null,
  };

  it("allows a complete decision", () => {
    expect(refuseDecision(base)).toBeNull();
  });

  it("refuses a title that is not one", () => {
    expect(refuseDecision({ ...base, title: "Ok" })).toContain("Titel");
  });

  it("refuses an empty rationale", () => {
    expect(refuseDecision({ ...base, rationale: "   " })).toContain("nachvollziehbar");
  });

  it("refuses a rationale that says nothing", () => {
    /**
     * Twenty characters is not a quality bar — it is the difference between a
     * sentence and "ok". The schema can only refuse an empty string, and the
     * thing worth refusing is a reason nobody can read in two years.
     */
    expect(refuseDecision({ ...base, rationale: "passt so" })).toContain("zu kurz");
  });

  it("refuses a cost on a decision that claims no impact", () => {
    // One of the two is then wrong and neither can be trusted.
    expect(refuseDecision({ ...base, impact: "KEINE", costImpact: 1000 })).toContain(
      "keine Kostenfolge",
    );
  });

  it("allows a zero cost on a decision with no impact", () => {
    expect(refuseDecision({ ...base, impact: "KEINE", costImpact: 0 })).toBeNull();
  });

  it("allows a negative cost — a decision that saves money", () => {
    // Not an error: a decision with a cost impact may reduce the cost.
    expect(refuseDecision({ ...base, impact: "KOSTEN", costImpact: -12000 })).toBeNull();
  });
});

describe("wouldSupersedeCycle", () => {
  const graph = (pairs: [string, string | null][]) => new Map(pairs);

  it("refuses a decision superseding itself", () => {
    expect(wouldSupersedeCycle(graph([["a", null]]), "a", "a")).toBe(true);
  });

  it("allows a plain reversal", () => {
    expect(wouldSupersedeCycle(graph([["a", null], ["b", null]]), "b", "a")).toBe(false);
  });

  it("refuses closing a three-step loop", () => {
    /**
     * A → B → C → A means three decisions each claiming to replace the next,
     * and none of them can be read as current. Nothing about A's own row says
     * so.
     */
    const edges = graph([["b", "a"], ["c", "b"], ["a", null]]);
    expect(wouldSupersedeCycle(edges, "a", "c")).toBe(true);
  });

  it("terminates on a graph that is already cyclic", () => {
    const edges = graph([["a", "b"], ["b", "a"]]);
    expect(() => wouldSupersedeCycle(edges, "z", "a")).not.toThrow();
  });
});

describe("refuseSupersede", () => {
  it("allows one decision replacing another on the same project", () => {
    expect(
      refuseSupersede({
        newProjectId: "p1",
        targetProjectId: "p1",
        targetStatus: DecisionStatus.ENTSCHIEDEN,
      }),
    ).toBeNull();
  });

  it("refuses reversing another project's decision", () => {
    /**
     * A decision on Guglera cannot reverse one on Aarefeld. Allowing it would
     * make a project's decision history depend on a record nobody looking at
     * that project can see — and it is what bounds the cycle check.
     */
    expect(
      refuseSupersede({
        newProjectId: "p1",
        targetProjectId: "p2",
        targetStatus: DecisionStatus.ENTSCHIEDEN,
      }),
    ).toContain("desselben Projekts");
  });

  it("refuses reversing one that is already reversed", () => {
    expect(
      refuseSupersede({
        newProjectId: "p1",
        targetProjectId: "p1",
        targetStatus: DecisionStatus.AUFGEHOBEN,
      }),
    ).toContain("bereits aufgehoben");
  });
});

/* ================================================================== */
/* Dates                                                               */
/* ================================================================== */

describe("refuseTimes", () => {
  const start = new Date("2026-09-18T14:00:00Z");

  it("allows no end time", () => {
    expect(refuseTimes(start, null)).toBeNull();
  });

  it("allows an end after the start", () => {
    expect(refuseTimes(start, new Date("2026-09-18T15:30:00Z"))).toBeNull();
  });

  it("refuses an end at or before the start", () => {
    expect(refuseTimes(start, start)).not.toBeNull();
    expect(refuseTimes(start, new Date("2026-09-18T13:00:00Z"))).not.toBeNull();
  });
});

describe("refuseDecisionDate", () => {
  const meeting = new Date("2026-09-18T14:00:00Z");

  it("allows a decision with no meeting", () => {
    expect(refuseDecisionDate(new Date("2026-01-01"), null)).toBeNull();
  });

  it("allows a decision that predates its minutes", () => {
    /**
     * `data-model.md` §3.11: *"a decision on site is still a decision"*. It is
     * recorded at the next Bausitzung and dated when it was taken.
     */
    expect(refuseDecisionDate(new Date("2026-09-10T09:00:00Z"), meeting)).toBeNull();
  });

  it("allows one recorded later the same day", () => {
    // Minutes are written up afterwards; 17:00 for a 14:00 Bausitzung is
    // normal, which is why the bound is the day rather than the minute.
    expect(refuseDecisionDate(new Date("2026-09-18T17:00:00Z"), meeting)).toBeNull();
  });

  it("refuses one dated after the meeting that recorded it", () => {
    // Either a typo or a claim that the meeting decided something it had not
    // yet heard.
    expect(refuseDecisionDate(new Date("2026-09-20T09:00:00Z"), meeting)).not.toBeNull();
  });
});
