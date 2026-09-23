import { useEffect, useId, useState } from "react";
import { Button } from "@/shared/ui/primitives";
import { Field, OtpInput } from "@/shared/ui/forms";
import { Modal } from "@/shared/ui/overlays";
import { toFailure } from "@/core/api";
import { useMfaMutations } from "../hooks/useMfa";
import { QrCode } from "./QrCode";
import { RecoveryCodesPanel } from "./RecoveryCodesPanel";
import type { Enrolment, RecoveryCodes } from "../types";

/**
 * Setting up the second factor, in four screens inside one dialog.
 *
 * ---
 *
 * ## Why a wizard and not a page
 *
 * The opposite of the Aufgaben/Sitzungen argument, and it comes out at a
 * third answer. A task is a drawer because it is opened and closed four times
 * in a row; a protocol is a route because it gets quoted in an e-mail. This
 * is neither: it is done **once**, it is done **to completion or not at all**,
 * and the thing it produces must not be left half-finished behind a
 * navigation. A dialog is the shape that says "finish this or abandon it",
 * and the URL it would otherwise need is one nobody has any reason to send to
 * a colleague.
 *
 * ## The steps, and what each one is defending
 *
 * | | |
 * | --- | --- |
 * | `intro` | What MFA does and that an app is needed. Skipping it is how somebody presses "Einrichten", meets a QR code, has no app, and abandons a `PENDING` credential |
 * | `scan` | The QR code **and** the typed key, never only the QR — see below |
 * | `verify` | The first correct code. Until this succeeds the factor is off |
 * | `codes` | The recovery codes, once, behind an explicit acknowledgement |
 *
 * ## The manual key is not a fallback
 *
 * It is beside the QR code at equal weight, because the case it serves is not
 * rare: **the dashboard is open on the same phone the authenticator runs on**,
 * and a camera cannot photograph its own screen. It is also what a reader
 * using a screen reader needs, and what somebody on a desktop with a
 * corporate authenticator on a locked-down phone falls back to.
 *
 * ## Nothing is enabled by looking at it
 *
 * The credential the server wrote at `scan` is `PENDING`, which
 * `requiresFactor` does not count. Closing the dialog here leaves the account
 * exactly as it was, and the card behind says an enrolment was started.
 */
type Step = "intro" | "scan" | "verify" | "codes";

