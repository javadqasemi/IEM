import { refreshSession, request } from "@/core/api";
import type { LoginOutcome, LoginResult, RecentAuth, Session } from "./types";

/**
 * The session endpoints.
 *
 * In `core/` rather than in a feature, because everything above depends on
 * them: the router guards on the session, the API client refreshes it, and a
 * feature that could not sign in would have nothing to show. It is the one
 * "repository" that is not owned by a feature folder, and that is the reason.
 */
export const authRepository = {
  /**
   * A correct password buys one of two things — see `LoginOutcome`.
   *
   * Where the account has a second factor this resolves with a challenge and
   * **no token of any kind**. There is nothing here for a caller to
   * accidentally treat as a session.
   */
  login: (email: string, password: string) =>
    request<LoginOutcome>("/auth/login", { body: { email, password } }),

  /**
   * The second half of a sign-in.
   *
   * One method for both a TOTP code and a recovery code, because the server
   * takes one body and decides: the screen chooses which field it shows, and
   * the two are the same act as far as the session is concerned.
   */
  verifyMfa: (challenge: string, input: { code?: string; recoveryCode?: string }) =>
    request<LoginResult>("/auth/mfa/challenge", { body: { challenge, ...input } }),

  /**
   * Opens a re-authentication window for an operation that removes a
   * security control.
   *
   * In `core/` rather than in `features/mfa` even though MFA is its only
   * caller today: it is not about the second factor, it is about *this
   * session's* freshness, and backup restore and API secrets are already
   * named as the next users (`ReauthService` on the server). A feature that
   * owns it would be a feature every later one has to import.
   */
  reauthenticate: (input: { password: string; code?: string; recoveryCode?: string }) =>
    request<RecentAuth>("/auth/reauthenticate", { body: input }),

  /** Exchanges the `httpOnly` refresh cookie for a new access token. */
  refresh: refreshSession,

  logout: () => request<void>("/auth/logout", { method: "POST" }),

  me: () => request<Session>("/auth/me"),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/auth/change-password", { body: { currentPassword, newPassword } }),

  /**
   * Always resolves, whatever the address.
   *
   * The server answers the same way for a known and an unknown account, so the
   * screen cannot be used to find out who has a login here. The message it
   * returns says so.
   */
  forgotPassword: (email: string) =>
    request<{ message: string }>("/auth/forgot-password", { body: { email } }),

  resetPassword: (token: string, password: string) =>
    request<void>("/auth/reset-password", { body: { token, password } }),
};
