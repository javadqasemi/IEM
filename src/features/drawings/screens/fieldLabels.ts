/**
 * The DTO's property names, in German.
 *
 * `EntityVersion.changed` holds what the update DTO carried — `disciplineId`,
 * `checkedById` — and putting those on screen would make the history readable
 * only by whoever wrote the API. A missing key falls through to the raw name
 * rather than blanking the line: a wrong word beats a missing one, because a
 * reader can see that it is wrong.
 */
export const FIELD_LABELS: Record<string, string> = {
  number: "Plannummer",
  title: "Titel",
  type: "Typ",
  scale: "Massstab",
  format: "Format",
  phase: "SIA-Phase",
  status: "Status",
  disciplineId: "Gewerk",
  buildingId: "Gebäude",
  drawnById: "Gezeichnet von",
  checkedById: "Geprüft von",
  approvedById: "Freigegeben von",
  currentRevision: "Revision",
  issuedRevision: "Ausgegebene Revision",
};
