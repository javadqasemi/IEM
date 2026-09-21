import { expect, request, test, type APIRequestContext } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API,
  apiAs,
  spendMailProbe,
  TEST_PASSWORD,
} from "./fixtures";

/**
 * Email Operations (P2-4), against the running API and a **real SMTP server**.
 *
 * ---
 *
 * ## Why Mailpit, and why the assertion is on Mailpit's own API
 *
 * The one honest gap left by P2-3 was that no notification e-mail had ever
 * completed the last hop: `SMTP_HOST` was empty on every machine, so every
 * `EMAIL` delivery resolved to `SKIPPED` and the send path was, in the most
 * literal sense, untested.
 *
 * Asserting that nodemailer's promise resolved would not have closed it — that
 * proves a library call returned, not that an SMTP transaction happened. So
 * the chain is proved from the other end: Mailpit is a real SMTP server on
 * 1025 with an HTTP API on 8025, and the test asks **Mailpit** whether the
 * message arrived, by subject and by recipient.
 *
 * ```
 * domain event → Notification → NotificationDelivery(PENDING)
 *              → durable job → MailProvider → SMTP
 *              → Mailpit accepted → Mailpit API confirms → delivery DELIVERED
 * ```
 *
 * ## It skips rather than fails when Mailpit is absent
 *
 * The convention this repository already uses for `e2e:security` and
 * `e2e:budgets`: a red suite on a machine that has not opted into an extra
 * service is a suite people learn to ignore. Start it with
 * `npm run mail:catcher`.
 *
 * ## What it puts back
 *
 * The SMTP configuration is **restored in `afterAll`**, because it is
 * database state shared with every other spec: leaving `mail.smtpHost` set
 * would make `notifications.spec.ts` attempt real sends, and leaving it set to
 * a dead host would make them fail rather than skip.
 */

const MAILPIT = process.env.E2E_MAILPIT_ORIGIN || "http://localhost:8025";

/** Talks to Mailpit. No auth — it is a development catcher. */
let mailpit: APIRequestContext;
let api: APIRequestContext;
let available = false;

/** What the mail settings held before this spec touched them. */
const original: Record<string, unknown> = {};

const MAIL_KEYS = [
  "mail.smtpHost",
  "mail.smtpPort",
  "mail.smtpSecure",
  "mail.smtpUser",
  "mail.from",
  "mail.fromName",
  "mail.replyTo",
];

type SettingRow = {
  key: string;
  value: unknown;
  secret: boolean;
  configured?: boolean;
  canManage?: boolean;
};

/**
 * The settings, flattened.
 *
 * `GET /settings` returns `[{ group, settings }]`, not a flat list — the
 * dashboard renders by group. Flattening here rather than in each test keeps
 * the shape knowledge in one place, which is what stopped the first version of
 * this spec asserting against `undefined` and reporting it as a leak.
 */
async function settingsRows(): Promise<SettingRow[]> {
  const body = await (await api.get(`${API}/settings`)).json();
  return (body.data as { settings: SettingRow[] }[]).flatMap((g) => g.settings);
}

/** Whether a stored credential exists, as the settings list reports it. */
async function passwordConfigured(): Promise<boolean> {
  const row = (await settingsRows()).find((r) => r.key === "mail.smtpPassword");
  expect(row, "mail.smtpPassword is not in the settings list").toBeTruthy();
  return row!.configured === true;
}

test.beforeAll(async () => {
  mailpit = await request.newContext({ baseURL: MAILPIT });
  try {
    const res = await mailpit.get("/api/v1/messages", { timeout: 4000 });
    available = res.ok();
  } catch {
    available = false;
  }
  if (!available) return;

  api = await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);

  // Remember what was there, so `afterAll` can put it back exactly.
  for (const item of await settingsRows()) {
    if (MAIL_KEYS.includes(item.key)) original[item.key] = item.value;
  }

  await api.patch(`${API}/settings`, {
    data: {
      updates: [
        { key: "mail.smtpHost", value: "localhost" },
        { key: "mail.smtpPort", value: 1025 },
        { key: "mail.smtpSecure", value: false },
        { key: "mail.smtpUser", value: "" },
        { key: "mail.from", value: "noreply@iem.test" },
        { key: "mail.fromName", value: "IEM AG" },
        { key: "mail.replyTo", value: "" },
      ],
    },
  });
});

test.afterAll(async () => {
  if (!available) return;
  const updates = MAIL_KEYS.filter((k) => k in original).map((key) => ({
    key,
    value: original[key],
  }));
  if (updates.length) await api.patch(`${API}/settings`, { data: { updates } });
  await mailpit.dispose();
  await api.dispose();
});

