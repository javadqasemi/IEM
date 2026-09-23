import { Suspense, useState, type ComponentType } from "react";
import { toFailure } from "@/core/api";
import { Link, navigate, useRoute } from "@/core/router";
import { useAuth } from "@/core/auth";
import {
  ProjectHealthDot,
  ProjectStatusBadge,
  projectStatusLabel,
  projectStatusTone,
  type ProjectDetail as Project,
  type ProjectStatus,
} from "@/entities/project";
import { Badge, Button, ErrorState, PageHeader, Skeleton } from "@/shared/ui/primitives";
import {
  ConfirmDialog,
  RecordActions,
  StatusTransitionDialog,
  type TransitionTarget,
} from "@/shared/ui/overlays";
import { ModulePlaceholder, useToast } from "@/shared/ui/feedback";
import { cn } from "@/shared/utils/cn";
import { useProject, useProjectMutations } from "../hooks/useProjects";
import { isReadOnly } from "../service";
import { EMBEDDED_TABS, type ProjectTab } from "./tabs";
import { OverviewTab } from "./OverviewTab";
import { TeamTab } from "./TeamTab";
import { DisciplinesTab } from "./DisciplinesTab";
import { MilestonesTab } from "./MilestonesTab";
import { BuildingTab, CustomerTab } from "./PartiesTab";
import { HistoryTab } from "./HistoryTab";
import { ProjectEditDialog } from "./ProjectEditDialog";

/**
 * One project, and the fourteen tabs around it.
 *
 * **The container, not the owner** — `docs/enterprise-architecture.md` §4.4.1.
 * Six tabs are this feature's own data; the other eight are other modules
 * scoped by `projectId`, and none of them is empty: each renders
 * `ModulePlaceholder` with a description, the words "Dieses Modul ist noch
 * nicht implementiert.", a status and the layout its real screen will use.
 *
 * **The tab is in the URL.** `/projekte/:id/gewerke` is a link somebody sends a
 * colleague, and a project view whose state lives in `useState` is one that
 * cannot be linked to, cannot be reopened where it was left, and loses its
 * place on every reload. The strip is therefore anchors in a `<nav>` and
 * deliberately **not** `role="tab"`: it changes the route rather than swapping
 * a panel, and telling a screen reader otherwise would describe something that
 * does not happen.
 */
