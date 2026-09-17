import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharedThrottlerStorage } from "./throttler.storage";
import type { RedisService } from "./redis";

/**
 * The in-memory path of the shared rate-limit storage.
 *
 * This is the path a developer machine and a single-worker deployment actually
 * run on, and it is also the fallback when Redis blips — so it carries the
 * whole rate limit in both of the cases most likely to be in production.
 *
 * Redis's own path is not covered here: faking a client would test the fake.
 * It is exercised by running the API with `REDIS_URL` set, and its contract is
 * asserted by the same expectations written below.
 */
function storage(redisEnabled = false): SharedThrottlerStorage {
  const redis = { enabled: redisEnabled, raw: async () => null } as unknown as RedisService;
  return new SharedThrottlerStorage(redis);
}

describe("SharedThrottlerStorage (in-memory path)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("counts hits within the window", async () => {
    const s = storage();
    const a = await s.increment("ip:1", 60_000, 3, 60_000, "default");
    const b = await s.increment("ip:1", 60_000, 3, 60_000, "default");
    expect(a.totalHits).toBe(1);
    expect(b.totalHits).toBe(2);
    expect(b.isBlocked).toBe(false);
  });

  it("keeps separate keys separate", async () => {
    const s = storage();
    await s.increment("ip:1", 60_000, 3, 60_000, "default");
    const other = await s.increment("ip:2", 60_000, 3, 60_000, "default");
    expect(other.totalHits).toBe(1);
  });

  it("keeps separate throttlers separate for the same key", async () => {
    // The named throttler is part of the key, or a route with its own tighter
    // `@Throttle` would share a counter with the global default and trip early.
    const s = storage();
    await s.increment("ip:1", 60_000, 3, 60_000, "default");
    const login = await s.increment("ip:1", 60_000, 3, 60_000, "login");
    expect(login.totalHits).toBe(1);
  });

  it("blocks once the limit is exceeded", async () => {
    const s = storage();
    for (let i = 0; i < 3; i++) await s.increment("ip:1", 60_000, 3, 60_000, "default");
    const over = await s.increment("ip:1", 60_000, 3, 60_000, "default");
    expect(over.isBlocked).toBe(true);
    expect(over.timeToBlockExpire).toBeGreaterThan(0);
  });

  it("stays blocked on subsequent hits while the block lasts", async () => {
    // The failure this catches is a limiter that reports blocked once and then
    // lets the next request through, which is indistinguishable from no limit
    // to anything hitting it in a loop.
    const s = storage();
    for (let i = 0; i < 4; i++) await s.increment("ip:1", 60_000, 3, 60_000, "default");
    const again = await s.increment("ip:1", 60_000, 3, 60_000, "default");
    expect(again.isBlocked).toBe(true);
  });

  it("starts a fresh window once the block has expired", async () => {
    const s = storage();
    // A one-millisecond block, so the expiry is real rather than simulated.
    for (let i = 0; i < 4; i++) await s.increment("ip:1", 60_000, 3, 1, "default");
    await new Promise((r) => setTimeout(r, 20));
    const after = await s.increment("ip:1", 60_000, 3, 1, "default");
    expect(after.isBlocked).toBe(false);
    expect(after.totalHits).toBe(1);
  });

  it("expires the window and counts from one again", async () => {
    const s = storage();
    await s.increment("ip:1", 1, 3, 60_000, "default");
    await new Promise((r) => setTimeout(r, 20));
    const next = await s.increment("ip:1", 1, 3, 60_000, "default");
    expect(next.totalHits).toBe(1);
  });

  it("falls back to counting locally when Redis is enabled but unreachable", async () => {
    // The important half: an unreachable Redis must not fail *open*. A limiter
    // that stops counting is worse than one that counts per process.
    const s = storage(true);
    const first = await s.increment("ip:1", 60_000, 2, 60_000, "default");
    const second = await s.increment("ip:1", 60_000, 2, 60_000, "default");
    const third = await s.increment("ip:1", 60_000, 2, 60_000, "default");
    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(third.isBlocked).toBe(true);
  });

  it("reports a time to expire the caller can put in Retry-After", async () => {
    const s = storage();
    const r = await s.increment("ip:1", 60_000, 3, 60_000, "default");
    expect(r.timeToExpire).toBeGreaterThan(0);
    expect(r.timeToExpire).toBeLessThanOrEqual(60);
  });
});