test.beforeEach(async () => {
  test.skip(
    !available,
    `Mailpit läuft nicht auf ${MAILPIT} — starten mit: npm run mail:catcher`,
  );
  // Deterministic per scenario: every assertion below counts messages.
  await mailpit.delete("/api/v1/messages");
});

/* ================================================================== */

test.describe("the credential never comes back", () => {
  /**
   * The security property the whole slice turns on.
   *
   * `settings.secrets` used to hand the plaintext SMTP password to anybody
   * holding it. It now means *manage*, and there is no route that returns a
   * secret's value — so this test looks for the password in the **entire**
   * response body rather than at one field, which is the only version of the
   * assertion that survives somebody adding a field.
   */
  test("a written SMTP password is not readable through any settings route", async () => {
    const secret = `probe-${Date.now()}-do-not-leak`;

    await api.patch(`${API}/settings`, {
      data: { updates: [{ key: "mail.smtpPassword", value: secret }] },
    });

    for (const path of ["/settings", "/settings/mail/status"]) {
      const body = await (await api.get(`${API}${path}`)).text();
      expect(body, `${path} leaked the SMTP password`).not.toContain(secret);
    }

    // It is stored — the read says so without saying what it is.
    expect(await passwordConfigured()).toBe(true);

    // Put it back to "no credential", which is what Mailpit wants anyway.
    await api.delete(`${API}/settings/secrets/mail.smtpPassword`);
  });

  /**
   * The audit log is read by people who are not operators.
   *
   * `settings.updated` records **which keys** changed, never their values, and
   * `MailTested` carries a sanitized category rather than the provider's own
   * message — which for a failed `AUTH PLAIN` can echo a base64 blob
   * containing the username and the password.
   */
  test("nothing secret reaches the audit log", async () => {
    const secret = `audit-probe-${Date.now()}-do-not-leak`;

    await api.patch(`${API}/settings`, {
      data: { updates: [{ key: "mail.smtpPassword", value: secret }] },
    });

    const log = await api.get(`${API}/audit?perPage=50`);
    if (log.ok()) {
      const body = await log.text();
      expect(body, "the audit log carried the SMTP password").not.toContain(secret);
      // The fact is still recorded — the key is named even though the value is not.
      expect(body).toContain("mail.smtpPassword");
    }

    await api.delete(`${API}/settings/secrets/mail.smtpPassword`);
  });

  /**
   * The brief's blanket assertion, at the two routes this slice owns.
   *
   * Tokens are checked as well as the SMTP password because the envelope is
   * shared: a handler that accidentally returned its own request context would
   * leak them here first.
   */
  test("no response from the mail routes carries a token or a key", async () => {
    const forbidden = [
      "APP_SECRETS_ENCRYPTION_KEY",
      "MFA_ENCRYPTION_KEY",
      "JWT_ACCESS_SECRET",
      "refreshToken",
      "accessToken",
    ];

    for (const path of [
      "/settings",
      "/settings/mail/status",
      "/settings/mail/templates",
      "/settings/mail/templates/diagnostic.test/preview",
    ]) {
      const body = await (await api.get(`${API}${path}`)).text();
      for (const needle of forbidden) {
        expect(body, `${path} mentioned ${needle}`).not.toContain(needle);
      }
    }
  });

  test("the settings list reports it as configured and masked, never as a value", async () => {
    await api.patch(`${API}/settings`, {
      data: { updates: [{ key: "mail.smtpPassword", value: "another-secret-value" }] },
    });

    const row = (await settingsRows()).find((r) => r.key === "mail.smtpPassword");

    expect(row).toBeTruthy();
    expect(row!.secret).toBe(true);
    expect(row!.configured).toBe(true);
    expect(row!.value).not.toBe("another-secret-value");
    /*
      A **constant** mask, not a length-preserving one.

      A mask that echoed the length would disclose how long the password is,
      which is the one thing a length-preserving mask hands to somebody reading
      over a shoulder.
    */
    expect(String(row!.value)).not.toHaveLength("another-secret-value".length);

    await api.delete(`${API}/settings/secrets/mail.smtpPassword`);
  });

  /**
   * The requirement that a blank field cannot destroy a working credential.
   *
   * A settings form posts every field it rendered, and the password field
   * renders empty once it is no longer readable — so "empty clears it" would
   * delete a working SMTP password on the next save of an unrelated field.
   */
  test("an empty write keeps the existing secret rather than clearing it", async () => {
    await api.patch(`${API}/settings`, {
      data: { updates: [{ key: "mail.smtpPassword", value: "keep-me-please" }] },
    });

    // A save of the whole form, with the password field blank.
    await api.patch(`${API}/settings`, {
      data: {
        updates: [
          { key: "mail.smtpPassword", value: "" },
          { key: "mail.fromName", value: "IEM AG" },
        ],
      },
    });

    expect(await passwordConfigured(), "a blank write cleared the password").toBe(true);

    // Whitespace is the other spelling of blank, and the one a form produces.
    await api.patch(`${API}/settings`, {
      data: { updates: [{ key: "mail.smtpPassword", value: "   " }] },
    });
    expect(await passwordConfigured(), "a whitespace write cleared the password").toBe(true);

    // Removal is the explicit action, and it does work.
    const removed = await api.delete(`${API}/settings/secrets/mail.smtpPassword`);
    expect(removed.ok()).toBe(true);
    expect(await passwordConfigured()).toBe(false);
  });
});

