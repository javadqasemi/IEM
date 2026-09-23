import { useState } from "react";
import { toFailure } from "@/core/api";
import { Button, Card, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { ConfirmDialog } from "@/shared/ui/overlays";
import { useToast } from "@/shared/ui/feedback";
import { useCan } from "@/core/auth";
import { useMailStatus, useRemoveSecret } from "../hooks/useMail";
import { MailStatusCard } from "./MailStatusCard";
import { MailDiagnostics } from "./MailDiagnostics";
import { MailTemplates } from "./MailTemplates";

/**
 * The E-Mail section of the settings workspace.
 *
 * ---
 *
 * ## What is here and what is not
 *
 * Status, diagnostics, credential management and templates. The **delivery
 * log is not here**, and that is the brief's own instruction followed rather
 * than worked around: `NotificationDelivery` is the notification platform's
 * table and `features/notifications` already renders it as the
 * Zustellprotokoll, with a status filter and the argument for why `SKIPPED` is
 * neutral. A second table over the same rows would be the "second
 * email-delivery-history system" the brief names.
 *
 * `src/architecture.test.ts` would also have refused it — a feature may not
 * import another feature — which is the rule doing its job rather than getting
 * in the way. What this section shows instead is the **summary** the server
 * computes, and it says where the full protocol lives.
 *
 * ## The configuration form is above this, not in it
 *
 * The section declares `{ kind: "settings", groups: ["E-Mail"], panel: true }`,
 * so the workspace renders the form from the same declarations in
 * `core/settings/settings.service.ts` that validate a write, and puts this
 * panel underneath. Adding a mail setting is therefore one line there and
 * nothing here — which is what stops this panel becoming the second place a
 * setting has to be registered, and what keeps the save bar, the unsaved-
 * changes guard and the validation identical to every other settings group.
 */
export function MailSection() {
  const status = useMailStatus();
  const toast = useToast();
  const removeSecret = useRemoveSecret();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  // The server enforces it (`settings.secrets`); this stops the panel offering
  // a control that could only answer 403.
  const mayManageSecrets = useCan("settings.secrets");

  if (status.error) {
    return <ErrorState message="Der E-Mail-Status konnte nicht geladen werden." />;
  }

  return (
    <div className="flex flex-col gap-6">
      {status.data ? <MailStatusCard status={status.data} /> : <Skeleton className="h-64" />}

      {mayManageSecrets && status.data?.provider.hasCredentials ? (
        <Card
          title="Zugangsdaten"
          description="Das SMTP-Passwort wird verschlüsselt gespeichert und nie zurückgegeben. Ein leeres Feld im Formular oben lässt es unverändert — entfernen ist eine eigene Handlung."
        >
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            Passwort entfernen
          </Button>
        </Card>
      ) : null}

      <MailDiagnostics />
      <MailTemplates />

      <Card
        title="Zustellprotokoll"
        description="Wer wurde wann womit erreicht — und warum eine Nachricht nicht versendet wurde."
      >
        <p className="text-[13px] leading-relaxed text-muted">
          Das vollständige Protokoll steht unter{" "}
          <a className="link" href="#/einstellungen/benachrichtigungen">
            Einstellungen → Benachrichtigungen
          </a>
          . Es gehört der Benachrichtigungsplattform, die diese Zeilen schreibt — dort lässt sich
          auch eine endgültig fehlgeschlagene E-Mail erneut in die Warteschlange stellen.
        </p>
      </Card>

      {/*
        Removal is its own confirmed action, never a blank save.

        `classifySecretWrite` on the server treats every spelling of an empty
        password field as "keep", precisely so that a form posting all its
        fields cannot destroy a working credential. That leaves removal needing
        somewhere deliberate to live, and this is it.
      */}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="SMTP-Passwort entfernen?"
        confirmLabel="Entfernen"
        destructive
        busy={removing}
        message={
          <>
            Der Versand meldet sich danach ohne Passwort an — oder fällt auf{" "}
            <code className="font-mono text-[12px]">SMTP_PASSWORD</code> aus der Umgebung zurück.
            Ist dort nichts gesetzt und verlangt der Server eine Anmeldung, werden keine E-Mails
            mehr zugestellt.
          </>
        }
        onConfirm={() => {
          setRemoving(true);
          void removeSecret("mail.smtpPassword")
            .then(
              () => toast.success("Entfernt", "Das SMTP-Passwort wurde gelöscht."),
              (err: unknown) => toast.error("Entfernen fehlgeschlagen", toFailure(err).message),
            )
            .finally(() => {
              setRemoving(false);
              setConfirming(false);
            });
        }}
      />
    </div>
  );
}
