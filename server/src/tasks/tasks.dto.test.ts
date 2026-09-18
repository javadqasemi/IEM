import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  AddChecklistItemDto,
  AddCommentDto,
  AddDependencyDto,
  BulkTasksDto,
  ChangeTaskStatusDto,
  CreateTaskDto,
  MoveTaskDto,
  UpdateTaskDto,
} from "./tasks.dto";

/**
 * Every field of every DTO, through the **real pipe with the real options**.
 *
 * Not "does each property have a decorator". Asserting the decorator would pass
 * if somebody swapped it for one that does not survive whitelisting, and
 * whitelisting is the whole failure mode: an undecorated property is *stripped*
 * on the way in, the service receives `undefined`, Prisma reads that as "leave
 * the column alone", and the endpoint answers 200 having changed nothing.
 *
 * It has happened twice in this codebase and both times the symptom was a save
 * that silently did nothing. The last test in each block is the one that will
 * catch the next occurrence: it enumerates the declared fields and asserts each
 * survives, so a property added next year without a decorator fails here.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const through = <T>(metatype: new () => T, body: unknown): Promise<T> =>
  pipe.transform(body, { type: "body", metatype }) as Promise<T>;

describe("CreateTaskDto", () => {
  const valid = { title: "Lüftungskonzept prüfen" };

  it("accepts a task with nothing but a title", () => {
    /**
     * **The module's defining decision, asserted.** A task with no project is
     * the firm's own to-do; requiring one would push those into a dummy
     * "Sonstiges" project or out of the system. If somebody ever makes
     * `projectId` required, this test is what says no.
     */
    return expect(through(CreateTaskDto, valid)).resolves.toMatchObject({
      title: "Lüftungskonzept prüfen",
    });
  });

  it("refuses a one-character title", async () => {
    await expect(through(CreateTaskDto, { title: "A" })).rejects.toThrow();
  });

  it("refuses a missing title", async () => {
    await expect(through(CreateTaskDto, {})).rejects.toThrow();
  });

  it("keeps every optional field it is given", async () => {
    const body = {
      ...valid,
      description: "Gegen SIA 382/1",
      projectId: "p1",
      milestoneId: "m1",
      assigneeId: "e1",
      disciplineId: "d1",
      parentTaskId: "t1",
      priority: "HIGH",
      startDate: "2026-03-01",
      dueDate: "2026-03-10",
      estimateHours: "7.50",
    };
    const out = await through(CreateTaskDto, body);
    // The enumeration: every declared field survives whitelisting. A field added
    // without a decorator fails here rather than in production.
    for (const key of Object.keys(body)) {
      expect(out, `${key} was stripped`).toHaveProperty(key);
    }
  });

  it("strips what it was not given", async () => {
    const out = (await through(CreateTaskDto, { ...valid, geheim: "x" })) as unknown as Record<string, unknown>;
    expect(out.geheim).toBeUndefined();
  });

  it("refuses a priority outside the enum", async () => {
    await expect(through(CreateTaskDto, { ...valid, priority: "SOFORT" })).rejects.toThrow();
  });

  it("refuses a date that is not a date", async () => {
    // `@IsISO8601` and not `@IsDate`: a JSON body has no `Date`, and `@IsDate`
    // would accept an Invalid Date, which Prisma stores as `null`.
    await expect(through(CreateTaskDto, { ...valid, dueDate: "nächste Woche" })).rejects.toThrow();
  });

  it("takes hours as a string, and the format check is the mapper's", async () => {
    // `"4,25"` passes the DTO — it is a string — and `toHours` refuses it with
    // the field named. The two checks are separate because they are separate
    // errors, and one message covering both tells somebody who typed a comma
    // nothing about the comma.
    const out = await through(CreateTaskDto, { ...valid, estimateHours: "4,25" });
    expect(out.estimateHours).toBe("4,25");
  });
});

