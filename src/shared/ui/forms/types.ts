/**
 * The field descriptor `FieldRenderer` renders from.
 *
 * It lives here rather than beside the content API because the *shape* is
 * general — a name, a type, a label, some constraints — and only its current
 * source is domain-specific. Today the descriptors come from
 * `ContentType.schema`; the enterprise modules will build the same list from
 * an entity's own definition, and `EntityForm` (§3.1, F5) is that seam.
 *
 * `type` is a plain string rather than a union on purpose: the set is defined
 * by whatever `FieldRenderer` has a case for, and the server sends types this
 * client may not know yet. An unknown type renders as text with a note rather
 * than crashing the editor — the same failure mode as an unknown `{token}` on
 * the public site, which renders itself rather than blanking a number.
 */
export type FieldDef = {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  help?: string;
  options?: { value: string; label: string }[];
  /** Names another content type whose entries become the option list. */
  optionsFrom?: string;
  /** For `list` fields: the type of each item. */
  of?: string;
  /** For `group` and `list`-of-group fields. */
  fields?: FieldDef[];
  maxLength?: number;
  min?: number;
  max?: number;
  /** Marks a copy field that may carry `{token}` placeholders. */
  tokens?: boolean;
};

export type FieldErrors = Record<string, string[]>;
