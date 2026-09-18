import { Badge, type BadgeTone } from "@/shared/ui/primitives";

/**
 * A job application's status: its labels, its tones, and the option list the
 * filter and the editor both use.
 *
 * One declaration, three consumers — the badge, the status filter on the list
 * and the select in the detail drawer. When the two were written out
 * separately the filter offered a status the badge had no label for, which is
 * the class of drift `entities/` exists to remove.
 */
const APPLICATION_TONES: Record<string, { tone: BadgeTone; label: string }> = {
  NEW: { tone: "navy", label: "Neu" },
  IN_REVIEW: { tone: "gold", label: "In Prüfung" },
  INTERVIEW: { tone: "water", label: "Gespräch" },
  HIRED: { tone: "energy", label: "Eingestellt" },
  REJECTED: { tone: "bronze", label: "Abgelehnt" },
  WITHDRAWN: { tone: "neutral", label: "Zurückgezogen" },
};

export function ApplicationBadge({ status }: { status: string }) {
  const meta = APPLICATION_TONES[status] ?? { tone: "neutral" as BadgeTone, label: status };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export const APPLICATION_STATUS_OPTIONS = Object.entries(APPLICATION_TONES).map(([value, m]) => ({
  value,
  label: m.label,
}));
