/**
 * The request core. One fetch wrapper, four cross-cutting behaviours.
 *
 * Split out of `src/admin/lib/api.ts`, which was 633 lines of this plus every
 * endpoint in the application on one object (weakness W1). What stayed here is
 * only what is true of *every* request:
 *
 * 1. **The access token is attached**, and kept in memory only — never in
 *    `localStorage`. A token in storage survives the tab and is readable by
 *    any script that gets onto the page; one in a module variable dies with
 *    the tab. The *refresh* token is an `httpOnly` cookie the server sets, so
 *    reloading the page still restores the session without either credential
 *    being reachable from JavaScript.
 * 2. **A 401 refreshes once and retries.** Access tokens last fifteen minutes,
 *    so an editor who spends twenty minutes writing a job advert would
 *    otherwise lose it on save. The single in-flight refresh promise means a
 *    screen firing six parallel requests refreshes once, not six times.
 * 3. **The envelope is unwrapped.** The server returns `{ data: … }`; callers
 *    get the payload. Unconditionally — `EnvelopeInterceptor` wraps every
 *    successful body with no inspection, and a shape test here would collide
 *    with the domain, because `ContentEntry` has a real `data` column. That
 *    exact test existed once and rendered the entry editor blank.
 * 4. **Errors arrive as one type.** `ApiError` carries the machine-readable
 *    `code` and the per-field validation messages, so a form can put each
 *    message beside its input instead of showing a banner.
 *
 * Everything above this line is transport. The shapes that come back are a
 * *feature's* business and live in its `repository.ts`.
 */

export type ApiErrorBody = {
  statusCode: number;
  code: string;
  message: string;
  fields?: Record<string, string[]>;
  path?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string[]>;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = body.statusCode;
    this.code = body.code;
    this.fields = body.fields;
  }

  /** True when the server rejected the *input* rather than the caller. */
  get isValidation(): boolean {
    return this.code === "validation_failed" || this.status === 422;
  }
}

/**
 * Where the API is. Empty means same origin, which is what a deployment that
 * puts the dashboard behind the same host wants.
 */
export const BASE = (import.meta.env.VITE_CMS_API ?? "").replace(/\/$/, "");
export const PREFIX = "/api/v1";

let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Called when a refresh fails — the shell uses it to return to the login screen. */
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

/** Internal, for `download.ts`, which is the one other thing that sends a request. */
export function notifyUnauthenticated() {
  onUnauthenticated?.();
}

/**
 * What a refresh attempt concluded.
 *
 * Three outcomes rather than a boolean, because **two of them used to be the
 * same value and the difference decides whether somebody gets signed out.** The
 * old `false` meant both "the server refused this session" and "the request
 * never arrived", so a dropped connection at the wrong moment — a laptop
 * changing network, a server restarting, a tunnel reconnecting — ended the
 * session and threw away whatever was on screen. The session was still perfectly
 * valid; nobody had asked anything.
 *
 * `offline` is therefore not a sign-out. The call it interrupted fails and says
 * so, and the next request tries again.
 */
export type RefreshOutcome =
  /** A new access token is in hand. */
  | "renewed"
  /** The server refused: no cookie, expired, revoked, replayed. Sign out. */
  | "rejected"
  /** Unreachable or broken. Say nothing about the session. */
  | "offline";

/**
 * The in-flight refresh, shared by every request that hits a 401 at once.
 *
 * Without this, a dashboard page that loads content, media and users in
 * parallel would fire three refreshes; the server rotates the refresh token on
 * each, so the second and third would present an already-revoked token — which
 * the server correctly treats as replay and responds to by ending every
 * session. The bug would look like "the dashboard logs me out at random".
 */
let refreshing: Promise<RefreshOutcome> | null = null;

/**
 * How long a tab waits for another tab's refresh before going ahead anyway.
 *
 * The lock is an optimisation, not a correctness requirement — the server's
 * grace window is what makes a lost race harmless — so waiting for ever on a
 * tab that has been frozen or is sitting on a hung socket would trade a rare
 * double-refresh for a dashboard that never loads.
 */
const LOCK_WAIT_MS = 5_000;

