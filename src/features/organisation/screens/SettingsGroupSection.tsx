import { useId, useMemo, useState } from "react";
import { toFailure } from "@/core/api";
import { Badge, Card } from "@/shared/ui/primitives";
import { Field, Form, Input, ListInput, SaveBar, Select, Textarea, Toggle } from "@/shared/ui/forms";
import { ConfirmDialog } from "@/shared/ui/overlays";
import { useToast } from "@/shared/ui/feedback";
import { useUnsavedGuard } from "@/shared/hooks";
import type { Setting, SettingGroup } from "@/entities/organisation";
import { useSaveSettings } from "../hooks/useOrganisation";
import { dangerousEdits, pendingSettingUpdates, settingsFor, type SettingsSection } from "../service";

/** One empty list, so an unset `stringList` does not hand `ListInput` a new array each render. */
const NO_ITEMS: readonly string[] = [];

/**
 * A group of key/value settings, rendered from the server's declarations.
 *
 * **The control comes from `setting.type`, not from the stored value.** The
 * old screen inferred it — a boolean got a toggle because the value happened
 * to be a boolean — so a setting could not render correctly until it already
 * held the right kind of value, and an operator who had stored a string in a
 * numeric setting was shown a text box confirming their mistake. Now the
 * declaration decides, which is also what validates the write.
 *
 * Two behaviours that were absent and cost real damage:
 *
 * - **A dangerous change is confirmed, with its consequence named.** The
 *   switch that lifts the four-eyes principle took one click and said nothing.
 *   Which settings are dangerous is the **server's** list, travelling on each
 *   row, so the screen cannot drift from it.
 * - **Nothing is saved that has not changed.** `pendingSettingUpdates` diffs
 *   against the stored value, so opening a section and leaving writes no audit
 *   row claiming a change.
 */
