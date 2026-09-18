import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  AddAttendeeDto,
  AddMeetingItemDto,
  ApproveMinutesDto,
  ChangeDecisionStatusDto,
  CreateDecisionDto,
  CreateMeetingDto,
  RecordAttendanceDto,
  ReorderItemsDto,
  SupersedeDecisionDto,
  UpdateDecisionDto,
  UpdateMeetingDto,
} from "./meetings.dto";

/**
 * Every field of every DTO, through the **real pipe with the real options**.
 *
 * Not "does each property have a decorator" — an undecorated property is
 * *stripped* by `whitelist: true`, the service receives `undefined`, Prisma
 * reads that as "leave the column alone", and the endpoint answers 200 having
 * changed nothing. It has happened twice in this codebase.
 *
 * What this file **cannot** see is the other half of the same mechanism: a
 * transformed DTO carries every declared property, which is why `changedFields`
 * exists and why its guard lives in e2e. See `core/versioning/changed.ts`.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const through = <T>(metatype: new () => T, body: unknown): Promise<T> =>
  pipe.transform(body, { type: "body", metatype }) as Promise<T>;

describe("CreateMeetingDto", () => {
  const valid = { title: "Bausitzung", startsAt: "2026-10-01T14:00:00Z" };

  it("accepts a meeting with a title and a time", () => {
    return expect(through(CreateMeetingDto, valid)).resolves.toMatchObject({
      title: "Bausitzung",
    });
  });

  it("accepts a meeting with no project", () => {
    // An internal Geschäftsleitungssitzung is a meeting with minutes and no
    // project — the same decision `Task.projectId` makes.
    return expect(through(CreateMeetingDto, valid)).resolves.not.toHaveProperty(
      "projectId",
      expect.any(String),
    );
  });

  it("refuses a missing start time", async () => {
    await expect(through(CreateMeetingDto, { title: "Bausitzung" })).rejects.toThrow();
  });

  it("refuses a start time that is not a time", async () => {
    // `@IsISO8601` and not `@IsDate`: a JSON body has no `Date`, and `@IsDate`
    // would accept an Invalid Date, which Prisma stores as `null`.
    await expect(
      through(CreateMeetingDto, { ...valid, startsAt: "nächste Woche" }),
    ).rejects.toThrow();
  });

  it("keeps every optional field it is given", async () => {
    const body = {
      ...valid,
      endsAt: "2026-10-01T15:30:00Z",
      type: "ABNAHME",
      location: "Baubüro",
      projectId: "p1",
      organiserId: "e1",
      seriesNumber: 14,
    };
    const out = await through(CreateMeetingDto, body);
    for (const key of Object.keys(body)) {
      expect(out, `${key} was stripped`).toHaveProperty(key);
    }
  });

  it("refuses a meeting type outside the enum", async () => {
    await expect(through(CreateMeetingDto, { ...valid, type: "STAMMTISCH" })).rejects.toThrow();
  });
});

describe("UpdateMeetingDto", () => {
  it("requires expectedVersion", async () => {
    // An optional lock is one every caller forgets exactly once, and the
    // failure is a save that silently overwrites somebody else's.
    await expect(through(UpdateMeetingDto, { title: "Neu" })).rejects.toThrow();
  });

  it("has no status field", async () => {
    /**
     * Holding or cancelling is a transition with preconditions and its own
     * permission. If this ever passes, `PATCH /meetings/:id { status: "HELD" }`
     * walks past `refuseTransition`.
     */
    const out = (await through(UpdateMeetingDto, {
      expectedVersion: 1,
      status: "HELD",
    })) as unknown as Record<string, unknown>;
    expect(out.status).toBeUndefined();
  });

  it("keeps every optional field it is given", async () => {
    const body = {
      expectedVersion: 2,
      versionNote: "Nach der Sitzung korrigiert",
      title: "Bausitzung",
      startsAt: "2026-10-01T14:00:00Z",
      endsAt: "2026-10-01T16:00:00Z",
      type: "BAUSITZUNG",
      location: "Vor Ort",
      organiserId: "e2",
      seriesNumber: 15,
    };
    const out = await through(UpdateMeetingDto, body);
    for (const key of Object.keys(body)) {
      expect(out, `${key} was stripped`).toHaveProperty(key);
    }
  });
});

