import { Badge, type BadgeTone } from "@/shared/ui/primitives";
import {
  DECISION_IMPACTS,
  DECISION_STATUSES,
  DECISION_TYPES,
  ITEM_KINDS,
  MEETING_STATUSES,
  MEETING_TYPES,
  type DecisionImpact,
  type DecisionStatus,
  type DecisionType,
  type MeetingItemKind,
  type MeetingStatus,
  type MeetingType,
} from "./types";

/**
 * Every enum this domain has, with its German label and its tone.
 *
 * One declaration per enum, and every consumer reads it: the badge, the filter
 * chips, the select in the form, the column in the table. The option lists at
 * the foot are built from the **union constants**, so a value added to the union
 * and forgotten here is a type error rather than a dropdown that quietly offers
 * four of five.
 */

const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  KICKOFF: "Kickoff",
  BAUSITZUNG: "Bausitzung",
  ABNAHME: "Abnahme",
  INTERN: "Intern",
  KUNDE: "Mit Kundschaft",
};

export function meetingTypeLabel(type: string): string {
  return MEETING_TYPE_LABELS[type as MeetingType] ?? type;
}

const MEETING_STATUS_TONES: Record<MeetingStatus, { tone: BadgeTone; label: string }> = {
  PLANNED: { tone: "neutral", label: "Geplant" },
  HELD: { tone: "navy", label: "Durchgeführt" },
  CANCELLED: { tone: "neutral", label: "Abgesagt" },
};

export function meetingStatusLabel(status: string): string {
  return MEETING_STATUS_TONES[status as MeetingStatus]?.label ?? status;
}

/** The badge tone, for a status shown outside `MeetingStatusBadge` — a transition dialog. */
export function meetingStatusTone(status: string): BadgeTone {
  return MEETING_STATUS_TONES[status as MeetingStatus]?.tone ?? "neutral";
}

