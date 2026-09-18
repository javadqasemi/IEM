import { DrawingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { alphaValue } from "../core/versioning/revision";
import {
  CHANGE_NOTE_MIN,
  DRAWING_TRANSITIONS,
  EDITABLE_STATUSES,
  formatTransmittalNumber,
  hasAmbiguousLetter,
  isOlderRevision,
  nextDrawingRevision,
  nextIssuedRevision,
  nextTransmittalSequence,
  priorIssueWarnings,
  refuseDrawingNumber,
  refuseFourEyes,
  refuseRevision,
  refuseRevisionLabel,
  refuseTransition,
  refuseTransmittal,
  transitionsFrom,
} from "./drawings.rules";

/**
 * The rules, exhaustively — which is possible only because they are pure.
 *
 * Every assertion here is an input and an expectation with no mocks at all. The
 * two that matter most are the ones a service would let slip: `ISSUED` and
 * `SUPERSEDED` cannot be set, and a draftsman cannot check their own work.
 */

const noRevisions = { revisions: [], drawnById: null, checkedById: null };
const oneRevision = {
  revisions: [{ revision: "A", releasedAt: null }],
  drawnById: "emp-1",
  checkedById: "emp-2",
};

/* ================================================================== */

describe("DRAWING_TRANSITIONS", () => {
  it("covers every status, so a new one cannot be forgotten", () => {
    // `Record<DrawingStatus, …>` makes this a compile error too; the test is
    // here because a compile error is invisible in a review of the enum.
    for (const status of Object.values(DrawingStatus)) {
      expect(DRAWING_TRANSITIONS[status], status).toBeDefined();
    }
  });

  it("never offers ISSUED or SUPERSEDED as a target", () => {
    // The module's central claim. Both are consequences -- of a Planversand and
    // of a newer revision -- so neither may be reachable by setting a status.
    for (const [from, targets] of Object.entries(DRAWING_TRANSITIONS)) {
      expect(targets, from).not.toContain(DrawingStatus.ISSUED);
      expect(targets, from).not.toContain(DrawingStatus.SUPERSEDED);
    }
  });

  it("lets every live status be withdrawn, including ISSUED", () => {
    // Withdrawing an issued plan is precisely what the module is for: something
    // is wrong and the people building from it have to be told.
    for (const status of Object.values(DrawingStatus)) {
      if (status === DrawingStatus.WITHDRAWN) continue;
      expect(DRAWING_TRANSITIONS[status], status).toContain(DrawingStatus.WITHDRAWN);
    }
  });

  it("makes WITHDRAWN terminal", () => {
    expect(transitionsFrom(DrawingStatus.WITHDRAWN)).toEqual([]);
  });

  it("allows the way back from every state before release", () => {
    // A check that finds something is the normal case, not an error.
    expect(DRAWING_TRANSITIONS.IN_CHECK).toContain(DrawingStatus.WIP);
    expect(DRAWING_TRANSITIONS.CHECKED).toContain(DrawingStatus.WIP);
    expect(DRAWING_TRANSITIONS.RELEASED).toContain(DrawingStatus.WIP);
  });
});

describe("refuseTransition", () => {
  it("allows a no-op", () => {
    expect(refuseTransition(DrawingStatus.WIP, DrawingStatus.WIP, noRevisions)).toBeNull();
  });

  it("refuses ISSUED with the reason, not with the transition table", () => {
    const refusal = refuseTransition(DrawingStatus.RELEASED, DrawingStatus.ISSUED, oneRevision);
    expect(refusal).toContain("versandt");
    // Named specifically rather than "Status X kann nur nach Y" -- the generic
    // message would send somebody looking for the missing transition.
    expect(refusal).not.toContain("kann nur nach");
  });

  it("refuses SUPERSEDED with its own reason", () => {
    const refusal = refuseTransition(DrawingStatus.RELEASED, DrawingStatus.SUPERSEDED, oneRevision);
    expect(refusal).toContain("neue");
    expect(refusal).not.toContain("kann nur nach");
  });

  it("refuses a transition that is simply not in the table", () => {
    expect(refuseTransition(DrawingStatus.WIP, DrawingStatus.RELEASED, oneRevision)).toContain(
      "kann nur nach",
    );
  });

  it("says a withdrawn plan is finished rather than listing no targets", () => {
    expect(refuseTransition(DrawingStatus.WITHDRAWN, DrawingStatus.WIP, oneRevision)).toContain(
      "zurückgezogener",
    );
  });

  it("refuses checking or releasing a plan that has no revision", () => {
    // The status describes the drawing file, and there is not one yet.
    expect(refuseTransition(DrawingStatus.WIP, DrawingStatus.IN_CHECK, noRevisions)).toContain(
      "keine Revision",
    );
    expect(
      refuseTransition(DrawingStatus.CHECKED, DrawingStatus.RELEASED, noRevisions),
    ).toContain("keine Revision");
  });

  it("refuses CHECKED without a checker", () => {
    expect(
      refuseTransition(DrawingStatus.IN_CHECK, DrawingStatus.CHECKED, {
        ...oneRevision,
        checkedById: null,
      }),
    ).toContain("prüfende Person");
  });

  it("refuses CHECKED when the checker drew it", () => {
    expect(
      refuseTransition(DrawingStatus.IN_CHECK, DrawingStatus.CHECKED, {
        ...oneRevision,
        drawnById: "emp-1",
        checkedById: "emp-1",
      }),
    ).toContain("nicht selbst prüfen");
  });

  it("allows CHECKED when two different people are named", () => {
    expect(
      refuseTransition(DrawingStatus.IN_CHECK, DrawingStatus.CHECKED, oneRevision),
    ).toBeNull();
  });

  it("allows withdrawing a plan with no revision at all", () => {
    // A plan created by mistake must be disposable without inventing a file
    // for it first.
    expect(refuseTransition(DrawingStatus.WIP, DrawingStatus.WITHDRAWN, noRevisions)).toBeNull();
  });
});

describe("refuseFourEyes", () => {
  it("refuses only when both are set and equal", () => {
    expect(refuseFourEyes("a", "a")).toContain("nicht selbst prüfen");
    expect(refuseFourEyes("a", "b")).toBeNull();
    expect(refuseFourEyes(null, "a")).toBeNull();
    expect(refuseFourEyes("a", null)).toBeNull();
    expect(refuseFourEyes(null, null)).toBeNull();
  });
});

describe("EDITABLE_STATUSES", () => {
  it("stops at release", () => {
    expect(EDITABLE_STATUSES).toContain(DrawingStatus.CHECKED);
    expect(EDITABLE_STATUSES).not.toContain(DrawingStatus.RELEASED);
    expect(EDITABLE_STATUSES).not.toContain(DrawingStatus.ISSUED);
  });
});

/* ================================================================== */

describe("nextDrawingRevision", () => {
  it("starts at A", () => {
    expect(nextDrawingRevision(null)).toBe("A");
  });

  it("counts through the ordinary letters", () => {
    expect(nextDrawingRevision("A")).toBe("B");
    expect(nextDrawingRevision("B")).toBe("C");
  });

  /**
   * The exclusion F13 wrote down and left for this module. `I` reads as a one
   * and `O` as a nought in a title block, which is why ISO 7200 omits both.
   */
  it("skips I and O", () => {
    expect(nextDrawingRevision("H")).toBe("J");
    expect(nextDrawingRevision("N")).toBe("P");
  });

  it("never returns a label containing I or O, over the whole first cycle", () => {
    // The strongest form of the assertion: walk the sequence rather than test
    // the two known cases, because a third exclusion would otherwise pass.
    let label: string | null = null;
    for (let i = 0; i < 200; i += 1) {
      label = nextDrawingRevision(label);
      expect(hasAmbiguousLetter(label), label).toBe(false);
    }
  });

  it("keeps increasing, so the sequence never doubles back", () => {
    let label = nextDrawingRevision(null);
    let previous = alphaValue(label);
    for (let i = 0; i < 200; i += 1) {
      label = nextDrawingRevision(label);
      const value = alphaValue(label);
      expect(value, label).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it("carries past Z without producing a bracket", () => {
    // `String.fromCharCode(65 + 26)` is `[`, which is the bug this scheme
    // exists to avoid -- in a title block on a plan issued to a contractor.
    expect(nextDrawingRevision("Z")).toBe("AA");
    expect(nextDrawingRevision("AA")).toBe("AB");
  });

  it("skips a whole ambiguous block after HZ", () => {
    // IA..IZ all contain I, so the next clean label is JA. The gap is supposed
    // to be visible -- that is what a skipped letter is.
    expect(nextDrawingRevision("HZ")).toBe("JA");
  });
});

describe("refuseRevisionLabel", () => {
  it("accepts an ordinary hand-entered label", () => {
    // A plan set that started life in AutoCAD arrives at C.
    expect(refuseRevisionLabel("C")).toBeNull();
    expect(refuseRevisionLabel("  c  ")).toBeNull();
  });

  it("refuses an empty label", () => {
    expect(refuseRevisionLabel("   ")).toContain("Bezeichnung");
  });

  it("refuses anything that is not letters", () => {
    expect(refuseRevisionLabel("A1")).toContain("keine Revisionsbezeichnung");
    expect(refuseRevisionLabel("3")).toContain("keine Revisionsbezeichnung");
    expect(refuseRevisionLabel("Rev C")).toContain("keine Revisionsbezeichnung");
  });

  it("refuses I and O with the reason rather than a bare rejection", () => {
    expect(refuseRevisionLabel("I")).toContain("im Plankopf");
    expect(refuseRevisionLabel("O")).toContain("im Plankopf");
    expect(refuseRevisionLabel("AI")).toContain("im Plankopf");
  });
});

describe("refuseRevision", () => {
  const base = {
    changeNote: "Steigzone Ost nach Norden verschoben",
    drawnById: "emp-1",
    checkedById: "emp-2",
    status: DrawingStatus.WIP,
  };

  it("accepts a revision that says what changed", () => {
    expect(refuseRevision(base)).toBeNull();
  });

  it("refuses a note that says nothing", () => {
    // Six months later the question is never "was there a revision C" but
    // "what changed in C".
    expect(refuseRevision({ ...base, changeNote: "ok" })).toContain(String(CHANGE_NOTE_MIN));
    expect(refuseRevision({ ...base, changeNote: "   " })).toContain(String(CHANGE_NOTE_MIN));
  });

  it("refuses a new revision on a withdrawn plan", () => {
    expect(refuseRevision({ ...base, status: DrawingStatus.WITHDRAWN })).toContain(
      "zurückgezogener",
    );
  });

  it("applies the four-eyes rule to the revision as well as the plan", () => {
    expect(refuseRevision({ ...base, checkedById: "emp-1" })).toContain("nicht selbst prüfen");
  });
});

/* ================================================================== */

describe("refuseTransmittal", () => {
  const released = {
    id: "r1",
    label: "4723-HZG-EG-101 Rev. B",
    releasedAt: new Date("2026-09-01"),
    supersededAt: null,
    drawingStatus: DrawingStatus.RELEASED,
  };
  const recipients = [{ employeeId: null, externalName: "Sanitär Müller AG" }];

  it("accepts a released revision to a named recipient", () => {
    expect(refuseTransmittal({ revisions: [released], recipients })).toBeNull();
  });

  it("refuses a transmittal with no plans", () => {
    expect(refuseTransmittal({ revisions: [], recipients })).toContain("ohne Pläne");
  });

  it("refuses a transmittal with no recipients", () => {
    expect(refuseTransmittal({ revisions: [released], recipients: [] })).toContain("Empfänger");
  });

  it("refuses a recipient row that names nobody", () => {
    expect(
      refuseTransmittal({
        revisions: [released],
        recipients: [{ employeeId: null, externalName: "  " }],
      }),
    ).toContain("Empfängerzeile");
  });

  it("refuses an unreleased revision, naming it", () => {
    // The single most expensive mistake the module prevents: a contractor
    // building from a drawing nobody checked.
    const refusal = refuseTransmittal({
      revisions: [{ ...released, releasedAt: null, drawingStatus: DrawingStatus.WIP }],
      recipients,
    });
    expect(refusal).toContain("nur freigegebene");
    expect(refusal).toContain("4723-HZG-EG-101");
  });

  it("refuses a superseded revision even for information", () => {
    // If somebody needs the old one they need it *with* the new one, which is
    // a different act.
    const refusal = refuseTransmittal({
      revisions: [{ ...released, supersededAt: new Date("2026-09-10") }],
      recipients,
    });
    expect(refusal).toContain("überholte");
  });

  it("puts the superseded message ahead of the unreleased one", () => {
    // Both are true of a superseded WIP revision; the more specific answer is
    // the useful one.
    const refusal = refuseTransmittal({
      revisions: [
        { ...released, releasedAt: null, supersededAt: new Date(), drawingStatus: DrawingStatus.WIP },
      ],
      recipients,
    });
    expect(refusal).toContain("überholte");
  });

  it("refuses a withdrawn plan", () => {
    expect(
      refuseTransmittal({
        revisions: [{ ...released, drawingStatus: DrawingStatus.WITHDRAWN }],
        recipients,
      }),
    ).toContain("zurückgezogen");
  });

  it("names every offending revision rather than only the first", () => {
    const refusal = refuseTransmittal({
      revisions: [
        { ...released, id: "a", label: "PLAN-A", releasedAt: null },
        { ...released, id: "b", label: "PLAN-B", releasedAt: null },
      ],
      recipients,
    });
    expect(refusal).toContain("PLAN-A");
    expect(refusal).toContain("PLAN-B");
  });
});

describe("priorIssueWarnings", () => {
  const sending = [{ drawingId: "d1", drawingNumber: "4723-HZG-EG-101", revision: "C" }];

  it("names whoever holds an older revision of the same plan", () => {
    const warnings = priorIssueWarnings({
      sending,
      alreadyIssued: [{ drawingId: "d1", revision: "B", recipientLabel: "Sanitär Müller AG" }],
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      recipientLabel: "Sanitär Müller AG",
      drawingNumber: "4723-HZG-EG-101",
      previousRevision: "B",
      newRevision: "C",
    });
  });

  it("is silent when the recipient already has this very revision", () => {
    // Re-sending the same revision is a reminder, not a contradiction.
    expect(
      priorIssueWarnings({
        sending,
        alreadyIssued: [{ drawingId: "d1", revision: "C", recipientLabel: "X" }],
      }),
    ).toEqual([]);
  });

  it("is silent about a newer revision somebody already has", () => {
    expect(
      priorIssueWarnings({
        sending,
        alreadyIssued: [{ drawingId: "d1", revision: "D", recipientLabel: "X" }],
      }),
    ).toEqual([]);
  });

  it("ignores earlier issues of a different plan", () => {
    expect(
      priorIssueWarnings({
        sending,
        alreadyIssued: [{ drawingId: "d2", revision: "A", recipientLabel: "X" }],
      }),
    ).toEqual([]);
  });

  it("does not repeat the same recipient and revision twice", () => {
    const warnings = priorIssueWarnings({
      sending,
      alreadyIssued: [
        { drawingId: "d1", revision: "B", recipientLabel: "X" },
        { drawingId: "d1", revision: "B", recipientLabel: "X" },
      ],
    });
    expect(warnings).toHaveLength(1);
  });

  it("warns once per recipient when several hold older revisions", () => {
    const warnings = priorIssueWarnings({
      sending,
      alreadyIssued: [
        { drawingId: "d1", revision: "A", recipientLabel: "X" },
        { drawingId: "d1", revision: "B", recipientLabel: "Y" },
      ],
    });
    expect(warnings.map((w) => w.recipientLabel).sort()).toEqual(["X", "Y"]);
  });

  it("is empty when nothing was ever issued", () => {
    expect(priorIssueWarnings({ sending, alreadyIssued: [] })).toEqual([]);
  });
});

describe("isOlderRevision", () => {
  it("compares by value, not as a string", () => {
    // "Z" < "AA" is false as a string and true as a revision -- the one
    // comparison in this module that looks right and is backwards.
    expect(isOlderRevision("Z", "AA")).toBe(true);
    expect("Z" < "AA").toBe(false);
  });

  it("orders the ordinary cases", () => {
    expect(isOlderRevision("A", "B")).toBe(true);
    expect(isOlderRevision("B", "A")).toBe(false);
    expect(isOlderRevision("A", "A")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isOlderRevision("a", "B")).toBe(true);
  });

  it("treats anything unparseable as not older, suppressing rather than inventing", () => {
    expect(isOlderRevision("00", "A")).toBe(false);
    expect(isOlderRevision("A", "1")).toBe(false);
  });
});

describe("nextIssuedRevision", () => {
  it("is the sent revision when nothing was ever issued", () => {
    expect(nextIssuedRevision(null, ["A"])).toBe("A");
  });

  it("advances when a newer revision goes out", () => {
    expect(nextIssuedRevision("B", ["C"])).toBe("C");
  });

  it("does not move backwards when an older revision is re-issued", () => {
    // The real case: somebody asks for the drawing they built from, or a
    // recipient is added late. `C` is still the newest thing out there.
    expect(nextIssuedRevision("C", ["A"])).toBe("C");
  });

  it("is unchanged when the same revision goes out again", () => {
    expect(nextIssuedRevision("C", ["C"])).toBe("C");
  });

  it("takes the newest when one Planversand carries two revisions of a plan", () => {
    expect(nextIssuedRevision(null, ["A", "C", "B"])).toBe("C");
    expect(nextIssuedRevision("B", ["A", "D"])).toBe("D");
  });

  it("compares by value past Z, not as a string", () => {
    // The whole reason this delegates to `isOlderRevision` rather than using
    // `>`: "AA" < "B" as a string, so a naive comparison would leave a plan
    // issued at AA reading as issued at B.
    expect(nextIssuedRevision("Z", ["AA"])).toBe("AA");
    expect(nextIssuedRevision("AA", ["B"])).toBe("AA");
  });

  it("stays null when nothing is sent", () => {
    expect(nextIssuedRevision(null, [])).toBeNull();
    expect(nextIssuedRevision("C", [])).toBe("C");
  });

  it("leaves an unparseable stored label alone rather than replacing it silently", () => {
    // `isOlderRevision` treats it as not-older, so the stored value survives.
    expect(nextIssuedRevision("00", ["A"])).toBe("00");
  });
});

describe("transmittal numbering", () => {
  it("formats with a four-digit sequence", () => {
    expect(formatTransmittalNumber(2026, 7)).toBe("PV-2026-0007");
    expect(formatTransmittalNumber(2026, 1234)).toBe("PV-2026-1234");
  });

  it("starts a year at 1", () => {
    expect(nextTransmittalSequence([], 2026)).toBe(1);
  });

  it("reads the maximum, not the count", () => {
    // A deleted row still consumed its number -- and a transmittal cannot be
    // deleted at all, so the sequence must never appear to have holes to reuse.
    expect(nextTransmittalSequence(["PV-2026-0001", "PV-2026-0009"], 2026)).toBe(10);
  });

  it("counts each year separately", () => {
    expect(nextTransmittalSequence(["PV-2025-0042"], 2026)).toBe(1);
  });

  it("ignores anything that is not a transmittal number", () => {
    expect(nextTransmittalSequence(["PV-2026-0003", "E-2026-017", "rubbish"], 2026)).toBe(4);
  });
});

describe("refuseDrawingNumber", () => {
  it("accepts the firm's own shape", () => {
    expect(refuseDrawingNumber("4723-HZG-EG-101")).toBeNull();
  });

  it("accepts a shape the firm does not use", () => {
    // Deliberately not a format check: a regex here would refuse a number the
    // next client actually uses, and it would end up in the title instead.
    expect(refuseDrawingNumber("P-01")).toBeNull();
    expect(refuseDrawingNumber("Grundriss OG2 Lüftung")).toBeNull();
  });

  it("refuses an empty number", () => {
    expect(refuseDrawingNumber("   ")).toContain("braucht eine Nummer");
  });

  it("refuses doubled whitespace, which makes two numbers look identical", () => {
    expect(refuseDrawingNumber("4723  HZG")).toContain("Leerzeichen");
  });

  it("refuses an absurd length", () => {
    expect(refuseDrawingNumber("x".repeat(61))).toContain("zu lang");
  });
});
