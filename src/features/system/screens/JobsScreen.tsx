import { useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { type Column, DataTable, Pair } from "@/shared/ui/data";
import { Field, SearchInput, Select } from "@/shared/ui/forms";
import { ConfirmDialog, Modal } from "@/shared/ui/overlays";
import { useToast } from "@/shared/ui/feedback";
import { JobPhaseBadge, jobLabel } from "@/entities/system";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import { useAuth } from "@/core/auth";
import { useJob, useJobActions, useJobStats, useJobs } from "../hooks/useSystem";
import { formatAttempts, formatDuration } from "../service";
import type { JobRow } from "../types";

/**
 * Job Operations — the screen `core/jobs` shipped without.
 *
 * ---
 *
 * ## The two buttons never guess
 *
 * `capabilities` travels with every row, computed by
 * `core/jobs/jobs.rules.ts`. The dashboard does not know that
 * `backup.restore` is never retryable and must not learn it: a second copy of
 * that rule here is a copy that is one entry behind on the day it matters.
 * Where an action is refused, the **reason** is the tooltip, because a button
 * that is simply absent is a dead end an operator works around by editing the
 * database.
 *
 * ## `phase`, not `status`
 *
 * The table shows the server's derived phase, which separates *waiting to run
 * for the first time* from *waiting to run again after failing twice*. Both
 * are `QUEUED` in the database and they are opposite news.
 *
 * ## There is no "Fehlgeschlagen" filter
 *
 * `JobStatus.FAILED` is written by nothing — `JobService.fail` writes `DEAD`
 * or `QUEUED` — so a chip for it would return an empty list for ever, which
 * an operator reads as "there are no failures". *Nur aufgegebene* is the
 * honest version of that filter and is what the server's `failedOnly` means.
 */
/** The five statuses a row can actually hold. See the note at the filter. */
const STATUS_OPTIONS = [
  { value: "", label: "Alle" },
  { value: "QUEUED", label: "Wartend" },
  { value: "RUNNING", label: "Läuft" },
  { value: "DONE", label: "Erledigt" },
  { value: "DEAD", label: "Aufgegeben" },
  { value: "CANCELLED", label: "Abgebrochen" },
];

export function JobsScreen() {
  const { can } = useAuth();
  const toast = useToast();

  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ job: JobRow; action: "retry" | "cancel" } | null>(null);

  const stats = useJobStats();
  const jobs = useJobs({ status: status || undefined, name: name || undefined, failedOnly, search: search || undefined, page, perPage: 25 });
  const actions = useJobActions();

  const rows = jobs.data?.items ?? [];

  const columns: Column<JobRow>[] = [
    {
      key: "name",
      header: "Aufgabe",
      render: (job) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">{jobLabel(job.name)}</span>
          <span className="font-mono text-[11px] text-muted">{job.name}</span>
        </div>
      ),
    },
    {
      key: "phase",
      header: "Zustand",
      className: "w-32",
      render: (job) => <JobPhaseBadge phase={job.phase} />,
    },
    {
      key: "attempts",
      header: "Versuche",
      className: "w-28",
      secondary: true,
      render: (job) => <span className="tnum">{formatAttempts(job)}</span>,
    },
    {
      key: "created",
      header: "Eingereiht",
      className: "w-36",
      sortValue: (job) => job.createdAt,
      render: (job) => (
        <span title={formatDateTime(job.createdAt)}>{relativeTime(job.createdAt)}</span>
      ),
    },
    {
      key: "duration",
      header: "Dauer",
      className: "w-24",
      secondary: true,
      render: (job) => <span className="tnum">{formatDuration(job.durationMs)}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "w-px",
      render: (job) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setOpenId(job.id)}>
            Details
          </Button>
          {can("job.retry") ? (
            /*
              `disabledReason`, not `title` (P1C, UX-14): a `disabled`
              button receives no pointer events, so the refusal the server
              computed for this row was a tooltip that could never appear.
            */
            <Button
              size="sm"
              variant="secondary"
              disabled={!job.capabilities.retryable || actions.busy === job.id}
              disabledReason={job.capabilities.retryable ? null : job.capabilities.retryRefusal}
              onClick={() => setConfirm({ job, action: "retry" })}
            >
              Wiederholen
            </Button>
          ) : null}
          {can("job.cancel") ? (
            // "Stoppen", not "Abbrechen": the confirmation used to show two
            // buttons with that word, one that dismissed and one that acted.
            <Button
              size="sm"
              variant="danger-quiet"
              disabled={!job.capabilities.cancellable || actions.busy === job.id}
              disabledReason={job.capabilities.cancellable ? null : job.capabilities.cancelRefusal}
              onClick={() => setConfirm({ job, action: "cancel" })}
            >
              Stoppen
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Counts ---- */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <CountTile label="Wartend" value={stats.data?.queued} />
        <CountTile label="Läuft" value={stats.data?.running} />
        <CountTile label="Aufgegeben" value={stats.data?.dead} tone={stats.data?.dead ? "bronze" : undefined} />
        <CountTile label="Erledigt (24 h)" value={stats.data?.done24h} />
      </div>

      {/* ---- Filters ---- */}
      {/*
        Not "Hintergrundaufgaben": since P1B that is the page's own heading
        (the section title replaced the tab strip), and the card repeating it
        one line below read as the same thing twice.
      */}
      <Card
        title="Warteschlange und Verlauf"
        description="Alles, was ausserhalb einer Anfrage läuft: Veröffentlichungen, Sicherungen, Zustellungen, Aufräumarbeiten."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            {/*
              `CANCELLED` and `DEAD` are offered; **`FAILED` is not**.

              `JobService.fail` writes `DEAD` when the attempts run out and
              `QUEUED` when they do not, so nothing ever writes `FAILED` —
              a chip for it would return an empty list for ever, which an
              operator reads as "there are no failures".
              `UNREACHABLE_STATUSES` in `core/jobs/jobs.rules.ts` records it
              and `jobs.rules.test.ts` asserts it.
            */}
            <Field label="Zustand" htmlFor="job-status">
              <Select
                id="job-status"
                value={status}
                options={STATUS_OPTIONS}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setFailedOnly(false);
                  setPage(1);
                }}
              />
            </Field>

            <Field label="Art" htmlFor="job-name">
              <Select
                id="job-name"
                value={name}
                /*
                  Built from the catalogue the server sends rather than from a
                  second list here — adding a job type makes it filterable
                  with no edit on this side.
                */
                options={[
                  { value: "", label: "Alle" },
                  ...(stats.data?.names ?? []).map((n) => ({ value: n, label: jobLabel(n) })),
                ]}
                onChange={(e) => {
                  setName(e.target.value);
                  setPage(1);
                }}
              />
            </Field>

            <SearchInput
              className="min-w-[16rem] flex-1"
              label="Suche"
              value={search}
              onChange={(next) => {
                setSearch(next);
                setPage(1);
              }}
              placeholder="Aufgaben-ID, Korrelations-ID, Sicherungs-ID"
            />

            <Button
              variant={failedOnly ? "primary" : "secondary"}
              onClick={() => {
                setFailedOnly((v) => !v);
                setStatus("");
                setPage(1);
              }}
            >
              Nur aufgegebene
            </Button>
          </div>

          {jobs.error ? (
            <ErrorState message={jobs.error} onRetry={jobs.refetch} />
          ) : !jobs.data ? (
            <Skeleton className="h-64" />
          ) : rows.length ? (
            <>
              <DataTable
                rows={rows}
                columns={columns}
                rowKey={(job) => job.id}
                error={jobs.error}
                onRetry={jobs.refetch}
                caption="Hintergrundaufgaben"
              />
              {jobs.data.pages > 1 ? (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[13px] text-muted">
                    Seite {jobs.data.page} von {jobs.data.pages} · {jobs.data.total} Aufgaben
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Zurück
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={page >= jobs.data.pages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Weiter
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState
              title="Keine Aufgaben"
              description={
                failedOnly
                  ? "Keine Aufgabe hat endgültig aufgegeben. Das ist die gute Nachricht."
                  : "Zu diesem Filter gibt es nichts. Die Warteschlange ist meistens leer — das ist der Normalfall."
              }
            />
          )}
        </div>
      </Card>

      <JobDetailDialog id={openId} onClose={() => setOpenId(null)} />

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        busy={actions.busy !== null}
        destructive={confirm?.action === "cancel"}
        title={
          confirm?.action === "retry"
            ? `„${confirm ? jobLabel(confirm.job.name) : ""}“ wiederholen?`
            : `„${confirm ? jobLabel(confirm.job.name) : ""}“ stoppen?`
        }
        confirmLabel={confirm?.action === "retry" ? "Wiederholen" : "Aufgabe stoppen"}
        message={
          confirm?.action === "retry" ? (
            <>
              <p>Die Aufgabe wird erneut eingereiht, mit zurückgesetztem Versuchszähler.</p>
              <p className="mt-2">
                Sie läuft, sobald der Arbeitsprozess sie übernimmt — üblicherweise innerhalb von
                zehn Sekunden.
              </p>
            </>
          ) : (
            <>
              <p>Die Aufgabe wird nicht ausgeführt.</p>
              <p className="mt-2">
                Das gilt nur, solange sie noch wartet. Hat der Arbeitsprozess sie in der
                Zwischenzeit übernommen, schlägt der Abbruch fehl und sagt das auch.
              </p>
            </>
          )
        }
        onConfirm={async () => {
          if (!confirm) return;
          const ok =
            confirm.action === "retry"
              ? await actions.retry(confirm.job.id)
              : await actions.cancel(confirm.job.id);
          if (ok) {
            toast.success(
              confirm.action === "retry" ? "Eingereiht" : "Abgebrochen",
              confirm.action === "retry"
                ? "Die Aufgabe läuft beim nächsten Durchlauf."
                : "Die Aufgabe wird nicht ausgeführt.",
            );
          } else if (actions.error) {
            toast.push({ kind: "error", title: "Nicht möglich", description: actions.error });
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}

/* ================================================================== */

function CountTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone?: "bronze";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-2 px-4 py-3 ring-1 ring-line">
      <span className="text-[12px] text-muted">{label}</span>
      {value === undefined ? (
        <Skeleton className="h-7 w-12" />
      ) : (
        <span
          className={`text-[22px] font-semibold tnum ${tone === "bronze" ? "text-brand-bronze" : "text-ink"}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}

/**
 * One job, with everything an operator needs to follow it outward.
 *
 * The correlation id is shown as text rather than as a link into the audit
 * log: `/audit` filters by action and resource, not by correlation, so a link
 * would promise a filter that does not exist. Copying the id into the audit
 * search is the honest path, and the field says so.
 */
function JobDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const job = useJob(id);

  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title={job.data ? jobLabel(job.data.name) : "Aufgabe"}
      description={job.data?.id}
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Schliessen
        </Button>
      }
    >
      {job.error ? (
        <ErrorState message={job.error} onRetry={job.refetch} />
      ) : !job.data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Pair label="Zustand">
              <JobPhaseBadge phase={job.data.phase} />
            </Pair>
            <Pair label="Versuche">{formatAttempts(job.data)}</Pair>
            <Pair label="Eingereiht">{formatDateTime(job.data.createdAt)}</Pair>
            <Pair label="Fällig">{formatDateTime(job.data.runAfter)}</Pair>
            <Pair label="Gestartet">
              {job.data.startedAt ? formatDateTime(job.data.startedAt) : "—"}
            </Pair>
            <Pair label="Beendet">
              {job.data.finishedAt ? formatDateTime(job.data.finishedAt) : "—"}
            </Pair>
            <Pair label="Dauer">{formatDuration(job.data.durationMs)}</Pair>
            <Pair label="Nächster Versuch">
              {job.data.nextAttemptAt ? formatDateTime(job.data.nextAttemptAt) : "—"}
            </Pair>
            <Pair label="Ausgelöst von">{job.data.actorEmail ?? "System"}</Pair>
            <Pair label="Bearbeiter">{job.data.lockedBy ?? "—"}</Pair>
            <Pair label="Korrelations-ID" className="sm:col-span-2">
              {job.data.correlationId ? (
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono text-[12px] text-ink">{job.data.correlationId}</span>
                  <span className="text-[11px] text-muted">
                    Im Audit-Log nach dieser ID suchen, um zusammengehörige Einträge zu finden.
                  </span>
                </span>
              ) : (
                "—"
              )}
            </Pair>
          </dl>

          {job.data.error ? (
            <div className="flex flex-col gap-1.5">
              <span className="field-label">Fehler</span>
              <p className="whitespace-pre-wrap break-words rounded-md bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-ink ring-1 ring-line">
                {job.data.error}
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <span className="field-label">Nutzdaten</span>
            {/*
              Scrubbed server-side by the same denylist the audit log uses, and
              bounded. A payload is arbitrary JSON written by whoever enqueued
              the job — it is the one field on this dialog that could carry a
              credential, and the guarantee is in `core/redaction/redact.ts`
              rather than here.
            */}
            <pre className="overflow-x-auto rounded-md bg-surface-2 px-4 py-3 text-[12px] leading-relaxed text-ink ring-1 ring-line">
              {JSON.stringify(job.data.payload ?? {}, null, 2)}
            </pre>
          </div>

          {job.data.result != null ? (
            <div className="flex flex-col gap-1.5">
              <span className="field-label">Ergebnis</span>
              <pre className="overflow-x-auto rounded-md bg-surface-2 px-4 py-3 text-[12px] leading-relaxed text-ink ring-1 ring-line">
                {JSON.stringify(job.data.result, null, 2)}
              </pre>
            </div>
          ) : null}

          {!job.data.capabilities.retryable && job.data.capabilities.retryRefusal ? (
            <p className="rounded-md bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-muted">
              <Badge tone="neutral">Nicht wiederholbar</Badge>{" "}
              <span className="ml-1">{job.data.capabilities.retryRefusal}</span>
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
