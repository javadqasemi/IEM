import { describe, expect, it } from "vitest";
import { VERSION_CONTROL_FIELDS, changedFields } from "./changed";

/**
 * `changedFields`, and an honest note about what this file cannot prove.
 *
 * ---
 *
 * **The premise is not reproducible under vitest**, and that is the same
 * toolchain gap CLAUDE.md already records for Nest DI. The bug lives in the
 * *compiled* DTO: `tsc` targets ES2022, so `useDefineForClassFields` defines
 * every `@IsOptional() foo?: string` as `undefined` on the instance, and
 * `ValidationPipe` with `transform: true` hands the service that instance.
 * Vitest transforms with esbuild, which does not do the same thing — the
 * instance it produces carries only the keys the request sent, so a test that
 * ran the real pipe here would **pass against the broken code**.
 *
 * Measured against `dist/`, which is what actually runs:
 *
 * ```
 * $ node -e '…pipe.transform({expectedVersion:1, description:"x"}, UpdateTaskDto)'
 * UpdateTaskDto    keys: 13   ["expectedVersion","versionNote","title",…]
 * UpdateProjectDto keys: 16   ["expectedVersion","versionNote","name",…]
 * ```
 *
 * So this file tests the **function**, against objects shaped the way the
 * compiled DTO is — explicit `undefined`s and all — and `e2e/tasks.spec.ts`
 * tests the **behaviour** against the running API, where the compiled shape is
 * the one in play. Neither alone would have caught it; the browser is what did.
 */

/**
 * What a compiled, transformed DTO looks like.
 *
 * Written out rather than produced by the pipe, precisely because the pipe
 * under vitest produces something else. Every declared key is present; the ones
 * the caller did not send are `undefined`.
 */
const transformed = (sent: Record<string, unknown>) => ({
  expectedVersion: undefined,
  versionNote: undefined,
  title: undefined,
  description: undefined,
  priority: undefined,
  startDate: undefined,
  dueDate: undefined,
  estimateHours: undefined,
  projectId: undefined,
  milestoneId: undefined,
  disciplineId: undefined,
  parentTaskId: undefined,
  assigneeId: undefined,
  ...sent,
});

describe("changedFields", () => {
  it("reports only what the request carried", () => {
    const dto = transformed({ expectedVersion: 1, description: "Nur das hier" });
    expect(changedFields(dto, VERSION_CONTROL_FIELDS)).toEqual(["description"]);
  });

  it("would have reported thirteen fields without it", () => {
    // The counterfactual, so the size of the failure is on the record rather
    // than in a commit message: thirteen field names on a row describing one
    // edit, on every row of every history.
    const dto = transformed({ expectedVersion: 1, description: "Nur das hier" });
    const naive = Object.keys(dto).filter((key) => key !== "expectedVersion");
    expect(naive.length).toBe(12);
  });

  it("keeps a null, because null is a change", () => {
    // `undefined` means "not supplied"; `null` means "clear it" — the same
    // distinction the mappers make, and clearing a due date is exactly the kind
    // of edit a history has to record.
    const dto = transformed({ expectedVersion: 2, dueDate: null });
    expect(changedFields(dto, VERSION_CONTROL_FIELDS)).toEqual(["dueDate"]);
  });

  it("keeps an empty string and a zero", () => {
    // Only `undefined` means absent. A cleared text field arrives as `""` and a
    // budget set to nothing arrives as `0`, and both are edits somebody made.
    expect(changedFields(transformed({ description: "" }), VERSION_CONTROL_FIELDS)).toEqual([
      "description",
    ]);
    expect(changedFields({ budgetHours: 0 })).toEqual(["budgetHours"]);
  });

  it("drops the version and the note, which are not fields of the record", () => {
    const dto = transformed({
      expectedVersion: 3,
      versionNote: "Nach Bausitzung 14",
      title: "Anders",
    });
    const fields = changedFields(dto, VERSION_CONTROL_FIELDS);
    expect(fields).toEqual(["title"]);
    expect(fields).not.toContain("versionNote");
  });

  it("reports an empty list for a save that changed nothing", () => {
    /*
      A legitimate request: a form where the user pressed save without editing.
      An empty list is the honest answer, and the history row reads "—" rather
      than claiming thirteen fields moved.
    */
    expect(changedFields(transformed({ expectedVersion: 4 }), VERSION_CONTROL_FIELDS)).toEqual([]);
  });

  it("reports several when several were sent, in the DTO's own order", () => {
    // Declaration order, not insertion order: the spread puts the sent values
    // into slots that already exist. That is stable, which is what a history
    // comparing two rows needs.
    const dto = transformed({
      expectedVersion: 5,
      title: "Neu",
      priority: "URGENT",
      dueDate: "2026-12-01",
    });
    expect(changedFields(dto, VERSION_CONTROL_FIELDS)).toEqual(["title", "priority", "dueDate"]);
  });
});

describe("the ignore list", () => {
  it("takes any keys, for a caller with different ceremony", () => {
    // `bulk` passes `["ids"]`: the selection is not a field of any record.
    expect(changedFields({ ids: ["a"], priority: "LOW" }, ["ids"])).toEqual(["priority"]);
  });

  it("defaults to ignoring nothing", () => {
    expect(changedFields({ a: 1, b: undefined })).toEqual(["a"]);
  });

  it("ignores a key that is not there", () => {
    expect(changedFields({ a: 1 }, ["nope"])).toEqual(["a"]);
  });
});
