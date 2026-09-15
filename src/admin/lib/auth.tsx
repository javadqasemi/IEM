import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setAccessToken, setUnauthenticatedHandler, type Me } from "./api";

type AuthState = {
  user: Me | null;
  /** True until the first session restore attempt has finished. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
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
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // A refresh cookie may exist from a previous visit; if it does, this
      // turns it into a live session before the first screen renders.
      const restored = await api.refresh();
      if (cancelled) return;
      if (restored) await reload();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    // Fired by the API client when a refresh fails mid-session — the token
    // was revoked, the account suspended, or the server restarted with a new
    // secret. Clearing the user drops the shell back to the sign-in screen.
    setUnauthenticatedHandler(() => {
      setAccessToken(null);
      setUser(null);
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    setAccessToken(result.accessToken);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      // Local state is cleared even if the call failed — the alternative
      // leaves someone looking at a dashboard they believe they have left.
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthState>(() => {
    const permissions = new Set(user?.permissions ?? []);
    const can = (permission: string) =>
      Boolean(user) && (user!.isSuperAdmin || permissions.has(permission));
    return {
      user,
      loading,
      login,
      logout,
      reload,
      can,
      canAny: (...keys: string[]) => keys.some(can),
    };
  }, [user, loading, login, logout, reload]);

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
