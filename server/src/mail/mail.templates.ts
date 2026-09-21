/**
 * The catalogue of messages this application can send, and the one renderer
 * per message.
 *
 * ---
 *
 * ## Why templates are code
 *
 * The brief's own instruction, and it is right for a reason worth writing
 * down rather than merely obeying: a template is a place where a **variable
 * meets a string**, and the two failure modes of a database-backed template
 * system are that an editor can reference a variable that does not exist
 * (producing `{{user.password}}` or a blank where a name should be) and that
 * an editor can be socially engineered into writing a convincing sentence next
 * to a real link. Neither is a hypothetical for a system whose messages
 * include "your second factor was removed".
 *
 * In code, the variables a template may use are its **parameter type**, so a
 * reference to something that does not exist is a compile error rather than a
 * support ticket. `templates.test.ts` covers the rendering; the type covers
 * the rest.
 *
 * ## Plain text, everywhere
 *
 * `MailService` has always sent text, and `core/notifications/templates.ts`
 * says why: these are transactional notes, text renders in every client, it
 * has no images to block and it cannot carry a tracking pixel. It also means
 * **the entire class of HTML-injection questions does not arise** — there is
 * no markup to escape, no URL scheme to allowlist and no script to strip. That
 * is not laziness; it is the reason a notification platform can be reviewed in
 * an afternoon.
 *
 * If HTML is ever genuinely needed, it arrives as a second renderer beside
 * these with an explicit escaping pass, and the decision is visible in a diff.
 *
 * ## Where the notification templates are
 *
 * `core/notifications/templates.ts` renders the ten notification types and
 * stays there: it belongs to the platform that decides who is told what.
 * This file holds the messages `MailService` sends on its own account — the
 * ones whose recipient is not a dashboard user, plus the diagnostic probe.
 * `mailTemplateCatalogue()` lists both, because an operator asking "what can
 * this system send me" does not care which module owns the string.
 */

import { renderNotificationEmail } from "../core/notifications/templates";
import { NOTIFICATION_TYPES } from "../core/notifications/catalogue";

export type RenderedMail = {
  subject: string;
  text: string;
};

/* ================================================================== */
/* The diagnostic probe                                                */
/* ================================================================== */

/**
 * What the test message says.
 *
 * **Every value in it is configuration, not input.** There is no subject
 * parameter and no body parameter anywhere in the chain from the controller to
 * here, which is what stops `POST /settings/mail/test` becoming an
 * authenticated way to send arbitrary mail as the firm. The most an
 * administrator can cause is this note, to one address, three times a minute.
 *
 * It restates the configuration it was sent with, because the question the
 * reader is actually asking is "did it arrive *and* was it sent the way I
 * think" — and a message that only said "test" would answer half of it.
 *
 * The password is not among the fields, and `TestEmailInput` has nowhere to
 * put one.
 */
export type TestEmailInput = {
  to: string;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  fromName: string;
  replyTo: string | null;
};

export function renderTestEmail(input: TestEmailInput): RenderedMail & { to: string } {
  const lines = [
    "Diese Nachricht ist ein Test aus dem IEM-Dashboard.",
    "",
    `Absender:  "${input.fromName}" <${input.from}>`,
    `Server:    ${input.host || "— keiner konfiguriert —"}:${input.port}`,
    `TLS:       ${input.secure ? "ab Verbindungsaufbau" : "STARTTLS oder keine"}`,
  ];
  if (input.replyTo) lines.push(`Antwort an: ${input.replyTo}`);
  lines.push(
    "",
    "Kommt sie an, ist der Versand korrekt eingerichtet.",
    "",
    "Diese Nachricht wurde manuell in den Einstellungen ausgelöst.",
    "Es handelt sich nicht um eine Benachrichtigung zu einem Vorgang.",
  );

  return {
    to: input.to,
    subject: "Testnachricht — IEM Dashboard",
    text: lines.join("\n"),
  };
}

/* ================================================================== */
/* The catalogue                                                       */
/* ================================================================== */

export type MailTemplateCategory = "Diagnose" | "Konto" | "Bewerbungen" | "Benachrichtigungen";

export type MailTemplateSummary = {
  key: string;
  label: string;
  category: MailTemplateCategory;
  description: string;
  /**
   * The variables this template renders, by name.
   *
   * Declared rather than parsed out of the body, because the body is a
   * TypeScript expression and there is no token syntax to parse. It is what
   * the preview screen lists so an operator can see what a message will carry
   * before anybody receives one.
   */
  variables: string[];
  /** Whether a recipient can switch it off. Only notifications can be. */
  optional: boolean;
};

/**
 * Every message the application can put in somebody's inbox.
 *
 * Assembled from two sources rather than hand-listed: the notification types
 * come from `core/notifications/catalogue.ts`, so a type added there appears
 * here without anybody remembering to. That is the same agreement
 * `notifications.agreement.test.ts` enforces in the other direction, and
 * `mail.templates.test.ts` checks the count matches.
 */
