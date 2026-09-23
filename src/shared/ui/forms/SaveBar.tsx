import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/shared/ui/primitives";
import { useToastClearance } from "@/shared/ui/feedback/toast";

/**
 * The save state of one form, stated where the reader is looking.
 *
 * A configuration screen is the place where somebody does the most damage with
 * the least feedback, and the settings page it replaces gave three kinds of
 * none: one Save button in the page header, far from whichever field had just
 * been typed in; no indication that anything was outstanding; and a toast
 * afterwards that had gone by the time the reader looked up.
 *
 * So this is **sticky to the bottom of the section** and says which of four
 * things is true — clean, dirty, saving, just saved. Three decisions are worth
 * stating because each was the alternative:
 *
 * **It stays out of the way when clean.** A permanent bar at the foot of every
 * section is chrome the reader learns to ignore, which is the state in which
 * it fails to warn them. `dirty` is what brings it in.
 *
 * **"Gespeichert" fades on a timer rather than on the next interaction.** A
 * confirmation that persists is indistinguishable from a stale one a minute
 * later; `savedAt` changing is what restarts it, so saving twice says so twice.
 *
 * **Reset is offered beside Save, never instead of it.** The reader who
 * realises mid-form that they have changed the wrong thing has no other way
 * back — reloading the page is the alternative and it loses more than they
 * meant to discard.
 *
 * ---
 *
 * **It must sit inside a `<Form>`, and the save button carries no `onClick`.**
 *
 * The first version had both `type="submit"` *and* an `onClick`, which inside
 * a form is two submissions from one click: React fires the handler, the
 * browser then dispatches `submit`, and `Form` calls the same function again.
 * The first `PATCH` succeeds, the second carries the now-stale
 * `expectedVersion` and comes back **409** — so a save that worked would
 * report a conflict with itself, and the obvious reading of that message is
 * that a colleague had just edited the record.
 *
 * `type="submit"` with no handler is the fix rather than `type="button"` with
 * one, because it is the half that keeps **Enter** working: a form with no
 * submit button does not submit implicitly once it has more than one field,
 * and that is most forms here.
 */
export function SaveBar({
  dirty,
  saving,
  savedAt,
  onReset,
  saveLabel = "Speichern",
  /** Shown left of the buttons — a count, a warning, a permission note. */
  children,
  disabled,
  disabledReason,
  failed,
  conflict,
}: {
  /**
   * The last save was refused (P1C). The *sentence* is the form's `Callout`
   * above the fields — see the note on `error` below — so the bar says only
   * that it did not save and where the reason is. A failure used to read as
   * "Ungespeicherte Änderungen", which is true and tells the reader nothing
   * about the save they just pressed.
   */
  failed?: boolean;
  /** A 409: the record changed elsewhere. Pair with `ConflictNotice` above the form. */
  conflict?: boolean;
  dirty: boolean;
  saving: boolean;
  /** Bumped by the caller on every successful save. */
  savedAt?: number | null;
  /*
    There is no `error` either. `Form` renders the message that belongs to no
    field, above the fields, and a second copy down here would be the same
    sentence twice on one screen — or, worse, two places to forget to clear.
    A failed save leaves the form dirty, so the bar stays visible anyway.
  */
  /**
   * Discards the pending edits. Optional — a section with nothing worth
   * reverting to may leave it out.
   *
   * There is no `onSave`: saving is the enclosing `<Form>`'s `onSubmit`. See
   * the note above for why that is one prop rather than two.
   */
  onReset?: () => void;
  saveLabel?: string;
  children?: ReactNode;
  /** Blocks the save — no permission, or a field the server would refuse. */
  disabled?: boolean;
  disabledReason?: string;
}) {
  /**
   * Which save has already had its confirmation, rather than "is one showing".
   *
   * The obvious shape is a `showSaved` boolean switched on in an effect and
   * off on a timer — and it is the shape that makes the effect write state
   * synchronously on every render where `savedAt` moved, which is a cascading
   * render for a label. Storing the *dismissed* timestamp instead makes the
   * visible state derived: the effect only ever fires from the timeout
   * callback, which is what effects are for.
   */
  const [dismissed, setDismissed] = useState<number | null>(null);
  const showSaved = Boolean(savedAt) && dismissed !== savedAt;

  useEffect(() => {
    if (!savedAt || dismissed === savedAt) return;
    const timer = window.setTimeout(() => setDismissed(savedAt), 4000);
    return () => window.clearTimeout(timer);
  }, [savedAt, dismissed]);

  const visible = dirty || saving || showSaved;
  const barRef = useRef<HTMLDivElement>(null);
  useToastClearance(barRef, visible);

  // Nothing outstanding, nothing to report, nothing to say. The bar is absent
  // rather than empty — see the note above.
  if (!visible) return null;

  return (
    <div
      ref={barRef}
      /*
        `glass-raised` — the material for "anything that floats", which this
        does: it sits in front of the section's own content rather than being
        part of it.

        **No `bg-` and no `ring-` utility beside it.** The pane sets its own
        `background` and draws its ring in the same `box-shadow`, and Tailwind
        emits `@layer components` before utilities — so a `bg-surface` here
        would win silently and flatten the glass with nothing anywhere
        reporting it. Every call site drops its `bg-` when it gains a
        `glass-`; see CLAUDE.md.
      */
      className="glass-raised sticky bottom-0 z-10 -mx-1 mt-6 rounded-lg px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          {saving ? (
            <p role="status" className="text-muted">
              Wird gespeichert …
            </p>
          ) : conflict ? (
            <p role="status" className="font-medium text-brand-bronze">
              Nicht gespeichert — inzwischen geändert.
            </p>
          ) : failed && dirty ? (
            <p role="status" className="font-medium text-brand-bronze">
              Nicht gespeichert — Grund siehe oben.
            </p>
          ) : showSaved && !dirty ? (
            /*
              `role="status"`, not `role="alert"`. A success is announced when
              the reader next pauses; an alert interrupts whatever they are
              doing, which for a confirmation is rude and for a screen-reader
              user actively loses their place.
            */
            <p role="status" className="font-medium text-ink">
              Gespeichert.
            </p>
          ) : dirty ? (
            <p className="text-muted">Ungespeicherte Änderungen.</p>
          ) : null}
          {children}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onReset && dirty && !saving ? (
            <Button variant="ghost" size="sm" onClick={onReset}>
              Verwerfen
            </Button>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            busy={saving}
            disabled={!dirty || disabled}
            title={disabled ? disabledReason : undefined}
          >
            {saveLabel}
          </Button>
        </div>
      </div>
      {disabled && disabledReason && dirty ? (
        <p className="mt-2 text-[12px] leading-snug text-muted">{disabledReason}</p>
      ) : null}
    </div>
  );
}
