/**
 * What a setting is allowed to hold.
 *
 * Pure, so it can be tested exhaustively without a database — the same shape
 * `projects.rules.ts` and `tasks.rules.ts` use, and for the same reason.
 *
 * **This file exists because of a data-loss path.** `SettingDef` declared no
 * type and `SettingsService.update` checked only that the key existed and that
 * the value was not `undefined`. The controller's own comment claimed that
 * *"the shape is checked against the setting's own definition in the service"*
 * — it was not, anywhere. Most readers survived that because `text`, `number`
 * and `flag` fall back on anything unexpected, but `applications.retentionDays`
 * was read with the raw `value()` and multiplied into `retainUntil`:
 *
 *   - `0` or a negative number put the deadline in the past, and the 03:00
 *     purge then deleted every dossier received that day — personal data, with
 *     its files, permanently, with no undo.
 *   - A non-numeric value produced `new Date(NaN)`, Prisma rejected the write,
 *     and the **public application form 500'd** with no visible cause.
 *
 * Both were reachable from the settings form by a mistype. The clamp on the
 * read is one half of the repair; this is the other, and it is the half that
 * generalises: a value that cannot be stored wrong cannot be read wrong.
 *
 * The declaration is also what the dashboard renders from. Field types used to
 * be **inferred from the stored JSON** — a boolean got a toggle because the
 * value happened to be a boolean — which meant a setting could not be rendered
 * correctly until it already held the right kind of value, and an operator who
 * had stored a string into a numeric setting was then shown a text box
 * confirming their mistake.
 */

export type SettingType =
  | "string"
  | "text"
  | "email"
  | "url"
  | "number"
  | "boolean"
  | "stringList"
  | "select";

export type SettingDef = {
  key: string;
  group: string;
  type: SettingType;
  value: unknown;
  description: string;
  /** Redacted in every read unless the caller holds `settings.secrets`. */
  secret?: boolean;
  /** Stored and editable, but read by no code yet. Rendered as such. */
  pending?: boolean;
  /** `number` only, inclusive. Both are required where they make sense. */
  min?: number;
  max?: number;
  /** `select` only. */
  options?: { value: string; label: string }[];
  /** Shown after the input — "Tage", "Minuten", "MB". */
  unit?: string;
  /**
   * Whether clearing the field means something other than "empty".
   *
   * Every text setting in the mail group defers to the environment when blank,
   * which is a real behaviour an operator has to be told about rather than a
   * validation rule. Carried here so the hint is written once.
   */
  blankMeans?: string;
};

/** The mask a secret reads back as. Writing it unchanged is a no-op. */
export const REDACTED = "••••••••";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Why this value may not be stored under this key, or `null` when it may.
 *
 * Returns a message rather than throwing: the caller validates a batch and a
 * form that reports one error per save is a form somebody fixes one field at a
 * time.
 *
 * **An empty string is allowed for every text-ish type**, and that is
 * deliberate rather than lax. Clearing a field is how an operator says "use the
 * environment value" for the mail block and "there is no such address" for the
 * rest; refusing it would make several settings impossible to unset. `required`
 * would be the wrong lever here — the *organisation* holds the values that must
 * exist, and it validates them as columns.
 */
export function refuseSettingValue(def: SettingDef, value: unknown): string | null {
  const label = `„${def.description || def.key}“`;

  switch (def.type) {
    case "boolean":
      return typeof value === "boolean"
        ? null
        : `${label} ist ein Ja/Nein-Wert.`;

    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `${label} erwartet eine Zahl.`;
      }
      if (def.min !== undefined && value < def.min) {
        return `${label} darf nicht kleiner als ${def.min}${unit(def)} sein.`;
      }
      if (def.max !== undefined && value > def.max) {
        return `${label} darf nicht grösser als ${def.max}${unit(def)} sein.`;
      }
      return null;
    }

    case "stringList": {
      if (!Array.isArray(value)) return `${label} erwartet eine Liste.`;
      if (value.some((v) => typeof v !== "string")) {
        return `${label} darf nur Text enthalten.`;
      }
      return null;
    }

    case "select": {
      if (typeof value !== "string") return `${label} erwartet einen der Werte.`;
      const allowed = (def.options ?? []).map((o) => o.value);
      return allowed.includes(value)
        ? null
        : `„${value}“ ist für ${label} nicht zulässig. Erlaubt: ${allowed.join(", ")}.`;
    }

    case "email": {
      if (typeof value !== "string") return `${label} erwartet eine E-Mail-Adresse.`;
      if (value.trim() === "") return null;
      return EMAIL.test(value.trim()) ? null : `${label} ist keine gültige E-Mail-Adresse.`;
    }

    case "url": {
      if (typeof value !== "string") return `${label} erwartet eine URL.`;
      if (value.trim() === "") return null;
      try {
        const parsed = new URL(value.trim());
        return parsed.protocol === "http:" || parsed.protocol === "https:"
          ? null
          : `${label} muss mit http:// oder https:// beginnen.`;
      } catch {
        return `${label} ist keine gültige URL.`;
      }
    }

    case "string":
    case "text":
      return typeof value === "string" ? null : `${label} erwartet Text.`;
  }
}

function unit(def: SettingDef): string {
  return def.unit ? ` ${def.unit}` : "";
}

/**
 * Sorts a batch of updates into what to write and what to refuse.
 *
 * Three outcomes rather than two, because a secret whose value comes back as
 * the mask is neither valid nor invalid — it is the form saying "I did not
 * change this", and treating it as a write would store the mask itself as the
 * SMTP password.
 */
export function planSettingUpdates(
  defs: Map<string, SettingDef>,
  updates: { key: string; value: unknown }[],
): {
  apply: { key: string; value: unknown }[];
  unknown: string[];
  errors: string[];
} {
  const apply: { key: string; value: unknown }[] = [];
  const unknownKeys: string[] = [];
  const errors: string[] = [];

  for (const update of updates) {
    const def = defs.get(update.key);
    if (!def) {
      unknownKeys.push(update.key);
      continue;
    }

    // The mask written back means "leave it alone".
    if (def.secret && update.value === REDACTED) continue;

    /*
      An absent value is refused rather than written.

      Prisma reads `undefined` as "do not touch this column", so an update that
      lost its value on the way in used to sail through: a 200, an audit row
      claiming the setting had changed, and no change. That is exactly what
      happened while the DTO's `value` carried no decorator and the global
      `whitelist: true` pipe stripped it. The decorator is the fix; this makes
      the *next* version of that mistake loud rather than silent.
    */
    if (update.value === undefined) {
      errors.push(`Für „${update.key}“ wurde kein Wert übermittelt.`);
      continue;
    }

    const error = refuseSettingValue(def, update.value);
    if (error) {
      errors.push(error);
      continue;
    }

    apply.push({ key: update.key, value: normalise(def, update.value) });
  }

  return { apply, unknown: unknownKeys, errors };
}

/**
 * The value as it is stored.
 *
 * Trimming is the only transformation, and it applies to the types where
 * trailing whitespace is always a typo. A stored `"smtp.iem.ch "` produces a
 * DNS failure whose message names a host that looks correct.
 */
function normalise(def: SettingDef, value: unknown): unknown {
  if (def.type === "stringList" && Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value !== "string") return value;
  // `text` is multi-line free text — a trailing newline there is content.
  return def.type === "text" ? value : value.trim();
}
