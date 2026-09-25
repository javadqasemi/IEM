import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/shared/ui/primitives";
import { Field, Input, OtpInput, RecoveryCodeInput } from "@/shared/ui/forms";
import {
  REDUCED_SUCCESS_HOLD_MS,
  SUCCESS_HOLD_MS,
  VerificationMotion,
  prefersReducedMotion,
  verificationState,
  type VerificationPhase,
} from "@/shared/ui/feedback";
import { Wordmark } from "@/components/Wordmark";
import { toFailure } from "@/core/api";
import { authRepository } from "@/core/auth";
import { useAuth } from "@/core/auth";
import type { MfaRequired } from "@/core/auth";
import { navigate, useRoute } from "@/core/router";
import { SPENT_AUTH_ROUTES } from "../routes";

/**
 * Sign-in, password reset and invitation acceptance.
 *
 * Three screens in one file because they share a frame and are only ever
 * reached when nobody is signed in. The mode comes from the route, which is
 * what the invitation and reset mails link to
 * (`admin.html#/einladung?token=…`).
 */
type Mode = "login" | "forgot" | "reset" | "invite";

export function LoginPage() {
  const route = useRoute();
  const mode: Mode =
    route.path === "/passwort-vergessen"
      ? "forgot"
      : route.path === "/passwort-zuruecksetzen"
        ? "reset"
        : route.path === "/einladung"
          ? "invite"
          : "login";

  return (
    <div className="grid min-h-dvh place-items-center bg-base px-6 py-12">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col items-start gap-3">
          <Wordmark className="h-6 w-auto text-accent" />
          <p className="eyebrow text-muted">Dashboard</p>
        </div>

        {mode === "login" ? <SignIn /> : null}
        {mode === "forgot" ? <Forgot /> : null}
        {mode === "reset" || mode === "invite" ? (
          <SetPassword token={route.query.get("token") ?? ""} invite={mode === "invite"} />
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SignIn() {
  const { login, sessionExpired } = useAuth();
  const route = useRoute();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * The half-finished sign-in, held here and nowhere else.
   *
   * It belongs to **this attempt on this screen**: a challenge is worth five
   * minutes and can do exactly one thing, so putting it in `AuthProvider`
   * would make "half signed in" a state of the whole application and give
   * every consumer of `useAuth` a fourth case to get wrong. Navigating away
   * abandons it, which is correct — the password form is one keystroke away
   * and a new challenge costs nothing.
   */
  const [pending, setPending] = useState<MfaRequired | null>(null);
  const emailId = useId();
  const passwordId = useId();

  /**
   * Going back to the password form.
   *
   * The challenge is dropped rather than kept for a retry: it is bound to
   * the password that was just accepted, and offering "back" without
   * discarding it would leave a live credential in a closed screen's state.
   */
  const restart = () => {
    setPending(null);
    setPassword("");
    setError("");
  };

  if (pending) {
    return (
      <MfaStep
        challenge={pending}
        onBack={restart}
        onDone={() => {
          if (SPENT_AUTH_ROUTES.includes(route.path)) navigate("/", { replace: true });
        }}
      />
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // A second submit while the first is in flight costs an attempt against the
    // ten-per-minute throttle and can only ever produce the same answer. The
    // button is disabled while busy; this covers the form being submitted by
    // other means.
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const challenge = await login(email, password);
      if (challenge) {
        // Correct password, second factor still owed. Nothing was issued —
        // see `AuthProvider.login`.
        setPending(challenge);
        return;
      }
      /*
        Stay where they were trying to go.

        The shell renders this form *in place of* the requested screen rather
        than navigating to a sign-in route, so the hash is still
        `#/projekte/abc/gewerke` while the password is being typed — and going
        to `/` on success threw that away. Somebody following a colleague's
        link landed on the dashboard and had to find the plan again, which is
        the moment the link was supposed to save.

        The exception is a route that has now been used up: an invitation or a
        reset link is spent the moment it works, and leaving somebody on it
        would show them a form for a token that is gone.
      */
      if (SPENT_AUTH_ROUTES.includes(route.path)) navigate("/", { replace: true });
    } catch (err) {
      // The server's message is shown as-is. It is deliberately the same for a
      // wrong password and an unknown address, and it says something useful
      // when an account is locked — rewording it here would lose that.
      setError(toFailure(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel flex flex-col gap-5 p-6">
      <h1 className="font-display text-xl font-semibold text-ink">Anmelden</h1>

      {/*
        Why they are looking at this form.

        Without it an expiring session is indistinguishable from a bug: the
        screen someone was working on is replaced by a login box with no
        explanation, and the reasonable conclusion is that the dashboard threw
        them out for no reason. `role="status"` rather than `role="alert"` —
        it is context for a form they are about to fill in, not an error in it.
      */}
      {sessionExpired && !error ? (
        <p role="status" className="text-[13px] leading-relaxed text-muted">
          Ihre Sitzung ist abgelaufen oder wurde beendet. Bitte melden Sie sich erneut an — Sie
          kommen danach auf die Seite zurück, auf der Sie waren.
        </p>
      ) : null}

      <Field label="E-Mail" htmlFor={emailId}>
        <Input
          id={emailId}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
      </Field>

      <Field label="Passwort" htmlFor={passwordId}>
        <Input
          id={passwordId}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>

      {error ? (
        <p role="alert" className="text-[13px] font-medium text-brand-bronze">
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" busy={busy}>
        Anmelden
      </Button>

      <a
        href="#/passwort-vergessen"
        className="self-start text-[13px] text-brand-blue transition-colors hover:text-brand-bronze"
      >
        Passwort vergessen?
      </a>
    </form>
  );
}

/**
 * Step two of a sign-in: the code from the authenticator, or a recovery code.
 *
 * ---
 *
 * **The brand is not redesigned.** It renders inside the same `panel` as the
 * password form, with the same heading scale, the same field spacing and the
 * same primary button — a reader who has just typed their password should
 * not feel that they have been handed to a different system at the moment
 * they are being asked for a second credential, which is precisely the
 * feeling a phishing page produces.
 *
 * **Two fields, one at a time.** The recovery path is a link rather than a
 * second box on the same screen: showing both invites somebody to spend a
 * one-time code when their phone is in their pocket, and ten of those is all
 * they have.
 *
 * **`autoFocus` on the code field.** The reader arrived here by pressing a
 * button, so the keyboard is already theirs and the next thing they will do
 * is type six digits. On a phone this is also what raises the number pad.
 *
 * ---
 *
 * **The verification is shown, and only the server can finish it.** While the
 * request is in flight the form dims and blurs under `VerificationMotion`; the
 * success animation starts inside `completeMfa`'s `beforeAdopt`, which is
 * reached only after the server has accepted the code and issued the session.
 * The hold that follows delays the dashboard by under a second and decides
 * nothing. A refusal restores the form, shows the refusal through `Field`, and
 * puts the keyboard back in the field.
 *
 * The state is `phase` (where the request is) and `error` (what the server
 * last said); `verificationState` derives the one value the markup reads, so
 * there are no two booleans that can disagree about what is on screen.
 */
function MfaStep({
  challenge,
  onBack,
  onDone,
}: {
  challenge: MfaRequired;
  onBack: () => void;
  onDone: () => void;
}) {
  const { completeMfa } = useAuth();
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<VerificationPhase>("entry");
  const codeId = useId();
  const recoveryId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const recoveryRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const busy = phase !== "entry";
  const ready = mode === "totp" ? code.length === 6 : recoveryCode.trim().length > 0;
  const state = verificationState({ phase, error, value: mode === "totp" ? code : recoveryCode });

  /*
    The dimmed form is `inert` while it is being checked: the overlay already
    stops the pointer, and this stops the keyboard reaching "Abbrechen" or the
    recovery switch under a blur. Set as a property because React 18 does not
    know the attribute.
  */
  useEffect(() => {
    if (contentRef.current) contentRef.current.inert = busy;
  }, [busy]);

  // After a refusal the field was disabled a moment ago and has lost focus;
  // the next thing the reader does is type again, so it goes back there.
  useEffect(() => {
    if (state === "error") (mode === "totp" ? codeRef : recoveryRef).current?.focus();
  }, [state, mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Same guard as the password form: a second submit spends an attempt
    // against both the route's throttle and the challenge's own ceiling of
    // five, and can only produce the answer already in flight.
    if (busy || !ready) return;
    setError("");
    setPhase("verifying");
    try {
      await completeMfa(
        challenge.challenge,
        mode === "totp" ? { code } : { recoveryCode },
        {
          beforeAdopt: async () => {
            setPhase("success");
            await new Promise((resolve) =>
              setTimeout(resolve, prefersReducedMotion() ? REDUCED_SUCCESS_HOLD_MS : SUCCESS_HOLD_MS),
            );
          },
        },
      );
      onDone();
    } catch (err) {
      /*
        The server's message, as-is.

        It is deliberately the same for a wrong code, a replayed one and a
        challenge that has already been spent — and it says something
        different and useful when the attempts have run out or the whole
        thing has expired. Rewording it here would lose that, and guessing
        which case it was would be guessing.
      */
      setError(toFailure(err).message);
      // The code is spent either way — right or wrong, it will not be
      // accepted twice — so clearing it saves a select-all before retyping.
      setCode("");
      setPhase("entry");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="panel vm-stage p-6"
      data-state={state}
      aria-busy={busy || undefined}
    >
      {/*
        What the motion says, in words, for a screen reader. Always in the DOM
        so the change of text is what gets announced; the refusal is not here
        because `Field` already announces it (`role="alert"`) and wires it to
        the input.
      */}
      <p role="status" className="sr-only">
        {phase === "verifying"
          ? "Code wird geprüft."
          : phase === "success"
            ? "Code bestätigt. Sie werden angemeldet."
            : ""}
      </p>

      {busy ? (
        <div className="vm-overlay">
          <VerificationMotion status={phase === "success" ? "success" : "verifying"} />
          <div key={phase} aria-hidden="true" className="vm-message flex flex-col gap-1">
            {phase === "success" ? (
              <>
                <p className="text-[15px] font-semibold text-disc-energy">Bestätigt</p>
                <p className="text-[13px] text-muted">Sie werden angemeldet …</p>
              </>
            ) : (
              <p className="text-[14px] font-medium text-ink">Code wird geprüft …</p>
            )}
          </div>
        </div>
      ) : null}

      <div ref={contentRef} className="vm-content flex flex-col gap-5">
        <h1 className="font-display text-xl font-semibold text-ink">Zwei-Faktor-Bestätigung</h1>

        <p className="text-[14px] leading-relaxed text-muted">
          {mode === "totp"
            ? "Bitte den sechsstelligen Code aus Ihrer Authenticator-App eingeben."
            : "Bitte einen Ihrer Wiederherstellungscodes eingeben. Jeder Code funktioniert genau einmal."}
        </p>

        {/*
          The error goes **through `Field`**, not beside it.

          A `<p role="alert">` of its own is announced once and then belongs to
          nothing: a reader who tabs back to the input hears the label and not
          the reason it was refused. `Field` owns that relationship — it clones
          its child to supply `aria-describedby` and `aria-invalid` — and
          CLAUDE.md records the release where every hand-written
          `<Field><Input/></Field>` in the dashboard skipped it.
        */}
        {mode === "totp" ? (
          <Field label="Code aus der App" htmlFor={codeId} error={error || undefined}>
            <OtpInput
              ref={codeRef}
              id={codeId}
              value={code}
              onChange={setCode}
              invalid={Boolean(error)}
              success={phase === "success"}
              disabled={busy}
              autoFocus
            />
          </Field>
        ) : (
          <Field
            label="Wiederherstellungscode"
            htmlFor={recoveryId}
            hint="Gross- und Kleinschreibung sowie der Bindestrich spielen keine Rolle."
            error={error || undefined}
          >
            <RecoveryCodeInput
              ref={recoveryRef}
              id={recoveryId}
              value={recoveryCode}
              onChange={setRecoveryCode}
              invalid={Boolean(error)}
              disabled={busy}
              autoFocus
            />
          </Field>
        )}

        {/*
          No `busy` spinner: the orbital loader over the form is the progress
          indicator, and a second one under the blur would only be noise.
          Disabled is what stops the duplicate submission.
        */}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={!ready || busy}
          className="vm-submit"
        >
          {phase === "success" ? "Bestätigt" : "Bestätigen"}
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
          <button
            type="button"
            onClick={() => {
              setMode(mode === "totp" ? "recovery" : "totp");
              setError("");
            }}
            className="text-brand-blue transition-colors hover:text-brand-bronze"
          >
            {mode === "totp" ? "Wiederherstellungscode verwenden" : "Doch den Code aus der App"}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="text-muted transition-colors hover:text-ink"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </form>
  );
}

function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await authRepository.forgotPassword(email);
    } finally {
      // Always shows the same confirmation, whether or not the address exists.
      // Anything else turns this form into a way to find out who has an
      // account.
      setSent(true);
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="panel flex flex-col gap-4 p-6">
        <h1 className="font-display text-xl font-semibold text-ink">E-Mail unterwegs</h1>
        <p className="text-[14px] leading-relaxed text-muted">
          Falls für diese Adresse ein Konto besteht, ist eine Nachricht mit einem Link unterwegs.
          Der Link ist eine Stunde gültig.
        </p>
        <Button href="#/" variant="secondary">
          Zurück zur Anmeldung
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="panel flex flex-col gap-5 p-6">
      <h1 className="font-display text-xl font-semibold text-ink">Passwort zurücksetzen</h1>
      <p className="text-[14px] leading-relaxed text-muted">
        Wir schicken Ihnen einen Link, mit dem Sie ein neues Passwort setzen können.
      </p>

      <Field label="E-Mail" htmlFor={id}>
        <Input
          id={id}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
      </Field>

      <Button type="submit" variant="primary" size="lg" busy={busy}>
        Link anfordern
      </Button>
      <a href="#/" className="self-start text-[13px] text-brand-blue hover:text-brand-bronze">
        Zurück zur Anmeldung
      </a>
    </form>
  );
}

function SetPassword({ token, invite }: { token: string; invite: boolean }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const a = useId();
  const b = useId();

  useEffect(() => {
    if (!token) setError("Dieser Link ist unvollständig. Bitte die Adresse aus der E-Mail vollständig öffnen.");
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== repeat) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await authRepository.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(toFailure(err).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel flex flex-col gap-4 p-6">
        <h1 className="font-display text-xl font-semibold text-ink">Passwort gesetzt</h1>
        <p className="text-[14px] leading-relaxed text-muted">
          Sie können sich jetzt anmelden.
        </p>
        <Button href="#/" variant="primary">
          Zur Anmeldung
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="panel flex flex-col gap-5 p-6">
      <h1 className="font-display text-xl font-semibold text-ink">
        {invite ? "Willkommen — Passwort festlegen" : "Neues Passwort"}
      </h1>
      <p className="text-[14px] leading-relaxed text-muted">
        Mindestens 12 Zeichen. Länge zählt mehr als Sonderzeichen — eine Folge von vier Wörtern
        ist sicherer und leichter zu merken als «Passwort1!».
      </p>

      <Field label="Neues Passwort" htmlFor={a}>
        <Input
          id={a}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={12}
          autoFocus
          required
        />
      </Field>

      <Field label="Wiederholen" htmlFor={b}>
        <Input
          id={b}
          type="password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          autoComplete="new-password"
          minLength={12}
          required
        />
      </Field>

      {error ? (
        <p role="alert" className="text-[13px] font-medium text-brand-bronze">
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!token}>
        Passwort speichern
      </Button>
    </form>
  );
}
