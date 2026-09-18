import { useState } from "react";
import { navigate } from "@/core/router";
import { useAuth } from "@/core/auth";
import {
  MEETING_STATUS_OPTIONS,
  MeetingStatusBadge,
  MinutesBadge,
  meetingTypeLabel,
  minutesState,
  type Meeting,
} from "@/entities/meeting";
import {
  Button,
  Card,
  DownloadButton,
  EmptyState,
  ErrorState,
  PageHeader,
} from "@/shared/ui/primitives";
import { SearchInput } from "@/shared/ui/forms";
import { ColumnPicker, DataView, KpiCard, type Column } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { useDebounced, useListView } from "@/shared/hooks";
import { formatDate, formatDateTime } from "@/shared/utils/format";
import { useMeetingList, useMeetingMutations, useMeetingStats } from "../hooks/useMeetings";
import type { MeetingQuery } from "../repository";
import { daysUntil, focusMeeting } from "../service";
import { MeetingCreateDialog } from "./MeetingCreateDialog";

/**
 * Every meeting the reader may see.
 *
 * **"May see" is doing real work.** `meeting.read` opens the screen; the *rows*
 * are narrowed by the server to meetings the reader organised, created, sat in,
 * or whose project they are on — unless they hold `meeting.readAll`. Nothing
 * here filters anything, which is the only arrangement where forgetting a clause
 * cannot leak.
 *
 * ---
 *
 * **The "Protokoll offen" filter is the screen's reason to exist.** A held
 * meeting whose minutes have not gone out is work somebody owes, and it is the
 * one figure on this module that a person acts on — which is why it is a KPI, a
 * chip, and the rail's badge, all reading the same `minutesPending`.
 */
