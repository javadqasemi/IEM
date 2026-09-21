import { Suspense, useMemo, type ReactNode } from "react";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/shared/ui/primitives";
import { SideNav, type SideNavGroup } from "@/shared/ui/navigation";
import { ModulePlaceholder } from "@/shared/ui/feedback";
import { useAuth } from "@/core/auth";
import { usePageTitle } from "@/core/router";
import { useOrganisation, useSettings } from "../hooks/useOrganisation";
import {
  DEFAULT_SECTION,
  sectionFor,
  sectionGroups,
  visibleSections,
} from "../service";
import { OfficesSection } from "./OfficesSection";
import { OrganisationSection } from "./OrganisationSection";
import { SettingsGroupSection } from "./SettingsGroupSection";
import { SystemSection } from "./SystemSection";

/**
 * Einstellungen, as a workspace rather than as one long form.
 *
 * The screen this replaces was a single page of seven cards and one Save
 * button in the header — 26 fields with no sections, no sub-navigation, no
 * search, no unsaved-changes guard, no per-field validation and no
 * confirmation on the switch whose own description says it lifts the
 * four-eyes principle. Configuration is where somebody does the most damage
 * with the least feedback, so all six of those are now present.
 *
 * **The section is in the URL** — `/einstellungen/standorte` — for the same
 * reason a project's tab is: it is a link somebody sends a colleague and a
 * place a reload returns to. `routes.tsx` therefore carries two patterns
 * pointing at this component, the two-segment form before the one-segment,
 * and the screen reads the trailing segment itself. A route per section would
 * be eleven entries differing in one string.
 *
 * **Both queries load here, once**, rather than per section. The organisation
 * record and the settings list are each one row-set, four of the eleven
 * sections read the first and four read the second, and fetching per section
 * would make every click in the sub-navigation a round trip for data already
 * in hand. The system panel is the exception and fetches on demand — it times
 * the database, and a latency measurement taken on every page load measures
 * the page load.
 */
