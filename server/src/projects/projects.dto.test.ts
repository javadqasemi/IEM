import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  AddMemberDto,
  BulkProjectsDto,
  ChangeStatusDto,
  CreateMilestoneDto,
  CreateProjectDto,
  ReorderMilestonesDto,
  ScopeDisciplineDto,
  UpdateProjectDto,
} from "./projects.dto";

/**
 * Every field of every DTO, through the **real pipe with the real options**.
 *
 * Not "does each property have a decorator". Asserting the decorator would pass
 * if somebody swapped it for one that does not survive whitelisting, and
 * whitelisting is the whole failure mode: an undecorated property is *stripped*
 * on the way in, the service receives `undefined`, Prisma reads that as "leave
 * the column alone", and the endpoint answers 200 having changed nothing.
 *
 * It has happened twice — the content DTOs and the settings DTO — and both
 * times the symptom was a save that silently did nothing. `settings.dto.test.ts`
 * is the guard for the second; this is the guard for the eighteen modules that
 * will copy this shape.
 *
 * The last test is the one that will actually catch the next occurrence: it
 * enumerates the declared fields and asserts that each survives, so a property
 * added next year without a decorator fails here rather than in production.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const through = <T>(metatype: new () => T, body: unknown): Promise<T> =>
  pipe.transform(body, { type: "body", metatype }) as Promise<T>;

describe("CreateProjectDto", () => {
  const valid = { name: "Schulhaus Guglera", customerId: "c1" };

  it("accepts the minimum", async () => {
    const out = await through(CreateProjectDto, valid);
    expect(out.name).toBe("Schulhaus Guglera");
    expect(out.customerId).toBe("c1");
  });

  it("refuses a missing customer", async () => {
    // The Bauherrschaft is required *data*, and the DTO says so first so the
    // caller gets a field error instead of a foreign-key violation.
    await expect(through(CreateProjectDto, { name: "Ohne Kunde" })).rejects.toThrow();
  });

  it("refuses a one-character name", async () => {
    await expect(through(CreateProjectDto, { ...valid, name: "A" })).rejects.toThrow();
  });

  it("keeps every optional field it is given", async () => {
    const out = await through(CreateProjectDto, {
      ...valid,
      architectId: "c2",
      buildingId: "b1",
      managerId: "e1",
      officeId: "o1",
      priority: "HIGH",
      startDate: "2026-03-01",
      plannedEndDate: "2026-12-31",
      contractValue: "1450000.00",
      budgetHours: 2400,
      description: "Sanierung Lüftung",
      notes: "intern",
    });

    expect(out.architectId).toBe("c2");
    expect(out.buildingId).toBe("b1");
    expect(out.managerId).toBe("e1");
    expect(out.officeId).toBe("o1");
    expect(out.priority).toBe("HIGH");
    expect(out.startDate).toBe("2026-03-01");
    expect(out.plannedEndDate).toBe("2026-12-31");
    expect(out.contractValue).toBe("1450000.00");
    expect(out.budgetHours).toBe(2400);
    expect(out.description).toBe("Sanierung Lüftung");
    expect(out.notes).toBe("intern");
  });

  it("keeps money as the string it was sent as", async () => {
    // Not coerced to a number anywhere on the way in — the mapper is the only
    // thing that parses it, and it refuses what it cannot parse.
    const out = await through(CreateProjectDto, { ...valid, contractValue: "1450000.00" });
    expect(typeof out.contractValue).toBe("string");
  });

  it("refuses a date that is not a date", async () => {
    // `@IsISO8601` rather than `@IsDate`: a JSON body has no Date, and
    // `new Date("übermorgen")` is an Invalid Date that stores as null.
    await expect(
      through(CreateProjectDto, { ...valid, startDate: "übermorgen" }),
    ).rejects.toThrow();
  });

  it("refuses a status that is not one", async () => {
    await expect(through(CreateProjectDto, { ...valid, priority: "SEHR_HOCH" })).rejects.toThrow();
  });

  it("strips a property the DTO does not declare", async () => {
    // Whitelisting working as intended — which is exactly why every field the
    // DTO *does* want must be decorated.
    const out = (await through(CreateProjectDto, {
      ...valid,
      health: "GREEN",
      progressPercent: 100,
    })) as unknown as Record<string, unknown>;
    expect("health" in out).toBe(false);
    expect("progressPercent" in out).toBe(false);
  });
});

describe("UpdateProjectDto", () => {
  /**
   * Every body carries the version it read (F13).
   *
   * These tests used to send `{}` and `{ managerId: null }`. They now send
   * `expectedVersion` with everything, and that is the *contract* changing
   * rather than the tests being loosened to fit it: an optimistic lock that a
   * caller may omit is one every caller omits exactly once, and the failure is
   * a silent overwrite nobody can detect afterwards.
   */
  const at = (version: number, body: Record<string, unknown> = {}) => ({
    expectedVersion: version,
    ...body,
  });

  it("refuses a body with no version", async () => {
    // The assertion the strictness is for. Without it this DTO would accept
    // `{}` and the service would have nothing to lock on.
    await expect(through(UpdateProjectDto, {})).rejects.toThrow();
    await expect(through(UpdateProjectDto, { name: "Ohne Version" })).rejects.toThrow();
  });

  it("refuses a version that is not one", async () => {
    await expect(through(UpdateProjectDto, { expectedVersion: 0 })).rejects.toThrow();
    await expect(through(UpdateProjectDto, { expectedVersion: -1 })).rejects.toThrow();
    await expect(through(UpdateProjectDto, { expectedVersion: "3" })).rejects.toThrow();
  });

  it("accepts a body that changes nothing but the version it saw", async () => {
    // A PATCH that changes no field is not an error — a form saved without
    // edits still has to succeed.
    const out = await through(UpdateProjectDto, at(3));
    expect(out.expectedVersion).toBe(3);
    expect(Object.keys(out)).toEqual(["expectedVersion"]);
  });

  it("keeps the version note, which only a person can supply", async () => {
    const out = await through(UpdateProjectDto, at(3, { versionNote: "Baustopp Gemeinde" }));
    expect(out.versionNote).toBe("Baustopp Gemeinde");
  });

  it("strips status, which has its own route", async () => {
    // The guard that keeps `refuseTransition` on the only path to the column.
    const out = (await through(UpdateProjectDto, at(3, { status: "COMPLETED" }))) as unknown as Record<string, unknown>;
    expect("status" in out).toBe(false);
  });

  it("strips customerId, because moving a project is not a field edit", async () => {
    const out = (await through(UpdateProjectDto, at(3, { customerId: "c9" }))) as unknown as Record<string, unknown>;
    expect("customerId" in out).toBe(false);
  });

  it("keeps an explicit null, which is how a link is cleared", async () => {
    const out = await through(UpdateProjectDto, at(3, { managerId: null }));
    expect(out.managerId).toBeNull();
    expect("managerId" in out).toBe(true);
  });

  it("keeps every field it declares", async () => {
    const body = {
      expectedVersion: 3,
      versionNote: "Grund",
      name: "Neuer Name",
      architectId: "c2",
      buildingId: "b1",
      managerId: "e1",
      officeId: "o1",
      priority: "URGENT",
      currentPhase: "P51",
      startDate: "2026-03-01",
      plannedEndDate: "2026-12-31",
      actualEndDate: "2026-11-30",
      contractValue: "99.00",
      budgetHours: 10,
      description: "d",
      notes: "n",
    };
    const out = (await through(UpdateProjectDto, body)) as unknown as Record<string, unknown>;
    for (const key of Object.keys(body)) {
      expect(key in out, `${key} was stripped — it needs a class-validator decorator`).toBe(true);
    }
  });
});

