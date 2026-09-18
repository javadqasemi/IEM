import { useEffect, useId, useState } from "react";
import { cn } from "@/shared/utils/cn";
import { formatBytes, formatDate, formatDateTime, relativeTime } from "@/shared/utils/format";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/shared/ui/primitives";
import { Field, Input, SearchInput, Select, Textarea, Toggle } from "@/shared/ui/forms";
import { ConfirmDialog, Modal } from "@/shared/ui/overlays";
import { type Column, DataView } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { actionLabel } from "@/entities/audit";
import { APPLICATION_STATUS_OPTIONS, ApplicationBadge } from "@/entities/application";
import { ActivityFeed } from "@/widgets/activity";
import { api, type ApplicationRow, type SettingRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { THEME_CHOICES, useTheme } from "../lib/theme";
import { useAsync, useDebounced, useMutation } from "../lib/useAsync";

/* ================================================================== */
/* Applications                                                        */
/* ================================================================== */

/**
 * Incoming job applications.
 *
 * Personal data under the revDSG, and the screen says so: every record shows
 * its deletion date, dossiers download through a permission-checked route
 * rather than a public URL, and opening one is itself recorded in the audit
 * log.
 */
export function ApplicationsPage() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<ApplicationRow | null>(null);
  const debounced = useDebounced(search);

  const list = useAsync(
    () =>
      api.applications({
        search: debounced || undefined,
        status: status || undefined,
        page,
        perPage: 50,
      }),
    [debounced, status, page],
  );
  const stats = useAsync(() => api.applicationStats(), []);

  const columns: Column<ApplicationRow>[] = [
    {
      key: "name",
      header: "Bewerber:in",
      sortValue: (r) => `${r.lastName} ${r.firstName}`,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">
            {r.firstName} {r.lastName}
          </span>
          <span className="text-[12px] text-muted">{r.email}</span>
        </div>
      ),
    },
    {
      key: "position",
      header: "Position",
      sortValue: (r) => r.position,
      render: (r) => r.position,
    },
    {
      key: "files",
      header: "Dateien",
      numeric: true,
      secondary: true,
      className: "w-24",
      render: (r) => r.files.length,
    },
    {
      key: "status",
      header: "Status",
      className: "w-36",
      sortValue: (r) => r.status,
      render: (r) => <ApplicationBadge status={r.status} />,
    },
    {
      key: "created",
      header: "Eingegangen",
      className: "w-36",
      sortValue: (r) => r.createdAt,
      render: (r) => <span title={formatDateTime(r.createdAt)}>{relativeTime(r.createdAt)}</span>,
    },
  ];

  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;

  return (
    <>
      <PageHeader
        eyebrow="Bewerbungen"
        title="Eingegangene Bewerbungen"
        description="Über das Formular auf der Website. Unterlagen werden nicht öffentlich abgelegt und nach Ablauf der Aufbewahrungsfrist automatisch gelöscht."
      />

      {stats.data ? (
        <div className="flex flex-wrap gap-2">
          {APPLICATION_STATUS_OPTIONS.map((o) => {
            const n = stats.data!.byStatus[o.value] ?? 0;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  setStatus(status === o.value ? "" : o.value);
                  setPage(1);
                }}
                aria-pressed={status === o.value}
                className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  status === o.value
                    ? "bg-ink text-inverse"
                    : "bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-line-strong"
                }`}
              >
                {o.label}
                <span className="font-mono text-[11px] tnum opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <Card bodyClassName="p-5">
        <DataView
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => setOpen(r)}
          loading={list.loading}
          caption="Bewerbungen"
          page={list.data?.page ?? 1}
          pages={list.data?.pages ?? 1}
          total={list.data?.total ?? 0}
          perPage={list.data?.perPage ?? 50}
          onPageChange={setPage}
          toolbar={
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              label="Bewerbungen durchsuchen"
              placeholder="Name, E-Mail oder Position"
              className="w-full sm:w-80"
            />
          }
          empty={
            <EmptyState
              title={debounced || status ? "Nichts gefunden" : "Noch keine Bewerbungen"}
              description={
                debounced || status
                  ? undefined
                  : "Sobald jemand das Formular auf der Website absendet, erscheint die Bewerbung hier."
              }
            />
          }
        />
      </Card>

      <ApplicationDialog
        application={open}
        onClose={() => setOpen(null)}
        onChanged={() => {
          list.reload();
          stats.reload();
          toast.success("Gespeichert");
        }}
      />
    </>
  );
}

function ApplicationDialog({
  application,
  onClose,
  onChanged,
}: {
  application: ApplicationRow | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useMutation(api.updateApplication);
  const remove = useMutation(api.deleteApplication);

  useEffect(() => {
    if (application) {
      setStatus(application.status);
      setNote(application.note ?? "");
    }
  }, [application?.id]);

  if (!application) return null;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`${application.firstName} ${application.lastName}`}
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
                  await update.run(application.id, { status, note });
                  onChanged();
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
            <Pair label="Verfügbar ab">{application.availableFrom ?? "—"}</Pair>
            <Pair label="Eingegangen">{formatDateTime(application.createdAt)}</Pair>
            <Pair label="Löschung">
              {/* Shown because it is a promise the system actually keeps —
                  a nightly job deletes the record and its files on this date. */}
              <span title="Wird automatisch gelöscht">{formatDate(application.retainUntil)}</span>
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
                      // A button, not a link. It was an `<a href>` on the
                      // belief that the browser would authenticate it with a
                      // cookie; there is no such cookie, so every click on this
                      // returned 401. `downloadApplicationFile` fetches it with
                      // the bearer token and saves the blob.
                      <DownloadButton
                        label="Herunterladen"
                        onDownload={() =>
                          api.downloadApplicationFile(application.id, i, file.originalName)
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
              <Field label="Status" htmlFor="app-status">
                <Select
                  id="app-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  options={APPLICATION_STATUS_OPTIONS}
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
          await remove.run(application.id);
          toast.success("Gelöscht");
          setConfirmDelete(false);
          onChanged();
          onClose();
        }}
      />
    </>
  );
}

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="field-label">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/**
 * Starts an authenticated download and reports a failure.
 *
 * Both download routes in the dashboard used to be `<a href>` links that sent no
 * credential and answered 401 — silently, because a browser shows a failed
 * navigation, not an error the application can catch. That is the second reason
 * this is a button: the first is that the request needs an `Authorization`
 * header, and the second is that a failure now has somewhere to go.
 *
 * Shared by the dossier list and the audit export, which is why it sits between
 * them rather than inside either. It has no domain knowledge — the caller hands
 * it the promise.
 */
function DownloadButton({
  label,
  onDownload,
  variant = "link",
}: {
  label: string;
  onDownload: () => Promise<void>;
  variant?: "link" | "secondary";
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onDownload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Der Download ist fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  if (variant === "secondary") {
    return (
      <Button variant="secondary" busy={busy} onClick={() => void run()}>
        {label}
      </Button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void run()}
      className="shrink-0 text-[13px] text-brand-blue transition-colors hover:text-brand-bronze disabled:opacity-50"
    >
      {busy ? "Wird geladen …" : label}
    </button>
  );
}

/* ================================================================== */
/* Settings                                                            */
/* ================================================================== */

export function SettingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const settings = useAsync(() => api.settings(), []);
  const [changes, setChanges] = useState<Record<string, unknown>>({});
  const save = useMutation(api.updateSettings);

  if (settings.error) return <ErrorState message={settings.error} onRetry={settings.reload} />;

  const dirty = Object.keys(changes).length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Einstellungen"
        title="System und Betrieb"
        description="Unternehmensangaben, E-Mail-Versand, Aufbewahrungsfristen und Sicherheitsvorgaben."
        actions={
          can("settings.update") ? (
            <Button
              variant="primary"
              disabled={!dirty}
              busy={save.busy}
              onClick={async () => {
                const updates = Object.entries(changes).map(([key, value]) => ({ key, value }));
                const ok = await save.run(updates);
                if (ok) {
                  setChanges({});
                  toast.success("Gespeichert", `${updates.length} Einstellung(en) übernommen.`);
                  settings.reload();
                }
              }}
            >
              Speichern
            </Button>
          ) : null
        }
      />

      {save.error ? <ErrorState title="Speichern fehlgeschlagen" message={save.error} /> : null}

      {settings.loading ? (
        <div className="flex flex-col gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-lg" />
          ))}
        </div>
      ) : (
        (settings.data ?? []).map((group) => (
          <Card key={group.group} title={group.group}>
            <div className="flex flex-col gap-5">
              {group.settings.map((setting) => (
                <SettingField
                  key={setting.key}
                  setting={setting}
                  value={changes[setting.key] ?? setting.value}
                  disabled={
                    !can("settings.update") ||
                    (setting.secret && !can("settings.secrets"))
                  }
                  onChange={(next) => setChanges({ ...changes, [setting.key]: next })}
                />
              ))}
            </div>
          </Card>
        ))
      )}
    </>
  );
}

/**
 * One setting, rendered from the shape of its stored value.
 *
 * The type is inferred rather than declared, which is the honest reflection of
 * a JSON column: a boolean gets a toggle, a number a numeric input, an array a
 * comma list, everything else a text box. A secret shows its mask and writing
 * the mask back is a no-op on the server, so saving the SMTP form without
 * retyping the password does not blank it.
 *
 * **`pending` marks a setting nothing reads yet**, and it is drawn differently
 * rather than hidden. An audit of this screen found that 23 of the 25 settings
 * were stored, editable, and consumed by no code — the SMTP block configured
 * nothing because mail came from the environment, and `workflow.requireApproval`
 * described lifting the four-eyes principle while doing nothing at all, so an
 * operator could as easily have believed they were switching it *on*. Most are
 * now wired; the rest say so.
 *
 * Saying so beats hiding them: they are the shape of half-built features —
 * `security.requireMfaForAdmins` has its columns and its dependency but no
 * enrolment flow — and an operator looking for the MFA switch should find it
 * with an explanation rather than not find it. It is the same choice the
 * executive dashboard makes with `KpiUnavailable`: a figure with no source shown
 * as a gap rather than as a zero.
 */
function SettingField({
  setting,
  value,
  onChange,
  disabled,
}: {
  setting: SettingRow;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
}) {
  const id = `setting-${setting.key}`;

  /** The key line, plus a plain statement when nothing reads the value. */
  const hint = setting.pending
    ? `${setting.key} · der Wert wird gespeichert, aber noch von nichts gelesen`
    : setting.secret
      ? `${setting.key} · ${setting.hasValue ? "gesetzt" : "nicht gesetzt"} — leer lassen, um den Wert zu behalten`
      : setting.key;

  /**
   * A badge, not a dimmed block.
   *
   * `opacity-60` on the wrapper was the first attempt, and an axe pass measured
   * what it did: it multiplies through to the text inside, dropping the hint
   * from `muted` to **2.54:1** in the light theme and 3.43:1 in the dark. The
   * information — "nothing reads this yet" — was being carried by the one
   * property that also makes it hard to read.
   *
   * A label says it outright, at full contrast, and says it more precisely than
   * a shade could.
   */
  const pendingMark = setting.pending ? (
    <Badge tone="neutral">noch nicht angebunden</Badge>
  ) : null;

  if (typeof setting.value === "boolean") {
    return (
      <div className="flex flex-col gap-1.5">
        {pendingMark}
        <Toggle
          label={setting.description ?? setting.key}
          hint={hint}
          checked={Boolean(value)}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    );
  }

  return (
    <Field
      label={setting.description ?? setting.key}
      htmlFor={id}
      hint={hint}
      action={pendingMark}
    >
      {Array.isArray(setting.value) ? (
        <Input
          id={id}
          disabled={disabled}
          value={(value as string[])?.join(", ") ?? ""}
          onChange={(e) =>
            onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
          }
        />
      ) : typeof setting.value === "number" ? (
        <Input
          id={id}
          type="number"
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        />
      ) : (
        <Input
          id={id}
          disabled={disabled}
          type={setting.secret ? "password" : "text"}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={setting.secret ? "new-password" : undefined}
        />
      )}
    </Field>
  );
}

/* ================================================================== */
/* Audit                                                               */
/* ================================================================== */

export function AuditPage() {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<import("../lib/api").AuditRow | null>(null);
  const debounced = useDebounced(search);

  const actions = useAsync(() => api.auditActions(), []);
  const list = useAsync(
    () =>
      api.audit({
        search: debounced || undefined,
        action: action || undefined,
        outcome: outcome || undefined,
        page,
        perPage: 50,
      }),
    [debounced, action, outcome, page],
  );

  const columns: Column<import("../lib/api").AuditRow>[] = [
    {
      key: "when",
      header: "Zeitpunkt",
      className: "w-44",
      sortValue: (r) => r.createdAt,
      render: (r) => (
        <span className="font-mono text-[12px] tnum" title={relativeTime(r.createdAt)}>
          {formatDateTime(r.createdAt)}
        </span>
      ),
    },
    {
      key: "actor",
      header: "Benutzer",
      sortValue: (r) => r.actorEmail ?? "",
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-ink">{r.actor?.name ?? "System"}</span>
          {r.actorEmail ? <span className="text-[11px] text-muted">{r.actorEmail}</span> : null}
        </div>
      ),
    },
    {
      key: "action",
      header: "Aktion",
      sortValue: (r) => r.action,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-ink">{actionLabel(r.action)}</span>
          <span className="font-mono text-[11px] text-muted">{r.action}</span>
        </div>
      ),
    },
    {
      key: "resource",
      header: "Objekt",
      secondary: true,
      render: (r) => (
        <span className="font-mono text-[12px] text-muted">
          {r.resource}
          {r.resourceId ? `/${r.resourceId.slice(0, 8)}` : ""}
        </span>
      ),
    },
    {
      key: "outcome",
      header: "Ergebnis",
      className: "w-28",
      render: (r) =>
        r.outcome === "SUCCESS" ? (
          <Badge tone="energy">OK</Badge>
        ) : r.outcome === "DENIED" ? (
          <Badge tone="gold">Verweigert</Badge>
        ) : (
          <Badge tone="bronze">Fehler</Badge>
        ),
    },
  ];

  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Audit-Log"
        description="Jede Anmeldung, Änderung, Freigabe und Löschung. Der Eintrag wird beim Ausführen geschrieben und kann nicht nachträglich verändert werden."
        actions={
          <DownloadButton
            variant="secondary"
            label="Als CSV exportieren"
            onDownload={() => api.downloadAuditExport({ search: debounced, action, outcome })}
          />
        }
      />

      <Card bodyClassName="p-5">
        <DataView
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => setDetail(r)}
          loading={list.loading}
          caption="Audit-Log"
          page={list.data?.page ?? 1}
          pages={list.data?.pages ?? 1}
          total={list.data?.total ?? 0}
          perPage={list.data?.perPage ?? 50}
          onPageChange={setPage}
          toolbar={
            <>
              <SearchInput
                value={search}
                onChange={(v) => {
                  setSearch(v);
                  setPage(1);
                }}
                label="Audit-Log durchsuchen"
                placeholder="Benutzer, Aktion oder Meldung"
                className="w-full sm:w-72"
              />
              <Select
                aria-label="Nach Aktion filtern"
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setPage(1);
                }}
                placeholder="Alle Aktionen"
                options={(actions.data ?? []).map((a) => ({
                  value: a.action,
                  label: `${actionLabel(a.action)} (${a.count})`,
                }))}
                className="w-auto"
              />
              <Select
                aria-label="Nach Ergebnis filtern"
                value={outcome}
                onChange={(e) => {
                  setOutcome(e.target.value);
                  setPage(1);
                }}
                placeholder="Alle Ergebnisse"
                options={[
                  { value: "SUCCESS", label: "Erfolgreich" },
                  { value: "FAILURE", label: "Fehlgeschlagen" },
                  { value: "DENIED", label: "Verweigert" },
                ]}
                className="w-auto"
              />
            </>
          }
          empty={<EmptyState title="Keine Einträge gefunden" />}
        />
      </Card>

      {detail ? (
        <Modal
          open
          onClose={() => setDetail(null)}
          title={actionLabel(detail.action)}
          description={`${detail.actor?.name ?? "System"} · ${formatDateTime(detail.createdAt)}`}
          size="lg"
        >
          <div className="flex flex-col gap-5">
            <dl className="grid gap-x-6 gap-y-3 text-[14px] sm:grid-cols-2">
              <Pair label="Aktion">
                <span className="font-mono text-[13px]">{detail.action}</span>
              </Pair>
              <Pair label="Objekt">
                <span className="font-mono text-[13px]">
                  {detail.resource}
                  {detail.resourceId ? `/${detail.resourceId}` : ""}
                </span>
              </Pair>
              <Pair label="IP">{detail.ip ?? "—"}</Pair>
              <Pair label="Ergebnis">{detail.outcome}</Pair>
            </dl>

            {detail.message ? (
              <div className="flex flex-col gap-1.5">
                <span className="field-label">Meldung</span>
                <p className="text-[14px] leading-relaxed text-ink">{detail.message}</p>
              </div>
            ) : null}

            {/* Before/after. Secret values were removed when the row was
                written — the log never held them. */}
            {detail.before || detail.after ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <span className="field-label">Vorher</span>
                  <pre className="scroll-thin max-h-72 overflow-auto rounded-md bg-brand-bronze/[0.06] p-3 text-[12px] leading-relaxed text-ink ring-1 ring-brand-bronze/20">
                    {detail.before ? JSON.stringify(detail.before, null, 2) : "—"}
                  </pre>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="field-label">Nachher</span>
                  <pre className="scroll-thin max-h-72 overflow-auto rounded-md bg-disc-energy/[0.06] p-3 text-[12px] leading-relaxed text-ink ring-1 ring-disc-energy/20">
                    {detail.after ? JSON.stringify(detail.after, null, 2) : "—"}
                  </pre>
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/* ================================================================== */
/* Profile                                                             */
/* ================================================================== */

/**
 * The appearance control.
 *
 * On the **profile** page rather than in Einstellungen, and the split is the
 * point: `/einstellungen` holds settings stored on the server that change the
 * system for everyone, while this is stored in this browser and changes nothing
 * for anyone else. Putting a per-browser preference among the SMTP host and the
 * retention period would invite an operator to expect it to travel with their
 * account, which it does not.
 *
 * Radio buttons rather than a toggle, because there are three states. A toggle
 * would force "system" to be spelled some other way, and "follows the machine"
 * is both the default and the one most people want.
 */
function ThemeCard() {
  const { choice, resolved, setChoice } = useTheme();
  const name = useId();

  return (
    <Card
      title="Darstellung"
      description="Gilt nur in diesem Browser. Die Einstellung wird nicht mit dem Konto gespeichert."
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Farbschema</legend>
        {THEME_CHOICES.map((option) => {
          const id = `${name}-${option.value}`;
          const active = choice === option.value;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 transition-colors",
                active ? "bg-accent/[0.07]" : "hover:bg-surface-2",
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={active}
                onChange={() => setChoice(option.value)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer border-field text-accent focus:ring-2 focus:ring-accent"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[14px] leading-tight text-ink">
                  {option.label}
                  {option.value === "system" ? (
                    // Which way "automatic" currently resolves is the one thing
                    // the label cannot say by itself, and it is what a reader
                    // checks when the choice does not look like it did anything.
                    <span className="text-muted"> · zurzeit {resolved === "dark" ? "dunkel" : "hell"}</span>
                  ) : null}
                </span>
                <span className="text-[12px] leading-snug text-muted">{option.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </Card>
  );
}

export function ProfilePage() {
  const { user, reload } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [mismatch, setMismatch] = useState("");

  const change = useMutation(api.changePassword);
  const activity = useAsync(
    () => (user ? api.audit({ actorId: user.id, perPage: 15 }) : Promise.resolve(null)),
    [user?.id],
  );

  if (!user) return null;

  return (
    <>
      <PageHeader eyebrow="Profil" title={user.name} description={user.email} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Konto">
          <dl className="flex flex-col gap-3 text-[14px]">
            <Pair label="Rollen">
              <div className="flex flex-wrap gap-1 pt-0.5">
                {user.roles.map((r) => (
                  <Badge key={r.key} tone={r.key === "super_admin" ? "navy" : "neutral"}>
                    {r.name}
                  </Badge>
                ))}
              </div>
            </Pair>
            <Pair label="Berechtigungen">
              {user.isSuperAdmin ? "Alle (Super Admin)" : `${user.permissions.length}`}
            </Pair>
            <Pair label="Zuletzt angemeldet">{formatDateTime(user.lastLoginAt)}</Pair>
          </dl>
        </Card>

        <ThemeCard />

        <Card
          title="Passwort ändern"
          description="Beim Ändern werden alle anderen offenen Sitzungen beendet."
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (next !== repeat) {
                setMismatch("Die beiden neuen Passwörter stimmen nicht überein.");
                return;
              }
              setMismatch("");
              const ok = await change.run(current, next);
              if (ok !== null && !change.error) {
                toast.success("Passwort geändert", "Andere Sitzungen wurden abgemeldet.");
                setCurrent("");
                setNext("");
                setRepeat("");
                void reload();
              }
            }}
          >
            <Field label="Aktuelles Passwort" htmlFor="pw-current">
              <Input
                id="pw-current"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <Field
              label="Neues Passwort"
              htmlFor="pw-new"
              hint="Mindestens 12 Zeichen. Länge zählt mehr als Sonderzeichen."
            >
              <Input
                id="pw-new"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                required
              />
            </Field>
            <Field label="Wiederholen" htmlFor="pw-repeat" error={mismatch || undefined}>
              <Input
                id="pw-repeat"
                type="password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                invalid={Boolean(mismatch)}
                required
              />
            </Field>

            {change.error ? (
              <p role="alert" className="text-[13px] font-medium text-brand-bronze">
                {change.error}
              </p>
            ) : null}

            <div>
              <Button type="submit" variant="primary" busy={change.busy}>
                Passwort ändern
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <Card title="Ihre letzten Aktionen" bodyClassName="px-5 py-1">
        {activity.loading ? (
          <Skeleton className="h-32" />
        ) : (
          <ActivityFeed
            items={(activity.data?.items ?? []).map((a) => ({
              id: a.id,
              action: a.action,
              actor: "Sie",
              target: a.resource,
              message: a.message,
              outcome: a.outcome,
              at: a.createdAt,
            }))}
          />
        )}
      </Card>
    </>
  );
}
