import {
  forwardRef,
  useId,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/shared/utils/cn";

/**
 * What each variant **means** — the P1C action hierarchy. The same treatment
 * means the same thing on every screen; a feature does not pick a variant for
 * its colour.
 *
 * | Variant | Meaning | Use | Never |
 * | --- | --- | --- | --- |
 * | `primary` | The one safe action this view or dialog exists for | Speichern, Anlegen, Einreichen, Freigeben, Veröffentlichen | two in one decision context |
 * | `secondary` | A real, safe alternative | Bearbeiten, Exportieren, Neue Revision, Vorschau | for the dialog's main action |
 * | `ghost` | Low emphasis: dismiss, navigate, reveal | Abbrechen, Schliessen, Verlauf, Details | for anything destructive |
 * | `danger` | **Confirms** an irreversible or high-risk act | the confirm button *inside* a confirmation | as a trigger on a page |
 * | `danger-quiet` | **Triggers** a destructive act that will then ask | Löschen, Entfernen, Archivieren, Zurückziehen, Widerrufen | without a confirmation behind it |
 * | `subtle` | The pressed state of a toggle button | the selected filter in a segmented group | as an action |
 *
 * `busy` disables the button and shows a spinner; a duplicate submission is
 * therefore impossible and the button keeps its label. `disabledReason` keeps
 * a blocked button focusable and says why. An icon-only control is an
 * `IconButton`, which cannot be written without a label.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-quiet" | "subtle";
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
  /*
    The destructive *trigger* (P1C, UX-16). Every "Löschen" in the dashboard
    was a `ghost` — the same grey as "Abbrechen" beside it — so the button
    that removes a record and the one that closes a dialog were
    indistinguishable. Bronze text, no fill: it reads as careful without
    shouting, and the filled `danger` stays reserved for the confirmation
    that actually performs the act. Bronze text on the page surface is the
    pairing the field error messages already use, so its contrast is known.
  */
  "danger-quiet": "bg-transparent text-brand-bronze hover:bg-brand-bronze/[0.08]",
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
  /**
   * Why the button cannot be pressed right now, when that is knowable.
   *
   * A `disabled` button with no reason is the dashboard's most common
   * question — "why can I not save?" — and the platform makes it worse: a
   * disabled `<button>` cannot be focused, so a keyboard or screen-reader user
   * never even learns it is there. With a reason, the button is
   * `aria-disabled` instead: it stays in the tab order, a press does nothing,
   * the reason is its accessible description and its tooltip. A dialog puts
   * the same sentence in its footer through `Modal`'s `hint`, because a
   * tooltip is not where an essential explanation should live on its own.
   */
  disabledReason?: string | null;
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
    {
      variant = "secondary",
      size = "md",
      leading,
      trailing,
      busy,
      disabledReason,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const reasonId = useId();
    const classes = cn(
      "inline-flex select-none items-center justify-center rounded-md font-medium transition-colors",
      "disabled:pointer-events-none disabled:opacity-50",
      "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
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
        <a
          ref={ref}
          className={classes}
          data-variant={variant}
          {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {content}
        </a>
      );
    }
    const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>;

    /*
      Blocked with a reason: focusable, announced, inert. `busy` is not a
      reason — something is already happening, and the spinner says so.
    */
    if (buttonProps.disabled && disabledReason && !busy) {
      const { onClick: _ignored, disabled: _disabled, ...inert } = buttonProps;
      return (
        <>
          <button
            ref={ref}
            type={inert.type ?? "button"}
            className={classes}
            data-variant={variant}
            data-disabled-reason={disabledReason}
            {...inert}
            aria-disabled="true"
            aria-describedby={reasonId}
            title={disabledReason}
            onClick={(e) => {
              // A submit button must not submit its form while blocked.
              e.preventDefault();
            }}
          >
            {content}
          </button>
          {/*
            `hidden`, not `sr-only`. An accessible description is computed from
            a referenced element even when it is hidden, so this still reaches
            assistive technology — and it takes no box. The `sr-only` span it
            replaced is `position: absolute`: inside a table cell with no
            positioned ancestor it escaped the table's scroll pane and widened
            the whole page (the job list at 390 px, found by `screens.spec`).
          */}
          <span id={reasonId} hidden>
            {disabledReason}
          </span>
        </>
      );
    }

    return (
      <button
        ref={ref}
        type={buttonProps.type ?? "button"}
        className={classes}
        data-variant={variant}
        {...buttonProps}
        disabled={buttonProps.disabled || busy}
      >
        {content}
      </button>
    );
  },
);

/**
 * An icon-only control (P1C).
 *
 * `label` is required rather than recommended: it becomes the accessible name
 * *and* the tooltip, because an icon alone relies on the reader recognising a
 * glyph, and a pencil or a bin means different things to different people.
 * 32 px square, 44 px on a coarse pointer — the touch-target floor — without
 * changing the layout for a mouse.
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
    label: string;
    icon: ReactNode;
    variant?: Extract<ButtonVariant, "ghost" | "secondary" | "danger-quiet">;
  }
>(function IconButton({ label, icon, variant = "ghost", className, type, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      title={label}
      data-variant={variant}
      className={cn(
        "inline-grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors",
        "[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
        "disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      <span aria-hidden className="grid place-items-center">
        {icon}
      </span>
    </button>
  );
});

/**
 * Lives beside `Button` rather than in `states.tsx`, because `Button` renders
 * it for `busy` and the two would otherwise import each other across families.
 */
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