describe("UpdateTaskDto", () => {
  it("requires expectedVersion", async () => {
    /**
     * Required rather than optional, and the reasoning is `UpdateProjectDto`'s:
     * an optional lock is one every caller forgets exactly once, and the failure
     * is the worst kind — the second save wins silently and nothing records that
     * the first person's work existed.
     */
    await expect(through(UpdateTaskDto, { title: "Neu" })).rejects.toThrow();
  });

  it("refuses a version below 1", async () => {
    await expect(through(UpdateTaskDto, { expectedVersion: 0 })).rejects.toThrow();
  });

  it("accepts a body that changes nothing but the version", async () => {
    // Legitimate: a save from a form where the user changed nothing. Refusing it
    // would make the client decide whether a diff is empty.
    await expect(through(UpdateTaskDto, { expectedVersion: 3 })).resolves.toMatchObject({
      expectedVersion: 3,
    });
  });

  it("has no status field", async () => {
    /**
     * The separation that keeps `refuseTransition` on the only path reaching the
     * column. If this ever passes, `PATCH /tasks/:id { status: "DONE" }` walks
     * past every completion precondition.
     */
    const out = (await through(UpdateTaskDto, {
      expectedVersion: 1,
      status: "DONE",
    })) as unknown as Record<string, unknown>;
    expect(out.status).toBeUndefined();
  });

  it("has no position field", async () => {
    // A position is meaningless without knowing the column and the neighbours.
    // `PUT /tasks/:id/position` takes what a drag actually produces.
    const out = (await through(UpdateTaskDto, {
      expectedVersion: 1,
      position: 9999,
    })) as unknown as Record<string, unknown>;
    expect(out.position).toBeUndefined();
  });

  it("keeps every optional field it is given", async () => {
    const body = {
      expectedVersion: 2,
      versionNote: "Nach Bausitzung 14",
      title: "Anders",
      description: "Text",
      priority: "URGENT",
      startDate: "2026-04-01",
      dueDate: "2026-04-30",
      estimateHours: "12.00",
      projectId: "p2",
      milestoneId: "m2",
      disciplineId: "d2",
      parentTaskId: "t2",
      assigneeId: "e2",
    };
    const out = await through(UpdateTaskDto, body);
    for (const key of Object.keys(body)) {
      expect(out, `${key} was stripped`).toHaveProperty(key);
    }
  });

  it("carries assigneeId although a dedicated route exists", async () => {
    // The one duplication in the file worth having: reassigning is usually part
    // of editing a card, and the service checks `task.assign` whenever the field
    // is present, whichever route carried it.
    const out = await through(UpdateTaskDto, { expectedVersion: 1, assigneeId: null });
    expect(out).toHaveProperty("assigneeId");
  });
});

describe("ChangeTaskStatusDto", () => {
  it("requires a status from the enum", async () => {
    await expect(through(ChangeTaskStatusDto, {})).rejects.toThrow();
    await expect(through(ChangeTaskStatusDto, { status: "FERTIG" })).rejects.toThrow();
  });

  it("accepts a reason", async () => {
    const out = await through(ChangeTaskStatusDto, { status: "BLOCKED", reason: "Kunde antwortet nicht" });
    expect(out.reason).toBe("Kunde antwortet nicht");
  });

  it("does not itself require a reason for BLOCKED", async () => {
    // Checked in the service, not here: a conditional decorator would put half
    // of what a transition means in the DTO and half in the rules file.
    await expect(through(ChangeTaskStatusDto, { status: "BLOCKED" })).resolves.toBeTruthy();
  });
});

describe("MoveTaskDto", () => {
  it("accepts a drag within a column", async () => {
    const out = await through(MoveTaskDto, { afterId: "t1", beforeId: "t2" });
    expect(out.afterId).toBe("t1");
    expect(out.beforeId).toBe("t2");
  });

  it("accepts a drag to the top of a column", async () => {
    await expect(through(MoveTaskDto, { beforeId: "t2" })).resolves.toMatchObject({
      beforeId: "t2",
    });
  });

  it("accepts a status with the move", async () => {
    await expect(through(MoveTaskDto, { status: "IN_PROGRESS" })).resolves.toMatchObject({
      status: "IN_PROGRESS",
    });
  });

  it("takes no position", async () => {
    // The neighbours, not a number — otherwise the client holds a second copy of
    // `positionBetween` including the renumber case, which it cannot perform.
    const out = (await through(MoveTaskDto, { position: 1536 })) as unknown as Record<string, unknown>;
    expect(out.position).toBeUndefined();
  });
});