/**
 * Runs the refresh under a cross-tab lock where the browser has one.
 *
 * The in-flight promise above dedupes within *one* JavaScript context and can
 * do nothing about a second tab, which is where the problem actually was: every
 * tab restores its session on boot, so opening two at once sent two refreshes
 * carrying the same cookie. The second arrived after the first had rotated it,
 * the server read that as a replayed credential, and it answered the way it
 * should — by revoking every session the account had. Both tabs fell to the
 * login screen, and so did the phone in the user's pocket.
 *
 * `navigator.locks` makes the tabs take turns, so the second one presents the
 * cookie the first one was issued. It is a secure-context API and is absent in
 * old browsers and in a test environment, so its absence has to be survivable —
 * and it is, because `REFRESH_GRACE_MS` on the server tolerates exactly the race
 * this prevents. Belt and braces, and each was argued on its own.
 */
async function withRefreshLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return run();

  // Aborting the *wait* (not the work) puts a ceiling on how long one stuck tab
  // can hold everyone else up. An aborted wait rejects, which is why this is in
  // a try: the fallback is simply to go ahead unlocked.
  const signal =
    typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(LOCK_WAIT_MS)
      : undefined;

  try {
    return await locks.request("iem.auth.refresh", signal ? { signal } : {}, run);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return run();
    throw err;
  }
}

export async function refreshSession(): Promise<RefreshOutcome> {
  refreshing ??= (async () => {
    try {
      return await withRefreshLock(async () => {
        const res = await fetch(`${BASE}${PREFIX}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        /*
          A 5xx is the server having a bad day, not an answer about this
          session. Reading it as a refusal is what turned a thirty-second
          restart into everybody being signed out — and the sign-out is the
          expensive half, because the access token in memory is then gone and
          the session cannot come back by itself.

          **A 429 is the same kind of non-answer, and it was missed when the
          5xx case was fixed.** `ThrottlerGuard` runs before the controller, so
          a rate-limited refresh never reaches `AuthService` and the cookie is
          never examined: nothing is revoked, no audit row is written, and the
          presented token stays live. Reading that as "the server refused this
          session" signs the user out of a session that is still perfectly
          valid — the precise failure the three-valued outcome above exists to
          prevent, arriving through the one status code it did not cover.

          It is reachable in production rather than only under test. The limit
          is 60/minute **per IP** and this firm sits behind one office address,
          so the budget is shared by everybody in the building — and every tab
          refreshes when it boots. A Monday morning is enough. It was found by
          the e2e suite, where a burst of page loads tripped it and two
          navigation tests failed as `Hauptnavigation not found` over a
          screenshot of the login form, with the database showing the token
          still unrevoked.
        */
        if (res.status >= 500 || res.status === 429) return "offline";
        if (!res.ok) return "rejected";
        const body = (await res.json()) as { data: { accessToken: string } };
        accessToken = body.data.accessToken;
        return "renewed";
      });
    } catch {
      // `fetch` rejects for DNS, refused connections, CORS and aborts — every
      // one of which is "we could not ask", never "the answer was no".
      return "offline";
    } finally {
      // Cleared in a microtask so every caller awaiting this promise reads the
      // same result before the next 401 can start a second refresh.
      queueMicrotask(() => {
        refreshing = null;
      });
    }
  })();
  return refreshing;
}

export type QueryValue = string | number | boolean | undefined | null;

export type RequestOptions = {
  method?: string;
  body?: unknown;
  /** Sent as-is; used for uploads. Sets no `Content-Type` — the browser does. */
  formData?: FormData;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /** Internal: prevents a refreshed request from refreshing again. */
  retried?: boolean;
};

/** Shared by `request` and `download`, so a query string is built one way. */
export function buildUrl(path: string, query?: Record<string, QueryValue>): URL {
  const url = new URL(`${BASE}${PREFIX}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  return url;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, options.query);

  const headers: Record<string, string> = { accept: "application/json" };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(url.toString(), {
    method: options.method ?? (options.body || options.formData ? "POST" : "GET"),
    headers,
    body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    // The refresh cookie has to ride along, and it is `sameSite: lax` +
    // `httpOnly`, so `include` is required for a cross-origin dashboard.
    credentials: "include",
    signal: options.signal,
  });

  if (res.status === 401 && !options.retried) {
    const outcome = await refreshSession();
    if (outcome === "renewed") {
      return request<T>(path, { ...options, retried: true });
    }
    // `offline` deliberately falls through without ending the session: the
    // refresh never reached the server, so nothing has been said about whether
    // this session is still good. The 401 below is reported to the caller, the
    // screen shows an error, and the next request tries again.
    if (outcome === "rejected") onUnauthenticated?.();
  }

  if (res.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new ApiError(
      (payload as ApiErrorBody | null) ?? {
        statusCode: res.status,
        code: "network_error",
        message: `Die Anfrage ist fehlgeschlagen (${res.status}).`,
      },
    );
  }

  return (payload as { data: T })?.data as T;
}
