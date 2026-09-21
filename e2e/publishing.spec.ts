import type { APIRequestContext } from "@playwright/test";
import { request as newRequest } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API,
  API_ORIGIN,
  apiAs,
  e2eName,
  expect,
  test,
} from "./fixtures";

/**
 * Publishing, end to end, against the live API **and the public site**.
 *
 * ---
 *
 * ## Why this suite exists at all
 *
 * The workflow was the most-tested-in-theory and least-proven-in-practice part
 * of the system. `content.rules.test.ts` asserts all thirty-six transitions in
 * milliseconds and cannot see any of the following, because none of them is
 * arithmetic:
 *
 * | | |
 * | --- | --- |
 * | The guard fires | `@RequirePermissions` is metadata until Nest reads it |
 * | The snapshot is rebuilt | unpublishing is two writes, and the second is the one that matters |
 * | **A visitor sees the change** | the site serves a snapshot, so every other assertion here is about an intermediate |
 *
 * That last row is the whole point. Every test below it could pass with the
 * public document frozen — "published" is a status the dashboard reports about
 * itself, and until something reads the site the way a visitor does, nothing
 * has proved the two are connected.
 *
 * ## The unauthenticated context
 *
 * `visitor` carries no token deliberately. `GET /content/published` is the one
 * `@Public()` route in the CMS, and asserting against it through the
 * administrator's context would prove that an administrator can read the
 * document — which nobody doubted.
 *
 * ## Test-owned data
 *
 * Every entry is created through `e2eName`, so `prisma/e2e-cleanup.ts` matches
 * it on `key` and on `data.name` and the run before this one cannot change what
 * this one measures. The suite also publishes, which touches the *live*
 * document — so it withdraws what it created and republishes before it
 * finishes, and the final state of the site is the state it started in.
 */

let api: APIRequestContext;
let visitor: APIRequestContext;

/** Everything created here, torn down in reverse. */
const created: string[] = [];

type Entry = { id: string; key: string; version: number; status: string };

test.beforeAll(async () => {
  api = await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD);
  // No `extraHTTPHeaders`, no storage state: a visitor.
  visitor = await newRequest.newContext({ baseURL: API_ORIGIN });
});

test.afterAll(async () => {
  for (const id of created.reverse()) {
    await api.delete(`${API}/content/entries/${id}`).catch(() => undefined);
  }
  // One final publish, so the live document does not keep a test entry that
  // the hard delete in `e2e-cleanup.ts` would later remove from the *table*
  // while leaving it in the snapshot.
  if (created.length) {
    await api
      .post(`${API}/content/publish`, { data: { note: "E2E: Aufräumen" } })
      .catch(() => undefined);
  }
  await api?.dispose();
  await visitor?.dispose();
});

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

async function createEntry(label: string): Promise<Entry> {
  const name = e2eName(label);
  const response = await api.post(`${API}/content/entries`, {
    data: { typeKey: "team", data: { name, office: "Thun" } },
  });
  expect(response.ok(), `Eintrag anlegen fehlgeschlagen (HTTP ${response.status()})`).toBe(true);
  const entry = ((await response.json()) as { data: Entry }).data;
  created.push(entry.id);
  return { ...entry, key: name };
}

async function readEntry(id: string): Promise<Entry & { scheduledAt: string | null }> {
  const response = await api.get(`${API}/content/entries/${id}`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: Entry & { scheduledAt: string | null } }).data;
}

/**
 * Edits the entry so its version advances past 1.
 *
 * Needed by both conflict tests, and the reason is a detail worth writing
 * down: a freshly created entry is at version 1, so "one behind" is **0**,
 * which `@Min(1)` on the DTO refuses with a 400 before the lock is ever
 * consulted. That is the validator working correctly and it would make both
 * tests pass for the wrong reason — the same trap the organisation cells in
 * `security.spec.ts` describe, arriving from the other direction.
 *
 * It must run **before** the approval: editing an approved entry knocks it
 * back to `DRAFT`, which is the whole point of that rule.
 */