export function EnrolDialog({
  open,
  onClose,
  onEnabled,
  account,
}: {
  open: boolean;
  onClose: () => void;
  /** Fired once the factor is genuinely on and the codes acknowledged. */
  onEnabled: () => void;
  account: string;
}) {
  const { start, verify } = useMfaMutations();
  const [step, setStep] = useState<Step>("intro");
  /**
   * The secret, held in component state and nowhere else.
   *
   * Deliberately not in the query cache: `clearQueryCache` runs on sign-in
   * and sign-out, which is a longer life than a secret should have. Unmounting
   * the dialog is what drops this, and that happens the moment it closes.
   */
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [codes, setCodes] = useState<RecoveryCodes | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const codeId = useId();

  // Reset on open rather than on close, for the reason
  // `ReauthenticationDialog` gives: closing races the animation and leaves a
  // secret in state if the parent keeps the component mounted.
  useEffect(() => {
    if (!open) return;
    setStep("intro");
    setEnrolment(null);
    setCodes(null);
    setCode("");
    setError("");
    setCopied(false);
  }, [open]);

  async function begin() {
    setBusy(true);
    setError("");
    try {
      setEnrolment(await start());
      setStep("scan");
    } catch (err) {
      // A 503 here is the honest one: `MFA_ENCRYPTION_KEY` is not configured
      // on this server. The server's message names the variable, which is
      // what an operator needs and what a user needs to forward.
      setError(toFailure(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      setCodes(await verify(code));
      setStep("codes");
    } catch (err) {
      setError(toFailure(err).message);
      // Spent either way — a correct code cannot be presented twice and a
      // wrong one has to be retyped. Clearing saves a select-all.
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!enrolment) return;
    try {
      await navigator.clipboard.writeText(enrolment.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* The key is on screen; a refused clipboard is not worth an error. */
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size={step === "codes" ? "md" : "sm"}
      title={TITLES[step]}
      description={
        step === "codes"
          ? "Die Zwei-Faktor-Authentisierung ist jetzt aktiv."
          : "Schritt für Schritt — Sie können jederzeit abbrechen."
      }
    >
      {step === "intro" ? (
        <div className="flex flex-col gap-5">
          <p className="text-[14px] leading-relaxed text-muted">
            Mit der Zwei-Faktor-Authentisierung genügt Ihr Passwort allein nicht
            mehr, um sich anzumelden. Wer es kennt, kommt trotzdem nicht in Ihr
            Konto — es braucht zusätzlich einen Code von Ihrem Telefon.
          </p>
          <ul className="flex flex-col gap-2.5 text-[14px] leading-relaxed text-muted">
            <Bullet>
              Sie brauchen eine Authenticator-App auf dem Telefon — zum Beispiel
              Microsoft Authenticator, Google Authenticator, 1Password oder
              Bitwarden. Jede App funktioniert, die Standard-Codes erzeugt.
            </Bullet>
            <Bullet>
              Sie erhalten am Schluss zehn Wiederherstellungscodes. Die brauchen
              Sie, falls das Telefon verloren geht — bitte gleich ablegen.
            </Bullet>
            <Bullet>
              Ihre offenen Sitzungen bleiben bestehen. Beim nächsten Anmelden
              wird der Code verlangt.
            </Bullet>
          </ul>

          {error ? <ErrorLine>{error}</ErrorLine> : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Abbrechen
            </Button>
            <Button variant="primary" busy={busy} onClick={() => void begin()}>
              Einrichten
            </Button>
          </div>
        </div>
      ) : null}

      {step === "scan" && enrolment ? (
        <div className="flex flex-col gap-5">
          <p className="text-[14px] leading-relaxed text-muted">
            Öffnen Sie Ihre Authenticator-App und scannen Sie diesen Code.
          </p>

          <QrCode matrix={enrolment.qr} />

          <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-4 ring-1 ring-line">
            <span className="field-label">Oder von Hand eintragen</span>
            <code className="select-all break-all font-mono text-[14px] tracking-wider text-ink">
              {enrolment.secretGrouped}
            </code>
            <p className="text-[12px] leading-snug text-muted">
              Nötig, wenn Sie das Dashboard auf demselben Telefon geöffnet haben,
              auf dem die App läuft — eine Kamera kann den eigenen Bildschirm
              nicht fotografieren.
            </p>
            <div>
              <Button size="sm" variant="secondary" onClick={() => void copyKey()}>
                {copied ? "Kopiert" : "Schlüssel kopieren"}
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
            <Button variant="primary" onClick={() => setStep("verify")}>
              Weiter
            </Button>
          </div>
        </div>
      ) : null}

      {step === "verify" ? (
        <form onSubmit={confirm} className="flex flex-col gap-5">
          <p className="text-[14px] leading-relaxed text-muted">
            Geben Sie den sechsstelligen Code ein, den die App jetzt anzeigt.
            Erst damit wird die Zwei-Faktor-Authentisierung eingeschaltet.
          </p>

          {/*
            Through `Field`, so the message is wired to the input with
            `aria-describedby` rather than only announced once — see the
            note on `Field` and the release that got this wrong everywhere.
            The intro step keeps an `ErrorLine` because its failure is about
            the *server*, not about a field.
          */}
          <Field label="Code aus der App" htmlFor={codeId} error={error || undefined}>
            <OtpInput
              id={codeId}
              value={code}
              onChange={setCode}
              invalid={Boolean(error)}
              disabled={busy}
              autoFocus
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep("scan")} disabled={busy}>
              Zurück
            </Button>
            <Button type="submit" variant="primary" busy={busy} disabled={code.length !== 6}>
              Aktivieren
            </Button>
          </div>
        </form>
      ) : null}

      {step === "codes" && codes ? (
        <RecoveryCodesPanel
          codes={codes}
          account={account}
          acknowledgeLabel="Fertig"
          onAcknowledged={() => {
            onEnabled();
            onClose();
          }}
        />
      ) : null}

    </Modal>
  );
}

const TITLES: Record<Step, string> = {
  intro: "Zwei-Faktor-Authentisierung einrichten",
  scan: "App verbinden",
  verify: "Code bestätigen",
  codes: "Wiederherstellungscodes",
};

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
      <span>{children}</span>
    </li>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-[13px] font-medium leading-relaxed text-brand-bronze">
      {children}
    </p>
  );
}
