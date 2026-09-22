import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end and accessibility runs against the real dashboard.
 *
 * These are **not** part of `npm run verify`, and that is deliberate. `verify`
 * is the pre-commit gate: it typechecks, lints and runs unit tests, needs
 * nothing running, and finishes in seconds. These need a live API, a seeded
 * PostgreSQL and a browser, so folding them in would turn a fast gate into one
 * that fails on a machine with no database — and a gate that fails for reasons
 * unrelated to the change is a gate people learn to skip.
 *
 * `npm run verify:e2e` runs both. See the scripts in package.json.
 *
 * **The servers are reused, never started.** `webServer` is deliberately absent:
 * `npm run dev` and `npm run server:dev` are long-running processes a developer
 * already has open, and having the test runner start and kill them would
 * interrupt the session it is being run from. The tests fail with a clear
 * message if nothing is listening.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

/**
 * Suites that talk to the API and never open a page — desktop only.
 *
 * Two reasons, and the second is the one that actually bit.
 *
 * **They say nothing different at a phone width.** A bearer token and a JSON
 * body do not have a viewport; running the permission matrix three times
 * measures the same thing three times.
 *
 * **And they cannot.** Each signs in several accounts, `/auth/login` allows ten
 * attempts a minute per IP, and three widths triples the count — so the second
 * and third projects failed with what looked like a permissions bug and was a
 * rate limit. Lowering the matrix or raising the limit would both be the wrong
 * repair; running the suite once is the right one.
 *
 * `security.spec.ts` does contain three *browser* cases at the foot, and they
 * check that the shell hides what a role cannot reach — which is also not a
 * width-dependent question.
 */
const API_ONLY = [
  /security\.spec\.ts/,
  /versioning\.spec\.ts/,
  /budgets\.spec\.ts/,
  /metrics\.spec\.ts/,
  /tasks\.spec\.ts/,
  /meetings\.spec\.ts/,
  /drawings\.spec\.ts/,
];

/**
 * Browser suites that still run **once**, for the second of those two reasons.
 *
 * `meetings-ui.spec.ts` drives real pages, so it does not belong in `API_ONLY` —
 * but it signs an API context in at `beforeAll` to build its fixtures, and that
 * is one `/auth/login` per project. Running it at three widths spent three of
 * the ten attempts a minute, and the suite's own per-worker sign-in then failed
 * on the tablet project: the first tests of `projects.spec.ts` reported
 * "Hauptnavigation not found" against a screenshot of the **login page**.
 *
 * That reads as a broken shell and is a rate limit — exactly the misdiagnosis
 * the note above describes, arriving by a slightly different route. Worth
 * recording, because the lesson is narrower than "API suites run once": **it is
 * the sign-ins that are budgeted, not the requests**, so any spec that
 * authenticates in a fixture costs a width.
 *
 * Nothing is lost by running it once. Every assertion in it is about a URL, a
 * grouping, a read-only state or the presence of a control — none is
 * width-dependent, and `screens.spec.ts` already photographs `/sitzungen` and
 * `/entscheide` at all three widths in both themes and runs axe over them.
 */
const SIGNS_IN_TWICE = [/meetings-ui\.spec\.ts/, /drawings-ui\.spec\.ts/, /auth\.spec\.ts/];

/**
 * The one suite that runs once for **all three** reasons at the same time.
 *
 * `mfa.spec.ts` signs three accounts in at `beforeAll`, opens two browser
 * contexts of its own, and enables a real second factor on a live account.
 * Any one of those would put it here; together they make running it at three
 * widths both expensive and actively harmful — three projects enrolling and
 * disabling the same credential would race each other through a shared
 * database, and the failures would surface as wrong TOTP codes.
 *
 * It is also the slowest file in the suite by a distance, and unavoidably so:
 * the replay guard refuses a time step at or below the one already accepted,
 * so a test that authenticates twice with the same credential has to **wait
 * out a thirty-second step** between them. That is the feature working. The
 * waits are in `waitForNextStep` and there are as few of them as the
 * assertions allow.
 */
const SECOND_FACTOR = [/mfa\.spec\.ts/];

