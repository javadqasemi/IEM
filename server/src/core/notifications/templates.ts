import type { NotificationSeverity } from "@prisma/client";

/**
 * What a notification looks like as an e-mail.
 *
 * **One renderer, in code, for every type.** Not a template per notification
 * and not a table of templates an administrator edits:
 *
 * - *Per type* would be ten near-identical files that drift, and the drift is
 *   invisible — nobody reads all ten, so the one with the missing link stays
 *   broken until somebody clicks it.
 * - *In the database* is an injection surface with a support burden attached,
 *   and nothing yet needs an editor. The brief says templates are versionable
 *   in code initially and it is right; a table can come later without any
 *   caller changing, because this function is the seam.
 *
 * **Plain text, like every other message this system sends.** `MailService`
 * has always sent text and says why: these are transactional notes, text is
 * readable in every client, it has no images to block and it cannot carry a
 * tracking pixel. A notification is not a newsletter.
 *
 * ---
 *
 * ## What is deliberately not in here
 *
 * No password, no MFA secret, no recovery code, no token, no stack trace.
 * That is not a convention this file follows by habit — the **input type has
 * nowhere to put one**. `NotificationEmail` takes a title, a body, a severity
 * and a link, all of which are already in the `Notification` row and all of
 * which have already been through the catalogue. A caller that wanted to
 * smuggle a secret into an e-mail would have to change this signature, which
 * is a change a reviewer sees.
 *
 * The link is a dashboard route, so even the destination discloses nothing to
 * somebody who cannot sign in.
 */

export type NotificationEmail = {
  subject: string;
  text: string;
};

export type EmailInput = {
  title: string;
  body: string | null;
  severity: NotificationSeverity;
  /** A hash route such as `#/freigaben`, or `null` for nothing to open. */
  link: string | null;
  /** The dashboard's base URL, so the link is clickable in a mail client. */
  adminUrl: string;
  /** Who caused it, where that is known and worth saying. */
  actorName: string | null;
  /** The firm, for the sign-off. */
  organisation: string;
};

/**
 * The subject prefix, and the only place severity changes the wording.
 *
 * `INFO` and `SUCCESS` get none: prefixing every message with `[Info]` trains
 * people to ignore the prefix, which costs exactly the two that matter. A
 * subject line is also the one part of an e-mail that is read in a list of
 * forty, so the prefix has to be worth the characters it takes.
 */
const PREFIX: Record<NotificationSeverity, string> = {
  INFO: "",
  SUCCESS: "",
  WARNING: "Hinweis: ",
  CRITICAL: "Wichtig: ",
};

export function renderNotificationEmail(input: EmailInput): NotificationEmail {
  const lines: string[] = ["Guten Tag", "", input.title];

  if (input.body) lines.push("", input.body);

  /*
    Who did it, on its own line and only when it is somebody else.

    `actorName` is null for anything the system did to itself — a failed job,
    a scheduled publish — and writing "Ausgelöst von: System" there is a line
    that says nothing. It is also null for an applicant, who has no account.
  */
  if (input.actorName) lines.push("", `Ausgelöst von: ${input.actorName}`);

  if (input.link) {
    lines.push("", "Im Dashboard öffnen:", `${input.adminUrl}${input.link}`);
  }

  lines.push(
    "",
    "—",
    /*
      How to stop receiving it, in the message itself.

      Not a courtesy: a notification e-mail with no visible way off is one
      people deal with by filtering the sender, which silently takes the
      security messages with it. The mandatory ones cannot be switched off
      in-app and this line is about the *e-mail*, which can.
    */
    `E-Mail-Benachrichtigungen einstellen: ${input.adminUrl}#/benachrichtigungen/einstellungen`,
    "",
    input.organisation,
  );

  return {
    subject: `${PREFIX[input.severity]}${input.title}`,
    text: lines.join("\n"),
  };
}
