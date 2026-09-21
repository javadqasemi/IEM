import { request, type APIRequestContext } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API,
  TEST_PASSWORD,
  apiAs,
  expect,
  expectClean,
  spendLogin,
  spendMfa,
  test,
} from "./fixtures";
import { settleIntoStep, totp } from "./totp";

/**
 * The notification platform, end to end.
 *
 * ---
 *
 * ## What cannot be tested anywhere else
 *
 * `notifications.rules.test.ts` covers the resolution arithmetic
 * exhaustively and cannot see any of the following, all of which are the
 * product:
 *
 * - **A domain event actually produces a notification.** The listener, the
 *   bus, the request-context flush and the unique index are four separate
 *   mechanisms, and a unit test of any one of them passes while the chain is
 *   broken.
 * - **The invariant survives a real request.** `resolveChannels` refuses to
 *   let a preference switch off a security message; whether the *controller*
 *   refuses to store one is a different question with its own answer.
 * - **A failed or skipped e-mail leaves the in-app message alone.** Two rows
 *   with independent outcomes, which only a real delivery record shows.
 * - **Idempotency.** The guarantee is a unique index and a caught `P2002`,
 *   not a check — so it is only meaningful against a database.
 *
 * ## The account, and why it is not the administrator
 *
 * `mfa@iem.test` again. The triggers this spec uses are the four security
 * events, because they are the only ones in the catalogue that are **fully
 * reversible**: enrol a factor, receive a notification, reset it, and the
 * seed is exactly as it was. Every content trigger would leave an entry in a
 * different workflow state, and the publish trigger would leave a snapshot.
 *
 * It must not be the administrator for the reason `mfa.spec.ts` gives at
 * length: that is the account the shared browser context signs in with, and
 * leaving a second factor on it breaks every subsequent spec two files away.
 */

const USER_EMAIL = "mfa@iem.test";

function requireAccounts(): void {
  test.skip(
    !TEST_PASSWORD,
    "SEED_TEST_PASSWORD ist nicht gesetzt — `SEED_TEST_USERS=true npm run server:seed` " +
      "legt das Konto an, an dem dieser Test Benachrichtigungen auslöst.",
  );
}

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

type Session = { ctx: APIRequestContext; token: string };

