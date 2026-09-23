import type { APIRequestContext } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API, apiAs, expect, test } from "./fixtures";

/**
 * The System Control Center, against the live API and the real screens.
 *
 * ---
 *
 * ## What only a live run can establish
 *
 * `health.test.ts`, `jobs.rules.test.ts` and `diagnostics.rules.test.ts`
 * assert the arithmetic exhaustively and in milliseconds. None of them can see
 * any of the following, because none of it is arithmetic:
 *
 * | | |
 * | --- | --- |
 * | The guards fire | `@RequirePermissions` is metadata until Nest reads it |
 * | The payload is scrubbed | the denylist runs over a real row, not a fixture |
 * | A destructive retry is refused | the rule and the route have to agree |
 * | The diagnostics actually run | eight checks against real infrastructure |
 *
 * ## No job is created here
 *
 * The suite reads the queue and asserts the *shape* of what it finds. Creating
 * a job to operate on would mean enqueueing one whose handler does real work —
 * a publish, a backup, a delivery — and the alternative, a job with no
 * handler, is held as `DEAD` with a message, which is a fine thing to *find*
 * and a strange thing to manufacture. The retry and cancel refusals are proved
 * against ids that do not exist and against whatever the seeded system has,
 * which is what the rules make decidable without a fixture.
 */

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);
});

test.afterAll(async () => {
  await api?.dispose();
});

/* ================================================================== */
/* The overview                                                        */
/* ================================================================== */

