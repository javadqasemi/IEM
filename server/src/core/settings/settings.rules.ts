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
  /**
   * **Encrypted at rest and never readable through the API** (P2-4).
   *
   * This flag used to mean only "redacted unless the caller holds
   * `settings.secrets`" — a mask over a column that held the SMTP password in
   * plaintext, with a permission that handed the plaintext back to anybody
   * holding it. Both halves were wrong, and the second was worse than the
   * first: UI masking is not storage security, and an API that returns a
   * credential is one screenshot away from leaking it.
   *
   * A `secret: true` setting now guarantees all of:
   *
   * 1. encrypted at rest through `SecretEncryptionService`;
   * 2. plaintext accepted only on **write**;
   * 3. plaintext never returned by any read route — `list` emits the fixed
   *    `REDACTED` mask plus `configured`, never the value;
   * 4. plaintext never written to the audit log (only the key is);
   * 5. plaintext never logged;
   * 6. plaintext never carried in an exception message;
   * 7. a blank write means **keep**, never "delete" — see `classifySecretWrite`;
   * 8. removal is an explicit, separately-audited action.
   *
   * `settings.secrets` survives as the permission to **manage** these — to
   * replace and to remove one — which is what it is now named for in
   * `rbac/resources.ts`. It no longer grants reading one back, because nothing
   * does.
   */
  secret?: boolean;
  /**
   * What authority, beyond `settings.update`, a *change* to this setting needs
   * (P0, SEC-5). Absent means ordinary configuration. See `SettingAuthority`.
   */
  authority?: "security" | "credential";
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

/* ================================================================== */
/* Authority — who may change which setting (P0, SEC-5)                */
/* ================================================================== */

/**
 * The four kinds of setting, by what changing one can do.
 *
 * | | | |
 * | --- | --- | --- |
 * | `ordinary`   | configuration — sender name, backup hour, file size | `settings.update` |
 * | `security`   | weakens a control — session lifetime, lockout, password length, four-eyes, retention | + `settings.security` |
 * | `credential` | where a credential is sent — SMTP host, port, user, TLS | + `settings.secrets` |
 * | `secret`     | the credential itself — SMTP password | + `settings.secrets` |
 *
 * **Why the transport counts as a credential.** Pointing `mail.smtpHost` at a
 * server one controls makes the application authenticate there with the
 * stored password — and routes every password-reset link through it. Holding
 * the key to *where* a secret goes is holding the secret.
 *
 * **Only a change is judged.** A settings form posts every field it rendered,
 * so an Administrator saving the sender name also sends the unchanged SMTP
 * host; refusing that would make the form unusable for exactly the people it
 * is for. A value equal to the stored one, and a secret left blank (`keep`),
 * need nothing beyond `settings.update`.
 *
 * Before this, `settings.secrets` guarded only *removal* and `settings.update`
 * could replace the SMTP password, repoint the transport and switch off the
 * four-eyes rule (`docs/COMPLETE_APPLICATION_AUDIT.md` SEC-R10, Part 8 R4/R13).
 */
export type SettingAuthority = "ordinary" | "security" | "credential" | "secret";

export function authorityOf(def: SettingDef): SettingAuthority {
  if (def.secret) return "secret";
  return def.authority ?? "ordinary";
}

/** The permission a change needs on top of `settings.update`, or `null`. */
export const AUTHORITY_PERMISSION: Record<SettingAuthority, string | null> = {
  ordinary: null,
  security: "settings.security",
  credential: "settings.secrets",
  secret: "settings.secrets",
};

/**
 * Why this caller may not make these changes, or `null`.
 *
 * `changed` are the declarations of the settings whose value would actually
 * change. `holds` answers for the caller — Super Admin short-circuits there,
 * never here.
 */
export function refuseSettingAuthority(
  changed: readonly SettingDef[],
  holds: (permission: string) => boolean,
): string | null {
  const missing = new Map<string, string[]>();
  for (const def of changed) {
    const permission = AUTHORITY_PERMISSION[authorityOf(def)];
    if (!permission || holds(permission)) continue;
    const labels = missing.get(permission) ?? [];
    labels.push(`„${def.description || def.key}“`);
    missing.set(permission, labels);
  }
  if (!missing.size) return null;
  const parts = [...missing.entries()].map(
    ([permission, labels]) => `${labels.join(", ")} (verlangt ${permission})`,
  );
  return `Diese Einstellungen dürfen Sie nicht ändern: ${parts.join("; ")}.`;
}

