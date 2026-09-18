/**
 * What the system has, and what can be done to each of them.
 *
 * Foundation stage F6. The catalogue used to be 51 hand-written `p(...)` calls,
 * and weakness W7 is what that becomes at twenty-six modules: 182 entries plus
 * the ~45 that do not fit the grid, maintained by hand, drifting. It had
 * already drifted at 51 — twelve keys are selectable in the role editor and
 * guard no route at all.
 *
 * A module declares its resource here; `permissions.catalog.ts` derives the
 * flat list from it. Three things follow that a hand-written list cannot have:
 *
 * - **The role editor groups itself.** `label` and `category` come from the
 *   declaration, so a new module appears correctly with no UI change.
 * - **A permission that guards nothing is findable.** `permissions.agreement.test.ts`
 *   walks every `@RequirePermissions` in the tree and compares both directions.
 * - **Adding a module is adding an entry**, not editing a list in three places.
 *
 * The naming is `<resource>.<action>`: singular resource, and a verb that
 * appears in the UI. `content.update`, never `edit_content`.
 *
 * **Permissions, not pages.** The difference shows in `content.publish`: there
 * is no "publish page" — publishing is reachable from the entry list, the
 * editor, the review queue and the API, and one permission covers all four. A
 * page-based model would need the same rule in four places.
 */

export type ResourceDef = {
  /** The first half of every key. Singular. */
  key: string;
  /** How the role editor names the resource. */
  label: string;
  /** The heading it is grouped under. */
  category: string;
  /**
   * Action → the description an administrator reads while assigning it.
   *
   * A map rather than a list, because the description is the part that stops a
   * role editor being a wall of `content.rollback` and because it forces one
   * to exist. Insertion order is the order the editor shows them in.
   */
  actions: Record<string, string>;
};

function resource(
  key: string,
  label: string,
  category: string,
  actions: Record<string, string>,
): ResourceDef {
  return { key, label, category, actions };
}

