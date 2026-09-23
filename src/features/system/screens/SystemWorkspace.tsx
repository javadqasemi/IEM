import { PageHeader } from "@/shared/ui/primitives";
import { useRoute } from "@/core/router";
import { usePageTitle } from "@/core/router";
import { useAuth } from "@/core/auth";
import { SystemOverviewScreen } from "./SystemOverview";
import { JobsScreen } from "./JobsScreen";
import { DiagnosticsScreen } from "./DiagnosticsScreen";

/**
 * One workspace, three sections, and the section is in the URL.
 *
 * ---
 *
 * ## Why not twelve rail entries
 *
 * The brief asks for one top-level *System* and secondary navigation inside
 * it, and the rail already has that group — E-Mail, Sicherungen, Bewerbungen,
 * Freigabe, Sicherheit, Benachrichtigungen, System, Audit-Log. Adding
 * Übersicht, Aufgaben, Datenbank, Cache, Speicher, Protokolle, Diagnose and
 * Aktualisierungen beside them would make the group longer than the rest of
 * the dashboard put together, and most of those are *cards*, not
 * destinations.
 *
 * So three sections earn a URL — the overview, the job list and the
 * diagnostics run — and everything else is a card on the overview with a link
 * to the module that owns it.
 *
 * ## The section is a route, not `useState`
 *
 * `/system/aufgaben` is a link somebody sends a colleague and a place a
 * reload returns to. The same decision `/projekte/:id/gewerke` makes, and the
 * same reason: a tab held in component state is a tab nobody can point at.
 */

const SECTIONS = [
  { slug: "", label: "Übersicht" },
  { slug: "aufgaben", label: "Hintergrundaufgaben" },
  { slug: "diagnose", label: "Diagnose" },
] as const;

type Slug = (typeof SECTIONS)[number]["slug"];

export function SystemWorkspace() {
  const { path } = useRoute();
  const { can } = useAuth();

  /*
    Read from the path rather than from route params, because `useRoute`
    returns the location and not the match — the same thing `ProjectDetail`
    does with its trailing tab segment. One `matchRoute` per render to recover
    a string the URL already contains would be work for nothing.

    An unknown segment falls back to the overview rather than to a not-found.
    `/system/datenbank` is a URL somebody will type — the brief's own list of
    areas has a Database entry — and the answer to it is the overview, where
    the database card is. A 404 would be correct and unhelpful.
  */
  const raw = path.replace(/^\/system\/?/, "").split("/")[0] ?? "";
  const active: Slug = SECTIONS.some((s) => s.slug === raw) ? (raw as Slug) : "";

  usePageTitle(SECTIONS.find((s) => s.slug === active)?.label ?? "System");

  /*
    No tab strip of its own any more (P1B). The three sections are
    destinations of the System workspace — Systemzustand, Hintergrundaufgaben,
    Diagnose — and the shell's workspace navigation lists them beside the rest
    of System, with the Aufgaben row shown only to somebody holding `job.read`.
    A strip here as well was a second, differently-shaped menu for three of
    the workspace's eleven destinations.

    The page still refuses the jobs section without `job.read`: somebody can
    type the URL, and the server answers 403 regardless.
  */
  const titles: Record<Slug, string> = {
    "": "Systemzustand",
    aufgaben: "Hintergrundaufgaben",
    diagnose: "Diagnose",
  };

  return (
    <>
      <PageHeader
        eyebrow="System"
        title={titles[active]}
        description={
          active === ""
            ? "Was diese Installation über sich selbst weiss — und woran sie es gemessen hat. Nichts hier ist geschätzt."
            : undefined
        }
      />

      <div>
        {active === "aufgaben" && can("job.read") ? (
          <JobsScreen />
        ) : active === "diagnose" ? (
          <DiagnosticsScreen />
        ) : (
          <SystemOverviewScreen />
        )}
      </div>
    </>
  );
}
