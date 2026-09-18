import { describe, expect, it, vi } from "vitest";
import { TasksOverdueSweep } from "./tasks.overdue";

/**
 * The nightly sweep, with its four collaborators replaced.
 *
 * Reachable only from a clock otherwise, which is exactly why it needs a test:
 * a job that runs at six in the morning and announces nothing is
 * indistinguishable from a job that runs at six in the morning and has nothing
 * to announce. Nobody would notice for months.
 *
 * Three properties matter and none of them is visible from the code being
 * edited: it announces **once per due date**, it announces **before** it marks,
 * and `daysOverdue` is elapsed time rather than a difference of calendar dates.
 */

type Row = {
  id: string;
  title: string;
  projectId: string | null;
  assigneeId: string | null;
  dueDate: Date;
};

function sweep(rows: Row[]) {
  const published: { name: string; payload: Record<string, unknown> }[] = [];
  const marked: { ids: string[]; at: Date }[] = [];

  const repo = {
    overdueUnannounced: vi.fn(async () => rows),
    markOverdueAnnounced: vi.fn(async (ids: readonly string[], at: Date) => {
      marked.push({ ids: [...ids], at });
      return { count: ids.length };
    }),
  };
  const events = {
    publish: vi.fn((name: string, envelope: { payload: Record<string, unknown> }) => {
      published.push({ name, payload: envelope.payload });
    }),
  };
  const jobs = { register: vi.fn(), enqueueUnique: vi.fn() };
  const redis = { withLock: vi.fn(async (_key: string, _ttl: number, fn: () => Promise<void>) => fn()) };

  const instance = new TasksOverdueSweep(
    repo as never,
    events as never,
    jobs as never,
    redis as never,
  );
  return { instance, repo, events, jobs, redis, published, marked };
}

const row = (over: Partial<Row> = {}): Row => ({
  id: "t1",
  title: "Erdsondenfeld abstimmen",
  projectId: "p1",
  assigneeId: "e1",
  dueDate: new Date(Date.now() - 3 * 86_400_000),
  ...over,
});

describe("registration", () => {
  it("registers its handler at boot, separately from anything enqueueing it", () => {
    /**
     * A deploy that adds a producer before its consumer is legitimate, and a job
     * with no handler is held as `DEAD` with a message rather than retried three
     * times against nothing.
     */
    const { instance, jobs } = sweep([]);
    instance.onModuleInit();
    expect(jobs.register).toHaveBeenCalledWith("tasks.flagOverdue", expect.any(Function));
  });
});

describe("the tick", () => {
  it("enqueues rather than doing the work", () => {
    /**
     * The F10 shape. A sweep that ran inside the `@Cron` method would be
     * undurable — a restart at 06:00 skips a morning — unretried, invisible and
     * unattributable. As a job it is a row an operator can read.
     */
    const { instance, jobs, repo } = sweep([row()]);
    return instance.nightly().then(() => {
      expect(jobs.enqueueUnique).toHaveBeenCalledWith("tasks.flagOverdue", {});
      expect(repo.overdueUnannounced).not.toHaveBeenCalled();
    });
  });

  it("takes the lock, so four workers enqueue once", async () => {
    // The Redis lock serialises the *tick*; `JobService.claim` serialises the
    // *row*. Neither replaces the other, and without this one four PM2 workers
    // would enqueue four sweeps.
    const { instance, redis } = sweep([]);
    await instance.nightly();
    expect(redis.withLock).toHaveBeenCalledWith(
      "cron:tasks-flag-overdue",
      30,
      expect.any(Function),
    );
  });
});

describe("the sweep", () => {
  it("does nothing, and writes nothing, when nothing is overdue", async () => {
    const { instance, repo } = sweep([]);
    await expect(instance.run()).resolves.toEqual({ announced: 0 });
    // Not an empty `updateMany`: a write of no rows still costs a statement and
    // still shows in a slow-query log as a sweep that ran.
    expect(repo.markOverdueAnnounced).not.toHaveBeenCalled();
  });

  it("announces one TaskOverdue per row", async () => {
    const { instance, published } = sweep([row({ id: "a" }), row({ id: "b", title: "Zweite" })]);
    await instance.run();
    expect(published.map((e) => e.name)).toEqual(["TaskOverdue", "TaskOverdue"]);
    expect(published[1].payload).toMatchObject({ title: "Zweite", projectId: "p1" });
  });

  it("marks every announced row, so tomorrow is quiet", async () => {
    /**
     * `Task.overdueNotifiedAt` is the whole guard. Without it the same task is
     * announced every night, and a notification that arrives every night is one
     * nobody reads — which is worse than no notification, because it also
     * teaches people to ignore the ones that matter.
     */
    const { instance, marked } = sweep([row({ id: "a" }), row({ id: "b" })]);
    await instance.run();
    expect(marked).toHaveLength(1);
    expect(marked[0].ids).toEqual(["a", "b"]);
  });

  it("announces before it marks", async () => {
    /**
     * **The order is the whole design, and it is not arbitrary.** Events are
     * queued on the context and flushed when the work succeeds, so a crash
     * between publishing and marking announces the same tasks again tomorrow —
     * a duplicate notification. The other way round, a crash marks them
     * announced and nobody ever hears. Announcing twice is a nuisance;
     * announcing never is the bug the column exists to prevent.
     */
    const order: string[] = [];
    const { instance, events, repo } = sweep([row()]);
    events.publish.mockImplementation(() => void order.push("publish"));
    repo.markOverdueAnnounced.mockImplementation(async () => {
      order.push("mark");
      return { count: 1 };
    });
    await instance.run();
    expect(order).toEqual(["publish", "mark"]);
  });

  it("carries daysOverdue as elapsed time, not as a calendar difference", async () => {
    /**
     * A task due at 17:00 yesterday is not "1 day" overdue at 06:00 this
     * morning — it is 13 hours. Reporting a day would make the first escalation
     * threshold fire half a day early, every time.
     */
    const thirteenHours = new Date(Date.now() - 13 * 3_600_000);
    const { instance, published } = sweep([row({ dueDate: thirteenHours })]);
    await instance.run();
    expect(published[0].payload.daysOverdue).toBe(0);
  });

  it("counts whole days once they have elapsed", async () => {
    const { instance, published } = sweep([
      row({ dueDate: new Date(Date.now() - 3.5 * 86_400_000) }),
    ]);
    await instance.run();
    expect(published[0].payload.daysOverdue).toBe(3);
  });

  it("never reports a negative figure", async () => {
    // Belt and braces: the query only returns rows past their date, but a clock
    // that moved backwards would otherwise produce "−1 Tage überfällig".
    const { instance, published } = sweep([row({ dueDate: new Date(Date.now() + 86_400_000) })]);
    await instance.run();
    expect(published[0].payload.daysOverdue).toBe(0);
  });

  it("carries the assignee, including when there is none", async () => {
    // An unassigned overdue task is the one that most needs announcing —
    // nobody is going to notice it on their own board. A payload that omitted
    // the null would make a listener guess.
    const { instance, published } = sweep([row({ assigneeId: null, projectId: null })]);
    await instance.run();
    expect(published[0].payload).toMatchObject({ assigneeId: null, projectId: null });
  });
});