/**
 * Notifications, once, for the same three reasons together.
 *
 * It signs two accounts in, opens a browser context of its own, and changes
 * a real second factor to produce the events it asserts on — which is the
 * only fully reversible trigger in the catalogue. Running it at three widths
 * would have three projects enrolling and resetting the same credential
 * through one database, and the failures would surface as wrong TOTP codes
 * two specs away.
 *
 * Nothing is lost by running it once: every assertion in it is about an API
 * response, a count, a permission or the presence of a control, and
 * `screens.spec.ts` already photographs the shell — bell included, since it
 * is in the header of every screen — at all three widths in both themes.
 */
const NOTIFICATIONS = [/notifications\.spec\.ts/];

/**
 * Email Operations, once, and for a reason the others do not have: it
 * **mutates shared configuration and talks to a real SMTP server**.
 *
 * `mail.spec.ts` points `mail.smtpHost` at Mailpit for the duration of the
 * file and restores it in `afterAll`. Running that at three widths means three
 * projects writing the same settings rows through one database while three
 * other copies of the acceptance test submit content and wait for mail —
 * whichever finished last would restore the configuration under the two still
 * running, and the failures would surface as `SKIPPED` deliveries in a spec
 * that had configured SMTP correctly.
 *
 * Nothing is lost by running it once: every assertion is about an API
 * response, a Mailpit message or a permission, and none is width-dependent.
 */
const MAIL = [/mail\.spec\.ts/];

/**
 * Sicherung und Wiederherstellung, once, and for the strongest reason on this
 * list: it **spawns `pg_dump`, writes hundreds of megabytes and creates and
 * drops a database**.
 *
 * Running that at three widths means three processes dumping the same database
 * at the same time onto the same disk, three drills racing for one
 * `<db>_restore_drill` target — which the drill drops and recreates, so two
 * overlapping runs would destroy each other's target mid-restore — and a disk
 * check that is wrong because two siblings are writing into the space it just
 * measured.
 *
 * It is also the spec whose resource use most distorts anything measured
 * beside it. The budget failure recorded in CLAUDE.md was a suite measuring a
 * machine under load; this one *is* the load.
 */
const BACKUP = [/backup\.spec\.ts/];

/**
 * Browser suites that run once for a **third** reason: they write.
 *
 * `organisation.spec.ts` edits the company record and tries to archive the
 * headquarters. Each test restores what it changed, but running the same
 * mutation three times against one database buys nothing — every assertion in
 * it is about a request count, a persisted value or a refusal, and none of
 * those is width-dependent. `screens.spec.ts` already photographs six of the
 * workspace's sections at all three widths and runs axe over them, which is
 * where the responsive question is actually answered.
 */
const MUTATES = [/organisation\.spec\.ts/, /sessions\.spec\.ts/];

/**
 * Publishing, once, and it is the strongest "writes" case on this list short of
 * the backup: it **changes what the public website shows**.
 *
 * `publishing.spec.ts` publishes real snapshots, withdraws entries from the
 * live document and restores an earlier one. At three widths that is three
 * processes publishing and rolling back one document through one database —
 * and the assertions are against the *published* state, so each project would
 * be measuring what the other two had just done. The failures would read as a
 * broken workflow.
 *
 * Nothing is lost by running it once. Every assertion is about an API
 * response, a status or the content of the public document, except one browser
 * check that the site renders what was published — and that check is about
 * whether the fetch-and-swap happens at all, which does not vary with the
 * viewport.
 */
const PUBLISHING = [/publishing\.spec\.ts/];

/**
 * The System Control Center, once, for the reason `mail.spec.ts` gives: it
 * **reaches a third party**.
 *
 * `system.spec.ts` runs the diagnostics, which opens an SMTP connection and
 * writes a probe file to the backup volume. That route is throttled at three
 * a minute server-side, and the spec spends two of them — so at three widths
 * it would meet its own 429 and report it as a broken diagnostics endpoint.
 *
 * Nothing is lost by running it once. Every assertion is about an API
 * response, a permission or the presence of a control, and `screens.spec.ts`
 * already photographs `/system` and `/system/aufgaben` at all three widths in
 * both themes — which is where the responsive question about the job table is
 * actually answered.
 */
const SYSTEM = [/system\.spec\.ts/];

/**
 * Suites that assert about the *repository* rather than about the running
 * application, and are therefore width-independent by construction.
 *
 * `login-budget.spec.ts` reads the other spec files and checks that every
 * path to `/auth/login` reserves an attempt first. Running that three times
 * would read the same files three times and report the same answer.
 */