async function signIn(email: string, password: string): Promise<Session> {
  await spendLogin();
  const anonymous = await request.newContext();
  try {
    const response = await anonymous.post(`${API}/auth/login`, { data: { email, password } });
    const text = await response.text();
    expect(response.status(), text).toBe(200);
    const token = (JSON.parse(text) as { data: { accessToken?: string } }).data.accessToken;
    expect(token, "kein Zugriffstoken — hat das Konto schon MFA?").toBeTruthy();
    return {
      ctx: await request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token!}` } }),
      token: token!,
    };
  } finally {
    await anonymous.dispose();
  }
}

/** Enrols a second factor, which is what raises `MfaEnabled`. */
async function enrol(ctx: APIRequestContext): Promise<string> {
  const started = await ctx.post(`${API}/auth/mfa/enroll`, { data: {} });
  expect(started.status(), await started.text()).toBe(200);
  const { secret } = ((await started.json()) as { data: { secret: string } }).data;

  await settleIntoStep();
  await spendMfa();
  const verified = await ctx.post(`${API}/auth/mfa/enroll/verify`, { data: { code: totp(secret) } });
  expect(verified.status(), await verified.text()).toBe(200);
  return secret;
}

type Inbox = {
  items: { id: string; type: string; severity: string; title: string; read: boolean }[];
  unread: number;
  total: number;
};

async function inbox(ctx: APIRequestContext, query = ""): Promise<Inbox> {
  const response = await ctx.get(`${API}/notifications${query}`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: Inbox }).data;
}

async function unreadCount(ctx: APIRequestContext): Promise<number> {
  const response = await ctx.get(`${API}/notifications/unread-count`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: { unread: number } }).data.unread;
}

/* ------------------------------------------------------------------ */
/* Tear-down                                                           */
/* ------------------------------------------------------------------ */

let adminCtx: APIRequestContext | null = null;
let targetId = "";
let adminWindow: { token: string; until: number } | null = null;

async function admin(): Promise<APIRequestContext> {
  adminCtx ??= await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);
  return adminCtx;
}

async function userId(): Promise<string> {
  if (targetId) return targetId;
  const list = await (await admin()).get(`${API}/users`, { params: { search: USER_EMAIL } });
  const users = ((await list.json()) as { data: { items: { id: string; email: string }[] } }).data.items;
  targetId = users.find((u) => u.email === USER_EMAIL)?.id ?? "";
  expect(targetId, "mfa@iem.test fehlt — Seed mit SEED_TEST_USERS=true").toBeTruthy();
  return targetId;
}

/**
 * The administrator's re-authentication window, cached for its own lifetime.
 *
 * The same arrangement `mfa.spec.ts` uses and for the same reason: the
 * window is deliberately not consumed by use, and `/auth/reauthenticate` is
 * throttled at ten a minute — minting a fresh one per tear-down would spend
 * the MFA budget the assertions need.
 */
async function window_(): Promise<string> {
  if (adminWindow && adminWindow.until > Date.now()) return adminWindow.token;
  await spendMfa();
  const response = await (await admin()).post(`${API}/auth/reauthenticate`, {
    data: { password: ADMIN_PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(200);
  const token = ((await response.json()) as { data: { token: string } }).data.token;
  adminWindow = { token, until: Date.now() + 4 * 60_000 };
  return token;
}

/** Leaves `mfa@iem.test` without a second factor. Checks before it acts. */
async function clearFactor(): Promise<void> {
  const ctx = await admin();
  const id = await userId();
  const list = await ctx.get(`${API}/users`, { params: { search: USER_EMAIL } });
  const users = ((await list.json()) as { data: { items: { email: string; mfaEnabled: boolean }[] } })
    .data.items;
  if (!users.find((u) => u.email === USER_EMAIL)?.mfaEnabled) return;

  const reset = await ctx.post(`${API}/users/${id}/mfa/reset`, {
    data: { reauthToken: await window_() },
  });
  expect(reset.status(), await reset.text()).toBe(200);
}

test.afterAll(async () => {
  if (adminCtx) await adminCtx.dispose();
  adminCtx = null;
  adminWindow = null;
});

/* ================================================================== */
/* An event becomes a notification                                     */
/* ================================================================== */

test.describe("a domain event produces a notification", () => {
  let user: Session;

  test.beforeAll(async () => {
    requireAccounts();
    await clearFactor();
    user = await signIn(USER_EMAIL, TEST_PASSWORD);
  });

  test.afterAll(async () => {
    await clearFactor();
    await user?.ctx.dispose();
  });

  test("the whole chain: event → recipient → channels → rows", async () => {
    const before = await unreadCount(user.ctx);

    /*
      `MfaEnabled` is raised by `MfaService.verifyEnrolment` and reaches
      Notifications through the bus. Four separate mechanisms are being
      exercised at once — the publish, the request-context flush, the
      listener's map and the unique index — and a unit test of any one of
      them passes while the chain is broken.
    */
    await enrol(user.ctx);

    const after = await inbox(user.ctx, "?unread=true");
    expect(after.unread, "die Aktivierung muss eine Meldung erzeugen").toBe(before + 1);

    const notification = after.items[0];
    expect(notification.type).toBe("security.mfa_enabled");
    expect(notification.severity).toBe("SUCCESS");
    expect(notification.read).toBe(false);
    expect(notification.title).toContain("Zwei-Faktor");

    /*
      **The recipient is the subject, not the actor.**

      Here they are the same person, and that is the case worth asserting:
      every other notification suppresses the actor, and these four must
      not — if somebody with your session enables a factor on your account,
      they *are* you as far as the server can tell, and suppressing the
      message would suppress exactly the case it exists for.
    */
    expect(after.items.every((n) => n.type.startsWith("security."))).toBe(true);
  });

  test("a failed or skipped e-mail leaves the in-app message alone", async () => {
    /*
      The two-row split, against a real database.

      No SMTP server is configured in development, so the e-mail delivery
      settles as `SKIPPED` with a reason — **not** `FAILED`, because nothing
      is wrong, and not silently, because a silence with no reason is
      indistinguishable from a bug. The in-app row is `DELIVERED` regardless,
      which is the guarantee the two tables exist for.
    */
    const response = await (await admin()).get(`${API}/notifications/deliveries`);
    expect(response.status()).toBe(200);
    const { items } = ((await response.json()) as {
      data: { items: { channel: string; status: string; type: string; detail: string | null }[] };
    }).data;

    const mine = items.filter((d) => d.type === "security.mfa_enabled");
    expect(mine.length, "beide Kanäle müssen eine Zeile haben").toBeGreaterThanOrEqual(2);

    const inApp = mine.find((d) => d.channel === "IN_APP");
    const email = mine.find((d) => d.channel === "EMAIL");
    expect(inApp?.status).toBe("DELIVERED");
    expect(["SKIPPED", "DELIVERED", "PENDING", "PROCESSING"]).toContain(email?.status);
    if (email?.status === "SKIPPED") {
      // The reason is the column this table exists for.
      expect(email.detail, "ein Überspringen ohne Grund ist von einem Fehler nicht zu unterscheiden")
        .toBeTruthy();
    }
  });

  test("marking one read moves the count, and un-reading moves it back", async () => {
    const list = await inbox(user.ctx, "?unread=true");
    expect(list.items.length).toBeGreaterThan(0);
    const [first] = list.items;

    const read = await user.ctx.post(`${API}/notifications/${first.id}/read`, {
      data: { read: true },
    });
    expect(read.status()).toBe(204);
    expect(await unreadCount(user.ctx)).toBe(list.unread - 1);

    // `false` un-reads it, which is how somebody keeps one to deal with
    // later — and it is the value a stripped DTO field would have lost.
    const unread = await user.ctx.post(`${API}/notifications/${first.id}/read`, {
      data: { read: false },
    });
    expect(unread.status()).toBe(204);
    expect(await unreadCount(user.ctx)).toBe(list.unread);
  });

  test("marking all read empties the count in one request", async () => {
    const response = await user.ctx.post(`${API}/notifications/read-all`, { data: {} });
    expect(response.status()).toBe(200);
    expect(((await response.json()) as { data: { marked: number } }).data.marked).toBeGreaterThan(0);
    expect(await unreadCount(user.ctx)).toBe(0);

    // And the notification is still there — read, not deleted. An
    // operational feed that threw away what you had seen would make "what
    // happened last Tuesday" unanswerable.
    const all = await inbox(user.ctx);
    expect(all.total).toBeGreaterThan(0);
    expect(all.items.every((n) => n.read)).toBe(true);
  });

  test("an administrative reset notifies the account holder, not the administrator", async () => {
    /*
      The asymmetry that makes `subject` a strategy rather than a special
      case: the actor is the administrator and the recipient is the person
      whose account changed. An implementation that notified "whoever did
      it" would send a CRITICAL security message to the wrong inbox.
    */
    const adminBefore = await unreadCount(await admin());
    await clearFactor();

    const list = await inbox(user.ctx, "?unread=true");
    expect(list.items.some((n) => n.type === "security.mfa_reset")).toBe(true);
    const reset = list.items.find((n) => n.type === "security.mfa_reset")!;
    expect(reset.severity).toBe("CRITICAL");

    expect(
      await unreadCount(await admin()),
      "die Administration bekommt keine Meldung über ihre eigene Handlung",
    ).toBe(adminBefore);
  });
});

/* ================================================================== */
/* One account cannot reach another's                                  */
/* ================================================================== */

test.describe("notifications are scoped to the account", () => {
  let user: Session;

  test.beforeAll(async () => {
    requireAccounts();
    user = await signIn(USER_EMAIL, TEST_PASSWORD);
  });

  test.afterAll(async () => {
    await user?.ctx.dispose();
  });

  test("the list shows only one's own", async () => {
    /*
      There is no parameter to attack — the route takes the account from the
      verified token and names no user — so the assertion is that two
      sessions see two different inboxes, which is the property that would
      be lost if somebody ever added a `?userId=`.
    */
    const mine = await inbox(user.ctx);
    const theirs = await inbox(await admin());
    const overlap = mine.items.filter((a) => theirs.items.some((b) => b.id === a.id));
    expect(overlap, "zwei Konten dürfen keine Benachrichtigung teilen").toEqual([]);
  });

  test("one account cannot mark another's read", async () => {
    /*
      The **administrator** reaching for the *user's* notification, rather
      than the other way round, and the direction is chosen so the test can
      never skip: this account has notifications by construction — the
      blocks above produced them — while the administrator's inbox may be
      empty, and a test that skips when the attack target is missing is a
      test that proves nothing on a fresh database.

      It is also the more interesting direction. Super Admin short-circuits
      `PermissionsGuard` on the role key, so if ownership were enforced by a
      permission rather than by the `where` clause, *this* is the caller who
      would get through.
    */
    const mine = await inbox(user.ctx);
    expect(mine.items.length, "dieses Konto muss Benachrichtigungen haben").toBeGreaterThan(0);

    const response = await (await admin()).post(
      `${API}/notifications/${mine.items[0].id}/read`,
      { data: { read: true } },
    );
    /*
      400, from `markRead`'s `updateMany` finding no row in the caller's
      scope — and deliberately the same answer an id that does not exist at
      all gets. Whether somebody else's notification exists is not
      information this caller is owed.
    */
    expect(response.status()).toBe(400);

    // And it really is untouched, not merely refused.
    const after = await inbox(user.ctx);
    expect(after.items[0].read).toBe(mine.items[0].read);
  });

  test("a fabricated id is refused the same way", async () => {
    const response = await user.ctx.post(`${API}/notifications/cmzzzznotarealid0000/read`, {
      data: { read: true },
    });
    expect(response.status()).toBe(400);
  });
});

/* ================================================================== */
/* Preferences and the invariant                                       */
/* ================================================================== */

test.describe("personal preferences", () => {
  let user: Session;

  test.beforeAll(async () => {
    requireAccounts();
    user = await signIn(USER_EMAIL, TEST_PASSWORD);
  });

  test.afterAll(async () => {
    // Back to the catalogue's defaults, so a later run starts clean.
    await user?.ctx
      .put(`${API}/notifications/preferences`, {
        data: {
          updates: [
            { type: "content.approved", inApp: true, email: false },
            { type: "security.mfa_disabled", inApp: true, email: true },
          ],
        },
      })
      .catch(() => {});
    await user?.ctx.dispose();
  });

  test("the whole catalogue comes back, with labels rather than keys", async () => {
    const response = await user.ctx.get(`${API}/notifications/preferences`);
    expect(response.status()).toBe(200);
    const rows = ((await response.json()) as {
      data: { type: string; label: string; description: string; mandatory: boolean }[];
    }).data;

    expect(rows.length).toBeGreaterThanOrEqual(10);
    // The screen renders from these. A row whose label is its key would be
    // a switch somebody flips without knowing what it does.
    for (const row of rows) {
      expect(row.label, row.type).not.toBe(row.type);
      expect(row.description.length, row.type).toBeGreaterThan(20);
    }
    expect(rows.filter((r) => r.mandatory)).toHaveLength(4);
  });

  test("an ordinary notification can be switched off", async () => {
    const response = await user.ctx.put(`${API}/notifications/preferences`, {
      data: { updates: [{ type: "content.approved", inApp: false, email: false }] },
    });
    expect(response.status(), await response.text()).toBe(200);

    const rows = ((await response.json()) as { data: { type: string; inApp: boolean }[] }).data;
    expect(rows.find((r) => r.type === "content.approved")?.inApp).toBe(false);
  });

  test("a security notification cannot be, and the refusal says why", async () => {
    /*
      **The invariant, at the API rather than in the resolver.**

      `resolveChannels` would force the in-app copy back on regardless — it
      is applied on read — so a server that *accepted* this would store a
      preference that does nothing and show the switch back on after a
      reload with no explanation. Refusing is the honest half of a control
      that cannot be turned off.
    */
    const response = await user.ctx.put(`${API}/notifications/preferences`, {
      data: { updates: [{ type: "security.mfa_disabled", inApp: false, email: true }] },
    });
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("Sicherheitsmeldung");
  });

  test("the e-mail copy of a security notification can still be switched off", async () => {
    // The half that keeps the rule proportionate: refusing this is how
    // somebody filters the sender, which would take the security messages
    // with it.
    const response = await user.ctx.put(`${API}/notifications/preferences`, {
      data: { updates: [{ type: "security.mfa_disabled", inApp: true, email: false }] },
    });
    expect(response.status(), await response.text()).toBe(200);
    const rows = ((await response.json()) as { data: { type: string; email: boolean }[] }).data;
    expect(rows.find((r) => r.type === "security.mfa_disabled")?.email).toBe(false);
  });

  test("an unknown type is refused rather than stored", async () => {
    const response = await user.ctx.put(`${API}/notifications/preferences`, {
      data: { updates: [{ type: "made.up_thing", inApp: true, email: true }] },
    });
    expect(response.status()).toBe(400);
  });
});

/* ================================================================== */
/* The firm's rules                                                    */
/* ================================================================== */

test.describe("organisation rules", () => {
  test.beforeAll(requireAccounts);

  test.afterAll(async () => {
    await (await admin())
      .put(`${API}/notifications/rules`, {
        data: { updates: [{ type: "content.published", enabled: true, inApp: true, email: false }] },
      })
      .catch(() => {});
  });

  test("the catalogue comes back with who each type reaches", async () => {
    const response = await (await admin()).get(`${API}/notifications/rules`);
    expect(response.status()).toBe(200);
    const rows = ((await response.json()) as {
      data: { type: string; recipients: string; mandatory: boolean; configured: boolean }[];
    }).data;

    expect(rows.length).toBeGreaterThanOrEqual(10);
    // "Who gets this" is the question an administrator opens the screen
    // with, and it is a permission rather than an address list.
    expect(rows.every((r) => r.recipients.length > 5)).toBe(true);
    expect(rows.find((r) => r.type === "application.received")?.recipients).toContain(
      "application.read",
    );
  });

  test("a type can be switched off for everybody", async () => {
    const response = await (await admin()).put(`${API}/notifications/rules`, {
      data: { updates: [{ type: "content.published", enabled: false, inApp: false, email: false }] },
    });
    expect(response.status(), await response.text()).toBe(200);
    const rows = ((await response.json()) as { data: { type: string; enabled: boolean; configured: boolean }[] }).data;
    const row = rows.find((r) => r.type === "content.published");
    expect(row?.enabled).toBe(false);
    // `configured` is what tells the screen this is a decision rather than
    // a default, so an administrator can see what has been touched.
    expect(row?.configured).toBe(true);
  });

  test("a security notification cannot be switched off by the firm either", async () => {
    const response = await (await admin()).put(`${API}/notifications/rules`, {
      data: {
        updates: [{ type: "security.mfa_reset", enabled: false, inApp: false, email: false }],
      },
    });
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("Sicherheitsmeldung");
  });

  test("its e-mail copy can be", async () => {
    const response = await (await admin()).put(`${API}/notifications/rules`, {
      data: { updates: [{ type: "security.mfa_reset", enabled: true, inApp: true, email: false }] },
    });
    expect(response.status(), await response.text()).toBe(200);

    // Put it back — this one is a real security setting and the next run
    // should start from the catalogue's default.
    await (await admin()).put(`${API}/notifications/rules`, {
      data: { updates: [{ type: "security.mfa_reset", enabled: true, inApp: true, email: true }] },
    });
  });
});

/* ================================================================== */
/* Permissions                                                         */
/* ================================================================== */

test.describe("the administrative routes are guarded", () => {
  let user: Session;

  test.beforeAll(async () => {
    requireAccounts();
    // `guest` holds neither notification key — the floor of the matrix.
    user = await signIn(USER_EMAIL, TEST_PASSWORD);
  });

  test.afterAll(async () => {
    await user?.ctx.dispose();
  });

  /*
    A loop rather than `test.each`, which Playwright's runner does not have
    — unlike vitest's. Generating the cases still beats two copies of the
    assertion, and the title names which one failed.
  */
  for (const [path, key] of [
    ["/notifications/rules", "notification.configure"],
    ["/notifications/deliveries", "notification.readDeliveries"],
  ] as const) {
    test(`GET ${path} is refused without ${key}`, async () => {
      const response = await user.ctx.get(`${API}${path}`);
      expect(response.status()).toBe(403);
      // Naming the missing key is deliberate — it is not a secret, the whole
      // catalogue is visible in the role editor, and an administrator
      // debugging somebody's access needs to know which one.
      expect(await response.text()).toContain(key);
    });
  }

  test("writing the firm's rules is refused too", async () => {
    const response = await user.ctx.put(`${API}/notifications/rules`, {
      data: { updates: [{ type: "content.published", enabled: false, inApp: false, email: false }] },
    });
    expect(response.status()).toBe(403);
  });

  test("but one's own inbox and preferences need no permission at all", async () => {
    /*
      The other half, and the one that would break the dashboard if
      somebody "tidied up" by adding a key. `guest` holds two content
      permissions and nothing else.
    */
    expect((await user.ctx.get(`${API}/notifications`)).status()).toBe(200);
    expect((await user.ctx.get(`${API}/notifications/unread-count`)).status()).toBe(200);
    expect((await user.ctx.get(`${API}/notifications/preferences`)).status()).toBe(200);
  });
});

/* ================================================================== */
/* In the browser                                                      */
/* ================================================================== */

test.describe("the bell and the notification centre", () => {
  test.beforeAll(requireAccounts);
  test.afterAll(clearFactor);

  test("count, panel, open, mark read, count again", async ({ browser, baseURL }) => {
    /*
      Its own context, signed in as `mfa@iem.test`.

      Not the shared `page` fixture: that is the administrator, and the only
      reversible way to produce a notification is to change a second factor
      — which on the administrator's account would break every spec after
      this one. See the note at the top.
    */
    await clearFactor();

    const context = await browser.newContext();
    const page = await context.newPage();
    const api = await signIn(USER_EMAIL, TEST_PASSWORD);

    try {
      /*
        Start from an empty inbox.

        The blocks above ran against this same account and left read and
        unread rows behind — `clearFactor` alone raises `security.mfa_reset`
        — so asserting an absolute "1 ungelesene" without this is asserting
        against whatever happened to be there. Clearing is one request and
        makes the count in this test mean exactly the notification it
        triggers.
      */
      const emptied = await api.ctx.post(`${API}/notifications/read-all`, { data: {} });
      expect(emptied.status()).toBe(200);

      /* ---- signed in, and nothing waiting ------------------------- */
      await spendLogin();
      await page.goto(`${baseURL}/admin.html#/`);
      await page.reload();
      await page.getByLabel(/E-Mail/i).fill(USER_EMAIL);
      await page.getByLabel(/Passwort/i).first().fill(TEST_PASSWORD);
      await page.getByRole("button", { name: /^Anmelden$/ }).click();

      const bell = page.getByRole("button", { name: /^Benachrichtigungen —/ });
      await expect(bell).toBeVisible({ timeout: 30_000 });
      await expect(bell).toHaveAccessibleName(/keine ungelesenen/);

      /* ---- trigger one, out of band ------------------------------- */
      /*
        Through the API rather than the UI, because the point of the test is
        the *bell*, and the thing a bell has to do is notice something this
        tab did not cause. Enrolling in the browser would make the change
        local and prove nothing.
      */
      await enrol(api.ctx);

      // The count polls once a minute; a reload is the deterministic way to
      // ask now, and it is what a person does anyway.
      await page.reload();
      await expect(bell).toHaveAccessibleName(/1 ungelesene/, { timeout: 30_000 });

      /* ---- the panel ----------------------------------------------- */
      await bell.click();
      const panel = page.getByRole("menu", { name: "Benachrichtigungen" });
      await expect(panel).toBeVisible();
      /*
        `.first()`, because the panel shows the eight most recent and this
        account accumulates them across runs — the same title can legitimately
        appear several times. The count assertion above is what pins down that
        exactly one of them is *unread*; this only asserts that the newest is
        on screen and is the one just triggered.
      */
      await expect(
        panel.getByText(/Zwei-Faktor-Authentisierung aktiviert/).first(),
      ).toBeVisible();

      /* ---- Escape closes and returns focus ------------------------- */
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(bell).toBeFocused();

      /* ---- the centre ---------------------------------------------- */
      await page.goto(`${baseURL}/admin.html#/benachrichtigungen`);
      await expect(
        page.getByRole("heading", { name: "Benachrichtigungen", level: 1 }),
      ).toBeVisible({ timeout: 20_000 });
      /*
        Scoped to the list, not the page.

        The severity filter above it is a `<select>` whose options carry the
        same words the badges do — so a page-wide `getByText("Erledigt")`
        matches a hidden `<option>` first and reports the badge as invisible.
        The list's `aria-label` exists for the reader and settles this too.
      */
      const list = page.getByRole("list", { name: "Benachrichtigungen" });
      await expect(
        list.getByText("Zwei-Faktor-Authentisierung aktiviert").first(),
      ).toBeVisible();

      // Severity as a word, never as a colour alone.
      await expect(list.getByText("Erledigt").first()).toBeVisible();

      /* ---- mark read, and the count follows ------------------------ */
      await page.getByRole("button", { name: /als gelesen markieren/ }).first().click();
      await expect(bell).toHaveAccessibleName(/keine ungelesenen/, { timeout: 20_000 });

      /* ---- the settings tab ---------------------------------------- */
      await page.getByRole("link", { name: "Einstellungen" }).click();
      await expect(
        page.getByRole("heading", { name: /Wie möchten Sie benachrichtigt werden/ }),
      ).toBeVisible({ timeout: 20_000 });

      // The four security rows say they cannot be switched off, rather than
      // offering a switch that does nothing.
      await expect(page.getByText("Immer aktiv").first()).toBeVisible();
      // Grouped under headings a person thinks in, not a table of keys.
      await expect(page.getByText("Sicherheit", { exact: true }).first()).toBeVisible();
      await expect(page.locator("body")).not.toContainText("security.mfa_enabled");
    } finally {
      await api.ctx.dispose();
      await page.close();
      await context.close();
    }
  });

  test("the shell renders the bell cleanly for the administrator", async ({
    page,
    collected,
    signIn: ready,
  }) => {
    /*
      The shared context, read-only. The bell is in the header on every
      screen of the dashboard, so it is the one new component that every
      other spec renders whether it means to or not — and a console error in
      it would surface as a failure two files away.
    */
    await ready();
    await page.goto("/admin.html#/");
    await expect(page.getByRole("button", { name: /^Benachrichtigungen —/ })).toBeVisible();
    expectClean(collected, "die Kopfzeile mit der Glocke");
  });

  test("the organisation's section is reachable from Einstellungen", async ({ page, signIn: ready }) => {
    await ready();
    await page.goto("/admin.html#/einstellungen/benachrichtigungen");
    await expect(
      page.getByRole("heading", { name: "Welche Ereignisse benachrichtigen" }),
    ).toBeVisible({ timeout: 20_000 });
    // The delivery log, behind its own permission and in the same section.
    await expect(page.getByRole("heading", { name: "Zustellprotokoll" })).toBeVisible();
    // Who each type reaches, as a permission rather than an address list.
    await expect(page.getByText(/Alle mit der Berechtigung/).first()).toBeVisible();
  });
});
