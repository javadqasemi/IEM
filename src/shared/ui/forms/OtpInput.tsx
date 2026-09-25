import { forwardRef, useState, type ChangeEvent, type ClipboardEvent, type MouseEvent } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * A one-time code, as **one input** rather than six.
 *
 * ---
 *
 * ## Why one box
 *
 * Six single-character boxes is the pattern people expect from the screenshot
 * and the one that breaks for everybody who is not using a mouse and a
 * desktop keyboard. Each box has to hand focus forwards on input, backwards
 * on `Backspace` into an empty box, and sideways on the arrow keys; a paste
 * lands in whichever box has focus and has to be split across the others by
 * hand; autofill from a password manager or from iOS's SMS suggestion fills
 * the *first* box with all six characters and the rest with nothing; and a
 * screen reader announces six unlabelled edit fields.
 *
 * Every one of those is fixable and all six have to be fixed *again* the next
 * time the component is touched. A single input has them for free from the
 * platform: paste works, autofill works, `Backspace` works, selection works,
 * and there is one label to announce.
 *
 * ## What is not free, and is done here
 *
 * - **`autoComplete="one-time-code"`** is what makes iOS offer the code from
 *   an SMS and what makes 1Password and Bitwarden offer the TOTP they are
 *   already storing. It is the single highest-value attribute on the element.
 * - **`inputMode="numeric"`** gives a phone the number pad. `type="number"`
 *   would do that too and brings a spinner, a scroll-wheel hazard and a value
 *   that drops leading zeros — a code of `012345` becomes `12345`.
 * - **Digits only, filtered on the way in**, so a pasted `123 456` or
 *   `"123456"` with a stray quote becomes six digits rather than an error the
 *   reader has to diagnose. The server normalises too; this is so the field
 *   never *looks* wrong.
 * - **Submitting on completion is not done**, deliberately. An auto-submit
 *   that fires on the sixth character races the person's own Enter and, when
 *   the code is rejected, leaves them staring at an error they did not choose
 *   to trigger. `onComplete` is offered so a caller can focus the button
 *   instead.
 *
 * ## Six boxes on screen, one input underneath
 *
 * The *look* of six slots is drawn by an `aria-hidden` row of spans, and the
 * real input lies transparently on top of it. Everything above still holds —
 * there is still exactly one element to focus, label, paste into and autofill
 * — and the slots only mirror its value and its caret:
 *
 * - the slot under the caret is the **active** one: a gold border and a soft
 *   gold glow, which is also this control's focus indicator (the input's own
 *   outline is suppressed because it would outline an invisible box);
 * - clicking a filled slot selects that one digit, so typing replaces it —
 *   the one behaviour of separate boxes worth having;
 * - a selection across several digits is drawn across their slots.
 *
 * Moving "to the next box" and `Backspace` "into the previous box" are the
 * caret moving inside one input, which the platform already does.
 *
 * `invalid` and `success` tone every slot at once. The styles are the `otp-`
 * block in `admin.css`.
 */
