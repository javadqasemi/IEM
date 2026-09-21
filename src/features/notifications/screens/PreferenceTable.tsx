import { Badge } from "@/shared/ui/primitives";
import { Toggle } from "@/shared/ui/forms";
import { cn } from "@/shared/utils/cn";
import { groupPreferences, lockReason, severityLabel, severityTone } from "../service";
import type { PreferenceRow } from "../types";

/**
 * The settings grid, shared by the person's screen and the firm's.
 *
 * ---
 *
 * **One component for both**, because they differ in exactly one column —
 * `enabled`, which only the firm has — and two near-identical grids would be
 * two places to add the next channel. `showEnabled` is the whole difference.
 *
 * **Grouped by category with labels, never a list of event keys.** The brief
 * is explicit and it is the right call: ten rows of
 * `content.submitted_for_review` with two checkboxes each is a screen an
 * administrator cannot reason about, and the internal name is not a thing a
 * reader should have to learn in order to decide whether they want an e-mail.
 * What is on screen is a sentence and two switches.
 *
 * **A disabled switch always says why.** `lockReason` returns a sentence
 * rather than a boolean, because a control that is greyed out with no
 * explanation is one people assume is broken — and there are three genuinely
 * different reasons here, two of which the reader can act on.
 *
 * **Severity is a word beside a tone**, never a tone alone. Colour is not an
 * accessible signal, and "Kritisch" is unambiguous where a bronze dot is not.
 */
export function PreferenceTable({
  rows,
  edits,
  onChange,
  showEnabled = false,
  disabled = false,
}: {
  rows: PreferenceRow[];
  /** Pending changes, keyed by type. The row shows these over its own values. */
  edits: Record<string, Partial<PreferenceRow>>;
  onChange: (type: string, patch: Partial<PreferenceRow>) => void;
  /** The firm's screen adds the on/off column. */
  showEnabled?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-7">
      {groupPreferences(rows).map((group) => (
        <section key={group.category} className="flex flex-col gap-1">
          <h3 className="field-label">{group.category}</h3>

          <ul className="flex flex-col divide-y divide-line rounded-md ring-1 ring-line">
            {group.rows.map((base) => {
              const row = { ...base, ...edits[base.type] };
              /*
                The firm's switch bounds the two below it, so a type that is
                off has its channels drawn off and inert. That mirrors
                `resolveChannels` exactly — the screen is showing the same
                resolution the server will perform, rather than a guess at
                it.
              */
              const off = showEnabled && row.enabled === false;

              return (
                <li key={row.type} className="flex flex-col gap-3 px-4 py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("text-[14px] font-medium leading-tight text-ink", off && "text-muted")}>
                          {row.label}
                        </span>
                        <Badge tone={severityTone(row.severity)}>
                          {severityLabel(row.severity)}
                        </Badge>
                        {row.mandatory ? (
                          /*
                            Said out loud rather than only implied by a
                            disabled switch. Somebody scanning for what they
                            can turn off should be able to see immediately
                            which four they cannot, and why.
                          */
                          <Badge tone="navy">Immer aktiv</Badge>
                        ) : null}
                      </div>
                      <p className="text-[12px] leading-snug text-muted">{row.description}</p>
                      {row.recipients ? (
                        <p className="text-[12px] leading-snug text-muted">
                          Empfänger: {row.recipients}
                        </p>
                      ) : null}
                    </div>

                    {showEnabled ? (
                      <div className="w-full shrink-0 sm:w-56">
                        <Toggle
                          label="Aktiv"
                          hint={
                            row.mandatory
                              ? "Sicherheitsmeldung — nicht abschaltbar."
                              : "Aus: niemand wird benachrichtigt."
                          }
                          checked={row.enabled ?? true}
                          disabled={disabled || row.mandatory}
                          onChange={(next) => onChange(row.type, { enabled: next })}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Channel
                      label="Im Dashboard"
                      checked={row.inApp}
                      reason={lockReason(row, "inApp")}
                      disabled={disabled || off || Boolean(lockReason(row, "inApp"))}
                      onChange={(next) => onChange(row.type, { inApp: next })}
                    />
                    <Channel
                      label="Per E-Mail"
                      checked={row.email}
                      reason={lockReason(row, "email")}
                      disabled={disabled || off || Boolean(lockReason(row, "email"))}
                      onChange={(next) => onChange(row.type, { email: next })}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Channel({
  label,
  checked,
  reason,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  reason: string | null;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2.5">
      <Toggle
        label={label}
        // The reason travels as the hint, so it is beside the control rather
        // than in a tooltip nobody on a keyboard can reach.
        hint={reason ?? undefined}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}
