/**
 * What a session *is* here, and what may be said about one.
 *
 * Pure — no Prisma, no request — so every branch is testable, which matters
 * because two of the decisions below are easy to get subtly and silently
 * wrong.
 *
 * ---
 *
 * **A session is one row, and that is a consequence rather than a choice.**
 *
 * `RefreshToken` looks at first like a log: rotation writes a *new* row on
 * every refresh and revokes the old one, so a browser open for a week leaves
 * dozens of rows behind. Listing them raw would show somebody "forty-one
 * sessions" for two laptops, which is worse than showing nothing.
 *
 * But rotation also *revokes* as it goes, and reuse detection revokes the
 * whole family — so at any instant a live session has **exactly one**
 * unrevoked, unexpired row. Filtering on that is the whole grouping problem
 * solved, with an index already on `userId` and no chain-walking.
 *
 * The cost is stated rather than hidden: the row's `createdAt` is the *last
 * rotation*, not the sign-in. So this reports **"last activity"** and never
 * "signed in at" — the second would need the chain walked back through
 * `replacedById`, which is a query per hop against a column with no index.
 * Reporting a rotation timestamp under a "signed in" label would be a
 * plausible-looking lie, which is the one thing an operations screen must not
 * contain.
 */

/** The columns a session row is read from. Nothing secret is among them. */
export type SessionRow = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
};

/**
 * What leaves the server.
 *
 * **No `tokenHash`, no token, and no `replacedById`.** The hash is a
 * credential-equivalent — it is exactly what the server compares against, so
 * anything holding it can be checked against the table — and `replacedById`
 * is another row's hash. The identity on the wire is the row's `id`, which is
 * a cuid that grants nothing.
 */
export type SessionView = {
  id: string;
  /** "Chrome auf Windows", as far as the string honestly supports. */
  device: string;
  ip: string | null;
  /** The last rotation. See the note at the top: not the sign-in. */
  lastActiveAt: string;
  expiresAt: string;
  /** The session making the request. Never revocable by accident. */
  current: boolean;
};

/* ================================================================== */
/* Device                                                             */
/* ================================================================== */

/**
 * Browser and platform out of a user-agent string, or an honest shrug.
 *
 * Deliberately a short ordered table rather than a parsing library. A
 * user-agent is self-reported and every library that promises more is
 * maintaining a list like this one behind a larger API — and the consequence
 * of being wrong here is cosmetic, whereas the consequence of a dependency is
 * permanent.
 *
 * **Order matters and is the whole correctness of it.** Edge announces itself
 * as Chrome *and* as Edge; Chrome announces itself as Safari. So the most
 * specific claim is tested first, and a naive table that checked Safari early
 * would label every Chrome session "Safari".
 */
const BROWSERS: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const PLATFORMS: [RegExp, string][] = [
  [/Windows NT/, "Windows"],
  [/iPhone|iPad/, "iOS"],
  [/Android/, "Android"],
  [/Mac OS X/, "macOS"],
  [/Linux/, "Linux"],
];

export function describeDevice(userAgent: string | null): string {
  if (!userAgent?.trim()) return "Unbekanntes Gerät";

  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const platform = PLATFORMS.find(([pattern]) => pattern.test(userAgent))?.[1];

  if (browser && platform) return `${browser} auf ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  /*
    Something real that this table does not know — a CLI, a health checker, a
    new browser. The first 40 characters are more use to an operator deciding
    whether to revoke it than the word "Unbekannt" would be, and truncating
    keeps a hostile 500-character string out of a table cell.
  */
  return userAgent.trim().slice(0, 40);
}

/* ================================================================== */
/* The list                                                            */
/* ================================================================== */

/**
 * The live sessions, newest activity first, with the caller's own marked.
 *
 * `currentTokenHash` is the sha256 of the refresh cookie the request
 * presented. Comparing hashes rather than tokens means the caller's own
 * secret is never needed here, and a caller that presented no cookie simply
 * has no current session — which is the honest answer for an access-token-only
 * request, not a reason to guess.
 */
export function toSessionViews(
  rows: (SessionRow & { tokenHash: string })[],
  currentTokenHash: string | null,
  now: Date,
): SessionView[] {
  return rows
    .filter((row) => row.expiresAt.getTime() > now.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((row) => ({
      id: row.id,
      device: describeDevice(row.userAgent),
      ip: row.ip,
      lastActiveAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      current: currentTokenHash !== null && row.tokenHash === currentTokenHash,
    }));
}

/**
 * Whether this session may be revoked, and why not.
 *
 * **Revoking your own current session is allowed**, and the rule exists to
 * make sure it is deliberate rather than to prevent it: signing yourself out
 * of the device in front of you is a real thing to want, and refusing it
 * would send somebody to the sign-out menu to achieve the same effect by a
 * different route. What the caller gets is a different *confirmation*, which
 * is the screen's job — this returns the fact, not the refusal.
 *
 * What is genuinely refused is a session that is not the caller's. The
 * repository scopes by `userId` already; this is the second answer, so that a
 * mistake in one of them is not sufficient on its own.
 */
export function refuseRevoke(
  session: { id: string; userId: string } | null,
  callerId: string,
): string | null {
  if (!session) return "Diese Sitzung gibt es nicht.";
  if (session.userId !== callerId) return "Diese Sitzung gehört zu einem anderen Konto.";
  return null;
}