export const RESOURCES: ResourceDef[] = [
  resource("content", "Inhalte", "Inhalte", {
    read: "Inhalte und Entwürfe ansehen",
    create: "Neue Einträge anlegen",
    update: "Bestehende Einträge bearbeiten",
    delete: "Einträge löschen",
    reorder: "Reihenfolge von Einträgen ändern",
    submit: "Einträge zur Freigabe einreichen",
    approve: "Eingereichte Einträge freigeben oder ablehnen",
    publish: "Freigegebene Inhalte veröffentlichen",
    unpublish: "Veröffentlichte Inhalte zurückziehen",
    archive: "Einträge archivieren und wiederherstellen",
    schedule: "Veröffentlichung terminieren",
    rollback: "Auf eine frühere Version zurücksetzen",
    duplicate: "Einträge duplizieren",
    preview: "Unveröffentlichte Inhalte in der Vorschau ansehen",
    history: "Versionsverlauf und Vergleiche ansehen",
    export: "Inhalte exportieren",
    import: "Inhalte importieren",
  }),

  resource("contentType", "Inhaltstypen", "Inhaltstypen", {
    read: "Inhaltstypen ansehen",
    update: "Inhaltstypen und ihre Felder ändern",
  }),

  resource("media", "Medien", "Medien", {
    read: "Medienbibliothek ansehen",
    upload: "Dateien hochladen",
    update: "Metadaten, Alt-Text und Ordner ändern",
    replace: "Datei durch eine neue Version ersetzen",
    delete: "Dateien löschen",
    download: "Originaldateien herunterladen",
    folder: "Ordner anlegen, umbenennen, verschieben",
  }),

  resource("user", "Benutzer", "Benutzer", {
    read: "Benutzerliste ansehen",
    create: "Benutzer einladen",
    update: "Benutzerprofile bearbeiten",
    delete: "Benutzer deaktivieren oder löschen",
    assign: "Rollen zuweisen",
    impersonate: "Als anderer Benutzer anmelden",
  }),

  resource("role", "Rollen", "Rollen", {
    read: "Rollen und Berechtigungen ansehen",
    create: "Eigene Rollen anlegen",
    update: "Berechtigungen einer Rolle ändern",
    delete: "Eigene Rollen löschen",
  }),

  resource("application", "Bewerbungen", "Bewerbungen", {
    read: "Eingegangene Bewerbungen ansehen",
    update: "Status und Notizen bearbeiten",
    download: "Bewerbungsunterlagen herunterladen",
    delete: "Bewerbungen löschen",
    export: "Bewerbungen exportieren",
  }),

  resource("settings", "Einstellungen", "Einstellungen", {
    read: "Einstellungen ansehen",
    update: "Einstellungen ändern",
    secrets: "Geheime Werte wie SMTP-Passwörter sehen und ändern",
  }),

  resource("seo", "SEO", "SEO", {
    read: "SEO-Einstellungen und Weiterleitungen ansehen",
    update: "Meta-Angaben, Weiterleitungen, robots.txt ändern",
  }),

  resource("audit", "Audit-Log", "System", {
    read: "Audit-Log ansehen",
    export: "Audit-Log exportieren",
  }),

  resource("system", "System", "System", {
    health: "Systemzustand und Kennzahlen ansehen",
    backup: "Sicherungen erstellen und einspielen",
    api: "API-Schlüssel und Integrationen verwalten",
  }),

  resource("job", "Hintergrundaufgaben", "System", {
    read: "Laufende und vergangene Hintergrundaufgaben ansehen",
    retry: "Fehlgeschlagene Aufgabe erneut ausführen",
    cancel: "Wartende Aufgabe abbrechen",
  }),

  /* ===================================================================
     The operational domain — Wave 1
     =================================================================== */

  /**
   * The reference module.
   *
   * Two things here are worth the reader's attention, because both are
   * choices the other eighteen modules will copy.
   *
   * **`readAll` is separate from `read`.** `permissions.md` writes the
   * row-level rule as `◐` — a Projektleiter sees the projects they manage or
   * are a member of, not the firm's whole book. Expressing that as a *second*
   * permission rather than as a role check keeps the rule in the catalogue,
   * where it is grantable, auditable and visible in the role editor, instead
   * of inside a service where nobody can see who has it. `ProjectScope` reads
   * exactly this key.
   *
   * **`archive` is not `delete`.** A project with time entries or invoices
   * against it is refused deletion outright; archiving is the operation that
   * actually exists for finished work, and giving it its own permission is
   * what lets a Projektleiter close their own project without being able to
   * remove one.
   */
  resource("project", "Projekte", "Projekte", {
    read: "Eigene Projekte ansehen",
    readAll: "Alle Projekte der Firma ansehen",
    create: "Projekte anlegen",
    update: "Projektdaten bearbeiten",
    delete: "Projekte löschen",
    archive: "Projekte abschliessen und archivieren",
    manageTeam: "Projektteam zusammenstellen",
    manageDisciplines: "Gewerke und deren Budget festlegen",
    manageMilestones: "Meilensteine planen und abnehmen",
    export: "Projektlisten exportieren",
  }),

  /* ===================================================================
     The operational domain — Wave 2
     =================================================================== */

  /**
   * Aufgaben, and the one place this catalogue gains a shape Projects did not
   * need.
   *
   * **`updateOwn` beside `update`.** Everywhere else in this system a write
   * permission is firm-wide and the *read* scope decides what can be reached.
   * That does not work for a board: an engineer must be able to move their own
   * card from `TODO` to `IN_PROGRESS` and tick their own checklist, and they
   * must not be able to reassign their colleague's work or change its deadline.
   * Row-level *write* is the `◐` this module needs, and the same argument that
   * put `readAll` in the catalogue puts this here — as a grant somebody can be
   * given, not as a role name compared inside a service.
   *
   * `tasks.scope.ts` → `ownsTask` is the predicate, and it is deliberately
   * *narrower* than the read scope: seeing a project's board does not make
   * every card on it yours.
   *
   * **`assign` is separate from `update`.** Who does the work is a planning
   * decision; when it is due is a project decision; what it says is neither.
   * Splitting them is what lets a Projektleiter staff their board without
   * holding the permission that rewrites its contents — and it is the key the
   * notification module will read to answer "who may have caused this".
   *
   * **No `archive`.** Projects has one because a finished project with invoices
   * against it must never be deleted. A task has nothing hanging off it that a
   * soft delete would orphan, so `CANCELLED` is the whole of "this will not
   * happen" and a second mechanism would be two answers to one question.
   */
  resource("task", "Aufgaben", "Projekte", {
    read: "Eigene Aufgaben und die der eigenen Projekte ansehen",
    readAll: "Alle Aufgaben der Firma ansehen",
    create: "Aufgaben anlegen",
    update: "Beliebige Aufgaben bearbeiten",
    updateOwn: "Eigene Aufgaben bearbeiten und auf dem Board verschieben",
    assign: "Aufgaben zuweisen",
    delete: "Aufgaben löschen",
    comment: "Aufgaben kommentieren",
    export: "Aufgabenlisten exportieren",
  }),

  /**
   * The Wave 1 master data, read-only for now — and that is the whole
   * declaration, deliberately.
   *
   * Each of these becomes a module with its own create/update/delete
   * (roadmap Wave 1 modules 1–3, Wave 3 module 18). Declaring those actions
   * *now* would put eight more keys in the role editor that grant nothing,
   * which is the twelve-dead-permissions problem F6 was built to end. A
   * resource grows when its routes do.
   */
  resource("customer", "Kunden", "Stammdaten", {
    read: "Kunden ansehen",
  }),

  resource("building", "Gebäude", "Stammdaten", {
    read: "Gebäude ansehen",
  }),

  resource("employee", "Mitarbeitende", "Stammdaten", {
    read: "Mitarbeitende ansehen",
  }),

  resource("discipline", "Gewerke", "Stammdaten", {
    read: "Gewerke ansehen",
  }),
];
