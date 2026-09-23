import { describe, expect, it, vi } from "vitest";
import { JobStatus } from "@prisma/client";
import { JOB_NAMES, backoffMs, type JobName } from "./catalogue";
import { JobService, type ClaimedJob } from "./job.service";
import { newContext, runWithContext } from "../context/request-context";

/**
 * The queue's state machine and its claim, against a stubbed Prisma.
 *
 * The parts that can be wrong here are rules, not SQL: when a failure retries
 * and when it gives up, what a second worker sees when it loses a race, and
 * whether a job inherits the correlation id of the request that queued it.
 * Driving them through a real database would test Postgres.
 */

type Row = Record<string, unknown>;

/** Just enough Prisma for `JobService`. Each method records what it was asked. */
function stubPrisma(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: { method: string; args: Row }[] = [];
  const job = {
    create: vi.fn((args: Row) => {
      calls.push({ method: "create", args });
      return Promise.resolve({ id: "job_1" });
    }),
    findFirst: vi.fn((args: Row) => {
      calls.push({ method: "findFirst", args });
      return Promise.resolve((overrides.findFirst as Row) ?? null);
    }),
    findUnique: vi.fn(() => Promise.resolve((overrides.findUnique as Row) ?? null)),
    updateMany: vi.fn((args: Row) => {
      calls.push({ method: "updateMany", args });
      return Promise.resolve({ count: (overrides.updateManyCount as number) ?? 1 });
    }),
    update: vi.fn((args: Row) => {
      calls.push({ method: "update", args });
      return Promise.resolve({});
    }),
    deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
  };
  return { prisma: { job } as never, job, calls };
}

const claimed = (over: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: "job_1",
  name: "export.csv",
  payload: {},
  attempts: 1,
  maxAttempts: 3,
  correlationId: null,
  actorId: null,
  actorEmail: null,
  ...over,
});

describe("the catalogue", () => {
  it("lists a name for every declared job", () => {
    const names: JobName[] = [...JOB_NAMES];
    expect(new Set(names).size).toBe(JOB_NAMES.length);
  });

  describe("backoff", () => {
    it("grows with the attempt", () => {
      expect(backoffMs(1)).toBeLessThan(backoffMs(2));
      expect(backoffMs(2)).toBeLessThan(backoffMs(3));
    });

    /**
     * The ceiling is the point. Doubling forever means the third attempt at a
     * malformed IFC lands next week, long after anyone could connect it to the
     * upload that caused it.
     */
    it("stops at ten minutes", () => {
      expect(backoffMs(20)).toBe(10 * 60_000);
    });

    it("starts soon enough to ride out a restart", () => {
      expect(backoffMs(1)).toBeLessThanOrEqual(15_000);
    });
  });
});

describe("handlers", () => {
  it("refuses a duplicate registration", () => {
    // Two handlers for one name means whichever module booted last wins, and
    // which one that is depends on the import graph.
    const { prisma } = stubPrisma();
    const jobs = new JobService(prisma);
    jobs.register("export.csv", () => Promise.resolve());
    expect(() => jobs.register("export.csv", () => Promise.resolve())).toThrow(/bereits/);
  });

  it("reports whether a name has one", () => {
    const { prisma } = stubPrisma();
    const jobs = new JobService(prisma);
    expect(jobs.hasHandler("export.csv")).toBe(false);
    jobs.register("export.csv", () => Promise.resolve());
    expect(jobs.hasHandler("export.csv")).toBe(true);
  });

  it("runs one without touching the row", async () => {
    // `run` is separate from `claim`/`complete` so that "did the work happen"
    // and "does the row say so" stay two facts.
    const { prisma, job } = stubPrisma();
    const jobs = new JobService(prisma);
    jobs.register("export.csv", (p) => Promise.resolve({ echoed: p }));
    await expect(jobs.run("export.csv", { resource: "audit" })).resolves.toEqual({
      echoed: { resource: "audit" },
    });
    expect(job.update).not.toHaveBeenCalled();
  });
});

describe("enqueue", () => {
  it("inherits the correlation id and the actor from the request", async () => {
    const { prisma, calls } = stubPrisma();
    const jobs = new JobService(prisma);

    const context = newContext({ correlationId: "corr-9" });
    context.actor = {
      id: "u1",
      email: "anna@iem.ch",
      name: "Anna",
      roles: [],
      permissions: new Set<string>(),
      isSuperAdmin: false,
    };

    await runWithContext(context, () => jobs.enqueue("export.csv", {
      resource: "audit",
      filter: {},
      requestedBy: "u1",
    }));

    // This is what makes an export's audit rows group with the click that
    // asked for it, days later if the queue was backed up.
    const data = calls.find((c) => c.method === "create")!.args.data as Row;
    expect(data.correlationId).toBe("corr-9");
    expect(data.actorEmail).toBe("anna@iem.ch");
  });

  it("skips when one of the same name is already pending", async () => {
    // A cron enqueueing every five minutes while the runner is behind would
    // otherwise queue four site publishes.
    const { prisma, job } = stubPrisma({ findFirst: { id: "existing" } });
    const jobs = new JobService(prisma);
    const result = await jobs.enqueueUnique("content.publishScheduled", {});
    expect(result).toEqual({ id: "existing", created: false });
    expect(job.create).not.toHaveBeenCalled();
  });

  it("queues when nothing is pending", async () => {
    const { prisma, job } = stubPrisma({ findFirst: null });
    const jobs = new JobService(prisma);
    const result = await jobs.enqueueUnique("content.publishScheduled", {});
    expect(result.created).toBe(true);
    expect(job.create).toHaveBeenCalledOnce();
  });
});

