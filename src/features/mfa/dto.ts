/**
 * The wire shapes, and nothing else.
 *
 * These names may appear in `repository.ts` and `mapper.ts` and nowhere above
 * them — `src/architecture.test.ts` enforces it.
 *
 * **What is not here is the point of the module.** There is no secret on any
 * shape below except `EnrolmentStartDto`, which carries one *once*, during
 * setup, because there is no other way to put a secret into an authenticator
 * app by hand. Nothing else the server will ever send contains a secret, a
 * ciphertext or a stored recovery code: the status carries counts, and a
 * fresh set of codes is returned by the call that created it and by nothing
 * afterwards.
 */

export type MfaStatusDto = {
  /** Whether this server is configured for MFA at all. */
  available: boolean;
  enabled: boolean;
  method: "TOTP" | null;
  verifiedAt: string | null;
  lastUsedAt: string | null;
  pending: boolean;
  pendingExpiresAt: string | null;
  recoveryCodes: { total: number; remaining: number; low: boolean };
};

/** The QR symbol as geometry — see the server's `mfa.qr.ts` for why. */
export type QrMatrixDto = {
  /** Modules per side, not pixels. */
  size: number;
  /** SVG path data in module units. */
  path: string;
};

export type EnrolmentStartDto = {
  secret: string;
  secretGrouped: string;
  otpauthUri: string;
  qr: QrMatrixDto;
  expiresAt: string;
};

export type RecoveryCodeSetDto = { codes: string[]; generatedAt: string };

export type MfaResetResultDto = { hadFactor: boolean; sessionsRevoked: number };
