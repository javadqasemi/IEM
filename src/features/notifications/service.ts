import type { BadgeTone } from "@/shared/ui/primitives";
import type { PreferenceRow, Severity } from "./types";

/**
 * The screens' rules, as pure functions.
 *
 * Same argument `features/organisation/service.ts` makes: everything here can
 * be wrong, none of it renders, and a rule reachable only through `useState`
 * is a rule nobody tests. The components hold no logic beyond wiring these
 * together.
 */

/* ================================================================== */
/* Severity                                                            */
/* ================================================================== */

/**
 * The tone each severity draws in.
 *
 * Mapped to the palette rather than to invented names, because `Badge`'s own
 * comment says meanings belong to the domain and tones belong to the
 * palette. `CRITICAL` and `WARNING` share **bronze**, which is deliberate:
 * this dashboard has one "careful" colour, and a second red-adjacent tone
 * invented for notifications would be the one thing on the page that is not
 * from the brand.
 */
const TONES: Record<Severity, BadgeTone> = {
  INFO: "neutral",
  SUCCESS: "energy",
  WARNING: "gold",
  CRITICAL: "bronze",
};

export function severityTone(severity: Severity): BadgeTone {
  return TONES[severity];
}

/**
 * What a severity is called, in one word.
 *
 * **Colour is never the only signal.** Every row draws this label beside its
 * mark, so somebody who cannot distinguish gold from bronze — or is reading
 * the page through a screen reader, where a tone is nothing at all — gets the
 * same information. That is an accessibility requirement and it is also
 * simply better: "Kritisch" is unambiguous in a way a dot is not.
 */
const SEVERITY_LABELS: Record<Severity, string> = {
  INFO: "Information",
  SUCCESS: "Erledigt",
  WARNING: "Hinweis",
  CRITICAL: "Kritisch",
};

export function severityLabel(severity: Severity): string {
  return SEVERITY_LABELS[severity];
}

/** The filter's options, in severity order rather than alphabetically. */
export const SEVERITY_OPTIONS = (["CRITICAL", "WARNING", "SUCCESS", "INFO"] as const).map(
  (value) => ({ value, label: SEVERITY_LABELS[value] }),
);

/* ================================================================== */
/* The bell                                                            */
/* ================================================================== */

/**
 * The badge's text, capped.
 *
 * A mirror of the server's `badgeCount`, and the duplication is deliberate
 * and small: the client needs it to render and the server needs it for the
 * e-mail subject, it is four lines of arithmetic with no policy in it, and
 * an extra round trip to be told how to draw a number already in hand would
 * be worse. Both are tested.
 */
export function badgeCount(unread: number): string {
  if (unread <= 0) return "";
  return unread > 99 ? "99+" : String(unread);
}

/** What a screen reader hears, which is a sentence rather than a glyph. */
export function bellLabel(unread: number): string {
  if (unread <= 0) return "Benachrichtigungen — keine ungelesenen";
  if (unread === 1) return "Benachrichtigungen — 1 ungelesene";
  return `Benachrichtigungen — ${unread} ungelesene`;
}

/* ================================================================== */
/* The settings screens                                                */
/* ================================================================== */

export type PreferenceGroup = { category: string; rows: PreferenceRow[] };

/**
 * The rows, grouped under their category headings, in the server's order.
 *
 * **Not a table of raw event keys**, which is what a settings screen
 * generated from a catalogue becomes if nobody stops it. The brief is
 * explicit about this and it is right: ten rows of `content.submitted_for_review`
 * with two checkboxes each is a screen an administrator cannot reason about.
 * The category is the unit a person thinks in — "security", "content" — and
 * the label and description are what they decide from.
 *
 * Order is the order the server sent, which is the catalogue's declaration
 * order, which is editorial: Sicherheit first because it is the group most
 * likely to be looked for and the only one that cannot be changed.
 */
export function groupPreferences(rows: PreferenceRow[]): PreferenceGroup[] {
  const groups: PreferenceGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.category === row.category) last.rows.push(row);
    else groups.push({ category: row.category, rows: [row] });
  }
  return groups;
}

/**
 * Which rows differ from what the server last sent.
 *
 * The same shape `pendingSettingUpdates` has, and for the same reason: a save
 * should send what moved, not everything on screen. Sending the lot would
 * write a `NotificationRule` row for all ten types the first time anybody
 * pressed save, turning "not configured, using the default" into "configured
 * to the default" — which is a distinction the administrator's screen shows
 * and would silently lose.
 */
export function changedRows(
  original: PreferenceRow[],
  edited: Record<string, Partial<PreferenceRow>>,
): PreferenceRow[] {
  const byType = new Map(original.map((row) => [row.type, row]));
  const out: PreferenceRow[] = [];

  for (const [type, patch] of Object.entries(edited)) {
    const row = byType.get(type);
    if (!row) continue;
    const next = { ...row, ...patch };
    if (
      next.inApp !== row.inApp ||
      next.email !== row.email ||
      next.enabled !== row.enabled
    ) {
      out.push(next);
    }
  }
  return out;
}

/**
 * Whether a row's channel may be switched at all, and why not when it may
 * not.
 *
 * Returned as a sentence rather than a boolean, because a control that is
 * disabled with no explanation is a control people assume is broken. The
 * three reasons are genuinely different and a reader can act on two of them.
 */
export function lockReason(
  row: PreferenceRow,
  channel: "inApp" | "email",
): string | null {
  if (channel === "inApp" && row.mandatory) {
    return "Sicherheitsmeldung — im Dashboard immer sichtbar.";
  }
  if (row.disabledByOrganisation) {
    return "Von der Organisation für alle deaktiviert.";
  }
  if (channel === "inApp" && row.lockedInApp) {
    return "Von der Organisation deaktiviert.";
  }
  if (channel === "email" && row.lockedEmail) {
    return "Von der Organisation deaktiviert.";
  }
  return null;
}

/* ================================================================== */
/* Deliveries                                                          */
/* ================================================================== */

const DELIVERY_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "Wartet", tone: "neutral" },
  PROCESSING: { label: "Läuft", tone: "air" },
  DELIVERED: { label: "Zugestellt", tone: "energy" },
  FAILED: { label: "Fehlgeschlagen", tone: "bronze" },
  /*
    `SKIPPED` is `neutral`, not a warning, and that is the whole reason the
    status exists. It is a deliberate non-send — a preference, a rule, or no
    SMTP server configured — and drawing it as a fault would put a wall of
    amber in front of an operator on a developer machine, which is how
    somebody learns to ignore the colour that matters.
  */
  SKIPPED: { label: "Übersprungen", tone: "neutral" },
};

export function deliveryStatus(status: string): { label: string; tone: BadgeTone } {
  return DELIVERY_STATUS[status] ?? { label: status, tone: "neutral" };
}

export const DELIVERY_STATUS_OPTIONS = Object.entries(DELIVERY_STATUS).map(
  ([value, { label }]) => ({ value, label }),
);
