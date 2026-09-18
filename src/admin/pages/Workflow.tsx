import { useState } from "react";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/shared/ui/primitives";
import { Field, Textarea } from "@/shared/ui/forms";
import { ConfirmDialog, Modal } from "@/shared/ui/overlays";
import { type Column, DataTable } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { WorkflowBadge } from "@/entities/content";
import { api, type ReviewRow } from "../lib/api";
import { useAuth } from "@/core/auth";
import { Link } from "../lib/router";
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

  if (reviews.error) return <ErrorState message={reviews.error} onRetry={reviews.reload} />;

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

      {reviews.loading ? (
        <Skeleton className="h-48 rounded-lg" />
      ) : rows.length ? (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
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
        review={open}
        onClose={() => setOpen(null)}
        canDecide={can("content.approve")}
        ownSubmission={Boolean(open?.requestedBy && open.requestedBy.id === user?.id) && !user?.isSuperAdmin}
        busy={decide.busy}
        error={decide.error}
        onDecide={async (decision, note) => {
          if (!open) return;
          const ok = await decide.run(open.id, decision, note);
          if (ok === null && decide.error) return;
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
            <Button variant="danger" onClick={() => onDecide("REJECTED", note)} busy={busy}>
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

        {canDecide && !ownSubmission ? (
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
        ) : null}

        {error ? (
          <p role="alert" className="text-[13px] font-medium text-brand-bronze">
            {error}
          </p>
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

  const pending = useAsync(() => api.entries({ status: "APPROVED", perPage: 200 }), []);
  const diff = useAsync(() => api.pendingChanges(), []);
  const snapshots = useAsync(() => api.snapshots(), []);
  const publish = useMutation(api.publish);
  const restoreSnapshot = useMutation(api.restoreSnapshot);

  const ready = pending.data?.items ?? [];
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
          differs
            ? `${changes.length} ${changes.length === 1 ? "Bereich weicht" : "Bereiche weichen"} von der Website ab`
            : "Website ist auf dem aktuellen Stand"
        }
        description={
          differs
            ? "Diese Bereiche sehen nach dem Veröffentlichen anders aus als jetzt auf der Website."
            : "Der Entwurf und der veröffentlichte Stand stimmen überein. Veröffentlichen würde nichts ändern."
        }
        action={
          can("content.publish") ? (
            <Button variant="primary" disabled={!differs} onClick={() => setConfirm(true)}>
              Jetzt veröffentlichen
            </Button>
          ) : null
        }
      >
        {diff.loading ? (
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

      <Card
        title={`${ready.length} freigegebene ${ready.length === 1 ? "Änderung" : "Änderungen"}`}
        description="Bearbeitete Einträge, die den Freigabeschritt durchlaufen haben. Löschungen und Umsortierungen erscheinen hier nicht — sie stehen oben."
      >
        {pending.loading ? (
          <Skeleton className="h-24" />
        ) : ready.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {ready.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 py-2.5">
                <Link
                  to={`/inhalte/${entry.typeKey}/${entry.id}`}
                  className="min-w-0 flex-1 truncate text-[14px] text-ink hover:text-brand-blue"
                >
                  {entry.key}
                </Link>
                <span className="shrink-0 text-[12px] text-muted">{entry.typeKey}</span>
                <WorkflowBadge state={entry.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] leading-relaxed text-muted">
            Sobald eine Änderung freigegeben ist, erscheint sie hier.
          </p>
        )}
      </Card>

      <Card
        title="Veröffentlichungen"
        description="Jeder Stand bleibt erhalten und kann wieder live geschaltet werden."
      >
        {snapshots.loading ? (
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
                if (!result) return;
                toast.push({
                  kind: result.warnings.length ? "info" : "success",
                  title: `Veröffentlicht — Version ${result.version}`,
                  description: `${result.entriesPublished} Eintrag/Einträge übernommen.`,
                  // Warnings are shown, not swallowed: "diese Person ist einem
                  // Standort zugeordnet, den es nicht gibt" is exactly the kind
                  // of thing that would otherwise be found by a visitor.
                  details: result.warnings,
                });
                setNote("");
                setConfirm(false);
                pending.reload();
                diff.reload();
                snapshots.reload();
              }}
            >
              Veröffentlichen
            </Button>
          </>
        }
      >
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
        {publish.error ? (
          <p role="alert" className="mt-4 text-[13px] font-medium text-brand-bronze">
            {publish.error}
          </p>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={restore !== null}
        onClose={() => setRestore(null)}
        busy={restoreSnapshot.busy}
        title={`Version ${restore} wiederherstellen?`}
        confirmLabel="Wiederherstellen"
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
          if (result) {
            toast.success(
              `Wiederhergestellt — Version ${result.version}`,
              `Der Stand aus Version ${restore} ist jetzt live.`,
            );
          }
          setRestore(null);
          snapshots.reload();
        }}
      />
    </>
  );
}
