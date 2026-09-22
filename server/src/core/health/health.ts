/**
 * One vocabulary for "is this subsystem all right", and the arithmetic over it.
 *
 * ---
 *
 * ## Why this file exists rather than a fifth copy
 *
 * The five-valued union below was declared **four times** before P2-6 —
 * `mail/mail.status.service.ts`, `core/backup/backup.status.service.ts`, and
 * the two client mirrors in `features/mail/types.ts` and
 * `features/backup/types.ts`. All four agreed, which is exactly what makes it
 * worth fixing now: they agreed by coincidence, nothing compared them, and the
 * System Control Center would have been the fifth.
 *
 * The failure that shape produces is not a type error. It is a sixth module
 * adding `degraded` beside `warning`, a badge that falls through to its
 * default tone, and an operator learning that one screen's amber means
 * something different from another's.
 *
 * ## The five values, and why none of them is `ok`
 *
 * | | |
 * | --- | --- |
 * | `healthy` | checked, and the check passed |
 * | `warning` | working, with something an operator should look at |
 * | `critical` | not working |
 * | `not_configured` | nothing to check — no server, no schedule, no integration |
 * | `unknown` | configured and **never proven** |
 *
 * `unknown` is the one that earns the union. `MailStatusService` explains it
 * best: a mail server that is configured and has never been tested is the
 * common case, most dashboards draw it green, and a green light meaning "the
 * fields are filled in" teaches an operator that green means nothing. It is
 * deliberately not `healthy` and deliberately not `warning` — nobody has done
 * anything wrong, we simply do not know.
 */

export type HealthState =
  | "healthy"
  | "warning"
  | "critical"
  | "not_configured"
  | "unknown";

export const HEALTH_STATES: readonly HealthState[] = [
  "healthy",
  "warning",
  "critical",
  "not_configured",
  "unknown",
] as const;

/**
 * How bad each state is, for `worstOf`.
 *
 * **`not_configured` ranks below `unknown`, and that ordering is a decision.**
 * An unconfigured subsystem is a deliberate absence — there is no SMTP server
 * because nobody set one up — whereas `unknown` is a configured thing nobody
 * has checked, which is a smaller question but still an open one. Ranking
 * absence above it would make an installation that has deliberately not
 * enabled backups report worse overall than one whose backups might be broken,
 * which is the wrong way round for the person reading the top of the page.
 *
 * `healthy` is 0 so that an all-green system is 0.
 */
const SEVERITY: Record<HealthState, number> = {
  healthy: 0,
  not_configured: 1,
  unknown: 2,
  warning: 3,
  critical: 4,
};

export function severityOf(state: HealthState): number {
  return SEVERITY[state] ?? SEVERITY.unknown;
}

/**
 * The overall verdict across subsystems: the worst one wins.
 *
 * ---
 *
 * ## Why this is a maximum and not a score
 *
 * The obvious alternative is a percentage — *System Health: 93%* — and it is
 * the thing this function exists to refuse. A percentage is unactionable by
 * construction: it cannot be acted on without expanding it back into the list
 * it was computed from, it moves when nothing an operator cares about has
 * changed, and 93% reads as "fine" on the morning the backups stopped.
 *
 * A maximum plus **the reasons** is the same information, minus the
 * arithmetic that destroyed it. `overallHealth` returns both.
 *
 * An empty list is `unknown`, never `healthy`: a system reporting on nothing
 * has not established that anything works.
 */
export function worstOf(states: readonly HealthState[]): HealthState {
  if (!states.length) return "unknown";
  return states.reduce((worst, s) => (severityOf(s) > severityOf(worst) ? s : worst), "healthy" as HealthState);
}

/** One subsystem's verdict, with what to do about it. */
export type HealthSubject = {
  /** Stable identifier — `jobs`, `database`, `mail`. Never translated. */
  key: string;
  /** What the card is called. German, because the dashboard is. */
  label: string;
  state: HealthState;
  /**
   * Why it is not `healthy`, in words an operator can act on.
   *
   * Empty for a healthy subject. **Never a restatement of the state** — "Mail
   * ist im Zustand Warnung" tells the reader what the badge beside it already
   * says. A reason is *"3 Zustellungen fehlgeschlagen"* or *"Letzte Sicherung
   * ist 9 Tage alt"*.
   */
  reasons: string[];
  /** Where to go and do something about it. A dashboard hash route, or null. */
  link: string | null;
};

export type HealthReport = {
  state: HealthState;
  /** The flattened reasons of every subject that is not healthy. */
  reasons: string[];
  subjects: HealthSubject[];
};

/**
 * Rolls subjects up into one verdict plus a flat list of reasons.
 *
 * The reasons are prefixed with their subject's label, because the overall
 * banner shows them detached from the cards they came from and *"3
 * fehlgeschlagen"* on its own is not an actionable sentence.
 */
export function overallHealth(subjects: readonly HealthSubject[]): HealthReport {
  const state = worstOf(subjects.map((s) => s.state));
  const reasons = subjects
    .filter((s) => s.state !== "healthy")
    .flatMap((s) => s.reasons.map((r) => `${s.label}: ${r}`));
  return { state, reasons, subjects: [...subjects] };
}

/**
 * The age of something, in whole days, or `null` when it never happened.
 *
 * Shared because three subjects ask it — the last backup, the last delivered
 * mail, the last publish — and three copies of a date subtraction is three
 * chances to get the sign wrong.
 */
export function daysSince(at: Date | string | null, now: Date = new Date()): number | null {
  if (!at) return null;
  const then = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}
