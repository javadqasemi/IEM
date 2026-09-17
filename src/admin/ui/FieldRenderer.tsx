import { useId, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import type { FieldDef } from "../lib/api";
import { Badge, Button, Checkbox, Field, Input, Select, Textarea } from "./primitives";

/**
 * Renders any content type's form from its field definitions.
 *
 * This is the component that makes the CMS general. The server describes a
 * content type as a list of `FieldDef`s; this walks that list and produces the
 * editor. So adding a field to the site means adding it to
 * `content-types.ts` — there is no matching form component to write, and no
 * way for the two to disagree, which is the failure mode a hand-written
 * editor per type guarantees eventually.
 *
 * The cost is that the form cannot be *bespoke*. That has been accepted for
 * every type here, with one concession: `tokens: true` fields show the
 * available placeholders, because a writer who does not know `{jahrzehnte}`
 * exists will type "30" and the number will go stale in four years.
 */

export type FieldErrors = Record<string, string[]>;

export function FieldRenderer({
  fields,
  value,
  onChange,
  errors,
  path = "",
  tokenHelp,
  imagePicker,
  disabled,
}: {
  fields: FieldDef[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  errors?: FieldErrors;
  /** Dotted prefix, so nested errors match the server's `detail.kontakt.name`. */
  path?: string;
  tokenHelp?: { token: string; meaning: string }[];
  /** Opens the media library. Absent means image fields fall back to a path box. */
  imagePicker?: (onPick: (url: string) => void) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {fields.map((field) => (
        <OneField
          key={field.name}
          field={field}
          value={value?.[field.name]}
          onChange={(next) => onChange({ ...value, [field.name]: next })}
          errors={errors}
          path={path ? `${path}.${field.name}` : field.name}
          tokenHelp={tokenHelp}
          imagePicker={imagePicker}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function OneField({
  field,
  value,
  onChange,
  errors,
  path,
  tokenHelp,
  imagePicker,
  disabled,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (next: unknown) => void;
  errors?: FieldErrors;
  path: string;
  tokenHelp?: { token: string; meaning: string }[];
  imagePicker?: (onPick: (url: string) => void) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const error = errors?.[path]?.[0];
  const help = field.tokens && tokenHelp?.length ? undefined : field.help;

  const common = {
    id,
    disabled,
    invalid: Boolean(error),
    "aria-describedby": error ? `${id}-error` : field.help ? `${id}-hint` : undefined,
  };

  /* ---- Composite types render their own label ---- */

  if (field.type === "object") {
    return (
      <fieldset className="rounded-lg bg-surface-2/40 p-4 ring-1 ring-line">
        <legend className="field-label px-1">{field.label}</legend>
        {field.help ? (
          <p className="mb-3 px-1 text-[12px] leading-snug text-muted">{field.help}</p>
        ) : null}
        <FieldRenderer
          fields={field.fields ?? []}
          value={(value as Record<string, unknown>) ?? {}}
          onChange={onChange as (next: Record<string, unknown>) => void}
          errors={errors}
          path={path}
          tokenHelp={tokenHelp}
          imagePicker={imagePicker}
          disabled={disabled}
        />
      </fieldset>
    );
  }

  if (field.type === "objectList") {
    const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="field-label">{field.label}</legend>
        {field.help ? <p className="text-[12px] leading-snug text-muted">{field.help}</p> : null}

        {rows.map((row, i) => (
          <div key={i} className="relative rounded-lg bg-surface-2/40 p-4 pt-9 ring-1 ring-line">
            <div className="absolute inset-x-3 top-2.5 flex items-center justify-between">
              <span className="font-mono text-[11px] tnum text-muted">{i + 1}</span>
              <RowControls
                index={i}
                count={rows.length}
                disabled={disabled}
                onMove={(to) => onChange(move(rows, i, to))}
                onRemove={() => onChange(rows.filter((_, j) => j !== i))}
              />
            </div>
            <FieldRenderer
              fields={field.fields ?? []}
              value={row}
              onChange={(next) => onChange(rows.map((r, j) => (j === i ? next : r)))}
              errors={errors}
              path={`${path}[${i}]`}
              tokenHelp={tokenHelp}
              imagePicker={imagePicker}
              disabled={disabled}
            />
          </div>
        ))}

        <div>
          <Button size="sm" disabled={disabled} onClick={() => onChange([...rows, {}])}>
            + {field.label} hinzufügen
          </Button>
        </div>
      </fieldset>
    );
  }

  if (field.type === "list") {
    const items = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="field-label">{field.label}</legend>
        {field.help ? <p className="text-[12px] leading-snug text-muted">{field.help}</p> : null}

        <ul className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <Textarea
                rows={1}
                value={item}
                disabled={disabled}
                onChange={(e) => onChange(items.map((v, j) => (j === i ? e.target.value : v)))}
                className="min-h-[2.5rem]"
              />
              <RowControls
                index={i}
                count={items.length}
                disabled={disabled}
                onMove={(to) => onChange(move(items, i, to))}
                onRemove={() => onChange(items.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className="text-[12px] font-medium text-brand-bronze">
            {error}
          </p>
        ) : null}

        <div>
          <Button size="sm" disabled={disabled} onClick={() => onChange([...items, ""])}>
            + Zeile
          </Button>
        </div>
      </fieldset>
    );
  }

  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="field-label">{field.label}</legend>
        {field.help ? <p className="text-[12px] leading-snug text-muted">{field.help}</p> : null}
        <div className="flex flex-wrap gap-2 pt-0.5">
          {(field.options ?? []).map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() =>
                  onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])
                }
                className={cn(
                  "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50",
                  on
                    ? "bg-brand-navy text-inverse"
                    : "bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-line-strong",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        {error ? (
          <p role="alert" className="text-[12px] font-medium text-brand-bronze">
            {error}
          </p>
        ) : null}
      </fieldset>
    );
  }

  if (field.type === "boolean") {
    return (
      <div className="flex flex-col gap-1.5">
        <Checkbox
          label={field.label}
          hint={field.help}
          checked={Boolean(value)}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    );
  }

  /* ---- Simple types ---- */

  return (
    <Field
      label={field.label}
      htmlFor={id}
      hint={help}
      error={error}
      optional={!field.required}
    >
      {renderInput()}
      {field.tokens && tokenHelp?.length ? (
        <TokenHint tokens={tokenHelp} onInsert={(t) => onChange(`${String(value ?? "")}${t}`)} />
      ) : null}
    </Field>
  );

  function renderInput(): ReactNode {
    switch (field.type) {
      case "textarea":
      case "richtext":
        return (
          <Textarea
            {...common}
            rows={field.type === "richtext" ? 8 : 3}
            maxLength={field.maxLength}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case "select":
        return (
          <Select
            {...common}
            options={field.options ?? []}
            placeholder={field.required ? undefined : "— keine —"}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        );

      case "number":
        return (
          <Input
            {...common}
            type="number"
            min={field.min}
            max={field.max}
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
        );

      case "image":
        return (
          <ImageField
            id={id}
            value={typeof value === "string" ? value : ""}
            disabled={disabled}
            invalid={Boolean(error)}
            onChange={onChange}
            onBrowse={imagePicker ? () => imagePicker((url) => onChange(url)) : undefined}
          />
        );

      case "color":
        return (
          <div className="flex items-center gap-2">
            <input
              type="color"
              disabled={disabled}
              value={/^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value) : "#003882"}
              onChange={(e) => onChange(e.target.value)}
              aria-label={`${field.label} — Farbwähler`}
              className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-line bg-surface p-1"
            />
            <Input
              {...common}
              value={String(value ?? "")}
              onChange={(e) => onChange(e.target.value)}
              placeholder="#003882"
              spellCheck={false}
              className="font-mono"
            />
          </div>
        );

      default: {
        const inputType =
          field.type === "email" ? "email" : field.type === "tel" ? "tel" : field.type === "date" ? "date" : "text";
        return (
          <Input
            {...common}
            type={inputType}
            maxLength={field.maxLength}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ */

function ImageField({
  id,
  value,
  onChange,
  onBrowse,
  disabled,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  onBrowse?: () => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      {/*
        The preview at 336×252, which is 20× the area of the 64×64 thumbnail
        this replaced. A thumbnail that size answers "is there an image" and
        nothing else; at this size an editor can actually see whether they
        picked the right photo, which is the only question the field exists to
        answer. It is the first thing in the row, with the path and the library
        button beside it, so the image leads and the plumbing follows.

        Full width on a phone and stacked, because 336px beside a text input
        does not fit a narrow column — the same reflow `PageHeader` uses.
      */}
      <div className="grid aspect-[4/3] w-full shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-2 ring-1 ring-line sm:w-[21rem]">
        {value && !broken ? (
          <img
            src={value}
            alt=""
            // `object-contain`, not `cover`. Cropping is right for a thumbnail
            // and wrong for a preview: half these fields hold portraits
            // (`team.photo`) and the rest landscapes, and a preview that cuts
            // the head off a portrait to fill a 4:3 box is worse than one with
            // bars beside it.
            className="h-full w-full object-contain"
            onError={() => setBroken(true)}
            onLoad={() => setBroken(false)}
          />
        ) : (
          // A broken path is shown as broken rather than as a blank box — an
          // editor who mistypes a path should find out here, not from the
          // published page. Now that there is room for words, it says which of
          // the two it is instead of "fehlt" against a dash.
          <span className="px-4 text-center text-[13px] text-muted">
            {value ? "Bild nicht gefunden" : "Kein Bild gewählt"}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Input
          id={id}
          value={value}
          disabled={disabled}
          invalid={invalid}
          spellCheck={false}
          placeholder="/img/…"
          onChange={(e) => {
            setBroken(false);
            onChange(e.target.value);
          }}
          className="font-mono text-[13px]"
        />
        {onBrowse ? (
          <div>
            <Button size="sm" onClick={onBrowse} disabled={disabled}>
              Aus Medienbibliothek wählen
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The placeholder list for a field whose copy carries derived figures.
 *
 * Collapsed by default so it does not shout on every text field, and each
 * token inserts on click — typing `{jahrzehnte}` correctly from memory is a
 * thing nobody should have to do.
 */
function TokenHint({
  tokens,
  onInsert,
}: {
  tokens: { token: string; meaning: string }[];
  onInsert: (token: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 pt-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="self-start text-[12px] text-brand-blue transition-colors hover:text-brand-bronze"
      >
        {open ? "Platzhalter ausblenden" : "Platzhalter für berechnete Werte …"}
      </button>
      {open ? (
        <>
          <p className="text-[12px] leading-snug text-muted">
            Diese Platzhalter werden beim Anzeigen durch den berechneten Wert ersetzt — so bleibt
            eine Zahl aktuell, statt zu veralten.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {tokens.map((t) => (
              <li key={t.token}>
                <button type="button" onClick={() => onInsert(t.token)} title={t.meaning}>
                  <Badge tone="navy" className="cursor-pointer font-mono hover:ring-accent/40">
                    {t.token}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function RowControls({
  index,
  count,
  onMove,
  onRemove,
  disabled,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const btn =
    "grid h-6 w-6 place-items-center rounded text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30";
  return (
    <div className="flex items-center gap-0.5">
      {/* Buttons rather than drag-and-drop: they are keyboard-reachable, they
          work on a touch screen, and these lists are short. */}
      <button
        type="button"
        className={btn}
        disabled={disabled || index === 0}
        onClick={() => onMove(index - 1)}
        aria-label="Nach oben"
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 10 L8 6 L12 10" />
        </svg>
      </button>
      <button
        type="button"
        className={btn}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(index + 1)}
        aria-label="Nach unten"
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 6 L8 10 L12 6" />
        </svg>
      </button>
      <button
        type="button"
        className={cn(btn, "hover:text-brand-bronze")}
        disabled={disabled}
        onClick={onRemove}
        aria-label="Zeile entfernen"
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
          <path d="M4 4 L12 12 M12 4 L4 12" />
        </svg>
      </button>
    </div>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
