import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingDetailDto, DrawingDto, RevisionDto, TransmittalDetailDto } from "../dto";
import {
  toCreateDrawingBody,
  toCreateRevisionBody,
  toCreateTransmittalBody,
  toDrawing,
  toDrawingDetail,
  toDrawingStats,
  toRevision,
  toTransmittalDetail,
  toTransmittalResult,
  toUpdateDrawingBody,
  toVersion,
} from "../mapper";

/**
 * The mapper, in both directions.
 *
 * This is the layer that decides what a screen may assume, and every test here
 * guards a bug that would otherwise happen *somewhere else*:
 *
 * | | |
 * | --- | --- |
 * | Dates | `"2026-09-10T…" < someDate` compares a string to an object and never throws |
 * | `null` dates | `new Date(null)` is 1 January 1970, silently |
 * | Open strings | a `switch` with no case for a value the server already sends |
 * | `undefined` vs `null` | a naive spread destroys the distinction that makes `PATCH` work |
 * | `revision` | assembling `C` here is a second implementation of a rule that skips `I` and `O` |
 */

function drawingDto(over: Partial<DrawingDto> = {}): DrawingDto {
  return {
    id: "d1",
    number: "4723-HZG-EG-101",
    title: "Grundriss EG Heizung",
    type: "GRUNDRISS",
    scale: "1:50",
    format: "A1",
    phase: "P51",
    status: "RELEASED",
    currentRevision: "C",
    issuedRevision: "B",
    version: 4,
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: null,
    project: { id: "p1", number: "P-2026-001", name: "Schulhaus" },
    discipline: { id: "g1", code: "HZG", name: "Heizung", colour: "disc-heat" },
    building: null,
    drawnBy: null,
    checkedBy: null,
    approvedBy: null,
    counts: { revisions: 3 },
    ...over,
  };
}

