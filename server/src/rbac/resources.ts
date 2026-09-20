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
    /*
      Sessions are two keys rather than one, and separate from `user.read`.

      Seeing where somebody is signed in means seeing their IP addresses, their
      devices and their working hours — which is more than "may look at the
      user list", and is why `manager` holds `user.read` and neither of these.

      They are split from each other for the reason the catalogue splits
      everything: reading is support work and revoking is an intervention that
      interrupts somebody mid-task. A role that should be able to answer "is
      this account signed in somewhere it should not be" does not have to be
      the role that acts on the answer.

      Nothing here duplicates the caller's own sessions. Those are on
      `/auth/sessions` and carry no permission at all — they are the account's
      own, like `/auth/me`, and a key every role had to be granted would mean
      nothing.
    */
    readSessions: "Aktive Sitzungen eines Benutzers ansehen",
    revokeSessions: "Sitzungen eines Benutzers beenden",
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

  /**
   * The firm itself — and the reason `updateLegal` is not folded into `update`.
   *
   * Changing the main telephone number and changing the UID are both writes to
   * one row, and they are not the same authority. The first is an office
   * administrator's daily work; the second is what appears in the commercial
   * register, on every invoice and in the Impressum, and getting it wrong is a
   * legal problem rather than an inconvenience. The same argument that split
   * `drawing.check` from `drawing.release` splits these.
   *
   * There is no `create` and no `delete`: the organisation is a singleton that
   * is upserted into existence and never removed. A key for an operation that
   * has no route would be one more dead permission in the role editor, which is
   * the problem F6 was built to end.
   */
  resource("organisation", "Unternehmen", "Unternehmen", {
    read: "Unternehmensangaben ansehen",
    update: "Allgemeine Angaben, Kontakte und Website-Vorgaben ändern",
    updateLegal: "Rechtliche Angaben ändern — UID, Handelsregister, MWST, Sitz",
  }),

  /**
   * Standorte, and the one key that is not CRUD.
   *
   * **`archive` is separate from `delete`**, the same distinction Projects
   * makes and for the same reason: an office that has closed still has
   * employees, projects and buildings pointing at it, and its history has to
   * keep resolving. Deleting one is only ever correct for a row created by
   * mistake, and `organisation.rules.ts` refuses it outright once anything
   * references it — so `delete` is the rarer permission and archiving is the
   * operation that actually exists for a closed office.
   */
  resource("office", "Standorte", "Unternehmen", {
    read: "Standorte ansehen",
    create: "Standorte anlegen",
    update: "Standortdaten bearbeiten",
    archive: "Standorte archivieren und wiederherstellen",
    delete: "Standorte löschen",
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
   * Sitzungen, and the two keys that are not CRUD.
   *
   * **`hold` is separate from `update`.** Marking a Bausitzung as held is what
   * turns a plan into a record: after it, the protocol is a document people
   * cite. Somebody who may correct a typo in an agenda is not necessarily
   * somebody who may declare that a meeting took place.
   *
   * **`approve` is the authority over the record itself.** Minutes are approved
   * at the *next* meeting, and once approved the protocol is closed to editing
   * — `refuseProtocolEdit` enforces that regardless of who holds `update`. The
   * key is therefore not "may edit more"; it is "may decide that this is what
   * was said", which is the Projektleitung's and the Geschäftsleitung's.
   *
   * `sendMinutes` is its own key because it is **outward-facing**: it puts a
   * document in front of the Bauherrschaft, and that is a different act from
   * writing it.
   */
  resource("meeting", "Sitzungen", "Projekte", {
    read: "Sitzungen und Protokolle der eigenen Projekte ansehen",
    readAll: "Alle Sitzungen der Firma ansehen",
    create: "Sitzungen ansetzen",
    update: "Traktanden und Protokoll bearbeiten",
    hold: "Eine Sitzung als durchgeführt festhalten",
    approve: "Protokolle genehmigen",
    sendMinutes: "Protokolle versenden",
    delete: "Sitzungen löschen",
    export: "Sitzungslisten exportieren",
  }),

  /**
   * Entscheide — `docs/permissions.md` §3.11.
   *
   * **`supersede` is separate from `update`**, and the document says why in one
   * line: *"`update` is corrections; reversing a decision is its own
   * authority."* Correcting a typo in a rationale and declaring that the firm
   * no longer stands by what it agreed are not the same act, and the second is
   * the one that gets looked up in a dispute.
   *
   * There is no `readAll`: a decision is always about a project, so "which
   * decisions may I see" is already answered by `project.readAll`. A second
   * widening key would be one more row in the role editor meaning the same
   * thing — see `seesAllDecisions`.
   */
  resource("decision", "Entscheide", "Projekte", {
    read: "Entscheide ansehen",
    create: "Entscheide festhalten",
    update: "Entscheide korrigieren",
    supersede: "Entscheide aufheben und ersetzen",
    delete: "Entscheide löschen",
    export: "Entscheidlisten exportieren",
  }),

  /**
   * Pläne — `docs/permissions.md` §3.10, and the resource with the most extra
   * keys in the catalogue.
   *
   * **Four, because gezeichnet, geprüft, freigegeben and ausgegeben are four
   * different people's authority in an engineering office.** Collapsing them
   * into `update` and `approve` loses the distinction that matters most:
   *
   * | | |
   * | --- | --- |
   * | `check` | somebody other than the draftsman has looked at it. The four-eyes rule is in `drawings.rules.ts`, because the question is not what the caller holds but whose name is in the other column |
   * | `release` | **internal**. Approved in-house, and nothing has left the building |
   * | `issue` | **external**. Somebody is now building from it, and that is a liability rather than a workflow step |
   * | `withdraw` | the plan is wrong and everyone holding it must be told |
   *
   * `release` and `issue` are held by different roles on purpose: an engineer
   * checks and releases, and issuing is usually the project manager's. A single
   * `approve` would have made the person who signs off the drawing the same
   * person who ships it, which is exactly the pair this office separates.
   */
  resource("drawing", "Pläne", "Projekte", {
    read: "Pläne der eigenen Projekte ansehen",
    readAll: "Alle Pläne der Firma ansehen",
    create: "Pläne anlegen und Revisionen hochladen",
    update: "Planangaben bearbeiten",
    check: "Pläne prüfen",
    release: "Pläne intern freigeben",
    issue: "Pläne ausgeben und versenden",
    withdraw: "Pläne zurückziehen",
    delete: "Pläne löschen",
    export: "Planlisten exportieren",
  }),

  /**
   * Planversand — and it has **no `update` and no `delete`**, by design.
   *
   * A transmittal is a statement about the past: *"diese Revisionen sind am
   * 14. März an diese Empfänger gegangen"*. Correcting one means issuing
   * another, the same reason `AuditLog` has no API to edit a row. The absence
   * is enforced by there being no route rather than by a rule, which is the
   * cheapest enforcement there is.
   *
   * `acknowledge` exists because the recipient's confirmation is a separate
   * fact from the sending, and the person recording it is usually not the
   * person who sent it.
   */
  resource("transmittal", "Planversand", "Projekte", {
    read: "Planversände ansehen",
    create: "Pläne versenden",
    acknowledge: "Empfang bestätigen",
    export: "Versandlisten exportieren",
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
