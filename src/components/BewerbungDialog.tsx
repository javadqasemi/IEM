import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { useContent, type BewerbungCopy } from "@/content/iem";

/**
 * Fills `{name}`-style placeholders in a copy string.
 *
 * Local to this file and separate from `resolveTokens` in the content module:
 * those tokens name figures derived from the site's own data, these name the
 * file or field the message is about. Keeping them apart means an editor
 * cannot accidentally put a headcount in a file-size error.
 */
function fill(text: string, values: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

/**
 * Where an uploaded dossier goes. Unset in this repo — see `src/vite-env.d.ts`.
 * Read once at module scope: it is build-time configuration, not state.
 */
const ENDPOINT = import.meta.env.VITE_BEWERBUNG_ENDPOINT;

/** Two ways in, because they fail differently — see the note on `Mode`. */
type Mode = "upload" | "mail";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  // One decimal so a 9,8 MB file next to a 10 MB limit reads as under it, and
  // `de-CH` for the separator rather than a hand-rolled replace.
  const mb = (bytes / (1024 * 1024)).toLocaleString("de-CH", { maximumFractionDigits: 1 });
  return `${mb} MB`;
}

type Values = {
  position: string;
  vorname: string;
  nachname: string;
  email: string;
  telefon: string;
  verfuegbar: string;
  nachricht: string;
};

/**
 * A blank form. `position` is filled in from the copy when the dialog opens,
 * not here — the default is editable content now, so a module constant would
 * freeze whatever the bundle shipped with.
 */
const EMPTY: Values = {
  position: "",
  vorname: "",
  nachname: "",
  email: "",
  telefon: "",
  verfuegbar: "",
  nachricht: "",
};

type Errors = Partial<Record<keyof Values | "dateien", string>>;

/**
 * Deliberately loose: the only thing worth checking client-side is that the
 * address could plausibly be delivered to. Stricter patterns reject valid
 * addresses (apostrophes, new TLDs) and the real check is the reply arriving.
 */
function looksLikeEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function validate(v: Values, mode: Mode, files: File[], L: BewerbungCopy): Errors {
  const e: Errors = {};
  if (!v.vorname.trim()) e.vorname = L.fehlerVorname;
  if (!v.nachname.trim()) e.nachname = L.fehlerNachname;
  if (!v.email.trim()) e.email = L.fehlerEmail;
  else if (!looksLikeEmail(v.email)) e.email = L.fehlerEmailUngueltig;
  if (mode === "upload" && files.length === 0) {
    e.dateien = L.fehlerDateien;
  }
  return e;
}

/**
 * The application as a `mailto:` the visitor can still read and edit before
 * sending. A mail link cannot carry attachments, which is exactly why the
 * upload option exists next to it rather than instead of it.
 */
