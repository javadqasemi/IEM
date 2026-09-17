import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { api, type MediaRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync, useDebounced, useMutation } from "../lib/useAsync";
import { useToast } from "../ui/toast";
import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Skeleton,
  Textarea,
} from "../ui/primitives";
import { BarChart, formatBytes, formatDateTime } from "../ui/data";

/**
 * The media library.
 *
 * Two things here are not cosmetic:
 *
 * - **Alt text is asked for at upload**, with "decorative" as an explicit
 *   choice rather than as the default of leaving it blank. An empty alt is a
 *   valid and sometimes correct value — the site's job-advert photos use it —
 *   but it has to be a decision somebody made, not one nobody got to.
 * - **Replace keeps the id.** A re-shot portrait appears everywhere it is used
 *   without anyone editing 41 entries, and the superseded file stays so the
 *   swap is reversible. That is why "Ersetzen" is a separate action from
 *   deleting and uploading again.
 */
export function MediaPage() {
  const { can } = useAuth();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [folderId, setFolderId] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<MediaRow | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const debounced = useDebounced(search);

  const folders = useAsync(() => api.folders(), []);
  const stats = useAsync(() => api.mediaStats(), []);
  const list = useAsync(
    () =>
      api.media({
        search: debounced || undefined,
        folderId: folderId || undefined,
        mimeType: kind || undefined,
        page,
        perPage: 60,
      }),
    [debounced, folderId, kind, page],
  );

  const bulkDelete = useMutation(api.bulkDeleteMedia);

  const rows = list.data?.items ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Medien"
        title="Medienbibliothek"
        description="Bilder und Dokumente der Website. Beim Hochladen werden Bilder automatisch in mehreren Grössen abgelegt und von EXIF-Daten befreit."
        actions={
          can("media.upload") ? <UploadButton onDone={() => { list.reload(); stats.reload(); }} /> : null
        }
      />

      {/* ---- Filters ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          label="Medien durchsuchen"
          placeholder="Dateiname, Alt-Text, Bildlegende"
          className="w-full sm:w-80"
        />
        <Select
          aria-label="Nach Ordner filtern"
          value={folderId}
          onChange={(e) => {
            setFolderId(e.target.value);
            setPage(1);
          }}
          placeholder="Alle Ordner"
          options={(folders.data ?? []).map((f) => ({
            value: f.id,
            label: `${f.path} (${f._count.assets})`,
          }))}
          className="w-auto"
        />
        <Select
          aria-label="Nach Typ filtern"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
          placeholder="Alle Typen"
          options={[
            { value: "image/", label: "Bilder" },
            { value: "application/pdf", label: "PDF" },
          ]}
          className="w-auto"
        />

        {selection.size > 0 && can("media.delete") ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[13px] text-muted">{selection.size} ausgewählt</span>
            <Button size="sm" variant="danger" onClick={() => setConfirmBulk(true)}>
              Löschen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelection(new Set())}>
              Auswahl aufheben
            </Button>
          </div>
        ) : null}
      </div>

      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {/* ---- Grid ---- */}
      {list.loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      ) : rows.length ? (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {rows.map((asset) => (
              <li key={asset.id}>
                <AssetTile
                  asset={asset}
                  selected={selection.has(asset.id)}
                  selectable={can("media.delete")}
                  onToggle={() => {
                    const next = new Set(selection);
                    if (next.has(asset.id)) next.delete(asset.id);
                    else next.add(asset.id);
                    setSelection(next);
                  }}
                  onOpen={() => setDetail(asset)}
                />
              </li>
            ))}
          </ul>
          {(list.data?.pages ?? 1) > 1 ? (
            <div className="flex items-center justify-between">
              <p className="eyebrow text-muted">
                {rows.length} von {list.data?.total}
              </p>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Zurück
                </Button>
                <span className="px-2 font-mono text-[12px] tnum text-muted">
                  {page} / {list.data?.pages}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page >= (list.data?.pages ?? 1)}
                  onClick={() => setPage(page + 1)}
                >
                  Weiter
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          title={debounced ? `Nichts gefunden für „${debounced}“.` : "Noch keine Dateien"}
          description={
            debounced ? undefined : "Laden Sie Bilder hoch, um sie in Inhalten verwenden zu können."
          }
          action={
            debounced ? <Button onClick={() => setSearch("")}>Suche zurücksetzen</Button> : null
          }
        />
      )}

      {/* ---- Storage ---- */}
      {stats.data ? (
        <Card title="Speicher" description={`${stats.data.count} Dateien, ${formatBytes(stats.data.totalBytes)}`}>
          <BarChart
            label="Speicherbelegung nach Dateityp"
            data={stats.data.byType.map((t) => ({ label: t.mimeType, value: t.bytes }))}
            format={formatBytes}
          />
        </Card>
      ) : null}

      <AssetDetailDialog
        asset={detail}
        onClose={() => setDetail(null)}
        onChanged={() => {
          list.reload();
          stats.reload();
        }}
        folders={folders.data ?? []}
      />

      <ConfirmDialog
        open={confirmBulk}
        onClose={() => setConfirmBulk(false)}
        busy={bulkDelete.busy}
        destructive
        title={`${selection.size} Dateien löschen?`}
        confirmLabel="Löschen"
        message="Die Dateien werden aus der Bibliothek entfernt. Inhalte, die noch darauf verweisen, zeigen dann ein fehlendes Bild — prüfen Sie das vor dem Veröffentlichen."
        onConfirm={async () => {
          await bulkDelete.run([...selection]);
          toast.success("Gelöscht", `${selection.size} Datei(en) entfernt.`);
          setSelection(new Set());
          setConfirmBulk(false);
          list.reload();
          stats.reload();
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

function AssetTile({
  asset,
  selected,
  selectable,
  onToggle,
  onOpen,
}: {
  asset: MediaRow;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const isImage = asset.mimeType.startsWith("image/");
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg bg-surface ring-1 transition-shadow",
        selected ? "ring-2 ring-accent" : "ring-line hover:shadow-card",
      )}
    >
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="grid aspect-square place-items-center bg-surface-2">
          {isImage ? (
            <img
              src={asset.url}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="font-mono text-[11px] uppercase text-muted">
              {asset.mimeType.split("/")[1]}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 p-2.5">
          <span className="truncate text-[12px] font-medium text-ink" title={asset.filename}>
            {asset.filename}
          </span>
          <span className="font-mono text-[10px] tnum text-muted">
            {asset.width ? `${asset.width}×${asset.height} · ` : ""}
            {formatBytes(asset.size)}
          </span>
          {/* Missing alt text is called out on the tile, not buried in the
              detail panel — it is the one metadata gap that reaches a visitor. */}
          {isImage && !asset.alt && !asset.altDecorative ? (
            <span className="text-[10px] font-medium text-brand-bronze">Alt-Text fehlt</span>
          ) : null}
        </div>
      </button>

      {selectable ? (
        <label className="absolute left-2 top-2 cursor-pointer opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [&:has(:checked)]:opacity-100">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`${asset.filename} auswählen`}
            className="h-4 w-4 cursor-pointer rounded border-line-strong bg-surface text-accent focus:ring-2 focus:ring-accent"
          />
        </label>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function UploadButton({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        + Hochladen
      </Button>
      <UploadDialog open={open} onClose={() => setOpen(false)} onDone={onDone} />
    </>
  );
}

export function UploadDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (asset: MediaRow) => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [decorative, setDecorative] = useState(false);
  const [caption, setCaption] = useState("");
  const [copyright, setCopyright] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useMutation(api.upload);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setAlt("");
      setDecorative(false);
      setCaption("");
      setCopyright("");
    }
  }, [open]);

  const isImage = file?.type.startsWith("image/") ?? false;
  const needsAlt = isImage && !decorative && !alt.trim();

  async function submit() {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("alt", decorative ? "" : alt);
    form.append("altDecorative", String(decorative));
    if (caption) form.append("caption", caption);
    if (copyright) form.append("copyright", copyright);

    const result = await upload.run(form);
    if (!result) return;
    if (result.deduplicated) {
      toast.push({
        kind: "info",
        title: "Datei war bereits vorhanden",
        description: `Es wurde die bestehende Datei „${result.filename}“ verwendet, statt eine Kopie anzulegen.`,
      });
    } else {
      toast.success("Hochgeladen", result.filename);
    }
    onDone(result);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Datei hochladen"
      description="JPEG, PNG, WebP, AVIF, GIF, SVG oder PDF, bis 25 MB."
      busy={upload.busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={upload.busy}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={submit} busy={upload.busy} disabled={!file || needsAlt}>
            Hochladen
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/svg+xml,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="sr-only"
          id="upload-input"
        />
        <label
          htmlFor="upload-input"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            setFile(e.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed px-6 py-8 text-center transition-colors",
            dragging
              ? "border-accent bg-accent/[0.04]"
              : "border-line-strong bg-surface hover:border-accent/40 hover:bg-surface-2",
          )}
        >
          {file ? (
            <>
              <span className="text-[14px] font-medium text-ink">{file.name}</span>
              <span className="font-mono text-[12px] tnum text-muted">{formatBytes(file.size)}</span>
            </>
          ) : (
            <>
              <span className="text-[14px] font-medium text-ink">
                Datei hierher ziehen oder auswählen
              </span>
              <span className="text-[12px] text-muted">Eine Datei pro Vorgang</span>
            </>
          )}
        </label>

        {isImage ? (
          <>
            <Field
              label="Alt-Text"
              htmlFor="upload-alt"
              hint="Was auf dem Bild zu sehen ist, für alle, die es nicht sehen können."
              error={needsAlt ? "Bitte Alt-Text angeben oder das Bild als dekorativ markieren." : undefined}
            >
              <Input
                id="upload-alt"
                value={alt}
                disabled={decorative}
                invalid={needsAlt}
                onChange={(e) => setAlt(e.target.value)}
              />
            </Field>
            <Checkbox
              label="Dekorativ — trägt keine eigene Information"
              hint="Zum Beispiel ein Stimmungsbild neben einer Stellenanzeige, bei dem der Titel die Aussage trägt. Wird dann ohne Alt-Text ausgegeben."
              checked={decorative}
              onChange={setDecorative}
            />
          </>
        ) : null}

        <Field label="Bildlegende" htmlFor="upload-caption" optional>
          <Input id="upload-caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>

        <Field
          label="Urheber / Lizenz"
          htmlFor="upload-copyright"
          optional
          hint="Bei lizenzfreiem Material die Quelle festhalten — später lässt sich das nicht rekonstruieren."
        >
          <Input
            id="upload-copyright"
            value={copyright}
            onChange={(e) => setCopyright(e.target.value)}
          />
        </Field>

        {upload.error ? (
          <p role="alert" className="text-[13px] font-medium text-brand-bronze">
            {upload.error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function AssetDetailDialog({
  asset,
  onClose,
  onChanged,
  folders,
}: {
  asset: MediaRow | null;
  onClose: () => void;
  onChanged: () => void;
  folders: { id: string; path: string }[];
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<Partial<MediaRow>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const replaceRef = useRef<HTMLInputElement>(null);

  const update = useMutation(api.updateMedia);
  const remove = useMutation(api.deleteMedia);
  const replace = useMutation(api.replaceMedia);

  useEffect(() => {
    if (asset) {
      setForm({
        alt: asset.alt,
        altDecorative: asset.altDecorative,
        caption: asset.caption,
        copyright: asset.copyright,
        folderId: asset.folderId,
        tags: asset.tags,
      });
    }
  }, [asset?.id]);

  if (!asset) return null;
  const isImage = asset.mimeType.startsWith("image/");

  return (
    <>
      <Modal
        open={Boolean(asset)}
        onClose={onClose}
        title={asset.filename}
        description={`${asset.mimeType} · ${formatBytes(asset.size)}${
          asset.width ? ` · ${asset.width}×${asset.height}` : ""
        }`}
        size="lg"
        footer={
          <>
            {can("media.delete") ? (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Löschen
              </Button>
            ) : null}
            <div className="flex-1" />
            <Button variant="ghost" onClick={onClose}>
              Schliessen
            </Button>
            {can("media.update") ? (
              <Button
                variant="primary"
                busy={update.busy}
                onClick={async () => {
                  await update.run(asset.id, form);
                  toast.success("Gespeichert");
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
        <div className="grid gap-6 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-lg bg-surface-2 ring-1 ring-line">
              {isImage ? (
                <img src={asset.url} alt="" className="w-full object-contain" />
              ) : (
                <div className="grid aspect-square place-items-center font-mono text-[12px] uppercase text-muted">
                  {asset.mimeType.split("/")[1]}
                </div>
              )}
            </div>

            <dl className="flex flex-col gap-1.5 text-[12px]">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Version</dt>
                <dd className="font-mono tnum text-ink">{asset.version}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Hochgeladen</dt>
                <dd className="text-ink">{formatDateTime(asset.createdAt)}</dd>
              </div>
            </dl>

            <Field label="Pfad für Inhalte" htmlFor="asset-url" hint="In ein Bildfeld einsetzen.">
              <Input
                id="asset-url"
                readOnly
                value={asset.url}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-[12px]"
              />
            </Field>

            {can("media.replace") ? (
              <>
                <input
                  ref={replaceRef}
                  type="file"
                  accept={asset.mimeType}
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    const form = new FormData();
                    form.append("file", file);
                    const result = await replace.run(asset.id, form);
                    if (result) {
                      toast.success(
                        "Ersetzt",
                        "Alle Verweise zeigen jetzt auf die neue Datei. Die bisherige bleibt als Version erhalten.",
                      );
                      onChanged();
                      onClose();
                    }
                  }}
                />
                <Button
                  size="sm"
                  busy={replace.busy}
                  onClick={() => replaceRef.current?.click()}
                >
                  Datei ersetzen
                </Button>
                {replace.error ? (
                  <p role="alert" className="text-[12px] font-medium text-brand-bronze">
                    {replace.error}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            {isImage ? (
              <>
                <Field
                  label="Alt-Text"
                  htmlFor="detail-alt"
                  hint="Beschreibt den Bildinhalt für Menschen, die das Bild nicht sehen."
                >
                  <Input
                    id="detail-alt"
                    value={form.alt ?? ""}
                    disabled={form.altDecorative}
                    onChange={(e) => setForm({ ...form, alt: e.target.value })}
                  />
                </Field>
                <Checkbox
                  label="Dekorativ"
                  hint="Wird ohne Alt-Text ausgegeben."
                  checked={Boolean(form.altDecorative)}
                  onChange={(v) => setForm({ ...form, altDecorative: v })}
                />
              </>
            ) : null}

            <Field label="Bildlegende" htmlFor="detail-caption" optional>
              <Textarea
                id="detail-caption"
                rows={2}
                value={form.caption ?? ""}
                onChange={(e) => setForm({ ...form, caption: e.target.value })}
              />
            </Field>

            <Field label="Urheber / Lizenz" htmlFor="detail-copyright" optional>
              <Input
                id="detail-copyright"
                value={form.copyright ?? ""}
                onChange={(e) => setForm({ ...form, copyright: e.target.value })}
              />
            </Field>

            <Field label="Ordner" htmlFor="detail-folder" optional>
              <Select
                id="detail-folder"
                value={form.folderId ?? ""}
                onChange={(e) => setForm({ ...form, folderId: e.target.value || null })}
                placeholder="— kein Ordner —"
                options={folders.map((f) => ({ value: f.id, label: f.path }))}
              />
            </Field>

            <Field
              label="Schlagwörter"
              htmlFor="detail-tags"
              optional
              hint="Kommagetrennt. Erleichtert das Wiederfinden."
            >
              <Input
                id="detail-tags"
                value={(form.tags ?? []).join(", ")}
                onChange={(e) =>
                  setForm({
                    ...form,
                    tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
                  })
                }
              />
            </Field>

            {asset.srcset ? (
              <div className="flex flex-col gap-1.5">
                <span className="field-label">Erzeugte Grössen</span>
                <p className="font-mono text-[11px] leading-relaxed text-muted">{asset.srcset}</p>
              </div>
            ) : null}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        busy={remove.busy}
        destructive
        title="Datei löschen?"
        confirmLabel="Löschen"
        message={`„${asset.filename}“ wird aus der Bibliothek entfernt. Inhalte, die noch darauf verweisen, zeigen danach ein fehlendes Bild.`}
        onConfirm={async () => {
          await remove.run(asset.id);
          toast.success("Gelöscht", asset.filename);
          setConfirmDelete(false);
          onChanged();
          onClose();
        }}
      />
    </>
  );
}

/* ================================================================== */
/* Picker                                                              */
/* ================================================================== */

/**
 * Picks an image for a content field.
 *
 * Reuses the same list query as the library, so search and folders behave
 * identically — an editor who has learned the library does not have to learn a
 * second, simpler browser.
 */
export function MediaPickerDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (url: string) => void;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const list = useAsync(
    () => (open ? api.media({ search: debounced || undefined, mimeType: "image/", perPage: 60 }) : Promise.resolve(null)),
    [open, debounced],
  );

  return (
    <Modal open={open} onClose={onClose} title="Bild wählen" size="xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            label="Bilder durchsuchen"
            className="w-full sm:w-80"
          />
          <UploadButtonInline
            onDone={(asset) => {
              onPick(asset.url);
              onClose();
            }}
          />
        </div>

        {list.loading ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-md" />
            ))}
          </div>
        ) : list.data?.items.length ? (
          <ul className="scroll-thin grid max-h-[55vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-5 lg:grid-cols-6">
            {list.data.items.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(asset.url);
                    onClose();
                  }}
                  className="group block w-full overflow-hidden rounded-md bg-surface ring-1 ring-line transition-shadow hover:shadow-card"
                >
                  <img
                    src={asset.url}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                  <span className="block truncate px-2 py-1.5 text-left text-[11px] text-muted">
                    {asset.filename}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title={debounced ? "Nichts gefunden." : "Noch keine Bilder"}
            description="Laden Sie ein Bild hoch, um es hier auswählen zu können."
          />
        )}
      </div>
    </Modal>
  );
}

function UploadButtonInline({ onDone }: { onDone: (asset: MediaRow) => void }) {
  const [open, setOpen] = useState(false);
  const { can } = useAuth();
  if (!can("media.upload")) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        + Hochladen
      </Button>
      <UploadDialog open={open} onClose={() => setOpen(false)} onDone={onDone} />
    </>
  );
}
