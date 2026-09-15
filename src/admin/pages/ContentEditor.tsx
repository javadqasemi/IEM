import { useEffect, useState } from "react";
import { api, type EntryRow, type VersionRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { navigate } from "../lib/router";
import { useAsync, useMutation } from "../lib/useAsync";
import { useToast } from "../ui/toast";
import {
  Breadcrumb,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Skeleton,
  Textarea,
} from "../ui/primitives";
import { FieldRenderer } from "../ui/FieldRenderer";
import { WorkflowBadge, formatDateTime, relativeTime } from "../ui/data";
import { MediaPickerDialog } from "./Media";
import { title } from "./Content";
import { tokenHelp } from "@/content/iem";

/**
 * The editor for one content entry.
 *
 * The form is generated from the content type's field definitions — see
 * `FieldRenderer` — so this file owns none of the field layout and all of the
 * *workflow*: what an editor may do with the thing they have just changed, and
 * in what order.
 *
 * The rule the screen exists to make obvious: **saving does not publish.** A
 * save writes a draft and a version; publishing is a separate act, gated on a
 * separate permission, that operates on the whole site at once. Editors get
 * this wrong with CMSes that blur the two, so the status, the buttons and the
 * warning line all say it.
 */
export function ContentEditorPage({
  typeKey,
  entryId,
}: {
  typeKey: string;
  entryId: string;
}) {
  const isNew = entryId === "neu";
  const { can } = useAuth();
  const toast = useToast();

  const types = useAsync(() => api.contentTypes(), []);
  const loaded = useAsync(
    () => (isNew ? Promise.resolve(null) : api.entry(entryId)),
    [entryId, isNew],
  );

  const type = types.data?.find((t) => t.key === typeKey);
  const entry = loaded.data;

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [key, setKey] = useState("");
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState<((url: string) => void) | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  // Seed the form once the entry arrives. Keyed on the entry's own version so
  // a reload after saving refreshes the form, but an in-progress edit is never
  // clobbered by a background refetch.
  useEffect(() => {
    if (entry) {
      setDraft(structuredClone(entry.data));
      setKey(entry.key);
      setDirty(false);
    } else if (isNew) {
      setDraft({});
      setKey("");
      setDirty(false);
    }
  }, [entry?.id, entry?.version, isNew]);

  const save = useMutation(async () => {
    if (isNew) {
      const created = await api.createEntry(typeKey, draft, key || undefined);
      return created;
    }
    return api.updateEntry(entryId, draft, note || undefined);
  });
  const submit = useMutation(api.submit);
  const rollback = useMutation(api.rollback);

  /**
   * Warns before losing unsaved work.
   *
   * `beforeunload` covers a reload or a closed tab. It cannot cover a hash
   * change — the browser does not treat that as a navigation — so the in-app
   * guard is the "Verwerfen" dialog on the back link instead.
   */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (next: Record<string, unknown>) => {
    setDraft(next);
    setDirty(true);
  };

  if (loaded.error) return <ErrorState message={loaded.error} onRetry={loaded.reload} />;
  if (types.loading || (loaded.loading && !isNew)) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-[28rem] rounded-lg" />
      </div>
    );
  }
  if (!type) {
    return <ErrorState title="Unbekannter Bereich" message={`„${typeKey}“ gibt es nicht.`} />;
  }

  const status = entry?.status ?? "DRAFT";
  const canEdit = can(isNew ? "content.create" : "content.update");
  const label = entry ? title(entry) : `Neuer Eintrag — ${type.name}`;

  async function onSave() {
    const result = await save.run();
    if (!result) return;
    setDirty(false);
    setNote("");
    toast.success(
      isNew ? "Angelegt" : "Gespeichert",
      "Als Entwurf gesichert. Sichtbar wird die Änderung erst mit der Veröffentlichung.",
    );
    if (isNew) navigate(`/inhalte/${typeKey}/${(result as EntryRow).id}`, { replace: true });
    else loaded.reload();
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Breadcrumb
          items={[
            { label: "Inhalte", to: "/inhalte" },
            { label: type.name, to: `/inhalte/${typeKey}` },
            { label: isNew ? "Neu" : label },
          ]}
        />
        <PageHeader
          title={label}
          description={type.description ?? undefined}
          actions={
            <>
              <Button
                variant="ghost"
                onClick={() => (dirty ? setDiscardOpen(true) : navigate(`/inhalte/${typeKey}`))}
              >
                Zurück
              </Button>
              {!isNew && can("content.history") ? (
                <Button variant="secondary" onClick={() => setShowVersions(true)}>
                  Verlauf ({entry?.versions.length ?? 0})
                </Button>
              ) : null}
              {!isNew && canEdit && can("content.submit") && status === "DRAFT" ? (
                <Button variant="secondary" onClick={() => setSubmitOpen(true)} disabled={dirty}>
                  Zur Freigabe
                </Button>
              ) : null}
              {canEdit ? (
                <Button variant="primary" onClick={onSave} busy={save.busy} disabled={!dirty && !isNew}>
                  {isNew ? "Anlegen" : "Speichern"}
                </Button>
              ) : null}
            </>
          }
        />
      </div>

      {/* ---- Status line ---- */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-surface px-5 py-3 ring-1 ring-line">
        <div className="flex items-center gap-2">
          <span className="eyebrow text-muted">Status</span>
          <WorkflowBadge state={status} />
        </div>
        {entry ? (
          <>
            <Meta label="Version" value={String(entry.version)} mono />
            <Meta
              label="Geändert"
              value={relativeTime(entry.updatedAt)}
              title={formatDateTime(entry.updatedAt)}
            />
            {entry.publishedAt ? (
              <Meta
                label="Veröffentlicht"
                value={relativeTime(entry.publishedAt)}
                title={formatDateTime(entry.publishedAt)}
              />
            ) : null}
          </>
        ) : null}
        {dirty ? (
          <span className="ml-auto text-[13px] font-medium text-brand-bronze">
            Nicht gespeicherte Änderungen
          </span>
        ) : null}
      </div>

      {status === "PUBLISHED" && dirty ? (
        <p className="rounded-lg bg-surface-2 px-5 py-3 text-[13px] leading-relaxed text-muted">
          Dieser Eintrag ist veröffentlicht. Beim Speichern wird er zum Entwurf und muss erneut
          durch die Freigabe — die Website zeigt bis dahin unverändert den bisherigen Stand.
        </p>
      ) : null}

      {save.error ? (
        <ErrorState
          title={
            Object.keys(save.fields).length
              ? "Die Eingaben sind noch nicht vollständig."
              : "Speichern fehlgeschlagen"
          }
          message={save.error}
        />
      ) : null}

      {/* ---- The form ---- */}
      <Card>
        <div className="flex flex-col gap-6">
          {isNew && type.kind === "COLLECTION" ? (
            <Field
              label="Kennung"
              htmlFor="entry-key"
              optional
              hint="Kurzname für Verweise und Adressen. Leer lassen, dann wird sie aus dem Titel gebildet."
            >
              <Input
                id="entry-key"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setDirty(true);
                }}
                spellCheck={false}
                className="font-mono text-[13px]"
              />
            </Field>
          ) : null}

          <FieldRenderer
            fields={type.schema}
            value={draft}
            onChange={update}
            errors={save.fields}
            tokenHelp={tokenHelp}
            disabled={!canEdit}
            imagePicker={(onPick) => setPicker(() => onPick)}
          />

          {!isNew && canEdit ? (
            <Field
              label="Notiz zur Änderung"
              htmlFor="entry-note"
              optional
              hint="Erscheint im Verlauf und hilft beim Nachvollziehen, warum etwas geändert wurde."
            >
              <Textarea
                id="entry-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          ) : null}
        </div>
      </Card>

      {/* ---- Dialogs ---- */}
      <MediaPickerDialog
        open={Boolean(picker)}
        onClose={() => setPicker(null)}
        onPick={(url) => {
          picker?.(url);
          setPicker(null);
          setDirty(true);
        }}
      />

      {entry ? (
        <VersionsDialog
          open={showVersions}
          onClose={() => setShowVersions(false)}
          entryId={entry.id}
          currentVersion={entry.version}
          versions={entry.versions}
          canRollback={can("content.rollback")}
          busy={rollback.busy}
          onRollback={async (version) => {
            await rollback.run(entry.id, version);
            toast.success("Zurückgesetzt", `Version ${version} wurde als neue Version übernommen.`);
            setShowVersions(false);
            loaded.reload();
          }}
        />
      ) : null}

      <SubmitDialog
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        busy={submit.busy}
        onSubmit={async (message) => {
          await submit.run(entryId, message);
          toast.success("Eingereicht", "Der Eintrag liegt zur Freigabe bereit.");
          setSubmitOpen(false);
          loaded.reload();
        }}
      />

      <ConfirmDialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        destructive
        title="Änderungen verwerfen?"
        confirmLabel="Verwerfen"
        message="Die nicht gespeicherten Änderungen gehen verloren."
        onConfirm={() => {
          setDiscardOpen(false);
          setDirty(false);
          navigate(`/inhalte/${typeKey}`);
        }}
      />
    </>
  );
}

