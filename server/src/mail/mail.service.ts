import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import type { JobApplication } from "@prisma/client";
import { SettingsService } from "../core/settings/settings.service";

/** The keys this service reads, in one place so the group read below is honest. */
const MAIL_KEYS = [
  "mail.smtpHost",
  "mail.smtpPort",
  "mail.smtpUser",
  "mail.smtpPassword",
  "mail.smtpSecure",
  "mail.from",
  "mail.fromName",
  "company.name",
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

    const company = typeof stored["company.name"] === "string" ? (stored["company.name"] as string) : "";
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

  /** To IEM: a new application has arrived. */
  sendApplicationNotice(to: string, application: JobApplication): Promise<void> {
    const files = (application.files as unknown as { originalName: string }[]) ?? [];
    return this.send(
      to,
      `Neue Bewerbung: ${application.position}`,
      [
        `Position:      ${application.position}`,
        `Name:          ${application.firstName} ${application.lastName}`,
        `E-Mail:        ${application.email}`,
        `Telefon:       ${application.phone ?? "—"}`,
        `Verfügbar ab:  ${application.availableFrom ?? "—"}`,
        "",
        "Nachricht:",
        application.message || "(keine)",
        "",
        `Anhänge (${files.length}):`,
        ...(files.length ? files.map((f) => `  · ${f.originalName}`) : ["  (keine)"]),
        "",
        `Im Dashboard öffnen: ${this.adminUrl}#/bewerbungen/${application.id}`,
      ].join("\n"),
    );
  }

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

  sendReviewRequest(to: string, entryLabel: string, requestedBy: string): Promise<void> {
    return this.send(
      to,
      `Freigabe angefragt: ${entryLabel}`,
      [
        `${requestedBy} hat „${entryLabel}“ zur Freigabe eingereicht.`,
        "",
        `Zur Prüfung: ${this.adminUrl}#/freigaben`,
        "",
        "IEM AG",
      ].join("\n"),
    );
  }
}