const SOURCE_ASSERTIONS = [/login-budget\.spec\.ts/];

/** What the two narrower projects skip. */
const RUN_ONCE = [
  ...API_ONLY,
  ...SIGNS_IN_TWICE,
  ...MUTATES,
  ...SOURCE_ASSERTIONS,
  ...SECOND_FACTOR,
  ...NOTIFICATIONS,
  ...MAIL,
  ...BACKUP,
  ...PUBLISHING,
  ...SYSTEM,
];

export default defineConfig({
  testDir: "./e2e",
  /**
   * Clears stale test-owned data before anything runs.
   *
   * **Before, not after**, and that is the whole point: a cleanup that runs
   * afterwards is exactly the one a crash skips. See `e2e/global-setup.ts` for
   * the 782-drawings failure this was written against, and
   * `server/prisma/e2e-cleanup.ts` for what it will and will not delete.
   *
   * It never fails the run — a briefly unreachable database must not read as a
   * broken suite. `hygiene.spec.ts` is what fails the build if the mechanism
   * itself goes missing.
   */
  globalSetup: "./e2e/global-setup.ts",
  /**
   * Only `*.spec.ts`, so `fixtures.ts` and `budgets.ts` are libraries.
   *
   * Playwright's default is every `.ts` under `testDir`, which would load both
   * as test files and report "no tests found" for each — two permanent
   * non-failures in the output that a reader has to learn to ignore. Stating
   * the pattern is cheaper than that, and it is what lets a spec have a module
   * beside it.
   */
  testMatch: /.*\.spec\.ts$/,
  /**
   * Generous for two reasons, and the second is the one that sets the number.
   *
   * The first navigation to a lazy route compiles a chunk in dev, which is
   * what 45 seconds used to cover.
   *
   * The second is the **login throttle ride-out**. `apiToken` and the browser
   * `workerContext` both answer a 429 by waiting 61 seconds and trying once
   * more — the remedy the repeated misdiagnosis in CLAUDE.md prescribes,
   * because raising the limit would weaken a real control and dropping a role
   * would shrink the security matrix. A 45-second budget cannot contain a
   * 61-second wait, so the remedy could not complete: a spec calling `apiAs`
   * in `beforeAll` reported `"beforeAll" hook timeout of 45000ms exceeded`
   * while it was mid-sleep, which reads as a hung fixture.
   *
   * 90 seconds is the ride-out plus room to finish signing in. It costs a
   * slower verdict on a genuinely hung test, and the alternative is a remedy
   * that only works in the specs that happen to have their own timeout.
   */
  timeout: 90_000,
  expect: { timeout: 10_000 },

  /**
   * Serial, not parallel.
   *
   * The suite signs in as the one seeded administrator and several specs write
   * — hiding an entry, changing a setting — against a single shared database.
   * Running them at once would make them read each other's writes, which is a
   * flake that looks like a product bug. The whole run takes under a minute.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,

  reporter: [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]],

  use: {
    baseURL: BASE_URL,
    /**
     * The full Chromium build, not `chromium-headless-shell`.
     *
     * The shell is the faster default and it composites differently: a region
     * that has never been on screen can be missing from a `fullPage` capture
     * even though it renders. The media tile came out as a flat rectangle at
     * 390px while the DOM reported `naturalWidth: 2560` and an element
     * screenshot showed the photo — the image was fine, the capture had nothing
     * to copy, and no amount of waiting or scrolling fixed it.
     *
     * Since the screenshots are a deliverable here, correctness of the capture
     * is worth a slower browser.
     */
    channel: "chromium",
    // Traces and screenshots only for failures: a green run should not leave
    // hundreds of megabytes behind.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
  },

  /**
   * The three widths the dashboard is built for.
   *
   * 1920×1080 is the desktop the shell assumes; 768 is the tablet width where
   * the rail is still off-canvas (`lg:` is 1024, so this is the interesting
   * case rather than the obvious one); 390×844 is a current phone.
   *
   * Only Chromium. The project has no cross-browser commitment and adding two
   * more engines would triple the run for a dashboard used internally on one.
   */
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
      testIgnore: RUN_ONCE,
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: false },
      testIgnore: RUN_ONCE,
    },
  ],
});
