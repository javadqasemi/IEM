import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, setAccessToken } from "@/core/api";
import { applicationRepository } from "../repository";

/**
 * The repository against a stubbed client.
 *
 * What is being checked is the one thing this layer decides: **which URL and
 * which method answer which question**, and that empty parameters do not reach
 * the query string. Nothing here asserts on the shape of the response — that
 * is the mapper's test, and the separation is the point of having two files.
 *
 * `environment: "node"`, so `window` is stubbed rather than provided. The
 * client reads `window.location.origin` to resolve a relative base, which is
 * the whole of its dependency on a DOM.
 */

type Call = { url: string; init: RequestInit | undefined };

let calls: Call[] = [];

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify({ data: body }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeAll(() => {
  (globalThis as { window?: unknown }).window = { location: { origin: "http://localhost:5173" } };
});

beforeEach(() => {
  calls = [];
  setAccessToken("test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(respond({ items: [], total: 0, page: 1, perPage: 50, pages: 0 }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

const lastUrl = () => new URL(calls.at(-1)!.url);

describe("list", () => {
  it("asks /applications", async () => {
    await applicationRepository.list({});
    expect(lastUrl().pathname).toBe("/api/v1/applications");
  });

  it("passes search, status and paging through", async () => {
    await applicationRepository.list({ search: "meier", status: "NEW", page: 2, perPage: 50 });
    const url = lastUrl();
    expect(url.searchParams.get("search")).toBe("meier");
    expect(url.searchParams.get("status")).toBe("NEW");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("perPage")).toBe("50");
  });

  /**
   * An empty string is not a filter.
   *
   * The list screen holds `""` for "no status chip selected", and sending
   * `status=` made the server's `@IsIn` validator reject the whole request —
   * which a list screen reports as an error rather than as no results.
   */
  it("leaves an empty search or status out of the query string", async () => {
    await applicationRepository.list({ search: "", status: "" });
    const url = lastUrl();
    expect(url.searchParams.has("search")).toBe(false);
    expect(url.searchParams.has("status")).toBe(false);
  });
});

describe("get, update, remove", () => {
  it("reads one by id", async () => {
    await applicationRepository.get("app_1");
    expect(lastUrl().pathname).toBe("/api/v1/applications/app_1");
    expect(calls.at(-1)!.init?.method).toBe("GET");
  });

  it("PATCHes an update and sends JSON", async () => {
    await applicationRepository.update("app_1", { status: "HIRED", note: "ok" });
    expect(calls.at(-1)!.init?.method).toBe("PATCH");
    expect(calls.at(-1)!.init?.body).toBe(JSON.stringify({ status: "HIRED", note: "ok" }));
  });

  it("DELETEs", async () => {
    await applicationRepository.remove("app_1");
    expect(calls.at(-1)!.init?.method).toBe("DELETE");
  });

  it("reads the stats from their own route", async () => {
    await applicationRepository.stats();
    expect(lastUrl().pathname).toBe("/api/v1/applications/stats");
  });
});

describe("the transport it inherits", () => {
  it("carries the access token as a bearer header", async () => {
    // The dossier download and the audit export were `<a href>` links on the
    // belief a cookie would authenticate them. There is no such cookie, and
    // both returned 401 until every call went through this path.
    await applicationRepository.get("app_1");
    const headers = calls.at(-1)!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-token");
  });

  it("turns a failure into an ApiError carrying the server's own message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              statusCode: 403,
              code: "forbidden",
              message: "Fehlende Berechtigung: application.read",
            }),
            { status: 403, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );

    await expect(applicationRepository.get("app_1")).rejects.toThrow(ApiError);
    await expect(applicationRepository.get("app_1")).rejects.toThrow(
      "Fehlende Berechtigung: application.read",
    );
  });
});
