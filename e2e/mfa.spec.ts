import { request, type APIRequestContext, type APIResponse } from "@playwright/test";
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
import { base32Decode, hotp, settleIntoStep, totp, waitForNextStep, wrongCode } from "./totp";

/**
 * The second factor, end to end, against the live API and in a real browser.
 *
 * ---
 *
 * ## Why this cannot be a unit test
 *
 * `mfa.rules.test.ts` covers the arithmetic exhaustively and cannot see any
 * of the following, all of which are the actual product:
 *
 * - **A correct password issues nothing.** The property the whole feature
 *   rests on is that a login against an enrolled account returns no access
 *   token and sets no refresh cookie, and only a real response can show that
 *   the `Set-Cookie` header is absent.
 * - **A recovery code is spendable exactly once.** The guarantee is a single
 *   `updateMany` and Postgres's row lock; in a unit test it is a mock
 *   agreeing with itself.
 * - **The replay guard survives the compiled build.** `useDefineForClassFields`
 *   and `emitDecoratorMetadata` both differ between esbuild and `tsc`, and
 *   CLAUDE.md records two whole waves of green unit tests over shipped code
 *   that was wrong. An assertion against the running API is the only guard
 *   that would have caught either.
 * - **The permission actually guards the route.**
 *   `permissions.agreement.test.ts` reads source text; it cannot tell whether
 *   the decorator fires.
 *
 * ## The account, and why it is its own
 *
 * `mfa@iem.test` exists for this file alone. MFA state is persistent and
 * cross-cutting, so enrolling on an account another spec signs in with would
 * break that spec — two files later, as *"Hauptnavigation not found"* over a
 * screenshot of the login form, which is the misdiagnosis CLAUDE.md records
 * three times. **The administrator is never enrolled here**: it is the shared
 * browser context every other spec runs in.
 *
 * ## The two clocks this file waits on, and the timeout that follows
 *
 * It is the slowest spec in the suite, unavoidably, and for two reasons that
 * are both features working:
 *
 * - **The replay guard** refuses a time step at or below the one already
 *   accepted, so any test that authenticates twice with the same credential
 *   has to cross a thirty-second boundary. `waitForNextStep` is where that
 *   happens, and it is called as few times as the assertions allow.
 * - **The sign-in throttle** is ten a minute per IP and this file needs about
 *   twenty sign-ins. `spendLogin` paces them at eight a minute, so a test can
 *   legitimately sit for a minute before its first request leaves.
 *
 * Those two can land in the same test, which is more than the suite's
 * 90-second budget can hold — the same arithmetic that made CLAUDE.md raise
 * the global timeout from 45 to 90 for a 61-second ride-out. Three minutes is
 * the ceiling here, set on the file rather than globally: every other spec
 * should still fail fast.
 */
test.describe.configure({ timeout: 180_000 });

const MFA_EMAIL = "mfa@iem.test";

/** Skipped, not failed, when the role accounts are not seeded. */
function requireAccounts(): void {
  test.skip(
    !TEST_PASSWORD,
    "SEED_TEST_PASSWORD ist nicht gesetzt — `SEED_TEST_USERS=true npm run server:seed` " +
      "legt mfa@iem.test an, das Konto, an dem dieser Test den zweiten Faktor ein- und ausschaltet.",
  );
}

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

type LoginBody = {
  mfaRequired?: boolean;
  challenge?: string;
  accessToken?: string;
  usedRecoveryCode?: boolean;
  remainingRecoveryCodes?: number;
  user?: { email: string };
};

/**
 * Everything a response says, read **before** its context is disposed.
 *
 * Playwright invalidates every response a context produced the moment the
 * context is disposed, so a helper that returns the `APIResponse` and cleans
 * up on the way out hands back an object whose `json()` throws. Reading the
 * body here and returning plain data is what makes the cleanup safe — and the
 * cleanup is not optional: this file makes about forty requests from
 * throwaway contexts, and leaking them is the "no leaked Playwright contexts"
 * the brief asks for.
 */
type Answer = { status: number; body: LoginBody; text: string; cookie: string | null };

/** The `refresh_token` out of a response's `Set-Cookie` headers, or `null`. */
function refreshCookieFrom(response: APIResponse): string | null {
  for (const header of response.headersArray()) {
    if (header.name.toLowerCase() !== "set-cookie") continue;
    const match = /(?:^|;|\n)\s*refresh_token=([^;\s]+)/.exec(header.value);
    if (match) return match[1];
  }
  return null;
}

function unwrap(text: string): LoginBody {
  try {
    return ((JSON.parse(text) as { data?: LoginBody }).data ?? {}) as LoginBody;
  } catch {
    return {};
  }
}

/**
 * A raw sign-in from a throwaway context, with the budget reserved first.
 *
 * Anonymous on purpose: a sign-in must not ride on an existing session's
 * cookie jar, or the refresh cookie from a previous call would travel with it
 * and the assertions about `Set-Cookie` would be reading the wrong thing.
 */
async function login(email = MFA_EMAIL, password = TEST_PASSWORD): Promise<Answer> {
  await spendLogin();
  const anonymous = await request.newContext();
  try {
    const response = await anonymous.post(`${API}/auth/login`, { data: { email, password } });
    const text = await response.text();
    return { status: response.status(), body: unwrap(text), text, cookie: refreshCookieFrom(response) };
  } finally {
    await anonymous.dispose();
  }
}

