import { describe, expect, it } from "vitest";
import type {
  Drawing,
  ListedRevision,
  Revision,
  TransmittalItem,
  TransmittalRecipient,
} from "@/entities/drawing";
import {
  awaitingCheck,
  currentRevision,
  daysSince,
  formatSize,
  groupByDiscipline,
  isIssued,
  isLive,
  issuedButRevised,
  priorRevisions,
  refuseSelection,
  releasedWithin,
  sheetCount,
  splitAcknowledgement,
  supersededSince,
  violatesFourEyes,
  warningsByRecipient,
} from "../service";

/**
 * The service, with no mocks at all — the property the layer was built for.
 *
 * **What is deliberately not tested here is as telling as what is.** The
 * transition table, whether a plan may be edited, and the next revision letter
 * all live on the server and arrive with the record. A test here asserting any
 * of them would be asserting a second copy, which is the copy that goes stale.
 */

/* ---- Builders. Only the fields each test actually reads. ------------- */

function drawing(over: Partial<Drawing> = {}): Drawing {
  return {
    id: "d1",
    number: "4723-HZG-EG-101",
    title: "Grundriss EG Heizung",
    type: "GRUNDRISS",
    scale: "1:50",
    format: "A1",
    phase: "P51",
    status: "WIP",
    currentRevision: "A",
    issuedRevision: null,
    version: 1,
    createdAt: null,
    updatedAt: null,
    project: null,
    discipline: { id: "g1", code: "HZG", name: "Heizung", colour: "disc-heat" },
    building: null,
    drawnBy: null,
    checkedBy: null,
    approvedBy: null,
    counts: { revisions: 1 },
    ...over,
  };
}

function revision(over: Partial<Revision> = {}): Revision {
  return {
    id: "r1",
    drawingId: "d1",
    revision: "A",
    changeNote: "Erstausgabe.",
    reason: "ERSTAUSGABE",
    fileName: "plan.pdf",
    size: 200_000,
    mimeType: "application/pdf",
    checksum: "abc",
    releasedAt: null,
    supersededAt: null,
    createdAt: null,
    drawnBy: null,
    checkedBy: null,
    approvedBy: null,
    ...over,
  };
}

function recipient(over: Partial<TransmittalRecipient> = {}): TransmittalRecipient {
  return {
    id: "rc1",
    role: "TO",
    acknowledgedAt: null,
    employee: null,
    externalName: "Müller AG",
    externalOrg: null,
    externalMail: null,
    name: "Müller AG",
    organisation: null,
    ...over,
  };
}

function item(over: Partial<TransmittalItem> = {}): TransmittalItem {
  return {
    id: "i1",
    copies: 1,
    format: "A1",
    revisionId: "r1",
    revision: "C",
    fileName: "plan.pdf",
    releasedAt: new Date("2026-09-01"),
    supersededAt: null,
    drawing: { id: "d1", number: "4723-HZG-EG-101", title: "x", discipline: null },
    ...over,
  };
}

/* ================================================================== */

describe("currentRevision", () => {
  it("is the newest, which the server sends first", () => {
    const detail = {
      revisions: [revision({ id: "c", revision: "C" }), revision({ id: "b", revision: "B" })],
    };
    expect(currentRevision(detail)?.id).toBe("c");
  });

  /**
   * The case that rules out the obvious alternative. A `find` on
   * `supersededAt === null` would return B here, because a hand-migrated plan
   * set has older revisions that were never marked.
   */
  it("does not look for the unsuperseded one", () => {
    const detail = {
      revisions: [
        revision({ id: "c", revision: "C", supersededAt: new Date() }),
        revision({ id: "b", revision: "B", supersededAt: null }),
      ],
    };
    expect(currentRevision(detail)?.id).toBe("c");
  });

  it("is null for a plan nobody has drawn", () => {
    expect(currentRevision({ revisions: [] })).toBeNull();
  });
});

