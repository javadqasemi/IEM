import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import type { JobApplication } from "@prisma/client";

/**
 * Outgoing mail.
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
  private transport: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = config.get<string>("SMTP_HOST");
    if (!host) {
      this.logger.warn(
        "SMTP_HOST ist nicht gesetzt — E-Mails werden protokolliert statt versendet.",
      );
      return;
    }
    this.transport = nodemailer.createTransport({
      host,
      port: Number(config.get("SMTP_PORT") ?? 587),
      secure: config.get("SMTP_SECURE") === "true",
      auth: config.get<string>("SMTP_USER")
        ? { user: config.getOrThrow<string>("SMTP_USER"), pass: config.getOrThrow<string>("SMTP_PASSWORD") }
        : undefined,
    });
  }

  private get from(): string {
    const address = this.config.get<string>("MAIL_FROM") ?? "noreply@iem.ch";
    const name = this.config.get<string>("MAIL_FROM_NAME") ?? "IEM AG";
    return `"${name}" <${address}>`;
  }

  private get adminUrl(): string {
    return this.config.get<string>("ADMIN_URL") ?? "http://localhost:5173/admin.html";
  }

  private async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.transport) {
      this.logger.log(`[mail:stub] an ${to} — ${subject}\n${text}`);
      return;
    }
    try {
      await this.transport.sendMail({ from: this.from, to, subject, text });
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
