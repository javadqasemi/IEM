/**
 * Why a message did not go out, in words this application chose.
 *
 * Pure — no provider, no transport, no clock — so every branch can be covered
 * from a table of real error shapes. The same split `auth.rules.ts` and
 * `tasks.rules.ts` make, and here it earns it twice over: this is the function
 * that decides what an operator reads *and* the function that decides what a
 * credential-bearing exception message is allowed to become.
 *
 * ---
 *
 * ## The problem it solves
 *
 * Before this file, `(err as Error).message` from nodemailer went three places
 * at once: into the browser, into `NotificationDelivery.detail`, and into the
 * `MailTested` audit payload. Those messages are written by a library and a
 * remote server, and they routinely contain the host, the username, the exact
 * AUTH mechanism, and occasionally the server's own echo of the command that
 * failed. None of that belongs in an audit log that other people read, and a
 * raw remote string rendered into a settings page is an injection surface
 * nobody is checking.
 *
 * So: the raw message is **classified into a closed set**, and the sanitized
 * result is what crosses every boundary. The raw text is not thrown away — it
 * goes to the server log, where it is genuinely useful and where the reader is
 * already the operator — but it never travels with the result.
 *
 * ## Why the categories are these
 *
 * Each one maps to a *different thing the operator does next*, which is the
 * only justification a status category ever has:
 *
 * | | What it means the operator should do |
 * | --- | --- |
 * | `CONFIGURATION` | Fill in the form — something required is missing |
 * | `AUTHENTICATION` | The username or password is wrong |
 * | `CONNECTION` | The host or port is wrong, or the server is down |
 * | `TLS` | The security settings disagree — usually the `secure` toggle |
 * | `TIMEOUT` | Reachable but not answering; often a firewall swallowing packets |
 * | `RECIPIENT_REJECTED` | The address was refused; the configuration is fine |
 * | `RATE_LIMIT` | The provider is throttling; wait rather than change anything |
 * | `PROVIDER` | The server said no for a reason of its own |
 * | `UNKNOWN` | Nothing matched — read the server log |
 *
 * `RECIPIENT_REJECTED` is the one worth calling out: it is the only category
 * that means **the mail configuration is correct**. Reporting it as a
 * connection fault would send somebody to re-check an SMTP host that was never
 * the problem.
 */

export const MAIL_FAILURE_CATEGORIES = [
  "CONFIGURATION",
  "AUTHENTICATION",
  "CONNECTION",
  "TLS",
  "TIMEOUT",
  "RECIPIENT_REJECTED",
  "RATE_LIMIT",
  "PROVIDER",
  "UNKNOWN",
] as const;

export type MailFailureCategory = (typeof MAIL_FAILURE_CATEGORIES)[number];

export type MailFailure = {
  category: MailFailureCategory;
  /** German, operator-readable, written here. Never from the provider. */
  message: string;
};

/**
 * What each category says, and what it suggests doing.
 *
 * One sentence of diagnosis and one of remedy. Held as data rather than built
 * in the classifier so the wording is visible in one list and so
 * `mail.failure.test.ts` can assert that every category has copy — a category
 * that classified correctly and rendered as `undefined` would be worse than
 * no classification at all.
 */
const COPY: Record<MailFailureCategory, string> = {
  CONFIGURATION:
    "Die E-Mail-Konfiguration ist unvollständig. Prüfen Sie Server, Port und Absenderadresse.",
  AUTHENTICATION:
    "Der Mailserver hat die Anmeldung abgelehnt. Benutzername oder Passwort stimmen nicht.",
  CONNECTION:
    "Der Mailserver ist nicht erreichbar. Prüfen Sie Server und Port sowie die Firewall.",
  TLS:
    "Die gesicherte Verbindung kam nicht zustande. Prüfen Sie die Einstellung „TLS ab Verbindungsaufbau“ — " +
    "Port 465 erwartet sie eingeschaltet, Port 587 in aller Regel ausgeschaltet.",
  TIMEOUT:
    "Der Mailserver hat nicht rechtzeitig geantwortet. Häufig blockiert eine Firewall den Port stillschweigend.",
  RECIPIENT_REJECTED:
    "Der Mailserver hat die Empfängeradresse abgelehnt. Die Konfiguration selbst ist in Ordnung.",
  RATE_LIMIT:
    "Der Mailserver drosselt den Versand. Warten Sie einen Moment, bevor Sie es erneut versuchen.",
  PROVIDER: "Der Mailserver hat die Nachricht abgelehnt. Einzelheiten stehen im Server-Protokoll.",
  UNKNOWN: "Der Versand ist aus einem unbekannten Grund fehlgeschlagen. Siehe Server-Protokoll.",
};