describe("claim", () => {
  it("returns nothing when the queue is empty", async () => {
    const { prisma } = stubPrisma({ findFirst: null });
    const jobs = new JobService(prisma);
    expect(await jobs.claim("worker-1")).toBeNull();
  });

  /**
   * The whole concurrency story.
   *
   * Two workers find the same row; the write carries `status: QUEUED` as a
   * condition, so exactly one update reports `count: 1`. The loser gets 0 and
   * asks again — no lock, no transaction.
   */
  it("writes the status back as a condition, not just as a value", async () => {
    const { prisma, calls } = stubPrisma({
      findFirst: { id: "job_1" },
      findUnique: { id: "job_1", name: "export.csv", payload: {}, attempts: 1, maxAttempts: 3 },
    });
    const jobs = new JobService(prisma);
    await jobs.claim("worker-1");

    const where = calls.find((c) => c.method === "updateMany")!.args.where as Row;
    expect(where.status).toBe(JobStatus.QUEUED);
    expect(where.id).toBe("job_1");
  });

  it("gives the loser of a race nothing", async () => {
    const { prisma } = stubPrisma({ findFirst: { id: "job_1" }, updateManyCount: 0 });
    const jobs = new JobService(prisma);
    expect(await jobs.claim("worker-2")).toBeNull();
  });

  it("names its holder, so a stuck job can be traced to a worker", async () => {
    const { prisma, calls } = stubPrisma({
      findFirst: { id: "job_1" },
      findUnique: { id: "job_1", name: "export.csv", payload: {}, attempts: 1, maxAttempts: 3 },
    });
    const jobs = new JobService(prisma);
    await jobs.claim("host:4711");
    const data = calls.find((c) => c.method === "updateMany")!.args.data as Row;
    expect(data.lockedBy).toBe("host:4711");
  });
});

describe("failure", () => {
  it("re-queues while attempts remain", async () => {
    const { prisma, calls } = stubPrisma();
    const jobs = new JobService(prisma);
    const status = await jobs.fail(claimed({ attempts: 1 }), new Error("kaputt"), 10);
    expect(status).toBe(JobStatus.QUEUED);
    const data = calls.find((c) => c.method === "update")!.args.data as Row;
    expect(data.status).toBe(JobStatus.QUEUED);
    expect(data.runAfter).toBeInstanceOf(Date);
  });

  /**
   * `FAILED` and `DEAD` are separate because "it failed and will try again"
   * and "it failed and never will" are the difference between waiting and
   * acting. One status would make an operator guess which they are looking at.
   */
  it("gives up on the last attempt", async () => {
    const { prisma, calls } = stubPrisma();
    const jobs = new JobService(prisma);
    const status = await jobs.fail(claimed({ attempts: 3, maxAttempts: 3 }), new Error("x"), 10);
    expect(status).toBe(JobStatus.DEAD);
    const data = calls.find((c) => c.method === "update")!.args.data as Row;
    expect(data.finishedAt).toBeInstanceOf(Date);
    expect(data.runAfter).toBeUndefined();
  });

  it("gives up at once when the failure is permanent", async () => {
    // A missing handler will still be missing on the third attempt.
    const { prisma } = stubPrisma();
    const jobs = new JobService(prisma);
    const status = await jobs.fail(claimed({ attempts: 1 }), new Error("kein Handler"), 5, {
      permanent: true,
    });
    expect(status).toBe(JobStatus.DEAD);
  });

  it("truncates the error, because a job table nobody can query is unread", async () => {
    const { prisma, calls } = stubPrisma();
    const jobs = new JobService(prisma);
    await jobs.fail(claimed(), new Error("x".repeat(9000)), 10);
    const data = calls.find((c) => c.method === "update")!.args.data as Row;
    expect((data.error as string).length).toBe(2000);
  });

  it("survives something that is not an Error", async () => {
    const { prisma, calls } = stubPrisma();
    const jobs = new JobService(prisma);
    await jobs.fail(claimed(), "kaputt", 10);
    const data = calls.find((c) => c.method === "update")!.args.data as Row;
    expect(data.error).toBe("kaputt");
  });
});

