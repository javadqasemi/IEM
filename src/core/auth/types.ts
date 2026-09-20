/**
 * The signed-in session.
 *
 * It lives in `core/` rather than in `entities/user/` because it is
 * *infrastructure*: the permission list is what `can()` answers from and what
 * the router guards on, and both of those are below the domain. An `Employee`
 * — the person, with a workload and a department — is a business entity and
 * will live in `entities/`; the two are deliberately different records
 * (`docs/data-model.md` §3.15).
 */
export type Session = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  locale: string;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  roles: { key: string; name: string }[];
  /**
   * Resolved by the server on **every** request, not cached in a token. So
   * revoking a role takes effect immediately, and this copy is only what the
   * client draws with.
   */
  permissions: string[];
  /** Short-circuits `can()` on the role key, never on holding every permission. */
  isSuperAdmin: boolean;
};

export type LoginResult = {
  mfaRequired?: false;
  accessToken: string;
  expiresIn: number;
  user: Session;
  /** Present only when the session was opened with a recovery code. */
  usedRecoveryCode?: boolean;
  /** How many unused codes are left afterwards. `-1` when none was used. */
  remainingRecoveryCodes?: number;
};

/**
 * The password was right and the second factor has not been shown.
 *
 * A `challenge` and nothing else — no access token, no cookie. It grants the
 * right to present a code against one account for five minutes and nothing
 * more, which is why it is safe to hold in component state.
 */
export type MfaRequired = {
  mfaRequired: true;
  challenge: string;
  expiresIn: number;
};

/**
 * What signing in produces, as a union rather than an optional field.
 *
 * The server returns the same shape for the same reason it does there: a
 * caller that forgets the branch must not end up with half a session. Here
 * the forgetting would look like `setUser(undefined)` and a blank dashboard;
 * `kind` on the discriminant makes it a compile error instead.
 */
export type LoginOutcome = LoginResult | MfaRequired;

/** The open re-authentication window — see `widgets/reauth`. */
export type RecentAuth = { token: string; expiresAt: string };