/**
 * Node and nodemailer error codes, which are the reliable signal.
 *
 * Checked **before** the message text, because a code is a contract and a
 * message is prose that changes between library versions and between mail
 * servers. Matching on prose alone is how a classifier silently degrades to
 * `UNKNOWN` after a dependency bump.
 */
const BY_CODE: Record<string, MailFailureCategory> = {
  EAUTH: "AUTHENTICATION",
  EENVELOPE: "RECIPIENT_REJECTED",
  ECONNECTION: "CONNECTION",
  ECONNREFUSED: "CONNECTION",
  ECONNRESET: "CONNECTION",
  EHOSTUNREACH: "CONNECTION",
  ENETUNREACH: "CONNECTION",
  ENOTFOUND: "CONNECTION",
  EAI_AGAIN: "CONNECTION",
  ETIMEDOUT: "TIMEOUT",
  ESOCKETTIMEDOUT: "TIMEOUT",
  ETIMEOUT: "TIMEOUT",
  ESOCKET: "TLS",
  ETLS: "TLS",
  EMESSAGE: "PROVIDER",
  ESTREAM: "PROVIDER",
};

/**
 * SMTP reply codes, for the cases a library code does not narrow.
 *
 * `421` and `450`/`451` are the throttling family; `550`–`553` are the
 * recipient family; `535` is authentication, which `EAUTH` usually catches
 * first but not always — a server that fails AUTH mid-session reports the
 * code without the library classifying it.
 */
function fromReplyCode(code: number | null): MailFailureCategory | null {
  if (code === null) return null;
  if (code === 421 || code === 450 || code === 451 || code === 452) return "RATE_LIMIT";
  if (code === 535 || code === 530 || code === 534) return "AUTHENTICATION";
  if (code >= 550 && code <= 553) return "RECIPIENT_REJECTED";
  if (code >= 500 && code < 600) return "PROVIDER";
  if (code >= 400 && code < 500) return "PROVIDER";
  return null;
}

/**
 * Last resort: the message text.
 *
 * Only reached when neither a code nor a reply code decided it. Ordered so the
 * more specific phrase wins — "wrong version number" is a TLS fault that also
 * contains the word "connection" in several server dialects.
 */
function fromMessage(raw: string): MailFailureCategory | null {
  const text = raw.toLowerCase();

  if (/wrong version number|ssl|tls|certificate|self[- ]signed|handshake/.test(text)) return "TLS";
  if (/auth|credential|password|username|login/.test(text)) return "AUTHENTICATION";
  if (/timed? ?out|timeout/.test(text)) return "TIMEOUT";
  if (/too many|rate limit|throttl|try again later/.test(text)) return "RATE_LIMIT";
  if (/recipient|mailbox|no such user|address rejected|relay/.test(text)) {
    return "RECIPIENT_REJECTED";
  }
  if (/connect|econn|network|unreachable|dns|getaddrinfo/.test(text)) return "CONNECTION";
  return null;
}

/**
 * The classifier.
 *
 * Takes anything — the parameter is `unknown` because a `catch` binding is
 * `unknown` and forcing every call site to cast would be a cast every call
 * site eventually gets wrong.
 *
 * **Returns no part of the input.** That is the invariant the whole file
 * exists for, and `mail.failure.test.ts` asserts it directly by classifying an
 * error whose message contains a password and checking the result does not.
 */
export function classifyMailError(err: unknown): MailFailure {
  const category = detect(err);
  return { category, message: COPY[category] };
}

function detect(err: unknown): MailFailureCategory {
  if (err === null || typeof err !== "object") return "UNKNOWN";

  const e = err as { code?: unknown; responseCode?: unknown; message?: unknown };

  if (typeof e.code === "string") {
    const byCode = BY_CODE[e.code.toUpperCase()];
    if (byCode) return byCode;
  }

  const replyCode =
    typeof e.responseCode === "number" && Number.isFinite(e.responseCode) ? e.responseCode : null;
  const byReply = fromReplyCode(replyCode);
  if (byReply) return byReply;

  if (typeof e.message === "string") {
    const byMessage = fromMessage(e.message);
    if (byMessage) return byMessage;
  }

  return "UNKNOWN";
}

/**
 * The failure for a configuration that is not complete enough to try.
 *
 * Its own constructor rather than a `classifyMailError(new Error(...))`,
 * because there is no error: nothing was attempted. `missing` names the
 * fields, which is the one detail that makes the message actionable, and every
 * one of those names is a field label from this codebase rather than anything
 * a remote server said.
 */
export function incompleteConfiguration(missing: string[]): MailFailure {
  return {
    category: "CONFIGURATION",
    message: missing.length
      ? `Die E-Mail-Konfiguration ist unvollständig: ${missing.join(", ")} fehlt bzw. fehlen.`
      : COPY.CONFIGURATION,
  };
}
