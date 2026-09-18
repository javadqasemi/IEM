import { Badge, type BadgeTone } from "@/shared/ui/primitives";
import {
  DRAWING_FORMATS,
  DRAWING_STATUSES,
  DRAWING_TYPES,
  RECIPIENT_ROLES,
  REVISION_REASONS,
  SIA_PHASES,
  TRANSMITTAL_MEDIA,
  TRANSMITTAL_PURPOSES,
  type DrawingStatus,
  type DrawingType,
  type RecipientRole,
  type RevisionReason,
  type SiaPhase,
  type TransmittalMedium,
  type TransmittalPurpose,
} from "./types";

/**
 * Every enum this domain has, with its German label and its tone.
 *
 * One declaration per enum, and every consumer reads it: the badge, the filter
 * chips, the select in the form, the column in the table. The option lists at
 * the foot are built from the **union constants**, so a value added to the union
 * and forgotten here is a type error rather than a dropdown that quietly offers
 * seven of eight.
 */

const DRAWING_TYPE_LABELS: Record<DrawingType, string> = {
  GRUNDRISS: "Grundriss",
  SCHNITT: "Schnitt",
  ANSICHT: "Ansicht",
  SCHEMA: "Schema",
  PRINZIPSCHEMA: "Prinzipschema",
  DETAIL: "Detail",
  STRANGSCHEMA: "Strangschema",
  ISOMETRIE: "Isometrie",
};

export function drawingTypeLabel(type: string): string {
  return DRAWING_TYPE_LABELS[type as DrawingType] ?? type;
}

/**
 * The lifecycle, toned so the two that matter read differently at a glance.
 *
 * **`RELEASED` and `ISSUED` are deliberately not the same tone.** A released
 * plan is approved in-house; an issued one has left the building and somebody
 * is building from it. A register where those look alike is one where the
 * difference stops being noticed, which is the whole distinction the module
 * exists to keep.
 *
 * `SUPERSEDED` and `WITHDRAWN` are both `neutral`/`bronze` rather than red:
 * neither is an error. One is history and the other is a correction, and a
 * register that is mostly history should not look mostly broken.
 */
const DRAWING_STATUS_TONES: Record<DrawingStatus, { tone: BadgeTone; label: string }> = {
  WIP: { tone: "neutral", label: "In Arbeit" },
  IN_CHECK: { tone: "gold", label: "In Prüfung" },
  CHECKED: { tone: "water", label: "Geprüft" },
  RELEASED: { tone: "navy", label: "Freigegeben" },
  ISSUED: { tone: "energy", label: "Ausgegeben" },
  SUPERSEDED: { tone: "neutral", label: "Überholt" },
  WITHDRAWN: { tone: "bronze", label: "Zurückgezogen" },
};

export function drawingStatusLabel(status: string): string {
  return DRAWING_STATUS_TONES[status as DrawingStatus]?.label ?? status;
}

export function DrawingStatusBadge({ status }: { status: string }) {
  const meta = DRAWING_STATUS_TONES[status as DrawingStatus] ?? {
    tone: "neutral" as BadgeTone,
    label: status,
  };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/**
 * The revision letter, as the thing it is: a citation.
 *
 * Monospace and prefixed, because `Rev. C` is how it is written on the plan and
 * said out loud. A bare `C` in a table column is a letter nobody reads as a
 * revision.
 */
export function RevisionBadge({
  revision,
  superseded = false,
}: {
  revision: string | null;
  superseded?: boolean;
}) {
  if (!revision) {
    // Not a dash: a plan with no revision is a plan nobody has drawn yet, and
    // that is a state somebody acts on rather than a missing value.
    return <span className="text-[12px] text-muted">noch keine</span>;
  }
  return (
    <Badge tone={superseded ? "neutral" : "navy"} className="font-mono">
      Rev. {revision}
    </Badge>
  );
}

const REVISION_REASON_LABELS: Record<RevisionReason, string> = {
  ERSTAUSGABE: "Erstausgabe",
  KUNDENWUNSCH: "Kundenwunsch",
  KOORDINATION: "Koordination",
  FEHLERKORREKTUR: "Fehlerkorrektur",
  BEHOERDE: "Behörde",
  AUSFUEHRUNG: "Ausführung",
};

export function revisionReasonLabel(reason: string): string {
  return REVISION_REASON_LABELS[reason as RevisionReason] ?? reason;
}

const FORMAT_LABELS: Record<string, string> = Object.fromEntries(
  DRAWING_FORMATS.map((f) => [f, f === "SONDER" ? "Sonderformat" : f]),
);

export function formatLabel(format: string): string {
  return FORMAT_LABELS[format] ?? format;
}

const PHASE_LABELS: Record<SiaPhase, string> = {
  P31: "31 Vorprojekt",
  P32: "32 Bauprojekt",
  P33: "33 Bewilligung",
  P41: "41 Ausschreibung",
  P51: "51 Ausführungsprojekt",
  P52: "52 Ausführung",
  P53: "53 Inbetriebnahme",
};

export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase as SiaPhase] ?? phase;
}

