import { describe, expect, it } from "vitest";
import { JobStatus } from "@prisma/client";
import { JOB_NAMES } from "./catalogue";
import {
  NEVER_RETRYABLE,
  QUEUE_BACKLOG_WARNING,
  UNREACHABLE_STATUSES,
  jobCapabilities,
  jobPhase,
  jobsHealth,
  isTerminal,
  refuseCancel,
  refuseRetry,
  safeError,
  safePayload,
} from "./jobs.rules";

/**
 * The job capability model, over **every status × every catalogue name**.
 *
 * Six statuses and seventeen job names is 102 cases, which is small enough to
 * assert exhaustively and exactly the kind of table where a one-off `if` gets
 * the destructive case wrong. The one that matters is `backup.restore`: it
 * must be refused in every status, including the ones where every other job
 * is retryable.
 */

const ALL_STATUSES = Object.values(JobStatus);

describe("the phase a screen shows", () => {
  it("separates a first attempt from a retry, which the status cannot", () => {
    expect(jobPhase({ status: JobStatus.QUEUED, attempts: 0 })).toBe("QUEUED");
    expect(jobPhase({ status: JobStatus.QUEUED, attempts: 2 })).toBe("RETRYING");
  });

  it("passes the other statuses through unchanged", () => {
    expect(jobPhase({ status: JobStatus.RUNNING, attempts: 1 })).toBe("RUNNING");
    expect(jobPhase({ status: JobStatus.DONE, attempts: 1 })).toBe("DONE");
    expect(jobPhase({ status: JobStatus.DEAD, attempts: 3 })).toBe("DEAD");
    expect(jobPhase({ status: JobStatus.CANCELLED, attempts: 0 })).toBe("CANCELLED");
  });

  it("renders a FAILED row rather than crashing on it", () => {
    // Unreachable in this codebase, reachable from a migration or a hand-edit.
    expect(jobPhase({ status: JobStatus.FAILED, attempts: 1 })).toBe("RETRYING");
  });

  it("gives every status a phase", () => {
    for (const status of ALL_STATUSES) {
      expect(jobPhase({ status, attempts: 0 }), status).toBeTruthy();
    }
  });
});

/**
 * The finding this list records, asserted so it cannot be forgotten.
 *
 * `JobService.fail` writes `DEAD` or `QUEUED` and never `FAILED`, so a filter
 * offering "Fehlgeschlagen" would return an empty list for ever — which an
 * operator reads as "there are no failures".
 */
describe("the status nothing writes", () => {
  it("names FAILED, and only FAILED", () => {
    expect([...UNREACHABLE_STATUSES]).toEqual([JobStatus.FAILED]);
  });

  it("does not claim a status the enum does not have", () => {
    for (const s of UNREACHABLE_STATUSES) expect(ALL_STATUSES).toContain(s);
  });
});

describe("terminal statuses", () => {
  it("are the three that will not move again", () => {
    const terminal = ALL_STATUSES.filter(isTerminal);
    expect(terminal.sort()).toEqual([JobStatus.CANCELLED, JobStatus.DEAD, JobStatus.DONE].sort());
  });
});

/* ================================================================== */

describe("retry, over every status", () => {
  const ordinary = "content.publishScheduled";

  it("allows a dead job — the whole point of the terminal state", () => {
    expect(refuseRetry({ name: ordinary, status: JobStatus.DEAD })).toBeNull();
  });

  it("allows a cancelled job, which never ran", () => {
    expect(refuseRetry({ name: ordinary, status: JobStatus.CANCELLED })).toBeNull();
  });

  /**
   * The case an operator will actually try, refused with a reason rather than
   * by the button being absent.
   */
  it("refuses a completed job and says why", () => {
    const refusal = refuseRetry({ name: ordinary, status: JobStatus.DONE });
    expect(refusal).toMatch(/erfolgreich/);
  });

  it("refuses a running job", () => {
    expect(refuseRetry({ name: ordinary, status: JobStatus.RUNNING })).toMatch(/läuft/);
  });

  it("refuses a queued job, because it will run anyway", () => {
    expect(refuseRetry({ name: ordinary, status: JobStatus.QUEUED })).toMatch(/wartet/);
  });

  it("allows exactly two statuses", () => {
    const allowed = ALL_STATUSES.filter(
      (status) => refuseRetry({ name: ordinary, status }) === null,
    );
    expect(allowed.sort()).toEqual([JobStatus.CANCELLED, JobStatus.DEAD].sort());
  });
});

describe("the destructive job, in every status", () => {
  /**
   * The single most important assertion in this file.
   *
   * A restore replaces a database, so "it died half way" does not mean
   * "nothing happened" — and a retry button beside a failed restore is a way
   * to apply a second restore over whatever state the first one left, without
   * the confirmation and the re-authentication a deliberate restore requires.
   */
  it("is never retryable, whatever its status", () => {
    for (const status of ALL_STATUSES) {
      const refusal = refuseRetry({ name: "backup.restore", status });
      expect(refusal, `backup.restore in ${status}`).not.toBeNull();
      expect(refusal, status).toMatch(/Produktivdaten/);
    }
  });

  it("names only job types the catalogue has", () => {
    for (const name of NEVER_RETRYABLE) {
      expect(JOB_NAMES as readonly string[], `${name} is not a declared job`).toContain(name);
    }
  });

  /**
   * Guards against the list quietly growing until nothing is retryable, which
   * would make the whole Job Operations surface decorative.
   */
  it("leaves the ordinary jobs retryable", () => {
    const retryable = JOB_NAMES.filter(
      (name) => refuseRetry({ name, status: JobStatus.DEAD }) === null,
    );
    expect(retryable.length).toBeGreaterThan(JOB_NAMES.length - 3);
  });
});

