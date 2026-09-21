import { describe, expect, it } from "vitest";
import {
  canRetry,
  describeDelivery,
  describeState,
  describeTest,
  describeVerify,
  groupTemplates,
  headlineFor,
  remedyFor,
  retryRefusal,
} from "../service";
import { MAIL_FAILURE_CATEGORIES, type Delivery, type MailStatus } from "../types";

const status = (over: Partial<MailStatus> = {}): MailStatus => ({
  provider: {
    kind: "SMTP",
    host: "smtp.example.ch",
    port: 587,
    secure: false,
    hasCredentials: true,
    from: "noreply@example.ch",
    fromName: "IEM AG",
    replyTo: null,
  },
  configured: true,
  secretsReadable: true,
  state: "healthy",
  lastVerify: null,
  lastTestSend: null,
  deliveries: {
    delivered: 0,
    failed: 0,
    pending: 0,
    processing: 0,
    skipped: 0,
    lastDeliveredAt: null,
    lastFailedAt: null,
    lastFailureDetail: null,
  },
  ...over,
});

describe("the status verdict", () => {
  /**
   * The property this whole panel turns on.
   *
   * `unknown` means "configured, never tested", and rendering it as positive
   * is the mistake most status panels make. A green light that means "the
   * fields are filled in" teaches an operator that green means nothing, which
   * costs exactly the incident where it mattered.
   */
  it("does not draw an untested configuration as healthy", () => {
    expect(describeState("unknown").tone).not.toBe("positive");
    expect(describeState("not_configured").tone).not.toBe("positive");
  });

  it("reserves positive for the state that has evidence behind it", () => {
    const positive = (["healthy", "warning", "critical", "not_configured", "unknown"] as const)
      .filter((s) => describeState(s).tone === "positive");
    expect(positive).toEqual(["healthy"]);
  });

  it("gives every state a label and a sentence", () => {
    for (const s of ["healthy", "warning", "critical", "not_configured", "unknown"] as const) {
      expect(describeState(s).label.length, s).toBeGreaterThan(3);
      expect(describeState(s).detail.length, s).toBeGreaterThan(15);
    }
  });
});

describe("the headline", () => {
  /**
   * An unreadable credential is the failure that otherwise reads as success:
   * the row exists, so every other field says "configured", while every send
   * fails for a reason two layers away. It has to come first.
   */
  it("leads with an unreadable credential, ahead of everything else", () => {
    const line = headlineFor(status({ secretsReadable: false, state: "critical" }));
    expect(line).toContain("APP_SECRETS_ENCRYPTION_KEY");
  });

  it("explains the stub case when nothing is configured", () => {
    const line = headlineFor(status({ configured: false, state: "not_configured" }));
    expect(line).toContain("Protokoll");
  });
});

describe("the probes", () => {
  it("reports a connection with its timing", () => {
    const d = describeVerify({ status: "connected", describedAs: "smtp:587", durationMs: 41 });
    expect(d.ok).toBe(true);
    expect(d.message).toContain("41");
  });

  it("passes the server's sanitized message through unchanged", () => {
    const d = describeVerify({
      status: "failed",
      failure: { category: "AUTHENTICATION", message: "Der Mailserver hat die Anmeldung abgelehnt." },
      durationMs: 12,
    });
    expect(d.ok).toBe(false);
    expect(d.message).toBe("Der Mailserver hat die Anmeldung abgelehnt.");
  });

  /**
   * The terminology requirement, and it is not pedantry.
   *
   * The provider *accepted* the message. Whether it reaches an inbox is
   * decided by a server this application has no visibility into, and the
   * difference matters precisely when somebody is debugging a message that
   * was accepted and then silently dropped.
   */
  it("never claims a test message arrived in an inbox", () => {
    const d = describeTest({
      ok: true,
      stub: false,
      host: "smtp.example.ch",
      to: "a@b.ch",
      durationMs: 30,
    });
    expect(d.message).toContain("angenommen");
    expect(d.message).not.toMatch(/zugestellt|angekommen im Posteingang/);
    // It says who actually decides.
    expect(d.message).toContain("Empfängerserver");
  });

  it("calls the stub case what it is, rather than success or failure", () => {
    const d = describeTest({ ok: false, stub: true, host: "", to: "a@b.ch", durationMs: 0 });
    expect(d.ok).toBe(false);
    expect(d.message).toContain("Protokoll");
    expect(d.message).not.toContain("fehlgeschlagen");
  });
});

describe("deliveries", () => {
  const delivery = (over: Partial<Delivery> = {}): Delivery => ({
    id: "d1",
    channel: "EMAIL",
    status: "FAILED",
    attempts: 3,
    detail: null,
    queuedAt: new Date().toISOString(),
    settledAt: null,
    type: "content.approved",
    severity: "INFO",
    recipient: "a@b.ch",
    ...over,
  });

  /**
   * `SKIPPED` is neutral, not a warning — the same argument the notification
   * platform records. On a development machine it is by far the largest
   * number, and colouring it amber puts a wall of warning in front of every
   * operator, which is how somebody learns to ignore the colour that matters.
   */
  it("does not draw a deliberate non-send as a fault", () => {
    expect(describeDelivery("SKIPPED").tone).toBe("neutral");
    expect(describeDelivery("FAILED").tone).toBe("danger");
  });

  it("offers a retry only for a failed e-mail", () => {
    expect(canRetry(delivery())).toBe(true);
    expect(canRetry(delivery({ status: "DELIVERED" }))).toBe(false);
    expect(canRetry(delivery({ status: "PENDING" }))).toBe(false);
    expect(canRetry(delivery({ status: "PROCESSING" }))).toBe(false);
    expect(canRetry(delivery({ status: "SKIPPED" }))).toBe(false);
    expect(canRetry(delivery({ channel: "IN_APP", status: "FAILED" }))).toBe(false);
  });

  it("says why, for the case somebody will ask about", () => {
    // A skip looks like a failure in a list and is not one.
    expect(retryRefusal(delivery({ status: "SKIPPED" }))).toContain("kein Fehler");
    expect(retryRefusal(delivery())).toBeNull();
  });
});

describe("templates", () => {
  const t = (key: string, category: string) => ({
    key,
    label: key,
    category,
    description: "x",
    variables: [],
    optional: false,
  });

  it("puts the declared categories in their declared order", () => {
    const groups = groupTemplates([
      t("a", "Benachrichtigungen"),
      t("b", "Diagnose"),
      t("c", "Konto"),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["Diagnose", "Konto", "Benachrichtigungen"]);
  });

  it("sorts an unknown category last rather than first", () => {
    // Otherwise adding one would silently push the diagnostic template off
    // the top of the list.
    const groups = groupTemplates([t("a", "Neu"), t("b", "Diagnose")]);
    expect(groups[0].category).toBe("Diagnose");
  });
});

describe("remedies", () => {
  it("suggests the TLS toggle for a TLS fault, because that is nearly always it", () => {
    expect(remedyFor("TLS")).toContain("465");
  });

  it("returns null rather than undefined for a category with no advice", () => {
    expect(remedyFor("UNKNOWN")).toBeNull();
    expect(remedyFor(null)).toBeNull();
    expect(remedyFor(undefined)).toBeNull();
  });

  it("never throws on any category the server can send", () => {
    for (const category of MAIL_FAILURE_CATEGORIES) {
      expect(() => remedyFor(category)).not.toThrow();
    }
  });
});
