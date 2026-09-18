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

export default defineConfig({
  testDir: "./e2e",
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
  // Generous: the first navigation to a lazy route compiles a chunk in dev.
  timeout: 45_000,
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
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: false },
    },
  ],
});
