import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * A panel from the side, on a native `<dialog>`.
 *
 * Same platform argument as `Modal` — the focus trap, the inert background, Esc
 * and the top layer come free — and the same two things it would otherwise
 * silently lose: `onClose` must clear the parent's state, because Esc closes
 * the element without React hearing about it, and the body needs its own
 * scroll, because a dialog does not scroll on its own.
 *
 * **Why it exists beside `Modal`.** A modal takes the screen; a drawer leaves
 * the list behind it visible, which is the difference between "fill this in"
 * and "look at this one while you work through them". Quick-editing twelve
 * rows through a modal means twelve full-screen interruptions and losing your
 * place each time.
 *
 * On a phone it is a bottom sheet, because a 28rem panel on a 390px screen is
 * a modal wearing a side panel's clothes.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = "right",
  width = "md",
  busy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: "right" | "left";
  width?: "sm" | "md" | "lg";
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

  const widths = { sm: "sm:w-[22rem]", md: "sm:w-[30rem]", lg: "sm:w-[42rem]" };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onClose();
      }}
      className={cn(
        // `max-w-none` and the explicit insets undo the user agent's centring:
        // a dialog is centred by default and a drawer is not, and without this
        // it lands in the middle of the screen at drawer width, which looks
        // like a broken modal rather than a panel.
        "m-0 max-h-none max-w-none bg-surface p-0 text-ink shadow-card",
        "backdrop:bg-ink/40 backdrop:backdrop-blur-sm",
        // Phone: a bottom sheet with a capped height.
        "fixed inset-x-0 bottom-0 top-auto h-[85dvh] w-full rounded-t-xl ring-1 ring-line",
        // Tablet and up: a full-height column against one edge.
        "sm:inset-y-0 sm:bottom-auto sm:top-0 sm:h-dvh sm:rounded-none",
        side === "right" ? "sm:left-auto sm:right-0" : "sm:left-0 sm:right-auto",
        widths[width],
      )}
    >
      {/*
        The flex column is what gives the body its own scroll: the header and
        the footer are `shrink-0`, so a long form scrolls between them instead
        of pushing the actions off the bottom of the screen.
      */}
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
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

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {children}
        </div>

        {footer ? (
          <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line bg-surface-2/50 px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}
