/**
 * Every notification decision that is arithmetic rather than I/O.
 *
 * The same split `auth.rules.ts`, `mfa.rules.ts` and `drawings.rules.ts` make,
 * and for the same reason: what a preference *means*, who ends up on a
 * recipient list and whether two events are the same event are all functions
 * of a few values, so they can be covered exhaustively — and every one of them
 * fails silently when it is wrong. A resolution order that quietly lets a
 * preference win over an invariant does not throw; it just stops telling
 * somebody that their second factor was removed.
 *
 * No Prisma, no request, no clock it does not receive.
 */

import {
  suppressesActor,
  type NotificationDef,
} from "./catalogue";

/* ================================================================== */
/* Channel resolution                                                  */
/* ================================================================== */

/** What the firm has configured for one type, where it has configured it. */
export type OrganisationRule = {
  enabled: boolean;
  inApp: boolean;
  email: boolean;
};

/** What one person has chosen for one type, where they have chosen. */
export type UserPreference = {
  inApp: boolean;
  email: boolean;
};

export type ResolvedChannels = {
  inApp: boolean;
  email: boolean;
  /**
   * Why a channel is off, when it is. `null` when nothing was suppressed.
   *
   * Carried into `NotificationDelivery.detail` so a `SKIPPED` row says which
   * of three layers said no. Without it an operator looking at a silence has
   * to reconstruct the chain by hand from two tables and a code file.
   */
  reason: string | null;
};

/**
 * The three layers, in the one order that is safe.
 *
 * ```
 * security invariant  →  organisation policy  →  user preference
 * ```
 *
 * Deliberately the shape `security.policy.ts` already uses for its numbers,
 * and for the same argument: a policy may *tighten* and may not *loosen*. Here
 * "tighten" means switching a notification off, so the direction is inverted —
 * an invariant is a floor under what must still be sent, and neither the firm
 * nor the person can go below it.
 *
 * **Applied on read, never trusted from the write path.** A `NotificationRule`
 * row saying `enabled: false` for a mandatory type cannot be produced through
 * the API — the controller refuses it — but it can arrive from a migration, a
 * hand-edit or a release from before the type was mandatory, and this is what
 * makes all three harmless. It is the same reason `clampPolicy` runs on read.
 */
export function resolveChannels(
  def: NotificationDef,
  rule: OrganisationRule | null,
  preference: UserPreference | null,
): ResolvedChannels {
  /*
    The organisation's switch, which a mandatory type simply does not have.

    Checked before anything else because `enabled: false` means "we do not
    send this at all" and there is nothing left to resolve after it.
  */
  if (rule && !rule.enabled && !def.mandatory) {
    return { inApp: false, email: false, reason: "Von der Organisation deaktiviert." };
  }

  const orgInApp = rule?.inApp ?? def.defaults.inApp;
  const orgEmail = rule?.email ?? def.defaults.email;

  // A channel the firm has switched off is not one a person can switch on:
  // the organisation layer sits above the personal one, so it bounds it.
  const inApp = preference ? preference.inApp && orgInApp : orgInApp;
  const email = preference ? preference.email && orgEmail : orgEmail;

  /*
    The invariant, last, so that nothing below it can have the last word.

    In-app only. The e-mail copy stays configurable even here — somebody who
    reads every notification in the dashboard may reasonably not want a second
    one in their inbox, and refusing that is how people stop reading either.
  */
  if (def.mandatory && !inApp) {
    return {
      inApp: true,
      email,
      reason: null,
    };
  }

  const reason =
    !inApp && !email
      ? preference
        ? "Vom Empfänger abbestellt."
        : "Für diese Art standardmässig aus."
      : null;

  return { inApp, email, reason };
}

/**
 * Whether a person may switch this channel off at all.
 *
 * The screen asks so it can draw the control disabled with an explanation,
 * rather than accepting a click and silently ignoring it — which is the
 * failure a settings form must not have. The server refuses it as well; this
 * is the courtesy half.
 */
export function isLocked(def: NotificationDef, channel: "inApp" | "email"): boolean {
  return def.mandatory && channel === "inApp";
}

/* ================================================================== */
/* Recipients                                                          */
/* ================================================================== */

export type Candidate = {
  id: string;
  /** Inactive and deleted accounts are dropped before anything else. */
  active: boolean;
};

/**
 * The final recipient list: deduplicated, alive, and without the actor where
 * that applies.
 *
 * Three filters and the order does not matter, but each is worth its line:
 *
 * - **Dedupe.** Somebody holding two roles that both grant `content.approve`
 *   is one person. Resolving by permission and by explicit id in the same
 *   event is the other way it happens. Two rows would be two e-mails, which is
 *   the "notification storm" the brief names — and the storm is rarely a
 *   thousand messages, it is usually two.
 * - **Alive.** A suspended or deleted account is not a recipient. The row
 *   would be unreachable (they cannot sign in) and the e-mail would go to an
 *   address the firm has finished with.
 * - **The actor**, except for `subject` notifications — see `suppressesActor`,
 *   where the exception is the entire security argument.
 */
export function resolveRecipients(
  def: NotificationDef,
  candidates: Candidate[],
  actorId: string | null,
): string[] {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.active) continue;
    if (actorId && candidate.id === actorId && suppressesActor(def)) continue;
    seen.add(candidate.id);
  }
  return [...seen];
}

/* ================================================================== */
/* Idempotency                                                         */
/* ================================================================== */

/**
 * The key that makes one business event produce one notification.
 *
 * `eventName:entity:entityId:correlationId`, and each part earns its place:
 *
 * - **the name and the entity** so two different facts about one record — a
 *   submission and an approval — are two notifications;
 * - **the correlation id** so two *genuine* occurrences are two notifications.
 *   Submitting the same entry twice is two events in two requests and the
 *   reader should see both; without it the second would be swallowed for ever,
 *   which is a far worse failure than a duplicate.
 *
 * The recipient is not in the key because it is the other half of the unique
 * index — `@@unique([eventKey, userId])` — so the same fact reaching one
 * person twice collapses and reaching three people does not.
 *
 * **It is an index, not a check.** Nothing reads the key to decide whether to
 * write; the insert is attempted and a unique violation is the answer. A
 * read-then-write here is the same race `updateIfUnchanged` and the recovery
 * codes are written against.
 */
export function notificationEventKey(input: {
  eventName: string;
  entity: string;
  entityId: string;
  correlationId: string;
}): string {
  return `${input.eventName}:${input.entity}:${input.entityId}:${input.correlationId}`;
}

/* ================================================================== */
/* Presentation                                                        */
/* ================================================================== */

/**
 * The unread count as the bell draws it.
 *
 * Capped at 99, because a three-digit badge does not fit the dot and because
 * the difference between 143 and 156 unread is not a difference anybody acts
 * on. `99+` says "more than you are going to read now", which is the true
 * statement.
 */
export function badgeCount(unread: number): string {
  if (unread <= 0) return "";
  return unread > 99 ? "99+" : String(unread);
}

/**
 * What a screen reader is told, which is not what the badge says.
 *
 * `99+` is a glyph, not a sentence, and a count is useless to somebody who
 * cannot see which control it is attached to. Pluralised properly because
 * "1 ungelesene Benachrichtigungen" is the kind of detail that makes a
 * dashboard feel machine-made.
 */
export function bellLabel(unread: number): string {
  if (unread <= 0) return "Benachrichtigungen — keine ungelesenen";
  if (unread === 1) return "Benachrichtigungen — 1 ungelesene";
  return `Benachrichtigungen — ${unread} ungelesene`;
}
