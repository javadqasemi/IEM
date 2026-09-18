import { RESOURCES } from "./resources";

/**
 * Every permission the system knows about — **derived**, not typed.
 *
 * `resources.ts` is where a module declares what it is and what can be done to
 * it; this file flattens those declarations into the list the guard, the
 * seeder and the role editor all read. Foundation stage F6.
 *
 * It remains the source of truth, not the database. A guard checks a key, and
 * that key has to be spelled somewhere in the source anyway — so letting an
 * administrator invent one through the UI could only ever produce a permission
 * that grants nothing and is checked by nothing. The seeder reconciles the
 * `Permission` table against this list on every boot: new keys are inserted,
 * and keys that have disappeared are reported rather than silently dropped,
 * because a role may still reference one.
 */

export type PermissionDef = {
  key: string;
  resource: string;
  action: string;
  category: string;
  description: string;
};

export const PERMISSIONS: PermissionDef[] = RESOURCES.flatMap((r) =>
  Object.entries(r.actions).map(([action, description]) => ({
    key: `${r.key}.${action}`,
    resource: r.key,
    action,
    category: r.category,
    description,
  })),
);

export const PERMISSION_KEYS = PERMISSIONS.map((x) => x.key);

/** Compile-time-ish helper so a typo in a guard shows up as a failing lookup. */
export function perm(key: string): string {
  if (!PERMISSION_KEYS.includes(key)) {
    throw new Error(`Unknown permission "${key}" — add it to permissions.catalog.ts`);
  }
  return key;
}

/**
 * The roles that ship with the install.
 *
 * `superAdmin` is marked by a flag rather than by holding every key: a role
 * that merely *lists* all permissions would silently stop being omnipotent the
 * moment a new one is added to the catalogue, which is precisely when you
 * least want the one account that can fix things to lose access. `PermissionsGuard`
 * short-circuits on the flag.
 *
 * Every other role's list is exhaustive and deliberate. Note that **only Super
 * Admin holds `content.publish`** — that is the spec's approval workflow: an
 * editor submits, a manager approves, and publishing stays with the owner.
 */
export type RoleDef = {
  key: string;
  name: string;
  description: string;
  rank: number;
  isSystem: boolean;
  /** `"*"` grants everything, now and in future. Only Super Admin has it. */
  permissions: string[] | "*";
};

export const SYSTEM_ROLES: RoleDef[] = [
  {
    key: "super_admin",
    name: "Super Admin",
    description:
      "Vollzugriff. Einzige Rolle, die veröffentlichen, Rollen ändern und das System konfigurieren darf.",
    rank: 0,
    isSystem: true,
    permissions: "*",
  },
  {
    key: "administrator",
    name: "Administrator",
    description:
      "Verwaltet Inhalte, Medien, Benutzer und Einstellungen — veröffentlicht aber nicht.",
    rank: 10,
    isSystem: true,
    permissions: [
      "content.read", "content.create", "content.update", "content.delete",
      "content.reorder", "content.submit", "content.approve", "content.archive",
      "content.schedule", "content.rollback", "content.duplicate", "content.preview",
      "content.history", "content.export",
      "contentType.read",
      "media.read", "media.upload", "media.update", "media.replace", "media.delete",
      "media.download", "media.folder",
      "user.read", "user.create", "user.update", "user.assign",
      "role.read",
      "application.read", "application.update", "application.download", "application.export",
      "settings.read", "settings.update",
      "seo.read", "seo.update",
      "audit.read",
      "system.health",
    ],
  },
  {
    key: "manager",
    name: "Manager",
    description: "Prüft und gibt Inhalte frei, sieht Bewerbungen und Kennzahlen.",
    rank: 20,
    isSystem: true,
    permissions: [
      "content.read", "content.create", "content.update", "content.reorder",
      "content.submit", "content.approve", "content.schedule", "content.duplicate",
      "content.preview", "content.history",
      "contentType.read",
      "media.read", "media.upload", "media.update", "media.folder",
      "user.read", "role.read",
      "application.read", "application.update", "application.download",
      "settings.read", "seo.read",
      "audit.read", "system.health",
    ],
  },
  {
    key: "hr",
    name: "HR",
    description: "Stellen und Team pflegen, Bewerbungen bearbeiten.",
    rank: 30,
    isSystem: true,
    permissions: [
      "content.read", "content.create", "content.update", "content.reorder",
      "content.submit", "content.duplicate", "content.preview", "content.history",
      "contentType.read",
      "media.read", "media.upload", "media.update",
      "application.read", "application.update", "application.download", "application.export",
      "system.health",
    ],
  },
  {
    key: "marketing",
    name: "Marketing",
    description: "Texte, Referenzen, Medien und SEO pflegen.",
    rank: 40,
    isSystem: true,
    permissions: [
      "content.read", "content.create", "content.update", "content.reorder",
      "content.submit", "content.duplicate", "content.preview", "content.history",
      "contentType.read",
      "media.read", "media.upload", "media.update", "media.replace", "media.folder",
      "seo.read", "seo.update",
      "system.health",
    ],
  },
  {
    key: "engineering",
    name: "Engineering",
    description: "Fachliche Inhalte — Dienstleistungen, Referenzen, Ablauf.",
    rank: 50,
    isSystem: true,
    permissions: [
      "content.read", "content.create", "content.update", "content.reorder",
      "content.submit", "content.duplicate", "content.preview", "content.history",
      "contentType.read",
      "media.read", "media.upload", "media.update",
      "system.health",
    ],
  },
  {
    key: "sales",
    name: "Sales",
    description: "Referenzen und Standorte pflegen, Kennzahlen ansehen.",
    rank: 60,
    isSystem: true,
    permissions: [
      "content.read", "content.create", "content.update", "content.submit",
      "content.preview", "content.history",
      "contentType.read",
      "media.read", "media.upload",
      "system.health",
    ],
  },
  {
    key: "support",
    name: "Support",
    description: "Liest alles, bearbeitet Bewerbungen, ändert keine Inhalte.",
    rank: 70,
    isSystem: true,
    permissions: [
      "content.read", "content.preview", "content.history",
      "contentType.read",
      "media.read",
      "application.read", "application.update",
      "audit.read", "system.health",
    ],
  },
  {
    key: "content_editor",
    name: "Content Editor",
    description: "Schreibt und reicht ein — veröffentlicht nicht.",
    rank: 80,
    isSystem: true,
    permissions: [
      "content.read", "content.create", "content.update", "content.reorder",
      "content.submit", "content.duplicate", "content.preview", "content.history",
      "contentType.read",
      "media.read", "media.upload", "media.update",
    ],
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Liest Inhalte und Medien, ändert nichts.",
    rank: 90,
    isSystem: true,
    permissions: ["content.read", "content.preview", "content.history", "contentType.read", "media.read"],
  },
  {
    key: "guest",
    name: "Guest",
    description: "Nur Vorschau eines freigegebenen Standes.",
    rank: 100,
    isSystem: true,
    permissions: ["content.read", "content.preview"],
  },
];
