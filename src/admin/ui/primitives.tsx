import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/**
 * The dashboard's global component library.
 *
 * Every screen is built from these and adds no chrome of its own — that is the
 * "no duplicated code" requirement made concrete. Two rules keep it honest:
 *
 * 1. **No domain knowledge.** Nothing here imports the API client or knows
 *    what a "content entry" is. A component that needed to would belong in
 *    `../components`, not here.
 * 2. **The site's tokens, not new ones.** Colours, type and spacing come from
 *    the shared Tailwind theme, so the dashboard reads as IEM's own tool
 *    rather than as a bolted-on admin panel.
 */

/* ================================================================== */
/* Button                                                              */
/* ================================================================== */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-navy text-inverse hover:bg-brand-navy/90 active:translate-y-px",
  secondary:
    "bg-surface text-ink ring-1 ring-line hover:bg-surface-2 hover:ring-line-strong active:translate-y-px",
  ghost: "bg-transparent text-muted hover:bg-surface-2 hover:text-ink",
  // Destructive actions use bronze, not a red from outside the palette. It is
  // the darkest warm tone in the brand family and reads as "careful" against
  // the navy without introducing a colour the identity does not own.
  danger: "bg-brand-bronze text-inverse hover:bg-brand-bronze/90 active:translate-y-px",
  subtle: "bg-surface-2 text-ink hover:bg-line active:translate-y-px",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-[14px] gap-2",
  lg: "h-11 px-5 text-[15px] gap-2",
};

type ButtonBase = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Shows a spinner and disables the control. */
  busy?: boolean;
  className?: string;
  children?: ReactNode;
};

type ButtonAsButton = ButtonBase &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonBase> & { href?: undefined };
type ButtonAsLink = ButtonBase &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonBase> & { href: string };

/**
 * Renders an `<a>` when given `href`, otherwise a `<button>` — the same
 * contract as the site's own `Button`. Downloads and external links must be
 * anchors so middle-click and "open in new tab" work.
 */
export const Button = forwardRef<HTMLButtonElement & HTMLAnchorElement, ButtonAsButton | ButtonAsLink>(
  function Button(
    { variant = "secondary", size = "md", leading, trailing, busy, className, children, ...rest },
    ref,
  ) {
    const classes = cn(
      "inline-flex select-none items-center justify-center rounded-md font-medium transition-colors",
      "disabled:pointer-events-none disabled:opacity-50",
      BUTTON_VARIANTS[variant],
      BUTTON_SIZES[size],
      className,
    );
    const content = (
      <>
        {busy ? <Spinner className="h-3.5 w-3.5" /> : leading}
        {children}
        {trailing}
      </>
    );

    if ("href" in rest && rest.href !== undefined) {
      return (
        <a ref={ref} className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
          {content}
        </a>
      );
    }
    const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>;
    return (
      <button
        ref={ref}
        type={buttonProps.type ?? "button"}
        className={classes}
        {...buttonProps}
        disabled={buttonProps.disabled || busy}
      >
        {content}
      </button>
    );
  },
);

/* ================================================================== */
/* Feedback                                                            */
/* ================================================================== */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className ?? "h-4 w-4")}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * A loading placeholder shaped like the content it replaces.
 *
 * A skeleton rather than a spinner wherever the shape is known: it keeps the
 * layout from jumping when the data lands, which is the actual cost of a
 * spinner on a table.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-surface-2", className)} aria-hidden />;
}

export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 bg-surface px-4 py-3.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-1/3" : "flex-1")} />
          ))}
        </div>
      ))}
      <span className="sr-only">Wird geladen …</span>
    </div>
  );
}

/**
 * The empty state.
 *
 * Always says what would be here and offers the action that creates it — an
 * empty box with "Keine Daten" tells a reader nothing they did not already
 * know from looking at it.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-surface px-6 py-14 text-center ring-1 ring-line">
      {icon ? <div className="text-line-strong">{icon}</div> : null}
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {description ? (
        <p className="max-w-md text-[14px] leading-relaxed text-muted">{description}</p>
      ) : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

/**
 * The error state.
 *
 * Shows the server's own message: those are written to be read by the person
 * who hit them ("Fehlende Berechtigung: content.publish"), and replacing them
 * with "Etwas ist schiefgelaufen" throws away the only useful part.
 */
