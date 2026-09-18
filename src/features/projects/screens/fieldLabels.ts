/**
 * A project's field names, in German.
 *
 * The version history records which properties a writer touched, and those are
 * the *API's* names — `plannedEndDate`, `contractValue`. Putting them on screen
 * would make the history readable only by whoever wrote the endpoint, which is
 * the opposite of what a record kept for clients and auditors is for.
 *
 * A separate file rather than a constant in the tab, because the same mapping
 * is what a diff view and an export will need, and because the moment it lives
 * inside a component it grows a second copy somewhere else.
 *
 * An unknown key falls through to itself. That is the same rule the site's
 * `{token}` placeholders follow: a field added to the DTO and forgotten here
 * shows its raw name, which is ugly and legible, rather than blanking the line.
 */
export const FIELD_LABELS: Record<string, string> = {
  name: "Projektname",
  architectId: "Architektur",
  buildingId: "Gebäude",
  managerId: "Projektleitung",
  officeId: "Standort",
  priority: "Priorität",
  currentPhase: "Phase",
  startDate: "Start",
  plannedEndDate: "geplantes Ende",
  actualEndDate: "tatsächliches Ende",
  contractValue: "Auftragswert",
  budgetHours: "Sollstunden",
  description: "Beschreibung",
  notes: "interne Notizen",
  versionNote: "Änderungsgrund",
};
