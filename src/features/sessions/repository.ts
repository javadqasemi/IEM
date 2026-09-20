import { request } from "@/core/api";
import type { RevokeOthersResultDto, RevokeResultDto, SessionDto } from "./dto";

/**
 * HTTP only. URLs, methods, DTOs — no React, no rules, no mapping.
 *
 * All three routes take the account from the **verified token**, never from
 * a parameter, which is why none of them names a user. There is no path
 * through this file by which one account could reach another's sessions,
 * and that is the control rather than a convention.
 */
export const sessionRepository = {
  list: () => request<SessionDto[]>("/auth/sessions"),

  revoke: (id: string) =>
    request<RevokeResultDto>(`/auth/sessions/${id}`, { method: "DELETE" }),

  /**
   * Everything except this browser's own.
   *
   * Distinct from `/auth/logout-all`, which ends this one too. "Sign out my
   * other devices" is something you do *because* you intend to keep working
   * here, so the two are different endpoints rather than one with a flag.
   */
  revokeOthers: () =>
    request<RevokeOthersResultDto>("/auth/sessions/revoke-others", {
      method: "POST",
      body: {},
    }),

  /* ---------------------------------------------------------------- */
  /* Somebody else's, for an administrator                             */
  /* ---------------------------------------------------------------- */

  /**
   * The three above take the account from the token and name no user. These
   * three name one, and that difference is the whole security boundary
   * between them: `/users/:id/sessions` is behind `user.readSessions` and
   * `user.revokeSessions`, which `/auth/sessions` deliberately has no
   * equivalent of because an account's own sessions need no permission.
   *
   * Same `SessionDto` on the wire, so `mapper.ts` is shared and the
   * `tokenHash` allowlist is enforced in exactly one place on the server.
   */
  listForUser: (userId: string) => request<SessionDto[]>(`/users/${userId}/sessions`),

  revokeForUser: (userId: string, id: string) =>
    request<RevokeResultDto>(`/users/${userId}/sessions/${id}`, { method: "DELETE" }),

  /**
   * All of them, including any the administrator is themselves using if they
   * are looking at their own record. `logout-all` rather than
   * `revoke-others`: there is no "other" to preserve when acting on an
   * account that is not yours.
   */
  revokeAllForUser: (userId: string) =>
    request<RevokeOthersResultDto>(`/users/${userId}/sessions/revoke-all`, {
      method: "POST",
      body: {},
    }),
};

export type SessionRepository = typeof sessionRepository;
