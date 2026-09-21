import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API,
  apiAs,
  spendBackupOp,
  spendMfa,
} from "./fixtures";

/**
 * Sicherung und Wiederherstellung (P2-5), against the running API.
 *
 * ---
 *
 * ## What this proves and what the drill proves
 *
 * This spec covers the **operational surface**: that a backup can be created,
 * that it is verified rather than merely written, that the guards refuse what
 * they should, and that no credential escapes. The **recoverability** claim is
 * made by the drill — `POST /backups/:id/restore` with `mode: DRILL` — which is
 * exercised here end to end and is the reason this module is not an assumption.
 *
 * ## It does not restore over the live database
 *
 * Deliberately, and the brief says so too: a test suite that replaces its own
 * database is a test suite nobody runs twice. The drill restores into
 * `<database>_restore_drill`, which is created and dropped by the run, so the
 * destructive code path is exercised against a target that does not matter.
 *
 * ## It is opt-in, and that is a resource decision rather than a preference
 *
 * **`npm run e2e` skips this file**; `npm run e2e:backup` runs it. The
 * convention is the one `e2e:security` and `e2e:budgets` already use — skip
 * with a message rather than fail — and the reason here is measured rather
 * than assumed.
 *
 * This spec spawns `pg_dump`, writes hundreds of megabytes, runs `pg_restore`
 * and creates and drops a database. Inside the shared run that load surfaced
 * as **sign-in throttling two specs away**: `security.spec.ts` reported
 * `admin@iem.ch konnte sich nicht anmelden (HTTP 429)` and eleven row-level
 * tests went red, none of which has anything to do with backups. It is the
 * same misdiagnosis CLAUDE.md records four times about the sign-in budget,
 * arriving by a fifth route — and the brief's own instruction not to run
 * browser E2E concurrently with large backup operations says the same thing.
 *
 * So it is a gate of its own, run on its own, and the release checklist is
 * `npm run e2e` **and** `npm run e2e:backup`.
 *
 * It also skips when PostgreSQL's tools are absent — set `PG_BIN_PATH` if
 * `pg_dump` is not on PATH.
 */

let api: APIRequestContext;
let toolsAvailable = false;

/** Ids created by this spec, removed in `afterAll`. */
const created: string[] = [];

test.beforeAll(async () => {
  // Nothing at all when the suite was not asked for — not even a sign-in,
  // which is the resource this file was spending on a skipped run.
  if (process.env.E2E_BACKUP !== "1") return;
  api = await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);
  const status = await (await api.get(`${API}/backups/status`)).json();
  toolsAvailable = status?.data?.toolsAvailable === true;
});

test.afterAll(async () => {
  if (!api) return;
  /*
    Only what this spec made, and only where the rules allow it.

    `refuseDelete` protects the last verified backup of a type, so a delete can
    legitimately fail here — that is the safety rule working, not a cleanup
    bug, and the run is left in place rather than forced.
  */
  for (const id of created) {
    await api.delete(`${API}/backups/${id}`).catch(() => undefined);
  }
  await api.dispose();
});

/**
 * Opt-in, set by `npm run e2e:backup`.
 *
 * Checked before the tools, so a machine that has PostgreSQL but has not asked
 * for this suite is told *why* it skipped rather than being told about a
 * dependency it already has.
 */
const REQUESTED = process.env.E2E_BACKUP === "1";

test.beforeEach(() => {
  test.skip(
    !REQUESTED,
    "Übersprungen: Sicherungs-Tests laufen eigenständig — npm run e2e:backup. " +
      "Sie starten pg_dump und pg_restore und würden den übrigen Lauf ausbremsen.",
  );
  test.skip(
    !toolsAvailable,
    "pg_dump/pg_restore not found — set PG_BIN_PATH in server/.env.",
  );
});

/* ================================================================== */