export function MeetingStatusBadge({ status }: { status: string }) {
  const meta = MEETING_STATUS_TONES[status as MeetingStatus] ?? {
    tone: "neutral" as BadgeTone,
    label: status,
  };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/**
 * The state of the minutes, which is not the state of the meeting.
 *
 * Four things can be true of a held meeting — nothing written, written, sent,
 * approved — and only the last is a row in a table. A reader scanning a list
 * wants the one word that says where this protocol has got to, and assembling
 * it from three fields at every call site is three places that disagree.
 *
 * `null` for a meeting that has not happened: the minutes of a planned meeting
 * are not "pending", they do not exist, and a badge saying otherwise would put
 * every future Bausitzung in somebody's queue.
 */
export function minutesState(meeting: {
  status: string;
  minutesSentAt: Date | null;
  counts: { items: number; approvals: number };
}): { tone: BadgeTone; label: string } | null {
  if (meeting.status !== "HELD") return null;
  if (meeting.counts.approvals) return { tone: "energy", label: "Genehmigt" };
  if (meeting.minutesSentAt) return { tone: "water", label: "Versandt" };
  if (meeting.counts.items) return { tone: "gold", label: "Entwurf" };
  return { tone: "bronze", label: "Kein Protokoll" };
}

export function MinutesBadge({
  meeting,
}: {
  meeting: { status: string; minutesSentAt: Date | null; counts: { items: number; approvals: number } };
}) {
  const state = minutesState(meeting);
  if (!state) return null;
  return <Badge tone={state.tone}>{state.label}</Badge>;
}

/**
 * The three kinds of protocol line.
 *
 * **Marked, not coloured only.** A protocol is read as a document, often
 * printed, and the kind is what a reader scans for — so the label carries it
 * and the tone is a second, weaker signal.
 */
const ITEM_KIND_TONES: Record<MeetingItemKind, { tone: BadgeTone; label: string }> = {
  INFORMATION: { tone: "neutral", label: "Information" },
  ENTSCHEID: { tone: "navy", label: "Entscheid" },
  PENDENZ: { tone: "gold", label: "Pendenz" },
};

export function itemKindLabel(kind: string): string {
  return ITEM_KIND_TONES[kind as MeetingItemKind]?.label ?? kind;
}

export function ItemKindBadge({ kind }: { kind: string }) {
  const meta = ITEM_KIND_TONES[kind as MeetingItemKind] ?? {
    tone: "neutral" as BadgeTone,
    label: kind,
  };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const DECISION_STATUS_TONES: Record<DecisionStatus, { tone: BadgeTone; label: string }> = {
  OFFEN: { tone: "gold", label: "Offen" },
  ENTSCHIEDEN: { tone: "navy", label: "Entschieden" },
  UMGESETZT: { tone: "energy", label: "Umgesetzt" },
  /**
   * `bronze`, and it is the one tone choice worth arguing.
   *
   * A withdrawn decision is not an error and not a warning — it is a record
   * that has been replaced, and it stays readable because people cite it. Red
   * would make every historical reversal look like a problem on a page that is
   * mostly history.
   */
  AUFGEHOBEN: { tone: "bronze", label: "Aufgehoben" },
};

export function decisionStatusLabel(status: string): string {
  return DECISION_STATUS_TONES[status as DecisionStatus]?.label ?? status;
}

/** The badge tone, for a status shown outside `DecisionStatusBadge` — a transition dialog. */
export function decisionStatusTone(status: string): BadgeTone {
  return DECISION_STATUS_TONES[status as DecisionStatus]?.tone ?? "neutral";
}

export function DecisionStatusBadge({ status }: { status: string }) {
  const meta = DECISION_STATUS_TONES[status as DecisionStatus] ?? {
    tone: "neutral" as BadgeTone,
    label: status,
  };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const DECISION_TYPE_LABELS: Record<DecisionType, string> = {
  TECHNISCH: "Technisch",
  KOMMERZIELL: "Kommerziell",
  TERMIN: "Termin",
  GESTALTUNG: "Gestaltung",
  ORGANISATORISCH: "Organisatorisch",
};

export function decisionTypeLabel(type: string): string {
  return DECISION_TYPE_LABELS[type as DecisionType] ?? type;
}

const IMPACT_LABELS: Record<DecisionImpact, string> = {
  KOSTEN: "Kosten",
  TERMIN: "Termin",
  QUALITAET: "Qualität",
  KEINE: "Keine",
};

export function impactLabel(impact: string): string {
  return IMPACT_LABELS[impact as DecisionImpact] ?? impact;
}

/**
 * The impact, as the sentence it actually is.
 *
 * "Kosten · CHF 48'000 · 10 Tage" rather than three columns a reader assembles.
 * A decision's consequence is one fact with up to three parts, and the parts
 * that are unknown are simply absent — a dash for each would make an unpriced
 * decision look like a priced one with no figures.
 */
export function impactSummary(decision: {
  impact: string;
  costImpact: string | null;
  scheduleImpactDays: number | null;
}): string {
  if (decision.impact === "KEINE") return "Keine Auswirkung";

  const parts = [impactLabel(decision.impact)];
  if (decision.costImpact) {
    // The string the server sent, never parsed — see the note in `types.ts`.
    parts.push(`CHF ${formatDecimalString(decision.costImpact)}`);
  }
  if (decision.scheduleImpactDays !== null && decision.scheduleImpactDays !== 0) {
    const days = decision.scheduleImpactDays;
    parts.push(`${days > 0 ? "+" : ""}${days} Tag${Math.abs(days) === 1 ? "" : "e"}`);
  }
  return parts.join(" · ");
}

/**
 * A decimal string with Swiss thousands apostrophes, without parsing it.
 *
 * `"48000.00"` → `48'000.00`. Grouping the digits of a *string* keeps the
 * promise `types.ts` makes: the value is never a number, so nothing can add it
 * up in floating point. `Intl.NumberFormat` would require parsing it first.
 */
export function formatDecimalString(value: string): string {
  const negative = value.startsWith("-");
  const [whole, fraction] = (negative ? value.slice(1) : value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${negative ? "−" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/* ================================================================== */
/* Option lists                                                        */
/* ================================================================== */

export const MEETING_TYPE_OPTIONS = MEETING_TYPES.map((value) => ({
  value,
  label: meetingTypeLabel(value),
}));

export const MEETING_STATUS_OPTIONS = MEETING_STATUSES.map((value) => ({
  value,
  label: meetingStatusLabel(value),
}));

export const ITEM_KIND_OPTIONS = ITEM_KINDS.map((value) => ({
  value,
  label: itemKindLabel(value),
}));

export const DECISION_STATUS_OPTIONS = DECISION_STATUSES.map((value) => ({
  value,
  label: decisionStatusLabel(value),
}));

export const DECISION_TYPE_OPTIONS = DECISION_TYPES.map((value) => ({
  value,
  label: decisionTypeLabel(value),
}));

export const DECISION_IMPACT_OPTIONS = DECISION_IMPACTS.map((value) => ({
  value,
  label: impactLabel(value),
}));

/**
 * The statuses a decision still counts as live in.
 *
 * Exported so the filter and any count read one list — an "offen" that means
 * one thing in a chip and another in a badge is how a number stops matching the
 * rows beneath it.
 */
export const LIVE_DECISION_STATUSES: readonly DecisionStatus[] = [
  "OFFEN",
  "ENTSCHIEDEN",
  "UMGESETZT",
];
