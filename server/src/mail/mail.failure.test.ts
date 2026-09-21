import { describe, expect, it } from "vitest";
import {
  MAIL_FAILURE_CATEGORIES,
  classifyMailError,
  incompleteConfiguration,
  type MailFailureCategory,
} from "./mail.failure";

/**
 * The classifier, and the one property that is a security control rather than
 * a nicety.
 *
 * `classifyMailError` is pure, so it can be covered from a table of the error
 * shapes nodemailer and real mail servers actually produce — which is the only
 * honest way to test it, because the input is written by a library and a
 * remote host rather than by this codebase.
 */

/** A nodemailer-shaped error: a `code`, sometimes a `responseCode`, a message. */
const err = (fields: { code?: string; responseCode?: number; message?: string }) =>
  Object.assign(new Error(fields.message ?? "boom"), fields);

describe("classification by library code", () => {
  const cases: [string, MailFailureCategory][] = [
    ["EAUTH", "AUTHENTICATION"],
    ["EENVELOPE", "RECIPIENT_REJECTED"],
    ["ECONNREFUSED", "CONNECTION"],
    ["ENOTFOUND", "CONNECTION"],
    ["EHOSTUNREACH", "CONNECTION"],
    ["ETIMEDOUT", "TIMEOUT"],
    ["ESOCKETTIMEDOUT", "TIMEOUT"],
    ["ESOCKET", "TLS"],
    ["EMESSAGE", "PROVIDER"],
  ];

  it.each(cases)("%s → %s", (code, expected) => {
    expect(classifyMailError(err({ code })).category).toBe(expected);
  });

  it("is case-insensitive about the code", () => {
    expect(classifyMailError(err({ code: "eauth" })).category).toBe("AUTHENTICATION");
  });
});

describe("classification by SMTP reply code", () => {
  /**
   * The code wins over the prose, and that is the point of checking it second
   * rather than last: a message is written by a remote server in whatever
   * language and wording it likes, and matching on it alone is how a
   * classifier silently degrades after a dependency bump.
   */
  const cases: [number, MailFailureCategory][] = [
    [421, "RATE_LIMIT"],
    [450, "RATE_LIMIT"],
    [451, "RATE_LIMIT"],
    [535, "AUTHENTICATION"],
    [550, "RECIPIENT_REJECTED"],
    [553, "RECIPIENT_REJECTED"],
    [554, "PROVIDER"],
  ];

  it.each(cases)("%i → %s", (responseCode, expected) => {
    expect(classifyMailError(err({ responseCode })).category).toBe(expected);
  });
});

describe("classification by message, when nothing else decided", () => {
  it("reads a TLS version mismatch as TLS rather than CONNECTION", () => {
    /*
      The ordering case. This message contains "connection" in several server
      dialects, and a classifier that tested for connection words first would
      send an operator to re-check a host that was never wrong — when the
      actual fix is the `secure` toggle.
    */
    const failure = classifyMailError(
      err({ message: "140735: error:1408F10B:SSL routines:wrong version number" }),
    );
    expect(failure.category).toBe("TLS");
  });

  it("recognises a throttling message", () => {
    expect(classifyMailError(err({ message: "Too many messages, try again later" })).category).toBe(
      "RATE_LIMIT",
    );
  });

  it("falls back to UNKNOWN rather than guessing", () => {
    expect(classifyMailError(err({ message: "something nobody has seen" })).category).toBe(
      "UNKNOWN",
    );
  });

  it("survives a thrown non-object", () => {
    // `catch` binds `unknown`, and a library that throws a string must not
    // crash the classifier that exists to make failures safe.
    expect(classifyMailError("just a string").category).toBe("UNKNOWN");
    expect(classifyMailError(null).category).toBe("UNKNOWN");
    expect(classifyMailError(undefined).category).toBe("UNKNOWN");
  });
});

/**
 * The invariant the file exists for.
 *
 * Before P2-4 the raw `err.message` went to the browser, to
 * `NotificationDelivery.detail` and into the `MailTested` audit payload. Real
 * SMTP failures routinely echo the command that failed — which for `AUTH PLAIN`
 * is a base64 blob containing the username **and the password**.
 */
describe("no part of the input reaches the output", () => {
  const SECRET = "hunter2-super-secret";

  it("does not echo a message containing a credential", () => {
    const failure = classifyMailError(
      err({
        code: "EAUTH",
        message: `535 5.7.8 Authentication failed for user smtp-bot with password ${SECRET}`,
      }),
    );
    expect(failure.message).not.toContain(SECRET);
    expect(failure.message).not.toContain("smtp-bot");
    expect(JSON.stringify(failure)).not.toContain(SECRET);
  });

  it("does not echo a base64 AUTH blob", () => {
    const blob = Buffer.from(`\0smtp-bot\0${SECRET}`).toString("base64");
    const failure = classifyMailError(err({ code: "EAUTH", message: `AUTH PLAIN ${blob} failed` }));
    expect(failure.message).not.toContain(blob);
  });

  it("does not echo the host or port", () => {
    const failure = classifyMailError(
      err({ code: "ECONNREFUSED", message: "connect ECONNREFUSED 10.1.2.3:2525" }),
    );
    expect(failure.message).not.toContain("10.1.2.3");
    expect(failure.message).not.toContain("2525");
  });
});

describe("every category can be rendered", () => {
  /**
   * A category that classified correctly and rendered as `undefined` would be
   * worse than no classification at all — the operator would see an empty
   * panel and conclude nothing had failed.
   */
  it("has non-empty German copy for all of them", () => {
    for (const category of MAIL_FAILURE_CATEGORIES) {
      const failure = classifyMailError(err({ code: `__${category}__` }));
      expect(failure.message.length, category).toBeGreaterThan(10);
    }
  });

  it("covers the closed set with no duplicates", () => {
    expect(new Set(MAIL_FAILURE_CATEGORIES).size).toBe(MAIL_FAILURE_CATEGORIES.length);
  });
});

describe("an incomplete configuration is not an error", () => {
  it("names the missing fields, because that is what makes it actionable", () => {
    const failure = incompleteConfiguration(["SMTP-Server", "SMTP-Passwort"]);
    expect(failure.category).toBe("CONFIGURATION");
    expect(failure.message).toContain("SMTP-Server");
    expect(failure.message).toContain("SMTP-Passwort");
  });

  it("still says something useful when it cannot name them", () => {
    expect(incompleteConfiguration([]).message.length).toBeGreaterThan(10);
  });
});
