import { expect, test } from "./fixtures";

/**
 * The two downloads — and they are here because both were broken.
 *
 * The audit CSV export and every application dossier were `<a href>` links to
 * guarded routes, relying on a session cookie that does not exist. They
 * answered 401 and had never worked, and the failure was invisible: a browser
 * shows a failed navigation, not an error the page can catch, so the operator
 * clicked and nothing happened. Both now fetch with the bearer token and save a
 * blob.
 *
 * A unit test covers the filename parsing. Only a browser can say whether a
 * click actually produces a file, which is the assertion that would have caught
 * the original bug.
 */
test.describe("downloads", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("the audit log exports as CSV", async ({ page }) => {
    await page.goto("/admin.html#/audit");
    await expect(page.getByRole("heading", { name: /Audit-Log/i })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      page.getByRole("button", { name: /Als CSV exportieren/i }).click(),
    ]);

    // The server names it; the client falls back only if it does not.
    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString("utf8");

    // Not merely non-empty: it has to be the audit log rather than an error
    // page saved with a .csv name, which is exactly what a 401 would produce.
    expect(csv.length).toBeGreaterThan(100);
    // Semicolons and a leading BOM, both deliberate: Excel on Windows reads a
    // comma-separated file as one column under a German locale, and without the
    // BOM it renders the umlauts as mojibake.
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split(/\r?\n/)[0]).toBe(
      "Zeitpunkt;Benutzer;Aktion;Objekt;Objekt-ID;Ergebnis;IP;Meldung",
    );
    expect(csv).toMatch(/auth\.login|content\.|settings\./);
  });

  test("the export respects the filter that is on screen", async ({ page }) => {
    await page.goto("/admin.html#/audit");
    /**
     * Scoped to `main`, and that is the point of the test as much as the
     * filter is.
     *
     * The rail carries its own "Navigation durchsuchen" box, so an unscoped
     * `searchbox` matcher fills the *menu* search instead — the audit filter
     * stays empty, the export comes back unfiltered, and the failure reads as
     * "the server ignores the filter" when nothing of the sort happened. It
     * cost a wrong diagnosis once already.
     */
    await page
      .locator("main")
      .getByRole("searchbox")
      .first()
      .fill("settings.updated");
    // Debounced at 300ms.
    await page.waitForTimeout(600);

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      page.getByRole("button", { name: /Als CSV exportieren/i }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString("utf8");

    // Every data row is a settings change; a filter that was dropped on the way
    // to the server would bring back sign-ins too.
    const rows = csv.split(/\r?\n/).slice(1).filter(Boolean);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.includes("settings.updated"))).toBe(true);
  });

  test("an application dossier downloads", async ({ page, request }) => {
    /**
     * Submitted through the site's own public endpoint rather than assumed to
     * be in the seed, so the test carries its own fixture and says something
     * about the whole path: the form posts, the file is stored outside the
     * public media root, and the dashboard hands it back through the
     * permission-checked route.
     *
     * A PDF because the service sniffs magic bytes and rejects anything whose
     * declared type it cannot confirm — `%PDF-` is the shortest honest file.
     */
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<<>>\n%%EOF\n");
    const submitted = await request.post("http://localhost:3100/api/v1/applications", {
      multipart: {
        position: "E2E Testdossier",
        vorname: "Test",
        nachname: "Lauf",
        email: "e2e@example.test",
        nachricht: "Automatisch erzeugt vom E2E-Lauf.",
        dateien: { name: "lebenslauf.pdf", mimeType: "application/pdf", buffer: pdf },
      },
    });

    // 429 means the hourly per-IP limit on the public form is doing its job;
    // the run is not broken, it just cannot add another fixture right now.
    test.skip(
      submitted.status() === 429,
      "the public application form is rate-limited — re-run in an hour or check the existing dossiers by hand",
    );
    expect(submitted.ok(), `submitting the dossier returned ${submitted.status()}`).toBe(true);

    await page.goto("/admin.html#/bewerbungen");
    await page.getByText("E2E Testdossier").first().click();

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      page.getByRole("button", { name: /^Herunterladen$/ }).first().click(),
    ]);

    // The applicant's own filename survives `Content-Disposition`.
    expect(download.suggestedFilename()).toBe("lebenslauf.pdf");

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("a dossier is not reachable by guessing a media URL", async ({ request }) => {
    /**
     * The allowlist in `main.ts`. Dossiers live under the same storage root as
     * public media, so the static mount matches a positive shape and refuses
     * everything else — including the two percent-encodings that walked past
     * the prefix test it replaced.
     */
    for (const path of [
      "/media/bewerbungen/2026/whatever.pdf",
      "/media/%62ewerbungen/2026/whatever.pdf",
      "/media/bewerbungen%2f2026%2fwhatever.pdf",
      "/media/../server/.env",
    ]) {
      const res = await request.get(`http://localhost:3100${path}`);
      expect(res.status(), `${path} should not be served`).toBeGreaterThanOrEqual(400);
    }
  });
});