async function bump(entry: Entry): Promise<void> {
  const response = await api.patch(`${API}/content/entries/${entry.id}`, {
    data: { data: { name: entry.key, office: "Thun", role: "" }, note: "E2E: Version" },
  });
  expect(response.ok(), `bearbeiten fehlgeschlagen (HTTP ${response.status()})`).toBe(true);
  expect((await readEntry(entry.id)).version).toBeGreaterThan(1);
}

/** Draft → in review → approved, which is the only road to PUBLISHED. */
async function approve(id: string): Promise<void> {
  const submitted = await api.post(`${API}/content/entries/${id}/submit`, {
    data: { message: "E2E" },
  });
  expect(submitted.status(), "einreichen").toBe(204);

  const reviews = await api.get(`${API}/content/reviews`);
  const rows = ((await reviews.json()) as { data: { id: string; entry: { id: string } }[] }).data;
  const review = rows.find((r) => r.entry.id === id);
  expect(review, "die eigene Freigabeanfrage muss in der Liste stehen").toBeTruthy();

  const decided = await api.post(`${API}/content/reviews/${review!.id}/decide`, {
    data: { decision: "APPROVED", note: "E2E" },
  });
  expect(decided.status(), "freigeben").toBe(204);
}

async function publish(note: string): Promise<number> {
  const response = await api.post(`${API}/content/publish`, { data: { note } });
  expect(response.ok(), `veröffentlichen fehlgeschlagen (HTTP ${response.status()})`).toBe(true);
  return ((await response.json()) as { data: { version: number } }).data.version;
}

/** The live document, fetched the way a visitor's browser fetches it. */
async function liveDocument(): Promise<{ version: number; content: Record<string, unknown> }> {
  const response = await visitor.get(`${API}/content/published`);
  expect(response.status(), "das öffentliche Dokument ist ohne Anmeldung erreichbar").toBe(200);
  return ((await response.json()) as {
    data: { version: number; content: Record<string, unknown> };
  }).data;
}

function teamNames(content: Record<string, unknown>): string[] {
  const team = (content.team ?? []) as { name?: string }[];
  return team.map((member) => member.name ?? "");
}

/* ================================================================== */
/* The lifecycle, and the public site at the end of it                 */
/* ================================================================== */