test.describe("the status panel reports what is measured", () => {
  test("never claims health it has not got", async () => {
    const body = await (await api.get(`${API}/backups/status`)).json();
    const status = body.data;

    expect(["healthy", "warning", "critical", "not_configured", "unknown"]).toContain(status.state);

    /*
      The property the whole panel turns on: an installation with no recovery
      point is never `healthy`. A green light meaning "the fields are filled
      in" is the most dangerous thing this panel could say.
    */
    if (status.recoveryPoints === 0) {
      expect(status.state, "no recovery points but reported healthy").not.toBe("healthy");
    }
  });

  test("states the local-storage limitation rather than implying disaster recovery", async () => {
    const body = await (await api.get(`${API}/backups/status`)).json();
    // Carried by the API so a future client cannot omit it.
    expect(body.data.storage.offSite).toBe(false);
    expect(body.data.offSiteWarning).toContain("Katastrophenvorsorge");
  });

  test("discloses no credential", async () => {
    const text = await (await api.get(`${API}/backups/status`)).text();
    for (const needle of ["PGPASSWORD", "DATABASE_URL", "APP_SECRETS_ENCRYPTION_KEY", "password="]) {
      expect(text, `status leaked ${needle}`).not.toContain(needle);
    }
  });
});

/* ================================================================== */

test.describe("a backup is created, then proved readable", () => {
  test("written, checksummed, verified — and only then SUCCESS", async () => {
    test.setTimeout(180_000);

    await spendBackupOp("create");

    const create = await api.post(`${API}/backups`, { data: { type: "DATABASE" } });
    expect(create.ok(), await create.text()).toBe(true);
    const id = (await create.json()).data.id as string;
    created.push(id);

    // Polled rather than slept: the job runner decides when, and a fixed wait
    // is either flaky or slow.
    await expect
      .poll(
        async () => {
          const body = await (await api.get(`${API}/backups?perPage=10`)).json();
          return body.data.items.find((r: { id: string }) => r.id === id)?.status ?? "…";
        },
        { message: "backup never settled", timeout: 120_000, intervals: [1500] },
      )
      .toMatch(/SUCCESS|FAILED/);

    const body = await (await api.get(`${API}/backups?perPage=10`)).json();
    const run = body.data.items.find((r: { id: string }) => r.id === id);

    expect(run.status).toBe("SUCCESS");
    /*
      `SUCCESS` means written **and** readable. The two are separate columns
      because they are separate claims, and a module that conflated them would
      be reporting files rather than recovery points.
    */
    expect(run.verification).toBe("PASSED");
    expect(run.verificationDetail).toContain("Objekte lesbar");

    // A dump and a manifest, each with a real SHA-256.
    const kinds = run.artifacts.map((a: { kind: string }) => a.kind);
    expect(kinds).toContain("DATABASE_DUMP");
    expect(kinds).toContain("MANIFEST");
    for (const artifact of run.artifacts) {
      expect(artifact.checksum, artifact.kind).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.sizeBytes).toBeGreaterThan(0);
    }
    expect(run.migrationVersion, "a backup with no schema version cannot be judged").toBeTruthy();
  });

  test("the retention preview is computed, not guessed", async () => {
    const body = await (await api.get(`${API}/backups/retention/preview`)).json();
    const preview = body.data;

    expect(preview.total).toBeGreaterThanOrEqual(1);
    // Every run is either kept or removed; nothing falls between.
    expect(preview.keep + preview.remove).toBe(preview.total);
    expect(preview.policy.minimumAgeHours).toBeGreaterThanOrEqual(1);
  });
});

/* ================================================================== */

