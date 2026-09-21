/**
 * What a mail provider is, and what every caller is allowed to know about one.
 *
 * SMTP is the first and the only one built. The interface exists now rather
 * than when the second arrives because of where the coupling would otherwise
 * settle: `nodemailer` was imported directly into `MailService`, so its error
 * shapes, its option names and its `verify()` semantics were the vocabulary
 * the notification platform and the settings screen ended up speaking. Adding
 * Microsoft 365 or SES later would then have meant translating a second
 * provider *into nodemailer's idiom*, which is how an abstraction ends up
 * shaped like whichever implementation came first.
 *
 * ---
 *
 * ## The rule this file enforces
 *
 * **Nothing provider-specific crosses this boundary.** No `SMTPError`, no
 * `err.responseCode`, no nodemailer types in a signature. A provider returns
 * `MailSendResult` or `MailVerifyResult`, both of which are made of the
 * classification in `mail.failure.ts` and strings this application wrote. That
 * is what lets `NotificationDelivery.detail`, the settings screen and the
 * audit log all carry the same sanitized vocabulary.
 *
 * ## What is deliberately not here
 *
 * No template, no recipient policy, no retry. A provider transmits one message
 * and reports what happened. Retries are `core/jobs`, recipients are
 * `core/notifications`, and wording is `templates.ts` — three things that
 * would each be duplicated per provider if they leaked in here.
 */

import type { MailFailure } from "./mail.failure";

/** One message, already rendered. A provider never composes. */
export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

/** Who the message claims to be from, resolved from settings or environment. */
export type MailSender = {
  address: string;
  name: string;
  /** `Reply-To`, when the firm answers at a different address than it sends from. */
  replyTo: string | null;
};

/**
 * What a provider is configured with.
 *
 * Deliberately flat and provider-neutral in its *names*: `host`/`port`/`secure`
 * happen to be SVG-shaped for SMTP, and an API-key provider will add its own
 * optional fields rather than renaming these. `password` is here because a
 * provider needs it; it is the one field that must never be echoed back, and
 * `describe()` below is what guarantees that.
 */
export type MailProviderConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  /** Milliseconds before a connection or handshake is abandoned. */
  timeoutMs: number;
};

/**
 * Three outcomes, never two.
 *
 * `skipped` is the state of a fresh install and of every developer machine —
 * the message was written to the log because no provider is configured — and
 * it is neither a delivery nor a fault. Collapsing it into `failed` is what
 * would put every development queue into a retry loop and every operator's
 * dashboard behind a wall of amber; collapsing it into `sent` would make the
 * whole delivery table a row of successes that mean nothing.
 */
export type MailSendResult =
  | { status: "sent"; messageId: string | null; acceptedBy: string; durationMs: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; failure: MailFailure; durationMs: number };

/**
 * Whether the provider can be reached and authenticated, **without sending**.
 *
 * A separate operation from a test message on purpose, because they answer
 * different questions and fail in different places: `verify` covers DNS, TCP,
 * TLS and AUTH, and a test send additionally covers the sender identity, the
 * recipient's acceptance and the template. An operator who has just typed a
 * password wants the first; one debugging "nothing arrives" wants the second.
 */
export type MailVerifyResult =
  | { status: "connected"; describedAs: string; durationMs: number }
  | { status: "unconfigured"; reason: string }
  | { status: "failed"; failure: MailFailure; durationMs: number };

/**
 * What a provider tells the outside world about itself.
 *
 * **Has no field a credential could occupy**, which is the same technique
 * `EmailInput` in `templates.ts` uses: the way to guarantee a password is
 * never rendered into a status panel is to give the status panel's type
 * nowhere to put one. `hasCredentials` is the boolean that replaces it.
 */
export type MailProviderDescription = {
  /** `"SMTP"` today. A label for an operator, not a discriminant to branch on. */
  kind: string;
  host: string;
  port: number;
  secure: boolean;
  /** Whether a username and password are configured — never which. */
  hasCredentials: boolean;
};

export interface MailProvider {
  describe(): MailProviderDescription;
  /** Whether enough is configured to attempt anything at all. */
  readonly configured: boolean;
  send(message: MailMessage, sender: MailSender): Promise<MailSendResult>;
  verify(): Promise<MailVerifyResult>;
  /** Releases pooled sockets when a configuration is superseded. */
  close(): void;
}