/** A sign-in that is expected to stop at the factor, returning the challenge. */
async function challengeFor(email = MFA_EMAIL): Promise<string> {
  const answer = await login(email);
  expect(answer.status, answer.text).toBe(200);
  expect(answer.body.mfaRequired, "erwartet wurde eine Zwei-Faktor-Aufforderung").toBe(true);
  return answer.body.challenge!;
}

/** Finishing a challenge, with the MFA budget reserved first. */
async function answerChallenge(
  challenge: string,
  input: { code?: string; recoveryCode?: string },
): Promise<Answer> {
  await spendMfa();
  const anonymous = await request.newContext();
  try {
    const response = await anonymous.post(`${API}/auth/mfa/challenge`, {
      data: { challenge, ...input },
    });
    const text = await response.text();
    return { status: response.status(), body: unwrap(text), text, cookie: refreshCookieFrom(response) };
  } finally {
    await anonymous.dispose();
  }
}

/** A request context carrying `mfa@iem.test`'s bearer token. */
async function asMfaUser(): Promise<APIRequestContext> {
  const answer = await login();
  expect(answer.status, `mfa@iem.test konnte sich nicht anmelden: ${answer.text}`).toBe(200);
  expect(answer.body.accessToken, "die Anmeldung lieferte kein Zugriffstoken").toBeTruthy();
  return request.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${answer.body.accessToken}` },
  });
}

/** Opens a re-authentication window for the given context. */
async function reauthenticate(
  ctx: APIRequestContext,
  input: { password: string; code?: string; recoveryCode?: string },
): Promise<string> {
  await spendMfa();
  const response = await ctx.post(`${API}/auth/reauthenticate`, { data: input });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: { token: string } }).data.token;
}

/* ------------------------------------------------------------------ */
/* The clock                                                           */
/* ------------------------------------------------------------------ */

/**
 * The time step this run has already spent, and the helper that respects it.
 *
 * **This is the replay guard being right, not the suite working around it.**
 * A TOTP code is valid for its whole thirty-second step, so the server
 * records the step it accepted and refuses anything at or below it. A test
 * that authenticates twice inside one step therefore gets `401 Dieser Code
 * stimmt nicht` on the second — which reads as a wrong code and is the
 * feature working exactly as `judgeTotp` documents.
 *
 * Tracking the step rather than waiting unconditionally is what keeps the
 * file from costing thirty seconds per assertion: most of the time the clock
 * has already moved on its own and nothing waits at all.
 */
const currentStep = () => Math.floor(Date.now() / 1000 / 30);
let spentStep = -1;

/** A code that has not been presented yet, waiting only if it has to. */
async function freshTotp(secret: string): Promise<string> {
  if (currentStep() <= spentStep) await waitForNextStep();
  // And enough of the step left that it is still current when it arrives.
  await settleIntoStep();
  spentStep = currentStep();
  return totp(secret);
}

/**
 * Enrols a second factor and returns the secret and the recovery codes.
 *
 * The whole happy path in one helper, because five tests need an enrolled
 * account and repeating the two calls inline would make each of them a
 * paragraph of setup before its first assertion.
 *
 * `spentStep` is reset first: the credential is brand new, so it has no
 * `lastUsedStep` and nothing to replay against. Without that, the first
 * enrolment after a previous test would wait out a step for no reason.
 */
async function enrol(ctx: APIRequestContext): Promise<{ secret: string; codes: string[] }> {
  const started = await ctx.post(`${API}/auth/mfa/enroll`, { data: {} });
  expect(started.status(), await started.text()).toBe(200);
  const { secret } = ((await started.json()) as { data: { secret: string } }).data;

  spentStep = -1;
  const code = await freshTotp(secret);
  await spendMfa();
  const verified = await ctx.post(`${API}/auth/mfa/enroll/verify`, { data: { code } });
  expect(verified.status(), await verified.text()).toBe(200);
  const { codes } = ((await verified.json()) as { data: { codes: string[] } }).data;

  return { secret, codes };
}

/* ------------------------------------------------------------------ */
/* Tear-down                                                           */
/* ------------------------------------------------------------------ */

/**
 * The administrator's context and the target's id, resolved once.
 *
 * Memoised because `apiAs` memoises the *token* but not the lookup, and this
 * file asks for both on every clean-up.
 */
let adminCtx: APIRequestContext | null = null;
let targetId = "";

/**
 * The administrator's re-authentication window, cached for its own lifetime.
 *
 * The window is deliberately **not consumed** by use — see `ReauthService` —
 * so reusing it is the behaviour being relied on rather than a shortcut past
 * it. It matters here because `/auth/reauthenticate` is throttled at ten a
 * minute and this file calls `cleanUp` between every test: minting a fresh
 * window each time would spend the MFA budget on tear-down and leave none for
 * the assertions.
 *
 * Four minutes against the server's five, so a cached token is never used on
 * the wrong side of its own expiry.
 */
let adminReauth: { token: string; until: number } | null = null;

async function admin(): Promise<APIRequestContext> {
  adminCtx ??= await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);
  return adminCtx;
}

async function mfaUserId(): Promise<string> {
  if (targetId) return targetId;
  const list = await (await admin()).get(`${API}/users`, { params: { search: MFA_EMAIL } });
  const users = ((await list.json()) as { data: { items: { id: string; email: string }[] } }).data.items;
  targetId = users.find((u) => u.email === MFA_EMAIL)?.id ?? "";
  expect(targetId, "mfa@iem.test fehlt — Seed mit SEED_TEST_USERS=true").toBeTruthy();
  return targetId;
}

async function adminWindow(): Promise<string> {
  if (adminReauth && adminReauth.until > Date.now()) return adminReauth.token;
  const token = await reauthenticate(await admin(), { password: ADMIN_PASSWORD });
  adminReauth = { token, until: Date.now() + 4 * 60_000 };
  return token;
}

/**
 * Leaves `mfa@iem.test` without a second factor, whatever state it is in.
 *
 * **It checks before it acts.** The status is a column on the user row the
 * list already returns, so asking costs one unthrottled request — while
 * resetting costs a re-authentication against a ten-a-minute budget the
 * assertions need. Most calls find nothing to do.
 */
async function cleanUp(): Promise<void> {
  const ctx = await admin();
  const id = await mfaUserId();
  const list = await ctx.get(`${API}/users`, { params: { search: MFA_EMAIL } });
  const users = ((await list.json()) as { data: { items: { email: string; mfaEnabled: boolean }[] } })
    .data.items;
  if (!users.find((u) => u.email === MFA_EMAIL)?.mfaEnabled) return;

  const reset = await ctx.post(`${API}/users/${id}/mfa/reset`, {
    data: { reauthToken: await adminWindow() },
  });
  expect(reset.status(), `Aufräumen fehlgeschlagen: ${await reset.text()}`).toBe(200);
}

test.afterAll(async () => {
  if (adminCtx) await adminCtx.dispose();
  adminCtx = null;
  adminReauth = null;
});

/* ================================================================== */
/* The arithmetic this file's own helper performs                      */
/* ================================================================== */

test.describe("the suite's TOTP implementation", () => {
  /**
   * The test helper, against the RFC's published vectors.
   *
   * `e2e/totp.ts` is a **second implementation** — the server uses `otpauth`
   * — precisely so that a mistake in how the server is configured cannot be
   * mirrored by the thing checking it. That only holds if this one is right,
   * and nothing else in the suite would notice if it were not: every MFA test
   * would simply fail, pointing at the server.
   */
  test("matches RFC 4226 Appendix D", () => {
    const secret = Buffer.from("12345678901234567890", "ascii");
    const expected = [
      "755224", "287082", "359152", "969429", "338314",
      "254676", "287922", "162583", "399871", "520489",
    ];
    for (const [counter, code] of expected.entries()) {
      expect(hotp(secret, counter), `HOTP counter ${counter}`).toBe(code);
    }
  });

  test("matches RFC 6238 Appendix B for SHA-1", () => {
    // The published TOTP vectors: the same twenty-byte secret read through
    // the clock, at eight digits.
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const cases: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
    ];
    for (const [seconds, code] of cases) {
      expect(totp(secret, { at: new Date(seconds * 1000), digits: 8 }), `t=${seconds}`).toBe(code);
    }
  });

  test("decodes base32 the way the server encodes it", () => {
    // Padded, unpadded and grouped all have to reach the same bytes: the
    // server sends two of the three and a person may paste either.
    expect(base32Decode("JBSWY3DP").toString("ascii")).toBe("Hello");
    expect(base32Decode("JBSW Y3DP").toString("ascii")).toBe("Hello");
    expect(base32Decode("JBSWY3DP======").toString("ascii")).toBe("Hello");
  });

  test("wrongCode is never the right code", () => {
    // A hard-coded "000000" is correct once every million steps, which is a
    // flake nobody would ever reproduce.
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    for (let i = 0; i < 500; i += 1) {
      const at = new Date(Date.now() + i * 30_000);
      expect(wrongCode(secret, at)).not.toBe(totp(secret, { at }));
    }
  });
});

/* ================================================================== */
/* Enrolment                                                           */
/* ================================================================== */

test.describe("enrolment", () => {
  let user: APIRequestContext;

  test.beforeAll(async () => {
    requireAccounts();
    user = await asMfaUser();
  });

  /**
   * Each of these starts from no factor at all.
   *
   * Three of the four *switch it on*, and the fourth asserts that a second
   * enrolment is refused while one is active — so without this they would
   * pass or fail depending on the order Playwright happened to run them in,
   * which is the flake that gets rerun until it is green.
   *
   * It is cheap: `cleanUp` reads a boolean the user list already carries and
   * does nothing when there is nothing to do.
   */
  test.beforeEach(cleanUp);

  test.afterAll(async () => {
    await cleanUp();
    await user?.dispose();
  });

  test("a started enrolment is not a second factor", async () => {
    /*
      The property the `PENDING` status exists for, and the one that would
      lock people out if it were wrong: somebody who opens the setup dialog,
      looks at the QR code and closes the tab must still sign in with their
      password alone.

      Both halves are asserted — the status flag *and* a real sign-in —
      because the flag is what the screen reads and the sign-in is what
      actually matters.
    */
    const before = await user.get(`${API}/auth/mfa`);
    expect(before.status()).toBe(200);
    expect(((await before.json()) as { data: { enabled: boolean } }).data.enabled).toBe(false);

    const started = await user.post(`${API}/auth/mfa/enroll`, { data: {} });
    expect(started.status(), await started.text()).toBe(200);
    const enrolment = ((await started.json()) as {
      data: {
        secret: string;
        secretGrouped: string;
        otpauthUri: string;
        qr: { size: number; path: string };
      };
    }).data;

    const after = await user.get(`${API}/auth/mfa`);
    const status = ((await after.json()) as { data: { enabled: boolean; pending: boolean } }).data;
    expect(status.enabled, "eine begonnene Einrichtung darf MFA nicht aktivieren").toBe(false);
    expect(status.pending).toBe(true);

    const signIn = await login();
    expect(signIn.body.mfaRequired ?? false).toBe(false);
    expect(signIn.body.accessToken).toBeTruthy();

    // The enrolment payload, while it is in hand.
    expect(enrolment.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrolment.secretGrouped.replace(/ /g, "")).toBe(enrolment.secret);
    expect(enrolment.otpauthUri).toContain("otpauth://totp/");
    expect(enrolment.otpauthUri).toContain(`secret=${enrolment.secret}`);
    expect(enrolment.otpauthUri).toContain("algorithm=SHA1");
    expect(enrolment.otpauthUri).toContain("digits=6");
    expect(enrolment.otpauthUri).toContain("period=30");
    // A real symbol, not an empty matrix of the right shape.
    expect(enrolment.qr.size).toBeGreaterThanOrEqual(21);
    expect((enrolment.qr.size - 21) % 4).toBe(0);
    expect(enrolment.qr.path.length).toBeGreaterThan(100);
  });

  test("a wrong code leaves it off", async () => {
    const started = await user.post(`${API}/auth/mfa/enroll`, { data: {} });
    const { secret } = ((await started.json()) as { data: { secret: string } }).data;

    await spendMfa();
    const refused = await user.post(`${API}/auth/mfa/enroll/verify`, {
      data: { code: wrongCode(secret) },
    });
    expect(refused.status()).toBe(400);

    const status = await user.get(`${API}/auth/mfa`);
    expect(((await status.json()) as { data: { enabled: boolean } }).data.enabled).toBe(false);
  });

  test("the correct code switches it on and hands over ten recovery codes", async () => {
    const { secret, codes } = await enrol(user);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size, "die Codes müssen verschieden sein").toBe(10);
    for (const code of codes) {
      // `XXXXX-XXXXX` from Crockford's alphabet, with the four ambiguous
      // glyphs absent — see `mfa.rules.ts`.
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
      expect(code).not.toMatch(/[ILOU]/);
    }

    const status = await user.get(`${API}/auth/mfa`);
    const body = ((await status.json()) as {
      data: { enabled: boolean; method: string; recoveryCodes: { remaining: number; low: boolean } };
    }).data;
    expect(body.enabled).toBe(true);
    expect(body.method).toBe("TOTP");
    expect(body.recoveryCodes.remaining).toBe(10);
    expect(body.recoveryCodes.low).toBe(false);
  });

  test("the secret never comes back, and a second enrolment is refused", async () => {
    /*
      The requirement stated as a property of the *responses* rather than of
      the one endpoint that could plausibly leak it. The whole body text is
      searched, so a field added later — `credential`, `debug`, anything —
      fails here rather than shipping.
    */
    const { secret } = await enrol(user);

    const status = await user.get(`${API}/auth/mfa`);
    const text = await status.text();
    expect(text).not.toContain(secret);
    expect(text.toLowerCase()).not.toContain("encryptedsecret");
    expect(text.toLowerCase()).not.toContain('"secret"');

    const profile = await user.get(`${API}/auth/me`);
    expect(await profile.text()).not.toContain(secret);

    // Silently replacing a working factor is how somebody ends up locked out
    // by a stray click on a screen they thought was read-only.
    const again = await user.post(`${API}/auth/mfa/enroll`, { data: {} });
    expect(again.status()).toBe(400);
  });
});

/* ================================================================== */
/* Signing in                                                          */
/* ================================================================== */

test.describe("signing in with a second factor", () => {
  let user: APIRequestContext;
  let secret = "";
  let codes: string[] = [];

  test.beforeAll(async () => {
    requireAccounts();
    await cleanUp();
    user = await asMfaUser();
    ({ secret, codes } = await enrol(user));
  });

  test.afterAll(async () => {
    await cleanUp();
    await user?.dispose();
  });

  test("the password buys a challenge and nothing else; the code buys the session", async () => {
    /*
      **The property the whole feature rests on**, and its other half, in one
      test because they are one sentence and because a challenge costs a
      sign-in against a ten-a-minute throttle.

      Not "the response says mfaRequired" — that would pass against a server
      that also handed out a token. The assertions are that there is no
      access token in the body and **no `Set-Cookie` in the headers**, which
      only a real response can show; that the challenge cannot be presented
      as a credential, which is the obvious thing for anybody holding one to
      try; and only then that the code turns it into a real session.
    */
    const answer = await login();
    expect(answer.status).toBe(200);
    expect(answer.body.mfaRequired).toBe(true);
    expect(answer.body.challenge, "die Aufforderung muss ein Token zurückgeben").toBeTruthy();
    expect(answer.body.accessToken, "kein Zugriffstoken vor dem zweiten Faktor").toBeUndefined();
    expect(answer.body.user, "kein Profil vor dem zweiten Faktor").toBeUndefined();
    expect(answer.cookie, "kein Refresh-Cookie vor dem zweiten Faktor").toBeNull();

    const asChallenge = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${answer.body.challenge}` },
    });
    try {
      expect((await asChallenge.get(`${API}/auth/me`)).status()).toBe(401);
      expect((await asChallenge.get(`${API}/auth/mfa`)).status()).toBe(401);
    } finally {
      await asChallenge.dispose();
    }

    const done = await answerChallenge(answer.body.challenge!, { code: await freshTotp(secret) });
    expect(done.status, done.text).toBe(200);
    expect(done.body.accessToken).toBeTruthy();
    expect(done.body.user?.email).toBe(MFA_EMAIL);
    expect(done.cookie, "erst jetzt ein Refresh-Cookie").toBeTruthy();

    const asSession = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${done.body.accessToken}` },
    });
    try {
      expect((await asSession.get(`${API}/auth/me`)).status()).toBe(200);
    } finally {
      await asSession.dispose();
    }
  });

  test("the same code cannot be used twice", async () => {
    /*
      The replay guard, against the running API — and one of the assertions
      this file exists for. `lastUsedStep` is a `BigInt` compared inside an
      `updateMany`'s `where`, so what is being checked is the *statement*,
      not the arithmetic `mfa.rules.test.ts` already covers.

      The wait is the feature working: a code is valid for its whole step, so
      proving it is refused the second time means getting a fresh one first.
    */
    const code = await freshTotp(secret);

    const first = await answerChallenge(await challengeFor(), { code });
    expect(first.status, first.text).toBe(200);

    const replayed = await answerChallenge(await challengeFor(), { code });
    expect(replayed.status, "derselbe Code darf kein zweites Mal gelten").toBe(401);
  });

  test("five wrong codes end the challenge, and a right one no longer rescues it", async () => {
    const challenge = await challengeFor();

    // Four wrong, still open; the fifth consumes it. That boundary is the
    // off-by-one `afterFailedChallenge` was written to make visible, and the
    // *message* changes on the attempt that spends it.
    for (let i = 1; i <= 4; i += 1) {
      const attempt = await answerChallenge(challenge, { code: wrongCode(secret) });
      expect(attempt.status, `Versuch ${i}`).toBe(401);
      expect(attempt.text).toContain("Dieser Code stimmt nicht");
    }

    const fifth = await answerChallenge(challenge, { code: wrongCode(secret) });
    expect(fifth.status).toBe(401);
    expect(fifth.text).toContain("Zu viele Fehlversuche");

    // A *correct* code does not reopen it. Asserted with a recovery code so
    // the refusal cannot be the replay guard wearing a challenge's clothes.
    const late = await answerChallenge(challenge, { recoveryCode: codes[9] });
    expect(late.status).toBe(401);
    expect(late.text).toContain("abgelaufen oder wurde bereits abgeschlossen");
  });

  test("a fabricated challenge is refused without saying why", async () => {
    const response = await answerChallenge("nicht-echt-aber-lang-genug", { code: "123456" });
    expect(response.status).toBe(401);
    // The same sentence an expired or spent one gets. Telling them apart
    // would say whether a token somebody holds was ever real.
    expect(response.text).toContain("abgelaufen oder wurde bereits abgeschlossen");
  });

  /* ---------------------------------------------------------------- */
  /* Recovery                                                          */
  /* ---------------------------------------------------------------- */

  test("a recovery code signs in exactly once, however it was typed", async () => {
    const challenge = await challengeFor();

    /*
      A code belonging to nobody, first, on the same challenge — which is
      what makes it free. The assertion is the `userId` in the consuming
      `where`: the hash is unique across the whole table, so without it
      another account's code would be **consumed** while this sign-in still
      failed, leaving somebody else one code poorer for no visible reason.
    */
    const nobody = await answerChallenge(challenge, { recoveryCode: "AAAAA-BBBBB" });
    expect(nobody.status).toBe(401);

    /*
      And then a real one, typed the way somebody reads it off a printed
      sheet: lower case, a space where the hyphen was. `normaliseRecoveryCode`
      folds all of that, and the challenge still has four attempts left.
    */
    const done = await answerChallenge(challenge, {
      recoveryCode: codes[0].toLowerCase().replace("-", " "),
    });
    expect(done.status, done.text).toBe(200);
    expect(done.body.accessToken).toBeTruthy();
    expect(done.body.usedRecoveryCode).toBe(true);
    // The count travels back so the screen can warn the person who just
    // spent one, on the screen they have arrived at.
    expect(done.body.remainingRecoveryCodes).toBe(9);

    const reused = await answerChallenge(await challengeFor(), { recoveryCode: codes[0] });
    expect(reused.status, "ein Wiederherstellungscode gilt genau einmal").toBe(401);
  });
});

/* ================================================================== */
/* Disabling and regenerating                                          */
/* ================================================================== */

test.describe("managing an active factor", () => {
  /**
   * One session for the whole block, and one enrolment per test.
   *
   * The session survives everything these tests do — disabling deliberately
   * keeps it, and the access token outlives a reset because it is a JWT — so
   * signing in per test would spend four attempts of a ten-a-minute budget
   * to obtain four identical tokens.
   */
  let user: APIRequestContext;

  test.beforeAll(async () => {
    requireAccounts();
    await cleanUp();
    user = await asMfaUser();
  });

  test.afterAll(async () => {
    await cleanUp();
    await user?.dispose();
  });

  test("a stale session cannot disable it, and neither can a forged proof", async () => {
    /*
      The reason `ReauthToken` exists. A valid access token is evidence that
      somebody signed in; it is not evidence that the account holder is at
      the keyboard now, and removing a security control needs the second.
    */
    await cleanUp();
    await enrol(user);

    const noProof = await user.post(`${API}/auth/mfa/disable`, { data: {} });
    expect(noProof.status(), "ohne Nachweis: 400 von der Validierung").toBe(400);

    const forged = await user.post(`${API}/auth/mfa/disable`, {
      data: { reauthToken: "nicht-echt" },
    });
    expect(forged.status(), "mit falschem Nachweis: 403").toBe(403);

    const status = await user.get(`${API}/auth/mfa`);
    expect(((await status.json()) as { data: { enabled: boolean } }).data.enabled).toBe(true);
  });

  test("re-authentication needs the second factor as well as the password", async () => {
    await cleanUp();
    const { secret } = await enrol(user);

    await spendMfa();
    const passwordOnly = await user.post(`${API}/auth/reauthenticate`, {
      data: { password: TEST_PASSWORD },
    });
    expect(
      passwordOnly.status(),
      "ein Passwort allein ist kein erneuter Nachweis, wenn MFA aktiv ist",
    ).toBe(401);

    await spendMfa();
    const wrongFactor = await user.post(`${API}/auth/reauthenticate`, {
      data: { password: TEST_PASSWORD, code: wrongCode(secret) },
    });
    expect(wrongFactor.status()).toBe(401);

    await spendMfa();
    const wrongPassword = await user.post(`${API}/auth/reauthenticate`, {
      data: { password: "definitiv-das-falsche-passwort", code: totp(secret) },
    });
    expect(wrongPassword.status()).toBe(401);
  });

  test("regenerating invalidates every previous code", async () => {
    await cleanUp();
    const { secret, codes } = await enrol(user);

    const token = await reauthenticate(user, {
      password: TEST_PASSWORD,
      code: await freshTotp(secret),
    });
    const response = await user.post(`${API}/auth/mfa/recovery-codes`, {
      data: { reauthToken: token },
    });
    expect(response.status(), await response.text()).toBe(200);
    const fresh = ((await response.json()) as { data: { codes: string[] } }).data.codes;

    expect(fresh).toHaveLength(10);
    expect(fresh.some((c) => codes.includes(c)), "die neuen Codes sind neu").toBe(false);

    // An old code no longer signs anybody in; a new one does — both against
    // the *same* challenge, because a wrong recovery code costs one of five
    // attempts and not a whole sign-in.
    const challenge = await challengeFor();
    expect((await answerChallenge(challenge, { recoveryCode: codes[0] })).status).toBe(401);
    const ok = await answerChallenge(challenge, { recoveryCode: fresh[0] });
    expect(ok.status, ok.text).toBe(200);
  });

  test("disabling removes the factor and the codes, and keeps the sessions", async () => {
    await cleanUp();
    const { secret, codes } = await enrol(user);

    const token = await reauthenticate(user, {
      password: TEST_PASSWORD,
      code: await freshTotp(secret),
    });
    const disabled = await user.post(`${API}/auth/mfa/disable`, { data: { reauthToken: token } });
    expect(disabled.status(), await disabled.text()).toBe(204);

    /*
      The documented decision: **the other sessions survive**, unlike a
      password change. Disabling changes what a future sign-in must show and
      changes nothing about a session already running, all of which belong to
      the person who just re-entered their password.
    */
    expect((await user.get(`${API}/auth/me`)).status()).toBe(200);

    const status = await user.get(`${API}/auth/mfa`);
    const body = ((await status.json()) as {
      data: { enabled: boolean; recoveryCodes: { total: number } };
    }).data;
    expect(body.enabled).toBe(false);
    expect(body.recoveryCodes.total, "die Wiederherstellungscodes gehen mit").toBe(0);

    // The password alone signs in again — and the old recovery codes are not
    // a second way in, because there is no challenge to present them to.
    const signIn = await login();
    expect(signIn.body.mfaRequired ?? false).toBe(false);
    expect(signIn.body.accessToken).toBeTruthy();
    expect(signIn.body.challenge).toBeUndefined();
    expect(codes[0]).toBeTruthy();
  });
});

/* ================================================================== */
/* Administration                                                      */
/* ================================================================== */

test.describe("an administrator resetting somebody's factor", () => {
  let management: APIRequestContext;

  test.beforeAll(async () => {
    requireAccounts();
    // `management` holds `user.read` and **not** `user.resetMfa` — the role
    // that separates "may look at the user list" from "may strip somebody's
    // second factor". A role that held neither would pass the 403 assertion
    // for the wrong reason.
    management = await apiAs("gl@iem.test", TEST_PASSWORD);
  });

  test.afterAll(async () => {
    await cleanUp();
    await management?.dispose();
  });

  test("the key is required, and so is the administrator's own password", async () => {
    const id = await mfaUserId();
    const ctx = await admin();

    // 403 from `PermissionsGuard`, which runs before the `ValidationPipe` —
    // so this caller never reaches the body and never learns anything else.
    const refused = await management.post(`${API}/users/${id}/mfa/reset`, { data: {} });
    expect(refused.status()).toBe(403);
    expect(await refused.text()).toContain("user.resetMfa");

    // 400, not 403: the permission passed and the *body* is incomplete,
    // which is what proves the guard let this caller through.
    const noProof = await ctx.post(`${API}/users/${id}/mfa/reset`, { data: {} });
    expect(noProof.status()).toBe(400);

    const forged = await ctx.post(`${API}/users/${id}/mfa/reset`, {
      data: { reauthToken: "nicht-echt" },
    });
    expect(forged.status()).toBe(403);
  });

  test("a reset clears the factor and ends the account's sessions", async () => {
    await cleanUp();
    const user = await asMfaUser();
    try {
      await enrol(user);
      const ctx = await admin();
      const id = await mfaUserId();

      const reset = await ctx.post(`${API}/users/${id}/mfa/reset`, {
        data: { reauthToken: await adminWindow() },
      });
      expect(reset.status(), await reset.text()).toBe(200);
      const result = ((await reset.json()) as {
        data: { hadFactor: boolean; sessionsRevoked: number };
      }).data;
      expect(result.hadFactor).toBe(true);
      expect(result.sessionsRevoked).toBeGreaterThan(0);

      /*
        **The opposite of `disable`**, and the asymmetry is argued on
        `MfaService.resetFor`: an administrator resets because the holder is
        locked out (nothing to lose) or because the credential is suspect
        (everything to gain). Either reading ends the sessions.

        The *refresh* tokens are revoked, which is what the session list
        counts. The access token already in hand keeps working until it
        expires — the property `guards.ts` documents, and not this feature's
        to change.
      */
      const list = await ctx.get(`${API}/users/${id}/sessions`);
      expect(((await list.json()) as { data: unknown[] }).data).toHaveLength(0);

      // And the password alone gets back in, which is the point of it.
      const signIn = await login();
      expect(signIn.body.mfaRequired ?? false).toBe(false);
      expect(signIn.body.accessToken).toBeTruthy();
    } finally {
      await user.dispose();
    }
  });

  test("resetting an account that has no factor says so rather than pretending", async () => {
    const ctx = await admin();
    const id = await mfaUserId();
    const reset = await ctx.post(`${API}/users/${id}/mfa/reset`, {
      data: { reauthToken: await adminWindow() },
    });
    expect(reset.status()).toBe(200);
    expect(((await reset.json()) as { data: { hadFactor: boolean } }).data.hadFactor).toBe(false);
  });

  test("nothing hands an administrator somebody's secret", async () => {
    const ctx = await admin();
    const id = await mfaUserId();

    const list = await ctx.get(`${API}/users`, { params: { search: MFA_EMAIL } });
    const text = await list.text();
    expect(text).toContain("mfaEnabled");
    // The boolean, and nothing behind it.
    expect(text.toLowerCase()).not.toContain("encryptedsecret");
    expect(text.toLowerCase()).not.toContain("recoverycode");

    // The absence of a read route, asserted. A later author adding a
    // convenient `GET /users/:id/mfa` fails here rather than in review.
    const direct = await ctx.get(`${API}/users/${id}/mfa`);
    expect([403, 404]).toContain(direct.status());
  });
});

/* ================================================================== */
/* In the browser                                                      */
/* ================================================================== */

/**
 * Signs `mfa@iem.test` in through the real form, on a context of its own.
 *
 * **Not the shared `page` fixture**, and that is not a preference: the worker
 * context is signed in as the administrator, and enrolling a factor there
 * would break every subsequent spec.
 */
async function signInAs(page: import("@playwright/test").Page, path: string): Promise<void> {
  await spendLogin();
  await page.goto(`/admin.html#${path}`);
  /*
    `reload()`, and it is load-bearing rather than defensive.

    A `goto` to a URL that differs from the current one **only in its hash**
    is a *same-document* navigation: the browser moves the fragment and does
    not re-execute the document. The SPA therefore does not reboot, the
    access token in memory survives, and the dashboard stays on screen — so
    after clearing the cookies the second sign-in found no login form, the
    next `fill` waited for an element that was never coming, and the test
    died six minutes later at a line that looks innocent. The screenshot
    showed a perfectly healthy profile page, which is the tell.

    It cost a wrong diagnosis: the failure was read as "the journey is too
    slow" and answered with a bigger timeout, twice. What it actually meant
    was that **the browser sign-in through a second factor was never being
    exercised at all** — the one thing this test exists for.

    `reload()` always re-executes the document, which is what signing in
    again means here.
  */
  await page.reload();
  await page.getByLabel(/E-Mail/i).fill(MFA_EMAIL);
  await page.getByLabel(/Passwort/i).first().fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^Anmelden$/ }).click();
}

