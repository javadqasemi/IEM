import { describe, expect, it } from "vitest";
import { resolveBuildInfo, shortCommit } from "./build-info";

/**
 * The precedence, and the refusal to guess.
 *
 * Pure in both inputs, so none of this touches `process.env` or a filesystem
 * — which is what lets it assert the case that matters most: **absent stays
 * absent**. The failure this guards is not a crash, it is the system
 * reporting `0.0.1` from `package.json` on the day somebody asks whether the
 * fix is deployed.
 */

const EMPTY = {} as Record<string, string | undefined>;

describe("with nothing to go on", () => {
  it("reports absent with a reason rather than a version", () => {
    const info = resolveBuildInfo(EMPTY, null);
    expect(info.version).toBeNull();
    expect(info.commit).toBeNull();
    expect(info.builtAt).toBeNull();
    expect(info.source).toBe("none");
    expect(info.reason).toBeTruthy();
  });

  it("still knows the environment, which is always answerable", () => {
    expect(resolveBuildInfo(EMPTY, null).environment).toBe("development");
    expect(resolveBuildInfo({ NODE_ENV: "production" }, null).environment).toBe("production");
  });

  /**
   * The empty string is what a CI template produces when the variable was not
   * substituted. It is not a commit, and treating it as one would put an empty
   * badge where a SHA belongs — which reads as a bug in the page rather than
   * as a missing deployment step.
   */
  it("treats an unsubstituted variable as absent", () => {
    const info = resolveBuildInfo({ APP_COMMIT: "", APP_VERSION: "   " }, null);
    expect(info.source).toBe("none");
    expect(info.reason).toBeTruthy();
  });
});

describe("the environment wins", () => {
  it("is used when it carries anything at all", () => {
    const info = resolveBuildInfo(
      { APP_VERSION: "1.4.0", APP_COMMIT: "abcdef1234567890", APP_BUILT_AT: "2026-09-22T10:00:00Z" },
      null,
    );
    expect(info.version).toBe("1.4.0");
    expect(info.commit).toBe("abcdef123456");
    expect(info.builtAt).toBe("2026-09-22T10:00:00Z");
    expect(info.source).toBe("environment");
    expect(info.reason).toBeNull();
  });

  /**
   * The container case: the image was built elsewhere, so a stamp baked into
   * it may be older than the deployment that is running it.
   */
  it("beats a stamp file", () => {
    const info = resolveBuildInfo({ APP_VERSION: "2.0.0" }, { version: "1.0.0", commit: "old" });
    expect(info.version).toBe("2.0.0");
    expect(info.source).toBe("environment");
    // And it does not merge: a half-set environment must not borrow the
    // stamp's commit, or the screen shows a version and a SHA that never
    // existed together.
    expect(info.commit).toBeNull();
  });

  it("is used even when only the commit is set", () => {
    const info = resolveBuildInfo({ APP_COMMIT: "deadbeef" }, null);
    expect(info.source).toBe("environment");
    expect(info.version).toBeNull();
  });
});

describe("the stamp file", () => {
  it("is used when the environment says nothing", () => {
    const info = resolveBuildInfo(EMPTY, {
      version: "1.2.3",
      commit: "0123456789abcdef",
      builtAt: "2026-09-22T09:00:00Z",
    });
    expect(info.version).toBe("1.2.3");
    expect(info.commit).toBe("0123456789ab");
    expect(info.source).toBe("stamp");
  });

  it("is ignored when it is empty, so the reason survives", () => {
    const info = resolveBuildInfo(EMPTY, { version: null, commit: null, builtAt: null });
    expect(info.source).toBe("none");
    expect(info.reason).toBeTruthy();
  });

  it("is ignored when it is malformed rather than half-read", () => {
    expect(resolveBuildInfo(EMPTY, {} as never).source).toBe("none");
  });
});

describe("shortCommit", () => {
  it("cuts a SHA to twelve characters", () => {
    expect(shortCommit("c0a8efa06dbcbbe5b7b3c132fd756916cba17c4a")).toBe("c0a8efa06dbc");
  });

  it("leaves a short value alone", () => {
    expect(shortCommit("c0a8efa")).toBe("c0a8efa");
  });

  /**
   * Not validated as hexadecimal on purpose: a deployment may stamp a tag or
   * a build number, and refusing it would make the field less useful than the
   * free text it replaced.
   */
  it("passes a tag through", () => {
    expect(shortCommit("v1.4.0")).toBe("v1.4.0");
  });

  it("is null for nothing", () => {
    expect(shortCommit(null)).toBeNull();
  });
});