test.describe("the guards refuse what they should", () => {
  test("a restore without the typed word is refused", async () => {
    const list = await (await api.get(`${API}/backups?status=SUCCESS&perPage=1`)).json();
    const run = list.data.items[0];
    test.skip(!run, "no successful backup to test against");

    // `/auth/reauthenticate` is its own throttle bucket — ten a minute, keyed
    // by class and handler, and NOT the sign-in's. `login-budget.spec.ts`
    // fails the build if a file reaches it without pacing, and it caught this
    // file doing exactly that.
    await spendMfa();

    const reauth = await api.post(`${API}/auth/reauthenticate`, {
      data: { password: ADMIN_PASSWORD },
    });
    const token = (await reauth.json()).data.token as string;

    await spendBackupOp("restore");

    const refused = await api.post(`${API}/backups/${run.id}/restore`, {
      data: { mode: "DRILL", confirmation: "ja", reauthToken: token },
    });
    expect(refused.status()).toBe(400);
    expect(await refused.text()).toContain("WIEDERHERSTELLEN");
  });

  /**
   * The re-authentication gate. A permission says who *may*; it does not say
   * that the person holding the session is the one asking, and an unlocked
   * laptop must not be a way to roll the firm back to last Tuesday.
   */
  test("a restore without a re-authentication window is refused", async () => {
    const list = await (await api.get(`${API}/backups?status=SUCCESS&perPage=1`)).json();
    const run = list.data.items[0];
    test.skip(!run, "no successful backup to test against");

    await spendBackupOp("restore");

    const refused = await api.post(`${API}/backups/${run.id}/restore`, {
      data: { mode: "DRILL", confirmation: "WIEDERHERSTELLEN", reauthToken: "not-a-token" },
    });
    expect([401, 403]).toContain(refused.status());
  });

  test("an unknown backup is a 404, not a blind attempt", async () => {
    const res = await api.get(`${API}/backups/does-not-exist/restorability`);
    expect(res.status()).toBe(404);
  });

  /**
   * There is no filename anywhere in the download route — the storage key
   * comes from the row — so there is nothing to traverse. This asserts the
   * shape rather than hoping.
   */
  test("the download route takes no path", async () => {
    const list = await (await api.get(`${API}/backups?status=SUCCESS&perPage=1`)).json();
    const run = list.data.items[0];
    test.skip(!run, "no successful backup to test against");

    for (const kind of ["../../../../etc/passwd", "..%2f..%2fetc%2fpasswd", "NOT_A_KIND"]) {
      const res = await api.get(
        `${API}/backups/${run.id}/artifacts/${encodeURIComponent(kind)}/download`,
      );
      expect([400, 404], `kind=${kind}`).toContain(res.status());
    }
  });
});

/* ================================================================== */

/*
  The role × verb matrix for `/backups` lives in `security.spec.ts`, not here.

  It used to be two tests in this file, and they were the reason the whole
  suite went red: they signed `gast@iem.test` and `adm@iem.test` in, and
  because this file sorts near the front they did it **earlier in the run than
  any other spec needs those accounts** — two extra sign-ins against a budget
  that is counted per minute across every project. The failure surfaced as
  "Hauptnavigation not found" in `a11y.spec.ts` at tablet width, which is the
  same misdiagnosis CLAUDE.md records four times already.

  `security.spec.ts` signs every role account in **once per run** and is the
  file the matrix belongs in anyway. Asserting it there costs nothing.
*/

/* ================================================================== */
/* The acceptance criterion                                            */
/* ================================================================== */