function mailtoHref(v: Values, files: File[], L: BewerbungCopy, mail: string) {
  const subject = `${v.position} — ${v.vorname} ${v.nachname}`.trim();
  const body = [
    `${L.mailFeldPosition}: ${v.position}`,
    `${L.mailFeldName}: ${v.vorname} ${v.nachname}`,
    `${L.mailFeldEmail}: ${v.email}`,
    v.telefon.trim() ? `${L.mailFeldTelefon}: ${v.telefon}` : null,
    v.verfuegbar.trim() ? `${L.mailFeldVerfuegbar}: ${v.verfuegbar}` : null,
    "",
    v.nachricht.trim() || L.mailKeineNachricht,
    // Named in the body as well, so the applicant and IEM both notice if an
    // attachment was forgotten in the mail client.
    ...(files.length
      ? ["", `${L.mailFeldBeilagen}: ${files.map((f) => f.name).join(", ")}`]
      : []),
    "",
    L.mailSignatur,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return `mailto:${mail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * XHR rather than `fetch`, for the one thing fetch still cannot do: report
 * upload progress. A 20 MB dossier on a site connection is long enough that a
 * button with no feedback reads as broken.
 */
function postDossier(
  url: string,
  data: FormData,
  onProgress: (pct: number) => void,
  L: BewerbungCopy,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(fill(L.fehlerServer, { status: xhr.status }))),
    );
    xhr.addEventListener("error", () => reject(new Error(L.fehlerVerbindung)));
    xhr.addEventListener("abort", () => reject(new Error(L.fehlerAbbruch)));
    xhr.send(data);
  });
}

const fieldBase =
  "w-full rounded-md bg-surface px-3.5 py-2.5 text-[15px] text-ink ring-1 transition-colors placeholder:text-muted/60 hover:ring-line-strong focus:ring-brand-navy";

function Field({
  id,
  label,
  hint,
  error,
  required,
  optionalLabel,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  optionalLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="eyebrow flex items-baseline gap-1.5 text-muted">
        {label}
        {required ? (
          <span className="text-brand-bronze" aria-hidden>
            ✳
          </span>
        ) : (
          <span className="normal-case tracking-normal text-muted/70">{optionalLabel}</span>
        )}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[13px] font-medium text-brand-bronze">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The application form, with two ways to send.
 *
 * The two are not cosmetic variants of each other. **Upload** carries the
 * dossier but needs a server; **E-Mail** needs nothing but cannot carry an
 * attachment, so the documents are attached in the visitor's own mail client.
 * Whichever is available, the applicant is told exactly where their files are.
 *
 * A native `<dialog>`, as with `ProjectDialog`: `showModal()` carries the focus
 * trap, the inert background, Esc-to-close and the top layer, and this project
 * has no dialog library.
 *
 * The header is a drawing title block — the Schriftfeld device the hero already
 * frames its section drawing with. Field labels use the page's mono `.eyebrow`,
 * which means "measured value" everywhere else on the page. No 01/02/03 step
 * numbering: this is one screen, not a sequence.
 */
export function BewerbungDialog({
  open,
  position,
  onClose,
}: {
  open: boolean;
  /** Preselected role, so applying from a job card lands on that position. */
  position?: string;
  onClose: () => void;
}) {
  const { openings, bewerbung: L, contactEmail } = useContent();
  const ref = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();

  // Upload is the better path when it exists, so it leads — but only when an
  // endpoint is actually configured, or the form would open on a dead option.
  const [mode, setMode] = useState<Mode>(ENDPOINT ? "upload" : "mail");
  const [values, setValues] = useState<Values>(EMPTY);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "mail" | "done" | "failed">("idle");
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      // Seed the position on open rather than in `useState`: the host stays
      // mounted between openings, so an initial value would only ever apply to
      // the first one.
      setValues((v) => ({ ...v, position: position ?? L.spontan }));
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open, position, L.spontan]);

  // Esc closes the element without React hearing about it, so the reset hangs
  // off `onClose` rather than off the open prop.
  function handleClose() {
    onClose();
    setValues(EMPTY);
    setFiles([]);
    setErrors({});
    setStatus("idle");
    setProgress(0);
    setFailure("");
    setMode(ENDPOINT ? "upload" : "mail");
  }

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    // Clear the message the moment the visitor starts fixing the field; a stale
    // error beside corrected input reads as "still wrong".
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }

  /** Rejects oversized or duplicate files with a reason, never silently. */
  function addFiles(incoming: FileList | null) {
    if (!incoming?.length) return;
    const next = [...files];
    let rejected = "";

    for (const f of Array.from(incoming)) {
      if (next.length >= MAX_FILES) {
        rejected = fill(L.fehlerZuViele, { max: MAX_FILES });
        break;
      }
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
      if (f.size > MAX_FILE_BYTES) {
        rejected = fill(L.fehlerZuGross, {
          name: f.name,
          groesse: formatBytes(f.size),
          limit: formatBytes(MAX_FILE_BYTES),
        });
        continue;
      }
      if (next.reduce((s, x) => s + x.size, 0) + f.size > MAX_TOTAL_BYTES) {
        rejected = fill(L.fehlerGesamt, { limit: formatBytes(MAX_TOTAL_BYTES) });
        continue;
      }
      next.push(f);
    }

    setFiles(next);
    setErrors((e) => ({ ...e, dateien: rejected || undefined }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = validate(values, mode, files, L);
    setErrors(found);

    const first = Object.keys(found)[0];
    if (first) {
      formRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${uid}-${first}`)}`)?.focus();
      return;
    }

    if (mode === "mail") {
      window.location.href = mailtoHref(values, files, L, contactEmail);
      setStatus("mail");
      return;
    }

    if (!ENDPOINT) return;
    const data = new FormData();
    for (const [k, v] of Object.entries(values)) data.append(k, v);
    files.forEach((f) => data.append("dateien", f, f.name));

    setStatus("sending");
    setProgress(0);
    try {
      await postDossier(ENDPOINT, data, setProgress, L);
      setStatus("done");
    } catch (err) {
      setFailure(err instanceof Error ? err.message : L.fehlerUnbekannt);
      setStatus("failed");
    }
  }

  const id = (name: string) => `${uid}-${name}`;
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  const busy = status === "sending";

  return (
    <dialog
      ref={ref}
      aria-labelledby={id("title")}
      onClose={handleClose}
      onClick={(e) => {
        if (e.target === ref.current && !busy) handleClose();
      }}
      className="max-h-[calc(100dvh-2rem)] w-[min(46rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-lg bg-surface p-0 text-ink shadow-card ring-1 ring-line backdrop:bg-ink/40 backdrop:backdrop-blur-sm"
    >
      {/* Title block, after the Schriftfeld on a drawing sheet: what this is,
          who it goes to, and where. */}
      <div className="flex items-start justify-between gap-4 bg-brand-navy px-6 py-5 sm:px-8">
        <div className="flex flex-col gap-1">
          <p className="eyebrow text-brand-sand">{L.titelblock}</p>
          <h2 id={id("title")} className="font-display text-2xl font-semibold text-surface">
            {L.titel}
          </h2>
        </div>
        <button
          type="button"
          onClick={handleClose}
          disabled={busy}
          aria-label={L.schliessen}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-surface/70 ring-1 ring-surface/25 transition-colors hover:bg-surface/10 hover:text-surface disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {status === "done" ? (
        <div className="flex animate-fade-up flex-col gap-4 p-6 sm:p-8">
          <p className="font-display text-xl font-semibold text-ink">{L.doneTitel}</p>
          <p className="text-[15px] leading-relaxed text-muted">
            {fill(L.doneText, {
              dateien:
                files.length === 1
                  ? L.doneEineDatei
                  : fill(L.doneMehrereDateien, { n: files.length }),
              groesse: formatBytes(totalBytes),
              email: values.email,
            })}
          </p>
          <div className="pt-2">
            <Button onClick={handleClose}>{L.schliessen}</Button>
          </div>
        </div>
      ) : status === "mail" ? (
        <div className="flex animate-fade-up flex-col gap-4 p-6 sm:p-8">
          {/* Deliberately not "Bewerbung gesendet": nothing has been sent yet,
              and telling an applicant otherwise is the worst thing this form
              could do. */}
          <p className="font-display text-xl font-semibold text-ink">{L.mailTitel}</p>
          <p className="text-[15px] leading-relaxed text-muted">{L.mailText}</p>

          {files.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-4">
              <p className="text-[14px] font-medium text-ink">{L.mailDateienTitel}</p>
              <ul className="flex flex-col gap-1">
                {files.map((f) => (
                  <li key={`${f.name}-${f.size}`} className="flex justify-between gap-3 text-[14px]">
                    <span className="min-w-0 truncate text-ink">{f.name}</span>
                    <span className="shrink-0 font-mono text-[11px] tnum text-muted">
                      {formatBytes(f.size)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[15px] leading-relaxed text-muted">{L.mailKeineDateien}</p>
          )}
          <p className="text-[15px] leading-relaxed text-muted">
            {L.mailFallbackPrefix}{" "}
            <a
              href={`mailto:${contactEmail}`}
              className="font-medium text-brand-blue underline decoration-line-strong underline-offset-4 hover:text-brand-bronze"
            >
              {contactEmail}
            </a>
            {L.mailFallbackSuffix}
          </p>
          <div className="flex flex-col gap-3 pt-2 sm:flex-row">
            <Button onClick={handleClose}>{L.schliessen}</Button>
            <Button variant="secondary" onClick={() => setStatus("idle")}>
              {L.mailNochmals}
            </Button>
          </div>
        </div>
      ) : (
        <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-6 p-6 sm:p-8">
          {/* Same aria-pressed pair the reference and team filters use. */}
          <div className="flex flex-col gap-2">
            <span className="eyebrow text-muted">{L.modusFrage}</span>
            <div role="group" aria-label={L.modusGroupLabel} className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["upload", L.modusUploadLabel, L.modusUploadNote],
                  ["mail", L.modusMailLabel, L.modusMailNote],
                ] as const
              ).map(([value, label, note]) => {
                const isActive = mode === value;
                const disabled = value === "upload" && !ENDPOINT;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled || busy}
                    aria-pressed={isActive}
                    onClick={() => setMode(value)}
                    className={`flex flex-col gap-0.5 rounded-md px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                      isActive
                        ? "bg-brand-navy text-surface"
                        : "bg-surface text-ink ring-1 ring-line hover:ring-line-strong"
                    }`}
                  >
                    <span className="text-[15px] font-medium">{label}</span>
                    <span className={`text-[13px] ${isActive ? "text-brand-sand" : "text-muted"}`}>
                      {disabled ? L.modusNichtEingerichtet : note}
                    </span>
                  </button>
                );
              })}
            </div>
            {!ENDPOINT ? (
              <p className="text-[13px] leading-snug text-muted">{L.modusHinweis}</p>
            ) : null}
          </div>

          <Field
            id={id("position")}
            label={L.feldPosition}
            required
            optionalLabel={L.optional}
          >
            <select
              id={id("position")}
              value={values.position}
              onChange={(e) => set("position", e.target.value)}
              disabled={busy}
              className={`${fieldBase} cursor-pointer ring-line`}
            >
              <option value={L.spontan}>{L.spontan}</option>
              {openings.map((o) => (
                <option key={o.role} value={o.role}>
                  {o.role} · {o.place}
                </option>
              ))}
            </select>
          </Field>

          <div className="tick-rule grid gap-5 pt-6 sm:grid-cols-2">
            <Field
              id={id("vorname")}
              label={L.feldVorname}
              required
              error={errors.vorname}
              optionalLabel={L.optional}
            >
              <input
                id={id("vorname")}
                value={values.vorname}
                onChange={(e) => set("vorname", e.target.value)}
                autoComplete="given-name"
                disabled={busy}
                aria-invalid={!!errors.vorname}
                aria-describedby={errors.vorname ? `${id("vorname")}-error` : undefined}
                className={`${fieldBase} ${errors.vorname ? "ring-brand-bronze" : "ring-line"}`}
              />
            </Field>

            <Field
              id={id("nachname")}
              label={L.feldNachname}
              required
              error={errors.nachname}
              optionalLabel={L.optional}
            >
              <input
                id={id("nachname")}
                value={values.nachname}
                onChange={(e) => set("nachname", e.target.value)}
                autoComplete="family-name"
                disabled={busy}
                aria-invalid={!!errors.nachname}
                aria-describedby={errors.nachname ? `${id("nachname")}-error` : undefined}
                className={`${fieldBase} ${errors.nachname ? "ring-brand-bronze" : "ring-line"}`}
              />
            </Field>

            <Field
              id={id("email")}
              label={L.feldEmail}
              required
              error={errors.email}
              optionalLabel={L.optional}
            >
              <input
                id={id("email")}
                type="email"
                inputMode="email"
                value={values.email}
                onChange={(e) => set("email", e.target.value)}
                autoComplete="email"
                disabled={busy}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? `${id("email")}-error` : undefined}
                className={`${fieldBase} ${errors.email ? "ring-brand-bronze" : "ring-line"}`}
              />
            </Field>

            <Field id={id("telefon")} label={L.feldTelefon} optionalLabel={L.optional}>
              <input
                id={id("telefon")}
                type="tel"
                inputMode="tel"
                value={values.telefon}
                onChange={(e) => set("telefon", e.target.value)}
                autoComplete="tel"
                disabled={busy}
                className={`${fieldBase} ring-line`}
              />
            </Field>

            <Field
              id={id("verfuegbar")}
              label={L.feldVerfuegbar}
              hint={L.feldVerfuegbarHint}
              optionalLabel={L.optional}
            >
              <input
                id={id("verfuegbar")}
                value={values.verfuegbar}
                onChange={(e) => set("verfuegbar", e.target.value)}
                disabled={busy}
                className={`${fieldBase} ring-line`}
              />
            </Field>
          </div>

          {/* Not gated on `mode`. Gating it there was a dead end: without a
              configured endpoint the upload option is disabled, so the picker
              never rendered and there was no way to attach anything at all.
              Files are useful on both paths — they ride along on the upload,
              and on the mail path they are named in the body so neither side
              overlooks a missing attachment. */}
          <div className="flex flex-col gap-2">
            <span className="eyebrow flex items-baseline gap-1.5 text-muted">
              {L.dossier}
              {mode === "upload" ? (
                <span className="text-brand-bronze" aria-hidden>
                  ✳
                </span>
              ) : (
                <span className="normal-case tracking-normal text-muted/70">{L.optional}</span>
              )}
            </span>

            {/* The real input stays focusable and drives the label via `peer`,
                so the drop zone is reachable by keyboard rather than being a
                mouse-only div. */}
            <input
              id={id("dateien")}
              type="file"
              multiple
              accept={ACCEPT}
              disabled={busy}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
              aria-describedby={errors.dateien ? `${id("dateien")}-error` : undefined}
              className="peer sr-only"
            />
            <label
              htmlFor={id("dateien")}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed px-6 py-8 text-center transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-navy ${
                dragging
                  ? "border-brand-navy bg-brand-navy/[0.04]"
                  : errors.dateien
                    ? "border-brand-bronze bg-surface"
                    : "border-line-strong bg-surface hover:border-brand-navy/40 hover:bg-surface-2"
              }`}
            >
              <span className="text-[15px] font-medium text-ink">{L.dossierZiehen}</span>
              <span className="text-[13px] text-muted">
                {fill(L.dossierRegeln, {
                  max: MAX_FILES,
                  proDatei: formatBytes(MAX_FILE_BYTES),
                })}
              </span>
            </label>

            {errors.dateien ? (
              <p id={`${id("dateien")}-error`} className="text-[13px] font-medium text-brand-bronze">
                {errors.dateien}
              </p>
            ) : null}

            {files.length > 0 ? (
              <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-line ring-1 ring-line">
                {files.map((f) => (
                  <li
                    key={`${f.name}-${f.size}`}
                    className="flex items-center justify-between gap-3 bg-surface px-3.5 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{f.name}</span>
                    <span className="shrink-0 font-mono text-[11px] tnum text-muted">
                      {formatBytes(f.size)}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setFiles((list) => list.filter((x) => x !== f))}
                      aria-label={fill(L.dateiEntfernen, { name: f.name })}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
                    >
                      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden>
                        <path
                          d="M4 4l8 8M12 4l-8 8"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {files.length > 0 ? (
              <p className="eyebrow text-muted">
                {fill(L.dateiZaehler, {
                  n: files.length,
                  max: MAX_FILES,
                  bytes: formatBytes(totalBytes),
                  gesamt: formatBytes(MAX_TOTAL_BYTES),
                })}
              </p>
            ) : null}

            {mode === "mail" && files.length > 0 ? (
              // Says plainly that the mail client is what carries them — the
              // files are picked here, but a mailto: cannot attach anything.
              <p className="text-[13px] leading-snug text-muted">{L.mailAnhangHinweis}</p>
            ) : null}
          </div>

          <Field
            id={id("nachricht")}
            label={L.feldNachricht}
            hint={L.feldNachrichtHint}
            optionalLabel={L.optional}
          >
            <textarea
              id={id("nachricht")}
              rows={5}
              maxLength={1200}
              value={values.nachricht}
              onChange={(e) => set("nachricht", e.target.value)}
              disabled={busy}
              className={`${fieldBase} resize-y ring-line`}
            />
          </Field>

          {busy ? (
            <div className="flex flex-col gap-2" aria-live="polite">
              <div className="flex items-baseline justify-between">
                <span className="eyebrow text-muted">{L.wirdUebermittelt}</span>
                <span className="font-mono text-[12px] tnum text-brand-blue">{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-brand-navy transition-[width] duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : null}

          {status === "failed" ? (
            // Says what went wrong and what to do instead, rather than "Fehler".
            <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-4" aria-live="assertive">
              <p className="text-[14px] font-medium text-ink">{L.failedTitel}</p>
              <p className="text-[14px] leading-relaxed text-muted">
                {failure} {L.failedPrefix}{" "}
                <a
                  href={`mailto:${contactEmail}`}
                  className="font-medium text-brand-blue underline decoration-line-strong underline-offset-4 hover:text-brand-bronze"
                >
                  {contactEmail}
                </a>
                {L.failedSuffix}
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="eyebrow text-muted">
              <span className="text-brand-bronze" aria-hidden>
                ✳
              </span>{" "}
              {L.pflichtfeld}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" variant="secondary" disabled={busy} onClick={handleClose}>
                {L.abbrechen}
              </Button>
              <Button type="submit" trailing="→" disabled={busy}>
                {busy ? L.wirdGesendet : L.senden}
              </Button>
            </div>
          </div>
        </form>
      )}
    </dialog>
  );
}
