import { useEffect, useId, useState } from "react";
import { Button } from "@/shared/ui/primitives";
import { Field, Input } from "@/shared/ui/forms";
import { Wordmark } from "@/components/Wordmark";
import { ApiError } from "@/core/api";
import { authRepository } from "@/core/auth";
import { useAuth } from "@/core/auth";
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
  const emailId = useId();
  const passwordId = useId();

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
      await login(email, password);
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
      setError(err instanceof ApiError ? err.message : "Die Anmeldung ist fehlgeschlagen.");
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
      setError(err instanceof ApiError ? err.message : "Das hat nicht geklappt.");
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
