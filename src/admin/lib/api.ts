import { download, request, type Paginated } from "@/core/api";
import type { FieldDef } from "@/shared/ui/forms";

/**
 * The dashboard's endpoint surface, **pre-migration**.
 *
 * The transport that used to live at the top of this file — token handling,
 * the single in-flight refresh, the envelope, `ApiError` — moved to
 * `@/core/api` and is unchanged. What is left is the thing weakness W1 is
 * about: every endpoint in the application as a property of one object. At
 * nineteen more modules this would be ~4'000 lines and every screen would
 * import the whole surface.
 *
 * It is **deliberately still here.** The firm's review set the rule that a
 * pattern gets one fully tested reference implementation before it is copied
 * (`docs/enterprise-architecture.md` §3.1.1), so exactly one group — the job
 * applications — has moved to `features/applications/` with all five layers.
 * Fanning the other eight out at the same time would be copying a shape that
 * had not yet been driven once, which is the thing the rule forbids.
 *
 * Each group below moves to its feature's `repository.ts` + `mapper.ts` once
 * that reference is validated. Nothing here needs to change for that to
 * happen — a group leaves, its call sites change, and the rest is untouched.
 */

export type { Paginated };
export type { FieldDef };

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
  /** What the live site is showing. Absent until the entry has been published. */
  publishedData?: Record<string, unknown> | null;
  /** Kept, but left out of the site from the next publish on. */
  hidden?: boolean;
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
  /**
   * Whether this account has a verified second factor.
   *
   * A mirror of `MfaCredential` kept on `User` so the list does not need a
   * join — the server writes it in the same transaction as the credential,
   * and no *decision* is taken from it on either side. Under `user.read`
   * rather than a key of its own: it reveals nothing the way a session's IP
   * and device do. See `rbac/resources.ts`.
   */
  mfaEnabled: boolean;
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
  /**
   * Stored and editable, but read by no code yet.
   *
   * A property of the server's own definition list rather than of the row —
   * whether a setting has a consumer is decided by what imports it. The screen
   * draws these as explicitly not-yet-connected instead of as live controls.
   */
  pending: boolean;
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

/**
 * What publishing now would change on the live site.
 *
 * Not the same question as "how many entries are approved", which is what the
 * publish screen used to ask: a deletion never becomes `APPROVED`, so removing
 * a person left the screen claiming there was nothing to do.
 */
export type PendingChanges = {
  liveVersion: number | null;
  publishedAt: string | null;
  changed: boolean;
  changes: { key: string; label: string; live: number | null; next: number | null }[];
  /** Kept for the secondary list of approved entries. */
  approved: number;
};

/**
 * What the next publish would do to one entry, as a word the server derived.
 *
 * Mirrors `PublishEffect` in `server/src/content/content.rules.ts`. It is the
 * server's answer rather than one the screen works out from `status`, because
 * the interesting rows are exactly the ones a status cannot explain: a deleted
 * entry that is still live reads `DRAFT` and is about to disappear from the
 * site.
 */
export type PublishEffect = "PUBLISH" | "REPUBLISH" | "WITHDRAW" | "NONE";

export type QueueRow = {
  id: string;
  key: string;
  typeKey: string;
  status: WorkflowState;
  hidden: boolean;
  deleted: boolean;
  scheduledAt: string | null;
  publishedAt: string | null;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
  effect: PublishEffect;
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
  /*
   * Auth moved to `core/auth/repository.ts`. It is the one repository not owned
   * by a feature folder: the router, the client and every screen depend on the
   * session, so it sits below all of them rather than beside them.
   */

  /* ---- Content ---- */
  contentTypes: () => request<ContentTypeRow[]>("/content/types"),
  /**
   * The live document, exactly as a visitor gets it.
   *
   * The one place the dashboard reads *published* content rather than the
   * draft rows it owns, and it has to be the published one: the edit overlay
   * matches the words rendered in the preview frame, and the frame shows the
   * published site. Indexing drafts would mean looking up text that is not on
   * the page.
   */
  publishedSnapshot: () =>
    request<{ version: number; publishedAt: string; content: Record<string, unknown> }>(
      "/content/published",
    ),
  /**
   * Takes one entry off the site, or puts it back.
   *
   * A draft change like any other: the entry stays on the live site until the
   * next publish. Not a delete — the row, its versions and its review state
   * are untouched, and the call back is the same one with `false`.
   */
  setEntryVisibility: (id: string, hidden: boolean) =>
    request<EntryRow>(`/content/entries/${id}/visibility`, {
      method: "PATCH",
      body: { hidden },
    }),
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
  pendingChanges: () => request<PendingChanges>("/content/pending"),

  /* ---- Publishing: the three verbs added in P2-3 ---- */

  /**
   * Takes one entry off the live site.
   *
   * `expectedVersion` is required by the DTO, not optional-with-a-default. A
   * withdrawal of what somebody else has just re-approved and republished
   * reads, from outside, like the site losing a page for no reason — so the
   * server answers 409 and the screen offers a reload rather than a retry.
   *
   * It republishes as a side effect: the public site serves a snapshot, so
   * clearing the published copy without building a new one would leave the
   * entry looking withdrawn here and still visible to every visitor.
   */
  unpublishEntry: (id: string, expectedVersion: number, note?: string) =>
    request<{ entry: string; snapshot: number; warnings: string[] }>(
      `/content/entries/${id}/unpublish`,
      { method: "POST", body: { expectedVersion, note } },
    ),

  /** Sets when an approved entry goes live. `PUT`, so re-scheduling is one call. */
  scheduleEntry: (id: string, at: string, expectedVersion: number) =>
    request<{ id: string; scheduledAt: string }>(`/content/entries/${id}/schedule`, {
      method: "PUT",
      body: { at, expectedVersion },
    }),

  /** Clears a pending schedule. Refuses when there is none — see the rule. */
  cancelSchedule: (id: string) =>
    request<{ id: string; scheduledAt: null }>(`/content/entries/${id}/schedule`, {
      method: "DELETE",
    }),

  /** Everything pending, scheduled or about to be withdrawn, with the effect. */
  publishingQueue: () => request<{ items: QueueRow[] }>("/content/queue"),

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

  /*
   * Applications moved to `features/applications/repository.ts` — the
   * reference implementation of the five layers (architecture §3.1.1).
   */

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
  /** Downloads the filtered audit log as CSV. A call, not an href — see `download`. */
  downloadAuditExport: (query: Record<string, string | undefined>) =>
    download("/audit/export", {
      query,
      fallbackName: `audit-${new Date().toISOString().slice(0, 10)}.csv`,
    }),
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