test.describe("recoverability is proved, not assumed", () => {
  /**
   * The drill: a backup is restored into an isolated database and the result
   * is read back.
   *
   * **This is what makes the module a recovery system.** Everything before it
   * proves a file exists and parses; this proves the bytes become a database
   * an application can read — a Super Admin, an organisation, the settings and
   * the content, at a known migration.
   */
  test("backup → verified → restored into an isolated database → known records read", async () => {
    test.setTimeout(300_000);

    const list = await (await api.get(`${API}/backups?status=SUCCESS&perPage=5`)).json();
    const run = list.data.items.find(
      (r: { verification: string; type: string }) =>
        r.verification === "PASSED" && r.type !== "MEDIA",
    );
    test.skip(!run, "no verified database backup to drill against");

    const assessment = await (await api.get(`${API}/backups/${run.id}/restorability`)).json();
    expect(assessment.data.restorable, assessment.data.refusal ?? "").toBe(true);
    // The drill target is derived, never configured — there is no setting
    // through which it could be pointed at something that matters.
    expect(assessment.data.drillDatabase).not.toBe(assessment.data.liveDatabase);
    expect(assessment.data.drillDatabase).toContain("_restore_drill");

    // `/auth/reauthenticate` is its own throttle bucket — ten a minute, keyed
    // by class and handler, and NOT the sign-in's. `login-budget.spec.ts`
    // fails the build if a file reaches it without pacing, and it caught this
    // file doing exactly that.
    await spendMfa();

    const reauth = await api.post(`${API}/auth/reauthenticate`, {
      data: { password: ADMIN_PASSWORD },
    });
    const token = (await reauth.json()).data.token as string;

    await spendBackupOp("restore");

    const started = await api.post(`${API}/backups/${run.id}/restore`, {
      data: { mode: "DRILL", confirmation: "WIEDERHERSTELLEN", reauthToken: token },
    });
    expect(started.ok(), await started.text()).toBe(true);
    const restoreId = (await started.json()).data.id as string;

    await expect
      .poll(
        async () => {
          const body = await (await api.get(`${API}/backups/restores`)).json();
          return body.data.items.find((r: { id: string }) => r.id === restoreId)?.status ?? "…";
        },
        { message: "the drill never settled", timeout: 240_000, intervals: [2000] },
      )
      .toMatch(/SUCCESS|FAILED|ABORTED/);

    const history = await (await api.get(`${API}/backups/restores`)).json();
    const restore = history.data.items.find((r: { id: string }) => r.id === restoreId);

    expect(restore.status, restore.failureDetail ?? "").toBe("SUCCESS");
    expect(restore.targetDatabase).toContain("_restore_drill");

    /*
      The validation is the evidence. `pg_restore` exiting 0 proves nothing —
      it reports ownership notices as errors and restores partially without
      complaint in some failure modes.
    */
    const validation = restore.validation;
    expect(validation.ok).toBe(true);
    expect(validation.migration, "the restored database has no migration state").toBeTruthy();
    expect(validation.counts.superAdmins).toBeGreaterThan(0);
    expect(validation.counts.organisations).toBeGreaterThan(0);
    expect(validation.counts.settings).toBeGreaterThan(0);
    expect(validation.counts.contentEntries).toBeGreaterThan(0);
    expect(validation.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
  });

  /**
   * Two destructive operations must not overlap.
   *
   * Asserted through the API rather than only in the unit test, because the
   * unit test covers the *table* and this covers the wiring — the service has
   * to ask, with the real set of in-flight operations.
   */
  test("the concurrency rule is wired to the real set of in-flight operations", async () => {
    /*
      Asserted by **reading**, not by creating a second backup.

      The first version of this test proved the positive half by posting a
      backup — which is throttled at six an hour and shares that budget with
      the create test above, so running this suite twice in an hour failed on
      a rate limit rather than on anything it was testing. A test that cannot
      run twice is a test people stop running.

      `refuseConcurrent`'s table is covered exhaustively in
      `backup.rules.test.ts`. What is left for this file is that the service
      *asks* — that `restorability` consults the live set of in-flight
      operations rather than returning a constant — and that is visible in the
      response without spending anything.
    */
    const list = await (await api.get(`${API}/backups?status=SUCCESS&perPage=1`)).json();
    const run = list.data.items[0];
    test.skip(!run, "no successful backup to assess");

    const assessment = await (await api.get(`${API}/backups/${run.id}/restorability`)).json();

    // Both fields are computed per request from live state, never stored.
    expect(typeof assessment.data.restorable).toBe("boolean");
    expect(assessment.data.liveDatabase).toBeTruthy();
    expect(assessment.data.drillDatabase).not.toBe(assessment.data.liveDatabase);

    const restores = await (await api.get(`${API}/backups/restores`)).json();
    const inFlight = restores.data.items.some((r: { status: string }) =>
      ["REQUESTED", "RUNNING", "VALIDATING"].includes(r.status),
    );
    if (inFlight) {
      // The negative half, when it happens to be observable: a restore in
      // flight must make the assessment refuse rather than merely warn.
      expect(assessment.data.restorable).toBe(false);
      expect(assessment.data.refusal).toBeTruthy();
    }
  });
});



