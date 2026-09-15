/**
 * Every permission the system knows about.
 *
 * This file is the source of truth, not the database. A guard checks a key,
 * and that key has to be spelled somewhere in the source anyway — so letting
 * an administrator invent one through the UI could only ever produce a
 * permission that grants nothing and is checked by nothing. The seeder
 * reconciles the `Permission` table against this list on every boot: new keys
 * are inserted, and keys that have disappeared from here are reported rather
 * than silently dropped, because a role may still reference one.
 *
 * **Permissions, not pages.** The spec asks for a permission system rather than
 * a page-based one, and the difference shows up in `content.publish`: the
 * dashboard has no "publish page", publishing is an action reachable from the
 * entry list, the entry editor, the review queue and the API. One permission
 * covers all four. A page-based model would need the same rule written in four
 * places and would drift.
 *
 * The naming is `<resource>.<action>`, always singular resource, always a verb
 * that appears in the UI. `content.entry.update` rather than `edit_content`.
 */

export type PermissionDef = {
  key: string;
  resource: string;
  action: string;
  category: string;
  description: string;
};

function p(
  resource: string,
  action: string,
  category: string,
  description: string,
): PermissionDef {
  return { key: `${resource}.${action}`, resource, action, category, description };
}

export const PERMISSIONS: PermissionDef[] = [
  // ---- Content ----------------------------------------------------
  p("content", "read", "Inhalte", "Inhalte und Entwürfe ansehen"),
  p("content", "create", "Inhalte", "Neue Einträge anlegen"),
  p("content", "update", "Inhalte", "Bestehende Einträge bearbeiten"),
  p("content", "delete", "Inhalte", "Einträge löschen"),
  p("content", "reorder", "Inhalte", "Reihenfolge von Einträgen ändern"),
  p("content", "submit", "Inhalte", "Einträge zur Freigabe einreichen"),
  p("content", "approve", "Inhalte", "Eingereichte Einträge freigeben oder ablehnen"),
  p("content", "publish", "Inhalte", "Freigegebene Inhalte veröffentlichen"),
  p("content", "unpublish", "Inhalte", "Veröffentlichte Inhalte zurückziehen"),
  p("content", "archive", "Inhalte", "Einträge archivieren und wiederherstellen"),
  p("content", "schedule", "Inhalte", "Veröffentlichung terminieren"),
  p("content", "rollback", "Inhalte", "Auf eine frühere Version zurücksetzen"),
  p("content", "duplicate", "Inhalte", "Einträge duplizieren"),
  p("content", "preview", "Inhalte", "Unveröffentlichte Inhalte in der Vorschau ansehen"),
  p("content", "history", "Inhalte", "Versionsverlauf und Vergleiche ansehen"),
  p("content", "export", "Inhalte", "Inhalte exportieren"),
  p("content", "import", "Inhalte", "Inhalte importieren"),

  // ---- Content types ----------------------------------------------
  p("contentType", "read", "Inhaltstypen", "Inhaltstypen ansehen"),
  p("contentType", "update", "Inhaltstypen", "Inhaltstypen und ihre Felder ändern"),

  // ---- Media -------------------------------------------------------
  p("media", "read", "Medien", "Medienbibliothek ansehen"),
  p("media", "upload", "Medien", "Dateien hochladen"),
  p("media", "update", "Medien", "Metadaten, Alt-Text und Ordner ändern"),
  p("media", "replace", "Medien", "Datei durch eine neue Version ersetzen"),
  p("media", "delete", "Medien", "Dateien löschen"),
  p("media", "download", "Medien", "Originaldateien herunterladen"),
  p("media", "folder", "Medien", "Ordner anlegen, umbenennen, verschieben"),

  // ---- Users and access --------------------------------------------
  p("user", "read", "Benutzer", "Benutzerliste ansehen"),
  p("user", "create", "Benutzer", "Benutzer einladen"),
  p("user", "update", "Benutzer", "Benutzerprofile bearbeiten"),
  p("user", "delete", "Benutzer", "Benutzer deaktivieren oder löschen"),
  p("user", "assign", "Benutzer", "Rollen zuweisen"),
  p("user", "impersonate", "Benutzer", "Als anderer Benutzer anmelden"),
  p("role", "read", "Rollen", "Rollen und Berechtigungen ansehen"),
  p("role", "create", "Rollen", "Eigene Rollen anlegen"),
  p("role", "update", "Rollen", "Berechtigungen einer Rolle ändern"),
  p("role", "delete", "Rollen", "Eigene Rollen löschen"),

  // ---- Applications -------------------------------------------------
  p("application", "read", "Bewerbungen", "Eingegangene Bewerbungen ansehen"),
  p("application", "update", "Bewerbungen", "Status und Notizen bearbeiten"),
  p("application", "download", "Bewerbungen", "Bewerbungsunterlagen herunterladen"),
  p("application", "delete", "Bewerbungen", "Bewerbungen löschen"),
  p("application", "export", "Bewerbungen", "Bewerbungen exportieren"),

  // ---- Settings and system ------------------------------------------
  p("settings", "read", "Einstellungen", "Einstellungen ansehen"),
  p("settings", "update", "Einstellungen", "Einstellungen ändern"),
  p("settings", "secrets", "Einstellungen", "Geheime Werte wie SMTP-Passwörter sehen und ändern"),
  p("seo", "read", "SEO", "SEO-Einstellungen und Weiterleitungen ansehen"),
  p("seo", "update", "SEO", "Meta-Angaben, Weiterleitungen, robots.txt ändern"),
  p("audit", "read", "System", "Audit-Log ansehen"),
  p("audit", "export", "System", "Audit-Log exportieren"),
  p("system", "health", "System", "Systemzustand und Kennzahlen ansehen"),
  p("system", "backup", "System", "Sicherungen erstellen und einspielen"),
  p("system", "api", "System", "API-Schlüssel und Integrationen verwalten"),
];

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