describe("AddAttendeeDto", () => {
  it("accepts an employee", async () => {
    await expect(through(AddAttendeeDto, { employeeId: "e1" })).resolves.toMatchObject({
      employeeId: "e1",
    });
  });

  it("accepts an external person", async () => {
    /**
     * There is no `Contact` table — the CRM is Wave 3 — and a Bausitzung
     * without the Bauherrschaft in the attendance list is not a Bausitzung.
     */
    const out = await through(AddAttendeeDto, {
      externalName: "R. Bürgi",
      externalOrg: "Gemeinde Giffers",
    });
    expect(out.externalName).toBe("R. Bürgi");
    expect(out.externalOrg).toBe("Gemeinde Giffers");
  });

  it("does not itself refuse both or neither", async () => {
    // Checked in the service: `@ValidateIf` would put half of "what an attendee
    // is" in the DTO, and it is the rule that changes when `Contact` lands.
    await expect(
      through(AddAttendeeDto, { employeeId: "e1", externalName: "R. Bürgi" }),
    ).resolves.toBeTruthy();
    await expect(through(AddAttendeeDto, {})).resolves.toBeTruthy();
  });
});

describe("RecordAttendanceDto", () => {
  it("validates the nested entries", async () => {
    /**
     * `@ValidateNested` **requires** `@Type`. Without it class-validator
     * receives a plain object, validates nothing inside, and whitelisting
     * strips every nested field — silently. This is the assertion that proves
     * the `@Type` is there.
     */
    await expect(
      through(RecordAttendanceDto, { attendance: [{ attended: true }] }),
    ).rejects.toThrow();
  });

  it("accepts a room", async () => {
    const out = await through(RecordAttendanceDto, {
      attendance: [
        { attendeeId: "a1", attended: true },
        { attendeeId: "a2", attended: false, apologised: true },
      ],
    });
    expect(out.attendance).toHaveLength(2);
    expect(out.attendance[1].apologised).toBe(true);
  });

  it("refuses a room of a hundred and one", async () => {
    await expect(
      through(RecordAttendanceDto, {
        attendance: Array.from({ length: 101 }, (_, i) => ({ attendeeId: `a${i}` })),
      }),
    ).rejects.toThrow();
  });
});

describe("AddMeetingItemDto", () => {
  it("accepts an information line with nothing but text", async () => {
    await expect(
      through(AddMeetingItemDto, { text: "Das Protokoll wird genehmigt." }),
    ).resolves.toBeTruthy();
  });

  it("keeps every optional field it is given", async () => {
    const body = {
      text: "Luftmengen neu berechnen.",
      kind: "PENDENZ",
      agendaItemId: "ag1",
      responsibleId: "e1",
      dueDate: "2026-11-30",
      disciplineId: "d1",
      createTask: false,
      taskId: "t1",
      decisionId: "dec1",
    };
    const out = await through(AddMeetingItemDto, body);
    for (const key of Object.keys(body)) {
      expect(out, `${key} was stripped`).toHaveProperty(key);
    }
  });

  it("leaves createTask undefined when it was not sent", async () => {
    // The service defaults it to `true` for a Pendenz — the whole reason Tasks
    // was built before Meetings — and `undefined` is how it can tell.
    const out = await through(AddMeetingItemDto, { text: "Etwas", kind: "PENDENZ" });
    expect(out.createTask).toBeUndefined();
  });
});

describe("ReorderItemsDto", () => {
  it("takes the order as a list of ids", async () => {
    const out = await through(ReorderItemsDto, { order: ["a", "b", "c"] });
    expect(out.order).toEqual(["a", "b", "c"]);
  });

  it("refuses a protocol of five hundred and one lines", async () => {
    await expect(
      through(ReorderItemsDto, { order: Array.from({ length: 501 }, (_, i) => `i${i}`) }),
    ).rejects.toThrow();
  });
});

