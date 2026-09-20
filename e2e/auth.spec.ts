import { request, type APIRequestContext, type APIResponse } from "@playwright/test";
import { REFRESH_GRACE_MS } from "../server/src/auth/auth.rules";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API,
  TEST_PASSWORD,
  expect,
  spendLogin,
  test,
} from "./fixtures";

/**
 * Sign-in, rotation and session restore, **against the live API and a real
 * browser** — because none of it can be proved anywhere else.
 *
 * The bug this suite was written for did not live in any one file. Every tab
 * turns its refresh cookie into a session when it boots; the server rotates that
 * cookie on every use and revokes the whole family if a rotated one comes back.
 * Both halves are correct on their own. Together they meant that **opening the
 * dashboard in a second tab signed the user out of every device they owned** —
 * the two requests carried the same cookie because the first reply had not
 * arrived yet, and the second therefore looked exactly like a stolen credential
 * being replayed.
 *
 * A unit test cannot see it: one process, one cookie jar, one in-flight promise
 * that dedupes the calls. It needs two senders and a real rotation, which is
 * this file.
 *
 * The constant comes from the server's own module rather than being restated
 * here — a duplicated thirty seconds would go stale the first time somebody
 * tuned it, and the test would then be waiting for a window that had moved.
 */

/**
 * Serial, and sparing with sign-ins.
 *
 * `/auth/login` allows ten attempts a minute per IP and this spec shares that
 * budget with every other suite in the run — the lesson `playwright.config.ts`
 * records is that it is the *sign-ins* that are budgeted, not the requests. So
 * the two tests that leave their session intact thread one family forward
 * between them, and only the two that deliberately destroy a family pay for one
 * of their own.
 */
test.describe.configure({ mode: "serial" });

/** The live token of the shared family, moved along by each rotation. */
let shared = "";

/**
 * The account whose sessions this spec is allowed to destroy.
 *
 * **Not the administrator, and that is the whole point.** Reuse detection
 * revokes *every* live refresh token the account has — `updateMany({ where: {
 * userId, revokedAt: null } })` — which is exactly the property the test
 * below exists to prove. Run against the administrator, it also revoked the
 * **shared browser context** every other spec signs in with, because that is
 * the same user.
 *
 * The failure that produced was perfectly opaque: the worker context keeps
 * working until something needs a *refresh*, so nothing broke here. It broke
 * later, in whichever spec first opened a fresh page — `budgets.spec.ts` —
 * as `Hauptnavigation not found` over a screenshot of the login form, with no
 * throttle error on it. Three separate investigations blamed the rate limit.
 * The audit log is what settled it: `auth.refresh_reuse_detected` — *"alle
 * Sitzungen beendet"* — immediately followed by two `auth.refresh_revoked`.
 *
 * Using a different account isolates the surgery without weakening it: the
 * revocation is per user, so the assertion is unchanged. `/auth/refresh` and
 * `/auth/me` need no permissions, so the guest account is enough.
 */
const SURGERY_EMAIL = "gast@iem.test";

/**
 * Signs in and returns the cookie the browser would have been given.
 *
 * A bare context per sign-in, so each test owns its own session and one test
 * revoking a family cannot end another's. `spendLogin()` reserves the attempt
 * against the suite-wide budget first — `/auth/login` allows ten a minute per
 * IP, and this spec is one of six paths that reach it. Reacting to a 429
 * afterwards is what that replaced; see the note on `spendLogin`.
 */
/**
 * Skipped, not failed, when the role accounts are not seeded.
 *
 * The same opt-in `security.spec.ts` uses: a red suite on a machine that has
 * not run `SEED_TEST_USERS=true npm run server:seed` is one people learn to
 * ignore. The browser tests below need no test account and still run.
 */
function requireSurgeryAccount(): void {
  test.skip(
    !TEST_PASSWORD,
    "SEED_TEST_PASSWORD ist nicht gesetzt — `SEED_TEST_USERS=true npm run server:seed` " +
      "legt das Konto an, dessen Sitzungen dieser Test beenden darf.",
  );
}

async function signIn(): Promise<{ refreshToken: string; accessToken: string }> {
  await spendLogin();
  const anonymous = await request.newContext();
  const response = await anonymous.post(`${API}/auth/login`, {
    data: { email: SURGERY_EMAIL, password: TEST_PASSWORD },
  });
  expect(response.ok(), `sign-in failed with HTTP ${response.status()}`).toBe(true);

  const body = (await response.json()) as { data: { accessToken: string } };
  const cookie = refreshCookieFrom(response);
  await anonymous.dispose();

  expect(cookie, "the login response set no refresh cookie").toBeTruthy();
  return { refreshToken: cookie!, accessToken: body.data.accessToken };
}