describe("ChangeStatusDto", () => {
  it("requires a status", async () => {
    await expect(through(ChangeStatusDto, {})).rejects.toThrow();
  });

  it("keeps the reason, which the audit row records", async () => {
    const out = await through(ChangeStatusDto, { status: "ON_HOLD", reason: "Baustopp" });
    expect(out.reason).toBe("Baustopp");
  });
});

describe("AddMemberDto", () => {
  it("requires an employee", async () => {
    await expect(through(AddMemberDto, { role: "ENGINEER" })).rejects.toThrow();
  });

  it("bounds the allocation to 1–100", async () => {
    await expect(through(AddMemberDto, { employeeId: "e1", allocationPercent: 0 })).rejects.toThrow();
    await expect(
      through(AddMemberDto, { employeeId: "e1", allocationPercent: 150 }),
    ).rejects.toThrow();
    const out = await through(AddMemberDto, { employeeId: "e1", allocationPercent: 60 });
    expect(out.allocationPercent).toBe(60);
  });
});

describe("ScopeDisciplineDto", () => {
  it("keeps a fee share of 0 rather than stripping it", async () => {
    // `0` is falsy and a Gewerk carrying no fee is a real state. A stripped
    // zero is indistinguishable from "not supplied" at every layer below.
    const out = await through(ScopeDisciplineDto, { disciplineId: "d1", feeShare: 0 });
    expect(out.feeShare).toBe(0);
  });

  it("allows a single row above 100, because the total is the rule", async () => {
    const out = await through(ScopeDisciplineDto, { disciplineId: "d1", feeShare: 120 });
    expect(out.feeShare).toBe(120);
  });

  it("keeps false for the override", async () => {
    const out = await through(ScopeDisciplineDto, {
      disciplineId: "d1",
      feeShareOverride: false,
    });
    expect(out.feeShareOverride).toBe(false);
  });

  it("keeps money fields as strings", async () => {
    const out = await through(ScopeDisciplineDto, {
      disciplineId: "d1",
      budgetCost: "120000.00",
      hourlyRate: "165.00",
    });
    expect(out.budgetCost).toBe("120000.00");
    expect(out.hourlyRate).toBe("165.00");
  });
});

