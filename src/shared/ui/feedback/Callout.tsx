import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * One boxed message inside a screen or a dialog (P1C).
 *
 * Before this, every feature drew its own tinted box — the form's error
 * banner, `ConflictNotice`, the restore dialog's warning, the security notes
 * in the MFA dialogs — each with slightly different padding, ring and tint,
 * and a reader could not tell from the box alone whether it was a hint, a
 * warning or a refusal. The tone is now the meaning:
 *
 * | Tone          | Means                                                   |
 * | ------------- | ------------------------------------------------------- |
 * | `info`        | Context the reader should know. Nothing is wrong.       |
 * | `warning`     | Something is about to have an effect worth pausing on.  |
 * | `danger`      | It failed, or it cannot be undone.                      |
 * | `security`    | An effect on an account's access or on credentials.     |
 *
 * Brand colours only — bronze is the palette's "careful" tone, as on the
 * `danger` button; `accent` (navy's foreground counterpart) is the security
 * tone.
 *
 * **`announce` is a decision, not a default.** A failure that appears after
 * the reader pressed something is announced (`role="alert"`); a consequence
 * printed in a dialog the reader just opened is *read* with the dialog, and
 * announcing it again would interrupt the title. The form's error banner and
 * the conflict notice announce; a consequence does not.
 */
export type CalloutTone = "info" | "warning" | "danger" | "security";

const TONES: Record<CalloutTone, { box: string; glyph: string; path: string }> = {
  info: {
    box: "bg-brand-blue/[0.06] ring-brand-blue/20",
    glyph: "text-brand-blue",
    path: "M8 7.25v3.5M8 5.1v.01M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z",
  },
  warning: {
    box: "bg-brand-bronze/[0.08] ring-brand-bronze/25",
    glyph: "text-brand-bronze",
    path: "M8 5.75v3.25M8 11.1v.01M7.13 2.5 1.6 12a1 1 0 0 0 .87 1.5h11.06a1 1 0 0 0 .87-1.5L8.87 2.5a1 1 0 0 0-1.74 0Z",
  },
  danger: {
    box: "bg-brand-bronze/[0.08] ring-brand-bronze/25",
    glyph: "text-brand-bronze",
    path: "M5.75 5.75l4.5 4.5m0-4.5-4.5 4.5M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z",
  },
  // `accent`, not `brand-navy`: navy is a background token, and as a glyph on
  // a dark card it measures 2.93:1 (`theme.tokens.test.ts` guards it).
  security: {
    box: "bg-accent/[0.06] ring-accent/20",
    glyph: "text-accent",
    path: "M8 1.75 2.75 3.75v4c0 3 2.2 5.4 5.25 6.5 3.05-1.1 5.25-3.5 5.25-6.5v-4L8 1.75Z",
  },
};

export function Callout({
  tone = "info",
  title,
  children,
  actions,
  announce = false,
  className,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons that resolve what the callout says — "Neueste Fassung laden". */
  actions?: ReactNode;
  /** `role="alert"` — for something that appears *because* the reader acted. */
  announce?: boolean;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      role={announce ? "alert" : undefined}
      data-callout={tone}
      className={cn("flex gap-3 rounded-md px-4 py-3 ring-1", t.box, className)}
    >
      <svg
        viewBox="0 0 16 16"
        className={cn("mt-0.5 h-4 w-4 shrink-0", t.glyph)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={t.path} />
      </svg>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {title ? <p className="text-[14px] font-semibold leading-snug text-ink">{title}</p> : null}
        {children ? (
          <div className="flex flex-col gap-1 text-[13px] leading-relaxed text-muted [&_strong]:font-medium [&_strong]:text-ink">
            {children}
          </div>
        ) : null}
        {actions ? <div className="flex flex-wrap gap-2 pt-0.5">{actions}</div> : null}
      </div>
    </div>
  );
}
