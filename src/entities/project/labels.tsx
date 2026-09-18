import { Badge, type BadgeTone } from "@/shared/ui/primitives";
import {
  DISCIPLINE_SCOPE_STATUSES,
  MEMBER_ROLES,
  MILESTONE_STATUSES,
  PRIORITIES,
  PROJECT_STATUSES,
  SIA_PHASES,
  type DisciplineScopeStatus,
  type MemberRole,
  type MilestoneStatus,
  type Priority,
  type ProjectHealth,
  type ProjectStatus,
  type SiaPhase,
} from "./types";

/**
 * Every enum this domain has, with its German label and its tone.
 *
 * One declaration per enum, and every consumer reads it: the badge, the filter
 * chips, the select in the form, the column in the table. When two of those
 * were written out separately in the applications feature the filter offered a
 * status the badge had no label for — that drift is what `entities/` removes.
 *
 * The option lists at the foot are built from the **union constants**, not from
 * these tables' own keys, so a value added to the union and forgotten here is a
 * type error on the table rather than a dropdown that quietly offers five of
 * six.
 */

const PROJECT_TONES: Record<ProjectStatus, { tone: BadgeTone; label: string }> = {
  PLANNED: { tone: "neutral", label: "Geplant" },
  ACTIVE: { tone: "navy", label: "Laufend" },
  ON_HOLD: { tone: "gold", label: "Pausiert" },
  COMPLETED: { tone: "energy", label: "Abgeschlossen" },
  ARCHIVED: { tone: "bronze", label: "Archiviert" },
  CANCELLED: { tone: "neutral", label: "Abgebrochen" },
};

export function projectStatusLabel(status: string): string {
  return PROJECT_TONES[status as ProjectStatus]?.label ?? status;
}

export function ProjectStatusBadge({ status }: { status: string }) {
  const meta = PROJECT_TONES[status as ProjectStatus] ?? {
    tone: "neutral" as BadgeTone,
    label: status,
  };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/**
 * Health, as a dot with a written label beside it.
 *
 * **Never colour alone.** Red/amber/green is the one encoding that fails for
 * roughly one man in twelve, and "which projects are in trouble" is exactly the
 * question this answers. The dot carries the colour, the text carries the
 * meaning, and the `title` carries it again for a screen reader — which is also
 * what keeps the axe pass clean.
 */
/**
 * The one place a literal colour is right, and it is worth saying why.
 *
 * Everything else in this codebase resolves a **token**, so the palette can
 * change in one file and both themes follow. A traffic light is the exception:
 * red/amber/green is a convention older than the brand, it means the same thing
 * on a site hoarding as on a screen, and re-toning it to the house palette
 * would make "kritisch" a shade of bronze that nobody reads as an alarm. The
 * colour here is the meaning rather than the style.
 *
 * It is safe from the contrast rules precisely because the label carries the
 * information: the dot is `aria-hidden`, the words are the content, and axe
 * measures the words.
 */
const HEALTH_META: Record<ProjectHealth, { dot: string; label: string }> = {
  GREEN: { dot: "bg-emerald-500", label: "Im Plan" },
  AMBER: { dot: "bg-amber-500", label: "Beobachten" },
  RED: { dot: "bg-rose-500", label: "Kritisch" },
};

export function projectHealthLabel(health: string): string {
  return HEALTH_META[health as ProjectHealth]?.label ?? health;
}

export function ProjectHealthDot({ health, showLabel = true }: { health: string; showLabel?: boolean }) {
  const meta = HEALTH_META[health as ProjectHealth] ?? { dot: "bg-slate-400", label: health };
  return (
    <span className="inline-flex items-center gap-2" title={meta.label}>
      <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
      {showLabel ? <span>{meta.label}</span> : <span className="sr-only">{meta.label}</span>}
    </span>
  );
}

/**
 * The Gewerk colours, and they are a **closed set of six**.
 *
 * `src/content/schema.ts` already states this rule for the public site: the
 * tokens are declared in `admin.css` for both themes and checked for contrast
 * by `theme.contrast.test.ts`, so a seventh name resolves to nothing and
 * renders as a transparent dot rather than failing anywhere.
 *
 * They cannot be Tailwind classes here even though `text-disc-air` exists.
 * The name arrives from the database, so `bg-${colour}` is a string Tailwind
 * never sees in a content file and therefore purges — the class would be
 * missing in the build and present in dev, which is the worst of both. The CSS
 * variable is the same value by a route that survives purging.
 */
export const DISCIPLINE_COLOURS = [
  "disc-heat",
  "disc-air",
  "disc-water",
  "disc-power",
  "disc-energy",
  "disc-model",
] as const;

export type DisciplineColour = (typeof DISCIPLINE_COLOURS)[number];

/**
 * A CSS colour for a token name, or `currentColor` for one we do not know.
 *
 * `currentColor` rather than a grey: an unknown token is a bug, and inheriting
 * the text colour makes the dot visible in both themes while looking wrong
 * enough to notice. A silent grey would look deliberate.
 */
export function disciplineColour(token: string): string {
  return (DISCIPLINE_COLOURS as readonly string[]).includes(token)
    ? `rgb(var(--c-${token}))`
    : "currentColor";
}

/**
 * The dot beside a Gewerk's code.
 *
 * `aria-hidden`, always: the code and the name stand next to it and carry the
 * meaning. Colour never carries it alone — a Lüftung run being blue is a
 * convenience for people who can see it, not information.
 */
export function DisciplineDot({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: disciplineColour(colour) }}
    />
  );
}

