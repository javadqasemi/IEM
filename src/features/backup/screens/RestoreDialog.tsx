import { useEffect, useId, useState } from "react";
import { Badge, Button, Card, Skeleton } from "@/shared/ui/primitives";
import { Field, Input, Select } from "@/shared/ui/forms";
import { Modal, ReauthenticationDialog } from "@/shared/ui/overlays";
import { useToast } from "@/shared/ui/feedback";
import { authRepository, useAuth } from "@/core/auth";
import { useBackupMutations, useRestorability } from "../hooks/useBackups";
import {
  RESTORE_CONFIRMATION,
  describeCompatibility,
  describeMode,
  describeType,
  refuseSubmit,
} from "../service";
import type { BackupRun, RestoreMode } from "../types";

/**
 * The restore workflow, as a deliberately slow dialog.
 *
 * ---
 *
 * ## Four gates, and the dialog shows all of them
 *
 * `system.restore` and the re-authentication window are the server's; the
 * typed word and the artifact's own fitness are shown here because an operator
 * about to replace a production database should be able to see what the system
 * thinks before they commit, not discover it in an error.
 *
 * The order is deliberate: **mode, then what will happen, then what the
 * artifact is, then the word, then the password.** The password prompt comes
 * last so nobody is typing a credential while still deciding.
 *
 * ## `DRILL` is the default, and that is a safety decision
 *
 * The dangerous mode is never the pre-selected one. An operator who opens this
 * dialog, presses everything and confirms should end up having run a **drill**
 * — which proves the backup is good and changes nothing. Reaching the
 * destructive mode requires a deliberate change of a select.
 */
