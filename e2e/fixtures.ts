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

export const API_ORIGIN =
  process.env.E2E_API_ORIGIN ||
  fromAnyEnvFile("VITE_CMS_API", [".env.local", ".env", ".env.development"]) ||
  "http://localhost:3100";

export const API = `${API_ORIGIN}/api/v1`;

/**
 * One API sign-in per account, shared by every spec in the worker.
 *
 * **Memoised because `/auth/login` allows ten attempts a minute per IP**, and
 * the API-level suites together wanted twelve: `security.spec.ts` signs in
 * seven roles, `versioning.spec.ts` and `budgets.spec.ts` each signed in the
 * administrator again, and three browser sessions follow. The eleventh got a
 * 429 that reads as a permissions bug.
 *
 * The alternative repairs were both wrong. Raising the limit would weaken a
 * real control to suit a test — and a throttle the tests do not exercise is a
 * throttle nobody notices breaking. Dropping a role would shrink the matrix
 * that is the point of the suite. Signing in once and sharing the token is what
 * a person does.
 *
 * Lives here rather than in a spec because module state is per worker, and this
 * runs with one worker: three files importing this get one token each.
 */
const tokens = new Map<string, string>();

export async function apiToken(email: string, password: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;

  const anonymous = await request.newContext();
  let response = await anonymous.post(`${API}/auth/login`, { data: { email, password } });

  // Ridden out rather than raised — see above. Sixty seconds, only on a re-run
  // inside the window, and a security suite can afford it.
  if (response.status() === 429) {
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    response = await anonymous.post(`${API}/auth/login`, { data: { email, password } });
  }

  if (!response.ok()) {
    await anonymous.dispose();
    throw new Error(
      `${email} konnte sich nicht anmelden (HTTP ${response.status()}). ` +
        `Für die Rollenkonten: SEED_TEST_USERS=true npm run server:seed`,
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
      const page = await context.newPage();
      await page.goto("/admin.html#/");
      await page.getByLabel(/E-Mail/i).fill(ADMIN_EMAIL);
      await page.getByLabel(/Passwort/i).first().fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: /^Anmelden$/ }).click();
      await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible({
        timeout: 30_000,
      });
      await page.close();
      await use(context);
      await context.close();
    },
    { scope: "worker" },
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
  { path: "/einstellungen", name: "settings", heading: /Einstellungen|System/i },
  { path: "/audit", name: "audit", heading: /Audit/i },
  { path: "/profil", name: "profile", heading: /Profil|Konto/i },
];
