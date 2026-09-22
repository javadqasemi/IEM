/**
 * The one denylist, and the one recursive scrub over it.
 *
 * ---
 *
 * ## Why it moved out of `AuditService`
 *
 * It was a private function there and it was right there — the audit log is
 * the obvious place to worry about writing a password into a table. P2-6
 * needed the *same* guarantee for a second reader: the Job Operations screen
 * shows `Job.payload`, which is arbitrary JSON written by whoever enqueued the
 * job, and a second denylist would be a second thing to remember to extend.
 *
 * The failure that shape produces is specific and quiet. Somebody adds
 * `"clientsecret"` to the audit list after an incident, the jobs list keeps
 * its own copy, and the value that was just declared too dangerous to log goes
 * on being displayed on a screen nobody thought about.
 *
 * ## It is a denylist, and that is the weaker choice
 *
 * An allowlist would be stronger and is not available: the values passing
 * through here are arbitrary content documents and arbitrary job payloads, so
 * an allowlist would mean recording almost nothing. The mitigation is that the
 * records which actually carry secrets — users, tokens, settings — are all
 * covered below, and that the job payloads in `core/jobs/catalogue.ts` are
 * deliberately **ids rather than data** for exactly this reason.
 */

/**
 * Field names whose values never leave the server.
 *
 * Matched case-insensitively on the *key*, at any depth.
 */
export const SECRET_KEYS = [
  "password",
  "passwordhash",
  "mfasecret",
  "tokenhash",
  "token",
  "secret",
  "apikey",
  "authorization",
  "cookie",
  "smtppassword",
  /*
    Added with P2-6, for the job payloads specifically.

    `reauthToken` is in a restore request body and would otherwise reach the
    jobs screen through a payload; `connectionstring` and `databaseurl` carry
    the Postgres password inline, which is the shape `redactToolOutput`
    already strips out of tool *output* and nothing was stripping out of
    structured data.
  */
  "reauthtoken",
  "refreshtoken",
  "accesstoken",
  "connectionstring",
  "databaseurl",
  "privatekey",
  "credentials",
];

export const REDACTED = "«entfernt»";

/** How deep to walk before giving up. A cycle cannot outlast it. */
const MAX_DEPTH = 12;

/**
 * Returns the value with every secret-named field replaced.
 *
 * `undefined` for a null input rather than `null`, which is what
 * `AuditService` relied on when this lived there: Prisma treats `undefined` as
 * "do not write this column" and `null` as "write SQL NULL", and the audit row
 * wants the first.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (value == null || depth > MAX_DEPTH) return value ?? undefined;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.includes(k.toLowerCase()) ? REDACTED : scrub(v, depth + 1);
  }
  return out;
}

/**
 * The same scrub, plus a size ceiling, for anything shown in a list.
 *
 * A job payload is `Json` and can be as large as whoever enqueued it made it.
 * The jobs list renders one row per job, so an unbounded payload is both a
 * page that never finishes rendering and a response nobody budgeted for —
 * which is the N+1's quieter cousin: not too many queries, one query carrying
 * too much.
 *
 * The truncation is **visible**. A payload silently cut in half is worse than
 * no payload, because the reader believes they are looking at the whole thing.
 */
export function scrubBounded(value: unknown, maxChars = 2_000): unknown {
  const scrubbed = scrub(value);
  const text = JSON.stringify(scrubbed ?? null);
  if (text && text.length > maxChars) {
    return {
      "«gekürzt»": `Nutzdaten sind ${text.length} Zeichen lang und werden hier nicht vollständig gezeigt.`,
    };
  }
  return scrubbed;
}
