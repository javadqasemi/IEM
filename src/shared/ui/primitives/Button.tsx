import {
  forwardRef,
  useId,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/shared/utils/cn";

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
          <span id={reasonId} className="sr-only">
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
