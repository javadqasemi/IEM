import { Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import { classifyMailError, incompleteConfiguration } from "./mail.failure";
import type {
  MailMessage,
  MailProvider,
  MailProviderConfig,
  MailProviderDescription,
  MailSendResult,
  MailSender,
  MailVerifyResult,
} from "./mail.provider";

/**
 * SMTP, through nodemailer.
 *
 * **The only file in the application allowed to import nodemailer**, and
 * `architecture.test.ts` asserts it. That is the whole value of the interface
 * next door: the library's error shapes, option names and `verify()` semantics
 * stop here, and everything upstream speaks `MailSendResult` and
 * `MailFailure`.
 *
 * ---
 *
 * ## Not a Nest provider
 *
 * Constructed by `MailService` with a resolved configuration rather than
 * injected, because the configuration is **read per send** — an operator who
 * changes the SMTP host in the dashboard gets it on the next message rather
 * than on the next restart. An injected singleton would have to be told to
 * rebuild itself, which is the design that made the settings form configure
 * nothing before P1-4.
 *
 * `MailService` caches the instance and only rebuilds when the resolved
 * configuration actually changes, so the per-send read costs one indexed query
 * and not a TCP handshake.
 */
export class SmtpProvider implements MailProvider {
  private readonly logger = new Logger(SmtpProvider.name);
  private transport: nodemailer.Transporter | null = null;

  constructor(private readonly config: MailProviderConfig) {}

  get configured(): boolean {
    return this.config.host.trim() !== "";
  }

  describe(): MailProviderDescription {
    return {
      kind: "SMTP",
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      // A boolean, never the pair. See `MailProviderDescription`.
      hasCredentials: Boolean(this.config.user && this.config.password),
    };
  }

  /**
   * What is missing before anything can be attempted.
   *
   * Only the host is genuinely required — a relay on the local network
   * frequently takes no credentials at all, and refusing to try without a
   * username would make an ordinary configuration impossible. A *username with
   * no password* is the one combination that is always a mistake, because it
   * means somebody filled in half the pair.
   */
  private missing(): string[] {
    const missing: string[] = [];
    if (!this.config.host.trim()) missing.push("SMTP-Server");
    if (this.config.user && !this.config.password) missing.push("SMTP-Passwort");
    return missing;
  }

  private build(): nodemailer.Transporter {
    if (this.transport) return this.transport;
    this.transport = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: this.config.user ? { user: this.config.user, pass: this.config.password } : undefined,
      /*
        Bounded on all three phases.

        Without these nodemailer inherits the OS socket timeout, which on a
        silently-dropping firewall is minutes — long enough for the durable job
        to look hung and for an operator pressing "Verbindung testen" to
        conclude the dashboard is broken. A `TIMEOUT` classification after a
        few seconds is a far more useful answer than a correct one nobody waits
        for.
      */
      connectionTimeout: this.config.timeoutMs,
      greetingTimeout: this.config.timeoutMs,
      socketTimeout: this.config.timeoutMs,
    });
    return this.transport;
  }

  async send(message: MailMessage, sender: MailSender): Promise<MailSendResult> {
    const missing = this.missing();
    if (!this.configured) {
      return {
        status: "skipped",
        reason: "Kein SMTP-Server konfiguriert — die Nachricht wurde protokolliert.",
      };
    }
    if (missing.length) {
      return {
        status: "failed",
        failure: incompleteConfiguration(missing),
        durationMs: 0,
      };
    }

    const started = Date.now();
    try {
      const info = await this.build().sendMail({
        from: `"${sender.name}" <${sender.address}>`,
        replyTo: sender.replyTo ?? undefined,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      return {
        status: "sent",
        /*
          The provider's own id for the message, which is the only handle an
          operator has when asking a mail administrator "did you receive this".
          It identifies a transaction, not a recipient, and discloses nothing.
        */
        messageId: typeof info.messageId === "string" ? info.messageId : null,
        acceptedBy: this.config.host,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return { status: "failed", failure: this.report(err, "Versand"), durationMs: Date.now() - started };
    }
  }

  /**
   * DNS, TCP, TLS and AUTH — and no message.
   *
   * `verify()` opens a connection, completes the handshake, issues `AUTH` if
   * credentials are configured, and hangs up. That is the half of "is mail
   * working" an operator can check without putting anything in anybody's
   * inbox, which is what makes it safe to offer as a button they press
   * repeatedly while editing the form.
   */
  async verify(): Promise<MailVerifyResult> {
    if (!this.configured) {
      return {
        status: "unconfigured",
        reason: "Kein SMTP-Server konfiguriert.",
      };
    }
    const missing = this.missing();
    if (missing.length) {
      return { status: "failed", failure: incompleteConfiguration(missing), durationMs: 0 };
    }

    const started = Date.now();
    try {
      await this.build().verify();
      return {
        status: "connected",
        describedAs: `${this.config.host}:${this.config.port}`,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        status: "failed",
        failure: this.report(err, "Verbindungstest"),
        durationMs: Date.now() - started,
      };
    }
  }

  close(): void {
    this.transport?.close();
    this.transport = null;
  }

  /**
   * Classifies for the caller, logs the raw text for the operator.
   *
   * **The two halves go to different places on purpose.** The raw message is
   * the most useful thing a server administrator can read and the least safe
   * thing to return — it can carry the username, the host, the AUTH mechanism
   * and the server's echo of a failed command. The server log's reader is
   * already an operator with shell access; the audit log's reader is not, and
   * the browser's reader may be neither.
   */
  private report(err: unknown, what: string) {
    const failure = classifyMailError(err);
    this.logger.warn(
      `${what} über ${this.config.host}:${this.config.port} fehlgeschlagen ` +
        `[${failure.category}]: ${(err as Error)?.message ?? String(err)}`,
    );
    return failure;
  }
}
