import { useEffect, useState } from "react";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/shared/ui/primitives";
import { DateTimePicker, Field, Form, Textarea, toLocalInput } from "@/shared/ui/forms";
import { ConfirmDialog, Modal } from "@/shared/ui/overlays";
import { type Column, DataTable } from "@/shared/ui/data";
import { Badge } from "@/shared/ui/primitives";
import { Callout, useToast } from "@/shared/ui/feedback";
import { WorkflowBadge } from "@/entities/content";
import { api, type PublishEffect, type QueueRow, type ReviewRow } from "../lib/api";
import { useAuth } from "@/core/auth";
import { Link } from "@/core/router";
import { useMutation } from "@/shared/hooks";
import { useAsync } from "../lib/useAsync";

/* ================================================================== */
/* Review queue                                                        */
/* ================================================================== */

/**
 * Everything waiting on a decision.
 *
 * The reviewer sees the submitted version's content, not the entry's current
 * content — the request points at a version for exactly that reason. Approving
 * "the entry" would approve whatever it happens to say by the time somebody
 * gets to it.
 */
export function ReviewsPage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const reviews = useAsync(() => api.reviews(), []);
  const [open, setOpen] = useState<ReviewRow | null>(null);

  const decide = useMutation(api.decide);

  const rows = reviews.data ?? [];

  const columns: Column<ReviewRow>[] = [
    {
      key: "entry",
      header: "Eintrag",
      sortValue: (r) => r.entry.key,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">{r.entry.key}</span>
          <span className="text-[11px] text-muted">{r.entry.typeKey}</span>
        </div>
      ),
    },
    {
      key: "by",
      header: "Eingereicht von",
      secondary: true,
      sortValue: (r) => r.requestedBy?.name ?? "",
      render: (r) => r.requestedBy?.name ?? "—",
    },
    {
      key: "message",
      header: "Nachricht",
      secondary: true,
      render: (r) => (
        <span className="line-clamp-2 text-[13px] text-muted">{r.message ?? "—"}</span>
      ),
    },
    {
      key: "when",
      header: "Wartet seit",
      className: "w-36",
      sortValue: (r) => r.createdAt,
      render: (r) => (
        <span title={formatDateTime(r.createdAt)}>{relativeTime(r.createdAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-px",
      render: (r) => (
        <Button size="sm" variant="secondary" onClick={() => setOpen(r)}>
          Prüfen
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Freigaben"
        title="Warten auf Prüfung"
        description="Eingereichte Änderungen. Freigegebene Einträge erscheinen noch nicht auf der Website — dafür braucht es den Schritt „Veröffentlichen“."
        actions={
          can("content.publish") ? (
            <Button variant="primary" href="#/veroeffentlichen">
              Veröffentlichen
            </Button>
          ) : null
        }
      />

      {reviews.error ? (
        <ErrorState
          title="Die Freigaben konnten nicht geladen werden."
          message={reviews.error}
          onRetry={reviews.reload}
        />
      ) : reviews.loading ? (
        <Skeleton className="h-48 rounded-lg" />
      ) : rows.length ? (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          open={{ onOpen: (r) => setOpen(r) }}
          error={reviews.error}
          caption="Offene Freigabeanfragen"
        />
      ) : (
        <EmptyState
          title="Nichts offen"
          description="Zurzeit wartet keine Änderung auf eine Freigabe."
          action={
            <Button href="#/inhalte" variant="secondary">
              Zu den Inhalten
            </Button>
          }
        />
      )}

      <ReviewDialog
        // Keyed by the review: the note typed for one review must not be
        // pre-filled into the next (Part 10.2, "note persists across reviews").
        key={open?.id ?? "none"}
        review={open}
        onClose={() => setOpen(null)}
        canDecide={can("content.approve")}
        ownSubmission={Boolean(open?.requestedBy && open.requestedBy.id === user?.id) && !user?.isSuperAdmin}
        busy={decide.busy}
        error={decide.error}
        onDecide={async (decision, note) => {
          if (!open) return;
          const result = await decide.run(open.id, decision, note);
          /*
            This used to read `decide.error` right after the await — which is
            the value from the render *before* the call, always `null` here,
            so a refused approval fell through to "Freigegeben". The refusal
            is shown in the dialog from the hook's state, as before.
          */
          if (!result.ok) return;
          toast.success(
            decision === "APPROVED" ? "Freigegeben" : "Abgelehnt",
            decision === "APPROVED"
              ? "Der Eintrag wird mit der nächsten Veröffentlichung live."
              : "Der Eintrag geht zurück an die einreichende Person.",
          );
          setOpen(null);
          reviews.reload();
        }}
      />
    </>
  );
}

function ReviewDialog({
  review,
  onClose,
  onDecide,
  canDecide,
  ownSubmission,
  busy,
  error,
}: {
  review: ReviewRow | null;
  onClose: () => void;
  onDecide: (decision: "APPROVED" | "REJECTED", note?: string) => void;
  canDecide: boolean;
  ownSubmission: boolean;
  busy: boolean;
  error: string | null;
}) {
  const [note, setNote] = useState("");
  if (!review) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={review.entry.key}
      description={`${review.entry.typeKey} · Version ${review.version.version}`}
      size="lg"
      busy={busy}
      footer={
        canDecide && !ownSubmission ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Abbrechen
            </Button>
            {/*
              `secondary`, not `danger` (P1C): rejecting sends the entry back
              to its author with a reason — a safe alternative, not a removal.
              One primary per decision context; "Freigeben" is it.
            */}
            <Button variant="secondary" onClick={() => onDecide("REJECTED", note)} busy={busy}>
              Ablehnen
            </Button>
            <Button variant="primary" onClick={() => onDecide("APPROVED", note)} busy={busy}>
              Freigeben
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Schliessen
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {ownSubmission ? (
          <p className="rounded-md bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-muted">
            Sie haben diese Änderung selbst eingereicht. Eine zweite Person muss sie prüfen — das
            ist der Sinn des Schritts.
          </p>
        ) : null}

        {review.message ? (
          <div className="flex flex-col gap-1.5">
            <span className="field-label">Nachricht der einreichenden Person</span>
            <p className="rounded-md bg-surface-2 px-4 py-3 text-[14px] leading-relaxed text-ink">
              {review.message}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <span className="field-label">Eingereichter Stand</span>
          {/* The submitted version's own data, field by field. Reviewing
              against the entry's current content would mean approving
              something other than what was submitted. */}
          <dl className="flex flex-col divide-y divide-line rounded-md bg-surface-2/50 px-4 ring-1 ring-line">
            {Object.entries(review.version.data).map(([key, value]) => (
              <div key={key} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 font-mono text-[11px] text-muted sm:w-40">{key}</dt>
                <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">
                  {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <Link
          to={`/inhalte/${review.entry.typeKey}/${review.entry.id}`}
          className="self-start text-[13px] text-brand-blue hover:text-brand-bronze"
        >
          Eintrag im Editor öffnen →
        </Link>

        {/*
          The decision's one field is a form, so its refusal is the shared
          `Callout` above it. There is no submit on Enter: the dialog has two
          outcomes and the reader picks one with a button.
        */}
        {canDecide && !ownSubmission ? (
          <Form onSubmit={() => undefined} error={error}>
            <Field
              label="Begründung"
              htmlFor="review-note"
              optional
              hint="Bei einer Ablehnung wichtig — sie sagt, was zu ändern ist."
            >
              <Textarea
                id="review-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </Form>
        ) : error ? (
          <Callout tone="danger" announce>
            <p className="font-medium text-ink">{error}</p>
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* Publish                                                             */
/* ================================================================== */

/**
 * Publishing, and the history of what was published when.
 *
 * One button for the whole site rather than per entry, because that is what
 * the server does: publishing freezes every approved entry and writes one
 * snapshot. Splitting it per entry in the UI would suggest a granularity the
 * system does not have.
 */
export function PublishPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [restore, setRestore] = useState<number | null>(null);
  const [scheduling, setScheduling] = useState<QueueRow | null>(null);
  const [cancelling, setCancelling] = useState<QueueRow | null>(null);
  const [withdrawing, setWithdrawing] = useState<QueueRow | null>(null);

  const diff = useAsync(() => api.pendingChanges(), []);
  const queue = useAsync(() => api.publishingQueue(), []);
  const snapshots = useAsync(() => api.snapshots(), []);
  /*
    Gated on the permission, not merely hidden.

    A query the caller cannot make answers 403, and a failed query used to
    retry itself for ever — the thousand-request bug `core/api/query.ts`
    records. `useAsync` is the older hook and does not loop, but the rule the
    shell learned still holds: a request nobody may make should not be sent.
  */
  const failures = useAsync(
    () =>
      can("audit.read")
        ? api.audit({ resource: "content_snapshot", outcome: "FAILURE", perPage: 5 })
        : Promise.resolve({ items: [], total: 0, page: 1, perPage: 5, pages: 0 }),
    [],
  );
  const publish = useMutation(api.publish);
  const restoreSnapshot = useMutation(api.restoreSnapshot);
  const schedule = useMutation(api.scheduleEntry);
  const cancelSchedule = useMutation(api.cancelSchedule);
  const unpublish = useMutation(api.unpublishEntry);

  /** Everything the screen changed, in the order a reader would check it. */
  const reloadAll = () => {
    diff.reload();
    queue.reload();
    snapshots.reload();
  };

  const queued = queue.data?.items ?? [];
  const scheduled = queued.filter((row) => row.scheduledAt !== null);
  // What publishing would actually change — not the same as how many entries
  // are approved. See `PendingChanges` in `lib/api.ts`.
  const changes = diff.data?.changes ?? [];
  const differs = diff.data?.changed ?? false;

  return (
    <>
      <PageHeader
        eyebrow="Veröffentlichen"
        title="Änderungen live schalten"
        description="Beim Veröffentlichen werden alle freigegebenen Einträge eingefroren und als ein Stand der Website gespeichert. Entwürfe bleiben aussen vor."
      />

      {/*
        Driven by the document comparison, not by the count of approved
        entries. Those are different questions, and the gap between them was a
        real fault: deleting a team member marks the row deleted and leaves its
        status alone, so it never becomes `APPROVED`. This card used to read
        "nothing is approved" and disable the button, while the live site still
        showed the person and only publishing would remove them.
      */}
      <Card
        title={
          diff.error
            ? "Abgleich mit der Website fehlgeschlagen"
            : differs
              ? `${changes.length} ${changes.length === 1 ? "Bereich weicht" : "Bereiche weichen"} von der Website ab`
              : "Website ist auf dem aktuellen Stand"
        }
        description={
          diff.error
            ? "Ob die Website aktuell ist, lässt sich gerade nicht sagen."
            : differs
              ? "Diese Bereiche sehen nach dem Veröffentlichen anders aus als jetzt auf der Website."
              : "Der Entwurf und der veröffentlichte Stand stimmen überein. Veröffentlichen würde nichts ändern."
        }
        action={
          can("content.publish") ? (
            <Button
              variant="primary"
              disabled={!differs}
              disabledReason={
                diff.error
                  ? "Erst muss der Abgleich mit der Website gelingen."
                  : "Nichts zu veröffentlichen — Entwurf und Website stimmen überein."
              }
              onClick={() => setConfirm(true)}
            >
              Jetzt veröffentlichen
            </Button>
          ) : null
        }
      >
        {/* A failed comparison is not "up to date" — the one reading this
            card must never give when it does not know (UX-21). */}
        {diff.error ? (
          <ErrorState message={diff.error} onRetry={diff.reload} />
        ) : diff.loading ? (
          <Skeleton className="h-24" />
        ) : differs ? (
          <ul className="flex flex-col divide-y divide-line">
            {changes.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{c.label}</span>
                {c.live !== null && c.next !== null && c.live !== c.next ? (
                  <span className="shrink-0 font-mono text-[13px] tnum text-muted">
                    {c.live} → <span className="text-ink">{c.next}</span>
                  </span>
                ) : (
                  <span className="shrink-0 text-[13px] text-muted">geändert</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] leading-relaxed text-muted">
            {diff.data?.liveVersion
              ? `Die Website zeigt Version ${diff.data.liveVersion}.`
              : "Es wurde noch nichts veröffentlicht."}
          </p>
        )}
      </Card>

      {/*
        The publishing queue, which replaced a card that listed `status:
        APPROVED` and said so in its own description: "Löschungen und
        Umsortierungen erscheinen hier nicht". That was the honest version of
        the same blindness the card above this one was built to fix — a
        deletion never reaches `APPROVED`, so the one row somebody most needs
        to see before publishing was the one a status filter could not show.

        `effect` comes from the server (`publishEffect`), so the screen renders
        an answer rather than deriving a second one that can disagree.
      */}
      <Card
        title={
          scheduled.length
            ? `Warteschlange — ${scheduled.length} terminiert`
            : "Warteschlange"
        }
        description="Alles, was beim nächsten Veröffentlichen live geht, verschwindet oder auf einen Zeitpunkt wartet."
      >
        {queue.error ? (
          <ErrorState
            title="Die Warteschlange konnte nicht geladen werden."
            message={queue.error}
            onRetry={queue.reload}
          />
        ) : queue.loading ? (
          <Skeleton className="h-24" />
        ) : queued.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {queued.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <Link
                  to={`/inhalte/${row.typeKey}/${row.id}`}
                  className="min-w-0 flex-1 truncate text-[14px] text-ink hover:text-brand-blue"
                >
                  {row.key}
                </Link>
                <span className="shrink-0 text-[12px] text-muted">{row.typeKey}</span>
                <EffectBadge effect={row.effect} />
                <WorkflowBadge state={row.status} />
                {row.scheduledAt ? (
                  <span
                    className="shrink-0 text-[12px] tnum text-disc-water"
                    title={formatDateTime(row.scheduledAt)}
                  >
                    ⏱ {formatDateTime(row.scheduledAt)}
                  </span>
                ) : null}

                <span className="flex shrink-0 items-center gap-1">
                  {can("content.schedule") && row.scheduledAt ? (
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(row)}>
                      Terminierung aufheben
                    </Button>
                  ) : null}
                  {can("content.schedule") && !row.scheduledAt && row.status === "APPROVED" ? (
                    <Button size="sm" variant="ghost" onClick={() => setScheduling(row)}>
                      Terminieren
                    </Button>
                  ) : null}
                  {can("content.unpublish") && row.publishedAt && !row.deleted ? (
                    <Button size="sm" variant="danger-quiet" onClick={() => setWithdrawing(row)}>
                      Zurückziehen
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] leading-relaxed text-muted">
            Nichts in der Warteschlange. Sobald eine Änderung eingereicht oder freigegeben ist,
            erscheint sie hier.
          </p>
        )}
      </Card>

      {/*
        Fehlgeschlagene Veröffentlichungen, and the card exists because of
        *when* they happen rather than how often.

        A publish somebody pressed fails in front of them, in a dialog. A
        scheduled one fails at 02:00 into a log, and the first sign is a page
        that is not live when it was promised. The notification
        (`content.publish_failed`) is the primary channel; this is where
        somebody looks afterwards to see whether it has happened before.

        Read out of the audit log rather than out of a `Job` row, because the
        job runner has no operator surface yet (`docs/ENTERPRISE_ROADMAP.md` →
        P2-1) — so the card is gated on `audit.read` and simply absent for
        somebody who cannot read the log. An empty card promising a list they
        will never be shown would be worse than no card.
      */}
      {can("audit.read") ? (
        <Card
          title="Fehlgeschlagene Veröffentlichungen"
          description="Zeitgesteuerte Läufe, die nicht durchgelaufen sind. Die Einträge bleiben dabei freigegeben und terminiert."
        >
          {failures.error ? (
            <ErrorState message={failures.error} onRetry={failures.reload} />
          ) : failures.loading ? (
            <Skeleton className="h-16" />
          ) : failures.data?.items.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {failures.data.items.map((row) => (
                <li key={row.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5">
                  <span
                    className="w-36 shrink-0 text-[13px] text-muted"
                    title={formatDateTime(row.createdAt)}
                  >
                    {relativeTime(row.createdAt)}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] text-ink">
                    {row.message ?? "Ohne Meldung"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] leading-relaxed text-muted">
              Keine fehlgeschlagene Veröffentlichung aufgezeichnet.
            </p>
          )}
        </Card>
      ) : null}

      <Card
        title="Veröffentlichungen"
        description="Jeder Stand bleibt erhalten und kann wieder live geschaltet werden."
      >
        {snapshots.error ? (
          <ErrorState message={snapshots.error} onRetry={snapshots.reload} />
        ) : snapshots.loading ? (
          <Skeleton className="h-32" />
        ) : snapshots.data?.length ? (
          <ol className="flex flex-col divide-y divide-line">
            {snapshots.data.map((s, i) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <span className="w-12 shrink-0 font-mono text-[13px] tnum text-ink">v{s.version}</span>
                <span
                  className="w-36 shrink-0 text-[13px] text-muted"
                  title={formatDateTime(s.publishedAt)}
                >
                  {relativeTime(s.publishedAt)}
                </span>
                <span className="w-36 shrink-0 truncate text-[13px] text-ink">
                  {s.publishedBy?.name ?? "System"}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                  {s.note ?? ""}
                  {s.restoredFrom ? ` (aus v${s.restoredFrom})` : ""}
                </span>
                {i === 0 ? (
                  <span className="eyebrow shrink-0 px-2 text-disc-energy">live</span>
                ) : can("content.rollback") && can("content.publish") ? (
                  <Button size="sm" variant="ghost" onClick={() => setRestore(s.version)}>
                    Wiederherstellen
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[14px] leading-relaxed text-muted">
            Noch nichts veröffentlicht. Die Website zeigt bis dahin den Stand, der im Build
            mitgeliefert wurde — sie ist also nicht leer, nur nicht aktualisierbar.
          </p>
        )}
      </Card>

      {/* ---- Publish confirmation ---- */}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Veröffentlichen"
        description={`${changes.length} ${changes.length === 1 ? "Bereich wird" : "Bereiche werden"} auf der Website aktualisiert: ${changes.map((c) => c.label).join(", ")}.`}
        size="sm"
        busy={publish.busy}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={publish.busy}>
              Abbrechen
            </Button>
            <Button
              variant="primary"
              busy={publish.busy}
              onClick={async () => {
                const result = await publish.run(note || undefined);
                // The refusal is shown in this dialog from `publish.error`.
                if (!result.ok) return;
                const published = result.data;
                toast.push({
                  kind: published.warnings.length ? "info" : "success",
                  title: `Veröffentlicht — Version ${published.version}`,
                  description: `${published.entriesPublished} Eintrag/Einträge übernommen.`,
                  // Warnings are shown, not swallowed: "diese Person ist einem
                  // Standort zugeordnet, den es nicht gibt" is exactly the kind
                  // of thing that would otherwise be found by a visitor.
                  details: published.warnings,
                });
                setNote("");
                setConfirm(false);
                reloadAll();
              }}
            >
              Veröffentlichen
            </Button>
          </>
        }
      >
        {/* One optional note; publishing is the footer's button, not Enter in a textarea. */}
        <Form onSubmit={() => undefined} error={publish.error}>
          <Field
            label="Notiz"
            htmlFor="publish-note"
            optional
            hint="Erscheint im Verlauf. Hilft später beim Einordnen, was dieser Stand enthielt."
          >
            <Textarea
              id="publish-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoFocus
            />
          </Field>
        </Form>
      </Modal>

      <ConfirmDialog
        open={restore !== null}
        onClose={() => setRestore(null)}
        busy={restoreSnapshot.busy}
        title={`Version ${restore} wiederherstellen?`}
        // Names the effect: this does not stage anything, it goes live now.
        confirmLabel="Wiederherstellen und veröffentlichen"
        message={
          <>
            <p>
              Der Inhalt von Version {restore} wird als <em>neue</em> Version veröffentlicht und ist
              sofort live.
            </p>
            <p className="mt-2">
              Der Verlauf bleibt vollständig — es bleibt nachvollziehbar, was wann live war.
            </p>
          </>
        }
        onConfirm={async () => {
          if (restore === null) return;
          const result = await restoreSnapshot.run(restore);
          if (result.ok) {
            toast.success(
              `Wiederhergestellt — Version ${result.data.version}`,
              `Der Stand aus Version ${restore} ist jetzt live.`,
            );
          } else {
            toast.error("Nicht wiederhergestellt", result.failure.message);
          }
          setRestore(null);
          reloadAll();
        }}
      />

      {/* ---- Schedule ---- */}
      <ScheduleDialog
        entry={scheduling}
        onClose={() => setScheduling(null)}
        busy={schedule.busy}
        error={schedule.error}
        onSchedule={async (at) => {
          if (!scheduling) return;
          const result = await schedule.run(scheduling.id, at, scheduling.version);
          // The refusal is shown in the dialog from `schedule.error`.
          if (!result.ok) return;
          toast.success(
            "Terminiert",
            `„${scheduling.key}“ geht am ${formatDateTime(result.data.scheduledAt)} live.`,
          );
          setScheduling(null);
          reloadAll();
        }}
      />

      {/* ---- Cancel a schedule ---- */}
      <ConfirmDialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        busy={cancelSchedule.busy}
        title="Terminierung aufheben?"
        confirmLabel="Terminierung aufheben"
        message={
          <>
            <p>
              „{cancelling?.key}“ wird zum vorgemerkten Zeitpunkt nicht mehr automatisch
              veröffentlicht.
            </p>
            <p className="mt-2">
              Die Freigabe bleibt bestehen — der Eintrag geht mit der nächsten Veröffentlichung
              von Hand live.
            </p>
          </>
        }
        onConfirm={async () => {
          if (!cancelling) return;
          const result = await cancelSchedule.run(cancelling.id);
          if (result.ok) toast.success("Aufgehoben", `„${cancelling.key}“ wartet nicht mehr.`);
          else toast.error("Terminierung nicht aufgehoben", result.failure.message);
          setCancelling(null);
          reloadAll();
        }}
      />

      {/* ---- Unpublish ---- */}
      <ConfirmDialog
        open={withdrawing !== null}
        onClose={() => setWithdrawing(null)}
        busy={unpublish.busy}
        destructive
        title={`„${withdrawing?.key}“ von der Website zurückziehen?`}
        confirmLabel="Veröffentlichung zurückziehen"
        message={
          <>
            <p>
              Der Eintrag verschwindet <em>sofort</em> von der Website: es wird dabei ein neuer
              Stand veröffentlicht.
            </p>
            <p className="mt-2">
              Der Entwurf bleibt erhalten. Um ihn wieder live zu bringen, muss er erneut durch die
              Freigabe — das ist der Unterschied zum Ausblenden, das sich einfach zurücknehmen
              lässt.
            </p>
          </>
        }
        onConfirm={async () => {
          if (!withdrawing) return;
          const result = await unpublish.run(withdrawing.id, withdrawing.version);
          if (result.ok) {
            toast.push({
              kind: result.data.warnings.length ? "info" : "success",
              title: `Zurückgezogen — Stand ${result.data.snapshot}`,
              description: `„${withdrawing.key}“ ist nicht mehr auf der Website.`,
              details: result.data.warnings,
            });
          } else {
            // A 409 here means the entry changed since the queue was loaded;
            // the reload below shows the newer state, and the toast says why.
            toast.error("Nicht zurückgezogen", result.failure.message);
          }
          setWithdrawing(null);
          reloadAll();
        }}
      />
    </>
  );
}

/* ================================================================== */
/* Pieces                                                              */
/* ================================================================== */

/**
 * What the next publish does to this row, as a word.
 *
 * `WITHDRAW` is the one that earns the component. A deleted or hidden entry
 * that is still live reads `DRAFT` in the status badge beside it — accurate,
 * and the opposite of what somebody about to press "Veröffentlichen" needs to
 * know, which is that a page is about to disappear.
 */
const EFFECT_LABEL: Record<PublishEffect, { label: string; tone: "energy" | "water" | "bronze" | "neutral" }> = {
  PUBLISH: { label: "geht live", tone: "energy" },
  REPUBLISH: { label: "wird aktualisiert", tone: "water" },
  WITHDRAW: { label: "verschwindet", tone: "bronze" },
  NONE: { label: "keine Änderung", tone: "neutral" },
};

function EffectBadge({ effect }: { effect: PublishEffect }) {
  const { label, tone } = EFFECT_LABEL[effect];
  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * Picks a moment for an approved entry to go live.
 *
 * The `min` is five minutes out and not "now", matching `MIN_SCHEDULE_LEAD_MS`
 * on the server: the cron ticks every five minutes, so anything nearer is
 * "publish now" wearing a timestamp and would look, to whoever set it, like a
 * schedule that fired late. Constraining the picker is better than explaining
 * the refusal — the same argument `DatePicker` makes about `min`/`max`.
 */
function ScheduleDialog({
  entry,
  onClose,
  onSchedule,
  busy,
  error,
}: {
  entry: QueueRow | null;
  onClose: () => void;
  onSchedule: (at: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [at, setAt] = useState("");
  const [floor, setFloor] = useState("");

  /*
    Reset on open, and read the clock here rather than in the render body.

    Two things at once, and neither is optional. The component stays mounted
    while `entry` is null, so without this a time typed for one entry would be
    offered back for the next one — and `Date.now()` during render is an
    impure call the React Compiler rules refuse outright, because a re-render
    would silently move the floor under a value the operator had already
    chosen.

    The same reset-on-open shape `ConfirmDialog` in `shared/ui/overlays` uses,
    and it carries the same `set-state-in-effect` warning for the same reason.
  */
  useEffect(() => {
    if (!entry) return;
    setAt("");
    setFloor(toLocalInput(new Date(Date.now() + 6 * 60_000)));
  }, [entry?.id]);

  if (!entry) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Veröffentlichung terminieren"
      description={`„${entry.key}“ (${entry.typeKey}) · Version ${entry.version}`}
      size="sm"
      busy={busy}
      hint={at ? null : "Zuerst Datum und Uhrzeit wählen."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!at}
            disabledReason="Zuerst Datum und Uhrzeit wählen."
            onClick={() => onSchedule(at)}
          >
            Terminieren
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <DateTimePicker
          label="Zeitpunkt"
          value={at}
          onChange={setAt}
          min={floor}
          hint="Ihre Ortszeit. Die Zeitsteuerung prüft alle fünf Minuten — die Veröffentlichung läuft also frühestens dann."
        />
        <p className="rounded-md bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-muted">
          Zum gewählten Zeitpunkt wird die ganze Website neu veröffentlicht — alles, was bis dahin
          freigegeben ist, geht mit. Eine Terminierung ersetzt die Freigabe nicht.
        </p>
        {error ? (
          <p role="alert" className="text-[13px] font-medium text-brand-bronze">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
