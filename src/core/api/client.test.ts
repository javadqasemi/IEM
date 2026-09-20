import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  refreshSession,
  request,
  setAccessToken,
  setUnauthenticatedHandler,
} from "./client";

/**
 * The 401 path, which is the whole of "why did the dashboard sign me out".
 *
 * Every case here is a failure that reached a user. Four of them are the same
 * mistake from different sides: **a refresh that said nothing about the session
 * was treated as a refresh that refused it**, so a server restart, a laptop
 * changing network, a 502 from a proxy and — found last, and the only one where
 * the server did reply — a 429 from the rate limiter each ended a session that
 * was never in question, and ended it expensively, because the access token is
 * dropped and cannot come back without a password.
 *
 * What this file cannot see is the cross-tab lock: `navigator.locks` does not
 * exist under `environment: "node"`, so `withRefreshLock` takes its documented
 * fallback and runs unlocked. That path is exercised here; the locking itself is
 * `e2e/auth.spec.ts`, which opens two real tabs.
 */

type Call = { url: string; init: RequestInit | undefined };

let calls: Call[] = [];
let handled = 0;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Queues one reply per call, then repeats the last one. */
function replyWith(...replies: (() => Response | Promise<Response>)[]) {
  let index = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;
      return Promise.resolve(reply());
    }),
  );
}

const unauthorised = () => json({ statusCode: 401, code: "unauthorized", message: "Nicht angemeldet." }, 401);
const renewed = () => json({ data: { accessToken: "token-2", expiresIn: 900 } });
const ok = () => json({ data: { fine: true } });
/** What `ThrottlerGuard` sends, before the controller has seen the cookie. */
const throttled = () =>
  json({ statusCode: 429, code: "too_many_requests", message: "ThrottlerException: Too Many Requests" }, 429);

const refreshCalls = () => calls.filter((c) => c.url.includes("/auth/refresh")).length;

beforeAll(() => {
  (globalThis as { window?: unknown }).window = { location: { origin: "http://localhost:5173" } };
});

beforeEach(() => {
  calls = [];
  handled = 0;
  setAccessToken("token-1");
  setUnauthenticatedHandler(() => {
    handled += 1;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setUnauthenticatedHandler(() => {});
});

describe("a 401 that the refresh repairs", () => {
  it("refreshes once, retries once, and returns the payload", async () => {
    replyWith(unauthorised, renewed, ok);

    await expect(request("/projects")).resolves.toEqual({ fine: true });

    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/api/v1/projects",
      "/api/v1/auth/refresh",
      "/api/v1/projects",
    ]);
    expect(handled).toBe(0);
  });

  it("sends the new token on the retry, not the stale one", async () => {
    replyWith(unauthorised, renewed, ok);

    await request("/projects");

    const headers = calls.at(-1)!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token-2");
  });

  /**
   * The retried request carries `retried`, so a second 401 is final.
   *
   * Without it the two calls would refresh each other for ever — and each
   * refresh rotates a token on the server, so an unbounded loop here is also an
   * unbounded write. The assertion is the *count*, not the error.
   */
  it("does not refresh a second time when the retry is refused too", async () => {
    replyWith(unauthorised, renewed, unauthorised);

    await expect(request("/projects")).rejects.toBeInstanceOf(ApiError);
    expect(refreshCalls()).toBe(1);
  });
});

describe("a 401 the server stands by", () => {
  it("ends the session exactly once", async () => {
    replyWith(unauthorised, unauthorised);

    await expect(request("/projects")).rejects.toBeInstanceOf(ApiError);
    expect(handled).toBe(1);
  });
});

describe("a refresh that never got an answer", () => {
  /**
   * The bug this file exists for.
   *
   * `fetch` rejects for a refused connection, a DNS failure, a CORS rejection
   * and an abort. None of those is the server saying anything about the
   * session, and the old code read all of them as a refusal.
   */
  it("does not end the session when the request fails to send", async () => {
    replyWith(unauthorised, () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(request("/projects")).rejects.toBeInstanceOf(ApiError);
    expect(handled).toBe(0);
  });

  it("does not end the session on a 5xx from the refresh route", async () => {
    replyWith(unauthorised, () => json({ statusCode: 502, code: "bad_gateway", message: "" }, 502));

    await expect(request("/projects")).rejects.toBeInstanceOf(ApiError);
    expect(handled).toBe(0);
  });

  it("reports the outcome as offline rather than rejected", async () => {
    replyWith(() => {
      throw new TypeError("Failed to fetch");
    });

    await expect(refreshSession()).resolves.toBe("offline");
  });

  /**
   * The fourth side of the same mistake, found after the other three were
   * fixed — and the only one where the server *answered* and still said
   * nothing about the session.
   *
   * `POST /auth/refresh` is throttled at sixty a minute per IP. `ThrottlerGuard`
   * runs before the controller, so a rate-limited refresh never reaches
   * `AuthService`: the cookie is not examined, nothing is revoked, no audit row
   * is written, and the presented token stays live. A 429 is therefore "ask
   * again in a moment", not "this session is finished" — but it is neither a
   * 5xx nor a thrown `fetch`, so it fell through to `rejected` and signed the
   * user out of a session that was still perfectly good.
   *
   * It is reachable rather than theoretical. The limit is **per IP** and this
   * firm sits behind one office address, so the budget is shared by everybody
   * in the building and every tab spends one when it boots. The e2e suite
   * reaches it reliably: measured against the database it averages 16 refreshes
   * a minute and peaks at 62, and the two minutes that crossed sixty are
   * exactly the two runs that failed — once in `navigation.spec.ts`, once in
   * `project-edit.spec.ts`, both as a screenshot of the login form.
   */
  it("does not end the session when the refresh is rate-limited", async () => {
    replyWith(unauthorised, throttled);

    await expect(request("/projects")).rejects.toBeInstanceOf(ApiError);
    expect(handled).toBe(0);
  });

  it("reports a 429 as offline, because the throttler never read the cookie", async () => {
    replyWith(throttled);

    await expect(refreshSession()).resolves.toBe("offline");
  });
});

describe("several requests failing at once", () => {
  /**
   * Six parallel 401s must produce **one** refresh.
   *
   * Not an optimisation: the server rotates the token on every refresh and
   * treats a rotated token presented again as a stolen one. Six refreshes in
   * flight with the same cookie is precisely the shape that used to revoke every
   * session the account had — inside one tab this promise is what prevents it,
   * and across tabs the lock and the server's grace window do.
   */
  it("shares one refresh between them", async () => {
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/auth/refresh")) return Promise.resolve(renewed());
        // Every resource 401s until the refresh has landed.
        if (first) {
          if (calls.filter((c) => c.url.includes("/auth/refresh")).length === 0) {
            return Promise.resolve(unauthorised());
          }
          first = false;
        }
        return Promise.resolve(ok());
      }),
    );

    await Promise.all([
      request("/a"),
      request("/b"),
      request("/c"),
      request("/d"),
      request("/e"),
      request("/f"),
    ]);

    expect(refreshCalls()).toBe(1);
    expect(handled).toBe(0);
  });
});
