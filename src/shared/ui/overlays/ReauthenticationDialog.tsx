import { useEffect, useId, useState, type ReactNode } from "react";
import { toFailure } from "@/core/api";
import { Button } from "@/shared/ui/primitives";
import { Field } from "@/shared/ui/forms/Field";
import { Input } from "@/shared/ui/forms/inputs";
import { OtpInput, RecoveryCodeInput } from "@/shared/ui/forms/OtpInput";
import { Modal } from "./Modal";

/**
 * "Prove it again before you do that."
 *
 * The stronger sibling of `ConfirmDialog`, and it lives beside it for the
 * same reason that one does: it is the shape of a confirmation, not the
 * content of one. `ConfirmDialog` asks *are you sure*; this asks *are you
 * who you say you are*, which is the question worth asking before an action
 * **removes a security control** rather than merely destroying data.
 *
 * ---
 *
 * **It fetches nothing itself.** `authenticate` is a prop, the way
 * `EntityPicker` takes its loader — so this file knows about a password and
 * a second factor and knows nothing about `/auth/reauthenticate`, and
 * `shared/ui` stays a place where components take props and render. The call
 * sites pass `authRepository.reauthenticate`.
 *
 * **The window is handed to the caller and kept nowhere.** `onConfirmed`
 * receives the token and the caller spends it immediately on the one
 * operation it opened the dialog for. The server keeps the window open for
 * five minutes so that two sensitive steps in a row do not each prompt —
 * but *caching it in the browser* would turn a prompt into a standing
 * capability sitting in a module variable, which is the thing the prompt
 * exists to prevent.
 *
 * **`requiresCode` comes from the caller**, because only it knows whether
 * this account has a second factor, and asking for a code that does not
 * exist is how somebody concludes the dialog is broken. The server checks
 * regardless: a body with no code against an enrolled account is refused,
 * so a wrong prop is a worse screen and not a weaker gate.
 */
export function ReauthenticationDialog({
  open,
  onClose,
  onConfirmed,
  authenticate,
  title = "Identität bestätigen",
  message,
  confirmLabel = "Bestätigen",
  requiresCode = false,
  description = "Dieser Schritt ändert eine Sicherheitseinstellung Ihres Kontos.",
}: {
  open: boolean;
  onClose: () => void;
  /** Spend the window immediately; do not store it. */
  onConfirmed: (reauthToken: string) => void | Promise<void>;
  authenticate: (input: {
    password: string;
    code?: string;
    recoveryCode?: string;
  }) => Promise<{ token: string }>;
  title?: string;
  /** Why this is being asked. Written by the operation, not by this file. */
  message?: ReactNode;
  confirmLabel?: string;
  requiresCode?: boolean;
  /**
   * The line under the title. The default was the only text for a while and
   * was wrong everywhere but the caller's own MFA card — a backup restore or
   * a role grant does not change a setting of *your* account.
   */
  description?: string;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordId = useId();
  const codeId = useId();
  const recoveryId = useId();

  /*
    Emptied on every open, not on close.

    Clearing on close loses the race with the closing animation and, worse,
    leaves a password in state for as long as the dialog's parent stays
    mounted when the caller forgets to unmount it. Clearing on open is one
    line and holds in both cases.
  */
  useEffect(() => {
    if (!open) return;
    setPassword("");
    setCode("");
    setRecoveryCode("");
    setUseRecovery(false);
    setError("");
  }, [open]);

  const factorReady = !requiresCode || (useRecovery ? recoveryCode.trim().length > 0 : code.length === 6);
  const ready = password.length > 0 && factorReady;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    setError("");
    setBusy(true);
    try {
      const { token } = await authenticate({
        password,
        ...(requiresCode ? (useRecovery ? { recoveryCode } : { code }) : {}),
      });
      await onConfirmed(token);
      onClose();
    } catch (err) {
      // The server says the same thing for a wrong password and a wrong
      // code, on purpose — this is an authenticated caller, so naming which
      // half failed would tell somebody holding the session which one they
      // still need.
      setError(toFailure(err).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      busy={busy}
      description={description}
    >
      {/*
        A real `<form>`, so Enter submits.

        The footer is not used for the buttons here: `Modal`'s footer renders
        outside the children, so a submit button placed there would not be
        associated with this form and Enter would do nothing — which on a
        password field is the first thing anybody tries. The same trap
        `SaveBar` documents from the other direction.
      */}
      <form onSubmit={submit} className="flex flex-col gap-5">
        {message ? (
          <div className="text-[14px] leading-relaxed text-muted">{message}</div>
        ) : null}

        <Field label="Passwort" htmlFor={passwordId}>
          <Input
            id={passwordId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
            autoFocus
            required
          />
        </Field>

        {/*
          The message hangs off the *second* field where there is one, and off
          the password where there is not.

          Through `Field` rather than beside it, so it is wired with
          `aria-describedby` — a bare `role="alert"` is announced once and a
          reader who tabs back to the input hears nothing about why it was
          refused. `Field` owns that relationship; CLAUDE.md records the
          release where every hand-written pairing skipped it.

          Only one of the two carries it, because the server deliberately
          gives one message for a wrong password and a wrong code, and
          repeating it under both fields would suggest both were wrong.
        */}
        {requiresCode ? (
          useRecovery ? (
            <Field
              label="Wiederherstellungscode"
              htmlFor={recoveryId}
              error={error || undefined}
            >
              <RecoveryCodeInput
                id={recoveryId}
                value={recoveryCode}
                onChange={setRecoveryCode}
                invalid={Boolean(error)}
                disabled={busy}
              />
            </Field>
          ) : (
            <Field label="Code aus der App" htmlFor={codeId} error={error || undefined}>
              <OtpInput
                id={codeId}
                value={code}
                onChange={setCode}
                invalid={Boolean(error)}
                disabled={busy}
              />
            </Field>
          )
        ) : error ? (
          <p role="alert" className="text-[13px] font-medium text-brand-bronze">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {requiresCode ? (
            <button
              type="button"
              onClick={() => {
                setUseRecovery(!useRecovery);
                setError("");
              }}
              className="mr-auto text-[13px] text-brand-blue transition-colors hover:text-brand-bronze"
            >
              {useRecovery ? "Doch den Code aus der App" : "Wiederherstellungscode verwenden"}
            </button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!ready}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
