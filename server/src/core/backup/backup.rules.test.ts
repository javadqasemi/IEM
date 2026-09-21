import { describe, expect, it } from "vitest";
import type { BackupType } from "@prisma/client";
import {
  RESTORE_CONFIRMATION,
  assessCompatibility,
  occurrenceKeyFor,
  planRetention,
  refuseConcurrent,
  refuseConfirmation,
  refuseDelete,
  refuseRestore,
  type Retainable,
  type RetentionPolicy,
} from "./backup.rules";

/**
 * The functions that decide **what gets deleted** and **what may be written
 * over a production database**.
 *
 * Every one of them fails silently when it is wrong: retention that takes one
 * row too many leaves no trace of what it took, and a compatibility check that
 * says yes too easily produces a half-restored database discovered by its
 * users. They are pure precisely so they can be covered exhaustively here
 * rather than reasoned about in a review.
 */

const HOUR = 3_600_000;
const NOW = new Date("2026-09-21T12:00:00.000Z");

const run = (over: Partial<Retainable> = {}): Retainable => ({
  id: Math.random().toString(36).slice(2),
  type: "FULL",
  status: "SUCCESS",
  trigger: "SCHEDULED",
  verification: "PASSED",
  protected: false,
  createdAt: new Date(NOW.getTime() - 10 * 24 * HOUR),
  ...over,
});

const policy = (over: Partial<RetentionPolicy> = {}): RetentionPolicy => ({
  keepDatabase: 2,
  keepMedia: 2,
  keepFull: 2,
  minimumAgeHours: 24,
  ...over,
});

/* ================================================================== */

describe("the scheduled occurrence key", () => {
  it("is one key per night per type", () => {
    const a = occurrenceKeyFor("FULL", new Date("2026-09-22T02:00:00Z"));
    const b = occurrenceKeyFor("FULL", new Date("2026-09-22T02:59:00Z"));
    expect(a).toBe(b);
  });

  it("separates the types and the nights", () => {
    expect(occurrenceKeyFor("FULL", new Date("2026-09-22T02:00:00Z"))).not.toBe(
      occurrenceKeyFor("DATABASE", new Date("2026-09-22T02:00:00Z")),
    );
    expect(occurrenceKeyFor("FULL", new Date("2026-09-22T02:00:00Z"))).not.toBe(
      occurrenceKeyFor("FULL", new Date("2026-09-23T02:00:00Z")),
    );
  });

  /**
   * The property the whole idempotency argument rests on. A timestamp-based
   * key would make a scheduler that fires twice produce two full backups of
   * the same database, which is how a nightly job fills a disk.
   */
  it("carries no time of day", () => {
    expect(occurrenceKeyFor("FULL", new Date("2026-09-22T23:59:59Z"))).toBe("2026-09-22:FULL");
  });
});

/* ================================================================== */

describe("retention never leaves zero recovery points", () => {
  /**
   * The guarantee that matters more than any count.
   *
   * A misconfigured form is not a reason to have no backups, and `keep: 0`
   * would otherwise mean "delete everything".
   */
  it("keeps the last verified backup even when the policy says keep none", () => {
    const newest = run({ id: "newest", createdAt: new Date(NOW.getTime() - 48 * HOUR) });
    const older = run({ id: "older", createdAt: new Date(NOW.getTime() - 72 * HOUR) });

    const plan = planRetention([newest, older], policy({ keepFull: 0 }), NOW);

    expect(plan.deleteIds).toContain("older");
    expect(plan.deleteIds).not.toContain("newest");
    expect(plan.spared.find((s) => s.id === "newest")?.reason).toMatch(/Letzte geprüfte/);
  });

  it("would otherwise delete everything old with keep: 0", () => {
    // The same policy with an *unverified* newest: there is no recovery point
    // to protect, so nothing is spared on that ground.
    const plan = planRetention(
      [
        run({ id: "a", verification: "FAILED", status: "FAILED", createdAt: new Date(NOW.getTime() - 48 * HOUR) }),
        run({ id: "b", verification: "FAILED", status: "FAILED", createdAt: new Date(NOW.getTime() - 72 * HOUR) }),
      ],
      policy({ keepFull: 0 }),
      NOW,
    );
    expect(plan.deleteIds.sort()).toEqual(["a", "b"]);
  });
});