export function MeetingList() {
  const toast = useToast();
  const { can } = useAuth();

  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);

  const listView = useListView("meeting", { sort: { field: "startsAt", dir: "desc" } });

  const query: MeetingQuery = {
    search: debounced || undefined,
    statuses: statuses.length ? statuses : undefined,
    minutesPending: pendingOnly || undefined,
    sort: listView.view.sort,
    page,
    perPage: 25,
  };

  const list = useMeetingList(query);
  const stats = useMeetingStats();
  const mutations = useMeetingMutations();

  /*
    The one meeting a reader should look at, out of a page of them.

    Computed over the rows on screen rather than fetched: `focusMeeting` picks
    the next planned meeting, or the last one held, and both of those questions
    — "wann ist die nächste" and "was war das letzte Mal" — are answered by the
    default sort's first rows. A second query for one row would be a request per
    page load to restate what is already in front of the reader.
  */
  const focus = focusMeeting(list.data?.items ?? []);
  const focusDays = focus ? daysUntil(focus.startsAt) : null;

  const columns: Column<Meeting>[] = [
    {
      key: "meeting",
      header: "Sitzung",
      sortField: "title",
      required: true,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">{r.label}</span>
          <span className="text-[12px] text-muted">{meetingTypeLabel(r.type)}</span>
        </div>
      ),
    },
    {
      key: "when",
      header: "Termin",
      className: "w-44",
      sortField: "startsAt",
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span>{formatDate(r.startsAt)}</span>
          <span className="text-[12px] text-muted">
            {new Date(r.startsAt).toLocaleTimeString("de-CH", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {r.location ? ` · ${r.location}` : ""}
          </span>
        </div>
      ),
    },
    {
      key: "project",
      header: "Projekt",
      render: (r) =>
        r.project ? (
          <div className="flex flex-col gap-0.5">
            <span>{r.project.name}</span>
            <span className="font-mono text-[12px] text-muted">{r.project.number}</span>
          </div>
        ) : (
          // Not "—": an internal meeting is a deliberate kind of meeting, and a
          // dash reads as missing data.
          <span className="text-[12px] text-muted">intern</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      className: "w-32",
      sortField: "status",
      render: (r) => <MeetingStatusBadge status={r.status} />,
    },
    {
      key: "minutes",
      header: "Protokoll",
      className: "w-36",
      // `MinutesBadge` renders nothing for a meeting that has not happened, so
      // the dash is chosen here rather than left to `?? `— a JSX element is
      // never nullish, and that expression would always take the badge.
      render: (r) =>
        minutesState(r) ? <MinutesBadge meeting={r} /> : <span className="text-muted">—</span>,
    },
    {
      key: "organiser",
      header: "Leitung",
      secondary: true,
      render: (r) => r.organiser?.name ?? <span className="text-muted">—</span>,
    },
    {
      key: "counts",
      header: "Umfang",
      numeric: true,
      className: "w-32",
      secondary: true,
      render: (r) => (
        <span className="font-mono text-[12px] tnum text-muted">
          {r.counts.attendees} / {r.counts.items}
        </span>
      ),
    },
  ];

  if (list.error) return <ErrorState message={list.error} onRetry={list.refetch} />;

  return (
    <>
      <PageHeader
        eyebrow="Projekte"
        title="Sitzungen"
        description="Was besprochen, entschieden und aufgetragen wurde. Ein genehmigtes Protokoll ist der Stand."
        actions={
          can("meeting.create") ? (
            <Button onClick={() => setCreating(true)}>Neue Sitzung</Button>
          ) : null
        }
      />

      {stats.data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiCard label="Sitzungen" value={stats.data.total} />
          <KpiCard label="Geplant" value={stats.data.byStatus.PLANNED ?? 0} />
          <KpiCard
            label="Protokoll offen"
            value={stats.data.minutesPending}
            // The one figure here somebody should act on, and the only one
            // toned when it is not zero. A KPI that is always highlighted is
            // one people stop reading.
            tone={stats.data.minutesPending > 0 ? "bronze" : "neutral"}
          />
        </div>
      ) : null}

      {focus ? (
        <div className="rounded-lg bg-surface-sunken px-4 py-3 text-[13px] ring-1 ring-line">
          <span className="text-muted">
            {focus.status === "PLANNED" ? "Als Nächstes" : "Zuletzt"}:{" "}
          </span>
          <button
            type="button"
            onClick={() => navigate(`/sitzungen/${focus.id}`)}
            className="font-medium text-ink underline"
          >
            {focus.label}
          </button>
          <span className="text-muted">
            {" "}
            · {formatDateTime(focus.startsAt)}
            {focusDays !== null && focus.status === "PLANNED"
              ? focusDays === 0
                ? " · heute"
                : focusDays === 1
                  ? " · morgen"
                  : focusDays > 0
                    ? ` · in ${focusDays} Tagen`
                    : ""
              : ""}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {MEETING_STATUS_OPTIONS.map((option) => {
          const on = statuses.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setStatuses((current) =>
                  current.includes(option.value)
                    ? current.filter((s) => s !== option.value)
                    : [...current, option.value],
                );
                setPendingOnly(false);
                setPage(1);
              }}
              className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                on
                  ? "bg-ink text-inverse"
                  : "bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-line-strong"
              }`}
            >
              {option.label}
              <span className="font-mono text-[11px] tnum">
                {stats.data?.byStatus[option.value] ?? 0}
              </span>
            </button>
          );
        })}

        {/*
          Its own chip, set apart, because it is not a status.

          "Protokoll offen" is `HELD` plus `minutesSentAt` being null — a
          combination, and one that cannot be true at the same time as
          "Geplant". Selecting it clears the status chips rather than
          intersecting with them, which is the behaviour that matches what the
          repository actually sends.
        */}
        <button
          type="button"
          aria-pressed={pendingOnly}
          onClick={() => {
            setPendingOnly((current) => !current);
            setStatuses([]);
            setPage(1);
          }}
          className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
            pendingOnly
              ? "bg-ink text-inverse"
              : "bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-line-strong"
          }`}
        >
          Protokoll offen
          <span className="font-mono text-[11px] tnum">{stats.data?.minutesPending ?? 0}</span>
        </button>
      </div>

      <Card bodyClassName="p-5">
        <DataView
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          // A route, not a drawer — a protocol gets quoted, and a quote needs a
          // URL. See the note on `MeetingDetail`.
          onRowClick={(r) => navigate(`/sitzungen/${r.id}`)}
          loading={list.loading}
          caption="Sitzungen"
          page={list.data?.page ?? 1}
          pages={list.data?.pages ?? 1}
          total={list.data?.total ?? 0}
          perPage={list.data?.perPage ?? 25}
          onPageChange={setPage}
          sort={listView.view.sort}
          onSortChange={(next) => {
            listView.setSort(next);
            setPage(1);
          }}
          hiddenColumns={listView.hidden}
          toolbar={
            <>
              <SearchInput
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                label="Sitzungen durchsuchen"
                placeholder="Titel oder Ort"
                className="w-full sm:w-80"
              />
              <div className="ml-auto flex items-center gap-2">
                <ColumnPicker
                  columns={columns.map((c) => ({
                    key: c.key,
                    header: c.header,
                    required: c.required,
                  }))}
                  hidden={listView.hidden}
                  onChange={listView.setHidden}
                  onReset={listView.reset}
                />
                {can("meeting.export") ? (
                  <DownloadButton
                    variant="secondary"
                    label="Als CSV exportieren"
                    // The query, not nothing: an export that quietly contains
                    // more than the filtered view is a document somebody will
                    // act on (architecture §7.2).
                    onDownload={() => mutations.exportCsv(query)}
                  />
                ) : null}
              </div>
            </>
          }
          empty={
            <EmptyState
              title={
                debounced || statuses.length || pendingOnly
                  ? "Nichts gefunden"
                  : "Noch keine Sitzungen"
              }
              description={
                debounced || statuses.length || pendingOnly
                  ? undefined
                  : "Eine Sitzung braucht einen Titel und einen Termin. Teilnehmende, Traktanden und Protokoll kommen danach."
              }
            />
          }
        />
      </Card>

      {creating ? (
        <MeetingCreateDialog
          onClose={() => setCreating(false)}
          onCreated={(meeting) => {
            setCreating(false);
            toast.success("Sitzung angesetzt");
            navigate(`/sitzungen/${meeting.id}`);
          }}
        />
      ) : null}
    </>
  );
}
