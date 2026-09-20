import { request } from "@/core/api";
import type {
  EnrolmentStartDto,
  MfaResetResultDto,
  MfaStatusDto,
  RecoveryCodeSetDto,
} from "./dto";

/**
 * HTTP only. URLs, methods, DTOs — no React, no rules, no mapping.
 *
 * The first five routes take the account from the **verified token** and
 * name no user, which is why none of them has an id in its path — there is
 * no parameter through which one account could reach another's factor, and
 * that is the control rather than a convention. It is the same split
 * `sessionRepository` documents.
 *
 * `resetFor` is the sixth and names one. That difference is the whole
 * security boundary between them: `/users/:id/mfa/reset` is behind
 * `user.resetMfa`, which the five above deliberately have no equivalent of.
 *
 * **Three of these carry a `reauthToken`.** It is the proof that the person
 * at the keyboard just re-entered their password, and it travels in the body
 * rather than in a header so that no CORS allowlist has to widen for one
 * feature. The caller obtains it from `ReauthenticationDialog` and spends it
 * here immediately.
 */
export const mfaRepository = {
  status: () => request<MfaStatusDto>("/auth/mfa"),

  startEnrolment: () =>
    request<EnrolmentStartDto>("/auth/mfa/enroll", { method: "POST", body: {} }),

  verifyEnrolment: (code: string) =>
    request<RecoveryCodeSetDto>("/auth/mfa/enroll/verify", { body: { code } }),

  /**
   * `POST … /disable` rather than `DELETE /auth/mfa`, because the
   * re-authentication proof travels in the body and a `DELETE` with a body is
   * a shape several proxies quietly drop.
   */
  disable: (reauthToken: string) =>
    request<void>("/auth/mfa/disable", { body: { reauthToken } }),

  regenerateRecoveryCodes: (reauthToken: string) =>
    request<RecoveryCodeSetDto>("/auth/mfa/recovery-codes", { body: { reauthToken } }),

  /* ---------------------------------------------------------------- */
  /* Somebody else's, for an administrator                             */
  /* ---------------------------------------------------------------- */

  /**
   * Clears an account's factor. Account recovery, and nothing more.
   *
   * There is deliberately **no** counterpart that reads one: an
   * administrator can remove a credential and can never hold it. The server
   * exposes no route that would return a secret, a code or a QR image for
   * somebody else's account, so this file has nothing to omit.
   */
  resetFor: (userId: string, reauthToken: string) =>
    request<MfaResetResultDto>(`/users/${userId}/mfa/reset`, { body: { reauthToken } }),
};

export type MfaRepository = typeof mfaRepository;
