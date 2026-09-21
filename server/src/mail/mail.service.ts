import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { JobApplication } from "@prisma/client";
import { SettingsService } from "../core/settings/settings.service";
import { OrganisationService } from "../core/organisation/organisation.service";
import { SmtpProvider } from "./smtp.provider";
import type {
  MailProvider,
  MailProviderConfig,
  MailProviderDescription,
  MailSendResult,
  MailSender,
  MailVerifyResult,
} from "./mail.provider";
import { renderTestEmail } from "./mail.templates";
import type { MailFailureCategory } from "./mail.failure";

/** When `mail.timeoutSeconds` says nothing. Short enough to answer a button. */
const DEFAULT_TIMEOUT_SECONDS = 10;

/**
 * What the probe reports, and the reason it is not a boolean.
 *
 * `stub` is a third outcome beside success and failure — "no SMTP server is
 * configured, the message was written to the log" is true, useful, and not a
 * fault. `category` is the sanitized classification and `error` its
 * operator-readable sentence; neither is ever the provider's own text.
 */
export type MailTestOutcome = {
  ok: boolean;
  stub: boolean;
  host: string;
  durationMs: number;
  messageId?: string | null;
  category?: MailFailureCategory;
  error?: string;
};

/**
 * The keys this service reads, in one place so the group read below is honest.
 *
 * `company.name` used to be the eighth. It is now a **column** on
 * `Organisation` and comes from `OrganisationService.identity()` — the firm's
 * name is a property of the firm, not a string under a settings key, and it
 * was one of the eight `company.*`/`brand.*` rows that nothing but this line
 * ever read.
 *
 * `mail.smtpPassword` is among them and comes back **decrypted**:
 * `SettingsService.values` runs it through `SecretSettingsService`, and an
 * unreadable one is simply absent from the result — which the fallback chain
 * below already treats as "not configured", the correct behaviour for a
 * credential that cannot be decrypted.
 */
const MAIL_KEYS = [
  "mail.smtpHost",
  "mail.smtpPort",
  "mail.smtpUser",
  "mail.smtpPassword",
  "mail.smtpSecure",
  "mail.from",
  "mail.fromName",
  "mail.replyTo",
  "mail.timeoutSeconds",
];

type MailConfig = MailProviderConfig & {
  from: string;
  fromName: string;
  replyTo: string;
};

