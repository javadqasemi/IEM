import { refreshSession, request } from "@/core/api";
import type { LoginResult, Session } from "./types";

/**
 * The session endpoints.
 *
 * In `core/` rather than in a feature, because everything above depends on
 * them: the router guards on the session, the API client refreshes it, and a
 * feature that could not sign in would have nothing to show. It is the one
 * "repository" that is not owned by a feature folder, and that is the reason.
 */
export const authRepository = {
  login: (email: string, password: string) =>
    request<LoginResult>("/auth/login", { body: { email, password } }),

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
