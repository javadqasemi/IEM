import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/core/api";
import { formReducerForTest as reducer } from "./useForm";

/**
 * The form layer's rules, tested without React.
 *
 * `useForm` is a `useState` wrapper around the four decisions below, and the
 * decisions are what can be wrong. Testing them through a renderer would need
 * a DOM this project deliberately does not have (`vitest.config.ts`), and would
 * tell us less about which rule broke.
 */

type Values = { name: string; note: string; tags: string[] };
const initial: Values = { name: "Guglera", note: "", tags: ["a"] };

describe("dirty is computed, not flagged", () => {
  /**
   * The bug this replaces. `ContentEditor` set `setDirty(true)` on every
   * change, so typing a character and deleting it left a form that believed it
   * had unsaved work — and with an unsaved-changes guard attached, that is a
   * dialog in the reader's way for nothing.
   */
  it("is clean at the start", () => {
    expect(reducer.isDirty(initial, initial)).toBe(false);
  });

  it("is dirty after a change", () => {
    expect(reducer.isDirty(initial, { ...initial, name: "Anderes" })).toBe(true);
  });

  it("is clean again when the change is undone", () => {
    const edited = { ...initial, name: "Anderes" };
    const undone = { ...edited, name: "Guglera" };
    expect(reducer.isDirty(initial, undone)).toBe(false);
  });

  /**
   * Key order is not a change.
   *
   * A content entry's draft is an arbitrary JSON object, and `structuredClone`
   * of a row read back from Postgres `jsonb` does not preserve order. Without
   * canonicalisation almost every form would open dirty — the same failure
   * `snapshot.builder.ts` documents for document comparison.
   */
  it("ignores key order", () => {
    const a = { x: 1, y: { p: 1, q: 2 } };
    const b = { y: { q: 2, p: 1 }, x: 1 };
    expect(reducer.isDirty(a, b)).toBe(false);
  });

  it("does not ignore array order, because that is a change", () => {
    // Reordering a list of team members is exactly what the reorder feature
    // does, and it has to count.
    expect(reducer.isDirty({ t: ["a", "b"] }, { t: ["b", "a"] })).toBe(true);
  });

  it("sees a nested change", () => {
    expect(reducer.isDirty({ a: { b: 1 } }, { a: { b: 2 } })).toBe(true);
  });
});

describe("clearing a field's error", () => {
  /**
   * An error that survives the correction is worse than no error: it tells the
   * reader they are still wrong when they are not.
   */
  it("drops the error for the field that changed", () => {
    const errors = { name: ["Pflichtfeld"], note: ["Zu lang"] };
    expect(reducer.clearErrors(errors, ["name"])).toEqual({ note: ["Zu lang"] });
  });

  it("leaves the object alone when the field had no error", () => {
    const errors = { note: ["Zu lang"] };
    // Same reference, so React does not re-render for nothing.
    expect(reducer.clearErrors(errors, ["name"])).toBe(errors);
  });

  it("drops every field a patch touched", () => {
    const errors = { name: ["a"], note: ["b"], tags: ["c"] };
    expect(reducer.clearErrors(errors, ["name", "note"])).toEqual({ tags: ["c"] });
  });
});

describe("what a failed submit produces", () => {
  it("maps an ApiError's field messages onto the fields", () => {
    const err = new ApiError({
      statusCode: 422,
      code: "validation_failed",
      message: "Eingaben prüfen",
      fields: { name: ["Pflichtfeld"] },
    });
    expect(reducer.errorsFrom(err)).toEqual({
      errors: { name: ["Pflichtfeld"] },
      error: "Eingaben prüfen",
    });
  });

  /**
   * The general message is kept even when there are field errors.
   * "Fehlende Berechtigung: content.update" belongs to no input, and a form
   * that swallowed it would show a save that silently did nothing.
   */
  it("keeps a message that belongs to no field", () => {
    const err = new ApiError({
      statusCode: 403,
      code: "forbidden",
      message: "Fehlende Berechtigung: content.update",
    });
    expect(reducer.errorsFrom(err)).toEqual({
      errors: {},
      error: "Fehlende Berechtigung: content.update",
    });
  });

  it("survives something that is not an Error at all", () => {
    expect(reducer.errorsFrom("kaputt")).toEqual({ errors: {}, error: "Unbekannter Fehler." });
  });
});

describe("validation short-circuits the submit", () => {
  it("does not call onSubmit when the validator objects", async () => {
    const onSubmit = vi.fn();
    const validate = () => ({ name: ["Pflichtfeld"] });
    const result = await reducer.runSubmit(initial, validate, onSubmit);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ name: ["Pflichtfeld"] });
  });

  it("calls onSubmit when the validator is happy", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const result = await reducer.runSubmit(initial, () => ({}), onSubmit);
    expect(onSubmit).toHaveBeenCalledWith(initial);
    expect(result.ok).toBe(true);
  });

  it("treats a validator returning an empty object as valid", () => {
    expect(reducer.hasErrors({})).toBe(false);
    expect(reducer.hasErrors({ name: ["x"] })).toBe(true);
  });
});
