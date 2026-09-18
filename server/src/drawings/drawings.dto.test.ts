import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  AcknowledgeDto,
  ChangeDrawingStatusDto,
  CreateDrawingDto,
  CreateRevisionDto,
  CreateTransmittalDto,
  UpdateDrawingDto,
} from "./drawings.dto";

/**
 * The DTOs through the **real** `ValidationPipe` with the **real** options.
 *
 * Not a test of the decorators — a test of what the pipe does with them, which
 * is a different thing and the reason `settings.dto.test.ts` exists at all. The
 * bug it guards is an undecorated field being silently stripped: the property
 * never reaches the service, Prisma reads `undefined` as "leave the column
 * alone", and the endpoint answers 200 having changed nothing. Asserting that a
 * decorator is present would not have caught it.
 *
 * **What this cannot see**, and it is written down rather than assumed: vitest
 * transforms with esbuild, which does not emit the ES2022 class-field
 * definitions. So the instance built here has only the keys the request sent,
 * while the compiled `nest build` output defines *every* declared optional as
 * `undefined`. `Object.keys(dto)` therefore behaves differently in this file
 * than in production — which is exactly the gap that let `changed` list all
 * sixteen fields for a one-field PATCH for a whole wave. The guard for that is
 * `changedFields`, tested in `core/versioning/changed.test.ts` against the
 * shape the *compiled* DTO has, and asserted end to end in `e2e/drawings.spec.ts`.
 */

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

async function run<T>(cls: new () => T, value: unknown): Promise<T> {
  return (await pipe.transform(value, { type: "body", metatype: cls as never })) as T;
}

async function reject(cls: new () => unknown, value: unknown): Promise<string> {
  try {
    await run(cls, value);
    return "";
  } catch (error) {
    return JSON.stringify((error as { response?: unknown }).response ?? error);
  }
}

/* ================================================================== */

describe("CreateDrawingDto", () => {
  const valid = {
    number: "4723-HZG-EG-101",
    title: "Grundriss EG Heizung",
    projectId: "p1",
    disciplineId: "d1",
    type: "GRUNDRISS",
  };

  it("keeps every declared field", async () => {
    const dto = await run(CreateDrawingDto, {
      ...valid,
      scale: "1:50",
      format: "A1",
      // `P52` — Ausführung. The enum is `P31`…`P53`, not `PHASE_32`.
      phase: "P52",
      buildingId: "b1",
      drawnById: "e1",
    });

    // Each of these would vanish silently if its decorator were missing.
    expect(dto.number).toBe("4723-HZG-EG-101");
    expect(dto.title).toBe("Grundriss EG Heizung");
    expect(dto.projectId).toBe("p1");
    expect(dto.disciplineId).toBe("d1");
    expect(dto.type).toBe("GRUNDRISS");
    expect(dto.scale).toBe("1:50");
    expect(dto.format).toBe("A1");
    expect(dto.phase).toBe("P52");
    expect(dto.buildingId).toBe("b1");
    expect(dto.drawnById).toBe("e1");
  });

  it("strips a property nothing declares", async () => {
    const dto = await run(CreateDrawingDto, { ...valid, status: "ISSUED", version: 99 });
    expect("status" in (dto as object)).toBe(false);
    expect("version" in (dto as object)).toBe(false);
  });

  /**
   * The absence that matters. Every plan starts `WIP`; accepting a status here
   * would be a way straight past `refuseTransition`, whose preconditions the
   * create route evaluates none of.
   */
  it("cannot be used to create a plan that is already issued", async () => {
    const dto = await run(CreateDrawingDto, { ...valid, status: "ISSUED" });
    expect((dto as unknown as Record<string, unknown>).status).toBeUndefined();
  });

  it("refuses a missing number, title, project, discipline or type", async () => {
    for (const field of ["number", "title", "projectId", "disciplineId", "type"]) {
      const body: Record<string, unknown> = { ...valid };
      delete body[field];
      expect(await reject(CreateDrawingDto, body), field).toContain(field);
    }
  });

  it("refuses a type outside the enum", async () => {
    expect(await reject(CreateDrawingDto, { ...valid, type: "LAGEPLAN" })).toContain("type");
  });

  it("refuses an absurd number length rather than truncating it", async () => {
    expect(await reject(CreateDrawingDto, { ...valid, number: "x".repeat(61) })).toContain("number");
  });
});

describe("UpdateDrawingDto", () => {
  /**
   * The lock is **required**, and this is the assertion that keeps it so.
   *
   * A lock a caller may omit is one every caller omits exactly once, and the
   * failure is the single data-loss bug a user cannot detect, report or work
   * around: the second save wins silently and the first person's work is gone.
   */
  it("refuses a body with no expectedVersion", async () => {
    expect(await reject(UpdateDrawingDto, { title: "Neu" })).toContain("expectedVersion");
  });

  it("refuses a version below 1", async () => {
    expect(await reject(UpdateDrawingDto, { expectedVersion: 0 })).toContain("expectedVersion");
  });

  it("accepts a patch that changes one field", async () => {
    const dto = await run(UpdateDrawingDto, { expectedVersion: 3, title: "Korrigiert" });
    expect(dto.expectedVersion).toBe(3);
    expect(dto.title).toBe("Korrigiert");
  });

  it("keeps an explicit null so a field can be cleared", async () => {
    // `null` is a real instruction — "kein Gebäude" — and must survive the
    // pipe. `undefined` means "not supplied" and must not.
    const dto = await run(UpdateDrawingDto, { expectedVersion: 1, buildingId: null });
    expect(dto.buildingId).toBeNull();
  });

  it("does not accept a projectId, which would break the number's uniqueness", async () => {
    const dto = await run(UpdateDrawingDto, { expectedVersion: 1, projectId: "other" });
    expect((dto as unknown as Record<string, unknown>).projectId).toBeUndefined();
  });
});

