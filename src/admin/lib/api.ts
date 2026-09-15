/**
 * The dashboard's single HTTP client.
 *
 * Every request in the application goes through `api`. That is what makes four
 * cross-cutting behaviours exist once rather than in forty call sites:
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
 *    get the payload.
 * 4. **Errors arrive as one type.** `ApiError` carries the machine-readable
 *    `code` and the per-field validation messages, so a form can put each
 *    message beside its input instead of showing a banner.
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

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
};

/**
 * Where the API is. Empty means same origin, which is what a deployment that
 * puts the dashboard behind the same host wants.
 */
const BASE = (import.meta.env.VITE_CMS_API ?? "").replace(/\/$/, "");
const PREFIX = "/api/v1";

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

async function refreshSession(): Promise<boolean> {
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

type RequestOptions = {
  method?: string;
  body?: unknown;
  /** Sent as-is; used for uploads. Sets no `Content-Type` — the browser does. */
  formData?: FormData;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Internal: prevents a refreshed request from refreshing again. */
  retried?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${BASE}${PREFIX}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

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

/* ------------------------------------------------------------------ */
/* The typed surface                                                   */
/* ------------------------------------------------------------------ */

export type Me = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  locale: string;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  roles: { key: string; name: string }[];
  permissions: string[];
  isSuperAdmin: boolean;
};

export type ContentTypeRow = {
  key: string;
  kind: "SINGLETON" | "COLLECTION";
  name: string;
  description: string | null;
  schema: FieldDef[];
  contentKey: string;
  orderable: boolean;
  icon: string | null;
  rank: number;
};

export type FieldDef = {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  help?: string;
  options?: { value: string; label: string }[];
  optionsFrom?: string;
  of?: string;
  fields?: FieldDef[];
  maxLength?: number;
  min?: number;
  max?: number;
  tokens?: boolean;
};

export type WorkflowState =
  | "DRAFT"
  | "IN_REVIEW"
  | "APPROVED"
  | "PUBLISHED"
  | "ARCHIVED"
  | "REJECTED";

export type EntryRow = {
  id: string;
  typeKey: string;
  key: string;
  data: Record<string, unknown>;
  status: WorkflowState;
  position: number;
  version: number;
  updatedAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
  updatedBy?: { id: string; name: string } | null;
  _count?: { versions: number };
};

export type VersionRow = {
  id: string;
  version: number;
  data: Record<string, unknown>;
  status: WorkflowState;
  note: string | null;
  createdAt: string;
  author?: { id: string; name: string } | null;
};

export type ReviewRow = {
  id: string;
  state: string;
  message: string | null;
  createdAt: string;
  entry: { id: string; key: string; typeKey: string; status: WorkflowState };
  version: { version: number; data: Record<string, unknown> };
  requestedBy: { id: string; name: string; email: string } | null;
};

export type MediaRow = {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string;
  altDecorative: boolean;
  caption: string | null;
  copyright: string | null;
  tags: string[];
  folderId: string | null;
  version: number;
  createdAt: string;
  url: string;
  srcset: string;
  deduplicated?: boolean;
};

export type UserRow = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  status: "INVITED" | "ACTIVE" | "SUSPENDED";
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  roles: { role: { id: string; key: string; name: string; rank: number } }[];
};

export type RoleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  rank: number;
  permissions: { permission: { id: string; key: string } }[];
  _count?: { users: number };
};

export type PermissionGroup = {
  category: string;
  permissions: { id: string; key: string; resource: string; action: string; description: string | null }[];
};

export type ApplicationRow = {
  id: string;
  position: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  availableFrom: string | null;
  message: string | null;
  files: { originalName: string; size: number; mimeType: string }[];
  status: string;
  note: string | null;
  createdAt: string;
  retainUntil: string | null;
};

export type AuditRow = {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actorEmail: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  outcome: "SUCCESS" | "FAILURE" | "DENIED";
  message: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
};

export type SettingRow = {
  key: string;
  group: string;
  value: unknown;
  description: string | null;
  secret: boolean;
  hasValue: boolean;
  updatedAt: string;
};

export type SnapshotRow = {
  id: string;
  version: number;
  note: string | null;
  restoredFrom: number | null;
  publishedAt: string;
  publishedBy: { id: string; name: string; email: string } | null;
};

