import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import { hostname } from "node:os";

/**
 * Redis, and what it is for.
 *
 * Two jobs, both of which exist because the API runs as several PM2 workers in
 * production. Neither is a cache.
 *
 * 1. **A leader lock for the scheduler.** `ScheduledTasks` runs in-process
 *    timers, so without a lock every worker fires every job. Three of the four
 *    are idempotent and would merely do redundant work; scheduled publishing
 *    is **not**, and four workers would produce four snapshots of the site.
 *
 * 2. **Shared rate-limit state**, so the configured limit means what it says
 *    rather than being multiplied by the worker count.
 *
 * **It is optional on purpose.** With `REDIS_URL` unset — a developer machine,
 * a single-worker deployment — `enabled` is false, `withLock` runs the work
 * unconditionally, and the throttler keeps its in-memory store. That is
 * correct for one process and wrong for several, which is why `main.ts` refuses
 * to start a clustered instance without it rather than degrading quietly.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;
  private connecting: Promise<RedisClientType | null> | null = null;

  /** Identifies this worker in lock values, so a held lock names its holder. */
  readonly owner = `${hostname()}:${process.pid}`;

  get enabled(): boolean {
    return Boolean(process.env.REDIS_URL);
  }

  private async connect(): Promise<RedisClientType | null> {
    if (!this.enabled) return null;
    if (this.client?.isOpen) return this.client;

    // One in-flight connection shared by every caller. Without this, four
    // simultaneous `withLock` calls on a cold client open four connections.
    this.connecting ??= (async () => {
      try {
        const client: RedisClientType = createClient({
          url: process.env.REDIS_URL,
          socket: {
            // Give up rather than reconnecting forever: Redis being gone must
            // degrade the scheduler, not wedge the process.
            reconnectStrategy: (retries) => (retries > 5 ? false : Math.min(retries * 200, 2000)),
          },
        });
        // The error handler is not optional — an unhandled 'error' event on a
        // node-redis client is an unhandled exception, which takes the API
        // down because Redis blinked.
        client.on("error", (err) => this.logger.warn(`Redis: ${(err as Error).message}`));
        await client.connect();
        this.client = client;
        return client;
      } catch (err) {
        this.logger.warn(`Redis nicht erreichbar: ${(err as Error).message}`);
        return null;
      } finally {
        this.connecting = null;
      }
    })();

    return this.connecting;
  }

  async onModuleDestroy() {
    if (this.client?.isOpen) await this.client.quit().catch(() => undefined);
  }

  /**
   * Runs `work` on at most one worker.
   *
   * `SET key owner NX PX ttl` — the standard single-instance lock. The TTL is
   * the safety net: a worker killed mid-job releases it by expiry rather than
   * blocking the schedule forever. It therefore has to exceed the longest
   * plausible run of the job, and each caller passes its own.
   *
   * The lock is released only if we still hold it, compared by value. Without
   * that check, a job that overran its TTL would delete the lock a *different*
   * worker had since taken, and both would run.
   *
   * **Without Redis the work simply runs.** That is right for one process and
   * wrong for several — see the note on the class.
   */
  async withLock<T>(key: string, ttlSeconds: number, work: () => Promise<T>): Promise<T | null> {
    const client = await this.connect();
    if (!client) return work();

    const name = `iem:lock:${key}`;
    let acquired = false;
    try {
      acquired =
        (await client.set(name, this.owner, { NX: true, PX: ttlSeconds * 1000 })) === "OK";
    } catch (err) {
      // A Redis failure must not stop the scheduler on a single-worker
      // deployment, and must not let every worker run on a clustered one.
      // Skipping is the safe side of that trade: a missed publish window is
      // recoverable, four duplicate snapshots are not.
      this.logger.warn(`Sperre „${key}“ nicht erreichbar, Lauf übersprungen: ${(err as Error).message}`);
      return null;
    }

    if (!acquired) return null;

    try {
      return await work();
    } finally {
      try {
        const held = await client.get(name);
        if (held === this.owner) await client.del(name);
      } catch {
        // Expiry will clear it.
      }
    }
  }

  /** Raw client, for the throttler storage. Null when Redis is not configured. */
  async raw(): Promise<RedisClientType | null> {
    return this.connect();
  }

  async ping(): Promise<boolean> {
    const client = await this.connect();
    if (!client) return false;
    try {
      return (await client.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}