function revisionDto(over: Partial<RevisionDto> = {}): RevisionDto {
  return {
    id: "r1",
    drawingId: "d1",
    revision: "C",
    changeNote: "Steigzone Ost nach Norden verschoben.",
    reason: "KOORDINATION",
    fileName: "plan.pdf",
    size: 220_114,
    mimeType: "application/pdf",
    checksum: "deadbeef",
    releasedAt: "2026-09-08T00:00:00.000Z",
    supersededAt: null,
    createdAt: "2026-09-07T00:00:00.000Z",
    drawnBy: null,
    checkedBy: null,
    approvedBy: null,
    ...over,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/* ================================================================== */

describe("toDrawing", () => {
  it("turns every timestamp into a Date", () => {
    const drawing = toDrawing(drawingDto({ updatedAt: "2026-09-09T10:00:00.000Z" }));
    expect(drawing.createdAt).toBeInstanceOf(Date);
    expect(drawing.updatedAt).toBeInstanceOf(Date);
  });

  it("keeps a null date as null rather than as 1970", () => {
    const drawing = toDrawing(drawingDto({ createdAt: null, updatedAt: null }));
    expect(drawing.createdAt).toBeNull();
    expect(drawing.updatedAt).toBeNull();
  });

  /**
   * `C` is allocated by the server — skipping `I` and `O`, a rule this side
   * does not know — so it is passed through. A second derivation here is the
   * one that goes wrong the first time somebody enters a label by hand.
   */
  it("passes the current revision through rather than deriving it", () => {
    expect(toDrawing(drawingDto({ currentRevision: "AB" })).currentRevision).toBe("AB");
    expect(toDrawing(drawingDto({ currentRevision: null })).currentRevision).toBeNull();
  });

  /**
   * The issued revision is the one figure on this row that **cannot** be
   * derived here at all: a list row carries no transmittals, and deriving it
   * from `revisions` on the detail would answer which revisions exist rather
   * than which one was sent.
   */
  it("keeps the issued revision separate from the current one", () => {
    const drawing = toDrawing(drawingDto({ currentRevision: "D", issuedRevision: "B" }));
    expect(drawing.currentRevision).toBe("D");
    expect(drawing.issuedRevision).toBe("B");
  });

  it("carries a plan that has never been issued as null, not as its current revision", () => {
    const drawing = toDrawing(drawingDto({ currentRevision: "A", issuedRevision: null }));
    expect(drawing.issuedRevision).toBeNull();
  });

  it("flattens the Gewerk's token name to `colour`", () => {
    // A token name (`disc-heat`), never a hex literal — the one colour that
    // could not answer to dark mode.
    expect(toDrawing(drawingDto()).discipline?.colour).toBe("disc-heat");
  });

  it("narrows an unknown status to a default and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const drawing = toDrawing(drawingDto({ status: "ARCHIVED" }));

    // The least-bad of three: throwing would blank a register because one row
    // came from a newer server, and mapping it silently would hide a skew.
    expect(drawing.status).toBe("WIP");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("narrows an unknown type and format the same way", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(toDrawing(drawingDto({ type: "LAGEPLAN" })).type).toBe("GRUNDRISS");
    expect(toDrawing(drawingDto({ format: "A6" })).format).toBe("A3");
  });

  it("keeps a null phase null rather than narrowing it to a default", () => {
    // A plan belonging to no phase is ordinary; narrowing `null` would invent
    // an Ausführungsprojekt it is not part of.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(toDrawing(drawingDto({ phase: null })).phase).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("copies nested objects rather than sharing the cache's", () => {
    const dto = drawingDto();
    const drawing = toDrawing(dto);
    drawing.counts.revisions = 0;
    expect(dto.counts.revisions).toBe(3);
  });
});

describe("toRevision", () => {
  it("maps both stamps and keeps them apart", () => {
    const revision = toRevision(revisionDto({ supersededAt: "2026-09-12T00:00:00.000Z" }));
    expect(revision.releasedAt).toBeInstanceOf(Date);
    expect(revision.supersededAt).toBeInstanceOf(Date);
  });

  it("keeps an unreleased revision unreleased", () => {
    expect(toRevision(revisionDto({ releasedAt: null })).releasedAt).toBeNull();
  });

  /**
   * The checksum crosses and the storage key does not — the key is an internal
   * path, and putting it on the wire invites a client to construct a URL and
   * bypass the authenticated download.
   */
  it("carries the checksum and has no storage key at all", () => {
    const revision = toRevision(revisionDto());
    expect(revision.checksum).toBe("deadbeef");
    expect("storageKey" in (revision as object)).toBe(false);
  });
});

describe("toDrawingDetail", () => {
  function detailDto(over: Partial<DrawingDetailDto> = {}): DrawingDetailDto {
    return {
      ...drawingDto(),
      projectId: "p1",
      disciplineId: "g1",
      buildingId: null,
      drawnById: null,
      checkedById: null,
      approvedById: null,
      createdById: null,
      updatedById: null,
      revisions: [revisionDto()],
      allowedTransitions: ["WIP", "WITHDRAWN"],
      readOnly: false,
      ...over,
    };
  }

  /**
   * Both come from the server with the record and neither is recomputed. A
   * second transition table would go stale without anything failing — the
   * dropdown would start offering something the API refuses.
   */
  it("passes allowedTransitions and readOnly through", () => {
    const drawing = toDrawingDetail(detailDto({ readOnly: true }));
    expect(drawing.allowedTransitions).toEqual(["WIP", "WITHDRAWN"]);
    expect(drawing.readOnly).toBe(true);
  });

  it("narrows an unknown transition rather than letting it through as a string", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const drawing = toDrawingDetail(detailDto({ allowedTransitions: ["FROZEN"] }));
    expect(drawing.allowedTransitions).toEqual(["WIP"]);
  });

  it("maps the revision history", () => {
    const drawing = toDrawingDetail(detailDto());
    expect(drawing.revisions).toHaveLength(1);
    expect(drawing.revisions[0].createdAt).toBeInstanceOf(Date);
  });
});

describe("toDrawingStats", () => {
  it("fills every status key, so one with no rows reads as 0", () => {
    const stats = toDrawingStats({
      byStatus: { RELEASED: 4 },
      total: 4,
      awaitingCheck: 0,
      released: 4,
    });
    expect(stats.byStatus.WIP).toBe(0);
    expect(stats.byStatus.WITHDRAWN).toBe(0);
    expect(stats.byStatus.RELEASED).toBe(4);
  });

  it("keeps the two figures somebody acts on", () => {
    const stats = toDrawingStats({ byStatus: {}, total: 9, awaitingCheck: 2, released: 3 });
    expect(stats.awaitingCheck).toBe(2);
    expect(stats.released).toBe(3);
  });
});

describe("toTransmittalDetail", () => {
  function transmittalDto(over: Partial<TransmittalDetailDto> = {}): TransmittalDetailDto {
    return {
      id: "t1",
      number: "PV-2026-0001",
      sentAt: "2026-09-09T10:00:00.000Z",
      purpose: "ZUR_AUSFUEHRUNG",
      medium: "EMAIL",
      note: null,
      createdAt: null,
      project: null,
      sentBy: null,
      counts: { items: 1, recipients: 2 },
      projectId: "p1",
      createdById: null,
      items: [
        {
          id: "i1",
          copies: 2,
          format: "A1",
          revisionId: "r1",
          revision: "C",
          fileName: "plan.pdf",
          releasedAt: "2026-09-08T00:00:00.000Z",
          supersededAt: null,
          drawing: { id: "d1", number: "P-101", title: "x", discipline: null },
        },
      ],
      recipients: [
        {
          id: "rc1",
          role: "TO",
          acknowledgedAt: "2026-09-10T00:00:00.000Z",
          employee: null,
          externalName: "Müller AG",
          externalOrg: "Haustechnik",
          externalMail: null,
          name: "Müller AG",
          organisation: "Haustechnik",
        },
        {
          id: "rc2",
          role: "CC",
          acknowledgedAt: null,
          employee: null,
          externalName: "Aebi",
          externalOrg: null,
          externalMail: null,
          name: "Aebi",
          organisation: null,
        },
      ],
      ...over,
    };
  }

  it("maps the items with both stamps", () => {
    const transmittal = toTransmittalDetail(transmittalDto());
    expect(transmittal.items[0].releasedAt).toBeInstanceOf(Date);
    expect(transmittal.items[0].supersededAt).toBeNull();
    expect(transmittal.items[0].copies).toBe(2);
  });

  /**
   * The fact that goes stale *after* the Planversand: a revision superseded
   * since it was issued is exactly the row somebody needs flagged when they
   * open an old one.
   */
  it("carries a supersession that happened after the send", () => {
    const dto = transmittalDto();
    dto.items[0].supersededAt = "2026-09-20T00:00:00.000Z";
    expect(toTransmittalDetail(dto).items[0].supersededAt).toBeInstanceOf(Date);
  });

  it("keeps acknowledged and unacknowledged apart", () => {
    // `null` is "not confirmed", which is not "did not receive".
    const transmittal = toTransmittalDetail(transmittalDto());
    expect(transmittal.recipients[0].acknowledgedAt).toBeInstanceOf(Date);
    expect(transmittal.recipients[1].acknowledgedAt).toBeNull();
  });

  it("uses the server's assembled name rather than concatenating one", () => {
    // The day three call sites concatenated it themselves is the day one of
    // them printed "null".
    expect(toTransmittalDetail(transmittalDto()).recipients[0].name).toBe("Müller AG");
  });

  it("maps sentAt, which a Planversand always has", () => {
    expect(toTransmittalDetail(transmittalDto()).sentAt).toBeInstanceOf(Date);
  });
});

describe("toTransmittalResult", () => {
  /**
   * The record **and** the warnings, never one or the other. A create that
   * returned only the transmittal would drop the names of the people who must
   * be told, which is the half that matters.
   */
  it("carries both halves", () => {
    const result = toTransmittalResult({
      transmittal: {
        id: "t1",
        number: "PV-2026-0002",
        sentAt: "2026-09-09T10:00:00.000Z",
        purpose: "ZUR_AUSFUEHRUNG",
        medium: "EMAIL",
        note: null,
        createdAt: null,
        project: null,
        sentBy: null,
        counts: { items: 1, recipients: 1 },
        projectId: "p1",
        createdById: null,
        items: [],
        recipients: [],
      },
      warnings: [
        {
          recipientLabel: "Müller AG",
          drawingNumber: "P-101",
          previousRevision: "B",
          newRevision: "C",
        },
      ],
    });

    expect(result.transmittal.number).toBe("PV-2026-0002");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].previousRevision).toBe("B");
  });
});