test.describe("the browser journey", () => {
  test.beforeAll(requireAccounts);
  test.afterAll(cleanUp);

  test("enable, sign out, sign in with a code, disable", async ({ browser }) => {
    /*
      Five minutes against a **measured 60 seconds**, and the gap is
      deliberate rather than lazy — but the history is worth more than the
      number.

      This test twice hit a six-minute ceiling and twice that was read as
      "the journey is legitimately slow": it pays two sign-ins through the
      form, each paced against a ten-a-minute throttle, and three fresh TOTP
      codes, each of which may sit out a thirty-second step because the
      replay guard refuses a step already spent. All of that is true, and
      none of it was what was happening. `page.goto` to a URL differing only
      in its hash is a same-document navigation, so the SPA never rebooted
      after the cookies were cleared, the login form never appeared, and a
      `fill` waited for it until the clock ran out — see `signInAs`. **The
      browser sign-in through a second factor was not being tested at all.**

      The lesson is the one CLAUDE.md keeps recording in other forms: a
      timeout is a symptom, and raising it is what stops you finding the
      cause. It is set here rather than on the describe so the rest of the
      file still fails fast at three minutes; five is headroom for the
      throttle pacing under a full-suite run, where both sign-ins can wait,
      and not a budget anything is expected to use.
    */
    test.setTimeout(300_000);

    await cleanUp();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await signInAs(page, "/profil");
      await expect(
        page.getByRole("heading", { name: "Zwei-Faktor-Authentisierung" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Nicht aktiv", { exact: true })).toBeVisible();

      /* ---- steps 1 and 2: the wizard ------------------------------- */
      await page.getByRole("button", { name: "Einrichten" }).click();
      await expect(
        page.getByRole("heading", { name: "Zwei-Faktor-Authentisierung einrichten" }),
      ).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Einrichten" }).click();

      // The QR code and the manual key, side by side. The key is not a
      // fallback — it is the only path when the dashboard is open on the
      // same phone the authenticator runs on.
      await expect(page.getByRole("img", { name: /QR-Code/i })).toBeVisible({ timeout: 20_000 });
      const key = await page.getByRole("dialog").locator("code").innerText();
      const secret = key.replace(/\s/g, "");
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);

      /* ---- step 3: verify ------------------------------------------ */
      await page.getByRole("button", { name: "Weiter" }).click();
      await settleIntoStep();
      await page.getByLabel("Code aus der App").fill(totp(secret));
      await spendMfa();
      await page.getByRole("button", { name: "Aktivieren" }).click();

      /* ---- step 4: the recovery codes ------------------------------ */
      await expect(
        page.getByRole("heading", { name: "Ihre Wiederherstellungscodes" }),
      ).toBeVisible({ timeout: 20_000 });
      const shown = await page
        .getByRole("list", { name: "Wiederherstellungscodes" })
        .getByRole("listitem")
        .allInnerTexts();
      expect(shown).toHaveLength(10);

      // The way forward is blocked until the reader says they have kept them.
      const finish = page.getByRole("button", { name: "Fertig" });
      await expect(finish).toBeDisabled();
      await page.getByLabel(/sicher abgelegt/i).check();
      await expect(finish).toBeEnabled();
      await finish.click();

      await expect(page.getByText("Aktiv", { exact: true })).toBeVisible({ timeout: 20_000 });

      /* ---- sign out, and sign in through the factor ---------------- */
      /*
        The cookie is cleared rather than the sign-out button pressed. The
        button lives in the header's user panel, which is collapsed behind a
        menu at narrow widths — and what is being tested here is the sign-in,
        not the shell's chrome. Clearing the refresh cookie is exactly what
        signing out does to this browser.
      */
      await context.clearCookies();
      await signInAs(page, "/profil");

      await expect(
        page.getByRole("heading", { name: "Zwei-Faktor-Bestätigung" }),
      ).toBeVisible({ timeout: 30_000 });

      /*
        The verification screen itself, before answering it.

        Asserted here rather than in a test of its own because reaching this
        screen costs a sign-in against a ten-a-minute throttle, and the
        assertions are all about what is already on it.
      */

      // The same frame as the password form: the wordmark above it and the
      // same panel around it. A reader being asked for a second credential
      // must not feel handed to a different system — that is what a phishing
      // page feels like.
      await expect(page.locator("form.panel")).toBeVisible();

      // The recovery path swaps the field rather than adding one, so nobody
      // spends a one-time code with their phone in their pocket.
      await page.getByRole("button", { name: "Wiederherstellungscode verwenden" }).click();
      await expect(page.getByLabel("Wiederherstellungscode")).toBeVisible();
      await expect(page.getByLabel("Code aus der App")).toHaveCount(0);
      await page.getByRole("button", { name: "Doch den Code aus der App" }).click();
      await expect(page.getByLabel("Code aus der App")).toBeVisible();

      // A wrong code is refused in place, with a message and no blank page.
      // It costs one of the challenge's five attempts and no sign-in.
      await page.getByLabel("Code aus der App").fill(wrongCode(secret));
      await spendMfa();
      await page.getByRole("button", { name: "Bestätigen" }).click();
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("heading", { name: "Zwei-Faktor-Bestätigung" })).toBeVisible();
      // The refusal from the real server puts the form back and the keyboard
      // in the field. `otp-motion.spec.ts` covers the states in between.
      await expect(page.locator("form.vm-stage")).toHaveAttribute("data-state", "error");
      await expect(page.getByLabel("Code aus der App")).toBeFocused();

      // And then the right one.
      await page.getByLabel("Code aus der App").fill(await freshTotp(secret));
      await spendMfa();
      await page.getByRole("button", { name: "Bestätigen" }).click();

      // The acceptance is shown — from the real server's answer — before the
      // dashboard replaces the step.
      await expect(page.locator("form.vm-stage")).toHaveAttribute("data-state", "success", {
        timeout: 20_000,
      });
      await expect(page.locator(".vm-check")).toBeVisible();

      await expect(
        page.getByRole("heading", { name: "Zwei-Faktor-Authentisierung" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Aktiv", { exact: true })).toBeVisible();

      /* ---- disable, behind re-authentication ----------------------- */
      await page.getByRole("button", { name: "Deaktivieren" }).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { name: "Zwei-Faktor-Authentisierung deaktivieren" }),
      ).toBeVisible();

      await dialog.getByLabel("Passwort", { exact: true }).fill(TEST_PASSWORD);
      await dialog.getByLabel("Code aus der App").fill(await freshTotp(secret));
      await spendMfa();
      await dialog.getByRole("button", { name: "Deaktivieren" }).click();

      await expect(page.getByText("Nicht aktiv", { exact: true })).toBeVisible({ timeout: 30_000 });
    } finally {
      await page.close();
      await context.close();
    }
  });

  test("the account card renders cleanly for an administrator", async ({
    page,
    collected,
    signIn,
  }) => {
    /*
      The shared context, read-only — the administrator's own card with no
      factor enrolled. It is what every signed-in person sees, it is the
      state `/profil` is photographed and axe-checked in by
      `screens.spec.ts`, and it changes nothing.
    */
    await signIn();
    await page.goto("/admin.html#/profil");
    await expect(page.getByRole("heading", { name: "Zwei-Faktor-Authentisierung" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Einrichten" })).toBeVisible();
    expectClean(collected, "/profil mit MFA-Karte");
  });
});
