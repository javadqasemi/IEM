import { useState } from "react";
import { toFailure } from "@/core/api";
import { Badge, Button, Card, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { Modal, ReauthenticationDialog } from "@/shared/ui/overlays";
import { Pair } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { formatDateTime } from "@/shared/utils/format";
import { authRepository } from "@/core/auth";
import { useMfaMutations, useMfaStatus } from "../hooks/useMfa";
import { EnrolDialog } from "./EnrolDialog";
import { RecoveryCodesPanel } from "./RecoveryCodesPanel";
import type { MfaStatus, RecoveryCodes } from "../types";

/**
 * The second factor, on "Mein Konto".
 *
 * ---
 *
 * **It always renders, on or off.** A card that appeared only once MFA was
 * enabled would make the feature discoverable to nobody: the reader who most
 * needs to see it is the one who has not switched it on. The off state is
 * therefore an offer rather than an absence.
 *
 * **Three states, not two**, and the third is the one the settings panel
 * already learned to draw: `available: false` means this *server* has no
 * `MFA_ENCRYPTION_KEY`, which is a deployment that is not finished rather
 * than a choice the reader has made. Collapsing it into "off" would leave
 * somebody pressing a button that answers 503 for ever, with no way to know
 * whose problem it is.
 *
 * **Both destructive actions go through re-authentication.** Turning the
 * factor off and replacing the recovery codes are the two ways to reduce the
 * account's protection, and a signed-in browser is not evidence that the
 * account holder is the one at the keyboard. The dialog is
 * `shared/ui/overlays`' — see `ReauthenticationDialog` for why it takes its
 * authenticator as a prop.
 *
 * **Progressive disclosure.** Nothing on the resting card mentions TOTP, time
 * steps, drift or encryption. A reader who wants to know gets "Authenticator-
 * App" and a date; the cryptography is in the code and in the docs, which is
 * where it is useful.
 *
 * ---
 *
 * **This card must never take its own data off screen.** It renders a
 * skeleton while it has no status, and the enrolment wizard and the
 * recovery-code dialog are its *children* — so an `invalidate` on the status
 * key unmounts them, and the second of those is holding ten codes that
 * cannot be fetched again. Every mutation in `useMfa.ts` primes instead, and
 * the reasoning is written out there. Do not add an `invalidate([\"mfa\"])`
 * here.
 */
export function MfaCard({ account }: { account: string }) {
  const toast = useToast();
  const status = useMfaStatus();
  const { regenerate, disable } = useMfaMutations();

  const [enrolling, setEnrolling] = useState(false);
  /** Which sensitive act the re-authentication is being asked for. */
  const [confirming, setConfirming] = useState<"disable" | "regenerate" | null>(null);
  const [fresh, setFresh] = useState<RecoveryCodes | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status.error) {
    return <ErrorState message={status.error} onRetry={status.refetch} />;
  }
  if (!status.data) {
    return <Skeleton className="h-48 rounded-lg" />;
  }

  const mfa: MfaStatus = status.data;

  async function run(token: string) {
    setError(null);
    try {
      if (confirming === "disable") {
        await disable(token);
        toast.success(
          "Zwei-Faktor-Authentisierung deaktiviert",
          "Ihre offenen Sitzungen bleiben bestehen.",
        );
      } else if (confirming === "regenerate") {
        setFresh(await regenerate(token));
      }
    } catch (err) {
      // In place rather than as a toast: the message names what to do about
      // it and the reader is still looking at the card it belongs to.
      setError(toFailure(err).message);
    } finally {
      setConfirming(null);
    }
  }

  return (
    <>
      <Card
        title="Zwei-Faktor-Authentisierung"
        description="Ein zweiter Nachweis beim Anmelden, zusätzlich zum Passwort. Wer nur Ihr Passwort kennt, kommt damit nicht in Ihr Konto."
        action={<StatusBadge mfa={mfa} />}
      >
        <div className="flex flex-col gap-5">
          {!mfa.available ? (
            /*
              Not built here, but not configured *here* — the distinction the
              Einstellungen panel's three dots exist for. It names the
              variable, because the person who can fix it is an operator and
              the person reading it is the one who will forward the sentence.
            */
            <p className="rounded-md bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-muted ring-1 ring-line">
              Auf diesem Server ist die Zwei-Faktor-Authentisierung nicht
              eingerichtet: es fehlt der Schlüssel <code>MFA_ENCRYPTION_KEY</code>.
              Bitte wenden Sie sich an die Systemadministration.
            </p>
          ) : mfa.enabled ? (
            <>
              <dl className="grid gap-x-6 gap-y-3 text-[14px] sm:grid-cols-2">
                <Pair label="Verfahren">Authenticator-App (zeitbasierter Code)</Pair>
                <Pair label="Aktiv seit">{formatDateTime(mfa.verifiedAt?.toISOString() ?? null)}</Pair>
                <Pair label="Zuletzt verwendet">
                  {mfa.lastUsedAt ? formatDateTime(mfa.lastUsedAt.toISOString()) : "—"}
                </Pair>
                <Pair label="Wiederherstellungscodes">
                  <span className={mfa.recoveryCodes.low ? "text-brand-bronze" : undefined}>
                    {mfa.recoveryCodes.remaining} von {mfa.recoveryCodes.total} übrig
                  </span>
                </Pair>
              </dl>

              {mfa.recoveryCodes.low ? (
                /*
                  Said without being asked, because the failure it prevents is
                  silent: somebody who has spent seven of ten codes is one
                  lost phone away from being locked out entirely, and nothing
                  in the ordinary flow would ever mention it.
                */
                <p
                  role="status"
                  className="rounded-md bg-brand-bronze/[0.08] px-4 py-3 text-[13px] font-medium leading-relaxed text-brand-bronze ring-1 ring-brand-bronze/25"
                >
                  Es sind nur noch {mfa.recoveryCodes.remaining} Wiederherstellungscode(s) übrig.
                  Erzeugen Sie jetzt neue — die bisherigen werden dabei ungültig.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setConfirming("regenerate")}>
                  Neue Wiederherstellungscodes
                </Button>
                <Button variant="danger-quiet" onClick={() => setConfirming("disable")}>
                  Deaktivieren
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[14px] leading-relaxed text-muted">
                Noch nicht eingerichtet. Sie brauchen dafür eine Authenticator-App
                auf Ihrem Telefon; die Einrichtung dauert etwa zwei Minuten.
              </p>
              {mfa.pending ? (
                <p className="text-[13px] leading-relaxed text-muted">
                  Eine Einrichtung wurde begonnen und nicht abgeschlossen. Sie ist
                  bis {formatDateTime(mfa.pendingExpiresAt?.toISOString() ?? null)} gültig
                  — danach beginnen Sie einfach neu.
                </p>
              ) : null}
              <div>
                <Button variant="primary" onClick={() => setEnrolling(true)}>
                  Einrichten
                </Button>
              </div>
            </>
          )}

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-brand-bronze/[0.08] px-4 py-3 text-[13px] font-medium leading-relaxed text-brand-bronze ring-1 ring-brand-bronze/25"
            >
              {error}
            </p>
          ) : null}
        </div>
      </Card>

      <EnrolDialog
        open={enrolling}
        account={account}
        onClose={() => setEnrolling(false)}
        onEnabled={() =>
          toast.success(
            "Zwei-Faktor-Authentisierung aktiv",
            "Beim nächsten Anmelden wird zusätzlich ein Code verlangt.",
          )
        }
      />

      <ReauthenticationDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        authenticate={authRepository.reauthenticate}
        requiresCode={mfa.enabled}
        title={
          confirming === "disable"
            ? "Zwei-Faktor-Authentisierung deaktivieren"
            : "Neue Wiederherstellungscodes"
        }
        confirmLabel={confirming === "disable" ? "Deaktivieren" : "Neu erzeugen"}
        message={
          confirming === "disable" ? (
            <>
              <p>
                Ihr Konto ist danach nur noch durch das Passwort geschützt. Die
                hinterlegte App und alle Wiederherstellungscodes werden gelöscht.
              </p>
              <p className="mt-2">
                Ihre offenen Sitzungen bleiben bestehen — es ändert sich nur, was
                beim nächsten Anmelden verlangt wird.
              </p>
            </>
          ) : (
            <p>
              Sie erhalten zehn neue Codes. Die bisherigen funktionieren danach
              nicht mehr, auch die noch ungenutzten.
            </p>
          )
        }
        onConfirmed={run}
      />

      {/*
        The regenerated set, in its own dialog rather than on the card.

        Shown once and never again, exactly like the set at enrolment — so it
        uses the same panel, with the same acknowledgement, rather than a
        lighter version of it. A second, quieter way of presenting the same
        irreversible thing is how one of the two ends up without the checkbox.
      */}
      <Modal
        open={fresh !== null}
        onClose={() => setFresh(null)}
        title="Neue Wiederherstellungscodes"
        description="Die bisherigen Codes sind ab sofort ungültig."
        size="md"
      >
        {fresh ? (
          <RecoveryCodesPanel
            codes={fresh}
            account={account}
            heading="Ihre neuen Wiederherstellungscodes"
            acknowledgeLabel="Fertig"
            onAcknowledged={() => setFresh(null)}
          />
        ) : null}
      </Modal>
    </>
  );
}

/**
 * On, off, or not available on this server.
 *
 * `energy` for on and `neutral` for off — not `bronze`. Bronze is this
 * dashboard's "something is wrong" tone, and an account without a second
 * factor is not an error; it is the default every account starts in. Marking
 * it as a fault would train people to ignore the tone that matters.
 */
function StatusBadge({ mfa }: { mfa: MfaStatus }) {
  if (!mfa.available) return <Badge tone="neutral">Nicht eingerichtet (Server)</Badge>;
  if (mfa.enabled) return <Badge tone="energy">Aktiv</Badge>;
  return <Badge tone="neutral">Nicht aktiv</Badge>;
}