describe("retention spares the four kinds it must", () => {
  it("a protected run", () => {
    const plan = planRetention(
      [
        run({ id: "keep-me", protected: true, createdAt: new Date(NOW.getTime() - 400 * HOUR) }),
        run({ id: "recent" }),
      ],
      policy({ keepFull: 0 }),
      NOW,
    );
    expect(plan.deleteIds).not.toContain("keep-me");
    expect(plan.spared.find((s) => s.id === "keep-me")?.reason).toMatch(/geschützt/);
  });

  it("anything still running — the file is being written into it", () => {
    for (const status of ["QUEUED", "RUNNING", "VERIFYING"] as const) {
      const plan = planRetention(
        [run({ id: "busy", status, verification: "PENDING", createdAt: new Date(NOW.getTime() - 400 * HOUR) })],
        policy({ keepFull: 0 }),
        NOW,
      );
      expect(plan.deleteIds, status).not.toContain("busy");
    }
  });

  /**
   * The pre-restore backup is wanted precisely when the restore turned out to
   * be a mistake — which is discovered days later, not inside a rolling window.
   */
  it("a pre-restore backup, however old", () => {
    const plan = planRetention(
      [
        run({ id: "safety", trigger: "PRE_RESTORE", createdAt: new Date(NOW.getTime() - 5000 * HOUR) }),
        run({ id: "recent" }),
      ],
      policy({ keepFull: 0 }),
      NOW,
    );
    expect(plan.deleteIds).not.toContain("safety");
  });

  it("anything younger than the minimum age", () => {
    const plan = planRetention(
      [
        run({ id: "fresh", createdAt: new Date(NOW.getTime() - 2 * HOUR) }),
        run({ id: "old", createdAt: new Date(NOW.getTime() - 400 * HOUR) }),
        run({ id: "keeper" }),
      ],
      policy({ keepFull: 0, minimumAgeHours: 24 }),
      NOW,
    );
    expect(plan.deleteIds).not.toContain("fresh");
  });
});

describe("retention counts per type", () => {
  it("does not let one type's volume evict another's", () => {
    const rows: Retainable[] = [];
    for (let i = 0; i < 6; i++) {
      rows.push(
        run({ id: `db-${i}`, type: "DATABASE", createdAt: new Date(NOW.getTime() - (50 + i) * HOUR) }),
      );
    }
    rows.push(run({ id: "media-1", type: "MEDIA", createdAt: new Date(NOW.getTime() - 60 * HOUR) }));

    const plan = planRetention(rows, policy({ keepDatabase: 2, keepMedia: 2 }), NOW);

    expect(plan.deleteIds).not.toContain("media-1");
    expect(plan.deleteIds.every((id) => id.startsWith("db-"))).toBe(true);
  });

  /**
   * A spared run must not consume a slot, or protecting three backups would
   * silently evict three others — which is the opposite of what protecting one
   * is for.
   */
  it("does not let a spared run consume a keep slot", () => {
    const rows = [
      run({ id: "protected", protected: true, createdAt: new Date(NOW.getTime() - 100 * HOUR) }),
      run({ id: "a", createdAt: new Date(NOW.getTime() - 101 * HOUR) }),
      run({ id: "b", createdAt: new Date(NOW.getTime() - 102 * HOUR) }),
      run({ id: "c", createdAt: new Date(NOW.getTime() - 103 * HOUR) }),
    ];
    const plan = planRetention(rows, policy({ keepFull: 2 }), NOW);

    // `a` is the last verified and is spared on that ground; `b` fills the
    // remaining slots; only `c` goes.
    expect(plan.deleteIds).toEqual(["c"]);
  });
});

describe("the preview and the deletion are the same function", () => {
  /**
   * Not a behaviour test — a *design* test. A preview computed differently
   * from the deletion it previews is a preview that lies exactly when somebody
   * is relying on it, so both callers pass the same rows to this one function
   * and this asserts it is deterministic over them.
   */
  it("is deterministic for the same input", () => {
    const rows = [run({ id: "a" }), run({ id: "b" }), run({ id: "c" })];
    const first = planRetention(rows, policy(), NOW);
    const second = planRetention(rows, policy(), NOW);
    expect(first.deleteIds).toEqual(second.deleteIds);
    expect(first.keep.length + first.deleteIds.length).toBe(rows.length);
  });
});

/* ================================================================== */

describe("deleting one by hand", () => {
  it("refuses the last verified backup of its type", () => {
    expect(refuseDelete(run(), true)).toMatch(/letzte geprüfte/i);
  });

  it("refuses one that is still running", () => {
    expect(refuseDelete(run({ status: "RUNNING" }), false)).toMatch(/läuft noch/i);
  });

  it("refuses a protected one until the protection is lifted", () => {
    expect(refuseDelete(run({ protected: true }), false)).toMatch(/geschützt/i);
  });

  /**
   * Narrower than retention on purpose: a person deleting one deliberately can
   * see what it is, so an unverified or pre-restore backup is theirs to take.
   */
  it("allows an unverified one", () => {
    expect(refuseDelete(run({ verification: "FAILED", status: "FAILED" }), false)).toBeNull();
  });
});

/* ================================================================== */

