import { Badge, type BadgeTone } from "@/shared/ui/primitives";

/**
 * The content workflow's six states, with their German labels and tones.
 *
 * It lives in `entities/` rather than in `shared/ui` because it is *knowledge
 * about the domain*: that `APPROVED` reads "Freigegeben" and that it is a
 * calmer tone than `IN_REVIEW` are decisions about content review, not about
 * badges. `shared/ui/primitives/Badge` supplies the tone scale and holds no
 * opinion about what is being shown.
 *
 * The same six states are declared on the server in
 * `server/src/content/content.service.ts`; this is the presentation of them,
 * and the fallthrough below is deliberate — an unknown state renders its own
 * key rather than an empty badge, so a state added on one side is *visible*
 * rather than silently blank.
 */
const WORKFLOW_TONES: Record<string, { tone: BadgeTone; label: string }> = {
  DRAFT: { tone: "neutral", label: "Entwurf" },
  IN_REVIEW: { tone: "gold", label: "In Prüfung" },
  APPROVED: { tone: "water", label: "Freigegeben" },
  PUBLISHED: { tone: "energy", label: "Veröffentlicht" },
  REJECTED: { tone: "bronze", label: "Abgelehnt" },
  ARCHIVED: { tone: "neutral", label: "Archiviert" },
};

export function workflowLabel(state: string): string {
  return WORKFLOW_TONES[state]?.label ?? state;
}

/** The badge tone, for a state shown outside `WorkflowBadge` — a transition dialog. */
export function workflowTone(state: string): BadgeTone {
  return WORKFLOW_TONES[state]?.tone ?? "neutral";
}

export function WorkflowBadge({ state }: { state: string }) {
  const meta = WORKFLOW_TONES[state] ?? { tone: "neutral" as BadgeTone, label: state };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
