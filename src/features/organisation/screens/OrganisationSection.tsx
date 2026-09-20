import { useEffect, useId, useMemo, useState } from "react";
import { Badge, Card } from "@/shared/ui/primitives";
import { Field, Form, Input, SaveBar, Select, Textarea, useForm } from "@/shared/ui/forms";
import { useToast } from "@/shared/ui/feedback";
import { useUnsavedGuard } from "@/shared/hooks";
import { ConfirmDialog } from "@/shared/ui/overlays";
import type { Organisation } from "@/entities/organisation";
import { useSaveOrganisation } from "../hooks/useOrganisation";
import { validateOrganisation, type SettingsSection } from "../service";
import { ORGANISATION_FIELDS, fieldValue, parseFieldValue } from "./fields";

/**
 * One subset of the organisation record, as a form.
 *
 * Four of the workspace's sections render through this component — General,
 * Legal, Contact and Website defaults — because they differ only in **which
 * fields** they show. A component per section would be four copies of the same
 * dirty tracking, the same optimistic lock, the same guard and the same save
 * bar, and the differences between four copies are where the bugs are.
 *
 * Three things it owns that the old settings page had none of:
 *
 * - **An unsaved-changes guard.** Navigating away from a dirty form lost the
 *   work silently. `useUnsavedGuard` covers the hash change too, which is how
 *   every navigation in this dashboard happens.
 * - **The optimistic lock.** `expectedVersion` rides on every save and a 409
 *   offers a reload rather than a "save anyway" — a button that resubmitted
 *   with the new version would be a two-click way to do the overwrite the lock
 *   exists to prevent, and it would look like the safe option.
 * - **Field-level errors from the server.** `useForm` maps `{ fields: … }`
 *   onto the inputs and clears each one when it is edited.
 */
