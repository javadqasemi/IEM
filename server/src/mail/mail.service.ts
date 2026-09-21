import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import type { JobApplication } from "@prisma/client";
import { SettingsService } from "../core/settings/settings.service";
import { OrganisationService } from "../core/organisation/organisation.service";

/**
 * The keys this service reads, in one place so the group read below is honest.
 *
 * `company.name` used to be the eighth. It is now a **column** on
 * `Organisation` and comes from `OrganisationService.identity()` — the firm's
 * name is a property of the firm, not a string under a settings key, and it
 * was one of the eight `company.*`/`brand.*` rows that nothing but this line
 * ever read.
 */
const MAIL_KEYS = [
  "mail.smtpHost",
  "mail.smtpPort",
  "mail.smtpUser",
  "mail.smtpPassword",
  "mail.smtpSecure",
  "mail.from",
  "mail.fromName",
];

type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
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
  private transport: nodemailer.Transporter | null = null;
  private transportKey = "";
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

    return {
      host: str("mail.smtpHost", "SMTP_HOST"),
      port: Number.isFinite(port) && port > 0 ? port : Number(this.config.get("SMTP_PORT") ?? 587),
      secure:
        typeof secure === "boolean" ? secure : this.config.get("SMTP_SECURE") === "true",
      user: str("mail.smtpUser", "SMTP_USER"),
      pass: str("mail.smtpPassword", "SMTP_PASSWORD"),
      from: str("mail.from", "MAIL_FROM", "noreply@iem.ch"),
      fromName: str("mail.fromName", "MAIL_FROM_NAME", company || "IEM AG"),
    };
  }

  /** The transport for a configuration, rebuilt only when that changes. */
  private transportFor(mail: MailConfig): nodemailer.Transporter | null {
    if (!mail.host) {
      this.transport = null;
      this.transportKey = "";
      return null;
    }

    const key = `${mail.host}:${mail.port}:${mail.secure}:${mail.user}:${mail.pass}`;
    if (this.transport && key === this.transportKey) return this.transport;

    // `close()` on the superseded transport, or its pooled sockets stay open for
    // a host nothing will send to again.
    this.transport?.close();
    this.transport = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.secure,
      auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
    });
    this.transportKey = key;
    return this.transport;
  }

  private get adminUrl(): string {
    return this.config.get<string>("ADMIN_URL") ?? "http://localhost:5173/admin.html";
  }

  private async send(to: string, subject: string, text: string): Promise<void> {
    const mail = await this.resolve();
    const transport = this.transportFor(mail);

    if (!transport) {
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

    try {
      await transport.sendMail({
        from: `"${mail.fromName}" <${mail.from}>`,
        to,
        subject,
        text,
      });
    } catch (err) {
      // Logged, never rethrown — see the note at the top of the class.
      this.logger.error(`Versand an ${to} fehlgeschlagen: ${(err as Error).message}`);
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
  async sendTest(to: string): Promise<{ ok: boolean; stub: boolean; host: string; error?: string }> {
    const mail = await this.resolve();
    const transport = this.transportFor(mail);
    const body = [
      "Diese Nachricht ist ein Test aus dem IEM-Dashboard.",
      "",
      `Absender:  "${mail.fromName}" <${mail.from}>`,
      `Server:    ${mail.host || "— keiner konfiguriert —"}:${mail.port}`,
      `TLS:       ${mail.secure ? "ab Verbindungsaufbau" : "STARTTLS oder keine"}`,
      "",
      "Kommt sie an, ist der Versand korrekt eingerichtet.",
    ].join("\n");

    if (!transport) {
      this.logger.log(`[mail:stub] Test an ${to}\n${body}`);
      return { ok: false, stub: true, host: "" };
    }

    try {
      await transport.sendMail({
        from: `"${mail.fromName}" <${mail.from}>`,
        to,
        subject: "Testnachricht — IEM Dashboard",
        text: body,
      });
      return { ok: true, stub: false, host: mail.host };
    } catch (err) {
      const error = (err as Error).message;
      this.logger.warn(`Test-Versand an ${to} fehlgeschlagen: ${error}`);
      return { ok: false, stub: false, host: mail.host, error };
    }
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
  ): Promise<{ ok: boolean; stub: boolean; error?: string }> {
    const mail = await this.resolve();
    const transport = this.transportFor(mail);

    if (!transport) {
      this.logger.log(`[mail:stub] an ${to} — ${subject}\n${text}`);
      return { ok: false, stub: true };
    }

    try {
      await transport.sendMail({
        from: `"${mail.fromName}" <${mail.from}>`,
        to,
        subject,
        text,
      });
      return { ok: true, stub: false };
    } catch (err) {
      const error = (err as Error).message;
      this.logger.warn(`Benachrichtigung an ${to} fehlgeschlagen: ${error}`);
      return { ok: false, stub: false, error };
    }
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
