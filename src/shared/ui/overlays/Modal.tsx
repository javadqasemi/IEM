import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/shared/ui/primitives";
import { Field } from "@/shared/ui/forms/Field";
import { Input } from "@/shared/ui/forms/inputs";

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