/* ================================================================== */
/* Planversand                                                         */
/* ================================================================== */

const PURPOSE_LABELS: Record<TransmittalPurpose, string> = {
  ZUR_INFORMATION: "Zur Information",
  ZUR_PRUEFUNG: "Zur Prüfung",
  ZUR_AUSFUEHRUNG: "Zur Ausführung",
  ZUR_FREIGABE: "Zur Freigabe",
};

export function purposeLabel(purpose: string): string {
  return PURPOSE_LABELS[purpose as TransmittalPurpose] ?? purpose;
}

/**
 * Toned, because the purpose is the most consequential field on a Planversand.
 *
 * *Zur Ausführung* means somebody is building from it; *zur Information* does
 * not. Six months later that is the difference between a variation order and a
 * conversation, so the two do not look alike in a list.
 */
export function PurposeBadge({ purpose }: { purpose: string }) {
  const tone: BadgeTone =
    purpose === "ZUR_AUSFUEHRUNG" ? "energy" : purpose === "ZUR_FREIGABE" ? "navy" : "neutral";
  return <Badge tone={tone}>{purposeLabel(purpose)}</Badge>;
}

const MEDIUM_LABELS: Record<TransmittalMedium, string> = {
  EMAIL: "E-Mail",
  POST: "Post",
  PLATTFORM: "Plattform",
  UEBERGABE: "Übergabe",
};

export function mediumLabel(medium: string): string {
  return MEDIUM_LABELS[medium as TransmittalMedium] ?? medium;
}

const ROLE_LABELS: Record<RecipientRole, string> = { TO: "An", CC: "Kopie" };

export function recipientRoleLabel(role: string): string {
  return ROLE_LABELS[role as RecipientRole] ?? role;
}

/**
 * Whether a recipient has confirmed, as the **three-state** fact it is.
 *
 * `null` is "not confirmed" and not "did not receive" — the same distinction
 * `MeetingAttendee.attended` makes, and the reason this returns a tone rather
 * than a boolean. A Planversand that printed unconfirmed recipients as having
 * failed to receive would make a claim nobody checked.
 */
export function AcknowledgementBadge({ at }: { at: Date | null }) {
  if (!at) return <span className="text-[12px] text-muted">nicht bestätigt</span>;
  return <Badge tone="energy">Bestätigt</Badge>;
}

/* ================================================================== */
/* Option lists                                                        */
/* ================================================================== */

export const DRAWING_TYPE_OPTIONS = DRAWING_TYPES.map((value) => ({
  value,
  label: drawingTypeLabel(value),
}));

export const DRAWING_STATUS_OPTIONS = DRAWING_STATUSES.map((value) => ({
  value,
  label: drawingStatusLabel(value),
}));

export const DRAWING_FORMAT_OPTIONS = DRAWING_FORMATS.map((value) => ({
  value,
  label: formatLabel(value),
}));

export const REVISION_REASON_OPTIONS = REVISION_REASONS.map((value) => ({
  value,
  label: revisionReasonLabel(value),
}));

export const PHASE_OPTIONS = SIA_PHASES.map((value) => ({ value, label: phaseLabel(value) }));

export const TRANSMITTAL_PURPOSE_OPTIONS = TRANSMITTAL_PURPOSES.map((value) => ({
  value,
  label: purposeLabel(value),
}));

export const TRANSMITTAL_MEDIUM_OPTIONS = TRANSMITTAL_MEDIA.map((value) => ({
  value,
  label: mediumLabel(value),
}));

export const RECIPIENT_ROLE_OPTIONS = RECIPIENT_ROLES.map((value) => ({
  value,
  label: recipientRoleLabel(value),
}));

/**
 * The statuses a plan still counts as live in.
 *
 * Exported so a filter and any count read one list — a "laufend" that means one
 * thing in a chip and another in a badge is how a number stops matching the
 * rows beneath it.
 */
export const LIVE_DRAWING_STATUSES: readonly DrawingStatus[] = [
  "WIP",
  "IN_CHECK",
  "CHECKED",
  "RELEASED",
  "ISSUED",
];
