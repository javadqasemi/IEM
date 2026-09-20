import { forwardRef, type ChangeEvent, type ClipboardEvent } from "react";
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
 * `tracking` and the monospace face are what make six digits readable as
 * three-and-three without splitting the element.
 */
export const OtpInput = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (next: string) => void;
  /** Fired once the field holds a full-length code. Never auto-submits. */
  onComplete?: () => void;
  id: string;
  length?: number;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** For the rare second field on a screen — the label text is the caller's. */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  className?: string;
}>(function OtpInput(
  { value, onChange, onComplete, id, length = 6, invalid, disabled, autoFocus, className, ...aria },
  ref,
) {
  const accept = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, length);
    onChange(digits);
    if (digits.length === length) onComplete?.();
  };

  return (
    <input
      ref={ref}
      id={id}
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => accept(e.target.value)}
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
      className={cn(
        "field-input text-center font-mono text-[22px] tracking-[0.5em] tnum",
        // The tracking pushes the visual centre left by half a letter-space,
        // because the gap after the last digit has nothing after it to
        // balance. An equal indent puts the digits back in the middle.
        "indent-[0.5em]",
        invalid && "field-input-error",
        className,
      )}
    />
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
