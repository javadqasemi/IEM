import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES } from "../core/notifications/catalogue";
import { mailTemplateCatalogue, previewMailTemplate, renderTestEmail } from "./mail.templates";

const ORG = "IEM AG";
const ADMIN = "https://dashboard.example.ch/admin.html";

describe("the diagnostic message", () => {
  const rendered = renderTestEmail({
    to: "someone@example.ch",
    host: "smtp.example.ch",
    port: 587,
    secure: false,
    from: "noreply@example.ch",
    fromName: ORG,
    replyTo: null,
  });

  it("restates the configuration it was sent with", () => {
    // The reader's actual question is "did it arrive *and* was it sent the way
    // I think" — a message that only said "test" would answer half of it.
    expect(rendered.text).toContain("smtp.example.ch:587");
    expect(rendered.text).toContain("noreply@example.ch");
  });

  it("says it is a manual test rather than a notification", () => {
    // Otherwise the recipient has to work out whether something happened.
    expect(rendered.text).toContain("manuell");
  });

  it("includes the reply-to only when there is one", () => {
    expect(rendered.text).not.toContain("Antwort an");
    const withReply = renderTestEmail({
      to: "someone@example.ch",
      host: "smtp.example.ch",
      port: 587,
      secure: false,
      from: "noreply@example.ch",
      fromName: ORG,
      replyTo: "info@example.ch",
    });
    expect(withReply.text).toContain("Antwort an: info@example.ch");
  });

  /**
   * The type has nowhere to put a password, which is the actual guarantee —
   * this test is the executable restatement of it. A future field called
   * `smtpPassword` on `TestEmailInput` would make this fail only if somebody
   * also rendered it, so the type is the control and this is the alarm.
   */
  it("carries no credential", () => {
    expect(rendered.text.toLowerCase()).not.toContain("passwort:");
    expect(rendered.text.toLowerCase()).not.toContain("password");
  });
});

describe("the catalogue", () => {
  const items = mailTemplateCatalogue();

  it("lists every notification type, without anybody maintaining a second list", () => {
    /*
      The agreement that makes the catalogue honest. A notification type added
      to `core/notifications/catalogue.ts` appears here automatically; if this
      ever has to be updated by hand, the derivation has been replaced by a
      copy and the copy will go stale.
    */
    const notificationKeys = items
      .filter((i) => i.key.startsWith("notification."))
      .map((i) => i.key.slice("notification.".length))
      .sort();
    expect(notificationKeys).toEqual(NOTIFICATION_TYPES.map((d) => d.key).sort());
  });

  it("gives every entry a label, a description and declared variables", () => {
    for (const item of items) {
      expect(item.label.length, item.key).toBeGreaterThan(2);
      expect(item.description.length, item.key).toBeGreaterThan(10);
      expect(Array.isArray(item.variables), item.key).toBe(true);
    }
  });

  it("has no duplicate keys", () => {
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("marks only notifications as optional", () => {
    // The four standalone messages go to people who are not dashboard users —
    // an applicant, somebody being invited, somebody resetting a password —
    // so there is no preference screen on which they could be switched off.
    for (const item of items) {
      expect(item.optional, item.key).toBe(item.key.startsWith("notification."));
    }
  });
});

describe("the preview", () => {
  it("renders every catalogued template", () => {
    for (const item of mailTemplateCatalogue()) {
      const rendered = previewMailTemplate(item.key, ORG, ADMIN);
      expect(rendered, item.key).not.toBeNull();
      expect(rendered!.subject.length, item.key).toBeGreaterThan(3);
      expect(rendered!.text.length, item.key).toBeGreaterThan(20);
    }
  });

  it("returns null for a key that does not exist, rather than throwing", () => {
    // The caller is a route with an id in it, and 404 is the right answer.
    expect(previewMailTemplate("nope", ORG, ADMIN)).toBeNull();
    expect(previewMailTemplate("notification.does.not.exist", ORG, ADMIN)).toBeNull();
  });

  it("uses sample values rather than anything real", () => {
    const reset = previewMailTemplate("account.passwordReset", ORG, ADMIN);
    expect(reset!.text).toContain("BEISPIEL-TOKEN");
  });

  it("puts the firm's name in the sign-off", () => {
    const invite = previewMailTemplate("account.invite", "Muster AG", ADMIN);
    expect(invite!.text).toContain("Muster AG");
  });

  /**
   * The preview must **send nothing** — asserted at the seam that could
   * plausibly regress: the function is pure and returns a rendered message, so
   * there is no transport to call. If a future version takes a `MailService`,
   * this signature changes and the reviewer sees it.
   */
  it("is a pure render with no transport in its signature", () => {
    expect(previewMailTemplate.length).toBe(3);
  });
});