describe("compatibility", () => {
  const known = ["20260101_a", "20260201_b", "20260301_c"];

  it("is compatible at the same migration", () => {
    expect(assessCompatibility("20260201_b", "20260201_b", known).result).toBe("COMPATIBLE");
  });

  it("needs migrations when the backup is older", () => {
    const out = assessCompatibility("20260101_a", "20260301_c", known);
    expect(out.result).toBe("REQUIRES_MIGRATION");
    expect(out.reason).toContain("2");
  });

  /**
   * The case worth stating: a backup from a *later* release has tables this
   * build has never heard of, and Prisma does not migrate backwards.
   */
  it("refuses a backup newer than the application", () => {
    expect(assessCompatibility("20260301_c", "20260101_a", known).result).toBe("INCOMPATIBLE");
    expect(assessCompatibility("20270101_future", "20260301_c", known).result).toBe("INCOMPATIBLE");
  });

  it("refuses rather than guesses when either side is unknown", () => {
    expect(assessCompatibility(null, "20260301_c", known).result).toBe("INCOMPATIBLE");
    expect(assessCompatibility("20260301_c", null, known).result).toBe("INCOMPATIBLE");
  });
});

/* ================================================================== */

describe("what may be restored", () => {
  const ok = {
    status: "SUCCESS" as const,
    verification: "PASSED" as const,
    type: "FULL" as BackupType,
    compatibility: "COMPATIBLE" as const,
    hasDatabaseArtifact: true,
  };

  it("allows a verified, compatible, complete backup", () => {
    expect(refuseRestore(ok)).toBeNull();
    expect(refuseRestore({ ...ok, compatibility: "REQUIRES_MIGRATION" })).toBeNull();
  });

  /**
   * The rule the module turns on. Restoring from an unverified backup means
   * discovering it was corrupt *after* replacing the database it was meant to
   * replace — the worst outcome this feature can produce.
   */
  it("refuses an unverified backup", () => {
    for (const verification of ["PENDING", "FAILED"] as const) {
      expect(refuseRestore({ ...ok, verification }), verification).toMatch(/nicht erfolgreich geprüft/);
    }
  });

  it("refuses one that did not finish", () => {
    for (const status of ["QUEUED", "RUNNING", "FAILED", "EXPIRED", "DELETED"] as const) {
      expect(refuseRestore({ ...ok, status }), status).not.toBeNull();
    }
  });

  it("refuses a media-only backup, which holds no database", () => {
    expect(refuseRestore({ ...ok, type: "MEDIA" })).toMatch(/keine Datenbank/);
  });

  it("refuses when the dump is missing whatever the row says", () => {
    expect(refuseRestore({ ...ok, hasDatabaseArtifact: false })).not.toBeNull();
  });

  it("refuses an incompatible schema", () => {
    expect(refuseRestore({ ...ok, compatibility: "INCOMPATIBLE" })).not.toBeNull();
  });
});

describe("the typed confirmation", () => {
  it("accepts the word, trimmed", () => {
    expect(refuseConfirmation(RESTORE_CONFIRMATION)).toBeNull();
    expect(refuseConfirmation(`  ${RESTORE_CONFIRMATION}  `)).toBeNull();
  });

  it("refuses everything else, including the lower case", () => {
    for (const bad of ["", "ja", "wiederherstellen", "RESTORE", "WIEDERHERSTELLE"]) {
      expect(refuseConfirmation(bad), bad).not.toBeNull();
    }
  });
});

/* ================================================================== */

describe("concurrency", () => {
  it("allows two backups to overlap", () => {
    // They write to two generated keys and contend for nothing but disk.
    // Forbidding it would fail a manual backup taken *because* something risky
    // is about to happen, just as the nightly one starts.
    expect(refuseConcurrent("BACKUP", ["BACKUP"])).toBeNull();
  });

  it("forbids every pair involving a restore", () => {
    expect(refuseConcurrent("RESTORE", ["RESTORE"])).not.toBeNull();
    expect(refuseConcurrent("RESTORE", ["BACKUP"])).not.toBeNull();
    expect(refuseConcurrent("RESTORE", ["RETENTION"])).not.toBeNull();
  });

  /**
   * The symmetry is the point. A one-directional table is how "we blocked
   * backups during a restore" turns out not to have blocked a restore during
   * a backup.
   */
  it("is symmetric", () => {
    expect(refuseConcurrent("BACKUP", ["RESTORE"])).not.toBeNull();
    expect(refuseConcurrent("RETENTION", ["RESTORE"])).not.toBeNull();
  });

  it("forbids two retention passes", () => {
    expect(refuseConcurrent("RETENTION", ["RETENTION"])).not.toBeNull();
  });

  it("allows anything when nothing is running", () => {
    expect(refuseConcurrent("RESTORE", [])).toBeNull();
    expect(refuseConcurrent("RETENTION", [])).toBeNull();
  });
});

