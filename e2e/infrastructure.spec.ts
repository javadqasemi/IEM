import { expect, test } from "./fixtures";

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
    const auth = { authorization: "" };
    const login = await request.post("http://localhost:3100/api/v1/auth/login", {
      data: { email: "admin@iem.ch", password: "Admin#2026IEMAG" },
    });
    auth.authorization = `Bearer ${(await login.json()).data.accessToken}`;

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