/**
 * Whether a submitted value differs from the stored one.
 *
 * Values here are JSON primitives and string arrays, so a stringify compare is
 * exact — the key-order problem `snapshot.builder.ts` canonicalises for does
 * not arise without objects.
 */
export function valueChanged(stored: unknown, next: unknown): boolean {
  return JSON.stringify(stored ?? null) !== JSON.stringify(next ?? null);
}

/**
 * The mask a secret reads back as. Writing it unchanged is a no-op.
 *
 * A **constant**, not a length-preserving blob: `"••••••••"` for every secret
 * whatever it holds, so the mask itself discloses nothing — not even how long
 * the password is, which is the one thing a length-preserving mask hands to
 * somebody reading over a shoulder.
 */
export const REDACTED = "••••••••";

/**
 * What a write to a secret setting means.
 *
 * Three outcomes and **no way to spell "delete"**, which is the whole point.
 * The obvious design — empty string clears it — is the one that loses a
 * working SMTP password to a settings form that posted every field it
 * rendered, and the operator's next clue is mail silently not arriving.
 * Removal is `SettingsService.removeSecret`, a separate route behind a
 * separate confirmation.
 */
export type SecretWrite =
  /** The mask came back, or the field was left blank. Change nothing. */
  | { intent: "keep" }
  /** A real value was typed. Encrypt it and store it. */
  | { intent: "replace"; plaintext: string }
  /** Not a string at all — a number or an object arrived under a secret key. */
  | { intent: "refuse"; error: string };

/**
 * Reads a submitted value as one of those three.
 *
 * Pure and exported so `settings.rules.test.ts` can cover every spelling of
 * "the user did not change the password": the mask, an empty string, spaces,
 * and the mask with whitespace around it — because a form that trims on the
 * way out and not on the way in produces the fourth, and storing `"••••••••"`
 * as an SMTP password is a failure that only shows up at the next send.
 */
export function classifySecretWrite(def: SettingDef, value: unknown): SecretWrite {
  if (typeof value !== "string") {
    return {
      intent: "refuse",
      error: `„${def.description || def.key}“ erwartet Text.`,
    };
  }

  const trimmed = value.trim();
  if (trimmed === "" || trimmed === REDACTED) return { intent: "keep" };
  return { intent: "replace", plaintext: trimmed };
}

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
 * Sorts a batch of updates into what to write, what to encrypt, and what to
 * refuse.
 *
 * Four outcomes rather than two. A secret is separated from `apply` rather
 * than normalised into it because the two need different things from the
 * caller: an ordinary value is written as it stands, and a secret has to go
 * through `SecretEncryptionService` first. Keeping them in one list would mean
 * the service re-deciding, per row, whether the value it is about to write is
 * a credential — and the row it gets wrong is the row that stores an SMTP
 * password in the clear.
 */
export function planSettingUpdates(
  defs: Map<string, SettingDef>,
  updates: { key: string; value: unknown }[],
): {
  apply: { key: string; value: unknown }[];
  /** Plaintext, to be encrypted by the caller. Never logged, never audited. */
  secrets: { key: string; plaintext: string }[];
  unknown: string[];
  errors: string[];
} {
  const apply: { key: string; value: unknown }[] = [];
  const secrets: { key: string; plaintext: string }[] = [];
  const unknownKeys: string[] = [];
  const errors: string[] = [];

  for (const update of updates) {
    const def = defs.get(update.key);
    if (!def) {
      unknownKeys.push(update.key);
      continue;
    }

    /*
      A secret never reaches `refuseSettingValue` or `normalise`.

      Both would be harmless today and neither is the point: the value is a
      credential, and the fewer functions that hold one the shorter the list of
      places it could be logged from. `classifySecretWrite` is the only reader.
    */
    if (def.secret) {
      const write = classifySecretWrite(def, update.value);
      if (write.intent === "refuse") errors.push(write.error);
      if (write.intent === "replace") secrets.push({ key: def.key, plaintext: write.plaintext });
      continue;
    }

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

  return { apply, secrets, unknown: unknownKeys, errors };
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
