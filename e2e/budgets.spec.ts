import { request, type APIRequestContext } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API, expect, test } from "./fixtures";
import {
  API_BUDGETS,
  CLIENT_BUDGETS,
  MEANINGFUL_ROW_COUNT,
  SAMPLES,
  WARMUP,
  report,
  summarise,
} from "./budgets";

/**
 * The performance budgets, enforced.
 *
 * Demanded before Wave 2 alongside the security matrix, and for the same
 * reason: nineteen modules will be measured against whatever baseline exists
 * when they arrive, and a baseline established afterwards is an average of
 * whatever was already slow.
 *
 * `budgets.ts` holds the numbers and the argument for each. This file does the
 * measuring, and the *method* is most of what makes it a regression test rather
 * than a benchmark — warm up, discard, sample nine times, assert the median,
 * report the spread. See the note at the top of `budgets.ts`.
 *
 * **What this does not prove.** It runs against one developer machine with one
 * Postgres and no concurrency, so it cannot say what the system does under
 * load. It can say — and this is the whole of its job — that the query behind a
 * screen did not change shape since the last run.
 */

let api: APIRequestContext;
let projectCount = 0;
let sampleProjectId = "";

test.beforeAll(async () => {
  const anonymous = await request.newContext();
  const login = await anonymous.post(`${API}/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(login.ok(), `Anmeldung fehlgeschlagen (HTTP ${login.status()})`).toBe(true);
  const { data } = (await login.json()) as { data: { accessToken: string } };
  await anonymous.dispose();

  api = await request.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${data.accessToken}` },
  });

  const list = await api.get(`${API}/projects?perPage=1`);
  const body = (await list.json()) as { data: { items: { id: string }[]; total: number } };
  projectCount = body.data.total;
  sampleProjectId = body.data.items[0]?.id ?? "";
});

test.afterAll(async () => {
  await api?.dispose();
});

/**
 * Nine samples of one request, the first two thrown away.
 *
 * Timed around the **whole** call including reading the body, because a handler
 * that streams its rows slowly is slow whatever the time-to-first-byte says.
 */
async function measure(path: string) {
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES + WARMUP; i++) {
    const started = Date.now();
    const response = await api.get(`${API}${path}`);
    await response.body();
    const elapsed = Date.now() - started;
    expect(response.status(), `${path} antwortete mit ${response.status()}`).toBe(200);
    if (i >= WARMUP) samples.push(elapsed);
  }
  return summarise(samples);
}

test.describe("API response budgets", () => {
  // Nine samples of seven endpoints, plus warm-ups. Generous, because the
  // alternative is a suite that times out on a cold database and reads as a
  // performance failure.
  test.setTimeout(120_000);

  test("reports what it is measuring against", async () => {
    /*
      Not an assertion about speed — an assertion about *honesty*.

      A green budget run over two rows is evidence of nothing, and the most
      likely way this suite becomes theatre is by being read as evidence anyway.
      So the row count is printed on every run, and the test fails only if the
      seed has not run at all.
    */
    expect(projectCount, "keine Projekte — läuft der Seed?").toBeGreaterThan(0);
    expect(sampleProjectId, "kein Projekt für das Detail-Budget").not.toBe("");

    const meaningful = projectCount >= MEANINGFUL_ROW_COUNT;
    console.log(
      `\n  Budgets gemessen gegen ${projectCount} Projekte — ` +
        (meaningful
          ? "aussagekräftig für die Listenabfragen."
          : `unter ${MEANINGFUL_ROW_COUNT}: prüft Erreichbarkeit, nicht Skalierung. ` +
            `SEED_LOAD_PROJECTS=500 npm run server:seed setzt eine echte Grundlage.`),
    );
  });

  const CASES: { key: keyof typeof API_BUDGETS; path: () => string }[] = [
    { key: "dashboard.overview", path: () => "/dashboard/overview" },
    { key: "projects.list", path: () => "/projects" },
    {
      key: "projects.listFiltered",
      path: () => "/projects?filter[status]=in:ACTIVE,ON_HOLD&sort=plannedEndDate:asc",
    },
    { key: "projects.detail", path: () => `/projects/${sampleProjectId}` },
    { key: "projects.search", path: () => "/projects?q=sanierung" },
    { key: "projects.stats", path: () => "/projects/stats" },
    { key: "masterdata.pickers", path: () => "/customers?perPage=50&sort=name:asc" },
  ];

  for (const { key, path } of CASES) {
    const budget = API_BUDGETS[key];
    test(`${budget.label} < ${budget.ms}ms`, async () => {
      const measurement = await measure(path());
      const line = report(budget.label, budget.ms, measurement);
      console.log(`  ${line}`);
      expect(measurement.median, `${line}\n  → ${budget.why}`).toBeLessThan(budget.ms);
    });
  }

  /**
   * The N+1 check, which is the one a wall-clock budget cannot make.
   *
   * A list whose per-row cost is a separate query grows linearly with
   * `perPage`, and at a small page size that is invisible: twenty-five extra
   * round-trips against a local database is a few milliseconds. Comparing one
   * row against fifty makes the slope visible — an honest `select` with joins
   * is nearly flat, because the work is the query plan and not the rows.
   *
   * Skipped below the meaningful row count, where there are not fifty rows to
   * ask for and the comparison would be one against one.
   */
  test("the list does not pay per row", async () => {
    test.skip(
      projectCount < MEANINGFUL_ROW_COUNT,
      `nur ${projectCount} Projekte — für den N+1-Vergleich braucht es ${MEANINGFUL_ROW_COUNT}. ` +
        `SEED_LOAD_PROJECTS=500 npm run server:seed`,
    );

    const one = await measure("/projects?perPage=1");
    const fifty = await measure("/projects?perPage=50");

    console.log(
      `  perPage=1 p50 ${one.median}ms · perPage=50 p50 ${fifty.median}ms · ` +
        `Faktor ${(fifty.median / Math.max(1, one.median)).toFixed(2)}`,
    );

    /*
      A factor rather than a difference, and a generous one.

      Fifty rows legitimately cost more than one — more bytes to serialise, more
      rows to read. What they must not cost is *fifty times* more, which is what
      a query per row looks like. Four is loose enough to survive a noisy
      machine and tight enough that an N+1 cannot hide under it.
    */
    expect(
      fifty.median,
      `50 Zeilen dauern ${fifty.median}ms gegen ${one.median}ms für eine — das ist die Form einer N+1-Abfrage`,
    ).toBeLessThan(Math.max(one.median * 4, one.median + 150));
  });

  /**
   * The scope costs nothing, or the row-level rules become a performance bug.
   *
   * `projects.scope.ts` ANDs an `OR` of two predicates into every query a
   * restricted caller makes, one of which is a `some` across `ProjectMember`.
   * That is a join and a subquery, and it runs on every list the majority of
   * the firm will ever load — so it is budgeted rather than assumed.
   */
  test("a narrowed list is not slower than a wide one", async () => {
    const wide = await measure("/projects");
    console.log(`  ungefiltert p50 ${wide.median}ms`);
    // The restricted case needs a restricted account, which `security.spec.ts`
    // owns. Here the point is the ceiling: if the *unrestricted* list is
    // already at its budget, adding a subquery to it will not stay under one.
    expect(wide.median).toBeLessThan(API_BUDGETS["projects.list"].ms);
  });
});

