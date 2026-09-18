import { Badge, type BadgeTone } from "@/shared/ui/primitives";
import {
  BOARD_COLUMNS,
  DEPENDENCY_TYPES,
  TASK_STATUSES,
  type BoardColumn,
  type DependencyType,
  type TaskStatus,
} from "./types";

/**
 * Every enum this domain has, with its German label and its tone.
 *
 * One declaration per enum, and every consumer reads it: the badge, the board
 * column heading, the filter chips, the select in the form. When two of those
 * were written out separately in the applications feature the filter offered a
 * status the badge had no label for — that drift is what `entities/` removes.
 *
 * The option lists at the foot are built from the **union constants**, not from
 * these tables' own keys, so a value added to the union and forgotten here is a
 * type error on the table rather than a dropdown that quietly offers five of
 * six.
 */

const STATUS_TONES: Record<TaskStatus, { tone: BadgeTone; label: string }> = {
  TODO: { tone: "neutral", label: "Offen" },
  IN_PROGRESS: { tone: "navy", label: "In Arbeit" },
  IN_REVIEW: { tone: "water", label: "In Prüfung" },
  DONE: { tone: "energy", label: "Erledigt" },
  /**
   * `gold`, not a red tone.
   *
   * Blocked is a *state somebody chose to record*, usually while waiting on
   * somebody outside the firm — it is not a failure, and toning it as one makes
   * a board look alarming on a perfectly ordinary Tuesday. Red is reserved for
   * overdue, which is the thing that actually needs acting on.
   */
  BLOCKED: { tone: "gold", label: "Blockiert" },
  CANCELLED: { tone: "neutral", label: "Abgebrochen" },
};

export function taskStatusLabel(status: string): string {
  return STATUS_TONES[status as TaskStatus]?.label ?? status;
}

export function TaskStatusBadge({ status }: { status: string }) {
  const meta = STATUS_TONES[status as TaskStatus] ?? {
    tone: "neutral" as BadgeTone,
    label: status,
  };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/**
 * The overdue marker.
 *
 * **Words, not only colour**, for the reason `ProjectHealthDot` gives: a
 * red/amber encoding fails for roughly one man in twelve, and "what is late" is
 * exactly the question this answers. The dot carries the colour, the text
 * carries the meaning, and axe measures the text.
 *
 * It renders nothing when the task is not overdue rather than an empty span —
 * an "on time" badge on every one of forty cards is noise that makes the six
 * that matter harder to find.
 */
export function OverdueBadge({ overdue, days }: { overdue: boolean; days?: number | null }) {
  if (!overdue) return null;
  const suffix = typeof days === "number" && days > 0 ? ` · ${days} Tag${days === 1 ? "" : "e"}` : "";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-rose-500" />
      <span>Überfällig{suffix}</span>
    </span>
  );
}

/**
 * The four precedence types, spelled out.
 *
 * The two-letter codes are what a Bauprogramm and every planning tool use, so
 * they stay — but on their own they are unreadable to anybody who has not used
 * one, and the whole point of the four is that they mean different things.
 * `FS · Ende → Start` is both.
 */
const DEPENDENCY_LABELS: Record<DependencyType, { label: string; hint: string }> = {
  FS: { label: "FS · Ende → Start", hint: "Beginnt, wenn der Vorgänger fertig ist." },
  SS: { label: "SS · Start → Start", hint: "Beginnt, wenn der Vorgänger beginnt." },
  FF: { label: "FF · Ende → Ende", hint: "Endet, wenn der Vorgänger endet." },
  SF: { label: "SF · Start → Ende", hint: "Endet, wenn der Vorgänger beginnt." },
};

export function dependencyLabel(type: string): string {
  return DEPENDENCY_LABELS[type as DependencyType]?.label ?? type;
}

export function dependencyHint(type: string): string {
  return DEPENDENCY_LABELS[type as DependencyType]?.hint ?? "";
}

/**
 * Whether a dependency of this type gates completion.
 *
 * `FS` and `FF` do; `SS` and `SF` do not. **The same rule the server enforces**,
 * and here for one purpose only: to grey the badge on an edge that is not
 * holding anything up, so a reader can see at a glance which of four
 * dependencies is the one to chase. The server's `refuseTransition` is the rule;
 * this deliberately returns a boolean for *styling* rather than a verdict, so it
 * cannot drift into being a second, kinder copy of it.
 */
export function gatesCompletion(type: string): boolean {
  return type === "FS" || type === "FF";
}

/** A lag, in the words a plan uses. `0` is the normal case and says nothing. */
export function lagLabel(days: number): string {
  if (days === 0) return "";
  if (days > 0) return `+${days} Tag${days === 1 ? "" : "e"}`;
  return `${days} Tag${days === -1 ? "" : "e"}`;
}

const COLUMN_LABELS: Record<BoardColumn, string> = {
  TODO: "Offen",
  IN_PROGRESS: "In Arbeit",
  IN_REVIEW: "In Prüfung",
  BLOCKED: "Blockiert",
  DONE: "Erledigt",
};

export function boardColumnLabel(column: string): string {
  return COLUMN_LABELS[column as BoardColumn] ?? column;
}

/* ================================================================== */
/* Option lists                                                        */
/* ================================================================== */

export const TASK_STATUS_OPTIONS = TASK_STATUSES.map((value) => ({
  value,
  label: taskStatusLabel(value),
}));

export const BOARD_COLUMN_OPTIONS = BOARD_COLUMNS.map((value) => ({
  value,
  label: boardColumnLabel(value),
}));

export const DEPENDENCY_TYPE_OPTIONS = DEPENDENCY_TYPES.map((value) => ({
  value,
  label: dependencyLabel(value),
}));

/**
 * The statuses that count as outstanding work.
 *
 * Used by the default filter and by the overdue query, and exported so the two
 * cannot disagree — an "open" that means one thing in a filter and another in a
 * badge is how a count stops matching the list beneath it.
 */
export const OPEN_STATUSES: readonly TaskStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "BLOCKED",
];