const PRIORITY_TONES: Record<Priority, { tone: BadgeTone; label: string }> = {
  LOW: { tone: "neutral", label: "Tief" },
  MEDIUM: { tone: "water", label: "Mittel" },
  HIGH: { tone: "gold", label: "Hoch" },
  URGENT: { tone: "bronze", label: "Dringend" },
};

export function priorityLabel(priority: string): string {
  return PRIORITY_TONES[priority as Priority]?.label ?? priority;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const meta = PRIORITY_TONES[priority as Priority] ?? {
    tone: "neutral" as BadgeTone,
    label: priority,
  };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/**
 * SIA 112, with the phase names the firm uses.
 *
 * The code is kept in the label — `P41 · Ausschreibung` — because the code is
 * what appears on drawings, in e-mails and in the contract. Showing only the
 * German name would mean translating back every time somebody cross-checks.
 */
const PHASE_NAMES: Record<SiaPhase, string> = {
  P31: "Vorprojekt",
  P32: "Bauprojekt",
  P33: "Bewilligungsverfahren",
  P41: "Ausschreibung",
  P51: "Ausführungsprojekt",
  P52: "Ausführung",
  P53: "Inbetriebnahme",
};

export function phaseLabel(phase: string | null): string {
  if (!phase) return "—";
  const name = PHASE_NAMES[phase as SiaPhase];
  return name ? `${phase} · ${name}` : phase;
}

const MILESTONE_TONES: Record<MilestoneStatus, { tone: BadgeTone; label: string }> = {
  OPEN: { tone: "neutral", label: "Offen" },
  AT_RISK: { tone: "gold", label: "Gefährdet" },
  MET: { tone: "energy", label: "Erreicht" },
  MISSED: { tone: "bronze", label: "Verpasst" },
  WAIVED: { tone: "water", label: "Erlassen" },
};

export function milestoneLabel(status: string): string {
  return MILESTONE_TONES[status as MilestoneStatus]?.label ?? status;
}

export function MilestoneBadge({ status }: { status: string }) {
  const meta = MILESTONE_TONES[status as MilestoneStatus] ?? {
    tone: "neutral" as BadgeTone,
    label: status,
  };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const ROLE_LABELS: Record<MemberRole, string> = {
  MANAGER: "Projektleitung",
  ENGINEER: "Ingenieur:in",
  DRAFTSMAN: "Zeichner:in",
  CONSULTANT: "Fachberatung",
  APPRENTICE: "Lernende:r",
};

export function memberRoleLabel(role: string): string {
  return ROLE_LABELS[role as MemberRole] ?? role;
}

const SCOPE_LABELS: Record<DisciplineScopeStatus, string> = {
  PLANNED: "Geplant",
  ACTIVE: "Laufend",
  ON_HOLD: "Pausiert",
  COMPLETED: "Abgeschlossen",
  NOT_IN_SCOPE: "Nicht beauftragt",
};

export function scopeStatusLabel(status: string): string {
  return SCOPE_LABELS[status as DisciplineScopeStatus] ?? status;
}

/* ---- Option lists, built from the unions -------------------------- */

export const PROJECT_STATUS_OPTIONS = PROJECT_STATUSES.map((value) => ({
  value,
  label: PROJECT_TONES[value].label,
}));

export const PRIORITY_OPTIONS = PRIORITIES.map((value) => ({
  value,
  label: PRIORITY_TONES[value].label,
}));

export const SIA_PHASE_OPTIONS = SIA_PHASES.map((value) => ({
  value,
  label: `${value} · ${PHASE_NAMES[value]}`,
}));

export const MILESTONE_STATUS_OPTIONS = MILESTONE_STATUSES.map((value) => ({
  value,
  label: MILESTONE_TONES[value].label,
}));

export const MEMBER_ROLE_OPTIONS = MEMBER_ROLES.map((value) => ({
  value,
  label: ROLE_LABELS[value],
}));

export const SCOPE_STATUS_OPTIONS = DISCIPLINE_SCOPE_STATUSES.map((value) => ({
  value,
  label: SCOPE_LABELS[value],
}));
