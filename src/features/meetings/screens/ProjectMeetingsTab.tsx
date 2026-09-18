import { useState } from "react";
import { navigate } from "@/core/router";
import { useAuth } from "@/core/auth";
import {
  DecisionStatusBadge,
  MeetingStatusBadge,
  MinutesBadge,
  impactSummary,
  meetingTypeLabel,
  minutesState,
} from "@/entities/meeting";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { useToast } from "@/shared/ui/feedback";
import { formatDate, formatDateTime } from "@/shared/utils/format";
import { useDecisionList, useMeetingList } from "../hooks/useMeetings";
import { MeetingCreateDialog } from "./MeetingCreateDialog";
import { DecisionCreateDialog } from "./DecisionDialogs";

/**
 * One project's meetings and decisions, embedded in the project detail.
 *
 * **Two lists in one tab, and that is the decision worth defending.** The
 * project's Sitzungen tab is where somebody goes to ask *"was wurde auf diesem
 * Projekt entschieden"*, and answering it with a list of meeting dates would
 * make them open four protocols to find out. The decisions are the answer; the
 * meetings are where they came from.
 *
 * It is the second embedded tab, composed by `admin/pages/ProjectPage.tsx` for
 * the reason the first one was: `features/projects` imports nothing from here,
 * and `widgets/` may not import a feature at all, so the only layer that can put
 * the two together is the one above both.
 *
 * **No page header and no filters.** The project's own shell already says which
 * project this is — the project *is* the filter.
 */
export function ProjectMeetingsTab({ projectId }: { projectId: string }) {
  const toast = useToast();
  const { can } = useAuth();
  const [creatingMeeting, setCreatingMeeting] = useState(false);
  const [creatingDecision, setCreatingDecision] = useState(false);

  const meetings = useMeetingList({
    projectId,
    perPage: 10,
    sort: { field: "startsAt", dir: "desc" },
  });

  const decisions = useDecisionList({
    projectId,
    perPage: 10,
    sort: { field: "decidedAt", dir: "desc" },
  });

  return (
    <div className="flex flex-col gap-5">
      {/*
        Decisions first, deliberately.

        A project's meetings are chronology; its decisions are the state. The
        question this tab gets opened for is almost always the second one.
      */}
      <Card
        title="Entscheide"
        description={
          decisions.data
            ? `${decisions.data.total} auf diesem Projekt`
            : "Was auf diesem Projekt entschieden wurde."
        }
        action={
          can("decision.create") ? (
            <Button size="sm" variant="secondary" onClick={() => setCreatingDecision(true)}>
              Entscheid festhalten
            </Button>
          ) : null
        }
      >
        {decisions.error ? (
          <ErrorState message={decisions.error} onRetry={decisions.refetch} />
        ) : decisions.loading && !decisions.data ? (
          <Skeleton className="h-24 w-full" />
        ) : decisions.data?.items.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {decisions.data.items.map((decision) => (
              <li key={decision.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/entscheide/${decision.id}`)}
                  className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded px-1 py-2.5 text-left hover:bg-surface-sunken"
                >
                  <span className="w-24 shrink-0 font-mono text-[12px] tnum text-muted">
                    {decision.number}
                  </span>
                  <span className="min-w-0 flex-1 text-[14px] font-medium text-ink">
                    {decision.title}
                  </span>
                  <span className="text-[12px] text-muted">{impactSummary(decision)}</span>
                  <DecisionStatusBadge status={decision.status} />
                  <span className="shrink-0 text-[12px] text-muted">
                    {formatDate(decision.decidedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Noch keine Entscheide"
            description="Ein Entscheid wird festgehalten, sobald er gefallen ist — in einer Sitzung oder auf dem Bauplatz."
          />
        )}

        {decisions.data && decisions.data.total > decisions.data.items.length ? (
          <button
            type="button"
            onClick={() => navigate("/entscheide")}
            className="mt-3 text-[13px] text-muted underline hover:text-ink"
          >
            Alle {decisions.data.total} Entscheide ansehen
          </button>
        ) : null}
      </Card>

      <Card
        title="Sitzungen"
        description={
          meetings.data
            ? `${meetings.data.total} auf diesem Projekt`
            : "Die Sitzungen dieses Projekts."
        }
        action={
          can("meeting.create") ? (
            <Button size="sm" variant="secondary" onClick={() => setCreatingMeeting(true)}>
              Neue Sitzung
            </Button>
          ) : null
        }
      >
        {meetings.error ? (
          <ErrorState message={meetings.error} onRetry={meetings.refetch} />
        ) : meetings.loading && !meetings.data ? (
          <Skeleton className="h-24 w-full" />
        ) : meetings.data?.items.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {meetings.data.items.map((meeting) => (
              <li key={meeting.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/sitzungen/${meeting.id}`)}
                  className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded px-1 py-2.5 text-left hover:bg-surface-sunken"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-[14px] font-medium text-ink">{meeting.label}</span>
                    <span className="ml-2 text-[12px] text-muted">
                      {meetingTypeLabel(meeting.type)}
                    </span>
                  </span>
                  <MeetingStatusBadge status={meeting.status} />
                  {minutesState(meeting) ? <MinutesBadge meeting={meeting} /> : null}
                  <span className="font-mono text-[11px] tnum text-muted">
                    {meeting.counts.items}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted">
                    {formatDateTime(meeting.startsAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Noch keine Sitzungen"
            description="Kickoff, Bausitzungen, Abnahme — sobald eine angesetzt ist, erscheint sie hier."
          />
        )}

        {meetings.data && meetings.data.total > meetings.data.items.length ? (
          <button
            type="button"
            onClick={() => navigate("/sitzungen")}
            className="mt-3 text-[13px] text-muted underline hover:text-ink"
          >
            Alle {meetings.data.total} Sitzungen ansehen
          </button>
        ) : null}
      </Card>

      {creatingMeeting ? (
        <MeetingCreateDialog
          // Fixed, not picked: the tab already answers which project this is.
          projectId={projectId}
          onClose={() => setCreatingMeeting(false)}
          onCreated={(meeting) => {
            setCreatingMeeting(false);
            toast.success("Sitzung angesetzt");
            navigate(`/sitzungen/${meeting.id}`);
          }}
        />
      ) : null}

      {creatingDecision ? (
        <DecisionCreateDialog
          projectId={projectId}
          onClose={() => setCreatingDecision(false)}
          onCreated={(decision) => {
            setCreatingDecision(false);
            toast.success(`${decision.number} festgehalten`);
            navigate(`/entscheide/${decision.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
