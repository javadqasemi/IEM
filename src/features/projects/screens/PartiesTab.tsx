import type { ProjectDetail } from "@/entities/project";
import { Card, EmptyState } from "@/shared/ui/primitives";
import { Pair } from "@/shared/ui/data";
import { ModulePlaceholder } from "@/shared/ui/feedback";

/**
 * The two records this project *points at*: the Bauherrschaft and the object.
 *
 * **The clearest illustration of "container, not owner".** Neither is the
 * project's data. A customer exists before the project and outlives it; a
 * building outlives every project on it — which is the whole reason it is an
 * entity and not an address field, because the refurbishment ten years after
 * the Neubau should inherit its areas, its EGID and its systems.
 *
 * So these tabs show what this project needs to know and say plainly where the
 * record actually lives. When `features/customers` and `features/buildings`
 * exist, their screens are embedded here through `widgets/` and this file
 * imports nothing from them.
 */

export function CustomerTab({ project }: { project: ProjectDetail }) {
  if (!project.customer) {
    return (
      <EmptyState
        title="Keine Bauherrschaft"
        description="Das sollte nicht vorkommen — sie ist beim Anlegen Pflicht."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card title="Bauherrschaft">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Pair label="Name">{project.customer.name}</Pair>
          <Pair label="Kundennummer">
            <span className="font-mono">{project.customer.number}</span>
          </Pair>
        </dl>
      </Card>

      {project.architect ? (
        <Card
          title="Architektur"
          description="Ein zweites Unternehmen, kein Feld auf diesem Projekt — deshalb dieselbe Kundenkartei."
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <Pair label="Name">{project.architect.name}</Pair>
            <Pair label="Kundennummer">
              <span className="font-mono">{project.architect.number}</span>
            </Pair>
          </dl>
        </Card>
      ) : null}

      <ModulePlaceholder
        title="Kundendossier"
        description="Ansprechpersonen, Verlauf, Offerten, Verträge und offene Rechnungen dieser Bauherrschaft — an einem Ort, über alle Projekte hinweg."
        wave="Wave 3"
        rows={4}
      />
    </div>
  );
}

export function BuildingTab({ project }: { project: ProjectDetail }) {
  if (!project.building) {
    return (
      <EmptyState
        title="Kein Objekt zugeordnet"
        description="Ein Projekt ohne Gebäude lässt sich anlegen, aber Pläne, Räume und Mängel brauchen eines."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card title="Objekt">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Pair label="Bezeichnung">{project.building.name}</Pair>
          <Pair label="Gebäudenummer">
            <span className="font-mono">{project.building.number}</span>
          </Pair>
          <Pair label="Ort">{project.building.city ?? "—"}</Pair>
        </dl>
        {/*
          Stated on the screen because it changes what somebody expects to find
          here: edits to the building belong to the building, not to this
          project, and a second project on the same object shows the same data.
        */}
        <p className="mt-4 max-w-prose text-[12px] text-muted">
          Das Gebäude gehört nicht zu diesem Projekt. Es besteht vor dem Auftrag und überdauert
          ihn — ein zweiter Auftrag am selben Objekt erbt diese Daten.
        </p>
      </Card>

      <ModulePlaceholder
        title="Geschosse, Anlagen und Räume"
        description="Die vollständige Gebäudestruktur: Geschosse, Anlagen je Gewerk (Heizung, Lüftung, Sanitär, Kälte, PV, Wärmepumpe), Räume und deren Lasten — samt Import aus einer Tabelle."
        wave="Wave 2"
        rows={5}
      />
    </div>
  );
}