/**
 * What a call left behind, read **before** its context is disposed.
 *
 * Disposing an `APIRequestContext` invalidates every response fetched through
 * it — `response.json()` afterwards throws *"Response has been disposed"* — and
 * each helper here owns a throwaway context, so the body and the headers have to
 * be taken out while it is still alive. Returning a plain object rather than an
 * `APIResponse` makes that impossible to get wrong at a call site.
 */
type Reply = {
  status: number;
  /** The `refresh_token` this response set, if any. */
  cookie: string | null;
  accessToken: string | null;
  expiresIn: number | null;
};

/** The `refresh_token` value out of a response's `Set-Cookie` headers. */
function refreshCookieFrom(response: APIResponse): string | null {
  for (const header of response.headersArray()) {
    if (header.name.toLowerCase() !== "set-cookie") continue;
    const match = /(?:^|;|\n)\s*refresh_token=([^;\s]+)/.exec(header.value);
    if (match) return match[1];
  }
  return null;
}

async function read(response: APIResponse): Promise<Reply> {
  const cookie = refreshCookieFrom(response);
  let accessToken: string | null = null;
  let expiresIn: number | null = null;
  if (response.ok()) {
    const body = (await response.json()) as {
      data?: { accessToken?: string; expiresIn?: number };
    };
    accessToken = body.data?.accessToken ?? null;
    expiresIn = body.data?.expiresIn ?? null;
  }
  return { status: response.status(), cookie, accessToken, expiresIn };
}

/**
 * Presents one specific refresh token, from a context that holds no cookies of
 * its own.
 *
 * Sending the cookie by hand is what makes the race deterministic. Two parallel
 * calls on a *shared* context might be serialised by the client, and the second
 * would then carry the token the first was issued — which is the case that never
 * failed. Two contexts each told to send the same value is the case that did.
 */
async function refreshWith(token: string): Promise<Reply> {
  const context = await request.newContext({
    extraHTTPHeaders: { cookie: `refresh_token=${token}` },
  });
  try {
    return await read(await context.post(`${API}/auth/refresh`));
  } finally {
    await context.dispose();
  }
}

