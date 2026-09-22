import {
  request,
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The shared rig: sign-in, theme switching, and the collectors that make every
 * test also a console and network check.
 *
 * The collectors are the point. A test that navigates to a screen and asserts a
 * heading proves the heading is there; it says nothing about the four failed
 * requests and the React key warning that happened on the way. Attaching them
 * to the fixture means *every* spec checks them without any spec remembering
 * to, which is the only way that stays true as specs are added.
 */

/**
 * Credentials come from `server/.env`, never from this file.
 *
 * The seeded administrator's password is a local throwaway, but writing any
 * password into a tracked file is how one ends up in a repository — and the
 * value is already in exactly one place that is gitignored, so reading it is
 * both safer and one less copy to keep in step.
 */
/**
 * Reads one key out of `server/.env`.
 *
 * Resolved from `process.cwd()`, not from `__dirname`. The package is
 * `"type": "module"`, so `__dirname` is undefined here — `resolve()` threw, the
 * catch turned it into an empty string, and the suite went on to submit a blank
 * password and fail twenty seconds later at "the rail never appeared". Playwright
 * runs from the config's directory, which is the repo root.
 *
 * Hand-parsed rather than pulling in `dotenv`: this needs two `KEY="value"`
 * lines out of one file, and the API already owns that dependency for its own
 * runtime. One fewer package at the root.
 */
function fromServerEnv(key: string): string {
  const path = resolve(process.cwd(), "server/.env");
  const file = readFileSync(path, "utf8");
  return new RegExp(`^${key}\\s*=\\s*"?([^"\\r\\n]*)"?`, "m").exec(file)?.[1] ?? "";
}

export const ADMIN_EMAIL =
  process.env.SEED_ADMIN_EMAIL || fromServerEnv("SEED_ADMIN_EMAIL") || "admin@iem.ch";
export const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || fromServerEnv("SEED_ADMIN_PASSWORD");

/**
 * The shared password of the seeded role accounts, or `""`.
 *
 * `""` means `SEED_TEST_USERS` was never set, so the accounts do not exist —
 * `security.spec.ts` then **skips with a message** rather than failing. A
 * suite that goes red on a machine that has not opted into six test accounts
 * is a suite people learn to ignore; one that says why it skipped is a
 * prompt.
 */
export const TEST_PASSWORD =
  process.env.SEED_TEST_PASSWORD || fromServerEnv("SEED_TEST_PASSWORD");

/**
 * The API's own origin, which is **not** the dashboard's.
 *
 * `vite.config.ts` proxies `/media` and nothing else; the dashboard reaches the
 * API through `VITE_CMS_API`, an absolute URL, because in development the two
 * are separate origins. A request fixture pointed at `baseURL` would therefore
 * ask the *dev server* for `/api/v1/projects` and get Vite's SPA fallback —
 * `index.html`, status **200**, `text/html`. Every assertion expecting a 403
 * would fail as a 200, which reads as a missing guard rather than as a wrong
 * host. That is the same trap the media proxy note in `vite.config.ts`
 * describes, from the other side.
 */
function fromAnyEnvFile(key: string, files: string[]): string {
  for (const name of files) {
    try {
      const file = readFileSync(resolve(process.cwd(), name), "utf8");
      const found = new RegExp(`^${key}\\s*=\\s*"?([^"\\r\\n]*)"?`, "m").exec(file)?.[1];
      if (found) return found;
    } catch {
      // A missing file is the normal case: Vite reads `.env`, `.env.local` and
      // `.env.<mode>` in a fixed order and a repository has whichever of them
      // its developers chose. Throwing on the first absent one — which is what
      // the first version did — takes the whole suite down at collection time
      // with an `ENOENT` that says nothing about the tests.
    }
  }
  return "";
}

/**
 * The marker every persistent thing an E2E run creates must carry.
 *
 * ---
 *
 * ## Why a marker rather than careful cleanup
 *
 * `afterAll` is not enough and cannot be made enough. A killed Playwright
 * process never reaches it, a timed-out test abandons whatever it had made,
 * and a refusal the domain is *right* to make — `DELETE /drawings/:id` will
 * not take an issued plan — leaves a row behind by design. Every one of those
 * happened here: by the time it was noticed, one seeded project carried **782
 * drawings** where the seed makes six, plus 857 tasks, 852 meetings and 595
 * decisions.
 *
 * That is not merely untidy. It broke a real test: the Planversand dialog asks
 * for a page of 100 plans, which is a documented design decision, so a plan
 * created by the test was not in the list and the assertion failed — two full
 * suite runs were spent diagnosing a defect that did not exist.
 *
 * So the rule is inverted. Instead of each spec promising to clean up after
 * itself, **every spec marks what it makes** and `e2e-cleanup.ts` removes
 * everything marked, *before* the run. That is crash-safe by construction: the
 * cleanup does not depend on the previous process having finished, only on it
 * having labelled its work.
 *
 * ## The convention
 *
 * The token appears somewhere in a human-readable identifying field — a name,
 * a title, a number. Most specs already did this informally; what was missing
 * was that it be **uniform and enforced**. `e2e-hygiene.spec.ts` fails the
 * build when a spec creates a persistent entity without it.
 *
 * `e2eName("Bausitzung")` → `"E2E: Bausitzung"`, and `e2eNumber("PL")` →
 * `"E2E-PL-1789…-3"` for fields that must be unique and identifier-shaped.
 */
export const E2E_MARKER = "E2E";

let sequence = 0;

/** A marked, human-readable name. Use for `name`/`title` fields. */
export function e2eName(label: string): string {
  return `${E2E_MARKER}: ${label}`;
}

/**
 * A marked, unique, identifier-shaped value. Use for `number`/`key` fields.
 *
 * Unique across a run *and* across concurrent runs: the timestamp separates
 * runs and the counter separates calls inside one, which matters because three
 * width projects can be creating plans in the same millisecond.
 */
export function e2eNumber(prefix: string): string {
  sequence += 1;
  return `${E2E_MARKER}-${prefix}-${Date.now()}-${sequence}`;
}

export const API_ORIGIN =
  process.env.E2E_API_ORIGIN ||
  fromAnyEnvFile("VITE_CMS_API", [".env.local", ".env", ".env.development"]) ||
  "http://localhost:3100";

export const API = `${API_ORIGIN}/api/v1`;

/* ================================================================== */
/* The sign-in budget                                                  */
/* ================================================================== */

/**
 * `/auth/login` allows **ten attempts a minute per IP**, and the suite has to
 * live inside that without the production limit moving.
 *
 * ---
 *
 * **Why memoising was not enough.** Every account already signs in once per
 * worker and the whole run needs about eleven attempts across fifteen
 * minutes — nowhere near ten a minute *on average*. The failures were never
 * about the total; they were about **clustering**. `security.spec.ts` signs
 * seven roles in back to back in a couple of seconds, `auth.spec.ts` spends
 * attempts deliberately on wrong passwords, and three more browser sessions
 * follow. Six independent code paths reached `/auth/login` and **none of them
 * knew what the others had spent**, so whichever one happened to be eleventh
 * inside some sixty-second window failed — and it failed two screens away,
 * as `Hauptnavigation not found` over a screenshot of the login page.
 *
 * That is the misdiagnosis CLAUDE.md records three times. Reacting to the 429
 * afterwards, which is what this used to do, turns a deterministic limit into
 * a coin flip: the retry helps only if the window has rolled, and a suite that
 * sometimes waits 61 seconds and sometimes fails is not a suite anybody
 * trusts.
 *
 * **So the budget is spent deliberately rather than discovered.** Every path
 * that can reach `/auth/login` calls `spendLogin()` first; it records the
 * attempt and, when the window is full, waits exactly long enough for the
 * oldest one to fall out of it. No retries, no 429s, no flake — the suite
 * paces itself against the real policy instead of testing whether it got
 * lucky.
 *
 * `CEILING` is eight rather than ten on purpose. Two attempts of headroom
 * cover the ones this module cannot see: a browser that retries a submit, a
 * `forgot-password` flow sharing the bucket, or a developer with the
 * dashboard open in another tab while the suite runs.
 */
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_CEILING = 8;

/** Timestamps of the attempts this worker has made, newest last. */
const loginAttempts: number[] = [];

/**
 * Reserves one sign-in attempt, waiting if the window is already full.
 *
 * **Call it immediately before every request to `/auth/login`** — including
 * the ones expected to *fail*, because a rejected password costs the same
 * against the throttle as an accepted one. `auth.spec.ts` is the spec that
 * makes that distinction matter.
 */
export async function spendLogin(): Promise<void> {
  for (;;) {
    const now = Date.now();
    // Drop everything that has aged out of the window.
    while (loginAttempts.length && now - loginAttempts[0] >= LOGIN_WINDOW_MS) {
      loginAttempts.shift();
    }
    if (loginAttempts.length < LOGIN_CEILING) {
      loginAttempts.push(now);
      return;
    }
    // Wait for the oldest to expire, plus a little, then re-check: another
    // caller may have taken the slot while this one slept.
    const waitMs = LOGIN_WINDOW_MS - (now - loginAttempts[0]) + 250;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/* ================================================================== */
/* The second-factor budget                                           */
/* ================================================================== */

/**
 * The three MFA verification routes allow **ten a minute per IP each**, and
 * the suite paces itself against them the way it paces sign-ins.
 *
 * ---
 *
 * **They are separate buckets from `/auth/login`.** Nest keys a throttle by
 * class, handler and tracker, so `/auth/mfa/challenge`,
 * `/auth/mfa/enroll/verify` and `/auth/reauthenticate` each have their own
 * ten and none of them eats the sign-in's. That is worth knowing before
 * reading the number below, because it is why this exists at all rather than
 * being folded into `spendLogin`.
 *
 * **One pacer for all three, deliberately conservative.** The three buckets
 * are independent on the server and shared here, so a run that spends eight
 * on challenges and eight on re-authentications waits once when it did not
 * strictly have to. That trade is taken on purpose: `mfa.spec.ts` is the only
 * heavy user, its worst minute is about six calls across all three, and the
 * alternative is three near-identical pacers whose only difference is a
 * string — which is three places for the next author to forget one.
 *
 * `CEILING` is eight rather than ten for the same reason `spendLogin`'s is:
 * two attempts of headroom for what this module cannot see — a browser
 * retrying a submit, or a developer with the dashboard open in another tab.
 *
 * **Call it immediately before every request to one of the three, including
 * the ones expected to fail.** A refused code costs the same against the
 * throttle as an accepted one, and `login-budget.spec.ts` fails the build if
 * a file reaches those routes without calling it.
 */
const MFA_WINDOW_MS = 60_000;
const MFA_CEILING = 8;

const mfaAttempts: number[] = [];

export async function spendMfa(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (mfaAttempts.length && now - mfaAttempts[0] >= MFA_WINDOW_MS) {
      mfaAttempts.shift();
    }
    if (mfaAttempts.length < MFA_CEILING) {
      mfaAttempts.push(now);
      return;
    }
    const waitMs = MFA_WINDOW_MS - (now - mfaAttempts[0]) + 250;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/**
 * The mail diagnostics, which are their own bucket again (P2-4).
 *
 * `POST /settings/mail/verify` and `POST /settings/mail/test` each allow
 * **three a minute**, and that limit is deliberate rather than incidental:
 * both reach a third party over the network, and a settings page does not need
 * more. Nest keys a throttle by class, handler and tracker, so the two share
 * neither each other's budget nor `/auth/login`'s — but every test in the suite
 * runs from one IP, so they share it with *each other's tests*.
 *
 * The failure without this is the one recorded three times against the sign-in
 * budget, arriving by a fourth route: a permission test asserting 403 gets
 * **429**, because `ThrottlerGuard` runs before `PermissionsGuard` and never
 * reaches the permission at all. It reads as a broken RBAC rule, and the
 * screenshot shows a perfectly correct one.
 *
 * Two buckets rather than one, because the routes genuinely have two — pacing
 * them together would make the spec twice as slow as it needs to be for no
 * protection.
 *
 * **Call it immediately before every request to either route, including the
 * ones expected to be refused.** A 403 costs the same against the throttle as
 * a success.
 */
const PROBE_WINDOW_MS = 60_000;
/** Two, not three: one attempt of headroom for anything this cannot see. */
const PROBE_CEILING = 2;

const probeAttempts: Record<"verify" | "test", number[]> = { verify: [], test: [] };

export async function spendMailProbe(kind: "verify" | "test"): Promise<void> {
  const attempts = probeAttempts[kind];
  for (;;) {
    const now = Date.now();
    while (attempts.length && now - attempts[0] >= PROBE_WINDOW_MS) attempts.shift();
    if (attempts.length < PROBE_CEILING) {
      attempts.push(now);
      return;
    }
    const waitMs = PROBE_WINDOW_MS - (now - attempts[0]) + 250;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/**
 * Backups and restores, which are their own two buckets again (P2-5).
 *
 * `POST /backups` and `POST /backups/:id/restore` each allow **three a
 * minute**, and both count refusals — which on the restore route are the
 * common case, since a mistyped confirmation and an expired window both reach
 * it.
 *
 * The failure without this is the one the sign-in budget has produced four
 * times and the mail probes a fifth: a permission test asserting 400 or 403
 * gets **429**, because `ThrottlerGuard` runs before `PermissionsGuard` and the
 * request never reaches the thing under test. Here it is worse than usual,
 * because the same spec's *positive* path — creating the backup the drill
 * restores — is spent by the refusals that precede it.
 *
 * Two buckets rather than one, because the routes genuinely have two.
 *
 * **Call it immediately before every request to either route, including the
 * ones expected to be refused.**
 */
const BACKUP_WINDOW_MS = 60_000;
/** Two of three, leaving one attempt of headroom for anything unseen. */
const BACKUP_CEILING = 2;

const backupAttempts: Record<"create" | "restore", number[]> = { create: [], restore: [] };

export async function spendBackupOp(kind: "create" | "restore"): Promise<void> {
  const attempts = backupAttempts[kind];
  for (;;) {
    const now = Date.now();
    while (attempts.length && now - attempts[0] >= BACKUP_WINDOW_MS) attempts.shift();
    if (attempts.length < BACKUP_CEILING) {
      attempts.push(now);
      return;
    }
    const waitMs = BACKUP_WINDOW_MS - (now - attempts[0]) + 250;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/* ================================================================== */
/* The refresh budget                                                  */
/* ================================================================== */

/**
 * `/auth/refresh` allows **sixty a minute per IP**, and the suite lives just
 * over the line.
 *
 * ---
 *
 * **This is the sign-in budget's lesson arriving through a second door, and
 * it took two full runs to see because it moves.** Run one failed two
 * `navigation.spec.ts` tests; run two passed navigation and failed two
 * `project-edit.spec.ts` tests instead. Same shape both times — one test
 * timing out waiting for a screen, the next failing instantly in the worker
 * fixture, then recovery — which reads as an unrelated flake in whichever spec
 * happened to be running.
 *
 * It is not unrelated. **Every `page.goto` reboots the SPA, and every boot
 * refreshes**, because the access token lives in memory and does not survive a
 * reload. The `page` fixture boots once per test on top of whatever the test
 * itself navigates to, so the suite's refresh rate tracks how browser-heavy
 * the current stretch is rather than anything a human would produce.
 *
 * Measured against the database rather than guessed: over 102 minutes the rate
 * averaged **16.3/minute** and peaked at **62** — two minutes out of the
 * hundred crossed 60, and those are exactly the two runs that failed. The
 * suite is not far over the limit; it grazes it.
 *
 * **So the ceiling is low and the cost is near zero.** Pacing at 45 leaves the
 * 98% of minutes that never approach it completely untouched and flattens the
 * spikes that do. The alternative — raising the server's limit — is the repair
 * CLAUDE.md forbids by name three times over, and it would trade a real
 * control against a browser that reloads faster than any person.
 *
 * Fifteen of headroom below the server's sixty, because this budget sees only
 * the refreshes the *browser context* makes. `auth.spec.ts` posts to
 * `/auth/refresh` directly from API contexts — deliberately, including the ones
 * meant to be refused — and those spend the same bucket unseen from here.
 */
const REFRESH_WINDOW_MS = 60_000;
const REFRESH_CEILING = 45;

/** Timestamps of the refreshes this worker's browser has made, newest last. */
const refreshAttempts: number[] = [];

/**
 * Reserves one refresh, waiting if the window is already full.
 *
 * Deliberately the same shape as `spendLogin` rather than a shared generic:
 * the two differ in what they are budgeting and in *why* the headroom is the
 * size it is, and folding them together would put one comment in front of two
 * different arguments.
 *
 * Unlike `spendLogin` this is not called by the specs. It is installed as a
 * route handler on the shared browser context, so it paces every refresh the
 * application decides to make — which is the point, because no spec knows when
 * a boot is going to ask for one.
 */
async function spendRefresh(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (refreshAttempts.length && now - refreshAttempts[0] >= REFRESH_WINDOW_MS) {
      refreshAttempts.shift();
    }
    if (refreshAttempts.length < REFRESH_CEILING) {
      refreshAttempts.push(now);
      return;
    }
    const waitMs = REFRESH_WINDOW_MS - (now - refreshAttempts[0]) + 250;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/**
 * One API sign-in per account, shared by every spec in the worker.
 *
 * Memoised on top of the budget above: the pacing stops the suite exceeding
 * the limit, and the memo stops it spending attempts it does not need.
 * `versioning.spec.ts` and `budgets.spec.ts` both want the administrator and
 * between them cost one.
 *
 * Lives here rather than in a spec because module state is per worker, and
 * this runs with one worker: every file importing this shares one token each.
 */
const tokens = new Map<string, string>();

export async function apiToken(email: string, password: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;

  await spendLogin();
  const anonymous = await request.newContext();
  const response = await anonymous.post(`${API}/auth/login`, { data: { email, password } });

  if (!response.ok()) {
    await anonymous.dispose();
    throw new Error(
      `${email} konnte sich nicht anmelden (HTTP ${response.status()}). ` +
        (response.status() === 429
          ? "429 trotz Anmelde-Budget — es gibt einen Anmeldeweg, der spendLogin() nicht aufruft."
          : "Für die Rollenkonten: SEED_TEST_USERS=true npm run server:seed"),
    );
  }

  const body = (await response.json()) as { data: { accessToken: string } };
  await anonymous.dispose();
  tokens.set(email, body.data.accessToken);
  return body.data.accessToken;
}

/** A request context carrying that account's bearer token. */
export async function apiAs(email: string, password: string): Promise<APIRequestContext> {
  const token = await apiToken(email, password);
  return request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

/**
 * Fails here rather than at the sign-in.
 *
 * Without it a missing credential surfaces as "the navigation never appeared"
 * after a twenty-second timeout on every spec — a message that points at the
 * dashboard instead of at the setup. The same swallowed error that caused this
 * the first time is why it is now an assertion and not a fallback.
 */
if (!ADMIN_PASSWORD) {
  throw new Error(
    "SEED_ADMIN_PASSWORD is empty. The e2e suite signs in as the seeded administrator; " +
      "set it in server/.env (or in the environment) and re-run the seed if the account has no password yet.",
  );
}

/** Messages that are expected and say nothing about the code under test. */
const IGNORED_CONSOLE = [
  // Vite's dev client chatter.
  /\[vite\]/i,
  // React DevTools nag.
  /Download the React DevTools/i,
  // The site's own deliberate, quiet note when no API is configured.
  /content hydrate skipped/i,
  /**
   * Headless software rendering, not the application.
   *
   * "Website bearbeiten" embeds the live site, which runs the WebGL hero. On a
   * GPU-less runner Chromium rasterises in software and reports every
   * `ReadPixels` as a stall. It says something true about the machine and
   * nothing about the code.
   */
  /GL Driver Message/i,
  /GPU stall due to ReadPixels/i,
];

/** Requests whose failure is not the application's fault. */
const IGNORED_REQUESTS = [
  /\/@vite\//,
  /\/@react-refresh/,
  /favicon\.ico$/,
  // Google Fonts, which a sandboxed run may not reach.
  /fonts\.(googleapis|gstatic)\.com/,
];

export type Collected = {
  consoleErrors: string[];
  /**
   * Warnings, collected but not failed on.
   *
   * Separating them from errors is the difference between a suite that is read
   * and one that is muted. A warning is worth surfacing — the three.js
   * deprecation in the site's hero is a real thing to act on eventually — but
   * failing a UI test on a library's advice about its own future API would put
   * the suite's credibility in the hands of a dependency's release notes.
   */
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** Every response with a 4xx/5xx status, as `METHOD url -> status`. */
  badResponses: string[];
};

/**
 * One browser context for the whole worker, signed in once.
 *
 * Signing in per test looked cleaner and does not survive contact with this
 * application. Two of its own defences push back:
 *
 * - **The login route is throttled**, ten attempts a minute per IP. A suite
 *   with twenty tests in it trips that partway through and the failures read as
 *   "the navigation never appeared", pointing at the dashboard rather than at
 *   the test.
 * - **Refresh tokens rotate and replay is detected.** Saving `storageState`
 *   after one sign-in and replaying it into fresh contexts — the usual
 *   Playwright answer — presents the same refresh cookie twice, which this
 *   server correctly treats as a stolen token and answers by revoking every
 *   session. The suite would authenticate itself out.
 *
 * Sharing one context sidesteps both, because it is what a real session is: one
 * browser, one cookie jar, tokens rotating in order. The cost is that state
 * leaks between tests, so `page` clears `localStorage` below.
 */
export const test = base.extend<
  { collected: Collected; signIn: () => Promise<void> },
  { workerContext: BrowserContext }
>({
  workerContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext();

      /*
        Paced before anything in this context can boot.

        Registered on the context rather than per page, because the thing
        being budgeted is made by the *application* on every SPA boot and no
        spec is in a position to reserve it first — which is what makes this
        different from `spendLogin`, where the caller always knows.

        `route.continue()` re-issues the request Playwright is holding, cookies
        and all, so the only thing this changes is *when* it leaves.
      */
      await context.route("**/api/v1/auth/refresh", async (route) => {
        await spendRefresh();
        await route.continue();
      });

      const page = await context.newPage();

      /*
        The browser sign-in goes through the same budget as the API ones.

        It is one attempt per worker, and it used to be the one that failed —
        the form submits through `/auth/login` like everything else, and
        nothing connected it to the seven the security matrix had just spent.
        `spendLogin()` is the connection. Reacting to a 429 afterwards is what
        this replaced: a retry only helps if the window has rolled, so the
        suite either waited a minute or failed depending on timing.
      */
      await spendLogin();
      await page.goto("/admin.html#/");
      await page.getByLabel(/E-Mail/i).fill(ADMIN_EMAIL);
      await page.getByLabel(/Passwort/i).first().fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: /^Anmelden$/ }).click();

      await expect(
        page.getByRole("navigation", { name: "Hauptnavigation" }),
        "Anmeldung im Worker-Kontext fehlgeschlagen — siehe den Screenshot. " +
          "Zeigt er „Too Many Requests“, hat ein Anmeldeweg spendLogin() nicht aufgerufen.",
      ).toBeVisible({ timeout: 30_000 });

      await page.close();
      await use(context);
      await context.close();
    },
    /**
     * Two minutes, against the suite's ninety seconds.
     *
     * `spendLogin()` waits rather than fails when the window is full, and the
     * longest it can wait is one window — so the fixture needs room for a
     * sixty-second pause plus the sign-in itself. Budgeted deliberately: an
     * earlier version left this at the default and reported
     * `Fixture "workerContext" timeout of 45000ms exceeded` while it was
     * mid-wait, which reads as a hung fixture and was a remedy being cut off.
     */
    { scope: "worker", timeout: 120_000 },
  ],

  /**
   * A page in the shared context, with per-browser preferences reset.
   *
   * Cookies are kept — they are the session. `localStorage` is not: the theme,
   * the favourites and the open rail group all live there, and a test that
   * asserts a group starts collapsed should not depend on whether the previous
   * test opened one.
   */
  page: async ({ workerContext }, use) => {
    const page = await workerContext.newPage();
    await page.goto("/admin.html#/");
    await page.evaluate(() => {
      try {
        window.localStorage.clear();
      } catch {
        /* ignore */
      }
    });
    await use(page);
    await page.close();
  },

  collected: async ({ page }, use) => {
    const collected: Collected = {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      failedRequests: [],
      badResponses: [],
    };

    page.on("console", (msg) => {
      const type = msg.type();
      if (type !== "error" && type !== "warning") return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      if (type === "error") collected.consoleErrors.push(text);
      else if (!collected.consoleWarnings.includes(text)) collected.consoleWarnings.push(text);
    });

    // An uncaught exception is the one that blanks a screen, so it is tracked
    // separately from console noise rather than folded in with it.
    page.on("pageerror", (err) => collected.pageErrors.push(err.message));

    page.on("requestfailed", (req) => {
      if (IGNORED_REQUESTS.some((re) => re.test(req.url()))) return;
      const error = req.failure()?.errorText ?? "";
      /**
       * `ERR_ABORTED` is a cancellation, not a failure.
       *
       * A test that walks every rail link navigates faster than a page
       * finishes loading, and anything still in flight is cancelled by the
       * navigation. "Website bearbeiten" makes this certain: it embeds the live
       * site, whose hero fetches a 656 kB scene model. The browser reports the
       * abort exactly as it reports a refused connection, and treating them
       * alike turns "the test clicked quickly" into "the application is
       * broken". A real failure — refused, reset, unresolved — still counts.
       */
      if (error.includes("ERR_ABORTED")) return;
      collected.failedRequests.push(`${req.method()} ${req.url()} — ${error}`);
    });

    page.on("response", (res) => {
      if (res.status() < 400) return;
      if (IGNORED_REQUESTS.some((re) => re.test(res.url()))) return;
      // 401 on `/auth/refresh` is the expected answer before signing in — the
      // client asks on boot to restore a session that may not exist.
      if (res.status() === 401 && /\/auth\/refresh$/.test(res.url())) return;
      collected.badResponses.push(`${res.request().method()} ${res.url()} -> ${res.status()}`);
    });

    await use(collected);
  },

  /**
   * Now a no-op that waits for the session to be restored.
   *
   * The worker signed in once; every page in its context boots holding the
   * refresh cookie and turns it into a live session before the first screen
   * renders. Kept as a fixture rather than deleted so the specs still say where
   * they need a session, and so this comment has somewhere to live.
   */
  signIn: async ({ page }, use) => {
    await use(async () => {
      await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible({
        timeout: 30_000,
      });
    });
  },
});

export { expect };

/**
 * Forces a theme, the way a reader's stored choice would.
 *
 * Written to `localStorage` before the app boots and then applied directly, so
 * it survives the pre-paint script in `admin.html` and takes effect without a
 * reload. `addInitScript` alone would not help a page that is already open.
 */
export async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate((value) => {
    try {
      window.localStorage.setItem("iem.admin.theme", value);
    } catch {
      /* ignore */
    }
    if (value === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  }, theme);
}

/**
 * Makes every image on the page actually load, then waits for it.
 *
 * `loading="lazy"` is the whole problem. A deferred image has not begun
 * fetching, and Chromium will report it as `complete` with `naturalWidth === 0`
 * — which is indistinguishable from a broken one. That cost a diagnosis twice:
 * once as a media tile that appeared blank in both themes' screenshots, and
 * once as an image test that failed against a file the server was serving
 * correctly at 401 kB.
 *
 * Flipping them to `eager` and waiting removes the ambiguity, so afterwards a
 * zero width means exactly what it should: the image is broken.
 *
 * Returns the sources that never arrived, rather than throwing, so a caller can
 * decide whether that is a failure or just a slow screenshot.
 */
export async function settleImages(page: Page, timeout = 8_000): Promise<string[]> {
  await page.evaluate(() => {
    for (const img of document.querySelectorAll("img")) img.loading = "eager";
  });
  try {
    /**
     * Waits for the state the caller actually wants — *decoded*, not merely
     * `complete`.
     *
     * Waiting on `complete` alone and then reading `naturalWidth` is two
     * observations of a moving target: React re-renders the media grid between
     * them, the `<img>` that satisfied the wait is replaced by a fresh one that
     * has not loaded, and the read reports a width of zero for an image the
     * screenshot plainly shows. Polling for the whole condition removes the
     * gap.
     *
     * `loading` is re-applied on every poll for the same reason: a newly
     * mounted image arrives lazy again.
     */
    await page.waitForFunction(
      () => {
        const imgs = [...document.querySelectorAll("img")];
        for (const i of imgs) i.loading = "eager";
        return imgs.every((i) => i.complete && i.naturalWidth > 0);
      },
      undefined,
      { timeout, polling: 250 },
    );
  } catch {
    /* Fall through: whatever is still unloaded is reported below. */
  }
  return page.evaluate(() =>
    [...document.querySelectorAll("img")]
      .filter((i) => i.naturalWidth === 0)
      .map((i) => i.getAttribute("src") ?? "(no src)"),
  );
}

/**
 * Asserts nothing went wrong in the background, with a readable failure.
 *
 * Warnings are printed rather than asserted — see `Collected.consoleWarnings`.
 * They appear in the run's output so they are not lost, and they do not decide
 * whether the suite is green.
 */
export function expectClean(collected: Collected, where: string): void {
  if (collected.consoleWarnings.length) {
    console.log(`  ⚠ console warnings on ${where}:`);
    for (const w of collected.consoleWarnings) console.log(`      ${w}`);
  }
  expect(collected.pageErrors, `uncaught exceptions on ${where}`).toEqual([]);
  expect(collected.failedRequests, `failed requests on ${where}`).toEqual([]);
  expect(collected.badResponses, `error responses on ${where}`).toEqual([]);
  expect(collected.consoleErrors, `console errors on ${where}`).toEqual([]);
}

/**
 * Every screen the dashboard serves, with what proves it rendered.
 *
 * `Projekte` and `Kunden` are deliberately absent. They do not exist: the
 * `projects` content type is the public website's reference case studies, not
 * an operational project module, and there is no customer entity at all. See
 * §0 of docs/system-audit.md.
 */
export const SCREENS: { path: string; name: string; heading: RegExp }[] = [
  /**
   * The greeting eyebrow, not the name.
   *
   * The name is also the label on the account button in the top bar, which is
   * `hidden sm:block` — so at 390px `.first()` resolved to an element that is
   * deliberately invisible and the mobile run failed on a page that had
   * rendered perfectly. The eyebrow appears once and at every width.
   */
  { path: "/", name: "dashboard", heading: /Guten (Morgen|Tag|Abend)/i },
  /**
   * The description, not the word "Projekte".
   *
   * `.first()` on `/Projekte/i` would resolve to the **rail row**, which is
   * visible on every screen — so the assertion would pass whatever the page
   * rendered. The same trap the dashboard entry above documents, in a different
   * shape: a heading is only a useful assertion when it appears once.
   *
   * The project *detail* is not here, because its path needs an id from the
   * database. `projects.spec.ts` covers it and walks its tabs.
   */
  { path: "/projekte", name: "projects", heading: /Zustand und Fortschritt werden berechnet/i },
  /**
   * The description again, and for the same reason: "Aufgaben" is a rail row on
   * every screen, so `.first()` on it would pass whatever the page rendered.
   *
   * The board is what `/aufgaben` opens on, so this entry photographs five
   * columns at three widths — which is the assertion that matters here, because
   * a five-column grid is the one layout in the dashboard that has nowhere to go
   * at 390px. There is no task *detail* path: a task opens in a drawer, so it
   * has no URL. See the note on `TaskDrawer`.
   */
  { path: "/aufgaben", name: "tasks", heading: /Der Status wird verschoben, nicht erfasst/i },
  /**
   * The description again, and for the third time for the same reason:
   * "Sitzungen" and "Entscheide" are both rail rows on every screen.
   *
   * Two entries rather than one, because they are two destinations — a decision
   * outlives the meeting it was taken in, and the register is reached without
   * going through the chronology. There is **no** `/sitzungen/:id` entry here:
   * the detail path needs a seeded meeting, so `meetings.spec.ts` creates one
   * and walks its five tabs rather than this sweep guessing an id.
   */
  { path: "/sitzungen", name: "meetings", heading: /Ein genehmigtes Protokoll ist der Stand/i },
  { path: "/entscheide", name: "decisions", heading: /er gilt nur nicht mehr/i },
  /**
   * The description again, and for the same reason as the four above:
   * "Pläne" and "Planversand" are both rail rows on every screen.
   *
   * No `/plaene/:id` entry — the detail path needs a seeded plan, so
   * `drawings.spec.ts` opens one from the register and walks its three tabs
   * rather than this sweep guessing an id.
   */
  { path: "/plaene", name: "drawings", heading: /jemand baut danach/i },
  { path: "/planversand", name: "transmittals", heading: /durch einen neuen ersetzt/i },
  { path: "/inhalte", name: "content-index", heading: /Website|Inhalte/i },
  { path: "/inhalte/projects", name: "content-list-projects", heading: /Referenz/i },
  { path: "/inhalte/team", name: "content-list-team", heading: /Team/i },
  { path: "/freigaben", name: "reviews", heading: /Freigabe/i },
  { path: "/veroeffentlichen", name: "publish", heading: /Veröffentlich/i },
  { path: "/medien", name: "media", heading: /Medien/i },
  { path: "/bewerbungen", name: "applications", heading: /Bewerbung/i },
  { path: "/benutzer", name: "users", heading: /Benutzer/i },
  { path: "/rollen", name: "roles", heading: /Rollen/i },
  /**
   * Einstellungen, and six of its eleven sections rather than one entry.
   *
   * The workspace renders through **five different paths** — the organisation
   * form, the offices register, a key/value group, the not-built placeholder
   * and the read-only system panel — and a sweep that visited only the default
   * section would photograph one of them and prove nothing about the rest.
   * Six entries cover all five, with `rechtliches` in as well because it is
   * the widest form in the dashboard (seventeen fields, two columns) and
   * therefore the likeliest to overflow at a phone width.
   *
   * The headings are each section's own **description**, not its title.
   * `getByText(...).first()` matches the rail too, and "Standorte" and
   * "System" are both rail rows — a title match would pass while the content
   * column was empty, which is the one failure this sweep exists to catch.
   */
  {
    path: "/einstellungen",
    name: "settings",
    heading: /Die Angaben zur Firma, ihre Standorte/i,
  },
  {
    path: "/einstellungen/rechtliches",
    name: "settings-legal",
    heading: /Was im Handelsregister steht/i,
  },
  {
    path: "/einstellungen/standorte",
    name: "settings-offices",
    heading: /im Kopf, im Kontaktfeld/i,
  },
  /*
    `Versand prüfen` until P2-4, which removed the one-button test card the
    phrase belonged to. The section is now the settings form plus an operations
    panel, so the text that identifies it is the panel's own heading — and
    "Diagnose" is the better anchor anyway: it names what the screen is *for*
    rather than a control that might move.
  */
  { path: "/einstellungen/email", name: "settings-mail", heading: /Diagnose/i },
  /*
    Both halves of Backup & Recovery (P2-5), because they are different
    screens with different shapes: one is a settings form with a panel under
    it, the other is two tables and a destructive action. The axe pass and the
    three widths have to see both — the history table is the widest thing in
    the dashboard and is exactly where `scrollable-region-focusable` bit last
    time.
  */
  { path: "/sicherungen", name: "backups", heading: /Wiederherstellungspunkte/i },
  {
    path: "/einstellungen/sicherung",
    name: "settings-backup",
    heading: /Aufbewahrung/i,
  },
  /*
    Was the `unbuilt` placeholder until P2-3; it is now the organisation's
    rules plus the delivery log. The entry was *replaced* rather than added
    beside the old one — for one run it was both, and a duplicate `name` is
    not the harmless thing it looks like: `a11y.spec.ts` keys its report by
    the name, so the same screen was scanned twice and every violation on it
    was reported twice under one id, which reads as two separate faults.
  */
  {
    path: "/einstellungen/benachrichtigungen",
    name: "settings-notifications",
    heading: /Welche Ereignisse benachrichtigen/i,
  },
  {
    path: "/einstellungen/system",
    name: "settings-system",
    heading: /Migrationsstand/i,
  },
  /*
    The System Control Center, in two of its three sections (P2-6).

    Both, because they are different *shapes* rather than the same screen with
    different words: the overview is a grid of cards and a definition list,
    Aufgaben is a filter bar over a wide `DataTable`. The table is what makes
    the second entry worth the run — `scrollable-region-focusable` fires only
    when a pane both overflows *and* holds no focusable element, so a
    six-column table is exactly where it bit before, and it bites at tablet and
    phone widths rather than at desktop.

    Diagnose is deliberately **not** here. Its content appears only after a
    button is pressed, and that button opens a real SMTP connection — running
    it six times per suite (three widths × two themes) would make the
    screenshot pass a load test against somebody else's mail server. Its empty
    state is covered by the run on the overview's own axe pass, and its filled
    state by `system.spec.ts`.
  */
  { path: "/system", name: "system-overview", heading: /Systemzustand/i },
  /*
    The Aufgaben section is identified by its **description**, not by
    "Hintergrundaufgaben".

    That word is the section's `usePageTitle`, so it lands in the breadcrumb —
    which the shell hides at phone width. `getByText(...).first()` therefore
    resolved to a hidden span ahead of the visible card title, and the test
    failed at 390 px only. The breadcrumb is behaving correctly; the string
    was the problem. This one appears once, in the page body, at every width.
  */
  {
    path: "/system/aufgaben",
    name: "system-jobs",
    heading: /ausserhalb einer Anfrage/i,
  },
  { path: "/audit", name: "audit", heading: /Audit/i },
  { path: "/profil", name: "profile", heading: /Profil|Konto/i },
  /**
   * The notification centre, at all three widths and in both themes.
   *
   * The heading is the page's **description**, not its title: "Benachrichtigungen"
   * is a heading, a tab label and — now — the accessible name of a button in
   * the header of every screen, so `getByText(...).first()` on it would match
   * the bell and pass whatever the page rendered. The same trap the six
   * entries above document.
   *
   * Two entries rather than one, because the settings tab is a different
   * layout: a grid of grouped switches is the one thing in this module with
   * nowhere to go at 390px, which is exactly what this sweep is for.
   */
  {
    path: "/benachrichtigungen",
    name: "notifications",
    heading: /Was Ihr Konto und Ihre Arbeit betrifft/i,
  },
  {
    path: "/benachrichtigungen/einstellungen",
    name: "notifications-settings",
    heading: /Welche Ereignisse überhaupt benachrichtigen/i,
  },
];
