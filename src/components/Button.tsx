import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * `inverse` / `inverseOutline` are for use on the navy panels. Use them instead
 * of passing `bg-*`/`text-*` via className: those collide with the variant's own
 * colour utilities, and Tailwind breaks the tie by stylesheet order rather than
 * class order, so the override may silently lose.
 */
type Variant = "primary" | "secondary" | "ghost" | "inverse" | "inverseOutline" | "mark";
type Size = "sm" | "md" | "lg";

interface CommonProps {
  variant?: Variant;
  size?: Size;
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
}

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & { href?: undefined };

type ButtonAsLink = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps> & { href: string };

type ButtonProps = ButtonAsButton | ButtonAsLink;

const variants: Record<Variant, string> = {
  primary: "bg-brand-navy text-surface hover:bg-brand-navy/90 hover:shadow-glow active:translate-y-px",
  secondary:
    "bg-surface text-ink ring-1 ring-line hover:ring-brand-navy/40 hover:bg-surface-2 active:translate-y-px",
  ghost: "bg-transparent text-ink ring-1 ring-transparent hover:bg-surface-2 hover:ring-line",
  inverse: "bg-surface text-brand-navy hover:bg-brand-sand active:translate-y-px",
  inverseOutline:
    "bg-transparent text-surface ring-1 ring-surface/30 hover:bg-surface/10 hover:ring-surface/50",
  /**
   * `primary` carrying the logo's own construction: the navy ground with the
   * tapering bar raster of the mark set in gold before the label (`.btn-mark`
   * in globals.css draws it as a flex item, so it inherits the button's gap).
   *
   * For the one action on a page that *is* the brand asking — applying to work
   * here. Don't spend it on ordinary CTAs; it stops meaning anything if every
   * navy button wears the mark. Pair it with no trailing arrow: bars leading
   * and an arrow trailing is one accessory too many.
   */
  mark: "btn-mark bg-brand-navy text-surface hover:bg-brand-navy/90 hover:shadow-glow active:translate-y-px",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-[15px]",
  lg: "h-[3.25rem] px-6 text-base sm:h-14 sm:px-7",
};

/**
 * Renders an <a> when given `href`, otherwise a <button>. Most calls-to-action
 * on this page navigate (anchors, tel:, mailto:), and those must be links so
 * they can be opened in a new tab and read correctly by assistive tech.
 */
export const Button = forwardRef<HTMLButtonElement & HTMLAnchorElement, ButtonProps>(
  ({ variant = "primary", size = "md", trailing, className, children, ...rest }, ref) => {
    const classes = cn(
      "group inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap",
      "transition-[background,box-shadow,transform,color,ring] duration-200",
      "disabled:opacity-40 disabled:pointer-events-none",
      variants[variant],
      sizes[size],
      className,
    );

    const inner = (
      <>
        <span>{children}</span>
        {trailing && (
          <span
            aria-hidden
            className="-mr-0.5 transition-transform duration-200 group-hover:translate-x-0.5"
          >
            {trailing}
          </span>
        )}
      </>
    );

    if (typeof rest.href === "string") {
      const anchorProps = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
      return (
        <a ref={ref} className={classes} {...anchorProps}>
          {inner}
        </a>
      );
    }

    const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>;
    return (
      <button ref={ref} type={buttonProps.type ?? "button"} className={classes} {...buttonProps}>
        {inner}
      </button>
    );
  },
);
Button.displayName = "Button";