async function meWith(accessToken: string): Promise<number> {
  const context: APIRequestContext = await request.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
  });
  try {
    return (await context.get(`${API}/auth/me`)).status();
  } finally {
    await context.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Rotation                                                            */
/* ------------------------------------------------------------------ */

test.describe("refresh-token rotation", () => {
  test.beforeAll(async () => {
    requireSurgeryAccount();
    shared = (await signIn()).refreshToken;
  });

  test("rotates on use and hands back a working session", async () => {
    const rotated = await refreshWith(shared);
    expect(rotated.status).toBe(200);

    expect(rotated.cookie, "a rotation must issue a new cookie").toBeTruthy();
    expect(rotated.cookie).not.toBe(shared);

    expect(rotated.expiresIn).toBeGreaterThan(0);
    expect(await meWith(rotated.accessToken!)).toBe(200);

    shared = rotated.cookie!;
  });

  /**
   * **The regression this whole change exists for.**
   *
   * Three senders, one cookie, all at once — which is what two or three tabs
   * restoring a session look like from the server's side. Before the grace
   * window, one of these came back 200 and the rest came back 401, and the 401s
   * were not the end of it: each one revoked *every* refresh token the account
   * had, so the tab that succeeded was signed out a moment later too, along with
   * every other browser and device the person was signed in on.
   *
   * The assertion is therefore not "no errors" but the two facts a user would
   * notice: every caller got a session, and the family is still alive
   * afterwards.
   */
  test("serves concurrent refreshes carrying the same cookie", async () => {
    const responses = await Promise.all([
      refreshWith(shared),
      refreshWith(shared),
      refreshWith(shared),
    ]);

    expect(
      responses.map((r) => r.status),
      "a second tab restoring its session is not a stolen token",
    ).toEqual([200, 200, 200]);

    // And the session still works: the newest cookie refreshes again, which it
    // could not do if the family had been revoked.
    const newest = responses.at(-1)!.cookie;
    expect(newest).toBeTruthy();
    const again = await refreshWith(newest!);
    expect(again.status).toBe(200);

    shared = again.cookie!;
  });

  /**
   * The other half, and the reason the grace window is thirty seconds and not
   * an hour: outside it, a rotated token is still treated as theft and the
   * family still goes.
   *
   * It costs the length of the window in wall clock, once. That is the price of
   * proving a security control is wired in rather than only unit-tested — and
   * this is the one control here whose failure mode is silent, because a
   * too-wide window looks exactly like a working system.
   */
  test("still revokes the family when a rotated token comes back late", async () => {
    test.setTimeout(REFRESH_GRACE_MS + 45_000);

    const { refreshToken } = await signIn();
    const rotated = await refreshWith(refreshToken);
    expect(rotated.status).toBe(200);
    const successor = rotated.cookie!;

    await new Promise((resolve) => setTimeout(resolve, REFRESH_GRACE_MS + 2_000));

    const replayed = await refreshWith(refreshToken);
    expect(replayed.status, "a token rotated long ago is a replay").toBe(401);

    expect(
      (await refreshWith(successor)).status,
      "detecting a replay must end the whole family, including the live token",
    ).toBe(401);
  });

  test("refuses a refresh with no cookie at all", async () => {
    const context = await request.newContext();
    const status = (await context.post(`${API}/auth/refresh`)).status();
    await context.dispose();
    expect(status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/* Sign-out                                                            */
/* ------------------------------------------------------------------ */

test.describe("signing out", () => {
  /**
   * A deliberate sign-out is not a theft alarm.
   *
   * The distinction is invisible from the status code — both are 401 — and it
   * is the audit log that suffers: reading an ordinary sign-out as a replayed
   * credential wrote `auth.refresh_reuse_detected`, which is the row an incident
   * review starts from. What is asserted here is the part a request can see:
   * the token is refused, and refusing it does not need the family destroyed
   * because a sign-out already took it.
   */
  test("refuses the cookie it just cleared", async () => {
    requireSurgeryAccount();
    const { refreshToken, accessToken } = await signIn();

    const context = await request.newContext({
      extraHTTPHeaders: {
        Authorization: `Bearer ${accessToken}`,
        cookie: `refresh_token=${refreshToken}`,
      },
    });
    const out = (await context.post(`${API}/auth/logout`)).status();
    await context.dispose();
    expect(out).toBe(204);

    expect((await refreshWith(refreshToken)).status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/* The browser                                                         */
/* ------------------------------------------------------------------ */

const RAIL = { name: "Hauptnavigation" } as const;

test.describe("the dashboard in a browser", () => {
  /**
   * Signing in returns you to the page you asked for.
   *
   * The shell renders the sign-in form *in place of* the requested screen rather
   * than navigating anywhere, so the address is still the deep link while the
   * password is being typed — and the form used to throw it away by going to
   * `/` on success. Somebody following a colleague's link to a plan landed on
   * the dashboard and had to find it again, which is the moment the link existed
   * to save.
   */
  test("returns to the requested page after signing in", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await spendLogin();
    await page.goto("/admin.html#/plaene");
    await page.getByLabel(/E-Mail/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/Passwort/i).first().fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /^Anmelden$/ }).click();

    await expect(page.getByRole("navigation", RAIL)).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).hash).toBe("#/plaene");
    await expect(page.getByText(/jemand baut danach/i).first()).toBeVisible();

    await context.close();
  });

  /**
   * Three tabs: opened together they all survive, and signing out of one signs
   * out the rest.
   *
   * One test rather than two because it is one story and **one sign-in**, which
   * is the budgeted resource here. The first half is the browser-level shape of
   * the rotation race above: each page boots, each asks for a session, and they
   * share one cookie jar. The second half is the opposite direction — the cookie
   * they share is revoked the moment one of them signs out, so the rest are
   * drawing a dashboard for a session that no longer exists. They used to keep
   * doing it until their own access token expired, up to fifteen minutes later,
   * and the first thing the reader did then failed for no visible reason.
   * `BroadcastChannel` is what closes that, and only a second real tab can show
   * it working.
   */
  test("shares one session across tabs, in both directions", async ({ browser }) => {
    const context = await browser.newContext();
    const first = await context.newPage();

    await spendLogin();
    await first.goto("/admin.html#/");
    await first.getByLabel(/E-Mail/i).fill(ADMIN_EMAIL);
    await first.getByLabel(/Passwort/i).first().fill(ADMIN_PASSWORD);
    await first.getByRole("button", { name: /^Anmelden$/ }).click();
    await expect(first.getByRole("navigation", RAIL)).toBeVisible({ timeout: 30_000 });

    // Opened simultaneously and pointed at two different screens, so each has
    // its own work to do once its session is restored.
    const [second, third] = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all([second.goto("/admin.html#/projekte"), third.goto("/admin.html#/plaene")]);

    await expect(second.getByRole("navigation", RAIL)).toBeVisible({ timeout: 30_000 });
    await expect(third.getByRole("navigation", RAIL)).toBeVisible({ timeout: 30_000 });

    // The first tab was signed in before the others booted; if their refreshes
    // had been read as a replay, its session would be gone by now.
    await first.reload();
    await expect(first.getByRole("navigation", RAIL)).toBeVisible({ timeout: 30_000 });

    await first.getByRole("button", { name: "Benutzerkonto" }).click();
    await first.getByRole("menuitem", { name: "Abmelden" }).click();
    await expect(first.getByRole("button", { name: /^Anmelden$/ })).toBeVisible();

    for (const other of [second, third]) {
      await expect(
        other.getByRole("button", { name: /^Anmelden$/ }),
        "a tab is still showing a dashboard for a session that has ended",
      ).toBeVisible({ timeout: 15_000 });
    }

    await context.close();
  });
});


