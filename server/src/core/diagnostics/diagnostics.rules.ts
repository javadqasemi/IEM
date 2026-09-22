/**
 * What a diagnostic check may say, and how the run as a whole is judged.
 *
 * Pure, so the verdict logic is testable without a database, a mail server or
 * a disk — which is the point: the checks themselves are I/O by definition and
 * the *interpretation* is where the mistakes are.
 */

export type CheckResult = "PASS" | "WARNING" | "FAIL" | "NOT_CONFIGURED";

export type DiagnosticCheck = {
  /** Stable identifier: `database`, `redis`, `mail`. Never translated. */
  key: string;
  /** What the row is called. */
  label: string;
  result: CheckResult;
  /** How long the check itself took. Part of the answer, not decoration. */
  durationMs: number;
  /**
   * One sentence an operator can act on — **never a raw error**.
   *
   * Everything reaching this field has passed through the relevant sanitizer:
   * `classifyMailError` for SMTP, `classifyBackupError`/`redactToolOutput`
   * for the Postgres tools. A diagnostics page that echoes the transport's own
   * message is the same disclosure as a log that does, one click further from
   * anybody thinking about it.
   */
  detail: string;
};

export type DiagnosticsRun = {
  startedAt: string;
  durationMs: number;
  result: CheckResult;
  checks: DiagnosticCheck[];
};

/**
 * How bad each result is, for the run's overall verdict.
 *
 * `NOT_CONFIGURED` ranks below `WARNING` for the reason
 * `core/health/health.ts` gives at more length: a deliberate absence is not a
 * fault, and ranking it above one would make an installation that has
 * consciously not enabled Redis report worse than one whose database is slow.
 */
const RANK: Record<CheckResult, number> = {
  PASS: 0,
  NOT_CONFIGURED: 1,
  WARNING: 2,
  FAIL: 3,
};

/**
 * The run's verdict: the worst check wins.
 *
 * An empty run is `WARNING`, not `PASS`. A diagnostics run that checked
 * nothing has established nothing, and the one thing it must not do is report
 * the same green a full pass does — that is the failure mode of every health
 * page that quietly stopped running its checks.
 */
export function overallResult(checks: readonly DiagnosticCheck[]): CheckResult {
  if (!checks.length) return "WARNING";
  return checks.reduce<CheckResult>(
    (worst, c) => (RANK[c.result] > RANK[worst] ? c.result : worst),
    "PASS",
  );
}

export function rankOf(result: CheckResult): number {
  return RANK[result];
}

/**
 * Wraps one check so a thrown error becomes a `FAIL` row rather than a 500.
 *
 * ---
 *
 * ## Why every check is individually contained
 *
 * A diagnostics page exists for the moment something is broken. If one broken
 * subsystem could take the whole run down, the page would be least useful
 * exactly when it is most needed — and the operator would see a generic error
 * instead of seven passes and one failure, which is the actually diagnostic
 * shape.
 *
 * The `sanitize` argument is required rather than defaulted. A default would
 * be a way to forget it, and what is being caught here is arbitrary — a
 * Postgres error carrying a connection string, an SMTP rejection carrying a
 * base64 credential.
 */
export async function runCheck(
  key: string,
  label: string,
  sanitize: (err: unknown) => string,
  fn: () => Promise<Omit<DiagnosticCheck, "key" | "label" | "durationMs">>,
): Promise<DiagnosticCheck> {
  const started = Date.now();
  try {
    const out = await fn();
    return { key, label, durationMs: Date.now() - started, ...out };
  } catch (err) {
    return {
      key,
      label,
      result: "FAIL",
      durationMs: Date.now() - started,
      detail: sanitize(err),
    };
  }
}

/**
 * A check that took longer than this is reported as slow even when it passed.
 *
 * Named rather than inlined because it is a judgement: five seconds is long
 * enough that no healthy local dependency reaches it and short enough that a
 * reader waiting for the page notices the same delay the number describes.
 */
export const SLOW_CHECK_MS = 5_000;

/** `PASS`, or `WARNING` when it passed but took too long to be reassuring. */
export function passOrSlow(durationMs: number, detail: string, slowDetail: string) {
  return durationMs > SLOW_CHECK_MS
    ? { result: "WARNING" as CheckResult, detail: slowDetail }
    : { result: "PASS" as CheckResult, detail };
}
