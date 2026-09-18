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
  accessToken: string;
  expiresIn: number;
  user: Session;
};
