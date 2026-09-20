/**
 * A session, as the dashboard thinks about one.
 *
 * Local to this feature rather than in `entities/`, and that is the rule
 * rather than laziness: `entities/` is shared vocabulary, and today exactly
 * one screen reads this. It moves the day the second one does — the
 * administrator's view of another user's sessions is the one that will
 * trigger it, and that is `docs/ENTERPRISE_ROADMAP.md` → P2-9's second half.
 *
 * Dates are `Date` here and ISO strings on the wire; `mapper.ts` is the only
 * thing that has seen both.
 */
export type Session = {
  id: string;
  /** "Chrome auf Windows", or an honest shrug. Built on the server. */
  device: string;
  ip: string | null;
  /**
   * The last refresh, not the sign-in.
   *
   * Named for what it is. A `RefreshToken` row is replaced on every
   * rotation, so its `createdAt` is the most recent activity — calling it
   * "signed in at" would be a plausible-looking lie, and the true value
   * would need the rotation chain walked back through an unindexed column.
   */
  lastActiveAt: Date;
  expiresAt: Date;
  /** The session this browser is using. Revoking it signs the reader out. */
  current: boolean;
};