export function OrganisationSection({
  section,
  record,
  canEdit,
  canEditLegal,
}: {
  section: SettingsSection;
  record: Organisation;
  canEdit: boolean;
  /** The server's answer, sent with the record — never inferred here. */
  canEditLegal: boolean;
}) {
  const toast = useToast();
  const save = useSaveOrganisation();
  const idPrefix = useId();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const legal = section.slug === "rechtliches";
  const writable = canEdit && (!legal || canEditLegal);

  const form = useForm<Organisation>({
    initial: record,
    validate: validateOrganisation,
    onSubmit: async (values) => {
      const result = await save(record, values);
      setWarnings(result.warnings);
      setSavedAt(Date.now());
      toast.success("Gespeichert", "Die Unternehmensangaben wurden übernommen.");
      return result;
    },
  });

  /*
    Re-seed when the record arrives or changes underneath.

    The query resolves after the first render and another section's save
    invalidates the whole prefix, so `record` genuinely changes while this form
    is mounted. Re-seeding a *dirty* form would throw away what the reader is
    typing, so it is gated on the version moving and on there being nothing
    outstanding — which is also exactly the case the optimistic lock would
    otherwise turn into a 409 the reader could not explain.
  */
  const { reset, dirty } = form;
  useEffect(() => {
    if (!dirty) reset(record);
    // `record.version` rather than `record`: the object identity changes on
    // every refetch, and re-seeding on that would fight the reader's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.version]);

  const guard = useUnsavedGuard(form.dirty);

  /*
    The field list is read inside the memo rather than beside it: pulled out
    as a `const`, the `: []` branch is a fresh array on every render and the
    memo would recompute every time. `section` is stable for as long as the
    URL is.
  */
  const rows = useMemo(
    () =>
      section.source.kind === "organisation"
        ? section.source.fields.map((name) => ({
            name: name as string,
            def: ORGANISATION_FIELDS[name as string],
          }))
        : [],
    [section],
  );

  return (
    <>
      <Form onSubmit={form.submit} error={form.error}>
        <Card title={section.title} description={section.description}>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {rows.map(({ name, def }) => {
              if (!def) return null;
              const id = `${idPrefix}-${name}`;
              const error = form.fieldError(name as keyof Organisation & string);
              const value = fieldValue(form.values, name);
              const set = (raw: string) =>
                form.patch({ [name]: parseFieldValue(name, raw) } as Partial<Organisation>);

              return (
                <Field
                  key={name}
                  label={def.label}
                  htmlFor={id}
                  hint={def.hint}
                  error={error}
                  className={def.full || def.type === "textarea" ? "sm:col-span-2" : undefined}
                >
                  {def.type === "textarea" ? (
                    <Textarea
                      id={id}
                      value={value}
                      invalid={Boolean(error)}
                      disabled={!writable}
                      onChange={(e) => set(e.target.value)}
                    />
                  ) : def.type === "select" ? (
                    <Select
                      id={id}
                      value={value}
                      options={def.options ?? []}
                      invalid={Boolean(error)}
                      disabled={!writable}
                      onChange={(e) => set(e.target.value)}
                    />
                  ) : (
                    <Input
                      id={id}
                      type={def.type === "number" ? "number" : def.type === "email" ? "email" : def.type === "url" ? "url" : def.type === "tel" ? "tel" : "text"}
                      value={value}
                      invalid={Boolean(error)}
                      disabled={!writable}
                      autoComplete={def.autoComplete}
                      onChange={(e) => set(e.target.value)}
                    />
                  )}
                </Field>
              );
            })}
          </div>

          {/*
            The reason a field is disabled, stated once at the foot rather than
            on each of seventeen fields.

            A read-only form with no explanation reads as a bug. `canEditLegal`
            comes from the server with the record, so this is the same answer
            the save would have given — arrived at before the reader typed
            rather than after.
          */}
          {legal && canEdit && !canEditLegal ? (
            <p className="mt-5 text-[13px] leading-relaxed text-muted">
              <Badge tone="neutral">Nur lesend</Badge>{" "}
              Rechtliche Angaben ändern UID, Handelsregister, MWST und Sitz — das braucht die
              Berechtigung „Rechtliche Angaben ändern“, die bei der Geschäftsleitung liegt.
            </p>
          ) : null}
          {!canEdit ? (
            <p className="mt-5 text-[13px] leading-relaxed text-muted">
              <Badge tone="neutral">Nur lesend</Badge> Zum Bearbeiten fehlt die Berechtigung
              „Unternehmensangaben ändern“.
            </p>
          ) : null}

          {/*
            Warnings beside the saved record, not instead of it.

            A UID and an MWST number that are different numbers is worth saying
            and must not block the save — the day a firm genuinely has one and
            not the other, refusing would make the correct data impossible to
            enter. Same shape as the Planversand's prior-issue warnings.
          */}
          {warnings.length ? (
            <ul className="mt-5 flex flex-col gap-1.5 rounded-md bg-disc-power/[0.08] px-4 py-3 text-[13px] leading-snug text-ink ring-1 ring-disc-power/25">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </Card>

        {/*
          No `onSave`: the bar's button is the enclosing `<Form>`'s submit, so
          there is one submission path and Enter reaches it. Two would be two
          `PATCH`es from one click, and the second would 409 against the
          first — see the note on `SaveBar`.
        */}
        {writable ? (
          <SaveBar
            dirty={form.dirty}
            saving={form.submitting}
            savedAt={savedAt}
            onReset={() => form.reset(record)}
          />
        ) : null}
      </Form>

      <ConfirmDialog
        open={guard.blocked !== null}
        onClose={guard.stay}
        onConfirm={guard.leave}
        title="Änderungen verwerfen?"
        /*
          "Verwerfen und verlassen", not "Verwerfen".

          The save bar's reset button is also labelled "Verwerfen" and both can
          be on screen at once — they discard the same edits and differ in
          where the reader ends up afterwards, which is exactly the difference
          a one-word label hides. Found by a test that could not tell them
          apart either.
        */
        confirmLabel="Verwerfen und verlassen"
        destructive
        message="Auf dieser Seite gibt es ungespeicherte Änderungen. Beim Verlassen gehen sie verloren."
      />
    </>
  );
}
