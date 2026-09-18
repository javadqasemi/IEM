import { Badge, type BadgeTone } from "@/shared/ui/primitives";
import { APPLICATION_STATUSES, type ApplicationStatus } from "./types";

/**
 * A job application's status: its labels, its tones, and the option list the
 * filter and the editor both use.
 *
 * One declaration, three consumers — the badge, the status filter on the list
 * and the select in the detail drawer. When the two were written out
 * separately the filter offered a status the badge had no label for, which is
 * the class of drift `entities/` exists to remove.
 */
const APPLICATION_TONES: Record<ApplicationStatus, { tone: BadgeTone; label: string }> = {
  NEW: { tone: "navy", label: "Neu" },
  IN_REVIEW: { tone: "gold", label: "In Prüfung" },
  INTERVIEW: { tone: "water", label: "Gespräch" },
  HIRED: { tone: "energy", label: "Eingestellt" },
  REJECTED: { tone: "bronze", label: "Abgelehnt" },
  WITHDRAWN: { tone: "neutral", label: "Zurückgezogen" },
};

export function applicationLabel(status: string): string {
  return APPLICATION_TONES[status as ApplicationStatus]?.label ?? status;
}

export function ApplicationBadge({ status }: { status: string }) {
  const meta = APPLICATION_TONES[status as ApplicationStatus] ?? {
    tone: "neutral" as BadgeTone,
    label: status,
  };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/**
 * Built from `APPLICATION_STATUSES` rather than from the tone table's own keys,
 * so the option list and the union cannot drift: a status added to the union
 * and forgotten here is a type error on `APPLICATION_TONES`, not a filter that
 * quietly offers five of six.
 */
export const APPLICATION_STATUS_OPTIONS = APPLICATION_STATUSES.map((value) => ({
  value,
  label: APPLICATION_TONES[value].label,
}));
