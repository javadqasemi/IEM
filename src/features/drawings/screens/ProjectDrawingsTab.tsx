import { useState } from "react";
import { navigate } from "@/core/router";
import { useAuth } from "@/core/auth";
import { DrawingStatusBadge, RevisionBadge, drawingTypeLabel } from "@/entities/drawing";
import { DisciplineDot } from "@/entities/project";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { useToast } from "@/shared/ui/feedback";
import { formatDate } from "@/shared/utils/format";
import { useDrawingList, useTransmittalList } from "../hooks/useDrawings";
import { groupByDiscipline } from "../service";
import { DrawingCreateDialog } from "./DrawingCreateDialog";
import { TransmittalDialog } from "./TransmittalDialog";

/**
 * One project's plan set, embedded in the project detail's *Pläne* tab.
 *
 * **Grouped by Gewerk**, which is how a plan set is read and how it is filed —
 * a flat table sorted by number interleaves Heizung, Lüftung and Sanitär, and
 * nobody looks at a plan set that way. The register at `/plaene` is the flat
 * view for when the question crosses projects.
 *
 * **This is where a Planversand starts**, and that is why the button is here
 * rather than on the Planversand list: a transmittal is assembled from *plans*,
 * so it begins where the plans are. A button on the list would open a dialog
 * whose first question is "which project", and the answer is always already
 * known somewhere else.
 *
 * The third embedded tab to stop being a placeholder, composed by
 * `admin/pages/ProjectPage.tsx` — `features/projects` imports nothing from here
 * and `widgets/` may not import a feature at all, so the shell is the only
 * layer above both.
 *
 * **No page header and no filters.** The project's own shell already says which
 * project this is — the project *is* the filter.
 */
export function ProjectDrawingsTab({ projectId }: { projectId: string }) {
  const toast = useToast();
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);

  const drawings = useDrawingList({
    projectId,
    perPage: 100,
    sort: { field: "number", dir: "asc" },
  });

  const transmittals = useTransmittalList({
    projectId,
    perPage: 5,
    sort: { field: "sentAt", dir: "desc" },
  });

  const groups = groupByDiscipline(drawings.data?.items ?? []);

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Planbestand"
        description={
          drawings.data
            ? `${drawings.data.total} ${drawings.data.total === 1 ? "Plan" : "Pläne"}, nach Gewerk`
            : "Die Pläne dieses Projekts."
        }
        action={
          <div className="flex items-center gap-2">
            {can("drawing.create") ? (
              <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
                Neuer Plan
              </Button>
            ) : null}
            {can("transmittal.create") && can("drawing.issue") ? (
              <Button size="sm" onClick={() => setSending(true)}>
                Pläne versenden
              </Button>
            ) : null}
          </div>
        }
      >
        {drawings.error ? (
          <ErrorState message={drawings.error} onRetry={drawings.refetch} />
        ) : drawings.loading && !drawings.data ? (
          <Skeleton className="h-32 w-full" />
        ) : groups.length ? (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <section key={group.code} className="flex flex-col gap-1">
                <header className="flex items-baseline gap-2 border-b border-line pb-1.5">
                  {group.colour ? <DisciplineDot colour={group.colour} /> : null}
                  <h3 className="text-[13px] font-semibold text-ink">
                    {group.code} · {group.name}
                  </h3>
                  <span className="font-mono text-[11px] tnum text-muted">
                    {group.drawings.length}
                  </span>
                </header>

                <ul className="flex flex-col divide-y divide-line">
                  {group.drawings.map((drawing) => (
                    <li key={drawing.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/plaene/${drawing.id}`)}
                        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded px-1 py-2 text-left hover:bg-surface-sunken"
                      >
                        <span className="w-44 shrink-0 font-mono text-[12px] text-muted">
                          {drawing.number}
                        </span>
                        <span className="min-w-0 flex-1 text-[14px] text-ink">
                          {drawing.title}
                        </span>
                        <span className="text-[12px] text-muted">
                          {drawingTypeLabel(drawing.type)}
                        </span>
                        <RevisionBadge revision={drawing.currentRevision} />
                        <DrawingStatusBadge status={drawing.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Noch keine Pläne"
            description="Ein Plan braucht eine Nummer, einen Titel und ein Gewerk. Die Revision kommt mit der Zeichnung."
          />
        )}
      </Card>

      <Card
        title="Planversand"
        description={
          transmittals.data
            ? `${transmittals.data.total} auf diesem Projekt`
            : "Wer welche Revision bekommen hat."
        }
      >
        {transmittals.error ? (
          <ErrorState message={transmittals.error} onRetry={transmittals.refetch} />
        ) : transmittals.loading && !transmittals.data ? (
          <Skeleton className="h-16 w-full" />
        ) : transmittals.data?.items.length ? (
          <>
            <ul className="flex flex-col divide-y divide-line">
              {transmittals.data.items.map((transmittal) => (
                <li key={transmittal.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/planversand/${transmittal.id}`)}
                    className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded px-1 py-2.5 text-left hover:bg-surface-sunken"
                  >
                    <span className="w-32 shrink-0 font-mono text-[12px] text-muted">
                      {transmittal.number}
                    </span>
                    <span className="min-w-0 flex-1 text-[13px]">
                      {transmittal.counts.items}{" "}
                      {transmittal.counts.items === 1 ? "Plan" : "Pläne"} an{" "}
                      {transmittal.counts.recipients}{" "}
                      {transmittal.counts.recipients === 1 ? "Empfänger" : "Empfänger"}
                    </span>
                    <span className="shrink-0 text-[12px] text-muted">
                      {formatDate(transmittal.sentAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {transmittals.data.total > transmittals.data.items.length ? (
              <button
                type="button"
                onClick={() => navigate("/planversand")}
                className="mt-3 text-[13px] text-muted underline hover:text-ink"
              >
                Alle {transmittals.data.total} Versände ansehen
              </button>
            ) : null}
          </>
        ) : (
          <EmptyState
            title="Noch nichts versandt"
            description="Sobald freigegebene Pläne hinausgehen, steht hier, wer welche Revision hat."
          />
        )}
      </Card>

      {creating ? (
        <DrawingCreateDialog
          // Fixed, not picked: the tab already answers which project this is.
          projectId={projectId}
          onClose={() => setCreating(false)}
          onCreated={(drawing) => {
            setCreating(false);
            toast.success(`${drawing.number} angelegt`);
            navigate(`/plaene/${drawing.id}`);
          }}
        />
      ) : null}

      {sending ? (
        <TransmittalDialog
          projectId={projectId}
          onClose={() => setSending(false)}
          onSent={(result) => {
            setSending(false);
            toast.success(`${result.transmittal.number} versandt`);
            navigate(`/planversand/${result.transmittal.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