export function ProjectDetail({
  projectId,
  embedded,
}: {
  projectId: string;
  /**
   * The other modules' screens, by tab slug — **supplied from above**.
   *
   * This is the container/owner split made mechanical. `features/projects` must
   * not import `features/tasks`, and `widgets/` may not import a feature at all
   * (`architecture.test.ts` enforces both), so the only layer that can put the
   * two together is the one above them: `admin/pages/ProjectPage.tsx` passes
   * `{ aufgaben: ProjectTasksTab }`, and this screen renders whatever it was
   * given. A slug with no entry falls through to `ModulePlaceholder`, which is
   * why the eight unbuilt tabs need no change here as they arrive.
   *
   * The prop is optional so the screen can still be rendered on its own — which
   * is what `ProjectDetail` does in every test that does not care about tabs.
   */
  embedded?: Record<string, ComponentType<{ projectId: string }>>;
}) {
  const route = useRoute();
  const { can } = useAuth();
  const project = useProject(projectId);
  const [deleting, setDeleting] = useState(false);

  const owned = ownedTabs();
  const tabs = [...owned, ...EMBEDDED_TABS];

  // The trailing segment, or the first tab. `/projekte/:id` and
  // `/projekte/:id/uebersicht` are the same page; the bare form is what the
  // list links to, because a URL with a redundant segment invites people to
  // wonder which one is canonical.
  const segments = route.path.split("/").filter(Boolean);
  const slug = segments.length > 2 ? segments[2] : owned[0].slug;
  const active = tabs.find((tab) => tab.slug === slug) ?? owned[0];

  if (project.error) return <ErrorState message={project.error} onRetry={project.refetch} />;

  if (!project.data) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-16 w-full max-w-lg" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const record = project.data;
  const readOnly = isReadOnly(record);

  return (
    <>
      <PageHeader
        // The number alone. The way back to the list is the breadcrumb the
        // shell derives from the route's `parent` (foundation stage F4) — a
        // second link here would be the same destination twice, and the one
        // that goes stale is the hand-written one.
        eyebrow={record.number}
        title={record.name}
        description={
          [record.customer?.name, record.building?.name].filter(Boolean).join(" · ") || undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ProjectHealthDot health={record.health} />
            <ProjectStatusBadge status={record.status} />
            {readOnly ? <Badge tone="bronze">Schreibgeschützt</Badge> : null}
            <RecordActions
              secondary={
                can("project.update") && !readOnly ? (
                  <>
                    <EditButton project={record} />
                    {record.allowedTransitions.length ? <StatusButton project={record} /> : null}
                  </>
                ) : null
              }
              more={
                can("project.delete")
                  ? [{ id: "delete", label: "Löschen", destructive: true, onSelect: () => setDeleting(true) }]
                  : []
              }
            />
          </div>
        }
      />
      <DeleteDialog project={record} open={deleting} onClose={() => setDeleting(false)} />

      {/*
        Anchors in a `<nav>`, not `role="tab"` — see the note at the top.

        `overflow-x-auto` with no wrap: fourteen tabs wrap to three lines at
        phone width, which pushes the content below the fold on the one device
        where that costs most. A horizontal scroller keeps the first tabs
        visible and the rest reachable.
      */}
      <nav
        aria-label="Projektbereiche"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1"
      >
        {tabs.map((tab) => {
          const isActive = tab.slug === active.slug;
          const count = tab.count?.(record);
          return (
            <Link
              key={tab.slug}
              to={`/projekte/${record.id}/${tab.slug}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[14px] font-medium transition-colors",
                isActive
                  ? "border-accent text-ink"
                  : "border-transparent text-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {tab.label}
              {count !== undefined ? (
                <span className="font-mono text-[11px] tnum">{count}</span>
              ) : null}
              {/*
                The dot marks a tab whose module does not exist yet.

                It is not a warning — it is an expectation-setter, so nobody
                clicks four tabs in a row hoping for data. `title` rather than
                text because the strip is already fourteen items wide, and the
                placeholder inside says the same thing in full.
              */}
              {/*
                `!owned` is not enough any more.

                A tab can belong to another module *and* be built — Aufgaben is
                the first — so the dot asks whether anything was composed in for
                this slug. Keying it on ownership alone would mark a working
                board as unimplemented, which is the one thing worse than no
                dot at all.
              */}
              {!tab.owned && !embedded?.[tab.slug] ? (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-line-strong"
                  title="Modul noch nicht implementiert"
                />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {renderTab(active, record, readOnly, embedded)}
    </>
  );
}

/**
 * What goes in the panel, in the order the three cases were decided.
 *
 * 1. **This feature's own data**, rendered by its own component.
 * 2. **Another module's screen**, if the shell composed one in for this slug.
 * 3. **`ModulePlaceholder`**, for a module that does not exist yet.
 *
 * The third is never nothing, and that is the rule `tabs.ts` states: an empty
 * tab is indistinguishable from a broken one — somebody clicks *Pläne*, sees
 * nothing, and concludes this project has no drawings, which is a statement
 * about the data and a false one.
 */
function renderTab(
  tab: ProjectTab,
  project: Project,
  readOnly: boolean,
  embedded?: Record<string, ComponentType<{ projectId: string }>>,
) {
  if (tab.owned && tab.component) {
    return <tab.component project={project} readOnly={readOnly} />;
  }

  const Embedded = embedded?.[tab.slug];
  if (Embedded) {
    /*
      The other module's own `lazy()` boundary is what it arrives wrapped in, so
      it needs a `Suspense` of its own: the shell's boundary has already
      resolved by the time a tab is clicked, and without one here React throws
      on the first render of a tab that has not been loaded yet.
    */
    return (
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Embedded projectId={project.id} />
      </Suspense>
    );
  }

  return (
    <ModulePlaceholder
      title={tab.label}
      description={tab.description ?? ""}
      status={tab.status}
      wave={tab.wave}
    />
  );
}

/**
 * The seven tabs this feature owns.
 *
 * A function rather than a module constant because the components import this
 * file's siblings, and a constant would make the import graph a cycle the
 * moment a tab wanted to link back to the shell.
 */
function ownedTabs(): ProjectTab[] {
  return [
    { slug: "uebersicht", label: "Übersicht", owned: true, component: OverviewTab },
    {
      slug: "team",
      label: "Team",
      owned: true,
      component: TeamTab,
      // The manager is not a member row, so the count adds them — see `teamOf`.
      count: (p) => p.members.length + (p.manager ? 1 : 0),
    },
    {
      slug: "gewerke",
      label: "Gewerke",
      owned: true,
      component: DisciplinesTab,
      count: (p) => p.disciplines.filter((d) => d.status !== "NOT_IN_SCOPE").length,
    },
    {
      slug: "termine",
      label: "Termine",
      owned: true,
      component: MilestonesTab,
      count: (p) => p.milestones.length,
    },
    { slug: "kunde", label: "Bauherrschaft", owned: true, component: CustomerTab },
    { slug: "gebaeude", label: "Gebäude", owned: true, component: BuildingTab },
    {
      // Was a placeholder until F13 gave it something to show. The count is the
      // record's own version, so the tab says "v12" before it is opened.
      slug: "verlauf",
      label: "Verlauf",
      owned: true,
      component: HistoryTab,
      count: (p) => p.version,
    },
  ];
}

/**
 * The status change, as its own control.
 *
 * The options are **`record.allowedTransitions`**, which the server computed
 * and sent with the project. Not a table on the client: the transitions and
 * their preconditions live in `server/src/projects/projects.rules.ts`, and a
 * second copy here would go stale without anything failing — the dropdown would
 * simply start offering something the API refuses, and the user would find out
 * by pressing the button.
 */
function StatusButton({ project }: { project: Project }) {
  const toast = useToast();
  const mutations = useProjectMutations();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reason = {
    label: "Begründung",
    hint: "Wird im Verlauf und im Audit-Log festgehalten — bei einem Baustopp oder Abbruch die wichtigste Zeile.",
  };

  /*
    The server's targets, in its order. Stopping a project is the one that
    ends work for everybody on it, so it carries the destructive weight; the
    rest are ordinary steps in the record's life.
  */
  const targets: TransitionTarget[] = project.allowedTransitions.map((value) => ({
    value,
    label: projectStatusLabel(value),
    tone: projectStatusTone(value),
    reason,
    destructive: value === "CANCELLED",
    consequence:
      value === "CANCELLED" ? (
        <p>Ein abgebrochenes Projekt ist abgeschlossen. Die Begründung ist das, was später jemand nachliest.</p>
      ) : undefined,
  }));

  if (!targets.length) return null;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Status ändern
      </Button>
      <StatusTransitionDialog
        open={open}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
        title="Status ändern"
        description="Nur die Übergänge, die der Server für dieses Projekt jetzt zulässt."
        from={{ label: projectStatusLabel(project.status), tone: projectStatusTone(project.status) }}
        targets={targets}
        busy={busy}
        error={error}
        onConfirm={async (status, text) => {
          setError(null);
          setBusy(true);
          try {
            await mutations.changeStatus(project.id, {
              status: status as ProjectStatus,
              reason: text || undefined,
            });
            toast.success(`Status: ${projectStatusLabel(status)}`);
            setOpen(false);
          } catch (err) {
            // The server's refusal, verbatim: "2 Meilenstein(e) sind weder
            // erreicht noch ausdrücklich erlassen." is a better message than
            // anything this screen could compose, and it is the authoritative one.
            setError(toFailure(err).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

/**
 * Editing the project record.
 *
 * Separate from the status control beside it, because they are separate acts
 * with separate permissions and separate preconditions — the same split the
 * server makes between `PATCH /projects/:id` and `PUT /projects/:id/status`.
 */
function EditButton({ project }: { project: Project }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Bearbeiten
      </Button>
      {open ? (
        <ProjectEditDialog
          project={project}
          onClose={() => setOpen(false)}
          onSaved={(next) => {
            setOpen(false);
            toast.success(`Gespeichert — ${project.number} v${next.version}`);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Deleting the project — opened from the record's "Mehr" menu (P1C): a rare,
 * destructive act does not sit as a visible button beside "Bearbeiten".
 * HIGH level: the project number is typed to confirm.
 */
function DeleteDialog({
  project,
  open,
  onClose,
}: {
  project: Project;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const mutations = useProjectMutations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setOpen = (next: boolean) => {
    if (!next) {
      setError(null);
      onClose();
    }
  };

  return (
    <>
      <ConfirmDialog
        open={open}
        busy={busy}
        error={error}
        onClose={() => setOpen(false)}
        title="Projekt löschen?"
        message={
          <>
            <p>
              {project.number} — {project.name}, mit Team, Gewerken und Meilensteinen.
            </p>
            {/*
              The rule, before the request rather than after the 400. The
              server refuses a live project outright, and a confirm dialog that
              leads to an error is worse than one that explains first.
            */}
            <p className="mt-2 text-muted">
              Ein laufendes Projekt lässt sich nicht löschen — es wird abgeschlossen oder
              abgebrochen. Sobald Stunden oder Rechnungen darauf gebucht sind, bleibt nur das
              Archivieren.
            </p>
          </>
        }
        confirmLabel="Löschen"
        destructive
        confirmText={project.number}
        onConfirm={async () => {
          setBusy(true);
          setError(null);
          try {
            await mutations.remove(project.id);
            toast.success("Gelöscht");
            setOpen(false);
            navigate("/projekte");
          } catch (err) {
            // In the dialog: "Ein laufendes Projekt lässt sich nicht löschen"
            // is what the reader needs next, not a toast behind the confirm.
            setError(toFailure(err).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
