import { expect, settleImages, test } from "./fixtures";

/**
 * Lazy chunks, asset integrity and a first-paint budget.
 *
 * All three are things the unit suite cannot see: it can prove a route is
 * declared `lazy()`, and only a browser can prove the chunk is actually fetched
 * when the route is opened rather than up front.
 */
test.describe("loading", () => {
  test("each screen fetches its own chunk on demand", async ({ page, signIn }) => {
    const chunks = new Set<string>();
    page.on("response", (res) => {
      const url = res.url();
      // Vite serves each lazily-imported page module under its own path in dev.
      const m = /\/src\/admin\/pages\/(\w+)\.tsx/.exec(url);
      if (m) chunks.add(m[1]);
    });

    await signIn();

    // Nothing but the shell and the landing screen yet. The media grid, the
    // audit log and the role editor were all in the entry bundle before the
    // routes were split.
    expect([...chunks], "pages fetched before navigating anywhere").not.toContain("Media");
    expect([...chunks]).not.toContain("People");

    await page.goto("/admin.html#/medien");
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
    expect([...chunks], "Media was not fetched when its route opened").toContain("Media");

    await page.goto("/admin.html#/rollen");
    await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
    expect([...chunks]).toContain("People");
  });

  test("no asset 404s across every screen", async ({ page, signIn, collected }) => {
    // Missing images, fonts and chunks all land in `badResponses`; this walks
    // the whole dashboard once so a broken asset on any screen is caught.
    await signIn();
    for (const path of ["/", "/medien", "/inhalte/team", "/benutzer", "/audit", "/profil"]) {
      await page.goto(`/admin.html#${path}`);
      await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
    }
    expect(collected.badResponses).toEqual([]);
    expect(collected.failedRequests).toEqual([]);
  });

  test("every image request returns an image", async ({ page, signIn }) => {
    /**
     * Asserted from the **network**, not from the DOM.
     *
     * The DOM version of this — settle the lazy images, then look for
     * `naturalWidth === 0` — was flaky in a way that took three attempts to
     * understand: React remounts the media grid between the wait and the read,
     * so the image that satisfied the condition is replaced by a fresh one that
     * has not loaded, and the check reports a broken image the screenshot
     * plainly shows. Polling for the full condition helped at two widths and
     * still failed at the third.
     *
     * The network answers the same question deterministically, and answers the
     * *documented* failure exactly. When `/media` is not mounted or the dev
     * proxy is missing, the request does not fail: Vite answers **200 with
     * `text/html`**, the SPA fallback. That is why a missing mount looked like
     * a failed upload for so long — the status is fine and only the type is
     * wrong. Checking the content type catches it; checking `ok()` would not.
     */
    const offenders: string[] = [];
    page.on("response", (res) => {
      const url = res.url();
      // The *static* media mount and image files — not `/api/v1/media/*`,
      // which is the media library's JSON and correctly is not an image.
      const isStaticMedia = /\/media\/\d{4}\//.test(url) && !/\/api\//.test(url);
      const isImageFile = /\.(png|jpe?g|webp|avif|gif|svg)(\?|$)/i.test(url);
      if (!isStaticMedia && !isImageFile) return;
      const type = res.headers()["content-type"] ?? "(none)";
      if (!res.ok()) offenders.push(`${url} -> ${res.status()}`);
      else if (!/^image\//.test(type)) offenders.push(`${url} -> 200 but ${type}`);
    });

    await signIn();
    for (const path of ["/", "/medien", "/inhalte/team"]) {
      await page.goto(`/admin.html#${path}`);
      await expect(page.getByText("Seite wird geladen …")).toHaveCount(0, { timeout: 20_000 });
      // Still forces the lazy ones to fetch — the point is to make the requests
      // happen, not to inspect the elements afterwards.
      await settleImages(page, 10_000);
    }

    expect(offenders).toEqual([]);
  });

  test("the dashboard is interactive within a reasonable budget", async ({ page, signIn }) => {
    /**
     * A smoke budget, not a benchmark. It runs against a dev server with no
     * minification and an unwarmed module graph, so the number is generous on
     * purpose: it exists to catch an order-of-magnitude regression — a screen
     * that starts fetching its whole dataset before it paints — not to police
     * a hundred milliseconds.
     */
    await signIn();
    const start = Date.now();
    await page.goto("/admin.html#/audit");
    await expect(page.getByRole("heading", { name: /Audit-Log/i })).toBeVisible();
    const elapsed = Date.now() - start;
    expect(elapsed, `audit log took ${elapsed}ms to become visible`).toBeLessThan(15_000);

    const nav = await page.evaluate(() => {
      const [t] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      return t ? { dom: t.domContentLoadedEventEnd, load: t.loadEventEnd } : null;
    });
    if (nav) expect(nav.dom).toBeLessThan(15_000);
  });
});