export function SettingsGroupSection({
  section,
  groups,
  canEdit,
  canSeeSecrets,
}: {
  section: SettingsSection;
  groups: SettingGroup[];
  canEdit: boolean;
  canSeeSecrets: boolean;
}) {
  const toast = useToast();
  const saveSettings = useSaveSettings();
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  /*
    `section` in the dependency list, not the group names.

    `section.source.groups` is a fresh array literal on every render when
    read out here, so depending on it would recompute the memo every time and
    make it a more expensive way of writing nothing. The section object is
    stable for as long as the URL is.
  */
  const settings = useMemo(
    () => (section.source.kind === "settings" ? settingsFor(groups, section.source.groups) : []),
    [groups, section],
  );

  /*
    The edits map is **not** cleared when `groups` refreshes.

    The obvious effect — "another section saved, drop our untouched edits" —
    turned out to guard nothing: `pendingSettingUpdates` already compares
    every edit against the stored value, so an entry that matches is invisible
    to `dirty`, to the save and to the confirmation. Clearing it would only
    have removed a map nobody could see, at the cost of a setState inside an
    effect firing on every refetch.
  */
  const updates = useMemo(() => pendingSettingUpdates(settings, edits), [settings, edits]);
  const dirty = updates.length > 0;
  const dangerous = useMemo(() => dangerousEdits(settings, edits), [settings, edits]);

  const guard = useUnsavedGuard(dirty);

  async function commit() {
    setConfirming(false);
    setSaving(true);
    setError(null);
    try {
      await saveSettings(updates);
      setEdits({});
      setSavedAt(Date.now());
      toast.success("Gespeichert", `${updates.length} Einstellung(en) übernommen.`);
    } catch (err) {
      setError(toFailure(err).message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * A real `<form>`, even though these are key/value rows rather than a
   * record.
   *
   * It is what makes Enter save — `SaveBar`'s button is the form's submit and
   * carries no click handler, so without a form around it the keyboard has no
   * way to reach the action at all. It also routes the dangerous-change
   * confirmation through one place: submitting either opens the dialog or
   * commits, and there is no second path that could skip the first.
   */
  return (
    <Form onSubmit={() => (dangerous.length ? setConfirming(true) : void commit())} error={error}>
      <Card title={section.title} description={section.description}>
        {settings.length === 0 ? (
          <p className="text-[13px] text-muted">Keine Einstellungen in diesem Bereich.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {settings.map((setting) => (
              <SettingControl
                key={setting.key}
                setting={setting}
                value={setting.key in edits ? edits[setting.key] : setting.value}
                disabled={
                  !canEdit || (setting.secret && !canSeeSecrets) || setting.lockedBecause !== null
                }
                onChange={(next) => setEdits((current) => ({ ...current, [setting.key]: next }))}
              />
            ))}
          </div>
        )}
      </Card>

      {/*
        The mail test card stood here and is **gone** (P2-4).

        It was one button that sent a real message to the caller's own address
        and reported the provider's raw error. Email Operations replaced it
        with two distinct operations — a connection test that sends nothing and
        a test send that takes a recipient — both reporting a sanitized
        classification, and both in `features/mail`, which also owns the status
        verdict and the template catalogue they belong beside.

        The section now declares `panel: true`, so the workspace renders that
        panel underneath this form. Leaving this card as well would put two
        "Testnachricht senden" buttons on one screen, doing different things.
      */}

      {canEdit ? (
        <SaveBar
          dirty={dirty}
          saving={saving}
          savedAt={savedAt}
          onReset={() => setEdits({})}
        >
          {dangerous.length ? (
            <Badge tone="gold">{dangerous.length} mit Rückfrage</Badge>
          ) : null}
        </SaveBar>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void commit()}
        busy={saving}
        title="Diese Änderung schwächt eine Kontrolle"
        confirmLabel="Trotzdem speichern"
        destructive
        message={
          <div className="flex flex-col gap-3">
            {dangerous.map((item) => (
              <div key={item.key}>
                <p className="font-medium text-ink">{item.label}</p>
                <p className="mt-0.5">{item.warning}</p>
              </div>
            ))}
          </div>
        }
      />

      <ConfirmDialog
        open={guard.blocked !== null}
        onClose={guard.stay}
        onConfirm={guard.leave}
        title="Änderungen verwerfen?"
        // As in `OrganisationSection`: the save bar's reset says "Verwerfen"
        // too, and both can be on screen at once.
        confirmLabel="Verwerfen und verlassen"
        destructive
        message="Auf dieser Seite gibt es ungespeicherte Änderungen. Beim Verlassen gehen sie verloren."
      />
    </Form>
  );
}

/**
 * One setting, drawn from its declaration.
 *
 * `pending` is a **badge at full contrast**, never a dimmed block. `opacity-60`
 * on the wrapper was the first attempt and an axe pass measured what it did:
 * it multiplies through to the text inside, dropping the hint from `muted` to
 * 2.54:1 in the light theme. The information — "nothing reads this yet" — was
 * being carried by the one property that also makes it hard to read.
 */
function SettingControl({
  setting,
  value,
  onChange,
  disabled,
}: {
  setting: Setting;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
}) {
  const id = useId();

  const hint = [
    setting.key,
    // Visible text, not a tooltip: a disabled control's title never shows.
    setting.lockedBecause,
    setting.pending ? "wird gespeichert, aber noch von nichts gelesen" : null,
    setting.secret ? (setting.hasValue ? "gesetzt" : "nicht gesetzt") : null,
    setting.blankMeans ? `leer lassen: ${setting.blankMeans}` : null,
    setting.min !== undefined && setting.max !== undefined
      ? `${setting.min} bis ${setting.max}${setting.unit ? ` ${setting.unit}` : ""}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const marks = (
    <span className="flex gap-1.5">
      {setting.pending ? <Badge tone="neutral">noch nicht angebunden</Badge> : null}
      {setting.dangerous ? <Badge tone="gold">mit Rückfrage</Badge> : null}
    </span>
  );

  if (setting.type === "boolean") {
    return (
      <div className="flex flex-col gap-1.5">
        {setting.pending || setting.dangerous ? marks : null}
        <Toggle
          label={setting.label}
          hint={hint}
          checked={Boolean(value)}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    );
  }

  return (
    <Field label={setting.label} htmlFor={id} hint={hint} action={marks}>
      {setting.type === "text" ? (
        <Textarea
          id={id}
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : setting.type === "select" ? (
        <Select
          id={id}
          disabled={disabled}
          value={String(value ?? "")}
          options={setting.options ?? []}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : setting.type === "stringList" ? (
        <ListInput
          id={id}
          disabled={disabled}
          value={Array.isArray(value) ? (value as string[]) : NO_ITEMS}
          onChange={(next) => onChange(next)}
        />
      ) : setting.type === "number" ? (
        <Input
          id={id}
          type="number"
          min={setting.min}
          max={setting.max}
          disabled={disabled}
          value={value === null || value === undefined ? "" : String(value)}
          /*
            An empty numeric input stays empty rather than becoming `0`.

            `0` is a *value* — and for `applications.retentionDays` it was the
            value that deleted every dossier received that day. The server now
            refuses it, and the control no longer invents it: a blank field
            fails validation on the way out instead of silently meaning zero.
          */
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      ) : (
        <Input
          id={id}
          type={setting.secret ? "password" : setting.type === "email" ? "email" : setting.type === "url" ? "url" : "text"}
          disabled={disabled}
          value={String(value ?? "")}
          autoComplete={setting.secret ? "new-password" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

