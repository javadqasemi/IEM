#!/usr/bin/env node
/**
 * Writes `server/build-info.json` so the running application can say who it is.
 *
 * ---
 *
 * ## Why a build step rather than a runtime lookup
 *
 * `/dashboard/system` reported `version: null` from P1-1 until P2-6, with a
 * reason beside it, because the alternative was worse: `package.json` says
 * `0.0.1` and always has, so showing it would answer *"is the fix deployed?"*
 * confidently and wrongly.
 *
 * The obvious fix is `git rev-parse` inside the server. That is the one thing
 * this must not do. A production container has no `.git`, may not be allowed
 * to spawn, and would be describing a checkout rather than the artefact it is
 * running. So `git` is consulted **here**, at build time, where all three
 * assumptions hold — and the result is a file.
 *
 * ## It never fails the build
 *
 * Every lookup is allowed to come back empty. A missing stamp is a documented,
 * handled state (`resolveBuildInfo` → `source: "none"` with a reason); a build
 * that fell over because `git` was not on the PATH would be a worse outcome
 * than a screen that says it does not know. On this machine `git` is *not* on
 * the PATH — it ships with GitHub Desktop — which is exactly the case that
 * made this rule concrete rather than theoretical.
 *
 * ## Precedence
 *
 * Environment beats git, because a CI system knows the release tag and the
 * checkout does not. `resolveBuildInfo` then puts the environment ahead of
 * this file again at runtime, so a container built once and deployed twice
 * reports the deployment rather than the build.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(ROOT, "server", "build-info.json");

/** Runs a command and returns its trimmed output, or `null` for any failure. */
function tryCommand(command, args) {
  try {
    const out = execFileSync(command, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    const trimmed = out.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

/**
 * `git`, wherever it is.
 *
 * The bundled GitHub Desktop copy is tried after the PATH because a machine
 * that has both should use the one the developer configured. Both are allowed
 * to be absent.
 */
function gitCommit() {
  const direct = tryCommand("git", ["rev-parse", "HEAD"]);
  if (direct) return direct;

  const home = process.env.LOCALAPPDATA;
  if (!home) return null;
  // Not globbed: a wrong guess here costs a null, which is a handled state.
  for (const version of ["app-3.6.6", "app-3.6.5", "app-3.5.0"]) {
    const bundled = join(home, "GitHubDesktop", version, "resources", "app", "git", "cmd", "git.exe");
    const out = tryCommand(bundled, ["rev-parse", "HEAD"]);
    if (out) return out;
  }
  return null;
}

function packageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "server", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

const stamp = {
  /*
    `server/package.json` rather than the root one, deliberately.

    The root says `0.0.1` and is the *site* package; the server says `1.0.0`.
    Neither is a release number today, which is why the environment wins over
    both — but if a reader is going to see one of them, it should be the one
    that belongs to the thing being described.
  */
  version: process.env.APP_VERSION?.trim() || packageVersion(),
  commit: process.env.APP_COMMIT?.trim() || gitCommit(),
  builtAt: process.env.APP_BUILT_AT?.trim() || new Date().toISOString(),
};

writeFileSync(TARGET, `${JSON.stringify(stamp, null, 2)}\n`, "utf8");

const parts = [
  stamp.version ? `Version ${stamp.version}` : "ohne Version",
  stamp.commit ? `Commit ${stamp.commit.slice(0, 12)}` : "ohne Commit",
];
console.log(`Build-Stempel geschrieben: ${parts.join(", ")}.`);
