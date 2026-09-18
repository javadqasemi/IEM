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
 * The in-flight refresh, shared by every request that hits a 401 at once.
 *
 * Without this, a dashboard page that loads content, media and users in
 * parallel would fire three refreshes; the server rotates the refresh token on
 * each, so the second and third would present an already-revoked token — which
 * the server correctly treats as replay and responds to by ending every
 * session. The bug would look like "the dashboard logs me out at random".
 */
let refreshing: Promise<boolean> | null = null;

export async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}${PREFIX}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { data: { accessToken: string } };
      accessToken = body.data.accessToken;
      return true;
    } catch {
      return false;
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
    if (await refreshSession()) {
      return request<T>(path, { ...options, retried: true });
    }
    onUnauthenticated?.();
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
