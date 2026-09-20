import { useCallback, useMemo, useState } from "react";
import { ApiError } from "@/core/api";
import type { FieldErrors } from "./types";

/**
 * Form state (weakness W9, foundation stage F5).
 *
 * `FieldRenderer` renders fields; nothing owned the *state* around them, so
 * every screen wrote its own — a `values` object, a `dirty` boolean, a
 * `useMutation`, and a hand-rolled mapping from the server's per-field errors.
 * Four screens, four slightly different versions, and the differences are
 * where the bugs are.
 *
 * Three decisions worth stating, because they are what makes this more than a
 * `useState` wrapper:
 *
 * **`dirty` is computed, not flagged.** `ContentEditor` sets `setDirty(true)`
 * on every change, so typing a character and deleting it leaves a form that
 * believes it has unsaved work — and with an unsaved-changes guard attached,
 * that is a dialog in the reader's way for no reason. Here it is a comparison
 * against the initial snapshot, so undoing an edit is clean again.
 *
 * **A server error is attached to its field and cleared by editing it.** The
 * server answers `{ fields: { email: ["…"] } }` and that is the whole point of
 * the envelope's error shape. An error that survives the correction is worse
 * than no error: it tells the reader they are still wrong when they are not.
 *
 * **Submitting is not a boolean the caller manages.** `submit()` runs the
 * validator, calls `onSubmit`, and on an `ApiError` puts its field messages in
 * place — one path, so a screen cannot forget the mapping.
 */

export type FormState<T extends object> = {
  values: T;
  /** Per-field messages, from the validator or from the server. */
  errors: FieldErrors;
  /** A message that belongs to no field — a 403, a conflict. */
  error: string | null;
  dirty: boolean;
  submitting: boolean;
  /** Set one field. Clears that field's error. */
  set: <K extends keyof T>(name: K, value: T[K]) => void;
  /** Set several at once — a `FieldRenderer` hands back a whole object. */
  patch: (next: Partial<T>) => void;
  /** Replaces everything, and makes *this* the new clean state. */
  reset: (next?: T) => void;
  submit: () => Promise<boolean>;
  /** First message for a field, which is what `Field` renders. */
  fieldError: (name: keyof T & string) => string | undefined;
};

export type UseFormOptions<T extends object> = {
  initial: T;
  /** Pure, synchronous, and returns only the fields it has something to say about. */
  validate?: (values: T) => FieldErrors;
  onSubmit: (values: T) => Promise<unknown>;
};

/**
 * Deep-ish equality for the dirty check.
 *
 * `JSON.stringify` on both sides, with the keys sorted — a content entry's
 * draft is an arbitrary JSON object, and two objects with the same contents in
 * a different key order are not a change. This is the same canonicalisation
 * `snapshot.builder.ts` performs before comparing documents, and for the same
 * reason: without it almost everything compares as changed.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const record = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]]));
    }
    return v;
  });
}

/**
 * The four decisions above, as pure functions.
 *
 * Extracted rather than inlined so they can be tested without a renderer — the
 * same argument `service.ts` makes in a feature folder, applied to a hook:
 * everything that can be *wrong* here is a rule, and a rule reachable only
 * through `useState` is a rule nobody tests. The hook below is the React
 * wiring around them and holds no logic of its own.
 */
const rules = {
  isDirty: (baseline: unknown, values: unknown) => canonical(baseline) !== canonical(values),

  /** Returns the same object when nothing changed, so React skips the render. */
  clearErrors: (errors: FieldErrors, names: string[]): FieldErrors => {
    if (!names.some((name) => name in errors)) return errors;
    const next = { ...errors };
    for (const name of names) delete next[name];
    return next;
  },

  errorsFrom: (err: unknown): { errors: FieldErrors; error: string } => {
    if (err instanceof ApiError) {
      return { errors: err.fields ?? {}, error: err.message };
    }
    return { errors: {}, error: err instanceof Error ? err.message : "Unbekannter Fehler." };
  },

  hasErrors: (errors: FieldErrors) => Object.keys(errors).length > 0,

  async runSubmit<T extends object>(
    values: T,
    validate: ((values: T) => FieldErrors) | undefined,
    onSubmit: (values: T) => Promise<unknown>,
  ): Promise<{ ok: boolean; errors: FieldErrors; error: string | null }> {
    const found = validate?.(values) ?? {};
    if (rules.hasErrors(found)) return { ok: false, errors: found, error: null };
    try {
      await onSubmit(values);
      return { ok: true, errors: {}, error: null };
    } catch (err) {
      return { ok: false, ...rules.errorsFrom(err) };
    }
  },
};

/** The pure core, for `useForm.test.ts`. Not part of the component API. */
export const formReducerForTest = rules;

export function useForm<T extends object>({
  initial,
  validate,
  onSubmit,
}: UseFormOptions<T>): FormState<T> {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * The clean state — **state, not a ref**, and that distinction was a bug.
   *
   * A ref is the obvious choice: changing the baseline must not re-render, and
   * it is only ever read during a comparison. But `dirty` is a `useMemo` over
   * `[values]`, and a ref is invisible to a dependency array — so moving the
   * baseline on a successful save did not recompute it. The memo went on
   * returning `true` until the *next* keystroke.
   *
   * For a form in a dialog that closes on save, nothing shows: the component
   * unmounts before anyone reads `dirty` again. For a form that **stays open**
   * — a settings section, which is the first of those in this codebase — the
   * save bar kept saying "Ungespeicherte Änderungen" over a record that had
   * just been written, the unsaved-changes guard fired on the way out of a
   * screen with nothing outstanding, and a re-seed gated on `!dirty` never
   * ran. The comment on `submit` below already claimed this worked.
   *
   * As state it costs one extra render per save, which is the correct price.
   */
  const [baseline, setBaseline] = useState(() => canonical(initial));

  const dirty = useMemo(() => canonical(values) !== baseline, [values, baseline]);

  const set = useCallback(<K extends keyof T>(name: K, value: T[K]) => {
    setValues((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => rules.clearErrors(previous, [name as string]));
  }, []);

  const patch = useCallback((next: Partial<T>) => {
    setValues((previous) => ({ ...previous, ...next }));
    setErrors((previous) => rules.clearErrors(previous, Object.keys(next)));
  }, []);

  const reset = useCallback(
    (next?: T) => {
      const seed = next ?? initial;
      setBaseline(canonical(seed));
      setValues(seed);
      setErrors({});
      setError(null);
    },
    [initial],
  );

  const submit = useCallback(async (): Promise<boolean> => {
    setSubmitting(true);
    const result = await rules.runSubmit(values, validate, onSubmit);
    setErrors(result.errors);
    setError(result.error);
    if (result.ok) {
      // The saved values are the new clean state. Without this a form stays
      // "dirty" after a successful save and the unsaved-changes guard fires on
      // the way out of a screen that has nothing outstanding — which is what
      // happened anyway while the baseline was a ref, because `dirty` is a
      // memo and a ref is invisible to a dependency array. See the note on
      // `baseline`.
      setBaseline(canonical(values));
    }
    setSubmitting(false);
    return result.ok;
  }, [onSubmit, validate, values]);

  const fieldError = useCallback((name: keyof T & string) => errors[name]?.[0], [errors]);

  return { values, errors, error, dirty, submitting, set, patch, reset, submit, fieldError };
}