describe("ChangeDrawingStatusDto", () => {
  it("accepts every status in the enum, including the two the rules refuse", async () => {
    // Refused by `refuseTransition` with an explanation, not by the DTO with
    // "status must be one of …" — the refusal is where the teaching is.
    for (const status of ["IN_CHECK", "CHECKED", "RELEASED", "ISSUED", "SUPERSEDED", "WITHDRAWN"]) {
      const dto = await run(ChangeDrawingStatusDto, { status });
      expect(dto.status, status).toBe(status);
    }
  });

  it("refuses a status outside the enum", async () => {
    expect(await reject(ChangeDrawingStatusDto, { status: "APPROVED" })).toContain("status");
  });

  it("keeps the reason", async () => {
    const dto = await run(ChangeDrawingStatusDto, { status: "WITHDRAWN", reason: "Falsche Höhen" });
    expect(dto.reason).toBe("Falsche Höhen");
  });
});

describe("CreateRevisionDto", () => {
  const valid = {
    changeNote: "Steigzone Ost nach Norden verschoben",
    storageKey: "plaene/2026/abc.pdf",
    fileName: "4723-HZG-EG-101-C.pdf",
    size: 220_114,
    checksum: "deadbeef",
    mimeType: "application/pdf",
  };

  it("keeps every file field", async () => {
    const dto = await run(CreateRevisionDto, valid);
    expect(dto.storageKey).toBe("plaene/2026/abc.pdf");
    expect(dto.fileName).toBe("4723-HZG-EG-101-C.pdf");
    expect(dto.size).toBe(220_114);
    expect(dto.checksum).toBe("deadbeef");
    expect(dto.mimeType).toBe("application/pdf");
  });

  it("refuses a changeNote that says nothing", async () => {
    expect(await reject(CreateRevisionDto, { ...valid, changeNote: "ok" })).toContain("changeNote");
  });

  it("refuses a zero-byte file", async () => {
    expect(await reject(CreateRevisionDto, { ...valid, size: 0 })).toContain("size");
  });

  it("allows a hand-entered revision label", async () => {
    const dto = await run(CreateRevisionDto, { ...valid, revision: "C" });
    expect(dto.revision).toBe("C");
  });
});

describe("CreateTransmittalDto", () => {
  const valid = {
    projectId: "p1",
    items: [{ drawingRevisionId: "r1" }],
    recipients: [{ externalName: "Sanitär Müller AG" }],
  };

  it("validates the nested arrays rather than waving them through", async () => {
    const dto = await run(CreateTransmittalDto, {
      ...valid,
      items: [{ drawingRevisionId: "r1", copies: 2, format: "A1" }],
      recipients: [{ externalName: "Müller", externalOrg: "AG", role: "CC" }],
    });

    // `@ValidateNested` plus `@Type` is what makes these real instances; without
    // the `@Type` the pipe validates a plain object and every nested rule is a
    // no-op that reports success.
    expect(dto.items[0].copies).toBe(2);
    expect(dto.items[0].format).toBe("A1");
    expect(dto.recipients[0].role).toBe("CC");
    expect(dto.recipients[0].externalOrg).toBe("AG");
  });

  it("strips an undeclared field inside a nested item", async () => {
    const dto = await run(CreateTransmittalDto, {
      ...valid,
      items: [{ drawingRevisionId: "r1", price: 99 }],
    });
    expect("price" in (dto.items[0] as object)).toBe(false);
  });

  it("refuses an empty items or recipients array", async () => {
    expect(await reject(CreateTransmittalDto, { ...valid, items: [] })).toContain("items");
    expect(await reject(CreateTransmittalDto, { ...valid, recipients: [] })).toContain("recipients");
  });

  it("refuses a nested item with no revision id", async () => {
    expect(await reject(CreateTransmittalDto, { ...valid, items: [{ copies: 1 }] })).toContain(
      "drawingRevisionId",
    );
  });

  it("does not accept a number, which is allocated", async () => {
    const dto = await run(CreateTransmittalDto, { ...valid, number: "PV-2026-0001" });
    expect((dto as unknown as Record<string, unknown>).number).toBeUndefined();
  });
});

describe("AcknowledgeDto", () => {
  it("needs a recipient", async () => {
    expect(await reject(AcknowledgeDto, {})).toContain("recipientId");
  });

  it("defaults the time by leaving it out", async () => {
    const dto = await run(AcknowledgeDto, { recipientId: "x" });
    expect(dto.acknowledgedAt).toBeUndefined();
  });

  it("refuses a date that is not ISO", async () => {
    expect(await reject(AcknowledgeDto, { recipientId: "x", acknowledgedAt: "14.03.2026" })).toContain(
      "acknowledgedAt",
    );
  });
});
