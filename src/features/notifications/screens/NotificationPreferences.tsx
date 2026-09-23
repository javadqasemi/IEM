import { useState } from "react";
import { toFailure } from "@/core/api";
import { Button, Card, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { useToast } from "@/shared/ui/feedback";
import { usePreferenceMutations, usePreferences } from "../hooks/useNotifications";
import { changedRows } from "../service";
import { PreferenceTable } from "./PreferenceTable";
import type { PreferenceRow } from "../types";

/**
 * What *this person* wants to be told about, and how.
 *
 * ---
 *
 * **Personal, and nothing else.** Which events exist and who is eligible for
 * them is the firm's decision and lives in Einstellungen; this screen only
 * chooses among the notifications the reader is already eligible for. The
 * brief insists the two are not merged and this is the half that stays with
 * the person — reachable from the notification centre, because that is where
 * somebody goes when they want fewer of these.
 *
 * **Four rows cannot be switched off in the dashboard**, and the screen says
 * so on each of them rather than silently ignoring the click. `resolveChannels`
 * would force the in-app copy back on regardless — the invariant is applied
 * on read — so accepting the change would store a preference that does
 * nothing and show the switch back on after a reload with no explanation.
 * The *e-mail* copy of those four is still the reader's to turn off, which is
 * the part that keeps the rule from being the reason somebody filters the
 * sender.
 *
 * **Save is explicit.** Toggling ten switches and having each one fire a
 * `PUT` is ten requests and ten chances to half-apply; it also makes "undo"
 * mean nothing. One save, and only what moved is sent — see `changedRows`.
 */
export function NotificationPreferences() {
  const toast = useToast();
  const rows = usePreferences();
  const { savePreferences } = usePreferenceMutations();

  const [edits, setEdits] = useState<Record<string, Partial<PreferenceRow>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rows.error) return <ErrorState message={rows.error} onRetry={rows.refetch} />;
  if (!rows.data) return <Skeleton className="h-96 rounded-lg" />;

  const changed = changedRows(rows.data, edits);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await savePreferences(
        changed.map((row) => ({ type: row.type, inApp: row.inApp, email: row.email })),
      );
      // Cleared only on success: a failed save must leave the reader's
      // choices on screen, or they have to remember what they had picked.
      setEdits({});
      toast.success("Gespeichert", "Ihre Benachrichtigungseinstellungen sind aktiv.");
    } catch (err) {
      setError(toFailure(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Wie möchten Sie benachrichtigt werden?"
      description="Gilt nur für Sie. Welche Ereignisse überhaupt benachrichtigen, legt die Organisation unter Einstellungen fest."
      action={
        <div className="flex gap-2">
          {changed.length ? (
            <Button variant="ghost" disabled={busy} onClick={() => setEdits({})}>
              Verwerfen
            </Button>
          ) : null}
          <Button
            variant="primary"
            busy={busy}
            disabled={!changed.length}
            onClick={() => void save()}
          >
            {changed.length ? `Speichern (${changed.length})` : "Gespeichert"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {error ? (
          <p
            role="alert"
            className="rounded-md bg-brand-bronze/[0.08] px-4 py-3 text-[13px] font-medium leading-relaxed text-brand-bronze ring-1 ring-brand-bronze/25"
          >
            {error}
          </p>
        ) : null}

        <PreferenceTable
          rows={rows.data}
          edits={edits}
          disabled={busy}
          onChange={(type, patch) =>
            setEdits((current) => ({ ...current, [type]: { ...current[type], ...patch } }))
          }
        />
      </div>
    </Card>
  );
}
