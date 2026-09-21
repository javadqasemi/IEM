import { describe, expect, it } from "vitest";
import {
  BACKUP_FAILURE_CATEGORIES,
  backupFailure,
  classifyBackupError,
  redactToolOutput,
} from "./backup.failure";
import { CONSISTENCY_NOTE, findSecretLikeKeys, refuseManifest, type BackupManifest } from "./backup.manifest";

const manifest = (): BackupManifest => ({
  manifestVersion: 1,
  backupId: "bk_1",
  type: "FULL",
  createdAt: new Date().toISOString(),
  organisation: "IEM AG",
  application: { version: null, migration: "20260921_backup_recovery" },
  database: { serverVersion: "18.6", name: "iem_cms" },
  artifacts: [{ kind: "DATABASE_DUMP", file: "bk_1.dump", sizeBytes: 12, sha256: "ab" }],
  consistency: { databaseAt: null, mediaAt: null, note: CONSISTENCY_NOTE },
});

/* ================================================================== */

describe("the manifest carries no secret", () => {
  /**
   * The guarantee the type provides, asserted at runtime because a type is not
   * present at runtime and `JSON.stringify` of a widened object would sail
   * past it.
   */
  it("passes a real manifest", () => {
    expect(findSecretLikeKeys(manifest())).toEqual([]);
  });

  it("catches every shape of credential key a future field might use", () => {
    const cases: Record<string, unknown>[] = [
      { smtpPassword: "x" },
      { APP_SECRETS_ENCRYPTION_KEY: "x" },
      { jwtSecret: "x" },
      { api_key: "x" },
      { refreshToken: "x" },
      { database_url: "x" },
      { connectionString: "x" },
      { nested: { deep: { privateKey: "x" } } },
      { list: [{ pgPassword: "x" }] },
    ];
    for (const value of cases) {
      expect(findSecretLikeKeys(value), JSON.stringify(value)).not.toEqual([]);
    }
  });

  it("does not flag the ordinary fields a manifest needs", () => {
    // A check that fired on `backupId`, `checksum` or `migration` would be one
    // somebody switches off.
    expect(
      findSecretLikeKeys({
        backupId: "x",
        checksum: "x",
        migration: "x",
        sha256: "x",
        serverVersion: "x",
        keepDatabase: 2,
      }),
    ).toEqual([]);
  });

  it("names the path so a failure says which field", () => {
    expect(findSecretLikeKeys({ a: { b: { smtpPassword: "x" } } })).toEqual(["a.b.smtpPassword"]);
  });
});

describe("reading a manifest back", () => {
  it("accepts one this build wrote", () => {
    expect(refuseManifest(manifest())).toBeNull();
  });

  it("refuses an unknown version rather than guessing at it", () => {
    expect(refuseManifest({ ...manifest(), manifestVersion: 2 })).toMatch(/Version/);
  });

  it("refuses something that is not a manifest at all", () => {
    expect(refuseManifest(null)).not.toBeNull();
    expect(refuseManifest("{}")).not.toBeNull();
    expect(refuseManifest({ manifestVersion: 1 })).not.toBeNull();
  });

  /**
   * The consistency caveat is written into the file rather than assumed. A
   * `FULL` backup dumps the database and archives the media one after the
   * other, and an operator reconciling a recovery deserves to be told.
   */
  it("states the consistency limitation", () => {
    expect(manifest().consistency.note).toMatch(/nacheinander/);
  });
});

/* ================================================================== */

describe("failure classification", () => {
  const err = (fields: { code?: string; message?: string; stderr?: string }) =>
    Object.assign(new Error(fields.message ?? "boom"), fields);

  it("maps the codes that matter", () => {
    expect(classifyBackupError(err({ code: "ENOENT" })).category).toBe("TOOL_MISSING");
    expect(classifyBackupError(err({ code: "ENOSPC" })).category).toBe("DISK_FULL");
    expect(classifyBackupError(err({ code: "EACCES" })).category).toBe("STORAGE_UNAVAILABLE");
    expect(classifyBackupError(err({ code: "ECONNREFUSED" })).category).toBe("DATABASE_UNAVAILABLE");
  });

  it("reads a tool's stderr before its message", () => {
    // `message` on a spawned failure is usually only "exited with 1"; the
    // diagnosis is on stderr.
    const failure = classifyBackupError(
      err({ message: "pg_dump exited with 1", stderr: "pg_dump: error: no space left on device" }),
    );
    expect(failure.category).toBe("DISK_FULL");
  });

  it("falls back to what was being attempted rather than to UNKNOWN", () => {
    expect(classifyBackupError(err({ message: "???" }), "ARCHIVE_FAILED").category).toBe(
      "ARCHIVE_FAILED",
    );
    expect(classifyBackupError("a string", "RESTORE_FAILED").category).toBe("RESTORE_FAILED");
  });

  it("gives every category non-empty German copy", () => {
    for (const category of BACKUP_FAILURE_CATEGORIES) {
      expect(backupFailure(category).message.length, category).toBeGreaterThan(10);
    }
  });

  /**
   * The invariant. `pg_dump` and `pg_restore` report connection failures by
   * echoing the connection they attempted.
   */
  it("returns no part of the input", () => {
    const secret = "S3cr3t-Passw0rd";
    const failure = classifyBackupError(
      err({
        code: "ECONNREFUSED",
        stderr: `connection to server at "db.example.ch" failed: password=${secret} user=iem_admin`,
      }),
    );
    expect(failure.message).not.toContain(secret);
    expect(failure.message).not.toContain("iem_admin");
    expect(failure.message).not.toContain("db.example.ch");
    expect(JSON.stringify(failure)).not.toContain(secret);
  });
});

describe("redacting a tool's own output for the server log", () => {
  it("removes a connection URL", () => {
    const out = redactToolOutput(
      'pg_restore: connecting to postgresql://iem:hunter2@db:5432/iem_cms failed',
    );
    expect(out).not.toContain("hunter2");
    expect(out).toContain("<redacted>");
  });

  it("removes a password parameter and PGPASSWORD", () => {
    expect(redactToolOutput("password=hunter2 and more")).not.toContain("hunter2");
    expect(redactToolOutput("PGPASSWORD=hunter2")).not.toContain("hunter2");
  });

  it("leaves ordinary diagnostics readable", () => {
    const text = "pg_restore: warning: errors ignored on restore: 3";
    expect(redactToolOutput(text)).toBe(text);
  });
});

