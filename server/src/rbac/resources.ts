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
];
