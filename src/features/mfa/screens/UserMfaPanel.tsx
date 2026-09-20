import { useState } from "react";
import { Badge, Button } from "@/shared/ui/primitives";
import { ReauthenticationDialog } from "@/shared/ui/overlays";
import { useToast } from "@/shared/ui/feedback";
import { authRepository, useAuth } from "@/core/auth";
import { useAdminMfaMutations } from "../hooks/useMfa";

/**
 * One account's second factor, as an administrator sees it.
 *
 * ---
 *
 * **It shows a boolean and offers one action.** There is nothing else to
 * show, by construction: no route returns somebody else's secret, their
 * codes or a QR image, and no route ever will. An administrator can *remove*
 * a credential; they can never hold one, and they cannot enrol on somebody's
 * behalf — doing that would mean the firm's administrator had set up the
 * second factor that is supposed to prove the account holder is present.
 *
 * **Reset is account recovery, and it is destructive.** It is the answer to
 * "my phone is in a river", and the confirmation says what it costs: the
 * factor goes, the recovery codes go, and every session the person has is
 * ended. That last one is the opposite of what happens when somebody
 * disables their *own* factor, and the asymmetry is argued on
 * `MfaService.resetFor` — the two cases have different evidence behind them.
 *
 * **The administrator re-authenticates first.** `user.resetMfa` says who may
 * do this; the password says that the person at the keyboard is them. An
 * unlocked laptop at a shared desk must not be a way to strip a colleague's
 * second factor.
 *
 * `canReset` is passed in rather than read here, for the reason the sessions
 * panel gives: the permission is the shell's to check, the server refuses it
 * either way, and this stops the screen offering a button that can only 403.
 */
export function UserMfaPanel({
  userId,
  userName,
  enabled,
  canReset,
  onReset,
}: {
  userId: string;
  userName: string;
  enabled: boolean;
  canReset: boolean;
  /** So the surrounding list can re-read the row it just changed. */
  onReset?: () => void;
}) {
  const toast = useToast();
  const reset = useAdminMfaMutations();
  /**
   * The **caller's own** enrolment, not the target's.
   *
   * The dialog below re-authenticates the administrator pressing the button,
   * so whether it asks for a code depends on whether *they* have a factor —
   * and getting that backwards is not cosmetic: an administrator with MFA
   * enabled would be shown a password field, send a body with no code, and
   * be refused by the server with no way on screen to supply what was
   * missing. `useAuth` already holds the answer, resolved by the server on
   * every request.
   */
  const { user: me } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="field-label">Zwei-Faktor-Authentisierung</span>
          <span className="text-[13px] leading-snug text-muted">
            {enabled
              ? "Dieses Konto verlangt beim Anmelden zusätzlich einen Code."
              : "Dieses Konto ist nur durch das Passwort geschützt."}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {enabled ? <Badge tone="energy">Aktiv</Badge> : <Badge tone="neutral">Nicht aktiv</Badge>}
          {canReset && enabled ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              Zurücksetzen
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-[13px] font-medium text-brand-bronze">
          {error}
        </p>
      ) : null}

      <ReauthenticationDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        authenticate={authRepository.reauthenticate}
        requiresCode={Boolean(me?.mfaEnabled)}
        title="Zwei-Faktor-Authentisierung zurücksetzen"
        confirmLabel="Zurücksetzen"
        message={
          <>
            <p>
              „{userName}“ kann sich danach wieder allein mit dem Passwort
              anmelden. Die hinterlegte App und alle Wiederherstellungscodes
              werden gelöscht.
            </p>
            <p className="mt-2">
              Alle offenen Sitzungen dieses Kontos werden beendet. Bitte nur
              verwenden, wenn die Person ihren zweiten Faktor nachweislich
              verloren hat.
            </p>
          </>
        }
        onConfirmed={async (token) => {
          setError(null);
          try {
            const result = await reset(userId, token);
            toast.success(
              "Zurückgesetzt",
              result.hadFactor
                ? `${userName} kann sich wieder mit dem Passwort anmelden. ${result.sessionsRevoked} Sitzung(en) beendet.`
                : `${userName} hatte keinen zweiten Faktor.`,
            );
            onReset?.();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Das hat nicht geklappt.");
          }
        }}
      />
    </div>
  );
}