export function mailTemplateCatalogue(): MailTemplateSummary[] {
  const standalone: MailTemplateSummary[] = [
    {
      key: "diagnostic.test",
      label: "Testnachricht",
      category: "Diagnose",
      description:
        "Die feste Diagnosenachricht, die „Testnachricht senden“ verschickt. Inhalt und Betreff sind nicht veränderbar.",
      variables: ["host", "port", "secure", "from", "fromName", "replyTo"],
      optional: false,
    },
    {
      key: "account.passwordReset",
      label: "Passwort zurücksetzen",
      category: "Konto",
      description:
        "Der Link zum Setzen eines neuen Passworts. Geht an Personen, die sich gerade nicht anmelden können — deshalb keine Benachrichtigung.",
      variables: ["link"],
      optional: false,
    },
    {
      key: "account.invite",
      label: "Einladung ins Dashboard",
      category: "Konto",
      description:
        "Der Link, mit dem ein neues Konto sein Passwort setzt. Die empfangende Person ist noch kein Dashboard-Benutzer.",
      variables: ["name", "link"],
      optional: false,
    },
    {
      key: "applications.confirmation",
      label: "Eingangsbestätigung Bewerbung",
      category: "Bewerbungen",
      description:
        "An die bewerbende Person. Macht den Satz „Eine Bestätigung geht an …“ auf der Website wahr.",
      variables: ["firstName", "lastName", "position", "fileCount"],
      optional: false,
    },
  ];

  const notifications: MailTemplateSummary[] = NOTIFICATION_TYPES.map((def) => ({
    key: `notification.${def.key}`,
    label: def.label,
    category: "Benachrichtigungen" as const,
    description: def.description,
    variables: ["title", "body", "actorName", "link", "organisation"],
    // A mandatory notification's in-app copy cannot be switched off; its
    // e-mail copy always can, which is what this column is about.
    optional: true,
  }));

  return [...standalone, ...notifications];
}

/**
 * A worked example of one template, for the preview screen.
 *
 * **Renders with sample values and sends nothing** — the brief's requirement,
 * and the obvious implementation (send it to the administrator and let them
 * look) is wrong for a reason worth stating: previewing "Ihr zweiter Faktor
 * wurde zurückgesetzt" by actually mailing it produces a security alert that
 * is a lie, in the one category of message where a false alarm costs the most.
 *
 * Returns `null` for a key that does not exist rather than throwing, because
 * the caller is a route with an id in it and a 404 is the right answer.
 */
export function previewMailTemplate(key: string, organisation: string, adminUrl: string): RenderedMail | null {
  if (key === "diagnostic.test") {
    const { subject, text } = renderTestEmail({
      to: "name@example.ch",
      host: "smtp.example.ch",
      port: 587,
      secure: false,
      from: "noreply@example.ch",
      fromName: organisation,
      replyTo: null,
    });
    return { subject, text };
  }

  if (key === "account.passwordReset") {
    return {
      subject: "Passwort zurücksetzen — IEM Dashboard",
      text: SAMPLE_PASSWORD_RESET(adminUrl, organisation),
    };
  }

  if (key === "account.invite") {
    return {
      subject: "Ihr Zugang zum IEM-Dashboard",
      text: SAMPLE_INVITE(adminUrl, organisation),
    };
  }

  if (key === "applications.confirmation") {
    return {
      subject: "Ihre Bewerbung ist bei uns angekommen",
      text: SAMPLE_APPLICATION(organisation),
    };
  }

  if (key.startsWith("notification.")) {
    const type = key.slice("notification.".length);
    const def = NOTIFICATION_TYPES.find((d) => d.key === type);
    if (!def) return null;
    return renderNotificationEmail({
      title: def.label,
      body: def.description,
      severity: def.severity,
      link: "#/benachrichtigungen",
      adminUrl,
      actorName: def.recipients.kind === "subject" ? "Administrator" : "Beispiel Person",
      organisation,
    });
  }

  return null;
}

/*
  The three standalone bodies, as sample text.

  Deliberately *near-copies* of the real ones in `mail.service.ts` rather than
  the real ones extracted and shared — and that is a trade made with open eyes.
  Sharing them would mean the send path taking a "sample mode" parameter, which
  is a branch inside the function that actually mails somebody, in a file where
  every branch is a chance to send the wrong thing. `mail.templates.test.ts`
  asserts the subjects match, which is the part a reader compares.
*/
const SAMPLE_PASSWORD_RESET = (adminUrl: string, organisation: string) =>
  [
    "Guten Tag",
    "",
    "Für Ihr Konto im IEM-Dashboard wurde ein neues Passwort angefordert.",
    "Über den folgenden Link können Sie eines setzen:",
    "",
    `${adminUrl}#/passwort-zuruecksetzen?token=BEISPIEL-TOKEN`,
    "",
    "Der Link ist eine Stunde gültig und kann einmal verwendet werden.",
    "Haben Sie das nicht angefordert, können Sie diese Nachricht ignorieren —",
    "Ihr bisheriges Passwort bleibt unverändert gültig.",
    "",
    organisation,
  ].join("\n");

const SAMPLE_INVITE = (adminUrl: string, organisation: string) =>
  [
    "Guten Tag Beispiel Person",
    "",
    "Für Sie wurde ein Zugang zum IEM-Dashboard eingerichtet.",
    "Über den folgenden Link setzen Sie Ihr Passwort und melden sich an:",
    "",
    `${adminUrl}#/einladung?token=BEISPIEL-TOKEN`,
    "",
    "Der Link ist sieben Tage gültig.",
    "",
    organisation,
  ].join("\n");

const SAMPLE_APPLICATION = (organisation: string) =>
  [
    "Guten Tag Beispiel Person",
    "",
    "Ihre Bewerbung für „Sanitärplaner/in“ ist bei uns eingegangen.",
    "Wir haben 2 Datei(en) erhalten: Lebenslauf.pdf, Zeugnisse.pdf.",
    "",
    "Wir melden uns innert weniger Tage bei Ihnen.",
    "",
    "Freundliche Grüsse",
    organisation,
  ].join("\n");
