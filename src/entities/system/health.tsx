import { Badge, type BadgeTone } from "@/shared/ui/primitives";

/**
 * The one health vocabulary the dashboard speaks, and its badge.
 *
 * ---
 *
 * ## Why it is in `entities/` rather than in a feature
 *
 * Three features render this union — Mail, Sicherungen and now System — and
 * `architecture.test.ts` forbids a feature importing another feature, so
 * there is exactly one place it can live without being copied a third time.
 * That is what `entities/` is for: the vocabulary of the domain, above the
 * features and below the screens.
 *
 * The server made the same move in the same slice —
 * `server/src/core/health/health.ts` — and for the same reason. The union was
 * written out four times across the two halves and all four agreed, which is
 * precisely what made it worth fixing: they agreed by coincidence and nothing
 * compared them.
 *
 * ## What is shared and what is not
 *
 * | | |
 * | --- | --- |
 * | The **states** and their **labels** and **tones** | here, because a badge that says "Eingeschränkt" in amber must mean the same thing on every screen |
 * | The **explanatory sentence** | stays in the feature — "Es gibt fehlgeschlagene Zustellungen" is about mail and would be wrong under a backup card |
 *
 * That split is why `features/mail/service.ts` keeps its `describeState`: the
 * detail is genuinely domain copy, and hoisting it would have produced one
 * generic sentence that fits neither.
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
 * Label and tone per state.
 *
 * **`unknown` is `neutral`, deliberately not `energy`.** It is the state of
 * something configured and never tested, and drawing it green would be the
 * panel asserting a thing nobody has checked — which is the argument
 * `features/mail/types.ts` makes at length and the reason the union has five
 * values rather than three.
 *
 * `not_configured` is also neutral rather than amber: an absent integration
 * is not a fault, and amber on every development machine is how somebody
 * learns to ignore the colour that matters.
 */
export const HEALTH_META: Record<HealthState, { label: string; tone: BadgeTone }> = {
  healthy: { label: "Betriebsbereit", tone: "energy" },
  warning: { label: "Eingeschränkt", tone: "gold" },
  critical: { label: "Gestört", tone: "bronze" },
  not_configured: { label: "Nicht eingerichtet", tone: "neutral" },
  unknown: { label: "Ungeprüft", tone: "neutral" },
};

export function healthLabel(state: HealthState): string {
  return HEALTH_META[state]?.label ?? state;
}

/**
 * The badge.
 *
 * **The label is the information, not the colour.** Every state reads
 * correctly in monochrome, which is what stops the card being colour-only —
 * the accessibility rule `theme.contrast.test.ts` and the axe run both check
 * around, and neither can check that a reader who cannot distinguish amber
 * from green still learns anything.
 */
export function HealthBadge({ state }: { state: HealthState }) {
  const meta = HEALTH_META[state] ?? HEALTH_META.unknown;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/* ================================================================== */
/* Diagnostics                                                         */
/* ================================================================== */

export type CheckResult = "PASS" | "WARNING" | "FAIL" | "NOT_CONFIGURED";

export const CHECK_RESULTS: readonly CheckResult[] = [
  "PASS",
  "WARNING",
  "FAIL",
  "NOT_CONFIGURED",
] as const;

/**
 * A second four-valued vocabulary, and it is **not** the health union.
 *
 * They look close enough to merge and must not be. A health state describes a
 * subsystem's *standing condition*; a check result describes *one measurement
 * that just happened*. `unknown` is meaningful for the first and meaningless
 * for the second — a check that ran has a result by definition — and
 * collapsing them would mean inventing an "unknown" result for a check that
 * did run, or dropping a state the mail card needs.
 */
export const CHECK_META: Record<CheckResult, { label: string; tone: BadgeTone }> = {
  PASS: { label: "Bestanden", tone: "energy" },
  WARNING: { label: "Auffällig", tone: "gold" },
  FAIL: { label: "Fehlgeschlagen", tone: "bronze" },
  NOT_CONFIGURED: { label: "Nicht eingerichtet", tone: "neutral" },
};

export function CheckBadge({ result }: { result: CheckResult }) {
  const meta = CHECK_META[result] ?? CHECK_META.WARNING;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/* ================================================================== */
/* Jobs                                                                */
/* ================================================================== */

/**
 * The phase a job row shows, mirroring `core/jobs/jobs.rules.ts`.
 *
 * `RETRYING` is **derived server-side** from `QUEUED` plus a spent attempt —
 * it is not a database status, and the dashboard does not compute it. The
 * server sends `phase` beside `status` so the screen renders an answer rather
 * than deriving a second one that can disagree.
 */
export type JobPhase = "QUEUED" | "RETRYING" | "RUNNING" | "DONE" | "DEAD" | "CANCELLED";

export const JOB_PHASE_META: Record<JobPhase, { label: string; tone: BadgeTone }> = {
  QUEUED: { label: "Wartet", tone: "neutral" },
  RETRYING: { label: "Wiederholt", tone: "gold" },
  RUNNING: { label: "Läuft", tone: "water" },
  DONE: { label: "Erledigt", tone: "energy" },
  DEAD: { label: "Aufgegeben", tone: "bronze" },
  CANCELLED: { label: "Abgebrochen", tone: "neutral" },
};

export function JobPhaseBadge({ phase }: { phase: JobPhase }) {
  const meta = JOB_PHASE_META[phase] ?? JOB_PHASE_META.QUEUED;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/**
 * The German name of a job type.
 *
 * A map rather than the raw key, because `content.publishScheduled` in a
 * table cell tells an operator nothing they did not already have to know.
 * An unmapped name falls back to itself — which is visible, wrong enough to
 * notice and better than a blank cell, the same failure mode
 * `disciplineColour` chooses for an unknown Gewerk.
 */
export const JOB_LABELS: Record<string, string> = {
  "content.publishScheduled": "Zeitgesteuerte Veröffentlichung",
  "applications.purgeExpired": "Bewerbungen nach Frist löschen",
  "projects.reconcileDerived": "Projektkennzahlen neu berechnen",
  "tasks.flagOverdue": "Überfällige Aufgaben melden",
  "export.csv": "CSV-Export",
  "pdf.render": "PDF erzeugen",
  "bim.import": "BIM-Modell einlesen",
  "bim.analyse": "BIM-Modell prüfen",
  "backup.create": "Sicherung erstellen",
  "backup.verify": "Sicherung prüfen",
  "backup.retention": "Sicherungen aufräumen",
  "backup.restore": "Sicherung einspielen",
  "reminder.send": "Erinnerung senden",
  "report.run": "Bericht erstellen",
  "notification.digest": "Benachrichtigungs-Zusammenfassung",
  "sync.run": "Abgleich ausführen",
  "notification.deliver": "Benachrichtigung zustellen",
};

export function jobLabel(name: string): string {
  return JOB_LABELS[name] ?? name;
}
