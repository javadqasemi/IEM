import type { ComponentType } from "react";
import type { ProjectDetail } from "@/entities/project";

/**
 * The project view's tabs — **the container, not the owner**.
 *
 * The distinction the firm set at review, and the whole reason this is a table
 * rather than a `switch` in the detail screen:
 *
 * > Das Projekt ist der Container, nicht der Besitzer.
 *
 * Seven of these tabs are the project's **own** data — its overview, its team,
 * its Gewerke, its milestones, and the two records it points at. The other
 * eight are *other modules*, scoped by `projectId` and embedded in this view.
 * Tasks are not part of a project; tasks have a project. When `features/tasks`
 * exists, its screen appears here through `widgets/` and this feature imports
 * nothing from it — `architecture.test.ts` forbids the alternative, and the
 * alternative is how a "project module" becomes the place every other module
 * has a piece of.
 *
 * **No tab is empty.** Each unbuilt one renders `ModulePlaceholder` with a
 * description, the words "Dieses Modul ist noch nicht implementiert.", a status
 * and the layout its real screen will use. An empty tab is indistinguishable
 * from a broken one: somebody clicks *Pläne*, sees nothing, and concludes this
 * project has no drawings — a statement about the data, and a false one.
 *
 * The `slug` is in the URL (`/projekte/:id/team`), so a tab is a link somebody
 * can send. That is also why the order here is the order on screen and why
 * `uebersicht` is first: it is what a bare `/projekte/:id` resolves to.
 */

export type ProjectTab = {
  /** The URL segment. German, because the whole dashboard's URLs are. */
  slug: string;
  label: string;
  /** True when this feature owns the data. False means another module's screen. */
  owned: boolean;
  /** Rendered for an owned tab. */
  component?: ComponentType<{ project: ProjectDetail; readOnly: boolean }>;
  /** For an unbuilt tab: what the module will do, in one sentence. */
  description?: string;
  status?: "planned" | "in-progress";
  wave?: string;
  /** A number beside the label, when this feature can count it without a request. */
  count?: (project: ProjectDetail) => number | undefined;
};

/**
 * The seven tabs that are other modules.
 *
 * `aktivitaet` left this list when the version history arrived (F13): it was a
 * placeholder for "wer hat wann was geändert", and that record now exists. A
 * placeholder is removed by building the thing, never by hiding the tab.
 *
 * Declared as data here — rather than each being written out in the detail
 * screen — so that replacing one with a real screen is a one-line change and so
 * that the roadmap and the navigation cannot disagree about what is coming. The
 * `wave` is the roadmap's, and it is shown to the reader: "Geplant" without a
 * horizon is the kind of promise people stop believing.
 */
export const EMBEDDED_TABS: ProjectTab[] = [
  {
    slug: "phasen",
    label: "SIA-Phasen",
    owned: false,
    description:
      "Die vertraglich vereinbarten Phasen nach SIA 112 mit Honorar, Terminen, Leistungen und der Abnahme durch die Bauherrschaft.",
    status: "in-progress",
    wave: "Wave 1",
  },
  {
    slug: "aufgaben",
    label: "Aufgaben",
    owned: false,
    description:
      "Pendenzen zu diesem Projekt, mit Zuständigkeit, Frist und Abhängigkeiten — als Liste und als Board.",
    status: "planned",
    wave: "Wave 2",
  },
  {
    slug: "sitzungen",
    label: "Sitzungen",
    owned: false,
    description:
      "Protokolle mit Traktanden, Teilnehmenden und Entscheiden. Entscheide sind eigene Objekte, damit später beantwortbar ist, wann etwas beschlossen wurde.",
    status: "planned",
    wave: "Wave 2",
  },
  {
    slug: "dokumente",
    label: "Dokumente",
    owned: false,
    description:
      "Die Projektablage mit Ordnern, Versionen und Vorschau — getrennt von den Plänen, die ihren eigenen Revisionsstand führen.",
    status: "planned",
    wave: "Wave 2",
  },
  {
    slug: "plaene",
    label: "Pläne",
    owned: false,
    description:
      "Pläne mit Revisionen und Planversand, verknüpft mit Gewerk, Gebäude, Geschoss und Raum — damit „alle Lüftungspläne für OG2“ ein Filter ist.",
    status: "planned",
    wave: "Wave 2",
  },
  {
    slug: "bim",
    label: "BIM",
    owned: false,
    description:
      "Koordinationsmodelle mit Versionen, Kollisionsprüfung und Verknüpfungen zu Plänen, Dokumenten, Mängeln und Räumen.",
    status: "planned",
    wave: "Wave 2",
  },
  {
    slug: "finanzen",
    label: "Finanzen",
    owned: false,
    description:
      "Budget, Kostenstellen, erfasste Stunden, Prognose und Rechnungsstellung — je Gewerk und je Phase.",
    status: "planned",
    wave: "Wave 3",
  },

];
