import { Injectable, Logger } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface";
import { RedisService } from "./redis";

/**
 * Rate-limit state shared across workers.
 *
 * `ThrottlerModule` defaults to an in-memory store, which means the limit is
 * per **process**: four PM2 workers turn "10 sign-in attempts a minute" into
 * forty, and the number in `app.module.ts` stops describing what the system
 * does. `redis.ts` has said since it was written that shared rate-limit state is
 * one of Redis's two jobs here, and exposed `raw()` "for the throttler storage"
 * — nothing ever used it.
 *
 * This is that user. It is written against the client rather than pulled in as a
 * package because the storage contract is one method and the project's standing
 * preference is to add a dependency only when it earns its weight — the same
 * reasoning that keeps the dashboard's one bar chart out of a charting library.
 *
 * **It degrades to in-memory rather than failing.** With `REDIS_URL` unset, or
 * with Redis unreachable mid-request, `increment` falls through to the local
 * map. A rate limiter that throws turns a Redis blip into a total outage, and a
 * limiter that fails *open* is worse than one that is briefly per-process — so
 * the fallback still counts, just locally.
 */
@Injectable()
export class SharedThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(SharedThrottlerStorage.name);

  /** The fallback store, and the only store when Redis is not configured. */
  private readonly local = new Map<string, { hits: number; expiresAt: number; blockedUntil: number }>();

  /** Logged once, not per request — a Redis outage must not flood the log. */
  private warned = false;

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const name = `iem:throttle:${throttlerName}:${key}`;

    if (this.redis.enabled) {
      try {
        return await this.incrementInRedis(name, ttl, limit, blockDuration);
      } catch (err) {
        if (!this.warned) {
          this.warned = true;
          this.logger.warn(
            `Redis für Ratenbegrenzung nicht erreichbar, lokale Zählung: ${(err as Error).message}`,
          );
        }
      }
    }

    return this.incrementLocally(name, ttl, limit, blockDuration);
  }

  /**
   * `INCR` then `PEXPIRE` only on the first hit, so the window is fixed from the
   * first request rather than sliding forward with every one — which is what the
   * in-memory store does and therefore what the configured numbers mean.
   *
   * The block is a second key. Keeping it separate from the counter is what lets
   * a block outlive the window that caused it: with one key, expiring the
   * counter would also lift the block.
   */
  private async incrementInRedis(
    name: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<ThrottlerStorageRecord> {
    const client = await this.redis.raw();
    if (!client) throw new Error("kein Client");

    const blockKey = `${name}:blocked`;
    const blockedFor = await client.pTTL(blockKey);
    if (blockedFor > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(blockedFor / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockedFor / 1000),
      };
    }

    const hits = await client.incr(name);
    if (hits === 1) await client.pExpire(name, ttl);

    const remaining = await client.pTTL(name);
    // -1 is "no expiry", which can only happen if the PEXPIRE above was lost
    // between the two calls. Setting it again is cheaper than leaking a counter
    // that never resets and silently blocks the caller forever.
    if (remaining < 0) await client.pExpire(name, ttl);
    const timeToExpire = Math.ceil((remaining < 0 ? ttl : remaining) / 1000);

    if (hits > limit) {
      await client.set(blockKey, "1", { PX: blockDuration });
      await client.del(name);
      return {
        totalHits: hits,
        timeToExpire: Math.ceil(blockDuration / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockDuration / 1000),
      };
    }

    return { totalHits: hits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
  }

  private incrementLocally(
    name: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): ThrottlerStorageRecord {
    const now = Date.now();
    const existing = this.local.get(name);

    if (existing && existing.blockedUntil > now) {
      const left = Math.ceil((existing.blockedUntil - now) / 1000);
      return { totalHits: limit + 1, timeToExpire: left, isBlocked: true, timeToBlockExpire: left };
    }

    /**
     * A block that has run out also clears the counter behind it.
     *
     * Without this the entry keeps the hit count that caused the block while its
     * window is still open, so the very next request is over the limit again and
     * re-blocks — a caller that tripped the limit once would stay blocked for as
     * long as it kept trying, which is not what any of these numbers say. The
     * Redis path never had the bug because it `DEL`s the counter when it sets
     * the block; this is the same decision written for the local map.
     */
    if (existing && existing.blockedUntil > 0 && existing.blockedUntil <= now) {
      this.local.delete(name);
    }

    if (!existing || existing.expiresAt <= now || (existing.blockedUntil > 0 && existing.blockedUntil <= now)) {
      this.local.set(name, { hits: 1, expiresAt: now + ttl, blockedUntil: 0 });
      this.sweep(now);
      return {
        totalHits: 1,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

    existing.hits += 1;
    if (existing.hits > limit) {
      existing.blockedUntil = now + blockDuration;
      const left = Math.ceil(blockDuration / 1000);
      return { totalHits: existing.hits, timeToExpire: left, isBlocked: true, timeToBlockExpire: left };
    }

    return {
      totalHits: existing.hits,
      timeToExpire: Math.ceil((existing.expiresAt - now) / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }

  /**
   * Drops expired keys.
   *
   * Without it the map is an unbounded, per-IP-keyed structure on a public
   * endpoint — which is a memory leak an attacker chooses the size of. Swept on
   * write rather than on a timer so it costs nothing when the process is idle,
   * and only when the map is large enough to be worth walking.
   */
  private sweep(now: number): void {
    if (this.local.size < 1024) return;
    for (const [key, value] of this.local) {
      if (value.expiresAt <= now && value.blockedUntil <= now) this.local.delete(key);
    }
  }
}