describe("the operator's half", () => {
  it("resets the attempt count on retry", async () => {
    // Without it a dead job retried once would die again on its next failure,
    // which is not what "retry" means to the person pressing it.
    const { prisma, calls } = stubPrisma();
    const jobs = new JobService(prisma);
    await jobs.retry("job_1");
    const data = calls.find((c) => c.method === "updateMany")!.args.data as Row;
    expect(data.attempts).toBe(0);
    expect(data.status).toBe(JobStatus.QUEUED);
  });

  it("cancels only a job that has not started", async () => {
    // The honest answer to "can I stop this" is no once it is in flight.
    const { prisma, calls } = stubPrisma();
    const jobs = new JobService(prisma);
    await jobs.cancel("job_1");
    const where = calls.find((c) => c.method === "updateMany")!.args.where as Row;
    expect(where.status).toBe(JobStatus.QUEUED);
  });

  it("reclaims only jobs whose lock is older than the timeout", async () => {
    const { prisma, calls } = stubPrisma();
    const jobs = new JobService(prisma);
    await jobs.reclaimStale(60_000);
    const updates = calls.filter((c) => c.method === "updateMany");
    for (const u of updates) {
      const where = u.args.where as Row;
      expect(where.status).toBe(JobStatus.RUNNING);
      expect((where.lockedAt as Row).lt).toBeInstanceOf(Date);
    }
  });
});

/**
 * A restore runs at most once — SEC-R4 in `docs/COMPLETE_APPLICATION_AUDIT.md`.
 *
 * The operator's Retry button was already hidden for it; the queue was not,
 * and a failed in-place restore was re-run twice by `fail()` on its own. Each
 * of the four ways a job can run again is closed here, and each test would
 * pass for `export.csv` — which is the point of naming the restore.
 */
describe("single-attempt jobs (backup.restore)", () => {
  const restore = (over: Partial<ClaimedJob> = {}) =>
    claimed({ name: "backup.restore", payload: { restoreRunId: "r1" }, ...over });

  it("is enqueued with one attempt, whatever the caller asks for", async () => {
    const { prisma, calls } = stubPrisma();
    const jobs = new JobService(prisma);
    await jobs.enqueue("backup.restore", { restoreRunId: "r1" }, { maxAttempts: 5 });
    const data = calls.find((c) => c.method === "create")!.args.data as Row;
    expect(data.maxAttempts).toBe(1);
  });

  it("goes DEAD on its first failure — no automatic second restore", async () => {
    const { prisma, calls } = stubPrisma();
    const jobs = new JobService(prisma);
    const status = await jobs.fail(restore({ attempts: 1, maxAttempts: 1 }), new Error("pg_restore"), 10);
    expect(status).toBe(JobStatus.DEAD);
    expect((calls.find((c) => c.method === "update")!.args.data as Row).status).toBe(JobStatus.DEAD);
  });

  it("goes DEAD even for a row enqueued with three attempts before the fix", async () => {
    const { prisma } = stubPrisma();
    const jobs = new JobService(prisma);
    const status = await jobs.fail(restore({ attempts: 1, maxAttempts: 3 }), new Error("x"), 10);
    expect(status).toBe(JobStatus.DEAD);
  });

  it("cannot be re-queued by retry(), even by a caller that forgot to ask", async () => {
    // The stub answers count 0, which is what the `notIn` condition produces
    // against a restore row in the database.
    const { prisma, calls } = stubPrisma({ updateManyCount: 0 });
    const jobs = new JobService(prisma);
    await expect(jobs.retry("job_1")).rejects.toThrow(/nicht wiederholen/);
    const where = calls.find((c) => c.method === "updateMany")!.args.where as Row;
    expect((where.name as { notIn: string[] }).notIn).toContain("backup.restore");
  });

  it("is ended, not re-queued, when its worker goes quiet", async () => {
    const { prisma, calls } = stubPrisma();
    const jobs = new JobService(prisma);
    await jobs.reclaimStale(60_000);
    const updates = calls.filter((c) => c.method === "updateMany");

    const ending = updates.find(
      (u) => ((u.args.where as Row).name as { in?: string[] }).in?.includes("backup.restore"),
    );
    expect(ending, "no update ends a stale restore").toBeTruthy();
    expect((ending!.args.data as Row).status).toBe(JobStatus.DEAD);

    const requeue = updates.find((u) => (u.args.data as Row).status === JobStatus.QUEUED);
    expect(requeue, "no update re-queues ordinary stale jobs").toBeTruthy();
    expect(((requeue!.args.where as Row).name as { notIn: string[] }).notIn).toContain("backup.restore");
  });

  it("an ordinary job still retries", async () => {
    const { prisma } = stubPrisma();
    const jobs = new JobService(prisma);
    expect(await jobs.fail(claimed({ attempts: 1, maxAttempts: 3 }), new Error("x"), 10)).toBe(
      JobStatus.QUEUED,
    );
  });
});