test.describe("the publishing lifecycle", () => {
  test("a new entry reaches the public document only after review and publish", async () => {
    const entry = await createEntry("Publishing Lebenszyklus");

    /*
      The first assertion, and the one that would be easy to leave out.

      A draft that already appeared on the site would make every later step
      decorative — so the road has to be shown to be closed before it is shown
      to be open.
    */
    expect(teamNames((await liveDocument()).content)).not.toContain(entry.key);

    // Publishing with nothing approved does not sweep the draft up either.
    await publish("E2E: nichts freigegeben");
    expect(teamNames((await liveDocument()).content)).not.toContain(entry.key);

    await approve(entry.id);
    expect((await readEntry(entry.id)).status).toBe("APPROVED");

    // Still not live: approval and publication are separate acts, which is the
    // single most common misreading of this system.
    expect(teamNames((await liveDocument()).content)).not.toContain(entry.key);

    const version = await publish("E2E: Lebenszyklus");
    const live = await liveDocument();
    expect(live.version).toBe(version);
    expect(teamNames(live.content)).toContain(entry.key);

    expect((await readEntry(entry.id)).status).toBe("PUBLISHED");
  });

  /**
   * The same fact, through the browser rather than through the API.
   *
   * The endpoint above is what the site *calls*; this is what a visitor
   * actually gets. They can come apart — `src/content/store.ts` swaps the
   * document in after first paint, so a fetch that fails leaves the built-in
   * defaults rendering perfectly happily and the page looks fine while showing
   * content from the build.
   */
  test("the public website renders what was published", async ({ page }) => {
    const entry = await createEntry("Publishing Website");
    await approve(entry.id);
    await publish("E2E: Website");

    await page.goto("/");
    // The store fetches after first paint; the name is the signal that it
    // landed, so waiting for the name *is* waiting for the swap.
    await expect(page.getByText(entry.key, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

/* ================================================================== */
/* Unpublish                                                           */
/* ================================================================== */

test.describe("withdrawing an entry", () => {
  test("takes it off the live site and leaves the draft behind", async () => {
    const entry = await createEntry("Publishing Rückzug");
    await approve(entry.id);
    const published = await publish("E2E: Rückzug vorbereiten");
    expect(teamNames((await liveDocument()).content)).toContain(entry.key);

    const current = await readEntry(entry.id);
    const response = await api.post(`${API}/content/entries/${entry.id}/unpublish`, {
      data: { expectedVersion: current.version, note: "E2E: zurückgezogen" },
    });
    expect(response.ok(), `zurückziehen fehlgeschlagen (HTTP ${response.status()})`).toBe(true);

    /*
      The assertion the feature exists for.

      A status change alone would leave the entry reading as withdrawn here and
      **still visible to every visitor**, because the site serves a snapshot.
      That is the obvious implementation and the worst possible version of this
      feature, so the check is against the public document rather than against
      the row.
    */
    const live = await liveDocument();
    expect(live.version).toBeGreaterThan(published);
    expect(teamNames(live.content)).not.toContain(entry.key);

    // The draft survives, and it is back at the beginning of the workflow: it
    // has to go through review again, which is what separates withdrawing from
    // hiding.
    const after = await readEntry(entry.id);
    expect(after.status).toBe("DRAFT");
  });

  test("refuses an entry that was never published", async () => {
    const entry = await createEntry("Publishing Nie live");
    const response = await api.post(`${API}/content/entries/${entry.id}/unpublish`, {
      data: { expectedVersion: entry.version },
    });
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("nicht veröffentlicht");
  });

  /**
   * The optimistic lock, against the running API.
   *
   * `expectedVersion` is required rather than optional on purpose. A
   * withdrawal of something somebody else has just re-approved reads, from
   * outside, like the site losing a page for no reason — and there is no
   * version of that failure a user could report, because from their side
   * nothing went wrong.
   */
  test("refuses a stale expectedVersion with 409", async () => {
    const entry = await createEntry("Publishing Konflikt");
    await bump(entry);
    await approve(entry.id);
    await publish("E2E: Konflikt");

    const current = await readEntry(entry.id);
    const response = await api.post(`${API}/content/entries/${entry.id}/unpublish`, {
      data: { expectedVersion: current.version - 1 },
    });
    expect(response.status()).toBe(409);
  });
});

/* ================================================================== */
/* Scheduling                                                          */
/* ================================================================== */

test.describe("scheduling a publication", () => {
  const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

  test("sets, moves and clears a scheduled time", async () => {
    const entry = await createEntry("Publishing Termin");
    await approve(entry.id);
    const version = (await readEntry(entry.id)).version;

    const set = await api.put(`${API}/content/entries/${entry.id}/schedule`, {
      data: { at: inAnHour(), expectedVersion: version },
    });
    expect(set.ok(), `terminieren fehlgeschlagen (HTTP ${set.status()})`).toBe(true);
    expect((await readEntry(entry.id)).scheduledAt).not.toBeNull();

    // Re-scheduling is one call, not a cancel and a create — two audit rows
    // for one decision reads as indecision six months later.
    const moved = await api.put(`${API}/content/entries/${entry.id}/schedule`, {
      data: { at: new Date(Date.now() + 7_200_000).toISOString(), expectedVersion: version },
    });
    expect(moved.ok()).toBe(true);

    const queue = await api.get(`${API}/content/queue`);
    expect(queue.ok()).toBe(true);
    const items = ((await queue.json()) as { data: { items: { id: string; scheduledAt: string | null }[] } })
      .data.items;
    expect(items.find((row) => row.id === entry.id)?.scheduledAt).toBeTruthy();

    const cleared = await api.delete(`${API}/content/entries/${entry.id}/schedule`);
    expect(cleared.ok()).toBe(true);
    expect((await readEntry(entry.id)).scheduledAt).toBeNull();

    /*
      Deliberately not idempotent.

      The two readings of a quiet second success are "I cancelled it" and "it
      had already fired", and those are very different facts to be wrong about
      at the moment somebody is trying to stop a publication.
    */
    const again = await api.delete(`${API}/content/entries/${entry.id}/schedule`);
    expect(again.status()).toBe(400);
  });

  test("refuses a time inside the cron's own interval", async () => {
    const entry = await createEntry("Publishing Zu früh");
    await approve(entry.id);
    const version = (await readEntry(entry.id)).version;

    const response = await api.put(`${API}/content/entries/${entry.id}/schedule`, {
      data: { at: new Date(Date.now() + 60_000).toISOString(), expectedVersion: version },
    });
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("fünf Minuten");
  });

  /**
   * The approval boundary, which is the whole reason scheduling is gated at
   * all. The cron refuses to publish anything that is not APPROVED, so without
   * this the schedule would simply never fire — a refusal that arrives as
   * silence, hours later.
   */
  test("refuses a draft, and says scheduling does not replace approval", async () => {
    const entry = await createEntry("Publishing Entwurf");
    const response = await api.put(`${API}/content/entries/${entry.id}/schedule`, {
      data: { at: inAnHour(), expectedVersion: entry.version },
    });
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("freigegeben");
  });

  test("refuses a stale expectedVersion with 409", async () => {
    const entry = await createEntry("Publishing Termin-Konflikt");
    await bump(entry);
    await approve(entry.id);
    const version = (await readEntry(entry.id)).version;

    const response = await api.put(`${API}/content/entries/${entry.id}/schedule`, {
      data: { at: inAnHour(), expectedVersion: version - 1 },
    });
    expect(response.status()).toBe(409);
  });
});

/* ================================================================== */
/* The queue, and the row a status filter cannot show                  */
/* ================================================================== */

test.describe("the publishing queue", () => {
  /**
   * The case the publish screen was blind to for a whole release.
   *
   * Deleting an entry marks it deleted and **leaves its status alone**, so it
   * never becomes `APPROVED` and never enters review — while the next publish
   * still removes it from the site. A screen counting approved rows reported
   * "nothing is approved" and disabled its own button while a deleted team
   * member was still live.
   */
  test("reports a deleted-but-live entry as a withdrawal", async () => {
    const entry = await createEntry("Publishing Löschung");
    await approve(entry.id);
    await publish("E2E: Löschung vorbereiten");
    expect(teamNames((await liveDocument()).content)).toContain(entry.key);

    const removed = await api.delete(`${API}/content/entries/${entry.id}`);
    expect(removed.status()).toBe(204);

    const queue = await api.get(`${API}/content/queue`);
    const items = ((await queue.json()) as {
      data: { items: { id: string; effect: string; deleted: boolean }[] };
    }).data.items;
    const row = items.find((r) => r.id === entry.id);
    expect(row, "eine gelöschte, aber noch veröffentlichte Zeile muss in der Warteschlange stehen")
      .toBeTruthy();
    expect(row!.effect).toBe("WITHDRAW");
    expect(row!.deleted).toBe(true);

    // And publishing carries it out.
    await publish("E2E: Löschung ausführen");
    expect(teamNames((await liveDocument()).content)).not.toContain(entry.key);
  });
});

/* ================================================================== */
/* Rollback                                                            */
/* ================================================================== */

test.describe("restoring a published snapshot", () => {
  /**
   * The undo the firm actually reaches for, and the reason it is a *new*
   * version rather than a rewind: the history has to stay a record of what was
   * live when, or it stops being usable as evidence of anything.
   */
  test("puts an earlier document back on the public site as a new version", async () => {
    const entry = await createEntry("Publishing Rollback");
    await approve(entry.id);

    const before = (await liveDocument()).version;
    const withEntry = await publish("E2E: Rollback-Ziel");
    expect(teamNames((await liveDocument()).content)).toContain(entry.key);

    const restored = await api.post(`${API}/content/snapshots/${before}/restore`, {});
    expect(restored.ok(), `wiederherstellen fehlgeschlagen (HTTP ${restored.status()})`).toBe(true);

    const live = await liveDocument();
    expect(live.version).toBeGreaterThan(withEntry);
    expect(teamNames(live.content)).not.toContain(entry.key);
  });
});