test.describe("the system overview", () => {
  test("reports every subsystem with a state the vocabulary allows", async () => {
    const response = await api.get(`${API}/dashboard/system/overview`);
    expect(response.status()).toBe(200);
    const info = ((await response.json()) as { data: Overview }).data;

    const STATES = ["healthy", "warning", "critical", "not_configured", "unknown"];
    expect(STATES).toContain(info.health.state);
    expect(info.health.subjects.length).toBeGreaterThanOrEqual(8);

    for (const subject of info.health.subjects) {
      expect(STATES, `${subject.key} has an unknown state`).toContain(subject.state);
      expect(subject.label.length, subject.key).toBeGreaterThan(2);
      // A healthy subject carrying a reason would put a sentence under a green
      // badge with nothing to do about it.
      if (subject.state === "healthy") expect(subject.reasons, subject.key).toEqual([]);
    }
  });

  /**
   * The design decision, asserted rather than trusted.
   *
   * A score is unactionable by construction — it cannot be used without
   * expanding it back into the list it came from, and 93 % reads as "fine" on
   * the morning the backups stopped.
   */
  test("carries reasons rather than a score", async () => {
    const info = await overview();
    expect(JSON.stringify(info.health)).not.toMatch(/"(score|percent|percentage)"/i);

    if (info.health.state !== "healthy") {
      // Every reason names its subject, because the banner shows them
      // detached from the cards they came from.
      for (const reason of info.health.reasons) expect(reason).toContain(":");
    }
  });

  /**
   * The open half of P1-3. Either it knows, or it says why it does not —
   * never `0.0.1` from `package.json`, which would be a number that never
   * changes shown where a reader looks for one that does.
   */
  test("names the build, or says it cannot", async () => {
    const info = await overview();
    expect(["environment", "stamp", "none"]).toContain(info.build.source);
    if (info.build.source === "none") {
      expect(info.build.version).toBeNull();
      expect(info.build.reason).toBeTruthy();
    } else {
      expect(info.build.reason).toBeNull();
      expect(info.build.version || info.build.commit).toBeTruthy();
    }
    expect(info.build.environment).toBeTruthy();
  });

  test("reports the migration state from the real table", async () => {
    const info = await overview();
    expect(["current", "mismatch", "unknown"]).toContain(info.database.migrations.status);
    if (info.database.migrations.status === "current") {
      expect(info.database.migrations.applied).toBeGreaterThan(0);
      expect(info.database.migrations.latest).toBeTruthy();
    }
  });

  /**
   * The two subsystems this application genuinely does not have. They must say
   * so rather than render as empty — an empty log viewer is indistinguishable
   * from a quiet system.
   */
  test("reports logs and updates as absent with a reason", async () => {
    const info = await overview();
    for (const key of ["logs", "updates"] as const) {
      expect(info[key].available, key).toBe(false);
      expect(info[key].reason.length, key).toBeGreaterThan(30);
    }
  });

  /**
   * The privacy line. Everything in the security card is an aggregate; a
   * session's IP, device and working hours live behind `user.readSessions`,
   * and the System overview must not be a way around that permission.
   */
  test("aggregates security without naming anybody", async () => {
    const response = await api.get(`${API}/dashboard/system/overview`);
    const info = ((await response.json()) as { data: Overview }).data;

    /*
      Every field in the security card is a number.

      That is the assertion rather than "no e-mail address appears anywhere in
      the payload", which is what this test checked first and which failed —
      correctly — on `mail.from`. The configured *sender* is not a person: it
      is the same value the Einstellungen → E-Mail screen shows, and refusing
      it here would have been the test dictating a worse page.

      The line that matters is narrower and stronger: a session's IP, device
      and working hours live behind `user.readSessions` (P2-9), and a card
      made only of counts cannot disclose any of them however it is read.
    */
    const values = Object.values(info.security as Record<string, unknown>);
    expect(values.length).toBeGreaterThan(4);
    for (const [key, value] of Object.entries(info.security as Record<string, unknown>)) {
      expect(typeof value === "number" || value === null, `security.${key} ist keine Zahl`).toBe(true);
    }
  });

  test("renders the real cards in the browser", async ({ page }) => {
    await page.goto("/admin.html#/system");
    await expect(page.getByRole("heading", { name: /Systemzustand/i })).toBeVisible();
    // The subsystem cards, by a label the server sent.
    await expect(page.getByText("Hintergrundaufgaben").first()).toBeVisible();
    await expect(page.getByText("Datenbank").first()).toBeVisible();
    // `.first()`: a `Card`'s title renders as a heading and again as the
    // region's accessible name, so a bare text query is two elements and
    // Playwright's strict mode refuses it — correctly.
    await expect(page.getByText("Diese Installation").first()).toBeVisible();
  });

  test("moves between sections by URL", async ({ page }) => {
    // Through the System workspace's navigation in the rail (P1B) — the page's
    // own three-tab strip was folded into it.
    const rail = page.getByRole("navigation", { name: "Hauptnavigation" });
    await page.goto("/admin.html#/system");
    await rail.getByRole("link", { name: "Hintergrundaufgaben" }).click();
    await expect(page).toHaveURL(/#\/system\/aufgaben/);
    await expect(rail.getByRole("link", { name: "Diagnose" })).toBeVisible();
  });

  /**
   * A URL somebody will type — the brief's own list of areas has a Database
   * entry — and the answer is the overview, where the database card is. A 404
   * would be correct and unhelpful.
   */
  test("falls back to the overview for an unknown section", async ({ page }) => {
    await page.goto("/admin.html#/system/datenbank");
    await expect(page.getByText("Diese Installation").first()).toBeVisible();
  });

  /**
   * Every link a subsystem card offers resolves to a route that exists.
   *
   * The jobs card pointed at `#/aufgabenverwaltung` on its first run — a
   * route the table does not serve — and nothing but this caught it. A dead
   * link on an operations page is worst exactly when somebody is following it
   * in a hurry.
   */
  test("offers no link to a route that does not exist", async ({ page }) => {
    const info = await overview();
    const links = info.health.subjects
      .map((s) => (s as { link?: string | null }).link)
      .filter((l): l is string => Boolean(l));
    expect(links.length).toBeGreaterThan(4);

    for (const link of [...new Set(links)]) {
      await page.goto(`/admin.html${link}`);
      await expect(
        page.getByText(/Seite nicht gefunden|nicht gefunden/i),
        `${link} führt auf die Not-Found-Seite`,
      ).toHaveCount(0);
    }
  });
});

/* ================================================================== */
/* Jobs                                                                */
/* ================================================================== */

test.describe("job operations", () => {
  test("lists jobs with a phase and capabilities on every row", async () => {
    const response = await api.get(`${API}/jobs?perPage=25`);
    expect(response.status()).toBe(200);
    const page = ((await response.json()) as { data: { items: JobRow[]; total: number } }).data;

    for (const job of page.items) {
      expect(["QUEUED", "RETRYING", "RUNNING", "DONE", "DEAD", "CANCELLED"]).toContain(job.phase);
      expect(job.capabilities).toBeTruthy();
      // Never both: the statuses they depend on are disjoint.
      expect(job.capabilities.retryable && job.capabilities.cancellable).toBe(false);
      // A refusal always carries its reason, so the disabled button can say why.
      if (!job.capabilities.retryable) expect(job.capabilities.retryRefusal).toBeTruthy();
    }
  });

  /**
   * The list must not carry payloads: one per row, of unbounded size, is the
   * N+1's quieter cousin — one query carrying far too much.
   */
  test("leaves the payload out of the list and includes it in the detail", async () => {
    const list = await api.get(`${API}/jobs?perPage=5`);
    const items = ((await list.json()) as { data: { items: JobRow[] } }).data.items;
    test.skip(items.length === 0, "Keine Aufgaben in der Warteschlange — nichts zu prüfen.");

    expect(items[0]).not.toHaveProperty("payload");

    const detail = await api.get(`${API}/jobs/${items[0].id}`);
    expect(detail.status()).toBe(200);
    const job = ((await detail.json()) as { data: Record<string, unknown> }).data;
    expect(job).toHaveProperty("payload");
  });

  /**
   * The denylist runs over a real row rather than a fixture. A `Job.payload`
   * is arbitrary JSON written by whoever enqueued the job, and it is the one
   * field on the detail dialog that could carry a credential.
   */
  test("never returns a secret in a payload", async () => {
    const list = await api.get(`${API}/jobs?perPage=50`);
    const items = ((await list.json()) as { data: { items: JobRow[] } }).data.items;
    test.skip(items.length === 0, "Keine Aufgaben vorhanden.");

    for (const row of items.slice(0, 10)) {
      const detail = await api.get(`${API}/jobs/${row.id}`);
      const text = await detail.text();
      expect(text, `${row.name} payload`).not.toMatch(/"(password|smtpPassword|secret|reauthToken)"\s*:\s*"(?!«)/i);
      expect(text).not.toMatch(/postgresql:\/\/[^<"]/);
    }
  });

  test("reports the counts the overview card renders", async () => {
    const response = await api.get(`${API}/jobs/stats`);
    expect(response.status()).toBe(200);
    const stats = ((await response.json()) as { data: JobStats }).data;
    for (const key of ["queued", "running", "dead", "done24h"] as const) {
      expect(typeof stats[key], key).toBe("number");
    }
    expect(stats.names.length).toBeGreaterThan(10);
  });

  test("refuses a filter value the catalogue does not have", async () => {
    // A `where` clause on attacker-chosen text is what `@IsIn(JOB_NAMES)`
    // exists to prevent.
    const response = await api.get(`${API}/jobs?name=not.a.real.job`);
    expect(response.status()).toBe(400);
  });

  test("answers 404 for a job that does not exist", async () => {
    expect((await api.get(`${API}/jobs/cmzzzznotarealid0000`)).status()).toBe(404);
    expect(
      (await api.post(`${API}/jobs/cmzzzznotarealid0000/retry`, { data: {} })).status(),
    ).toBe(404);
  });

  /**
   * The most important assertion about jobs.
   *
   * A restore replaces a database, so "it died half way" does not mean
   * "nothing happened". A retry button beside a failed restore would be a way
   * to apply a second restore over whatever state the first one left —
   * without the confirmation and the re-authentication a deliberate restore
   * requires.
   */
  test("never marks a restore job retryable", async () => {
    const response = await api.get(`${API}/jobs?perPage=200`);
    const items = ((await response.json()) as { data: { items: JobRow[] } }).data.items;
    for (const job of items.filter((j) => j.name === "backup.restore")) {
      expect(job.capabilities.retryable, `${job.id} in ${job.status}`).toBe(false);
      expect(job.capabilities.retryRefusal).toMatch(/Produktivdaten/);
    }
  });

  test("renders the job table in the browser", async ({ page }) => {
    await page.goto("/admin.html#/system/aufgaben");
    await expect(page.getByRole("heading", { name: /Hintergrundaufgaben/i })).toBeVisible();
    await expect(page.getByLabel("Zustand")).toBeVisible();
    await expect(page.getByRole("button", { name: "Nur aufgegebene" })).toBeVisible();
  });
});

/* ================================================================== */
/* Diagnostics                                                         */
/* ================================================================== */

test.describe("diagnostics", () => {
  /**
   * **One run, shared by every assertion below**, and the reason is a bug this
   * file had before it was written down.
   *
   * `POST /diagnostics` is throttled at three a minute — it opens an SMTP
   * connection, and a page with a button on it must not be a way to knock on
   * somebody else's mail server as fast as a browser can repeat a request.
   * Three tests each running their own would sit exactly on that limit and
   * the third would meet a 429, which surfaces as *"die Diagnose ist
   * fehlgeschlagen"* over a diagnostics endpoint that is working perfectly.
   * That is the sign-in-budget mistake CLAUDE.md records four times over,
   * arriving through a fifth route.
   *
   * So the run happens once and the raw body is kept, because one assertion
   * is about the text rather than the parsed object.
   */
  let run: DiagnosticsRun;
  let raw: string;

  test.beforeAll(async () => {
    const response = await api.post(`${API}/diagnostics`, { data: {} });
    raw = await response.text();
    expect(response.status(), raw).toBe(201);
    run = (JSON.parse(raw) as { data: DiagnosticsRun }).data;
  });

  test("runs every check and gives each one a result and a sentence", async () => {
    expect(["PASS", "WARNING", "FAIL", "NOT_CONFIGURED"]).toContain(run.result);
    expect(run.checks.length).toBeGreaterThanOrEqual(8);

    const keys = run.checks.map((c) => c.key);
    for (const expected of ["database", "migrations", "redis", "storage", "job-worker", "mail"]) {
      expect(keys, `${expected} fehlt`).toContain(expected);
    }

    for (const check of run.checks) {
      expect(["PASS", "WARNING", "FAIL", "NOT_CONFIGURED"], check.key).toContain(check.result);
      // Always a sentence, including for a pass: "Bestanden" alone does not
      // say what was checked, and the reader who needs this page is the one
      // who does not already know.
      expect(check.detail.length, check.key).toBeGreaterThan(10);
      expect(check.durationMs, check.key).toBeGreaterThanOrEqual(0);
    }
  });

  test("passes the database and the schema on a working installation", async () => {
    const db = run.checks.find((c) => c.key === "database");
    const schema = run.checks.find((c) => c.key === "migrations");
    expect(db?.result, db?.detail).toBe("PASS");
    expect(schema?.result, schema?.detail).toBe("PASS");
  });

  /**
   * Nothing a diagnostics run reports may carry a raw transport error — a
   * Postgres failure echoes the connection string it attempted, password
   * included, and libpq is not shy about it.
   */
  test("never returns a connection string or a credential", async () => {
    expect(raw).not.toMatch(/postgresql:\/\/[^<"]/);
    expect(raw).not.toMatch(/PGPASSWORD/);
    expect(raw).not.toMatch(/password=/i);
  });

  /**
   * The storage probe proved writability, and said so without naming a path.
   *
   * **What this cannot assert** is that the probe file was deleted. It is
   * written with a random dot-prefixed name into the backup volume and
   * removed in a `finally`; nothing reachable over HTTP lists that directory,
   * so the cleanup is guaranteed by the code rather than by this test. The
   * limitation is written down rather than papered over with an assertion
   * that would pass whatever happened.
   *
   * What *is* checked is the part a disclosure would show up in: a filesystem
   * error names the path it failed on, and that path is the server's private
   * directory layout.
   */
  test("reports storage without disclosing a server path", async () => {
    const storage = run.checks.find((c) => c.key === "storage");
    expect(storage, "die Speicherprüfung fehlt").toBeTruthy();
    expect(storage!.detail.length).toBeGreaterThan(10);
    expect(storage!.detail).not.toMatch(/[A-Za-z]:\\/);
    expect(storage!.detail).not.toMatch(/\/var\/|\/home\/|\/Users\//);
  });

  test("shows the empty state before anybody presses the button", async ({ page }) => {
    await page.goto("/admin.html#/system/diagnose");
    await expect(page.getByRole("button", { name: /Diagnose ausführen/i })).toBeVisible();
    await expect(page.getByText(/Noch nicht ausgeführt/i)).toBeVisible();
  });
});

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

async function overview(): Promise<Overview> {
  const response = await api.get(`${API}/dashboard/system/overview`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: Overview }).data;
}

type Overview = {
  health: {
    state: string;
    reasons: string[];
    subjects: { key: string; label: string; state: string; reasons: string[]; link: string | null }[];
  };
  build: { version: string | null; commit: string | null; environment: string; source: string; reason: string | null };
  database: { migrations: { status: string; applied: number; latest: string | null } };
  security: { activeUsers: number; privilegedWithoutMfa: number };
  logs: { available: boolean; reason: string };
  updates: { available: boolean; reason: string };
};

type JobRow = {
  id: string;
  name: string;
  status: string;
  phase: string;
  capabilities: { retryable: boolean; cancellable: boolean; retryRefusal: string | null };
};

type JobStats = {
  queued: number;
  running: number;
  dead: number;
  done24h: number;
  names: string[];
};

type DiagnosticsRun = {
  result: string;
  durationMs: number;
  checks: { key: string; label: string; result: string; durationMs: number; detail: string }[];
};
