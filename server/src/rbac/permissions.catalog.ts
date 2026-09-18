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
      "task.read", "task.readAll", "task.export",
      "meeting.read", "meeting.readAll", "meeting.export",
      "decision.read", "decision.export",
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
      /*
        Aufgaben, at the same reach as projects: the whole firm's book, no
        delete. `task.updateOwn` is absent and it is not an oversight — a grant
        that widens nothing beside `task.update` would be noise in the role
        editor, and `mayWrite` short-circuits on the wide key.
      */
      "task.read", "task.readAll", "task.create", "task.update", "task.assign",
      "task.comment", "task.export",
      /*
        The full set on both, `supersede` included.

        Reversing a decision the firm has already taken is the authority
        `docs/permissions.md` §3.11 puts at this level and at the Projektleitung
        `◐` below — it is the one action in the module that says the firm no
        longer stands by what it agreed.
      */
      "meeting.read", "meeting.readAll", "meeting.create", "meeting.update",
      "meeting.hold", "meeting.approve", "meeting.sendMinutes", "meeting.export",
      "decision.read", "decision.create", "decision.update", "decision.supersede",
      "decision.export",
      /*
        Pläne: reads everything, issues, withdraws — and **checks and releases
        nothing**.

        `docs/permissions.md` §3.10 puts `check` and `release` at `○` for the
        Geschäftsleitung, which looks like an oversight and is the opposite: they
        are *technical* acts. Somebody who has not opened the drawing should not
        be the one certifying that it was checked, however senior they are.
        `issue` is theirs because it is a commercial act — a plan leaving the
        building is the firm's liability — and `withdraw` follows `issue` for
        the same reason.
      */
      "drawing.read", "drawing.readAll", "drawing.create", "drawing.update",
      "drawing.issue", "drawing.withdraw", "drawing.export",
      "transmittal.read", "transmittal.create", "transmittal.acknowledge",
      "transmittal.export",
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
      /*
        The full set, minus `readAll` — a Projektleiter's tasks are their
        projects' tasks, and `tasks.scope.ts` narrows to exactly that. They hold
        `task.delete` because a board fills with cards somebody opened by
        mistake, and unlike a project a task has nothing hanging off it that a
        soft delete would orphan.
      */
      "task.read", "task.create", "task.update", "task.assign", "task.delete",
      "task.comment", "task.export",
      /*
        Without `readAll`: a Projektleiter's meetings are their projects'
        meetings and the ones they sat in — `meetings.scope.ts` narrows to
        exactly that. They hold `hold`, `approve` and `sendMinutes` because
        running the Bausitzung, closing its protocol and sending it out is the
        job; `decision.supersede` is the §3.11 `◐`, and the scope is what makes
        it their own projects only.
      */
      "meeting.read", "meeting.create", "meeting.update", "meeting.hold",
      "meeting.approve", "meeting.sendMinutes", "meeting.delete", "meeting.export",
      "decision.read", "decision.create", "decision.update", "decision.supersede",
      "decision.export",
      /*
        Pläne: everything except `readAll`, and that includes `check` and
        `release`.

        In a firm this size the Projektleiter is an engineer who also runs the
        project, and `docs/permissions.md` §3.10 grants them both. The four-eyes
        rule still applies and is not a permission: `drawings.rules.ts` refuses
        a check by whoever drew it, whatever the checker holds.
      */
      "drawing.read", "drawing.create", "drawing.update", "drawing.check",
      "drawing.release", "drawing.issue", "drawing.withdraw", "drawing.delete",
      "drawing.export",
      "transmittal.read", "transmittal.create", "transmittal.acknowledge",
      "transmittal.export",
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
      /**
       * **The role `task.updateOwn` exists for**, and the reason the key is in
       * the catalogue at all.
       *
       * An engineer moves their own card across the board, ticks their own
       * checklist and asks questions on anybody's. They cannot reassign work,
       * cannot edit a colleague's card, and cannot delete. `task.create` is
       * granted because the person doing the work is the one who discovers the
       * next piece of it; without it every task has to be opened by a
       * Projektleiter, which is how a board stops reflecting the site.
       */
      "task.read", "task.create", "task.updateOwn", "task.comment",
      /*
        An engineer reads the minutes of the meetings they sat in and writes
        the protocol of none. `decision.create` is granted because a decision
        taken on site is still a decision and the person who was there is the
        one who can record it; `supersede` is not, because reversing one is a
        different authority.
      */
      "meeting.read",
      "decision.read", "decision.create",
      /*
        **The role Drawings was built around.** An engineer draws, checks and
        releases — `docs/permissions.md` §3.10 puts `check` and `release` at `●`
        here and `issue` at `○`, which is the whole shape of the module: the
        technical acts are theirs, and putting the plan in a contractor's hands
        is not.

        `drawing.update` rather than an `updateOwn` of the kind Tasks needed:
        a plan is the project's artefact, not the draftsman's, and two people
        working the same sheet is the normal case. The four-eyes rule is what
        stops that being a problem, and it is a rule rather than a permission.

        `transmittal.read` and no `create`: they see who received what, which is
        what they need to answer a contractor's question, and they do not send.
      */
      "drawing.read", "drawing.create", "drawing.update", "drawing.check",
      "drawing.release", "drawing.export",
      "transmittal.read",
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
      /*
        `readAll` without `update` again, and for the reason the project half
        gives: it is the combination that catches a guard which checks "may this
        person reach the module" and forgets "may they write". Finance reads and
        exports; it opens no cards and ticks nothing.
      */
      "task.read", "task.readAll", "task.export",
      /*
        Read and export, no writes — the same stance as on projects and tasks.
        `decision.read` matters here more than elsewhere: a decision with a
        cost impact is a number Finance has to be able to find.
      */
      "meeting.read", "meeting.readAll", "meeting.export",
      "decision.read", "decision.export",
      /*
        Read and export again, and `transmittal.read` is the one that earns its
        place: a Planversand is what a variation order is argued from — "die
        Ausführungspläne gingen am 14. März raus" is a date Finance needs when a
        Nachtrag lands. They check nothing and release nothing.
      */
      "drawing.read", "drawing.readAll", "drawing.export",
      "transmittal.read", "transmittal.export",
      "customer.read", "building.read", "employee.read", "discipline.read",
      "content.read", "content.preview",
      "contentType.read", "media.read",
      "system.health",
    ],
  },
];
