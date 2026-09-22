import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Who this running copy is: version, commit, build time, environment.
 *
 * ---
 *
 * ## The open half of P1-3, and why it stayed open
 *
 * `/dashboard/system` has reported `version: null` since P1-1, with a reason
 * beside it — *"Kein Build-Stempel"*. That was the right answer and a
 * deliberately temporary one: `package.json` says `0.0.1` and has said so
 * since the first commit, so returning it would be a number that never
 * changes shown in the place a reader looks for one that does. An operator
 * asking *"is the fix deployed?"* would get a confident wrong answer.
 *
 * ## Three sources, in order, and none of them is `git`
 *
 * 1. **The environment** — `APP_VERSION`, `APP_COMMIT`, `APP_BUILT_AT`. This
 *    is what a container deployment sets, and it is first because it is the
 *    only one that can be right when the image was built elsewhere.
 * 2. **A stamp file** written at build time by `scripts/stamp-build.mjs`.
 * 3. **Nothing**, reported as nothing with a reason.
 *
 * `git` is deliberately absent from that list at *runtime*. Shelling out to
 * `git rev-parse` in production means the deployment carries a `.git`
 * directory, the process can spawn, and the answer describes the checkout
 * rather than the artefact — three assumptions that are each false in an
 * ordinary container. The stamp script runs `git` at **build** time, where
 * all three hold.
 *
 * ## It never guesses
 *
 * A missing commit is `null` with `reason` saying so, exactly as before. The
 * point of this file is not to always have an answer; it is to stop the
 * system inventing one.
 */

export type BuildInfo = {
  /** Semantic version, from the deployment or the stamp. Never `package.json`. */
  version: string | null;
  /** Short commit SHA. */
  commit: string | null;
  /** ISO-8601, when the artefact was built — not when the process started. */
  builtAt: string | null;
  /** `development`, `production`, whatever `NODE_ENV` says. Always present. */
  environment: string;
  /** Where the three above came from, for a reader who doubts them. */
  source: "environment" | "stamp" | "none";
  /** Why they are absent, when they are. `null` once something is known. */
  reason: string | null;
};

const MISSING_REASON =
  "Kein Build-Stempel. Setzen Sie APP_VERSION/APP_COMMIT/APP_BUILT_AT beim Deployment " +
  "oder führen Sie `npm run stamp` vor dem Build aus.";

/** The file `scripts/stamp-build.mjs` writes. Gitignored, absent in development. */
export const STAMP_FILE = "build-info.json";

type Env = Record<string, string | undefined>;

/**
 * Trims and rejects the empty string.
 *
 * `APP_COMMIT=""` is what a CI template produces when the variable was not
 * substituted, and it is *not* a commit. Treating it as one would put an empty
 * badge on the screen where a SHA belongs.
 */
function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * A commit as it should be displayed: the first twelve characters.
 *
 * Long enough to be unambiguous in any repository this firm will have, short
 * enough to sit in a table cell. Not validated as hexadecimal — a deployment
 * may legitimately stamp a tag or a build number here, and refusing it would
 * make the field less useful than the free text it replaced.
 */
export function shortCommit(commit: string | null): string | null {
  if (!commit) return null;
  return commit.length > 12 ? commit.slice(0, 12) : commit;
}

/**
 * Reads the identity from an environment and an optional stamp.
 *
 * Pure, and takes both inputs, so `build-info.test.ts` can assert the
 * precedence without a filesystem or a `process.env` it has to restore.
 */
export function resolveBuildInfo(env: Env, stamp: Partial<BuildInfo> | null): BuildInfo {
  const environment = clean(env.NODE_ENV) ?? "development";

  const fromEnv = {
    version: clean(env.APP_VERSION),
    commit: clean(env.APP_COMMIT),
    builtAt: clean(env.APP_BUILT_AT),
  };
  if (fromEnv.version || fromEnv.commit || fromEnv.builtAt) {
    return {
      ...fromEnv,
      commit: shortCommit(fromEnv.commit),
      environment,
      source: "environment",
      reason: null,
    };
  }

  const fromStamp = {
    version: clean(stamp?.version ?? undefined),
    commit: clean(stamp?.commit ?? undefined),
    builtAt: clean(stamp?.builtAt ?? undefined),
  };
  if (fromStamp.version || fromStamp.commit || fromStamp.builtAt) {
    return {
      ...fromStamp,
      commit: shortCommit(fromStamp.commit),
      environment,
      source: "stamp",
      reason: null,
    };
  }

  return {
    version: null,
    commit: null,
    builtAt: null,
    environment,
    source: "none",
    reason: MISSING_REASON,
  };
}

/**
 * Reads the stamp file, or `null`.
 *
 * Never throws: an absent file is the normal case in development, and a
 * malformed one must not stop the application booting over a cosmetic field.
 */
export function readStamp(dir: string): Partial<BuildInfo> | null {
  try {
    const raw = readFileSync(join(dir, STAMP_FILE), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Partial<BuildInfo>;
  } catch {
    return null;
  }
}

/**
 * The identity of this process, computed once.
 *
 * Cached because none of the three inputs can change while the process runs,
 * and the System overview polls.
 */
let cached: BuildInfo | null = null;

export function buildInfo(env: Env = process.env, dir = process.cwd()): BuildInfo {
  if (cached) return cached;
  cached = resolveBuildInfo(env, readStamp(dir));
  return cached;
}

/** Tests only: forgets the cache so a second environment can be measured. */
export function resetBuildInfo(): void {
  cached = null;
}