export function RestoreDialog({
  run,
  onClose,
  onStarted,
}: {
  run: BackupRun | null;
  onClose: () => void;
  onStarted: () => void;
}) {
  const toast = useToast();
  const { user: me } = useAuth();
  const { restore, busy } = useBackupMutations();
  const restorability = useRestorability(run?.id ?? null);
  const [mode, setMode] = useState<RestoreMode>("DRILL");
  const [confirmation, setConfirmation] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const confirmationId = useId();
  const modeId = useId();

  /*
    Reset when the dialog opens on a different backup.

    `set-state-in-effect` is the React Compiler rule this trips, and it is the
    reset-on-open shape `ConfirmDialog` in `shared/ui/overlays` already uses —
    a countable warning rather than a defect. Without it, a typed confirmation
    would survive from one backup to the next, which is precisely the friction
    this dialog exists to impose.
  */
  useEffect(() => {
    setMode("DRILL");
    setConfirmation("");
  }, [run?.id]);

  if (!run) return null;

  const assessment = restorability.data;
  const refusal = assessment
    ? refuseSubmit({
        restorable: assessment.restorable,
        refusal: assessment.refusal,
        confirmation,
      })
    : "Wird geprüft …";

  const target =
    mode === "DRILL" ? assessment?.drillDatabase : assessment?.liveDatabase;

  return (
    <>
      <Modal
        open={run !== null && !authOpen}
        onClose={onClose}
        title="Sicherung einspielen"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
            <Button
              variant={mode === "IN_PLACE" ? "danger" : "primary"}
              disabled={Boolean(refusal)}
              busy={busy === "restore"}
              onClick={() => setAuthOpen(true)}
            >
              {mode === "IN_PLACE" ? "Produktivsystem ersetzen" : "Übung starten"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <Card title="Sicherung">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-0.5">
                <dt className="field-label">Erstellt</dt>
                <dd className="text-ink">{new Date(run.createdAt).toLocaleString("de-CH")}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="field-label">Umfang</dt>
                <dd className="text-ink">{describeType(run.type)}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="field-label">Schema-Stand</dt>
                <dd className="font-mono text-[12px] text-ink">
                  {run.migrationVersion ?? "unbekannt"}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="field-label">Verträglichkeit</dt>
                <dd>
                  {assessment ? (
                    <Badge tone={describeCompatibility(assessment.compatibility).tone}>
                      {describeCompatibility(assessment.compatibility).label}
                    </Badge>
                  ) : (
                    <Skeleton className="h-5 w-24" />
                  )}
                </dd>
              </div>
            </dl>
            {assessment ? (
              <p className="mt-3 text-[13px] leading-relaxed text-muted">
                {assessment.compatibilityReason}
              </p>
            ) : null}
          </Card>

          <Field label="Art der Wiederherstellung" htmlFor={modeId}>
            <Select
              id={modeId}
              value={mode}
              onChange={(e) => setMode(e.target.value as RestoreMode)}
              options={[
                { value: "DRILL", label: "Übung — in eine separate Datenbank" },
                { value: "IN_PLACE", label: "Produktivsystem — ersetzt die laufende Datenbank" },
              ]}
            />
          </Field>

          <div
            className="rounded-lg bg-surface-2 p-3 ring-1 ring-line"
            // Announced: the consequence changes when the select changes, and
            // a reader who cannot see the panel gets no other signal.
            role="status"
          >
            <p className="text-[13px] leading-relaxed text-ink">{describeMode(mode).detail}</p>
            <p className="mt-2 text-[12px] text-muted">
              Zieldatenbank: <code className="font-mono">{target ?? "…"}</code>
            </p>
          </div>

          {mode === "IN_PLACE" ? (
            /*
              The consequence, spelled out rather than implied by a red button.
              An operator who reads only one thing in this dialog should read
              this one.
            */
            <p className="rounded-lg bg-surface-2 p-3 text-[13px] leading-relaxed text-ink ring-1 ring-brand-bronze/40">
              <strong>Dieser Vorgang ersetzt die Produktivdaten.</strong> Alles, was seit dieser
              Sicherung geschehen ist, geht verloren. Vor dem Überschreiben wird automatisch eine
              Sicherung des aktuellen Standes erstellt — schlägt sie fehl, wird abgebrochen und
              nichts verändert. Während der Wiederherstellung nimmt das System keine Änderungen an.
            </p>
          ) : null}

          <Field
            label={`Zum Bestätigen „${RESTORE_CONFIRMATION}“ eingeben`}
            htmlFor={confirmationId}
            hint="Ausgeschrieben, in Grossbuchstaben."
          >
            <Input
              id={confirmationId}
              value={confirmation}
              onChange={(e) => setConfirmation(e.currentTarget.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          {refusal ? (
            <p className="text-[13px] leading-relaxed text-muted" role="status">
              {refusal}
            </p>
          ) : null}
        </div>
      </Modal>

      {/*
        The last gate, and the same component MFA disable uses.

        A second re-authentication implementation would be a second window, a
        second TTL and a second set of mistakes — `ReauthService` was written
        to have exactly one caller shape and this is its third.
      */}
      <ReauthenticationDialog
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        authenticate={authRepository.reauthenticate}
        /*
          The operator's own factor. Without it an administrator with MFA was
          shown a password field, sent no code, and was refused by the server
          with nothing on screen to supply — the restore was unusable for
          exactly the accounts most likely to hold `system.restore`. The same
          trap `UserMfaPanel` documents and avoids.
        */
        requiresCode={Boolean(me?.mfaEnabled)}
        description="Vor einer Wiederherstellung bestätigen Sie Ihre Identität erneut."
        title="Wiederherstellung bestätigen"
        confirmLabel="Wiederherstellen"
        message={
          mode === "IN_PLACE"
            ? "Sie sind dabei, die Produktivdatenbank zu ersetzen. Bitte bestätigen Sie Ihre Identität."
            : "Bitte bestätigen Sie Ihre Identität, um die Übung zu starten."
        }
        onConfirmed={async (reauthToken) => {
          try {
            await restore(run.id, { mode, confirmation, reauthToken });
            toast.success(
              mode === "IN_PLACE" ? "Wiederherstellung gestartet" : "Übung gestartet",
              "Der Fortschritt steht im Protokoll unten.",
            );
            setAuthOpen(false);
            onStarted();
            onClose();
          } catch (err) {
            toast.error("Wiederherstellung abgelehnt", (err as Error).message);
            setAuthOpen(false);
          }
        }}
      />
    </>
  );
}
