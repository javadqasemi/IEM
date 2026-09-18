import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, clearQueryCache, setAccessToken, setUnauthenticatedHandler } from "@/core/api";
import { publishAuthChange, subscribeAuthChanges } from "./channel";
import { authRepository } from "./repository";
import type { Session } from "./types";

type AuthState = {
  user: Session | null;
  /** True until the first session restore attempt has finished. */
  loading: boolean;
  /**
   * The server could not be reached while restoring the session.
   *
   * Deliberately **not** the same state as "nobody is signed in". Showing the
   * sign-in form when the API is down invites somebody to type their password
   * into a screen that cannot accept it, and then tells them the credentials
   * were wrong. The shell renders an explanation and a retry instead.
   */
  unreachable: boolean;
  /** A session that was live ended by itself — expired, or revoked elsewhere. */
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  /** Re-runs the restore, for the retry button on the unreachable screen. */
  retry: () => Promise<void>;
  /** Whether the signed-in user holds a permission. Super Admin always does. */
  can: (permission: string) => boolean;
  /** Whether they hold *any* of several — for showing a nav section. */
  canAny: (...permissions: string[]) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

/**
 * Session state for the whole dashboard.
 *
 * **The access token lives in memory, not in storage.** Restoring a session
 * after a reload therefore means asking the server: the refresh token is an
 * `httpOnly` cookie, so `POST /auth/refresh` succeeds without the page ever
 * being able to read the credential. That is one request on boot, and in
 * exchange neither token is reachable by injected script.
 *
 * `can()` is checked against the permission list the server returned, never
 * against a role name. The dashboard hides what a user cannot do, but hiding
 * is a courtesy — the server re-checks every call, so a hidden button that
 * someone reaches anyway still gets a 403.
 *
 * **Three states, not two.** Signed in, signed out, and *could not ask* — see
 * `unreachable`. Collapsing the third into the second is what made a server
 * restart look like a sign-out, and a sign-out is the expensive reading: the
 * access token is dropped, so the session cannot come back on its own even
 * though the cookie was valid the whole time.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  /**
   * What is on screen, readable from a callback that is registered once.
   *
   * The unauthenticated handler below needs to know whether it is ending a
   * session somebody was *using* — which is worth explaining to them — or
   * merely confirming that a visitor who was never signed in still is not.
   * Written in an effect rather than during render, so the React Compiler rule
   * about refs has nothing to say about it.
   */
  const hadSession = useRef(false);
  useEffect(() => {
    hadSession.current = user !== null;
  }, [user]);

  const reload = useCallback(async () => {
    try {
      setUser(await authRepository.me());
    } catch {
      setUser(null);
    }
  }, []);

  /**
   * Turns whatever credential the browser is holding into a session, or says
   * why it could not.
   *
   * The refresh outcome is three-valued and each branch means something
   * different to the person looking at the screen: a new token (carry on), a
   * refusal (sign-in form), or an unreachable server (an explanation, and the
   * session left alone).
   */
  const restore = useCallback(async () => {
    const outcome = await authRepository.refresh();

    if (outcome === "offline") {
      setUnreachable(true);
      setUser(null);
      return;
    }
    if (outcome === "rejected") {
      setUnreachable(false);
      setUser(null);
      return;
    }

    try {
      setUser(await authRepository.me());
      setUnreachable(false);
      setSessionExpired(false);
    } catch (err) {
      // The refresh succeeded, so there *is* a session — this is the profile
      // that did not arrive. A 401 in the gap between the two calls means it
      // was revoked in between and the sign-in form is right; anything else is
      // the server, and claiming the visitor is signed out would be a guess.
      setUser(null);
      setUnreachable(!(err instanceof ApiError && err.status === 401));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // A refresh cookie may exist from a previous visit; if it does, this
      // turns it into a live session before the first screen renders.
      await restore();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [restore]);

  useEffect(() => {
    // Fired by the API client when a refresh is *refused* mid-session — the
    // token was revoked, the account suspended, or the server restarted with a
    // new secret. A refresh that merely failed to arrive does not come here;
    // see `RefreshOutcome`.
    setUnauthenticatedHandler(() => {
      setAccessToken(null);
      clearQueryCache();
      // Only worth saying when there was something to lose. A visitor who was
      // never signed in does not need to be told their session ended.
      if (hadSession.current) setSessionExpired(true);
      setUser(null);
    });
  }, []);

  /**
   * What the other tabs did.
   *
   * Both directions matter and they are not symmetrical. A sign-out elsewhere
   * has already revoked the cookie every tab shares, so there is nothing to ask
   * the server — dropping the session locally is the whole of it. A sign-in
   * elsewhere may be a *different person*, so the in-memory token is discarded
   * before re-reading: it belongs to whoever was here before, and the cookie now
   * belongs to whoever just arrived.
   */
  useEffect(
    () =>
      subscribeAuthChanges((message) => {
        setAccessToken(null);
        clearQueryCache();
        if (message.type === "signed-out") {
          setSessionExpired(false);
          setUser(null);
          return;
        }
        setSessionExpired(false);
        void restore();
      }),
    [restore],
  );

  const login = useCallback(async (email: string, password: string) => {
    const result = await authRepository.login(email, password);
    setAccessToken(result.accessToken);
    // Emptied *before* the new user's first render. Anything still cached was
    // fetched under the previous session on this tab.
    clearQueryCache();
    setSessionExpired(false);
    setUnreachable(false);
    setUser(result.user);
    publishAuthChange({ type: "signed-in" });
  }, []);

  const logout = useCallback(async () => {
    try {
      await authRepository.logout();
    } finally {
      // Local state is cleared even if the call failed — the alternative
      // leaves someone looking at a dashboard they believe they have left.
      setAccessToken(null);
      clearQueryCache();
      setSessionExpired(false);
      setUser(null);
      // Said last, and said whatever happened above: the other tabs are showing
      // a session whose cookie is gone, and the one thing they must not do is
      // keep drawing it until their own token runs out.
      publishAuthChange({ type: "signed-out" });
    }
  }, []);

  const retry = useCallback(async () => {
    setLoading(true);
    await restore();
    setLoading(false);
  }, [restore]);

  const value = useMemo<AuthState>(() => {
    const permissions = new Set(user?.permissions ?? []);
    const can = (permission: string) =>
      Boolean(user) && (user!.isSuperAdmin || permissions.has(permission));
    return {
      user,
      loading,
      unreachable,
      sessionExpired,
      login,
      logout,
      reload,
      retry,
      can,
      canAny: (...keys: string[]) => keys.some(can),
    };
  }, [user, loading, unreachable, sessionExpired, login, logout, reload, retry]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth muss innerhalb von <AuthProvider> verwendet werden.");
  return ctx;
}

/** Convenience for the common single-permission check. */
export function useCan(permission: string): boolean {
  return useAuth().can(permission);
}