describe("toVersion", () => {
  it("copies `changed` rather than sharing the DTO's array", () => {
    const dto = {
      version: 3,
      label: "v3",
      changed: ["title"],
      note: null,
      changedByName: null,
      createdAt: "2026-09-02T08:00:00.000Z",
    };
    const version = toVersion(dto);
    version.changed.push("scale");
    expect(dto.changed).toEqual(["title"]);
    expect(version.createdAt).toBeInstanceOf(Date);
  });
});

/* ================================================================== */
/* Entity → request body                                               */
/* ================================================================== */

describe("toCreateDrawingBody", () => {
  const draft = {
    number: "  4723-HZG-EG-101  ",
    title: "  Grundriss  ",
    projectId: "p1",
    disciplineId: "g1",
    type: "GRUNDRISS" as const,
  };

  it("trims what a person typed", () => {
    const body = toCreateDrawingBody(draft);
    expect(body.number).toBe("4723-HZG-EG-101");
    expect(body.title).toBe("Grundriss");
  });

  it("omits what was not supplied rather than sending null", () => {
    // The create endpoint has no "clear it" case, so a `null` from a form
    // control becomes omission rather than an explicit null the DTO rejects.
    const body = toCreateDrawingBody({ ...draft, buildingId: null, phase: null, scale: null });
    expect("buildingId" in body).toBe(false);
    expect("phase" in body).toBe(false);
    expect("scale" in body).toBe(false);
  });

  it("sends no status, because every plan starts WIP", () => {
    expect("status" in toCreateDrawingBody(draft)).toBe(false);
  });
});

