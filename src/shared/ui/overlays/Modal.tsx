import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { cn } from "@/shared/utils/cn";
import { Button, IconButton } from "@/shared/ui/primitives";
import { Field } from "@/shared/ui/forms/Field";
import { SUBMIT_ATTEMPT } from "@/shared/ui/forms/Form";
import { Callout } from "@/shared/ui/feedback/Callout";
import { Input } from "@/shared/ui/forms/inputs";

/** Inputs in which Enter means "done" — the ones a browser submits a form from. */
const SUBMITTING_INPUTS = new Set([
  "text",
  "email",
  "number",
  "password",
  "search",
  "tel",
  "url",
  "date",
  "datetime-local",
  "time",
  "month",
  "week",
]);

/**
 * Enter in a dialog's field presses the dialog's primary action.
 *
 * ---
 *
 * **Why the dialog and not the form.** Every dialog here puts its actions in
 * `footer`, which is outside the `<Form>` in the body — so the browser's
 * implicit submission never found a submit button, and Enter did nothing in
 * twenty-five dialogs (UX-12). Moving the footer into the form would nest a
 * `<form>` inside every dialog that already has one; giving every footer
 * button `form=` would be twenty-five edits that the twenty-sixth dialog
 * forgets. So the dialog answers Enter itself, by *clicking* its primary
 * button — the same element, the same handler, the same `disabled` and
 * `busy` state a mouse would meet. There is no second submit path to drift.
 *
 * **What it deliberately does not do:**
 *
 * - A `danger` action is never pressed by Enter — and a dialog whose last
 *   button is `danger` has no Enter action at all, because the rule never
 *   falls back to an earlier, safer-looking button that is not the one the
 *   reader is looking at. A destructive confirmation —
 *   delete, withdraw, restore, the typed "LÖSCHEN" — is meant to be a
 *   deliberate click, and Enter in the confirmation field is exactly the
 *   reflex that would defeat it.
 * - A `<textarea>` keeps Enter for a new line, a `<select>` for itself, and an
 *   open combobox for choosing an option.
 * - A form that has its own submit button is left to the browser.
 * - A blocked primary (`disabledReason`) is not pressed; focus moves to it,
 *   which is where its reason is announced.
 *
 * Exported for the test, which drives it with a synthetic event.
 */
export function pressPrimaryOnEnter(e: KeyboardEvent<HTMLElement>, footer: HTMLElement | null) {
  if (e.key !== "Enter" || e.defaultPrevented) return;
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
  if ((e.nativeEvent as { isComposing?: boolean } | undefined)?.isComposing) return;

  const target = e.target as HTMLElement | null;
  if (!target || target.tagName !== "INPUT") return;
  const input = target as HTMLInputElement;
  if (!SUBMITTING_INPUTS.has(input.type)) return;
  // An open listbox is choosing an option, not finishing the form.
  if (input.getAttribute("aria-expanded") === "true") return;

  const form = input.form;
  if (form) {
    // Tag and type rather than `instanceof`, so the rule can be exercised
    // outside a browser — `Modal.test.ts` drives it with plain objects.
    const hasOwnSubmit = Array.from(form.elements).some(
      (el) =>
        (el.tagName === "BUTTON" || el.tagName === "INPUT") &&
        (el as HTMLButtonElement | HTMLInputElement).type === "submit",
    );
    if (hasOwnSubmit) return;
  }

  /*
    The primary action is the **last** footer button that is neither `ghost`
    (Abbrechen, Verwerfen) nor `danger` — the convention `FormActions`
    documents, right-aligned and primary last. Not "the one marked
    `primary`": most dialogs here leave their save button on the default
    variant, and a rule that only found the marked ones would work in four
    dialogs and silently not in twenty.
  */
  /*
    `danger-quiet` (P1C) is skipped like `ghost`, not treated like `danger`:
    it is a destructive *trigger* — "Löschen" at the left of a details
    dialog's footer — and must neither be pressed by Enter nor stop Enter
    reaching the save button to its right.
  */
  const candidates = Array.from(
    footer?.querySelectorAll<HTMLButtonElement>("button[data-variant]:not([data-variant='ghost'])") ??
      [],
  ).filter((b) => b.dataset.variant !== "danger-quiet");
  const primary = candidates.length ? candidates[candidates.length - 1] : null;
  if (!primary || primary.dataset.variant === "danger") return;

  e.preventDefault();
  if (primary.disabled) return;
  if (primary.getAttribute("aria-disabled") === "true") {
    primary.focus();
    return;
  }
  primary.click();
}

