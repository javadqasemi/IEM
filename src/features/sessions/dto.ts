/**
 * The wire shapes, and nothing else.
 *
 * These names may appear in `repository.ts` and `mapper.ts` and nowhere above
 * them — `src/architecture.test.ts` enforces it.
 *
 * **What is not here is the point of the endpoint.** No token, no
 * `tokenHash`, no `replacedById`: the server's `SessionView` is built by
 * `sessions.rules.ts` with an explicit key list precisely so that the shape
 * cannot grow a credential by somebody adding a column to `RefreshToken`.
 * The identity on the wire is `id`, a cuid that grants nothing.
 */

export type SessionDto = {
  id: string;
  device: string;
  ip: string | null;
  /** The last rotation — **not** the sign-in. See the server's rules file. */
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
};

export type RevokeResultDto = { revoked: boolean; wasCurrent: boolean };

export type RevokeOthersResultDto = { revoked: number };