export type Overview = {
  kpis: Record<string, number>;
  content: Record<string, number>;
  lastPublish: {
    version: number;
    publishedAt: string;
    note: string | null;
    publishedBy: { name: string } | null;
  } | null;
  recentActivity: AuditRow[];
  recentEdits: EntryRow[];
  missingMetrics: { key: string; label: string; reason: string }[];
};

export const api = {
  /* ---- Auth ---- */
  login: (email: string, password: string) =>
    request<{ accessToken: string; expiresIn: number; user: Me }>("/auth/login", {
      body: { email, password },
    }),
  refresh: refreshSession,
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<Me>("/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/auth/change-password", { body: { currentPassword, newPassword } }),
  forgotPassword: (email: string) =>
    request<{ message: string }>("/auth/forgot-password", { body: { email } }),
  resetPassword: (token: string, password: string) =>
    request<void>("/auth/reset-password", { body: { token, password } }),

  /* ---- Content ---- */
  contentTypes: () => request<ContentTypeRow[]>("/content/types"),
  entries: (query: Record<string, string | number | undefined>) =>
    request<Paginated<EntryRow>>("/content/entries", { query }),
  entry: (id: string) =>
    request<EntryRow & { type: ContentTypeRow; versions: VersionRow[] }>(`/content/entries/${id}`),
  createEntry: (typeKey: string, data: unknown, key?: string) =>
    request<EntryRow>("/content/entries", { body: { typeKey, data, key } }),
  updateEntry: (id: string, data: unknown, note?: string) =>
    request<EntryRow>(`/content/entries/${id}`, { method: "PATCH", body: { data, note } }),
  deleteEntry: (id: string) => request<void>(`/content/entries/${id}`, { method: "DELETE" }),
  restoreEntry: (id: string) => request<EntryRow>(`/content/entries/${id}/restore`, { method: "POST" }),
  duplicateEntry: (id: string) => request<EntryRow>(`/content/entries/${id}/duplicate`, { method: "POST" }),
  reorder: (typeKey: string, ids: string[]) =>
    request<void>("/content/entries/reorder", { body: { typeKey, ids } }),
  versions: (id: string) => request<VersionRow[]>(`/content/entries/${id}/versions`),
  diff: (id: string, from: number, to: number) =>
    request<{
      from: { version: number; createdAt: string };
      to: { version: number; createdAt: string };
      changes: { key: string; before: unknown; after: unknown }[];
    }>(`/content/entries/${id}/diff`, { query: { from, to } }),
  rollback: (id: string, version: number) =>
    request<EntryRow>(`/content/entries/${id}/rollback/${version}`, { method: "POST" }),
  submit: (id: string, message?: string) =>
    request<void>(`/content/entries/${id}/submit`, { body: { message } }),
  reviews: () => request<ReviewRow[]>("/content/reviews"),
  decide: (id: string, decision: "APPROVED" | "REJECTED", note?: string) =>
    request<void>(`/content/reviews/${id}/decide`, { body: { decision, note } }),
  publish: (note?: string) =>
    request<{ version: number; publishedAt: string; entriesPublished: number; warnings: string[] }>(
      "/content/publish",
      { body: { note } },
    ),
  preview: () =>
    request<{ version: number; content: Record<string, unknown>; warnings: string[] }>(
      "/content/preview",
    ),
  snapshots: () => request<SnapshotRow[]>("/content/snapshots"),
  restoreSnapshot: (version: number) =>
    request<{ version: number; restoredFrom: number }>(`/content/snapshots/${version}/restore`, {
      method: "POST",
    }),

  /* ---- Media ---- */
  media: (query: Record<string, string | number | undefined>) =>
    request<Paginated<MediaRow>>("/media", { query }),
  mediaItem: (id: string) => request<MediaRow>(`/media/${id}`),
  mediaStats: () =>
    request<{ count: number; totalBytes: number; byType: { mimeType: string; count: number; bytes: number }[] }>(
      "/media/stats",
    ),
  folders: () => request<{ id: string; name: string; path: string; parentId: string | null; _count: { assets: number } }[]>("/media/folders"),
  createFolder: (name: string, parentId?: string | null) =>
    request<{ id: string }>("/media/folders", { body: { name, parentId } }),
  deleteFolder: (id: string) => request<void>(`/media/folders/${id}`, { method: "DELETE" }),
  upload: (form: FormData) => request<MediaRow>("/media/upload", { formData: form }),
  replaceMedia: (id: string, form: FormData) =>
    request<MediaRow>(`/media/${id}/replace`, { formData: form }),
  updateMedia: (id: string, body: Partial<MediaRow>) =>
    request<MediaRow>(`/media/${id}`, { method: "PATCH", body }),
  deleteMedia: (id: string) => request<void>(`/media/${id}`, { method: "DELETE" }),
  bulkDeleteMedia: (ids: string[]) =>
    request<void>("/media/bulk", { method: "DELETE", body: { ids } }),

  /* ---- Users and roles ---- */
  users: (query: Record<string, string | number | undefined>) =>
    request<Paginated<UserRow>>("/users", { query }),
  user: (id: string) => request<UserRow>(`/users/${id}`),
  inviteUser: (email: string, name: string, roleIds: string[]) =>
    request<UserRow>("/users", { body: { email, name, roleIds } }),
  updateUser: (id: string, body: Partial<UserRow>) =>
    request<UserRow>(`/users/${id}`, { method: "PATCH", body }),
  setUserRoles: (id: string, roleIds: string[]) =>
    request<UserRow>(`/users/${id}/roles`, { method: "PUT", body: { roleIds } }),
  deleteUser: (id: string) => request<void>(`/users/${id}`, { method: "DELETE" }),
  sendUserReset: (id: string) =>
    request<{ message: string }>(`/users/${id}/send-password-reset`, { method: "POST" }),
  roles: () => request<RoleRow[]>("/roles"),
  role: (id: string) => request<RoleRow>(`/roles/${id}`),
  createRole: (body: { key: string; name: string; description?: string; permissionIds: string[] }) =>
    request<RoleRow>("/roles", { body }),
  updateRole: (id: string, body: { name?: string; description?: string; permissionIds?: string[] }) =>
    request<RoleRow>(`/roles/${id}`, { method: "PATCH", body }),
  deleteRole: (id: string) => request<void>(`/roles/${id}`, { method: "DELETE" }),
  permissions: () => request<PermissionGroup[]>("/permissions"),

  /* ---- Applications ---- */
  applications: (query: Record<string, string | number | undefined>) =>
    request<Paginated<ApplicationRow>>("/applications", { query }),
  application: (id: string) => request<ApplicationRow>(`/applications/${id}`),
  updateApplication: (id: string, body: { status?: string; note?: string }) =>
    request<ApplicationRow>(`/applications/${id}`, { method: "PATCH", body }),
  deleteApplication: (id: string) => request<void>(`/applications/${id}`, { method: "DELETE" }),
  applicationStats: () =>
    request<{ total: number; byStatus: Record<string, number> }>("/applications/stats"),
  /** Not a fetch: the browser downloads it, with the bearer token unavailable —
      so the link carries the session cookie and the server checks the
      permission on the way through. */
  applicationFileUrl: (id: string, index: number) =>
    `${BASE}${PREFIX}/applications/${id}/files/${index}`,

  /* ---- Settings, audit, dashboard ---- */
  settings: () => request<{ group: string; settings: SettingRow[] }[]>("/settings"),
  updateSettings: (updates: { key: string; value: unknown }[]) =>
    request<{ group: string; settings: SettingRow[] }[]>("/settings", {
      method: "PATCH",
      body: { updates },
    }),
  audit: (query: Record<string, string | number | undefined>) =>
    request<Paginated<AuditRow>>("/audit", { query }),
  auditActions: () => request<{ action: string; count: number }[]>("/audit/actions"),
  auditExportUrl: (query: Record<string, string | undefined>) => {
    const url = new URL(`${BASE}${PREFIX}/audit/export`, window.location.origin);
    for (const [k, v] of Object.entries(query)) if (v) url.searchParams.set(k, v);
    return url.toString();
  },
  overview: () => request<Overview>("/dashboard/overview"),
  health: () =>
    request<{
      status: string;
      database: { status: string; latencyMs: number };
      seed: { permissions: { expected: number; actual: number }; contentTypes: { expected: number; actual: number }; inSync: boolean };
      snapshots: number;
      auditRows: number;
      uptimeSeconds: number;
      memory: { rssBytes: number; heapUsedBytes: number };
      node: string;
    }>("/dashboard/health"),
};