/**
 * Outgoing mail.
 *
 * **Configured from the dashboard, with the environment as the fallback.** It
 * used to be environment-only, built once in the constructor — which meant the
 * dashboard's whole SMTP form configured nothing, and an operator who filled it
 * in and found mail still not sending had no way to tell why. A setting that is
 * left blank still defers to `SMTP_*`, so an existing deployment is unchanged
 * and a container can keep its secrets out of the database.
 *
 * The settings are read **per send** rather than cached. That is one indexed
 * read of eight rows against a volume of a few messages a day, and it buys the
 * property the old design lacked: changing the SMTP host in the dashboard takes
 * effect on the next message rather than on the next restart. The transport is
 * still only rebuilt when the resolved configuration actually changes.
 *
 * **Degrades to logging rather than throwing.** With no SMTP host configured
 * — which is the state of a fresh install and of every developer machine —
 * every send writes the message to the process log and returns. That matters
 * because two callers cannot afford to fail: a stored job application must not
 * be lost because the mail server is down, and inviting a user must not roll
 * back because a relay refused. Where the recipient genuinely needs the mail
 * (a password reset), the token is in the log and an administrator can hand
 * it over.
 *
 * Every message is sent as plain text. These are transactional notes, not
 * marketing: text is readable in every client, has no images to block, and
 * cannot carry a tracking pixel.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  /** Rebuilt only when `resolve()` returns something different from last time. */
  private provider: MailProvider | null = null;
  private providerKey = "";
  /** Logged once per distinct state, so a stubbed install does not flood the log. */
  private announced = "";

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly organisation: OrganisationService,
  ) {}

  /**
   * The effective mail configuration: dashboard setting, else environment, else
   * a sane default.
   *
   * Falls back to the environment on a *blank* setting rather than only on a
   * missing one — an operator clearing the SMTP host means "use the deployment's
   * value", not "send to an empty host".
   */
  private async resolve(): Promise<MailConfig> {
    let stored: Record<string, unknown> = {};
    try {
      stored = await this.settings.values(MAIL_KEYS);
    } catch (err) {
      // The database being unreachable must not stop a password-reset mail that
      // the environment alone could have sent.
      this.logger.warn(`Mail-Einstellungen nicht lesbar, Umgebung wird verwendet: ${(err as Error).message}`);
    }

    const str = (key: string, envKey: string, fallback = ""): string => {
      const value = stored[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      return this.config.get<string>(envKey) ?? fallback;
    };

    /*
      The sender name, when the mail settings do not give one.

      Wrapped, for the same reason the settings read above is: the database
      being unreachable must not stop a password-reset mail the environment
      alone could have sent.
    */
    let company = "";
    try {
      company = (await this.organisation.identity()).name;
    } catch (err) {
      this.logger.warn(
        `Unternehmensname nicht lesbar, Umgebung wird verwendet: ${(err as Error).message}`,
      );
    }
    const port = Number(stored["mail.smtpPort"]);
    const secure = stored["mail.smtpSecure"];
    const timeout = Number(stored["mail.timeoutSeconds"]);

    return {
      host: str("mail.smtpHost", "SMTP_HOST"),
      port: Number.isFinite(port) && port > 0 ? port : Number(this.config.get("SMTP_PORT") ?? 587),
      secure:
        typeof secure === "boolean" ? secure : this.config.get("SMTP_SECURE") === "true",
      user: str("mail.smtpUser", "SMTP_USER"),
      password: str("mail.smtpPassword", "SMTP_PASSWORD"),
      /*
        Clamped rather than trusted, the way every arithmetic setting in this
        codebase is read — a `0` here would mean "give up immediately" and make
        mail look permanently broken, and the clamp costs nothing.
      */
      timeoutMs:
        (Number.isFinite(timeout) ? Math.min(120, Math.max(1, timeout)) : DEFAULT_TIMEOUT_SECONDS) *
        1000,
      from: str("mail.from", "MAIL_FROM", "noreply@iem.ch"),
      fromName: str("mail.fromName", "MAIL_FROM_NAME", company || "IEM AG"),
      replyTo: str("mail.replyTo", "MAIL_REPLY_TO"),
    };
  }

  /** The sender identity, separated from the transport it travels over. */
  private senderFor(mail: MailConfig): MailSender {
    return {
      address: mail.from,
      name: mail.fromName,
      replyTo: mail.replyTo.trim() || null,
    };
  }

  /**
   * The provider for a configuration, rebuilt only when that changes.
   *
   * The cache key includes the password, so replacing a credential takes
   * effect on the next message without a restart — and `close()` runs on the
   * superseded provider, or its pooled sockets stay open to a host nothing
   * will send to again.
   */
  private providerFor(mail: MailConfig): MailProvider {
    const key = [
      mail.host,
      mail.port,
      mail.secure,
      mail.user,
      mail.password,
      mail.timeoutMs,
    ].join("\u0000");
    if (this.provider && key === this.providerKey) return this.provider;

    this.provider?.close();
    this.provider = new SmtpProvider(mail);
    this.providerKey = key;
    return this.provider;
  }

  /**
   * Everything the diagnostics panel is allowed to know, in one read.
   *
   * Returns the provider's own description — which has no field a credential
   * could occupy — beside the sender identity, which is not secret and is the
   * thing an operator most often needs to check.
   */
  async describe(): Promise<
    MailProviderDescription & { from: string; fromName: string; replyTo: string | null }
  > {
    const mail = await this.resolve();
    const sender = this.senderFor(mail);
    return {
      ...this.providerFor(mail).describe(),
      from: sender.address,
      fromName: sender.name,
      replyTo: sender.replyTo,
    };
  }

  /**
   * DNS, TCP, TLS and AUTH, with nothing sent.
   *
   * The operation an operator presses while still editing the form, which is
   * exactly why it must not put a message in anybody's inbox — see
   * `MailVerifyResult`.
   */
  async verifyConnection(): Promise<MailVerifyResult> {
    const mail = await this.resolve();
    return this.providerFor(mail).verify();
  }

  private get adminUrl(): string {
    return this.config.get<string>("ADMIN_URL") ?? "http://localhost:5173/admin.html";
  }

  private async send(to: string, subject: string, text: string): Promise<void> {
    const mail = await this.resolve();
    const provider = this.providerFor(mail);

    if (!provider.configured) {
      if (this.announced !== "stub") {
        this.announced = "stub";
        this.logger.warn(
          "Kein SMTP-Server konfiguriert (weder in den Einstellungen noch als SMTP_HOST) — " +
            "E-Mails werden protokolliert statt versendet.",
        );
      }
      this.logger.log(`[mail:stub] an ${to} — ${subject}\n${text}`);
      return;
    }

    if (this.announced !== mail.host) {
      this.announced = mail.host;
      this.logger.log(`E-Mail-Versand über ${mail.host}:${mail.port}.`);
    }

    const result = await provider.send({ to, subject, text }, this.senderFor(mail));
    if (result.status === "failed") {
      // Logged, never rethrown — see the note at the top of the class. The
      // sanitized category is what appears here; the provider has already
      // written the raw text to its own logger.
      this.logger.error(`Versand an ${to} fehlgeschlagen [${result.failure.category}].`);
    }
  }

  /**
   * A probe, and **the one send that is allowed to fail loudly.**
   *
   * Everything else in this class swallows a transport error on purpose: a
   * stored job application must not be lost because a relay refused. That
   * property is exactly what makes mail unprovable — a wrong password and a
   * correct one produce the same silence, and an operator who fills in the SMTP
   * form has no way to find out which they have.
   *
   * So this one returns the error rather than logging it, and reports the
   * *stub* case as a distinct outcome rather than as success: "no SMTP server
   * configured, the message was written to the log" is a true and useful
   * answer, and calling it "sent" would be a lie the form would repeat.
   */
  async sendTest(to: string): Promise<MailTestOutcome> {
    const mail = await this.resolve();
    const provider = this.providerFor(mail);
    const sender = this.senderFor(mail);
    /*
      A **fixed** message, rendered from the configuration rather than from
      anything the caller supplied.

      There is no subject parameter and no body parameter, and that is what
      keeps this endpoint from being an authenticated relay: the most an
      administrator can do with it is cause one predetermined diagnostic note
      to arrive somewhere. See `mail.templates.ts`.
    */
    const message = renderTestEmail({
      to,
      host: mail.host,
      port: mail.port,
      secure: mail.secure,
      fromName: sender.name,
      from: sender.address,
      replyTo: sender.replyTo,
    });

    if (!provider.configured) {
      this.logger.log(`[mail:stub] Test an ${to}\n${message.text}`);
      return { ok: false, stub: true, host: "", durationMs: 0 };
    }

    const result: MailSendResult = await provider.send(message, sender);
    if (result.status === "sent") {
      return {
        ok: true,
        stub: false,
        host: mail.host,
        durationMs: result.durationMs,
        messageId: result.messageId,
      };
    }
    if (result.status === "skipped") {
      return { ok: false, stub: true, host: "", durationMs: 0 };
    }
    return {
      ok: false,
      stub: false,
      host: mail.host,
      durationMs: result.durationMs,
      category: result.failure.category,
      error: result.failure.message,
    };
  }

  /**
   * The one send whose outcome the caller is told, and the channel every
   * notification e-mail goes through.
   *
   * ---
   *
   * **Why it cannot use `send` above.** That one swallows a transport error on
   * purpose, and the purpose is sound: a stored job application must not be
   * lost because a relay refused. But a `NotificationDelivery` row exists
   * precisely to record whether the message arrived, and a channel that always
   * reports success would make the whole table a row of `DELIVERED` that means
   * nothing. So this returns the outcome instead of logging it — the same
   * reasoning `sendTest` is written with, for the same reason.
   *
   * **Three outcomes, not two.** `stub` is a distinct answer from `ok: false`:
   * with no SMTP server configured the message was *written to the log*, which
   * is neither a delivery nor a failure, and the delivery row records it as
   * `SKIPPED` with a reason rather than as a fault somebody should investigate.
   * Calling a stubbed send "failed" would put every developer machine's
   * notification queue into a retry loop.
   *
   * It takes a subject and a body and nothing else. Rendering is
   * `core/notifications/templates.ts`'s job — a mail service that knew what a
   * notification was would be the second place the wording lives.
   */
  async sendNotification(
    to: string,
    subject: string,
    text: string,
  ): Promise<{
    ok: boolean;
    stub: boolean;
    error?: string;
    category?: MailFailureCategory;
    messageId?: string | null;
  }> {
    const mail = await this.resolve();
    const provider = this.providerFor(mail);

    if (!provider.configured) {
      this.logger.log(`[mail:stub] an ${to} — ${subject}\n${text}`);
      return { ok: false, stub: true };
    }

    const result = await provider.send({ to, subject, text }, this.senderFor(mail));
    if (result.status === "sent") {
      return { ok: true, stub: false, messageId: result.messageId };
    }
    if (result.status === "skipped") return { ok: false, stub: true };

    /*
      The **sanitized** message is what travels back, and it ends up in
      `NotificationDelivery.detail` — a column an operator reads in a table
      beside other people's recipients. Before P2-4 this was the raw provider
      string, which routinely names the host, the username and the AUTH
      mechanism. The raw text is in the server log, where the reader already
      has shell access.
    */
    return { ok: false, stub: false, error: result.failure.message, category: result.failure.category };
  }

  sendPasswordReset(to: string, token: string): Promise<void> {
    const link = `${this.adminUrl}#/passwort-zuruecksetzen?token=${token}`;
    return this.send(
      to,
      "Passwort zurücksetzen — IEM Dashboard",
      [
        "Guten Tag",
        "",
        "Für Ihr Konto im IEM-Dashboard wurde ein neues Passwort angefordert.",
        "Über den folgenden Link können Sie eines setzen:",
        "",
        link,
        "",
        "Der Link ist eine Stunde gültig und kann einmal verwendet werden.",
        "Haben Sie das nicht angefordert, können Sie diese Nachricht ignorieren —",
        "Ihr bisheriges Passwort bleibt unverändert gültig.",
        "",
        "IEM AG",
      ].join("\n"),
    );
  }

  sendInvite(to: string, name: string, token: string): Promise<void> {
    const link = `${this.adminUrl}#/einladung?token=${token}`;
    return this.send(
      to,
      "Ihr Zugang zum IEM-Dashboard",
      [
        `Guten Tag ${name}`,
        "",
        "Für Sie wurde ein Zugang zum IEM-Dashboard eingerichtet.",
        "Über den folgenden Link setzen Sie Ihr Passwort und melden sich an:",
        "",
        link,
        "",
        "Der Link ist sieben Tage gültig.",
        "",
        "IEM AG",
      ].join("\n"),
    );
  }

  /*
    `sendApplicationNotice` and `sendReviewRequest` stood here and are **gone**
    (P2-3).

    Both were the shape the notification platform replaces: a business fact
    turned into an e-mail, addressed from inside the service that caused it.
    The first went to a configured shared mailbox and the second to nobody at
    all — it was declared, written, and **called by no caller in the
    repository**, which is the clearest possible demonstration of why a
    per-feature mail method is the wrong seam. Nothing failed; the mail simply
    never existed.

    What replaced them is one event each — `ApplicationReceived` and
    `ContentSubmitted` — and `core/notifications`, which resolves recipients
    from a permission, applies the firm's rules and the person's preferences,
    and records what each channel did.

    What is left in this class is the correct residue: messages to people who
    are **not users of the dashboard** (an applicant, somebody being invited,
    somebody resetting a password they cannot yet sign in with) and the two
    probes. None of them has a recipient the platform could govern.
  */

  /**
   * To the applicant: confirmation of receipt.
   *
   * The site's success screen says "Eine Bestätigung geht an …". This is what
   * makes that sentence true — without it the copy would be a promise nothing
   * keeps, which is the one thing an application form must not do.
   */
  sendApplicationConfirmation(to: string, application: JobApplication): Promise<void> {
    const files = (application.files as unknown as { originalName: string }[]) ?? [];
    return this.send(
      to,
      "Ihre Bewerbung ist bei uns angekommen",
      [
        `Guten Tag ${application.firstName} ${application.lastName}`,
        "",
        `Ihre Bewerbung für „${application.position}“ ist bei uns eingegangen.`,
        files.length
          ? `Wir haben ${files.length} Datei(en) erhalten: ${files.map((f) => f.originalName).join(", ")}.`
          : "Es wurden keine Dateien übermittelt.",
        "",
        "Wir melden uns innert weniger Tage bei Ihnen.",
        "",
        "Freundliche Grüsse",
        "IEM AG",
      ].join("\n"),
    );
  }

}
