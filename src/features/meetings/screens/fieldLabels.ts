/**
 * The DTO's property names, in German.
 *
 * `EntityVersion.changed` holds what the update DTO carried — `organiserId`,
 * `seriesNumber` — and putting those on screen would make the history readable
 * only by whoever wrote the API. A missing key falls through to the raw name
 * rather than blanking the line, which is the same bargain `derive.ts` makes on
 * the public site: a wrong word beats a missing one, because a reader can see
 * that it is wrong.
 *
 * Both entities' fields live in one map. They do not collide — and if they ever
 * did, they would mean the same thing anyway, because `title` on a decision and
 * `title` on a meeting are both a title.
 */
export const FIELD_LABELS: Record<string, string> = {
  /* Meeting */
  title: "Titel",
  type: "Art",
  status: "Status",
  location: "Ort",
  seriesNumber: "Nummer",
  startsAt: "Beginn",
  endsAt: "Ende",
  projectId: "Projekt",
  organiserId: "Leitung",
  minutesSentAt: "Protokollversand",

  /* Decision */
  rationale: "Begründung",
  decidedAt: "Entscheiddatum",
  decidedById: "Entschieden durch",
  decidedByExternal: "Entschieden durch (extern)",
  disciplineId: "Gewerk",
  impact: "Auswirkung",
  costImpact: "Kostenfolge",
  scheduleImpactDays: "Terminfolge",
  meetingId: "Sitzung",
  supersedesId: "Ersetzt",
};