export function ErrorState({
  title = "Das hat nicht geklappt.",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg bg-surface p-6 ring-1 ring-brand-bronze/40"
    >
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {message ? <p className="text-[14px] leading-relaxed text-muted">{message}</p> : null}
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Nochmals versuchen
        </Button>
      ) : null}
    </div>
  );
}

/* ================================================================== */
/* Surfaces                                                            */
/* ================================================================== */

export function Card({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel overflow-hidden", className)}>
      {title || action ? (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="flex min-w-0 flex-col gap-1">
            {title ? (
              <h2 className="font-display text-[15px] font-semibold leading-tight text-ink">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="text-[13px] leading-snug text-muted">{description}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow ? <p className="eyebrow text-muted">{eyebrow}</p> : null}
        <h1 className="font-display text-[26px] font-semibold leading-tight text-ink">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-[14px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/* ================================================================== */
/* Badges and status                                                   */
/* ================================================================== */

export type BadgeTone =
  | "neutral"
  | "navy"
  | "gold"
  | "bronze"
  | "energy"
  | "water"
  | "air";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted ring-line",
  navy: "bg-accent/[0.08] text-accent ring-accent/20",
  gold: "bg-disc-power/[0.10] text-disc-power ring-disc-power/25",
  bronze: "bg-brand-bronze/[0.10] text-brand-bronze ring-brand-bronze/25",
  energy: "bg-disc-energy/[0.10] text-disc-energy ring-disc-energy/25",
  water: "bg-disc-water/[0.10] text-disc-water ring-disc-water/25",
  air: "bg-disc-air/[0.10] text-disc-air ring-disc-air/25",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ================================================================== */
/* Form fields                                                         */
/* ================================================================== */

/**
 * The wrapper every input sits in.
 *
 * It owns the label/hint/error relationship — `htmlFor`, `aria-describedby`,
 * `aria-invalid` — so no screen has to remember to wire them up, and none of
 * them can get it subtly wrong. `optional` is shown rather than `required`:
 * most fields in this dashboard are required, so marking the exceptions is
 * both quieter and more informative.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="field-label">
        {label}
        {optional ? (
          <span className="normal-case tracking-normal text-muted/70">(optional)</span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-[12px] font-medium text-brand-bronze">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-[12px] leading-snug text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn("field-input", invalid && "field-input-error", className)}
      {...rest}
    />
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn("field-input resize-y leading-relaxed", invalid && "field-input-error", className)}
      {...rest}
    />
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
  options: { value: string; label: string }[];
  placeholder?: string;
};

/**
 * A native `<select>`, styled.
 *
 * Native on purpose — it brings keyboard handling, the mobile picker and
 * screen-reader semantics for free, which a custom listbox has to rebuild and
 * usually rebuilds incompletely. Only the chevron is ours.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, options, placeholder, className, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "field-input cursor-pointer appearance-none pr-9",
          invalid && "field-input-error",
          className,
        )}
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6 L8 10 L12 6" />
      </svg>
    </div>
  );
});

export function Checkbox({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong text-accent
                   focus:ring-2 focus:ring-accent focus:ring-offset-0 disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className="flex cursor-pointer flex-col gap-0.5">
        <span className="text-[14px] leading-tight text-ink">{label}</span>
        {hint ? <span className="text-[12px] leading-snug text-muted">{hint}</span> : null}
      </label>
    </div>
  );
}

/** A labelled on/off control for a boolean setting. */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] leading-tight text-ink">{label}</span>
        {hint ? <span className="text-[12px] leading-snug text-muted">{hint}</span> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-brand-navy" : "bg-line-strong",
        )}
      >
        {/*
          `left-0.5` is load-bearing, not decoration.

          Without a horizontal anchor both `left` and `right` are `auto`, so the
          knob is placed at its *static position* — where it would have sat in
          normal flow. A `<button>` carries `text-align: center` from the user
          agent and Tailwind's preflight does not reset it, so that position is
          the middle of the track: the knob started centred and the transform
          shifted it from there, which is why neither state looked right.

          Anchored at 2px the geometry closes: the track is 36×20 and the knob
          16, so off leaves 2px at the left, and `translate-x-4` (16px) puts it
          at 18px — 2px from the right. Symmetric, and both numbers stay on the
          spacing scale.
        */}
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}

/** A search box with a clear button. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Suchen",
  label,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5 L14 14" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="field-input pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Suche zurücksetzen"
          className="absolute right-2.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
            <path d="M4 4 L12 12 M12 4 L4 12" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/* ================================================================== */
/* Tabs, pagination, breadcrumb                                        */
/* ================================================================== */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: { value: T; label: string; count?: number }[];
  active: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map((tab) => {
        const isActive = tab.value === active;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-[14px] font-medium transition-colors",
              isActive
                ? "border-accent text-ink"
                : "border-transparent text-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className={cn("font-mono text-[11px] tnum", isActive ? "text-brand-blue" : "text-muted/70")}>
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Pagination({
  page,
  pages,
  total,
  perPage,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  onChange: (next: number) => void;
}) {
  if (pages <= 1) {
    return (
      <p className="eyebrow text-muted" aria-live="polite">
        {total} {total === 1 ? "Eintrag" : "Einträge"}
      </p>
    );
  }
  const first = (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="eyebrow text-muted" aria-live="polite">
        {first}–{last} von {total}
      </p>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Zurück
        </Button>
        <span className="px-2 font-mono text-[12px] tnum text-muted">
          {page} / {pages}
        </span>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Weiter
        </Button>
      </div>
    </div>
  );
}

export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Brotkrumen">
      <ol className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-1.5">
            {i > 0 ? (
              <span aria-hidden className="text-line-strong">
                /
              </span>
            ) : null}
            {item.to ? (
              <a href={`#${item.to}`} className="transition-colors hover:text-ink">
                {item.label}
              </a>
            ) : (
              <span className="text-ink">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* ================================================================== */
/* Modal                                                               */
/* ================================================================== */

/**
 * A native `<dialog>` opened with `showModal()`.
 *
 * Same choice as the public site's `ProjectDialog`, for the same reasons: the
 * platform gives the focus trap, the inert background, Esc-to-close and the
 * top layer, and this project has no dialog library. Two things it needs and
 * would silently lose: `onClose` must clear the parent's state (Esc closes the
 * element without React hearing about it), and the element needs a capped
 * height with its own scroll, because a dialog does not scroll on its own.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  busy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Blocks backdrop and Esc dismissal while something is in flight. */
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const widths = {
    sm: "w-[min(26rem,calc(100vw-2rem))]",
    md: "w-[min(36rem,calc(100vw-2rem))]",
    lg: "w-[min(52rem,calc(100vw-2rem))]",
    xl: "w-[min(72rem,calc(100vw-2rem))]",
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClick={(e) => {
        // A click landing on the dialog element itself is a backdrop click —
        // the content sits in child elements.
        if (e.target === ref.current && !busy) onClose();
      }}
      className={cn(
        "max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-lg bg-surface p-0 text-ink",
        "shadow-card ring-1 ring-line backdrop:bg-ink/40 backdrop:backdrop-blur-sm",
        widths[size],
      )}
    >
      <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="font-display text-[17px] font-semibold text-ink">
            {title}
          </h2>
          {description ? (
            <p className="text-[13px] leading-snug text-muted">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Schliessen"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="px-6 py-5">{children}</div>

      {footer ? (
        <footer className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2/50 px-6 py-4">
          {footer}
        </footer>
      ) : null}
    </dialog>
  );
}

/**
 * Confirmation before something irreversible.
 *
 * `destructive` swaps the button to the bronze variant and, for the genuinely
 * unrecoverable cases, `confirmText` requires the operator to type a matching
 * word. That is reserved for deleting a user or a dossier — asking someone to
 * type "LÖSCHEN" for an ordinary delete trains them to type it without reading.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Bestätigen",
  destructive,
  confirmText,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  confirmText?: string;
  busy?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const id = useId();
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const blocked = Boolean(confirmText) && typed.trim() !== confirmText;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={blocked}
            busy={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[14px] leading-relaxed text-muted">
        <div>{message}</div>
        {confirmText ? (
          <Field
            label={`Zur Bestätigung „${confirmText}“ eingeben`}
            htmlFor={id}
          >
            <Input
              id={id}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