describe("priorRevisions", () => {
  it("is everything but the newest", () => {
    const detail = {
      revisions: [revision({ id: "c" }), revision({ id: "b" }), revision({ id: "a" })],
    };
    expect(priorRevisions(detail).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("is empty when there is only one", () => {
    expect(priorRevisions({ revisions: [revision()] })).toEqual([]);
  });
});

describe("isIssued / isLive", () => {
  it("reads issued from the plan, not from a revision", () => {
    // A revision does not know who received it — the transmittal does.
    expect(isIssued({ status: "ISSUED" })).toBe(true);
    expect(isIssued({ status: "RELEASED" })).toBe(false);
  });

  it("counts everything from WIP to ISSUED as live", () => {
    for (const status of ["WIP", "IN_CHECK", "CHECKED", "RELEASED", "ISSUED"] as const) {
      expect(isLive(status), status).toBe(true);
    }
    expect(isLive("SUPERSEDED")).toBe(false);
    expect(isLive("WITHDRAWN")).toBe(false);
  });
});

describe("violatesFourEyes", () => {
  it("is true only when both are set and equal", () => {
    expect(violatesFourEyes({ drawnById: "a", checkedById: "a" })).toBe(true);
    expect(violatesFourEyes({ drawnById: "a", checkedById: "b" })).toBe(false);
    expect(violatesFourEyes({ drawnById: null, checkedById: "a" })).toBe(false);
    expect(violatesFourEyes({ drawnById: "a", checkedById: null })).toBe(false);
    expect(violatesFourEyes({ drawnById: null, checkedById: null })).toBe(false);
  });
});

describe("refuseSelection", () => {
  const released = revision({ releasedAt: new Date("2026-09-01") });

  it("allows a released revision on a live plan", () => {
    expect(refuseSelection(drawing({ status: "RELEASED" }), released)).toBeNull();
  });

  it("refuses a plan with no revision", () => {
    expect(refuseSelection(drawing(), null)).toContain("keine Revision");
  });

  it("refuses a withdrawn plan ahead of anything else", () => {
    // Both are true of a withdrawn plan whose revision is unreleased; the more
    // specific answer is the useful one.
    const refusal = refuseSelection(drawing({ status: "WITHDRAWN" }), revision());
    expect(refusal).toContain("zurückgezogen");
  });

  it("refuses a superseded revision", () => {
    expect(
      refuseSelection(drawing({ status: "ISSUED" }), revision({ supersededAt: new Date() })),
    ).toContain("überholt");
  });

  it("refuses an unreleased revision", () => {
    expect(refuseSelection(drawing(), revision({ releasedAt: null }))).toContain("freigegeben");
  });

  /**
   * The asymmetry, asserted so it is not mistaken for the real rule: this
   * checks only what a screen knows. The server also refuses a revision from
   * another project, and it is the one that decides.
   */
  it("says nothing about the project, which only the server checks", () => {
    expect(refuseSelection(drawing({ status: "RELEASED" }), released)).toBeNull();
  });
});

describe("groupByDiscipline", () => {
  it("groups by Gewerk code, in code order", () => {
    const groups = groupByDiscipline([
      drawing({ id: "a", discipline: { id: "2", code: "LFT", name: "Lüftung", colour: "disc-air" } }),
      drawing({ id: "b", discipline: { id: "1", code: "HZG", name: "Heizung", colour: "disc-heat" } }),
      drawing({ id: "c", discipline: { id: "1", code: "HZG", name: "Heizung", colour: "disc-heat" } }),
    ]);

    expect(groups.map((g) => g.code)).toEqual(["HZG", "LFT"]);
    expect(groups[0].drawings.map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("carries the colour token, not a hex literal", () => {
    // A Lüftung run has to be the same colour on a plan, in a schedule and in
    // the 3D scene, and a literal is the one colour that cannot answer to dark
    // mode.
    const [group] = groupByDiscipline([drawing()]);
    expect(group.colour).toBe("disc-heat");
  });

  it("keeps a plan with no Gewerk rather than dropping it", () => {
    // It cannot happen — `disciplineId` is required — but a row that vanishes
    // from a register is worse than one under an unexpected heading.
    const groups = groupByDiscipline([drawing({ discipline: null })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].code).toBe("—");
    expect(groups[0].name).toBe("Ohne Gewerk");
  });

  it("is empty for an empty register", () => {
    expect(groupByDiscipline([])).toEqual([]);
  });
});

describe("awaitingCheck", () => {
  it("counts only what is blocking somebody", () => {
    // `WIP` blocks nobody and `CHECKED` is a different person's queue.
    const result = awaitingCheck([
      drawing({ id: "a", status: "IN_CHECK" }),
      drawing({ id: "b", status: "WIP" }),
      drawing({ id: "c", status: "CHECKED" }),
    ]);
    expect(result.map((d) => d.id)).toEqual(["a"]);
  });
});

describe("issuedButRevised", () => {
  it("finds issued plans that have been revised since", () => {
    const result = issuedButRevised([
      drawing({ id: "a", status: "ISSUED", counts: { revisions: 3 } }),
      drawing({ id: "b", status: "ISSUED", counts: { revisions: 1 } }),
      drawing({ id: "c", status: "RELEASED", counts: { revisions: 4 } }),
    ]);
    expect(result.map((d) => d.id)).toEqual(["a"]);
  });
});

describe("splitAcknowledgement", () => {
  /**
   * Two groups and not three, unlike attendance: everybody on a Planversand was
   * sent it. `acknowledgedAt` records only whether they said so.
   */
  it("splits confirmed from outstanding", () => {
    const groups = splitAcknowledgement([
      recipient({ id: "a", acknowledgedAt: new Date() }),
      recipient({ id: "b", acknowledgedAt: null }),
    ]);
    expect(groups.confirmed.map((r) => r.id)).toEqual(["a"]);
    expect(groups.outstanding.map((r) => r.id)).toEqual(["b"]);
  });

  it("has no third group for people who did not receive it", () => {
    const groups = splitAcknowledgement([recipient()]);
    expect(Object.keys(groups).sort()).toEqual(["confirmed", "outstanding"]);
  });
});

describe("supersededSince", () => {
  it("flags the items that have been overtaken", () => {
    const result = supersededSince({
      items: [item({ id: "a", supersededAt: new Date() }), item({ id: "b" })],
    });
    expect(result.map((i) => i.id)).toEqual(["a"]);
  });

  it("is empty for a Planversand that is still current", () => {
    expect(supersededSince({ items: [item()] })).toEqual([]);
  });
});

describe("warningsByRecipient", () => {
  /**
   * One line per recipient, because the action is one e-mail. Twelve warnings
   * naming the same contractor twelve times is a list somebody stops reading at
   * the third.
   */
  it("groups several plans under one person", () => {
    const grouped = warningsByRecipient([
      { recipientLabel: "Müller AG", drawingNumber: "P-101", previousRevision: "A", newRevision: "B" },
      { recipientLabel: "Müller AG", drawingNumber: "P-102", previousRevision: "B", newRevision: "C" },
      { recipientLabel: "Aebi", drawingNumber: "P-101", previousRevision: "A", newRevision: "B" },
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0].recipient).toBe("Aebi");
    expect(grouped[1].plans).toHaveLength(2);
    expect(grouped[1].plans[0]).toContain("P-101");
    expect(grouped[1].plans[0]).toContain("Rev. A");
  });

  it("is empty when nothing was superseded", () => {
    expect(warningsByRecipient([])).toEqual([]);
  });
});

describe("sheetCount", () => {
  it("sums copies rather than counting items", () => {
    // What goes in an envelope, and what somebody is charged for.
    expect(sheetCount([item({ copies: 2 }), item({ copies: 3 })])).toBe(5);
  });

  it("treats a missing count as one", () => {
    expect(sheetCount([item({ copies: 0 })])).toBe(1);
  });

  it("is zero for nothing", () => {
    expect(sheetCount([])).toBe(0);
  });
});

describe("formatSize", () => {
  it("reads the way an Explorer window does", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(230 * 1024)).toBe("230 KB");
  });

  it("drops the decimal above ten", () => {
    // `1.4 MB` and `230 KB` both read at a glance; `230.2 KB` does not.
    expect(formatSize(Math.round(1.44 * 1024 * 1024))).toBe("1.4 MB");
    expect(formatSize(45 * 1024 * 1024)).toBe("45 MB");
  });

  it("stops at gigabytes", () => {
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});

describe("daysSince", () => {
  const now = new Date("2026-09-18T22:00:00");

  it("counts whole days from midnight, so today is 0 all day", () => {
    expect(daysSince(new Date("2026-09-18T09:00:00"), now)).toBe(0);
    expect(daysSince(new Date("2026-09-15T08:00:00"), now)).toBe(3);
  });

  it("is null for no date", () => {
    expect(daysSince(null, now)).toBeNull();
  });

  it("is null for a future date rather than negative", () => {
    // A release stamped in the future is a clock problem, not "in -2 days".
    expect(daysSince(new Date("2026-09-20T08:00:00"), now)).toBeNull();
  });
});

describe("releasedWithin", () => {
  const now = new Date("2026-09-18T12:00:00");

  function listed(over: Partial<ListedRevision>): ListedRevision {
    return {
      ...revision(),
      drawing: {
        id: "d1",
        number: "P-101",
        title: "x",
        status: "RELEASED",
        project: null,
        discipline: null,
      },
      ...over,
    } as ListedRevision;
  }

  it("keeps what was released inside the window, newest first", () => {
    const result = releasedWithin(
      [
        listed({ id: "old", releasedAt: new Date("2026-09-01") }),
        listed({ id: "recent", releasedAt: new Date("2026-09-16") }),
        listed({ id: "mid", releasedAt: new Date("2026-09-13") }),
      ],
      7,
      now,
    );
    expect(result.map((r) => r.id)).toEqual(["recent", "mid"]);
  });

  it("ignores revisions that were never released", () => {
    expect(releasedWithin([listed({ releasedAt: null })], 7, now)).toEqual([]);
  });
});