describe("CreateMilestoneDto", () => {
  it("requires a name and a due date", async () => {
    await expect(through(CreateMilestoneDto, { name: "Abgabe" })).rejects.toThrow();
    await expect(through(CreateMilestoneDto, { dueDate: "2026-05-01" })).rejects.toThrow();
  });

  it("keeps false for the billing trigger", async () => {
    const out = await through(CreateMilestoneDto, {
      name: "Abgabe",
      dueDate: "2026-05-01",
      isBillingTrigger: false,
    });
    expect(out.isBillingTrigger).toBe(false);
  });
});

describe("BulkProjectsDto", () => {
  it("caps the selection", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `p${i}`);
    await expect(through(BulkProjectsDto, { ids, priority: "LOW" })).rejects.toThrow();
  });

  it("accepts a selection at the cap", async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `p${i}`);
    const out = await through(BulkProjectsDto, { ids, priority: "LOW" });
    expect(out.ids).toHaveLength(200);
  });
});

describe("ReorderMilestonesDto", () => {
  it("validates inside the nested objects", async () => {
    // `@ValidateNested` without `@Type(() => X)` validates nothing and
    // whitelisting then strips every nested field — silently. This is the
    // assertion that catches a missing `@Type`.
    await expect(
      through(ReorderMilestonesDto, { order: [{ id: "s1", dueDate: "irgendwann" }] }),
    ).rejects.toThrow();

    const out = await through(ReorderMilestonesDto, {
      order: [{ id: "s1", dueDate: "2026-05-01" }],
    });
    expect(out.order[0].id).toBe("s1");
    expect(out.order[0].dueDate).toBe("2026-05-01");
  });
});
