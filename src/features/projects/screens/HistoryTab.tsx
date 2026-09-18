import type { ProjectDetail } from "@/entities/project";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import { useProjectHistory } from "../hooks/useProjects";
import { FIELD_LABELS } from "./fieldLabels";

/**
 * What this project has looked like, and who changed it.
 *
 * **Fachliche Versionierung, not the audit log** — the two answer different
 * questions and both are worth having:
 *
 * | | |
 * | --- | --- |
 * | Audit-Log | *who did what*, across the whole system, including failures and denials |
 * | Verlauf | *what this record said*, version by version, reconstructable |
 *
 * The audit log records the change; this records the **state**. Rebuilding a
 * project from a hundred audit rows is not something anybody will do under
 * pressure, and "what did the contract value say in March" is a question this
 * firm is asked by clients and occasionally by a court.
 *
 * The payloads are deliberately not fetched with the list — twenty rows of
 * several kilobytes each, so that one might be opened, is the same mistake as
 * an unpaginated list. The summary says which fields moved, which is what a
 * reader scans for.
 */
export function HistoryTab({ project }: { project: ProjectDetail }) {
  const history = useProjectHistory(project.id);

  if (history.error) return <ErrorState message={history.error} onRetry={history.refetch} />;

  return (
    <Card
      title="Verlauf"
      description={`${project.number} steht auf v${project.version}. Jede Änderung am Projekt selbst erzeugt eine Version.`}
    >
      {history.loading && !history.data ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : history.data?.length ? (
        <ol className="flex flex-col divide-y divide-line">
          {history.data.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 first:pt-0">
              <Badge tone={entry.version === project.version ? "navy" : "neutral"}>
                {entry.label}
              </Badge>

              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">
                  {entry.changedByName ?? entry.changedByEmail ?? "System"}
                </span>{" "}
                {/*
                  The fields, in German, joined into a sentence. `changed` holds
                  the DTO's property names — `plannedEndDate` — and putting those
                  on screen would make the history readable only by whoever wrote
                  the API.
                */}
                <span className="text-muted">
                  {entry.changed.length
                    ? `änderte ${entry.changed.map((f) => FIELD_LABELS[f] ?? f).join(", ")}`
                    : "speicherte ohne Änderung"}
                </span>
                {entry.note ? (
                  <span className="mt-0.5 block text-[13px] text-ink">„{entry.note}“</span>
                ) : null}
              </span>

              {/*
                Relative, with the exact value in the title. A version history is
                scanned for "recently" and referenced for "exactly when", and the
                pair is how every timestamp in this dashboard is rendered.
              */}
              <span className="shrink-0 text-[12px] text-muted" title={formatDateTime(entry.createdAt)}>
                {relativeTime(entry.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          title="Noch keine Änderungen"
          description="Das Projekt steht auf seiner ersten Version. Sobald es bearbeitet wird, erscheint hier jede Fassung."
        />
      )}

      <p className="mt-4 text-[12px] text-muted">
        Der Verlauf hält fest, <em>was</em> das Projekt gesagt hat. Wer wann was getan hat — auch
        fehlgeschlagene Versuche — steht im Audit-Log.
      </p>
    </Card>
  );
}