function Meta({
  label,
  value,
  mono,
  title: hoverTitle,
}: {
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="flex items-center gap-2" title={hoverTitle}>
      <span className="eyebrow text-muted">{label}</span>
      <span className={`text-[13px] text-ink ${mono ? "font-mono tnum" : ""}`}>{value}</span>
    </div>
  );
}

/* ================================================================== */
/* Versions                                                            */
/* ================================================================== */

/**
 * The version history, with a field-level comparison.
 *
 * The diff is computed on the server so this screen and the review screen show
 * the same thing — a reviewer deciding whether to approve must be looking at
 * exactly what the editor was looking at.
 */
function VersionsDialog({
  open,
  onClose,
  entryId,
  currentVersion,
  versions,
  canRollback,
  onRollback,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  entryId: string;
  currentVersion: number;
  versions: VersionRow[];
  canRollback: boolean;
  onRollback: (version: number) => void;
  busy: boolean;
}) {
  const [compare, setCompare] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);

  const diff = useAsync(
    () =>
      compare === null
        ? Promise.resolve(null)
        : api.diff(entryId, compare, currentVersion),
    [entryId, compare, currentVersion],
  );

  useEffect(() => {
    if (!open) setCompare(null);
  }, [open]);

  return (
    <>
      <Modal open={open} onClose={onClose} title="Versionsverlauf" size="lg">
        <div className="flex flex-col gap-4">
          <ol className="flex flex-col">
            {versions.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-3 last:border-0"
              >
                <span className="w-10 shrink-0 font-mono text-[13px] tnum text-ink">{v.version}</span>
                <span className="w-32 shrink-0 text-[13px] text-muted" title={formatDateTime(v.createdAt)}>
                  {relativeTime(v.createdAt)}
                </span>
                <span className="w-32 shrink-0 truncate text-[13px] text-ink">
                  {v.author?.name ?? "—"}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                  {v.note ?? ""}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {v.version !== currentVersion ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCompare(compare === v.version ? null : v.version)}
                      >
                        {compare === v.version ? "Schliessen" : "Vergleichen"}
                      </Button>
                      {canRollback ? (
                        <Button size="sm" variant="ghost" onClick={() => setConfirm(v.version)}>
                          Wiederherstellen
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <span className="eyebrow px-2 text-brand-blue">aktuell</span>
                  )}
                </span>
              </li>
            ))}
          </ol>

          {compare !== null ? (
            <div className="rounded-lg bg-surface-2/50 p-4 ring-1 ring-line">
              <h3 className="eyebrow mb-3 text-muted">
                Version {compare} → {currentVersion}
              </h3>
              {diff.loading ? (
                <Skeleton className="h-24" />
              ) : diff.data?.changes.length ? (
                <ul className="flex flex-col gap-3">
                  {diff.data.changes.map((c) => (
                    <li key={c.key} className="flex flex-col gap-1.5">
                      <span className="font-mono text-[11px] text-muted">{c.key}</span>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <pre className="scroll-thin overflow-x-auto rounded bg-brand-bronze/[0.07] p-2.5 text-[12px] leading-relaxed text-ink ring-1 ring-brand-bronze/20">
                          {format(c.before)}
                        </pre>
                        <pre className="scroll-thin overflow-x-auto rounded bg-disc-energy/[0.07] p-2.5 text-[12px] leading-relaxed text-ink ring-1 ring-disc-energy/20">
                          {format(c.after)}
                        </pre>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">Keine Unterschiede.</p>
              )}
            </div>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        busy={busy}
        title={`Version ${confirm} wiederherstellen?`}
        confirmLabel="Wiederherstellen"
        message={
          <>
            <p>
              Der Inhalt von Version {confirm} wird als <em>neue</em> Version übernommen. Der
              Verlauf bleibt vollständig — nichts wird überschrieben.
            </p>
            <p className="mt-2">Die Website ändert sich erst mit der nächsten Veröffentlichung.</p>
          </>
        }
        onConfirm={() => {
          if (confirm !== null) onRollback(confirm);
          setConfirm(null);
        }}
      />
    </>
  );
}

function format(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/* ================================================================== */
/* Submit for review                                                   */
/* ================================================================== */

function SubmitDialog({
  open,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (message: string) => void;
  busy: boolean;
}) {
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (open) setMessage("");
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Zur Freigabe einreichen"
      description="Die geprüfte Fassung ist der aktuelle Stand dieses Eintrags."
      size="sm"
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={() => onSubmit(message)} busy={busy}>
            Einreichen
          </Button>
        </>
      }
    >
      <Field
        label="Nachricht an die prüfende Person"
        htmlFor="submit-message"
        optional
        hint="Was geändert wurde und worauf zu achten ist."
      >
        <Textarea
          id="submit-message"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          autoFocus
        />
      </Field>
    </Modal>
  );
}