/* ================================================================== */

describe("cancel", () => {
  it("allows only a queued job", () => {
    const allowed = ALL_STATUSES.filter(
      (status) => refuseCancel({ name: "export.csv", status }) === null,
    );
    expect(allowed).toEqual([JobStatus.QUEUED]);
  });

  /**
   * Refused with the real reason: there is no cancellation token in this
   * queue, so marking a running row cancelled would be a status the system
   * cannot deliver.
   */
  it("refuses a running job and explains rather than shrugging", () => {
    const refusal = refuseCancel({ name: "export.csv", status: JobStatus.RUNNING });
    expect(refusal).toMatch(/läuft bereits/);
    expect(refusal!.length).toBeGreaterThan(40);
  });
});

describe("the capabilities the row carries", () => {
  it("agrees with the refusals it is derived from", () => {
    for (const name of JOB_NAMES) {
      for (const status of ALL_STATUSES) {
        const caps = jobCapabilities({ name, status });
        expect(caps.retryable, `${name}/${status}`).toBe(refuseRetry({ name, status }) === null);
        expect(caps.cancellable, `${name}/${status}`).toBe(refuseCancel({ name, status }) === null);
      }
    }
  });

  it("carries a reason whenever it says no", () => {
    for (const name of JOB_NAMES) {
      for (const status of ALL_STATUSES) {
        const caps = jobCapabilities({ name, status });
        if (!caps.retryable) expect(caps.retryRefusal, `${name}/${status}`).toBeTruthy();
        if (!caps.cancellable) expect(caps.cancelRefusal, `${name}/${status}`).toBeTruthy();
      }
    }
  });

  it("never offers both at once, because the statuses are disjoint", () => {
    for (const name of JOB_NAMES) {
      for (const status of ALL_STATUSES) {
        const caps = jobCapabilities({ name, status });
        expect(caps.retryable && caps.cancellable, `${name}/${status}`).toBe(false);
      }
    }
  });
});

/* ================================================================== */

describe("how the queue reports itself", () => {
  const counts = { queued: 0, running: 0, dead: 0, done24h: 0 };

  it("is healthy with nothing wrong, and says nothing", () => {
    const health = jobsHealth(counts);
    expect(health.state).toBe("healthy");
    expect(health.reasons).toEqual([]);
  });

  /**
   * A dead job is work that did not happen and that nobody will retry on its
   * own — a warning. It is not the queue being broken, which is what
   * `critical` is kept for.
   */
  it("warns on a dead job rather than calling the queue broken", () => {
    const health = jobsHealth({ ...counts, dead: 1 });
    expect(health.state).toBe("warning");
    expect(health.reasons[0]).toMatch(/1 Aufgabe/);
  });

  it("counts correctly in the plural", () => {
    expect(jobsHealth({ ...counts, dead: 4 }).reasons[0]).toMatch(/4 Aufgaben/);
  });

  it("warns on a backlog at the threshold, not one short of it", () => {
    expect(jobsHealth({ ...counts, queued: QUEUE_BACKLOG_WARNING - 1 }).state).toBe("healthy");
    expect(jobsHealth({ ...counts, queued: QUEUE_BACKLOG_WARNING }).state).toBe("warning");
  });

  it("reports both reasons when both apply", () => {
    const health = jobsHealth({ ...counts, dead: 2, queued: 99 });
    expect(health.reasons).toHaveLength(2);
  });

  it("does not treat a busy queue as a problem", () => {
    expect(jobsHealth({ ...counts, running: 3, done24h: 900 }).state).toBe("healthy");
  });
});

/* ================================================================== */

describe("what a payload may say", () => {
  it("removes a secret by key name, at depth", () => {
    const out = safePayload({ id: "x", nested: { smtpPassword: "hunter2", host: "mail" } }) as {
      nested: Record<string, unknown>;
    };
    expect(out.nested.smtpPassword).toBe("«entfernt»");
    expect(out.nested.host).toBe("mail");
  });

  it("removes a re-authentication token, which a restore request carries", () => {
    const out = safePayload({ reauthToken: "abc" }) as Record<string, unknown>;
    expect(out.reauthToken).toBe("«entfernt»");
  });

  it("removes a connection string, which carries the password inline", () => {
    const out = safePayload({ databaseUrl: "postgresql://u:p@h/db" }) as Record<string, unknown>;
    expect(out.databaseUrl).toBe("«entfernt»");
  });

  /**
   * Visibly, not silently. A payload cut in half without saying so is worse
   * than no payload: the reader believes they have the whole thing.
   */
  it("replaces an oversized payload with a statement rather than truncating it", () => {
    const out = safePayload({ blob: "x".repeat(5_000) }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain("xxxxx");
    expect(JSON.stringify(out)).toMatch(/gekürzt/);
  });

  it("leaves an ordinary id payload alone", () => {
    expect(safePayload({ backupRunId: "abc123" })).toEqual({ backupRunId: "abc123" });
  });

  it("survives an empty payload", () => {
    expect(safePayload({})).toEqual({});
  });
});

describe("what an error message may say", () => {
  it("is null for a job that has not failed", () => {
    expect(safeError(null, (t) => t)).toBeNull();
  });

  /**
   * The message is prose, so the key-name denylist cannot reach into it — the
   * text redactor is what strips a connection string `pg_dump` echoed back.
   */
  it("passes the message through the redactor it is given", () => {
    const out = safeError("connect postgresql://u:secret@h/db failed", (t) =>
      t.replace(/postgresql:\/\/\S+/g, "postgresql://<redacted>"),
    );
    expect(out).not.toContain("secret");
    expect(out).toContain("<redacted>");
  });
});