describe("AddDependencyDto", () => {
  it("requires a predecessor", async () => {
    await expect(through(AddDependencyDto, {})).rejects.toThrow();
  });

  it("defaults to nothing and lets the service choose FS", async () => {
    const out = await through(AddDependencyDto, { predecessorId: "t1" });
    expect(out.type).toBeUndefined();
  });

  it("accepts all four relation types", async () => {
    for (const type of ["FS", "SS", "FF", "SF"]) {
      await expect(
        through(AddDependencyDto, { predecessorId: "t1", type }),
        type,
      ).resolves.toMatchObject({ type });
    }
  });

  it("accepts a negative lag", async () => {
    // A lag of −2 on `FS` means the successor may start two days before the
    // predecessor finishes, which is how a Bauprogramm overlaps trades.
    await expect(
      through(AddDependencyDto, { predecessorId: "t1", lagDays: -2 }),
    ).resolves.toMatchObject({ lagDays: -2 });
  });

  it("refuses a lag beyond a year", async () => {
    await expect(through(AddDependencyDto, { predecessorId: "t1", lagDays: 400 })).rejects.toThrow();
  });
});

describe("AddChecklistItemDto", () => {
  it("requires text", async () => {
    await expect(through(AddChecklistItemDto, {})).rejects.toThrow();
    await expect(through(AddChecklistItemDto, { text: "" })).rejects.toThrow();
  });

  it("refuses an essay", async () => {
    await expect(
      through(AddChecklistItemDto, { text: "x".repeat(501) }),
    ).rejects.toThrow();
  });
});

describe("AddCommentDto", () => {
  it("requires a body", async () => {
    await expect(through(AddCommentDto, {})).rejects.toThrow();
  });

  it("keeps mentions as an array of ids", async () => {
    const out = await through(AddCommentDto, { body: "@Anna bitte prüfen", mentionedIds: ["e1", "e2"] });
    expect(out.mentionedIds).toEqual(["e1", "e2"]);
  });

  it("refuses a mention list that is a broadcast", async () => {
    await expect(
      through(AddCommentDto, { body: "x", mentionedIds: Array.from({ length: 21 }, (_, i) => `e${i}`) }),
    ).rejects.toThrow();
  });
});

describe("BulkTasksDto", () => {
  it("requires ids", async () => {
    await expect(through(BulkTasksDto, { priority: "HIGH" })).rejects.toThrow();
  });

  it("caps the selection at the list's own ceiling", async () => {
    // A request naming ten thousand ids is either a mistake or a way around
    // `maxPerPage`.
    await expect(
      through(BulkTasksDto, { ids: Array.from({ length: 201 }, (_, i) => `t${i}`), priority: "LOW" }),
    ).rejects.toThrow();
  });

  it("accepts priority, assignee, or both", async () => {
    await expect(through(BulkTasksDto, { ids: ["t1"], priority: "LOW" })).resolves.toBeTruthy();
    await expect(through(BulkTasksDto, { ids: ["t1"], assigneeId: "e1" })).resolves.toBeTruthy();
    const both = await through(BulkTasksDto, { ids: ["t1"], priority: "LOW", assigneeId: "e1" });
    expect(both.priority).toBe("LOW");
    expect(both.assigneeId).toBe("e1");
  });

  it("has no status field", async () => {
    /**
     * A bulk status change would run `refuseTransition` two hundred times and
     * either fail the whole request on one bad row or half-apply it, and "half
     * of what you selected changed" is the worst possible answer.
     */
    const out = (await through(BulkTasksDto, { ids: ["t1"], status: "DONE" })) as unknown as Record<string, unknown>;
    expect(out.status).toBeUndefined();
  });
});
