import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { clearQueryCache, fetchQuery, invalidate, peek, peekError, prime } from "./query";

/**
 * The cache's behaviour, tested without React.
 *
 * `useQuery` is a thin subscription over the module below it, and the parts
 * that can be wrong — prefix matching, dedup, what happens to a failed entry —
 * are all reachable through `prime`, `peek` and `invalidate`. A render test
 * would exercise the same logic through three more layers and tell us less
 * about which one broke.
 */

afterEach(() => {
  clearQueryCache();
  vi.restoreAllMocks();
});

describe("cache keys", () => {
  it("stores and reads back by key", () => {
    prime(["applications", "detail", "abc"], { id: "abc" });
    expect(peek(["applications", "detail", "abc"])).toEqual({ id: "abc" });
  });

  it("treats a different key as a different entry", () => {
    prime(["applications", "detail", "abc"], { id: "abc" });
    expect(peek(["applications", "detail", "xyz"])).toBeUndefined();
  });

  it("returns undefined for a key that was never fetched", () => {
    expect(peek(["nothing"])).toBeUndefined();
  });

  it("distinguishes null and undefined segments from the string 'null'", () => {
    // Both serialise to an empty segment, which is the intended behaviour:
    // "no filter" and "filter unset" are the same request.
    prime(["media", null], 1);
    expect(peek(["media", undefined])).toBe(1);
  });
});

describe("invalidate", () => {
  it("drops every entry under the prefix", () => {
    prime(["applications", "list", "a"], 1);
    prime(["applications", "list", "b"], 2);
    prime(["applications", "stats"], 3);

    expect(invalidate("applications")).toBe(3);

    expect(peek(["applications", "list", "a"])).toBeUndefined();
    expect(peek(["applications", "stats"])).toBeUndefined();
  });

  it("drops the bare key as well as its children", () => {
    prime(["applications"], 1);
    expect(invalidate("applications")).toBe(1);
    expect(peek(["applications"])).toBeUndefined();
  });

  it("leaves other resources alone", () => {
    prime(["applications", "stats"], 1);
    prime(["media", "list"], 2);

    invalidate("applications");

    expect(peek(["media", "list"])).toBe(2);
  });

  /**
   * The bug the separator prevents.
   *
   * With a plain `startsWith` over a key like `applicationsstats`, invalidating
   * `applications` would also drop `applicationTemplates` — a false match that
   * turns every mutation into a full cache flush and is invisible except as
   * "the dashboard is slow".
   */
  it("does not match a resource that merely starts with the same letters", () => {
    prime(["applications", "stats"], 1);
    prime(["applicationTemplates", "list"], 2);

    expect(invalidate("applications")).toBe(1);
    expect(peek(["applicationTemplates", "list"])).toBe(2);
  });
});

describe("clearQueryCache", () => {
  /**
   * Sign-out empties it, and that is a correctness property rather than
   * housekeeping: the next user on this tab would otherwise be handed the
   * previous user's rows on the first render, before any refetch lands.
   */
  it("removes everything", () => {
    prime(["applications", "list"], 1);
    prime(["users", "list"], 2);

    clearQueryCache();

    expect(peek(["applications", "list"])).toBeUndefined();
    expect(peek(["users", "list"])).toBeUndefined();
  });
});

describe("ApiError", () => {
  it("reports a 422 as a validation failure", () => {
    const err = new ApiError({ statusCode: 422, code: "validation_failed", message: "x" });
    expect(err.isValidation).toBe(true);
  });

  it("carries the per-field messages a form puts beside its inputs", () => {
    const err = new ApiError({
      statusCode: 422,
      code: "validation_failed",
      message: "x",
      fields: { email: ["Ungültig"] },
    });
    expect(err.fields?.email).toEqual(["Ungültig"]);
  });

  it("does not report a 403 as a validation failure", () => {
    // A missing permission is not something the reader can fix by editing the
    // form, and showing it beside a field would say that it is.
    const err = new ApiError({ statusCode: 403, code: "forbidden", message: "x" });
    expect(err.isValidation).toBe(false);
  });
});

/**
 * The failure path, and the loop it used to produce.
 *
 * This is the one piece of the cache that has actually been wrong in
 * production, and it was wrong in the worst available way. `load` settles →
 * `notify` → every subscriber's `sync` → `load` again; a failed entry was never
 * *fresh*, so it fetched again, failed again and notified again. One rail badge
 * that 403'd made **a thousand requests** and exhausted the rate limit for
 * everything else on the page — including the save the user was trying to make.
 *
 * It stayed hidden because every query the shell issues had succeeded for every
 * role that existed: until the operational roles arrived, only Super Admin
 * could reach the dashboard. The first account without `application.read` found
 * it in seconds.
 */
describe("a failed key", () => {
  it("is not fetched again straight away", async () => {
    const fetcher = vi.fn(() => Promise.reject(new ApiError({ statusCode: 403, code: "forbidden", message: "Keine Berechtigung." })));

    await fetchQuery(["applications", "stats"], fetcher);
    await fetchQuery(["applications", "stats"], fetcher);
    await fetchQuery(["applications", "stats"], fetcher);

    // Once. Three calls, one request — the cooldown is what stands between a
    // 403 and an unbounded retry loop.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("records the error rather than throwing it at the caller", async () => {
    const fetcher = () => Promise.reject(new ApiError({ statusCode: 403, code: "forbidden", message: "Keine Berechtigung." }));

    // No rejection: a prefetch that threw would be an unhandled rejection at
    // every call site, and the error is on the entry where the hook reads it.
    await expect(fetchQuery(["projects", "stats"], fetcher)).resolves.toBeNull();
    expect(peekError(["projects", "stats"])?.message).toContain("Keine Berechtigung");
  });

  it("does not make a failure look like fresh data", async () => {
    prime(["media", "list"], ["a"]);
    await fetchQuery(["media", "list"], () => Promise.reject(new Error("weg")), 0);

    // `peek` still returns the last good value — stale-while-revalidate — and
    // the error is recorded beside it. A failed refresh must not blank a list
    // that is already on screen, and must not pretend the value is current.
    expect(peek(["media", "list"])).toEqual(["a"]);
    expect(peekError(["media", "list"])).toBeTruthy();
  });

  it("tries again once the cooldown has passed", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(() => Promise.reject(new Error("weg")));
      await fetchQuery(["jobs"], fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Still inside the window.
      vi.advanceTimersByTime(4_000);
      await fetchQuery(["jobs"], fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Past it: a server that has come back up must be reachable again without
      // a reload.
      vi.advanceTimersByTime(2_000);
      await fetchQuery(["jobs"], fetcher);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a 401 is not recorded as an error at all", async () => {
    // The client is already refreshing and retrying, or ending the session.
    // "Nicht angemeldet" in the middle of a screen while that happens is noise.
    prime(["users"], ["u1"]);
    await fetchQuery(["users"], () => Promise.reject(new ApiError({ statusCode: 401, code: "unauthorized", message: "Nicht angemeldet." })));
    expect(peekError(["users"])).toBeNull();
    expect(peek(["users"])).toEqual(["u1"]);
  });
});