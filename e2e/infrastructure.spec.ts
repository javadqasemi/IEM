import { ADMIN_EMAIL, ADMIN_PASSWORD, apiToken, expect, test } from "./fixtures";

/**
 * The cross-cutting infrastructure, checked through the real API.
 *
 * Unit tests cover the rules — when a job retries, what an event carries, how
 * the trail is derived. What they cannot cover is the *wiring*: whether the
 * middleware opens a context that survives into the handler, whether the
 * listener is attached, whether the row actually lands. That failure mode is
 * specific and it already happened once here — the context was opened in an
 * interceptor, everything typechecked, every unit test passed, and in a live
 * request the audit row simply never appeared.
 */
test.describe("request context and audit", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("every response carries a correlation id", async ({ request }) => {
    const res = await request.get("http://localhost:3100/api/v1/content/published");
    expect(res.ok()).toBe(true);
    // An operator reading a failure in the network tab needs this to search
    // the audit log with.
    expect(res.headers()["x-correlation-id"]).toMatch(/^[\w-]{8,64}$/);
  });

  test("an inbound correlation id is honoured, a malformed one is replaced", async ({
    request,
  }) => {
    const mine = "e2e-trace-0001";
    const kept = await request.get("http://localhost:3100/api/v1/content/published", {
      headers: { "x-correlation-id": mine },
    });
    expect(kept.headers()["x-correlation-id"]).toBe(mine);

    // A malformed trace header is not a reason to refuse a request.
    const replaced = await request.get("http://localhost:3100/api/v1/content/published", {
      headers: { "x-correlation-id": "no spaces allowed" },
    });
    expect(replaced.ok()).toBe(true);
    expect(replaced.headers()["x-correlation-id"]).not.toBe("no spaces allowed");
  });

  /**
   * The chain the whole of foundation stage F8 exists for.
   *
   * `ApplicationsService.update` contains **no audit call**. It raises
   * `ApplicationStatusChanged`; `AuditListener` writes the row. If the row is
   * here with the right before/after and the request's own correlation id,
   * every link held: middleware, queue, flush, listener, column.
   */
  test("a status change writes an audit row nobody asked it to write", async ({ request }) => {
    /*
      The shared token, not a sign-in of its own.

      This used to `POST /auth/login` with the administrator's credentials
      typed into the file — one more attempt against a limit of ten a minute,
      and a second place the seed password had to be kept in step. `apiToken`
      is memoised per worker, so this now costs **no** attempt at all, and the
      credentials come from the environment like everywhere else.
    */
    const auth = { authorization: `Bearer ${await apiToken(ADMIN_EMAIL, ADMIN_PASSWORD)}` };

    const list = await request.get("http://localhost:3100/api/v1/applications?perPage=1", {
      headers: auth,
    });
    const application = (await list.json()).data.items[0];
    test.skip(!application, "no applications seeded");

    const from = application.status as string;
    const to = from === "NEW" ? "IN_REVIEW" : "NEW";

    const patch = await request.patch(
      `http://localhost:3100/api/v1/applications/${application.id}`,
      { headers: auth, data: { status: to } },
    );
    expect(patch.ok()).toBe(true);
    const correlationId = patch.headers()["x-correlation-id"];

    // The write is dispatched before the response, but `AuditService.record`
    // is fire-and-forget by design — so the row lands a tick later.
    await new Promise((r) => setTimeout(r, 1000));

    const audit = await request.get("http://localhost:3100/api/v1/audit?perPage=10", {
      headers: auth,
    });
    const rows = (await audit.json()).data.items as {
      action: string;
      resourceId: string;
      correlationId: string | null;
      before: { status?: string } | null;
      after: { status?: string } | null;
    }[];

    const row = rows.find(
      (r) => r.action === "application_status.changed" && r.resourceId === application.id,
    );
    expect(row, "no audit row for the status change").toBeTruthy();

    // The before and after come off the event, not off a second read.
    expect(row!.before?.status).toBe(from);
    expect(row!.after?.status).toBe(to);

    // And the row is tied to the request that caused it. This is the part that
    // makes eight rows from one publish into one story.
    expect(row!.correlationId).toBe(correlationId);

    // Put it back, so a re-run starts where it started.
    await request.patch(`http://localhost:3100/api/v1/applications/${application.id}`, {
      headers: auth,
      data: { status: from },
    });
  });
});


/**
 * The list contract, end to end (foundation stage F11).
 *
 * The unit tests cover the parsing and the allowlists. What only a live
 * request shows is that the *client* speaks it: the repository serialises
 * `status` into `filter[status]` and `sort` into `sort=field:dir`, and neither
 * the screen nor the hook knows either spelling exists.
 */
test.describe("the list contract", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  /**
   * The shared token again — see the note in the describe above. It takes no
   * `request` any more because it makes no request: `apiToken` memoises the
   * administrator's sign-in for the whole worker.
   */
  const auth = async () => ({
    authorization: `Bearer ${await apiToken(ADMIN_EMAIL, ADMIN_PASSWORD)}`,
  });

  test("sorts on the server and refuses a field that is not allowed", async ({ request }) => {
    const headers = await auth();

    const asc = await request.get(
      "http://localhost:3100/api/v1/applications?sort=lastName:asc&perPage=25",
      { headers },
    );
    const names = (await asc.json()).data.items.map((r: { lastName: string }) => r.lastName);
    expect(names.length).toBeGreaterThan(1);
    expect([...names]).toEqual([...names].sort((a, b) => a.localeCompare(b, "de-CH")));

    // Refused, not ignored: an ignored sort looks exactly like a column that
    // will not sort, and the reader blames the data.
    const refused = await request.get(
      "http://localhost:3100/api/v1/applications?sort=salary:asc",
      { headers },
    );
    expect(refused.status()).toBe(400);
    expect((await refused.json()).message).toContain("createdAt");
  });

  test("the export contains exactly what the same filter returns", async ({ request }) => {
    const headers = await auth();
    const filter = "filter%5Bstatus%5D=eq:NEW";

    const list = await request.get(
      `http://localhost:3100/api/v1/applications?${filter}&perPage=50`,
      { headers },
    );
    const total = (await list.json()).data.total as number;

    const csv = await request.get(
      `http://localhost:3100/api/v1/applications/export?${filter}`,
      { headers },
    );
    expect(csv.ok()).toBe(true);
    const body = await csv.text();

    // One header row plus one per record. An export that quietly contained
    // more than the filtered view is a document somebody would act on.
    const rows = body.trim().split("\n").length - 1;
    expect(rows).toBe(total);
    expect(body.charCodeAt(0)).toBe(0xfeff);
  });

  test("a saved view survives a reload and is restored by deleting it", async ({ request }) => {
    const headers = await auth();
    const url = "http://localhost:3100/api/v1/list-preferences/application";

    await request.put(url, { headers, data: { hidden: ["files"] } });
    const saved = await request.get(url, { headers });
    expect((await saved.json()).data.hidden).toEqual(["files"]);

    // Restoring deletes the row rather than writing the defaults into it —
    // storing them would freeze them at whatever they were that day.
    const deleted = await request.delete(url, { headers });
    expect(deleted.status()).toBe(204);
    const after = await request.get(url, { headers });
    expect((await after.json()).data).toEqual({});
  });
});

