import { useEffect, useState } from "react";
import { formatBytes, formatDate, formatDateTime } from "@/shared/utils/format";
import { Badge, Button, DownloadButton, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { Pair } from "@/shared/ui/data";
import { Field, Select, Textarea } from "@/shared/ui/forms";
import { ConfirmDialog, Modal } from "@/shared/ui/overlays";
import { useToast } from "@/shared/ui/feedback";
import { useMutation } from "@/shared/hooks";
import {
  APPLICATION_STATUS_OPTIONS,
  isApplicationStatus,
  type ApplicationStatus,
} from "@/entities/application";
import { useAuth } from "@/core/auth";
import { useApplication, useApplicationMutations } from "../hooks/useApplications";
import { allowedNextStatuses, displayName, isRetentionExpiring, retentionDaysLeft } from "../service";

/**
 * One application, opened from the list.
 *
 * It takes an **id**, not a row. The list's copy is a page of results that goes
 * stale the moment anything is saved; fetching the detail by id means the
 * dialog re-renders from the cache after a mutation invalidates it, instead of
 * showing the values the row was carrying when it was clicked.
 */
export function ApplicationDetail({
  id,
  onClose,
  onSaved,
  onDeleted,
}: {
  id: string | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const { data: application, loading, error, refetch } = useApplication(id);
  const mutations = useApplicationMutations();

  const [status, setStatus] = useState<ApplicationStatus>("NEW");
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useMutation(mutations.update);
  const remove = useMutation(mutations.remove);

  // Keyed on the id rather than on the record: the record's identity changes
  // on every cache revalidation, and resetting the form on each of those would
  // discard what the reader had typed while a background refetch landed.
  useEffect(() => {
    if (!application) return;
    setStatus(application.status);
    setNote(application.note ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application?.id]);

  if (!id) return null;

  /*
    A failed load is not a loading state. It used to render the skeleton for
    ever — `!application` is true whether the dossier is on its way or was
    refused — so a 403 or a deleted dossier looked like a slow one (UX-21).
  */
  if (error && !application) {
    return (
      <Modal open onClose={onClose} title="Bewerbung" size="lg">
        <ErrorState
          title="Die Bewerbung konnte nicht geladen werden."
          message={error}
          onRetry={refetch}
        />
      </Modal>
    );
  }

  if (loading || !application) {
    return (
      <Modal open onClose={onClose} title="Bewerbung" size="lg">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Modal>
    );
  }

  const daysLeft = retentionDaysLeft(application);
  const expiring = isRetentionExpiring(application);
  const statusOptions = APPLICATION_STATUS_OPTIONS.filter((o) =>
    isApplicationStatus(o.value) ? allowedNextStatuses(application.status).includes(o.value) : false,
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={displayName(application)}
        description={application.position}
        size="lg"
        busy={update.busy}
        footer={
          <>
            {can("application.delete") ? (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Löschen
              </Button>
            ) : null}
            <div className="flex-1" />
            <Button variant="ghost" onClick={onClose} disabled={update.busy}>
              Schliessen
            </Button>
            {can("application.update") ? (
              <Button
                variant="primary"
                busy={update.busy}
                onClick={async () => {
                  const result = await update.run(application.id, { status, note });
                  // The refusal is rendered above the fields from `update.error`.
                  if (!result.ok) return;
                  onSaved();
                  onClose();
                }}
              >
                Speichern
              </Button>
            ) : null}
          </>
        }
      >
        <div className="flex flex-col gap-5">
          {update.error ? (
            <p role="alert" className="text-[13px] font-medium text-brand-bronze">
              {update.error}
            </p>
          ) : null}

          <dl className="grid gap-x-6 gap-y-3 text-[14px] sm:grid-cols-2">
            <Pair label="E-Mail">
              <a
                href={`mailto:${application.email}`}
                className="text-brand-blue hover:text-brand-bronze"
              >
                {application.email}
              </a>
            </Pair>
            <Pair label="Telefon">
              {application.phone ? (
                <a href={`tel:${application.phone}`} className="text-brand-blue hover:text-brand-bronze">
                  {application.phone}
                </a>
              ) : (
                "—"
              )}
            </Pair>
            {/* Rendered raw: `verfuegbar` is 120 characters the applicant
                typed, and "nach Absprache" is as common as a date. */}
            <Pair label="Verfügbar ab">{application.availableFrom ?? "—"}</Pair>
            <Pair label="Eingegangen">{formatDateTime(application.receivedAt)}</Pair>
            <Pair label="Löschung">
              {/* Shown because it is a promise the system actually keeps —
                  a nightly job deletes the record and its files on this date. */}
              <span className="flex items-center gap-2" title="Wird automatisch gelöscht">
                {formatDate(application.retainUntil)}
                {expiring && daysLeft !== null ? (
                  <Badge tone="bronze">noch {daysLeft} T.</Badge>
                ) : null}
              </span>
            </Pair>
          </dl>

          {application.message ? (
            <div className="flex flex-col gap-1.5">
              <span className="field-label">Nachricht</span>
              <p className="whitespace-pre-wrap rounded-md bg-surface-2 px-4 py-3 text-[14px] leading-relaxed text-ink">
                {application.message}
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <span className="field-label">Unterlagen ({application.files.length})</span>
            {application.files.length ? (
              <ul className="flex flex-col divide-y divide-line rounded-md ring-1 ring-line">
                {application.files.map((file, i) => (
                  <li key={i} className="flex items-center gap-3 bg-surface px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {file.originalName}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tnum text-muted">
                      {formatBytes(file.size)}
                    </span>
                    {can("application.download") ? (
                      <DownloadButton
                        label="Herunterladen"
                        onDownload={() =>
                          mutations.downloadFile(application.id, i, file.originalName)
                        }
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">
                Keine Dateien — die Bewerbung kam über den E-Mail-Weg oder ohne Anhänge.
              </p>
            )}
          </div>

          {can("application.update") ? (
            <>
              <Field
                label="Status"
                htmlFor="app-status"
                hint="Nur die Schritte, die auf den aktuellen Stand folgen können."
              >
                <Select
                  id="app-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
                  options={statusOptions}
                />
              </Field>

              <Field label="Interne Notiz" htmlFor="app-note" optional>
                <Textarea
                  id="app-note"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        busy={remove.busy}
        destructive
        confirmText="LÖSCHEN"
        title="Bewerbung endgültig löschen?"
        confirmLabel="Löschen"
        message={
          <>
            <p>
              Der Datensatz und alle Unterlagen werden unwiderruflich entfernt. Es gibt keinen
              Papierkorb — es handelt sich um Personendaten.
            </p>
            <p className="mt-2">
              Im Audit-Log bleibt vermerkt, dass gelöscht wurde, aber nicht, was darin stand.
            </p>
          </>
        }
        onConfirm={async () => {
          const result = await remove.run(application.id);
          /*
            `remove.error` read here was the value from before the call —
            always `null` — so a refused deletion closed the dialog and
            reported the dossier as gone while it was still there.
          */
          if (!result.ok) {
            toast.error("Nicht gelöscht", result.failure.message);
            return;
          }
          setConfirmDelete(false);
          onDeleted();
          onClose();
        }}
      />
    </>
  );
}