export const OtpInput = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (next: string) => void;
  /** Fired once the field holds a full-length code. Never auto-submits. */
  onComplete?: () => void;
  id: string;
  length?: number;
  invalid?: boolean;
  /** The server accepted the code: every slot turns to the success tone. */
  success?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** For the rare second field on a screen — the label text is the caller's. */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  className?: string;
}>(function OtpInput(
  {
    value,
    onChange,
    onComplete,
    id,
    length = 6,
    invalid,
    success,
    disabled,
    autoFocus,
    className,
    ...aria
  },
  ref,
) {
  /*
    The caret, mirrored. `null` while the input does not have focus, so no
    slot claims to be active when the keyboard is somewhere else. Updated on
    `select`, which React fires for every caret move — typing, arrows, clicks,
    select-all — so this is a handful of renders per keystroke, not per frame.
  */
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const track = (el: HTMLInputElement) =>
    setSelection({ start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length });

  const accept = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, length);
    onChange(digits);
    if (digits.length === length) onComplete?.();
  };

  const state = invalid ? "error" : success ? "success" : undefined;
  const half = length % 2 === 0 ? length / 2 : 0;
  const activeSlot =
    selection && selection.end - selection.start <= 1
      ? Math.min(selection.start, length - 1)
      : -1;

  return (
    <div
      className={cn("otp", className)}
      data-state={state}
      data-disabled={disabled || undefined}
    >
      <input
        ref={ref}
        id={id}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => accept(e.target.value)}
        onFocus={(e) => track(e.currentTarget)}
        onSelect={(e) => track(e.currentTarget)}
        onBlur={() => setSelection(null)}
        /*
          A click lands on the invisible text, whose caret position has nothing
          to do with the slot underneath the pointer. So the slot is worked out
          from the pointer instead: a filled slot selects its digit (typing then
          replaces it), anything past the end puts the caret at the end.
        */
        onMouseUp={(e: MouseEvent<HTMLInputElement>) => {
          const el = e.currentTarget;
          const boxes = Array.from(el.nextElementSibling?.children ?? [], (s) => s.getBoundingClientRect());
          if (!boxes.length) return;
          // The slot under the pointer, or the nearest one when it is in a gap.
          let slot = 0;
          for (let i = 0; i < boxes.length; i += 1) if (e.clientX >= boxes[i].left) slot = i;
          if (slot < el.value.length) el.setSelectionRange(slot, slot + 1);
          else el.setSelectionRange(el.value.length, el.value.length);
          track(el);
        }}
        /*
          Paste is handled explicitly as well as through `onChange`, because a
          paste over a *selection* in some browsers fires `paste` with the new
          text and `change` with a value the filter would then re-truncate.
          Taking the clipboard directly makes the result the same either way.
        */
        onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
          const pasted = e.clipboardData.getData("text");
          if (!pasted) return;
          e.preventDefault();
          accept(pasted);
        }}
        type="text"
        inputMode="numeric"
        // A pattern the browser can validate, so a native form report says
        // something true rather than "please match the requested format".
        pattern={`[0-9]{${length}}`}
        maxLength={length}
        autoComplete="one-time-code"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={invalid || aria["aria-invalid"] || undefined}
        aria-describedby={aria["aria-describedby"]}
        className="otp-input"
      />
      <div
        aria-hidden="true"
        className="otp-slots"
        style={{
          gridTemplateColumns: half
            ? `repeat(${half}, minmax(0, 1fr)) 0.25rem repeat(${half}, minmax(0, 1fr))`
            : `repeat(${length}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length }, (_, i) => {
          const selected =
            selection !== null && selection.end - selection.start > 1 && i >= selection.start && i < selection.end;
          return (
            <span
              key={i}
              className="otp-slot tnum"
              // Three and three, with a narrow column between the halves —
              // the grouping the old tracking gave the single field.
              style={half && i >= half ? { gridColumn: i + 2 } : undefined}
              data-active={i === activeSlot || undefined}
              data-selected={selected || undefined}
              data-filled={i < value.length || undefined}
            >
              {value[i] ?? ""}
              {i === activeSlot && i >= value.length ? <span className="otp-caret" /> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
});

/**
 * The recovery-code field: the same job, a different alphabet.
 *
 * Beside `OtpInput` rather than folded into it with a prop, because almost
 * nothing is shared — this one takes letters, is longer, is written in groups
 * of five with a hyphen, and must **not** claim `one-time-code` autofill,
 * which would make a password manager offer the TOTP for a field that cannot
 * accept one.
 *
 * Nothing is filtered out here. The server folds `O`→`0` and `I`/`L`→`1` and
 * refuses what is left over, and a field that silently deleted the character
 * somebody just typed would be the worse of the two failures: they would
 * retype it, watch it vanish again, and have no idea why.
 */
export const RecoveryCodeInput = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (next: string) => void;
  id: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}>(function RecoveryCodeInput({ value, onChange, id, invalid, disabled, autoFocus, className }, ref) {
  return (
    <input
      ref={ref}
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value.toUpperCase())}
      type="text"
      inputMode="text"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="characters"
      spellCheck={false}
      maxLength={16}
      placeholder="XXXXX-XXXXX"
      disabled={disabled}
      autoFocus={autoFocus}
      aria-invalid={invalid || undefined}
      className={cn(
        "field-input text-center font-mono text-[18px] tracking-[0.2em] uppercase",
        "indent-[0.2em]",
        invalid && "field-input-error",
        className,
      )}
    />
  );
});
