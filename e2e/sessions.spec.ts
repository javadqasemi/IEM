import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API,
  TEST_PASSWORD,
  apiAs,
  expect,
  spendLogin,
  test,
} from "./fixtures";
import { request, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

/**
 * Active sessions, over the live API and in the browser.
 *
 * Three things here cannot be proved anywhere else:
 *
 * - **Nothing secret leaves.** `tokenHash` is what the server compares a
 *   presented cookie against, so a response carrying one hands out a
 *   credential equivalent — and the response would look entirely normal. Only
 *   a real body can show that it does not.
 * - **"Andere beenden" keeps the caller signed in.** The distinction from
 *   `logout-all` is the whole point of the control, and it lives in a
 *   `where` clause built from the *presented cookie* — so it cannot be
 *   exercised without a real request that carries one.
 * - **The current session is the one marked.** Same reason: it is the hash of
 *   the cookie the request actually arrived with.
 *
 * **Nothing here revokes an administrator session**, and that is the whole
 * reason the revoking test has an account of its own. `auth.spec.ts` already
 * paid for this lesson in full: a family revocation run against the
 * administrator also ends the **shared browser context** every other spec
 * signs in with, because it is the same user — and it does not fail here. It
 * fails two specs later as *"Hauptnavigation not found"* over a screenshot of
 * the login form, which reads as a broken shell. The read-only tests may use
 * the administrator; anything that writes uses the guest.
 */

/** The account whose sessions this spec is allowed to end. */
const SURGERY_EMAIL = "gast@iem.test";

/**
 * Skipped, not failed, when the role accounts are not seeded — the same
 * opt-in `security.spec.ts` and `auth.spec.ts` use. A red suite on a machine
 * that has not run `SEED_TEST_USERS=true npm run server:seed` is one people
 * learn to ignore.
 */
function requireSurgeryAccount(): void {
  test.skip(
    !TEST_PASSWORD,
    "SEED_TEST_PASSWORD ist nicht gesetzt — `SEED_TEST_USERS=true npm run server:seed` " +
      "legt das Konto an, dessen Sitzungen dieser Test beenden darf.",
  );
}

/** What one sign-in leaves a device holding. */
type Device = { accessToken: string; refreshToken: string };

/** The `refresh_token` value out of a response's `Set-Cookie` headers. */
function refreshCookieFrom(response: APIResponse): string | null {
  for (const header of response.headersArray()) {
    if (header.name.toLowerCase() !== "set-cookie") continue;
    const match = /(?:^|;|\n)\s*refresh_token=([^;\s]+)/.exec(header.value);
    if (match) return match[1];
  }
  return null;
}

/**
 * One device: an access token and the cookie the browser would have been
 * given, taken out of a throwaway context.
 *
 * The cookie is carried **by hand** on the calls below rather than left in a
 * jar. A jar would work and would hide which request is presenting what, and
 * the entire question this file asks is which session the server thinks is
 * speaking.
 *
 * `spendLogin()` reserves the attempt against the suite-wide budget first —
 * `/auth/login` allows ten a minute per IP, and `login-budget.spec.ts` fails
 * if a sign-in path forgets.
 */
async function signInAsGuest(): Promise<Device> {
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
  return { accessToken: body.data.accessToken, refreshToken: cookie! };
}

type SessionRow = { id: string; current: boolean };

/** Reads the list as `device` — with its cookie, so one row comes back current. */
async function sessionsOf(api: APIRequestContext, device: Device): Promise<SessionRow[]> {
  const response = await api.get(`${API}/auth/sessions`, {
    headers: {
      Authorization: `Bearer ${device.accessToken}`,
      Cookie: `refresh_token=${device.refreshToken}`,
    },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: SessionRow[] }).data;
}

test.describe("the sessions API", () => {
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    admin = await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test.afterAll(async () => {
    await admin.dispose();
  });

  test("lists live sessions and leaks no token material", async () => {
    const response = await admin.get(`${API}/auth/sessions`);
    expect(response.status()).toBe(200);

    const body = await response.text();
    for (const secret of ["tokenHash", "replacedById", "refreshToken", "revokedAt"]) {
      expect(body, `${secret} must never reach a response body`).not.toContain(secret);
    }

    const rows = (JSON.parse(body) as { data: Record<string, unknown>[] }).data;
    expect(rows.length).toBeGreaterThan(0);

    // The shape is an allowlist on the server, so this is the assertion that
    // adding a column to `RefreshToken` cannot widen it by accident.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "current",
        "device",
        "expiresAt",
        "id",
        "ip",
        "lastActiveAt",
      ]);
    }
  });

  test("refuses a session that is not the caller's", async () => {
    /*
      A fabricated id and an id belonging to somebody else get the **same**
      answer, and deliberately: telling them apart would turn this route into
      a way of asking whether a session id is real.
    */
    const response = await admin.delete(`${API}/auth/sessions/cmzzzznotarealid0000`);
    expect(response.status()).toBe(400);
    expect((await response.json()).message).toMatch(/gibt es nicht/);
  });

  /**
   * The split from `logout-all`, which is the control's whole reason to
   * exist — and the second act, which is the branch that surprised this test
   * when it was first written.
   *
   * `revokeOtherSessions` keeps the session whose hash matches the presented
   * cookie. With **no** cookie there is nothing to keep, and the service
   * revokes every live token rather than none: the comment on that `where`
   * makes the argument, which is that `tokenHash: { not: null }` would match
   * nothing and report success. That is the honest reading of "everything
   * other than a session I do not have", it errs towards revoking too much,
   * and until this ran it was a claim in a comment.
   */
  test("keeps the calling session and, without one, keeps nothing", async () => {
    requireSurgeryAccount();

    const keeper = await signInAsGuest();
    const other = await signInAsGuest();

    const before = await sessionsOf(admin, keeper);
    expect(before.length).toBeGreaterThanOrEqual(2);
    // Exactly one row is the caller's, and it is the cookie that decides.
    expect(before.filter((s) => s.current)).toHaveLength(1);

    const revoked = await admin.post(`${API}/auth/sessions/revoke-others`, {
      headers: {
        Authorization: `Bearer ${keeper.accessToken}`,
        Cookie: `refresh_token=${keeper.refreshToken}`,
      },
      data: {},
    });
    expect(revoked.status()).toBe(200);
    expect((await revoked.json()).data.revoked).toBeGreaterThanOrEqual(1);

    const after = await sessionsOf(admin, keeper);
    expect(after).toHaveLength(1);
    expect(after[0].current).toBe(true);

    // The other device is genuinely gone: its cookie no longer renews.
    const refusedElsewhere = await admin.post(`${API}/auth/refresh`, {
      headers: { Cookie: `refresh_token=${other.refreshToken}` },
    });
    expect(refusedElsewhere.status()).toBe(401);

    /*
      Act two. Same route, same account, no cookie — so the server cannot be
      asked to keep anything, and does not.
    */
    const withoutCookie = await admin.post(`${API}/auth/sessions/revoke-others`, {
      headers: { Authorization: `Bearer ${keeper.accessToken}` },
      data: {},
    });
    expect(withoutCookie.status()).toBe(200);
    expect((await withoutCookie.json()).data.revoked).toBe(1);

    const emptied = await sessionsOf(admin, keeper);
    expect(emptied).toHaveLength(0);

    /*
      And the access token still works, which is the part a reader of the
      route name would not predict: revoking refresh tokens ends the ability
      to *renew*, not the fifteen minutes already issued. Saying so here is
      cheaper than somebody rediscovering it during an incident.
    */
    const stillUsable = await admin.get(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${keeper.accessToken}` },
    });
    expect(stillUsable.status()).toBe(200);
  });
});

/**
 * The administrative half of P2-9 — somebody else's sessions.
 *
 * `security.spec.ts` owns the question of *who may*; this owns what the
 * routes actually do once they are allowed. Three things here cannot be
 * proved anywhere else, and all three need a real account with real rows:
 *
 * - **An unknown user is a 404, not an empty list.** The distinction is the
 *   whole reason `sessionsOf` looks the user up before answering, and it is
 *   invisible from any fixture — an empty array and a non-existent account
 *   render identically.
 * - **Nothing is marked `current` when reading somebody else's.** The flag is
 *   computed from the hash of the cookie the request arrived with, so an
 *   administrator's cookie cannot match a guest's rows. Only a real request
 *   carrying a real cookie can show that.
 * - **The revoke is scoped to the user in the path.** Two accounts, one
 *   session id, and the wrong route must refuse it.
 */
test.describe("one account's sessions, as an administrator", () => {
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    admin = await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test.afterAll(async () => {
    await admin.dispose();
  });

  /** The guest's id, which the administrator is allowed to look up. */
  async function guestId(): Promise<string> {
    const response = await admin.get(`${API}/users`, { params: { search: SURGERY_EMAIL } });
    expect(response.status()).toBe(200);
    const items = ((await response.json()) as { data: { items: { id: string; email: string }[] } })
      .data.items;
    const found = items.find((u) => u.email === SURGERY_EMAIL);
    expect(found, `${SURGERY_EMAIL} ist nicht geseedet`).toBeTruthy();
    return found!.id;
  }

  test("answers 404 for an account that does not exist, not an empty list", async () => {
    // The assertion `sessionsOf`'s `existing()` call is there for. `200 []`
    // would be indistinguishable from a real account nobody is signed in to,
    // so an administrator checking whether a suspicious session is still live
    // would read the wrong answer to the question they asked.
    const response = await admin.get(`${API}/users/cmzzzznotarealid0000/sessions`);
    expect(response.status()).toBe(404);
  });

  test("lists them, marks none of them current, and leaks no token material", async () => {
    requireSurgeryAccount();

    const device = await signInAsGuest();
    const id = await guestId();

    const response = await admin.get(`${API}/users/${id}/sessions`);
    expect(response.status()).toBe(200);

    const body = await response.text();
    for (const secret of ["tokenHash", "replacedById", "refreshToken", "revokedAt"]) {
      expect(body, `${secret} must never reach a response body`).not.toContain(secret);
    }

    const rows = (JSON.parse(body) as { data: SessionRow[] }).data;
    expect(rows.length).toBeGreaterThan(0);

    /*
      Not one of the guest's rows is the administrator's own session, and the
      server works that out by comparing hashes rather than by being told
      which request is administrative. Getting this backwards would put the
      "Ihre Sitzung" badge — and the different, scarier confirmation that goes
      with it — on an arbitrary row of somebody else's table.
    */
    expect(rows.every((s) => !s.current)).toBe(true);

    // Tidy up after ourselves: the guest's sessions are this spec's to end.
    await admin.post(`${API}/users/${id}/sessions/revoke-all`, { data: {} });
    const gone = await admin.post(`${API}/auth/refresh`, {
      headers: { Cookie: `refresh_token=${device.refreshToken}` },
    });
    expect(gone.status()).toBe(401);
  });

  test("revokes only within the account named in the path", async () => {
    requireSurgeryAccount();

    await signInAsGuest();
    const id = await guestId();

    const listed = await admin.get(`${API}/users/${id}/sessions`);
    const rows = ((await listed.json()) as { data: SessionRow[] }).data;
    expect(rows.length).toBeGreaterThan(0);
    const sessionId = rows[0].id;

    /*
      The same session id, asked for under a different account. It exists, and
      it is still refused — `AuthService.revokeSession` scopes by the owner in
      its `where` *and* re-checks it in `refuseRevoke`, so a pasted id from
      another user's page cannot reach across.

      A fabricated id would have proved nothing here: it would be refused for
      being fake rather than for belonging to somebody else.
    */
    const meResponse = await admin.get(`${API}/auth/me`);
    const adminId = ((await meResponse.json()) as { data: { id: string } }).data.id;
    const crossed = await admin.delete(`${API}/users/${adminId}/sessions/${sessionId}`);
    expect(crossed.status()).toBe(400);

    // And under the right account it works.
    const proper = await admin.delete(`${API}/users/${id}/sessions/${sessionId}`);
    expect(proper.status()).toBe(200);
    expect((await proper.json()).data.revoked).toBe(true);
    // Not the administrator's own session, so nothing to sign out of.
    expect((await (await admin.get(`${API}/users/${id}/sessions`)).json()).data).toHaveLength(0);
  });

  test("revoke-all reports how many it ended", async () => {
    requireSurgeryAccount();

    await signInAsGuest();
    await signInAsGuest();
    const id = await guestId();

    const response = await admin.post(`${API}/users/${id}/sessions/revoke-all`, { data: {} });
    expect(response.status()).toBe(200);
    // The count is why `logoutAll` stopped returning `void`: "2 Sitzungen
    // beendet" and "nothing happened" are different outcomes and the screen
    // says which.
    expect((await response.json()).data.revoked).toBeGreaterThanOrEqual(2);

    const after = await admin.get(`${API}/users/${id}/sessions`);
    expect((await after.json()).data).toHaveLength(0);
  });
});

test.describe("the sessions card", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  /** The table, by its caption — the page has more than one table on it. */
  function sessionsTable(page: Page) {
    return page.getByRole("table", { name: /Aktive Sitzungen/ });
  }

  test("shows this browser's own session, marked and first", async ({ page }) => {
    await page.goto("/admin.html#/profil");
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    await expect(page.getByRole("heading", { name: "Aktive Sitzungen" })).toBeVisible({
      timeout: 15_000,
    });

    const table = sessionsTable(page);
    await expect(table).toBeVisible({ timeout: 15_000 });

    // The badge is the safety feature: it is the row a reader looks for in
    // order to avoid it.
    await expect(table.getByText("Diese Sitzung")).toBeVisible();

    // And it is the first row, so it is not hunted for among near-identical
    // "Chrome auf Windows" entries.
    expect(await table.getByRole("row").nth(1).textContent()).toContain("Diese Sitzung");

    // Nothing secret is rendered, either.
    expect(await table.textContent()).not.toMatch(/tokenHash|[0-9a-f]{64}/);
  });

  test("warns differently before ending the session in use", async ({ page }) => {
    await page.goto("/admin.html#/profil");
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    const table = sessionsTable(page);
    await expect(table.getByText("Diese Sitzung")).toBeVisible({ timeout: 15_000 });

    // The current row's own "Beenden".
    await table.getByRole("row").nth(1).getByRole("button", { name: "Beenden" }).click();

    /*
      The distinct wording is the point. Ending your own session is allowed —
      refusing would send the reader to the sign-out menu to do the same
      thing by another route — so what protects them is that the dialog says
      something different.
    */
    await expect(page.getByRole("heading", { name: "Diese Sitzung beenden?" })).toBeVisible();
    await expect(page.getByText(/sofort abgemeldet/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Hier abmelden" })).toBeVisible();

    // Cancelled, because confirming would end the shared worker session and
    // every spec after this one with it.
    await page.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("heading", { name: "Diese Sitzung beenden?" })).toHaveCount(0);
  });
});