describe("toUpdateDrawingBody", () => {
  /**
   * The distinction the whole `PATCH` rests on, and the one a naive spread
   * destroys. Also the shape of the bug that made a version row list every
   * field for a one-field edit.
   */
  it("keeps an explicit null but drops an absent field", () => {
    const body = toUpdateDrawingBody({ expectedVersion: 7, buildingId: null });

    expect(body.expectedVersion).toBe(7);
    expect(body.buildingId).toBeNull();
    expect("title" in body).toBe(false);
    expect("disciplineId" in body).toBe(false);
  });

  it("turns an emptied scale into null rather than an empty string", () => {
    // Clearing a text field produces `""`, and `""` is not a Massstab.
    expect(toUpdateDrawingBody({ expectedVersion: 1, scale: "   " }).scale).toBeNull();
  });

  it("leaves an untouched scale out entirely", () => {
    expect("scale" in toUpdateDrawingBody({ expectedVersion: 1 })).toBe(false);
  });

  it("never drops the expected version", () => {
    expect(toUpdateDrawingBody({ expectedVersion: 1 }).expectedVersion).toBe(1);
  });

  it("does not send a projectId, which would break the number's uniqueness", () => {
    expect("projectId" in toUpdateDrawingBody({ expectedVersion: 1 })).toBe(false);
  });
});

describe("toCreateRevisionBody", () => {
  const draft = {
    changeNote: "  Steigzone verschoben  ",
    storageKey: "k",
    fileName: "f.pdf",
    size: 1,
    checksum: "c",
    mimeType: "application/pdf",
  };

  it("uppercases a hand-entered label, so `c` and `C` are one request", () => {
    expect(toCreateRevisionBody({ ...draft, revision: "c" }).revision).toBe("C");
  });

  it("omits the label entirely when the server should allocate one", () => {
    expect("revision" in toCreateRevisionBody(draft)).toBe(false);
    expect("revision" in toCreateRevisionBody({ ...draft, revision: "  " })).toBe(false);
  });

  it("trims the change note", () => {
    expect(toCreateRevisionBody(draft).changeNote).toBe("Steigzone verschoben");
  });
});

describe("toCreateTransmittalBody", () => {
  it("sends the moment, not the day", () => {
    // A Planversand happens at a moment and is stamped with a time, unlike a
    // decision's date or a protocol line's deadline.
    const body = toCreateTransmittalBody({
      projectId: "p1",
      items: [{ drawingRevisionId: "r1" }],
      recipients: [{ externalName: "Müller" }],
      sentAt: new Date("2026-09-09T10:00:00.000Z"),
    });
    expect(body.sentAt).toBe("2026-09-09T10:00:00.000Z");
  });

  it("drops empty optional fields inside the nested arrays", () => {
    const body = toCreateTransmittalBody({
      projectId: "p1",
      items: [{ drawingRevisionId: "r1" }],
      recipients: [{ externalName: "Müller", externalOrg: "  ", externalMail: "" }],
    });

    expect("copies" in body.items[0]).toBe(false);
    expect("externalOrg" in body.recipients[0]).toBe(false);
    expect("externalMail" in body.recipients[0]).toBe(false);
    expect(body.recipients[0].externalName).toBe("Müller");
  });

  it("sends no number, because it is allocated", () => {
    const body = toCreateTransmittalBody({
      projectId: "p1",
      items: [{ drawingRevisionId: "r1" }],
      recipients: [{ externalName: "x" }],
    });
    expect("number" in body).toBe(false);
  });
});
