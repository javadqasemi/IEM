import type { ReactNode } from "react";
import { Button } from "@/shared/ui/primitives";
import { Form, FormActions } from "./Form";
import { FieldRenderer } from "./FieldRenderer";
import type { FieldDef } from "./types";
import type { FormState } from "./useForm";

/**
 * A whole form from a field list and a `useForm`.
 *
 * `FieldRenderer` + `useForm` + `<Form>`, wired the one correct way. The CMS's
 * editor proves the mechanism works over an arbitrary schema; the enterprise
 * modules will hand it a field list built from an entity definition rather than
 * from a content type, which is why this takes `FieldDef[]` and knows nothing
 * about where they came from.
 *
 * What a caller still owns: the field list, the submit, and any control that is
 * not a field — a status badge, a version history, a second button. Those go in
 * `children` and `actions` rather than being options here, because the moment
 * this component starts taking `showVersionButton` it has become the thing it
 * replaced.
 */
export function EntityForm<T extends Record<string, unknown>>({
  fields,
  form,
  submitLabel = "Speichern",
  cancelLabel,
  onCancel,
  disabled,
  tokenHelp,
  imagePicker,
  children,
  actions,
}: {
  fields: FieldDef[];
  form: FormState<T>;
  submitLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  /** No permission to write. The fields render read-only rather than vanishing. */
  disabled?: boolean;
  tokenHelp?: { token: string; meaning: string }[];
  /** Opens the media library. Absent means image fields fall back to a path box. */
  imagePicker?: (onPick: (url: string) => void) => void;
  /** Anything that is not a field — rendered above the actions. */
  children?: ReactNode;
  /** Extra buttons, rendered before the submit. */
  actions?: ReactNode;
}) {
  return (
    <Form onSubmit={() => void form.submit()} error={form.error}>
      <FieldRenderer
        fields={fields}
        value={form.values}
        onChange={(next) => form.patch(next as Partial<T>)}
        errors={form.errors}
        tokenHelp={tokenHelp}
        imagePicker={imagePicker}
        disabled={disabled}
      />

      {children}

      <FormActions>
        {actions}
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={form.submitting}>
            {cancelLabel ?? "Abbrechen"}
          </Button>
        ) : null}
        {/*
          `type="submit"`, which is the whole reason `<Form>` is a real form:
          without it Enter in a text field does nothing, and every reader who
          expects it to save learns not to trust the keyboard.
        */}
        <Button
          type="submit"
          variant="primary"
          busy={form.submitting}
          disabled={disabled || !form.dirty}
        >
          {submitLabel}
        </Button>
      </FormActions>
    </Form>
  );
}
