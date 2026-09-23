import { useEffect, useId, useState, type ReactNode } from "react";
import { Badge, Button, type BadgeTone } from "@/shared/ui/primitives";
import { Callout, type CalloutTone } from "@/shared/ui/feedback/Callout";
import { Field } from "@/shared/ui/forms/Field";
import { Form } from "@/shared/ui/forms/Form";
import { Select, Textarea } from "@/shared/ui/forms/inputs";
import { Modal } from "./Modal";

/**
 * A change of state that is not a save (P1C).
 *
 * Submitting for review, approving a protocol, withdrawing a plan, closing a
 * project: each moves a record from one status to another, usually with a
 * consequence somebody else will act on, and several cannot be taken back.
 * They used to be a plain button (`secondary` for an irreversible act), a
 * one-line `ConfirmDialog`, or a bespoke dialog each module drew for itself —
 * four near-copies of "Status ändern" with a select, a reason and a button
 * labelled "Ändern" — so the one moment the reader should slow down looked
 * exactly like "Save".
 *
 * Every transition now shows the same four things, in this order:
 *
 * 1. **where the record is and where it will be** — two badges and an arrow;
 *    a select above them when the server offers more than one target;
 * 2. **what follows** — a `Callout`, `warning` when it cannot be undone;
 * 3. **why**, when the target wants a reason (a withdrawal must say why — the
 *    `DrawingWithdrawn` payload decided that) — required or optional, with a
 *    minimum length the server enforces again;
 * 4. **one confirm button** named for the act, `danger` when the target
 *    removes or withdraws something, `primary` otherwise.
 *
 * The targets are the server's `allowedTransitions`, never a client table; the
 * caller maps each to its label and consequence. The caller performs the
 * mutation and reports back through `error`: a refusal (a missing authority,
 * a precondition, a four-eyes rule) stays in the dialog as a `Callout` rather
 * than a toast, so the reader can read it and cancel.
 */
export type TransitionState = { label: string; tone?: BadgeTone };

export type TransitionReason = {
  label: string;
  required?: boolean;
  /** Enforced here for the message; the server enforces it again. */
  minLength?: number;
  hint?: string;
  placeholder?: string;
};

export type TransitionTarget = TransitionState & {
  value: string;
  /** What happens as a result — who is told, what becomes read-only, what cannot be undone. */
  consequence?: ReactNode;
  consequenceTone?: CalloutTone;
  reason?: TransitionReason;
  /** Defaults to "Auf „<label>“ setzen". */
  confirmLabel?: string;
  /** Removes or withdraws something: the confirm becomes `danger` and Enter never presses it. */
  destructive?: boolean;
};

export function StatusTransitionDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  from,
  targets,
  consequence,
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  /** The chosen target's `value` and the trimmed reason (or `""`). The caller closes on success. */
  onConfirm: (target: string, reason: string) => void;
  title: string;
  description?: string;
  from: TransitionState;
  /** One entry for a fixed transition; several and a select appears. */
  targets: TransitionTarget[];
  /** Shown for every target that brings no consequence of its own. */
  consequence?: ReactNode;
  busy?: boolean;
  /** A refusal from the server, already through `toFailure`. */
  error?: string | null;
}) {
  const [value, setValue] = useState(targets[0]?.value ?? "");
  const [text, setText] = useState("");
  const selectId = useId();
  const reasonId = useId();

  // A new transition starts from the first target with an empty reason — the
  // previous one belonged to a different record (the review dialog kept its
  // note across reviews, Part 10.2).
  useEffect(() => {
    if (open) {
      setValue(targets[0]?.value ?? "");
      setText("");
    }
    // The targets are read when the dialog opens, not tracked while it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const target = targets.find((t) => t.value === value) ?? targets[0];
  const reason = target?.reason;
  const trimmed = text.trim();
  const min = reason?.minLength ?? (reason?.required ? 1 : 0);
  const blocked = !target
    ? "Kein Statuswechsel möglich."
    : reason && trimmed.length < min
      ? min > 1
        ? `Bitte eine Begründung mit mindestens ${min} Zeichen angeben.`
        : "Bitte eine Begründung angeben."
      : null;

  const confirm = () => {
    if (blocked || busy || !target) return;
    onConfirm(target.value, trimmed);
  };

  const shownConsequence = target?.consequence ?? consequence;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="md"
      busy={busy}
      hint={blocked}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            variant={target?.destructive ? "danger" : "primary"}
            onClick={confirm}
            busy={busy}
            disabled={Boolean(blocked)}
            disabledReason={blocked}
          >
            {target?.confirmLabel ?? `Auf „${target?.label ?? ""}“ setzen`}
          </Button>
        </>
      }
    >
      <Form onSubmit={confirm} error={error}>
        {targets.length > 1 ? (
          <Field label="Neuer Status" htmlFor={selectId}>
            <Select
              id={selectId}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setText("");
              }}
              options={targets.map((t) => ({ value: t.value, label: t.label }))}
            />
          </Field>
        ) : null}

        <p className="flex flex-wrap items-center gap-2" data-transition>
          <span className="sr-only">Status von</span>
          <Badge tone={from.tone ?? "neutral"}>{from.label}</Badge>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
          <span className="sr-only">nach</span>
          <Badge tone={target?.tone ?? "navy"}>{target?.label ?? "—"}</Badge>
        </p>

        {shownConsequence ? (
          <Callout tone={target?.consequenceTone ?? (target?.destructive ? "warning" : "info")}>
            {shownConsequence}
          </Callout>
        ) : null}

        {reason ? (
          <Field
            label={reason.label}
            htmlFor={reasonId}
            optional={!reason.required}
            hint={reason.hint}
          >
            <Textarea
              id={reasonId}
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={reason.placeholder}
            />
          </Field>
        ) : null}
      </Form>
    </Modal>
  );
}