test.describe("the two diagnostics are different operations", () => {
  test("a connection test reports success and sends nothing", async () => {
    await spendMailProbe("verify");
    const res = await api.post(`${API}/settings/mail/verify`, { data: {} });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.data.status).toBe("connected");
    expect(body.data.durationMs).toBeGreaterThanOrEqual(0);

    // The point of the separation: nothing was delivered.
    const caught = await (await mailpit.get("/api/v1/messages")).json();
    expect(caught.total, "a connection test put a message in an inbox").toBe(0);
  });

  test("a test send arrives at the SMTP server, with the fixed subject", async () => {
    await spendMailProbe("test");
    const res = await api.post(`${API}/settings/mail/test`, {
      data: { to: "operator@iem.test" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.data.ok).toBe(true);
    expect(body.data.to).toBe("operator@iem.test");

    const caught = await (await mailpit.get("/api/v1/messages")).json();
    expect(caught.total).toBe(1);
    expect(caught.messages[0].Subject).toContain("Testnachricht");
    expect(caught.messages[0].To[0].Address).toBe("operator@iem.test");
    expect(caught.messages[0].From.Address).toBe("noreply@iem.test");
  });

  test("a bad recipient is refused before anything is attempted", async () => {
    await spendMailProbe("test");
    const res = await api.post(`${API}/settings/mail/test`, { data: { to: "not-an-address" } });
    expect(res.status()).toBe(400);
    const caught = await (await mailpit.get("/api/v1/messages")).json();
    expect(caught.total).toBe(0);
  });

  /**
   * A wrong host must produce a **classified** failure, not a raw provider
   * string — the invariant `mail.failure.ts` exists for.
   */
  test("an unreachable host is classified, and no provider text escapes", async () => {
    await api.patch(`${API}/settings`, {
      data: { updates: [{ key: "mail.smtpHost", value: "127.0.0.1" }, { key: "mail.smtpPort", value: 1 }] },
    });

    await spendMailProbe("verify");
    const res = await api.post(`${API}/settings/mail/verify`, { data: {} });
    const body = await res.json();
    expect(body.data.status).toBe("failed");
    expect(["CONNECTION", "TIMEOUT", "TLS"]).toContain(body.data.failure.category);

    const text = JSON.stringify(body);
    // Nodemailer's own wording, which must not reach the client.
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("getaddrinfo");

    await api.patch(`${API}/settings`, {
      data: { updates: [{ key: "mail.smtpHost", value: "localhost" }, { key: "mail.smtpPort", value: 1025 }] },
    });
  });
});

test.describe("status is measured, never declared", () => {
  test("reports the provider without any field that could hold a credential", async () => {
    const body = await (await api.get(`${API}/settings/mail/status`)).json();
    const provider = body.data.provider as Record<string, unknown>;

    expect(provider.kind).toBe("SMTP");
    expect(provider.host).toBe("localhost");
    expect(Object.keys(provider)).not.toContain("password");
    expect(Object.keys(provider)).not.toContain("smtpPassword");
    expect(typeof provider.hasCredentials).toBe("boolean");
  });

  test("records the last probe with who ran it and how long it took", async () => {
    await spendMailProbe("verify");
    await api.post(`${API}/settings/mail/verify`, { data: {} });
    const body = await (await api.get(`${API}/settings/mail/status`)).json();

    expect(body.data.lastVerify).toBeTruthy();
    expect(body.data.lastVerify.ok).toBe(true);
    expect(body.data.lastVerify.by).toBe(ADMIN_EMAIL);
    expect(body.data.state).not.toBe("not_configured");
  });
});

test.describe("templates are a catalogue, previewed without sending", () => {
  test("lists every message the system can send", async () => {
    const body = await (await api.get(`${API}/settings/mail/templates`)).json();
    const keys = (body.data.items as { key: string }[]).map((i) => i.key);

    expect(keys).toContain("diagnostic.test");
    expect(keys).toContain("account.passwordReset");
    // Every notification type appears, derived rather than hand-listed.
    expect(keys.filter((k) => k.startsWith("notification.")).length).toBeGreaterThanOrEqual(10);
  });

  test("renders a preview and sends nothing", async () => {
    const res = await api.get(`${API}/settings/mail/templates/account.invite/preview`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.data.subject.length).toBeGreaterThan(3);
    expect(body.data.text).toContain("BEISPIEL-TOKEN");

    const caught = await (await mailpit.get("/api/v1/messages")).json();
    expect(caught.total, "a preview sent a real message").toBe(0);
  });

  test("an unknown template is a 404, not a blank render", async () => {
    const res = await api.get(`${API}/settings/mail/templates/nope/preview`);
    expect(res.status()).toBe(404);
  });
});

/* ================================================================== */
/* The acceptance criterion                                            */
/* ================================================================== */

test.describe("a notification reaches a real SMTP server", () => {
  /**
   * The chain P2-3 could not prove, proved from the far end.
   *
   * A content submission raises `ContentSubmitted`, which the notification
   * platform turns into one `Notification` per holder of `content.approve`,
   * one `NotificationDelivery` per channel, and — for `EMAIL` — a durable
   * `notification.deliver` job. The job goes through `MailProvider` to SMTP.
   * Mailpit is asked whether the message arrived; the delivery row is then
   * asked whether it says `DELIVERED`.
   */
  test("event → delivery → job → SMTP → Mailpit → DELIVERED", async () => {
    test.setTimeout(120_000);

    // The firm's rule has to allow the e-mail channel for this type; its
    // catalogue default is in-app only.
    await api.put(`${API}/notifications/rules`, {
      data: {
        updates: [
          { type: "content.submitted_for_review", enabled: true, inApp: true, email: true },
        ],
      },
    });

    const created = await api.post(`${API}/content/entries`, {
      data: {
        typeKey: "team",
        data: { name: `P2-4 Abnahme ${Date.now()}`, role: "Test", group: "Admin" },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const entryId = (await created.json()).data.id as string;

    const submitted = await api.post(`${API}/content/entries/${entryId}/submit`, { data: {} });
    expect(submitted.ok()).toBe(true);

    // The job runner polls; wait for Mailpit rather than for a fixed delay.
    await expect
      .poll(
        async () => (await (await mailpit.get("/api/v1/messages")).json()).total as number,
        {
          message: "the notification e-mail never reached the SMTP server",
          timeout: 60_000,
          intervals: [1000],
        },
      )
      .toBeGreaterThan(0);

    const caught = await (await mailpit.get("/api/v1/messages")).json();
    expect(caught.messages[0].Subject.length).toBeGreaterThan(3);
    expect(caught.messages[0].From.Address).toBe("noreply@iem.test");

    // And the delivery row agrees.
    await expect
      .poll(
        async () => {
          const body = await (
            await api.get(`${API}/notifications/deliveries?status=DELIVERED&perPage=20`)
          ).json();
          return (body.data.items as { channel: string; type: string }[]).filter(
            (d) => d.channel === "EMAIL" && d.type === "content.submitted_for_review",
          ).length;
        },
        { message: "no EMAIL delivery reached DELIVERED", timeout: 30_000, intervals: [1000] },
      )
      .toBeGreaterThan(0);

    await api.delete(`${API}/content/entries/${entryId}`);
  });
});

/* ================================================================== */
/* RBAC                                                               */
/* ================================================================== */

test.describe("the operational routes are guarded", () => {
  test.skip(!TEST_PASSWORD, "SEED_TEST_USERS is not enabled on this machine.");

  /**
   * Paced like every other call to these two routes, and **that is the point
   * of the test working at all**.
   *
   * `ThrottlerGuard` runs before `PermissionsGuard`, so an unpaced refusal
   * arrives as 429 and never reaches the permission — which reads as a broken
   * RBAC rule over a screenshot of a correct one. It is the sign-in-budget
   * mistake arriving by a fourth route; see `spendMailProbe`.
   */
  test("a role without settings.update cannot run a diagnostic", async () => {
    test.setTimeout(180_000);
    const guest = await apiAs("gast@iem.test", TEST_PASSWORD);

    await spendMailProbe("verify");
    expect((await guest.post(`${API}/settings/mail/verify`, { data: {} })).status()).toBe(403);

    await spendMailProbe("test");
    expect((await guest.post(`${API}/settings/mail/test`, { data: {} })).status()).toBe(403);

    await guest.dispose();
  });

  test("a role without settings.secrets cannot remove a credential", async () => {
    const guest = await apiAs("gast@iem.test", TEST_PASSWORD);
    const res = await guest.delete(`${API}/settings/secrets/mail.smtpPassword`);
    expect(res.status()).toBe(403);
    await guest.dispose();
  });
});