export function SettingsWorkspace({
  section: slug,
  embedded,
}: {
  section?: string;
  /**
   * Sections another feature owns, keyed by slug.
   *
   * Supplied by `admin/pages/SettingsPage.tsx`, which is the only layer
   * allowed to put two features together — this one may not import
   * `features/notifications`, and `src/architecture.test.ts` enforces it.
   * The same shape `ProjectDetail` takes for its embedded module tabs.
   *
   * A declared `embedded` section with nothing supplied renders the
   * not-built placeholder, so the map is the roadmap: the next module to
   * claim a settings section is one line in that file.
   */
  embedded?: Record<string, ReactNode>;
}) {
  const { can } = useAuth();
  const section = sectionFor(slug);

  const sections = useMemo(() => visibleSections(can), [can]);
  const groups = useMemo<SideNavGroup[]>(
    () =>
      sectionGroups(sections).map((group) => ({
        id: group.id,
        label: group.label,
        items: group.items.map((item) => ({
          id: item.slug,
          label: item.label,
          href: `#/einstellungen/${item.slug}`,
        })),
      })),
    [sections],
  );

  /*
    The settings list is fetched only where a section reads it; the
    organisation record is fetched always.

    The asymmetry is not an oversight. Two sections need the record for
    something other than their own fields — Standorte takes `officeKinds` from
    it, and every section's header could name the firm — and it is one row
    behind an `upsert`. The settings list is eight rows across four groups
    that only those four sections read, so `enabled` keeps it off the wire
    until one of them is open. `useQuery` takes a null key for exactly this.
  */
  const needsSettings = section?.source.kind === "settings";

  const record = useOrganisation();
  const settings = useSettings(needsSettings);

  usePageTitle(section?.label ?? "Einstellungen");

  const body = (() => {
    if (!section) {
      return (
        <EmptyState
          title="Diesen Bereich gibt es nicht"
          description="Der Abschnitt in der Adresse ist unbekannt. Links steht, was es gibt."
        />
      );
    }

    if (!sections.some((s) => s.slug === section.slug)) {
      /*
        Reachable by typing the URL, and answered rather than redirected.

        A redirect to the first section would leave the reader wondering
        whether they mistyped. The server refuses the data either way; this is
        the courtesy half.
      */
      return (
        <EmptyState
          title="Kein Zugriff"
          description={`Für „${section.label}“ fehlt die nötige Berechtigung. Wende dich an eine Administratorin.`}
        />
      );
    }

    switch (section.source.kind) {
      case "organisation": {
        if (record.error) return <ErrorState message={record.error} onRetry={record.refetch} />;
        if (!record.data) return <SectionSkeleton />;
        return (
          <OrganisationSection
            section={section}
            record={record.data.organisation}
            canEdit={can("organisation.update")}
            canEditLegal={record.data.canEditLegal}
          />
        );
      }

      case "offices":
        return (
          <OfficesSection
            section={section}
            kinds={record.data?.officeKinds ?? ["Hauptsitz", "Zweigbüro"]}
            can={can}
          />
        );

      case "settings": {
        if (settings.error) return <ErrorState message={settings.error} onRetry={settings.refetch} />;
        if (!settings.data) return <SectionSkeleton />;
        const form = (
          <SettingsGroupSection
            section={section}
            groups={settings.data}
            canEdit={can("settings.update")}
            canSeeSecrets={can("settings.secrets")}
          />
        );
        /*
          A panel below the form, where the section asks for one.

          Additive rather than an alternative: the form keeps its save bar, its
          unsaved-changes guard and its validation, and the panel adds what no
          declaration can express — a status verdict, a diagnostic, a template
          catalogue. E-Mail is the first; Backup and Integrations are next.

          A section that declares `panel` and is supplied nothing renders the
          form alone. That is the right failure: the settings still work, and
          the missing half is a wiring fault in `SettingsPage.tsx` rather than
          something that should blank the screen.
        */
        const panel = section.source.panel ? embedded?.[section.slug] : null;
        if (!panel) return form;
        return (
          <div className="flex flex-col gap-6">
            {form}
            <Suspense fallback={<SectionSkeleton />}>{panel}</Suspense>
          </div>
        );
      }

      case "system":
        return <SystemSection section={section} />;

      case "embedded": {
        const supplied = embedded?.[section.slug];
        if (supplied) {
          /*
            `Suspense` because the supplier hands over a `lazy()` boundary:
            the section belongs to a module almost nobody with these
            permissions opens, and pulling it into the settings chunk would
            make everybody pay for it.
          */
          return <Suspense fallback={<SectionSkeleton />}>{supplied}</Suspense>;
        }
        /*
          Nothing supplied for a slot that declares one.

          Not a "not yet built" message — the section exists and is
          declared, so this is a wiring fault rather than a roadmap entry,
          and saying so is what stops somebody spending an afternoon looking
          for the feature in the backend.
        */
        return (
          <ModulePlaceholder
            title={section.title}
            description={section.source.reason}
            status="planned"
            rows={3}
          />
        );
      }

      case "placeholder":
        /*
          Drawn as explicitly not built, rather than omitted.

          Same choice the `pending` badge makes one level down, and the same
          one `KpiUnavailable` makes on the executive dashboard: a control that
          silently does nothing is worse than one that says it does nothing,
          and an *absent* section makes an administrator conclude the system
          has no such feature and stop looking.
        */
        return (
          <ModulePlaceholder
            title={section.title}
            description={section.source.reason}
            status="planned"
            wave="Wave 2"
            rows={3}
          />
        );
    }
  })();

  return (
    <>
      <PageHeader
        eyebrow="Einstellungen"
        title="Unternehmen und Betrieb"
        description="Die Angaben zur Firma, ihre Standorte und die Vorgaben, nach denen das System läuft."
      />

      {/*
        Two columns on a laptop, stacked on a phone — and the rail becomes a
        scrolling strip rather than a menu, because a second disclosure to
        reach configuration is a tap nobody expects. `min-w-0` on the content
        column is what stops a wide table pushing the page into a horizontal
        scroll; without it the grid track sizes to the content.
      */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        <SideNav
          groups={groups}
          activeId={section?.slug ?? null}
          ariaLabel="Einstellungsbereiche"
          className="lg:sticky lg:top-24 lg:self-start"
        />
        <div className="flex min-w-0 flex-col">{body}</div>
      </div>
    </>
  );
}

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-72 rounded-lg" />
      <Skeleton className="h-40 rounded-lg" />
    </div>
  );
}

export { DEFAULT_SECTION };
