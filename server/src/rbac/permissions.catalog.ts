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
      /*
        §3.9: read and export across the business modules, for support — and
        deliberately nothing more. An administrator maintains the system; that
        is not the same as being entitled to its contents, and the audit log
        records any attempt. `project.update` is absent on purpose.
      */
      "project.read", "project.readAll", "project.export",
      "customer.read", "building.read", "employee.read", "discipline.read",
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
    /*
      §3.6 gives HR `read ●` on Projects — not `◐`, and not nothing.

      It reads as too much until you ask what HR does with it: staffing a
      project, approving its hours and planning absences all need to know
      which projects exist and who is on them. What HR does *not* get is any
      write, any export and any financial figure. The review's sketch said
      "keine Projektdetails"; the matrix is narrower in the way that matters
      (no writes) and wider in the way that does not (the list is visible),
      and the matrix is what the tests assert.
    */
    description: "Stellen und Team pflegen, Bewerbungen bearbeiten, Projekte zur Planung einsehen.",
    rank: 30,
    isSystem: true,
    permissions: [
      "content.read", "content.create", "content.update", "content.reorder",
      "content.submit", "content.duplicate", "content.preview", "content.history",
      "contentType.read",
      "media.read", "media.upload", "media.update",
      "application.read", "application.update", "application.download", "application.export",
      "system.health",
      // Read only, and no export: staffing a project needs the list, not a
      // spreadsheet of what it is worth.
      "project.read", "project.readAll",
      "employee.read", "discipline.read",
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

  /* ===================================================================
     The operational roles

     `docs/permissions.md` §5 held these back with a rule worth repeating:
     **a role is seeded in the same commit as the module that gives it
     something to do.** A "Projektleiter" who could only edit website copy
     would be exactly the permission-that-grants-nothing problem the audit
     raised. Projects now exists, so these four arrive with it — and
     `draftsman` does not, because every cell that distinguishes it from
     `engineer` is in a module that is still unbuilt.

     The master-data reads (`customer` `building` `employee` `discipline`)
     come with `project.read` on every one of them, and that is not
     generosity: a project row renders its Bauherrschaft's name and its
     object's, the pickers need the lists, and a role that could open a
     project and not see who it is for would be a role that cannot use the
     screen it was granted.
     =================================================================== */

  /**
   * The Geschäftsleitung. Sees the firm's whole book, decides, exports.
   *
   * **`readAll` yes, `manageTeam` no**, which looks backwards until you read
   * the matrix (§3.2): the `manage` column is `○` for Management on Projects.
   * Composing a project team is the Projektleiter's job and stays there;
   * Management's business is which projects exist, what state they are in and
   * what they are worth. A role that can do everything is a role nobody can
   * reason about.
   */
  {
    key: "management",
    name: "Geschäftsleitung",
    description:
      "Sieht alle Projekte der Firma, legt an, ändert und exportiert — führt aber kein Projektteam.",
    // 5, not the 10 `docs/permissions.md` §5 proposed: `administrator` already
    // holds 10, `rank` is only display order and is not unique in the schema,
    // and two roles sharing one sort arbitrarily in the role editor. The
    // operational roles interleave rather than renumbering the CMS ones.
    rank: 5,
    isSystem: true,
    permissions: [
      "project.read", "project.readAll", "project.create", "project.update",
      "project.archive", "project.export",
      "customer.read", "building.read", "employee.read", "discipline.read",
      "content.read", "content.preview", "content.history",
      "contentType.read", "media.read",
      "user.read", "role.read",
      "audit.read", "system.health",
    ],
  },

  /**
   * The Projektleiter — and the reason `project.readAll` is a separate key.
   *
   * They hold `project.read` and **not** `readAll`, so `projects.scope.ts`
   * narrows every list and every detail to the projects they manage or sit on.
   * That is the `◐` in §3.3 made real: it is a grant somebody can be given
   * later, visible in the role editor, rather than a role name compared inside
   * a service.
   *
   * `project.delete` is withheld and `project.archive` is granted, which is the
   * distinction those two permissions exist for: a Projektleiter closes their
   * own work without being able to remove anyone's.
   */
  {
    key: "project_manager",
    name: "Projektleitung",
    description:
      "Führt die eigenen Projekte: Team, Gewerke, Termine, Status. Sieht nur Projekte, in denen sie steht.",
    rank: 15,
    isSystem: true,
    permissions: [
      "project.read", "project.create", "project.update", "project.archive",
      "project.manageTeam", "project.manageDisciplines", "project.manageMilestones",
      "project.export",
      "customer.read", "building.read", "employee.read", "discipline.read",
      "content.read", "content.preview",
      "contentType.read", "media.read",
      "system.health",
    ],
  },

  /**
   * An engineer reads the projects they are on and writes none of them.
   *
   * Their work is in Tasks, Drawings, BIM and Time Tracking — none of which
   * exists yet, which is why this role looks thin. It is thin *now*; it is not
   * a placeholder, because `project.read` without `readAll` is already a real
   * and testable rule.
   */
  {
    key: "engineer",
    name: "Ingenieur:in",
    description: "Sieht die eigenen Projekte. Fachliche Arbeit folgt mit Aufgaben, Plänen und BIM.",
    rank: 45,
    isSystem: true,
    permissions: [
      "project.read",
      "customer.read", "building.read", "employee.read", "discipline.read",
      "content.read", "content.preview",
      "contentType.read", "media.read",
      "system.health",
    ],
  },

  /**
   * Finance reads every project and changes none.
   *
   * The Finance *module* is Wave 3, so this role holds nothing of its own yet —
   * it is seeded now because reading and exporting the firm's projects is
   * already its job (§3.7), and because a security matrix with a hole where
   * Finance should be is a matrix that proves less than it looks.
   *
   * `readAll` without `update`: the combination that catches a guard which
   * checks "may this person reach the module" and forgets "may they write".
   */
  {
    key: "finance",
    name: "Finanzen",
    description: "Sieht und exportiert alle Projekte. Kaufmännische Module folgen in Wave 3.",
    rank: 25,
    isSystem: true,
    permissions: [
      "project.read", "project.readAll", "project.export",
      "customer.read", "building.read", "employee.read", "discipline.read",
      "content.read", "content.preview",
      "contentType.read", "media.read",
      "system.health",
    ],
  },
];
