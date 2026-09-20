/**
 * The second factor, as the dashboard thinks about one.
 *
 * Local to this feature rather than in `entities/`, which is the rule: a type
 * moves up when a *second* module needs it, and today the only screens that
 * read this are the two in here. The nearest candidate for the second reader
 * is a future security-overview dashboard tile, and it can move then.
 *
 * Dates are `Date` here and ISO strings on the wire; `mapper.ts` is the only
 * thing that has seen both.
 */
export type MfaStatus = {
  /**
   * Whether the *server* can do MFA — `MFA_ENCRYPTION_KEY` is configured.
   *
   * Separate from `enabled`, and the distinction is what stops the settings
   * panel's oldest mistake repeating: "this feature is off for you" and
   * "this feature was never set up on this server" look identical as one
   * grey dot, and the first gets waited on for ever.
   */
  available: boolean;
  enabled: boolean;
  method: "TOTP" | null;
  verifiedAt: Date | null;
  lastUsedAt: Date | null;
  /** An enrolment was started and not finished. */
  pending: boolean;
  pendingExpiresAt: Date | null;
  recoveryCodes: {
    total: number;
    remaining: number;
    /** Few enough that the screen says so without being asked. */
    low: boolean;
  };
};

/** The QR symbol as geometry, so the screen draws it in its own colours. */
export type QrMatrix = { size: number; path: string };

/** Everything the setup dialog needs. The secret is here exactly once. */
export type Enrolment = {
  /** For an authenticator being set up by hand, in groups of four. */
  secretGrouped: string;
  /** The same secret unspaced, for the copy button. */
  secret: string;
  otpauthUri: string;
  qr: QrMatrix;
  expiresAt: Date;
};

/** A fresh set, formatted `XXXXX-XXXXX`, shown exactly once. */
export type RecoveryCodes = { codes: string[]; generatedAt: Date };