describe("ApproveMinutesDto", () => {
  it("requires a decision from the enum", async () => {
    await expect(through(ApproveMinutesDto, {})).rejects.toThrow();
    await expect(through(ApproveMinutesDto, { decision: "VIELLEICHT" })).rejects.toThrow();
  });

  it("does not itself require a note for an amendment", async () => {
    // Checked in the service: a conditional decorator would put half of what an
    // approval means in the DTO.
    await expect(through(ApproveMinutesDto, { decision: "AMENDED" })).resolves.toBeTruthy();
  });
});

describe("CreateDecisionDto", () => {
  const valid = {
    title: "Lüftung OG2 wird umgebaut",
    rationale: "Die Nutzung wechselt und die zentrale Regelung führt zu Zug.",
    projectId: "p1",
    decidedAt: "2026-09-18",
  };

  it("accepts a complete decision", async () => {
    await expect(through(CreateDecisionDto, valid)).resolves.toMatchObject({ projectId: "p1" });
  });

  it("requires a rationale", async () => {
    /**
     * **The module's defining field.** The record exists to answer *why*; the
     * length floor is in `refuseDecision`, because "ok" passes any decorator.
     */
    const { rationale, ...without } = valid;
    void rationale;
    await expect(through(CreateDecisionDto, without)).rejects.toThrow();
  });

  it("requires a project", async () => {
    // A decision is always about a project.
    const { projectId, ...without } = valid;
    void projectId;
    await expect(through(CreateDecisionDto, without)).rejects.toThrow();
  });

  it("takes the cost as a string, and the format check is the mapper's", async () => {
    // `@IsNumber()` would accept `1234.567` and let the column round it
    // silently; `toMoney` refuses anything else with the field named.
    const out = await through(CreateDecisionDto, { ...valid, costImpact: "48'000.00" });
    expect(out.costImpact).toBe("48'000.00");
  });

  it("accepts a negative schedule impact", async () => {
    // A decision that saves time is a decision with a schedule impact.
    await expect(
      through(CreateDecisionDto, { ...valid, scheduleImpactDays: -5 }),
    ).resolves.toMatchObject({ scheduleImpactDays: -5 });
  });
});

describe("UpdateDecisionDto", () => {
  it("requires expectedVersion", async () => {
    await expect(through(UpdateDecisionDto, { title: "Neu" })).rejects.toThrow();
  });

  it("has neither status nor supersedesId", async () => {
    /**
     * Reversing a decision is `decision.supersede`, not an edit —
     * `docs/permissions.md` §3.11: *"`update` is corrections; reversing a
     * decision is its own authority."* If either of these ever survives, that
     * separation is gone.
     */
    const out = (await through(UpdateDecisionDto, {
      expectedVersion: 1,
      status: "AUFGEHOBEN",
      supersedesId: "d9",
    })) as unknown as Record<string, unknown>;
    expect(out.status).toBeUndefined();
    expect(out.supersedesId).toBeUndefined();
  });
});

describe("ChangeDecisionStatusDto", () => {
  it("accepts AUFGEHOBEN so the rules can explain why not", async () => {
    /**
     * Narrowing the enum here would answer an attempt with *"Die Eingaben sind
     * unvollständig oder ungültig"*, which tells a user nothing about what to
     * do instead. `refuseDecisionStatus` answers with the sentence that
     * matters: a decision is replaced, not withdrawn.
     */
    await expect(
      through(ChangeDecisionStatusDto, { status: "AUFGEHOBEN" }),
    ).resolves.toMatchObject({ status: "AUFGEHOBEN" });
  });

  it("still refuses a status that is not one", async () => {
    await expect(through(ChangeDecisionStatusDto, { status: "VIELLEICHT" })).rejects.toThrow();
  });
});

describe("SupersedeDecisionDto", () => {
  it("names the decision being replaced", async () => {
    // Sent to the **new** decision's route, naming the old one — so a reversal
    // names its successor rather than the other way round.
    await expect(through(SupersedeDecisionDto, { supersedesId: "d1" })).resolves.toMatchObject({
      supersedesId: "d1",
    });
  });

  it("requires it", async () => {
    await expect(through(SupersedeDecisionDto, {})).rejects.toThrow();
  });
});
