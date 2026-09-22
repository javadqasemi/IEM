import type { HealthState } from "@/entities/system";
import type { HealthReport, JobRow, SystemOverview } from "./types";

/**
 * Everything the System screens decide that is arithmetic rather than I/O.
 *
 * Pure and exported, so `__tests__/service.test.ts` can assert it without a
 * server. The rule this follows is the one the whole slice follows: **the
 * screen renders an answer, it does not compute a second one.** Every verdict
 * here is a presentation decision — an ordering, a sentence, a unit — and
 * never a re-derivation of something the server already said.
 */

/* ================================================================== */
/* Ordering                                                            */
/* ================================================================== */

/**
 * How bad each state is, for sorting cards.
 *
 * The same ranking the server uses in `core/health/health.ts`, and it is
 * duplicated here **knowingly**: the server needs it to pick a worst and the
 * client needs it to order a grid, the two are four lines each, and an
 * endpoint returning a sort order for a CSS grid would be worse than the
 * duplication. `service.test.ts` pins the order so a divergence is a failing
 * test rather than a screen that quietly puts the broken card last.
 */
const SEVERITY: Record<HealthState, number> = {
  critical: 0,
  warning: 1,
  unknown: 2,
  not_configured: 3,
  healthy: 4,
};

/**
 * Worst first.
 *
 * A grid in fixed order looks tidy and buries the one card that matters on a
 * bad day. Ties keep their original order, so an all-healthy system reads in
 * the order the server declared rather than shuffling between polls.
 */
export function sortSubjects<T extends { state: HealthState }>(subjects: readonly T[]): T[] {
  return [...subjects].sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state]);
}

export function severityOf(state: HealthState): number {
  return SEVERITY[state] ?? SEVERITY.unknown;
}

/* ================================================================== */
/* The banner                                                          */
/* ================================================================== */

/**
 * The one sentence at the top of the page.
 *
 * **There is no percentage here and there will not be one.** A score is
 * unactionable by construction — it cannot be used without expanding it back
 * into the list it came from, and 93 % reads as "fine" on the morning the
 * backups stopped. The reasons *are* the summary.
 */
export function summarise(health: HealthReport): { headline: string; tone: HealthState } {
  const n = health.reasons.length;
  if (health.state === "healthy") {
    return { headline: "Alle Teilsysteme betriebsbereit.", tone: "healthy" };
  }
  if (n === 0) {
    // Possible and worth handling: a subsystem can be `not_configured` with
    // nothing to say about it. A banner claiming a problem with no reason
    // under it would send somebody looking for a list that is not there.
    return { headline: "Nicht alle Teilsysteme sind eingerichtet.", tone: health.state };
  }
  return {
    headline: n === 1 ? "1 Punkt braucht Aufmerksamkeit." : `${n} Punkte brauchen Aufmerksamkeit.`,
    tone: health.state,
  };
}

/* ================================================================== */
/* Formatting                                                          */
/* ================================================================== */

/** `3 d 04:12` — a process that has been up for weeks should read as weeks. */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const hhmm = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return days > 0 ? `${days} d ${hhmm}` : hhmm;
}

/**
 * A duration in the unit a reader can compare.
 *
 * Milliseconds below a second, seconds above — a job that took `184000 ms`
 * is a number nobody converts in their head while scanning a table.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes} min ${seconds} s`;
}

/**
 * `2 von 3` — attempts against the ceiling.
 *
 * Both numbers, always. "Versuch 2" alone does not say whether the next
 * failure is the last one, which is the only reason a reader is looking.
 */
export function formatAttempts(job: Pick<JobRow, "attempts" | "maxAttempts">): string {
  return `${job.attempts} von ${job.maxAttempts}`;
}

/* ================================================================== */
/* Build identity                                                      */
/* ================================================================== */

/**
 * What the version row says.
 *
 * Three shapes, and the third is the point: when nothing stamped the build,
 * this returns the server's own reason rather than a version. The rule the
 * executive dashboard's `missingMetrics` established — **say what you do not
 * know** — applied to the field most likely to be faked.
 */
export function describeBuild(build: SystemOverview["build"]): {
  known: boolean;
  version: string;
  detail: string;
} {
  if (build.source === "none") {
    return { known: false, version: "Unbekannt", detail: build.reason ?? "" };
  }
  const parts: string[] = [];
  if (build.commit) parts.push(`Commit ${build.commit}`);
  if (build.builtAt) parts.push(`gebaut am ${build.builtAt.slice(0, 10)}`);
  parts.push(build.source === "environment" ? "aus der Umgebung" : "aus dem Build-Stempel");
  return {
    known: true,
    version: build.version ?? "ohne Versionsnummer",
    detail: parts.join(" · "),
  };
}

/* ================================================================== */
/* Migration status                                                    */
/* ================================================================== */

/**
 * The migration row's own verdict.
 *
 * `mismatch` is `critical` and not a warning: a migration that started and
 * never finished means the schema is **partly** applied, which is the one
 * database condition where continuing to write is worse than stopping.
 */
export function describeMigrations(m: SystemOverview["database"]["migrations"]): {
  state: HealthState;
  label: string;
  detail: string;
} {
  if (m.status === "mismatch") {
    return {
      state: "critical",
      label: "Unvollständig",
      detail: `${m.pending} Migration(en) begonnen und nicht abgeschlossen. Das Schema ist nicht vollständig angewendet.`,
    };
  }
  if (m.status === "unknown") {
    return {
      state: "unknown",
      label: "Unbekannt",
      detail:
        "Es gibt keine `_prisma_migrations`-Tabelle. Die Datenbank wurde vermutlich mit `db push` " +
        "eingerichtet statt mit Migrationen.",
    };
  }
  return {
    state: "healthy",
    label: "Aktuell",
    detail: `${m.applied} Migration(en) angewendet${m.latest ? `, zuletzt „${m.latest}“` : ""}.`,
  };
}