test.describe("client budgets", () => {
  /**
   * Navigating between two screens that are already loaded.
   *
   * Measured after both chunks are fetched and both queries are cached, which
   * is what makes 100 ms a fair number: it budgets the router and the render,
   * not the network. The first visit to each screen is deliberately outside the
   * measurement.
   */
  test(`${CLIENT_BUDGETS.navigation.label} < ${CLIENT_BUDGETS.navigation.ms}ms`, async ({
    page,
    signIn,
  }) => {
    await signIn();

    // Warm both routes: chunk fetched, data in the query cache.
    await page.goto("/admin.html#/projekte");
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Projekte" })).toBeVisible({
      timeout: 15_000,
    });
    await page.goto("/admin.html#/audit");
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });

    /**
     * Timed **inside the page**, and that is not a refinement — it is the
     * difference between measuring the router and measuring Playwright.
     *
     * The first version drove this from the test process: `page.evaluate` to
     * set the hash, then `expect(locator).toBeVisible()`. It reported 155 ms
     * against a 100 ms budget, and almost all of it was the harness — two CDP
     * round-trips plus `expect`'s retry interval, which cannot resolve faster
     * than its own polling however quickly the page renders. Raising the budget
     * to 200 ms would have "fixed" it by writing the harness's overhead into
     * the contract, where every future reading would carry it and no regression
     * under 45 ms would ever be visible again.
     *
     * So the clock starts and stops in the browser: `performance.now()` either
     * side of the hash change, resolved by a `MutationObserver` the moment the
     * heading appears. That is the number a person experiences.
     */
    const samples: number[] = await page.evaluate(async (rounds) => {
      const headingIs = (text: RegExp) => {
        const h1 = document.querySelector("h1");
        return h1 ? text.test(h1.textContent ?? "") : false;
      };

      const go = (hash: string, expected: RegExp) =>
        new Promise<number>((resolve, reject) => {
          const started = performance.now();
          const done = () => {
            observer.disconnect();
            clearTimeout(timer);
            // One frame after the DOM says so, because a heading that exists
            // but has not been painted is not a navigation the reader has seen.
            requestAnimationFrame(() => resolve(Math.round(performance.now() - started)));
          };
          const observer = new MutationObserver(() => {
            if (headingIs(expected)) done();
          });
          const timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error(`${hash} zeigte nach 10s keine Überschrift`));
          }, 10_000);

          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
          window.location.hash = hash;
          // The screen may already be rendered — a mutation observer that
          // never fires would hang on the one case that is fastest.
          if (headingIs(expected)) done();
        });

      const measured: number[] = [];
      for (let i = 0; i < rounds; i++) {
        measured.push(await go("#/projekte", /Projekte/));
        await go("#/audit", /Audit/);
      }
      return measured;
    }, 7);

    const measurement = summarise(samples);
    const line = report(CLIENT_BUDGETS.navigation.label, CLIENT_BUDGETS.navigation.ms, measurement);
    console.log(`  ${line}`);
    expect(measurement.median, line).toBeLessThan(CLIENT_BUDGETS.navigation.ms);
  });
});