/**
 * A native `<dialog>` opened with `showModal()`.
 *
 * Same choice as the public site's `ProjectDialog`, for the same reasons: the
 * platform gives the focus trap, the inert background, Esc-to-close and the
 * top layer, and this project has no dialog library. Two things it needs and
 * would silently lose: `onClose` must clear the parent's state (Esc closes the
 * element without React hearing about it), and the element needs a capped
 * height with its own scroll, because a dialog does not scroll on its own.
 *
 * Enter presses the primary footer action — see `pressPrimaryOnEnter`.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  hint,
  size = "md",
  busy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * One line at the start of the footer — the reason the primary action is
   * not available yet, in visible text. Pair it with the button's
   * `disabledReason`, which carries the same sentence to assistive tech.
   */
  hint?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Blocks backdrop and Esc dismissal while something is in flight. */
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const footerRef = useRef<HTMLElement>(null);
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

  /*
    Below `sm`, a form dialog takes the whole screen (P1C, UX-26).

    A centred desktop card at 375 px is a 343 px box with a 1 rem gutter of
    dimmed page around it — the gutter buys nothing on a phone and costs the
    width every field needs. So `md` and up become a full-screen sheet there:
    edge to edge, the full dynamic height, no rounding. `sm` — a confirmation,
    two sentences and two buttons — stays a compact card, because a full
    screen for "Wirklich löschen?" hides the page the reader is deciding about.
  */
  const phone =
    size === "sm"
      ? ""
      : "max-sm:m-0 max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none";

  /*
    The footer's primary action is outside the body's `<form>`, so pressing
    it fires no `submit` there — and the form's "focus the first invalid
    field" never armed. The click is announced to the form instead.
  */
  const announceSubmitAttempt = (e: MouseEvent<HTMLElement>) => {
    const pressed = (e.target as HTMLElement).closest<HTMLElement>("button[data-variant]");
    const variant = pressed?.dataset.variant;
    if (!pressed || variant === "ghost" || variant?.startsWith("danger")) return;
    ref.current?.querySelector("form")?.dispatchEvent(new Event(SUBMIT_ATTEMPT));
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onKeyDown={(e) => pressPrimaryOnEnter(e, footerRef.current)}
      onClick={(e) => {
        // A click landing on the dialog element itself is a backdrop click —
        // the content sits in child elements.
        if (e.target === ref.current && !busy) onClose();
      }}
      className={cn(
        "max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-lg bg-surface p-0 text-ink",
        "shadow-card ring-1 ring-line backdrop:bg-ink/40 backdrop:backdrop-blur-sm",
        widths[size],
        phone,
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
        {/*
          `IconButton`: the label is required, so the one icon-only control on
          every dialog cannot lose its name, and it grows to the 44 px touch
          target on a coarse pointer.
        */}
        <IconButton
          label="Schliessen"
          onClick={onClose}
          disabled={busy}
          className="rounded-full"
          icon={
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          }
        />
      </header>

      <div className="px-6 py-5">{children}</div>

      {footer ? (
        /*
          Sticky, so the primary action — and the reason it is blocked — stays
          on screen when the form is taller than the viewport. The dialog is
          its own scroll container, and at phone width a long form pushed the
          footer below the fold: the reader filled in eight fields and then
          had to find the button (UX-26, found by `p1a-ux.spec.ts` at 375 px).

          The background is the old `bg-surface-2/50` tint laid over an opaque
          surface: a sticky bar must not let the fields scroll through it, and
          a plain `bg-surface-2` would be a different colour from before.
        */
        <footer
          ref={footerRef}
          onClickCapture={announceSubmitAttempt}
          className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4 [background:linear-gradient(rgb(var(--c-surface-2)/0.5),rgb(var(--c-surface-2)/0.5)),rgb(var(--c-surface))]"
        >
          {hint ? (
            <p className="mr-auto min-w-0 basis-full text-[12px] leading-snug text-muted sm:basis-auto sm:flex-1">
              {hint}
            </p>
          ) : null}
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
 *
 * ---
 *
 * **Three levels of friction (P1C), chosen by consequence, never by look:**
 *
 * | Level | When | Shape |
 * | --- | --- | --- |
 * | LOW | reversible — archive, hide, cancel a schedule | `ConfirmDialog` |
 * | MEDIUM | a delete or removal with effects beyond the row | `ConfirmDialog` + `consequence` (a `Callout` saying what else goes) |
 * | HIGH | irreversible *and* consequential — a user, a dossier, a project, a restore, a security reset | `confirmText` (typed word), and for security or data replacement the `ReauthenticationDialog` window first — `RestoreDialog` and the MFA reset are the pattern |
 *
 * Visual consistency never lowers a level: a restore keeps its password
 * prompt and its typed word even though a plain dialog would look tidier.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  consequence,
  confirmLabel = "Bestätigen",
  destructive,
  confirmText,
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  /** MEDIUM level: what else is affected. Rendered as a warning `Callout`. */
  consequence?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  confirmText?: string;
  busy?: boolean;
  /**
   * A refusal, shown *in* the dialog. Office archiving rendered its error
   * behind the open confirmation, where nobody could read it (Part 10.2).
   */
  error?: string | null;
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
        {error ? (
          <Callout tone="danger" announce>
            <p className="font-medium text-ink">{error}</p>
          </Callout>
        ) : null}
        <div>{message}</div>
        {consequence ? <Callout tone="warning">{consequence}</Callout> : null}
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
