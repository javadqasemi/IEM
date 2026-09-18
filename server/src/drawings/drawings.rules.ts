import { DrawingStatus } from "@prisma/client";
import {
  AMBIGUOUS_REVISION_LETTERS,
  alphaValue,
  nextRevisionLabel,
} from "../core/versioning/revision";

/**
 * What a plan and a Planversand are allowed to do.
 *
 * **Pure.** No Prisma client, no Nest injection, nothing async — the rule
 * `projects.rules.ts` set and the two modules since have kept.
 *
 * Two rules in here are the module's reason to exist, and both are the kind
 * that get quietly relaxed if they live inside a service:
 *
 * - **`ISSUED` and `SUPERSEDED` are not settable.** They are consequences —
 *   of a Planversand and of a newer revision — so a plan can never read as
 *   issued without a transmittal naming who received it. Exactly the shape
 *   Entscheide used for `AUFGEHOBEN`, and adopted here on purpose: the second
 *   time a pattern earns its keep is when it stops being a coincidence.
 * - **A draftsman may not check their own work.** `docs/permissions.md` §3.10
 *   states it as the reason `drawing.check` is a key of its own; a permission
 *   alone cannot express it, because the question is not what the caller holds
 *   but whose name is already in the other column.
 */

/* ================================================================== */
/* Status                                                              */
/* ================================================================== */

/**
 * The lifecycle, and the two states missing from the right-hand sides.
 *
 * `WIP → IN_CHECK → CHECKED → RELEASED`, with the way back at every step
 * before release, because a check that finds something is the normal case and
 * not an error — a plan returned for correction is the system working.
 *
 * **`ISSUED` appears nowhere** as a target. A plan becomes issued by being sent
 * to somebody, so it is reached through `Transmittal` and never through a status
 * call; offering it here would let a plan read as "in the contractor's hands"
 * with no record of whose hands. **`SUPERSEDED` is absent for the same reason**:
 * it is what a newer revision does to an older one.
 *
 * `WITHDRAWN` is reachable from everywhere including `ISSUED`, and that is
 * deliberate rather than sloppy: withdrawing an issued plan is precisely the
 * situation the module is for — something is wrong and the people building from
 * it have to be told.
 */
export const DRAWING_TRANSITIONS: Readonly<Record<DrawingStatus, readonly DrawingStatus[]>> = {
  WIP: ["IN_CHECK", "WITHDRAWN"],
  IN_CHECK: ["CHECKED", "WIP", "WITHDRAWN"],
  CHECKED: ["RELEASED", "WIP", "WITHDRAWN"],
  RELEASED: ["WIP", "WITHDRAWN"],
  ISSUED: ["WITHDRAWN"],
  SUPERSEDED: ["WITHDRAWN"],
  WITHDRAWN: [],
};

export function transitionsFrom(status: DrawingStatus): readonly DrawingStatus[] {
  return DRAWING_TRANSITIONS[status];
}

/** The statuses a plan may be edited in. Past release it is a published fact. */
export const EDITABLE_STATUSES: readonly DrawingStatus[] = [
  DrawingStatus.WIP,
  DrawingStatus.IN_CHECK,
  DrawingStatus.CHECKED,
];

export type TransitionInput = {
  /** The revisions on the plan. A plan with none cannot be checked or released. */
  revisions: readonly { revision: string; releasedAt: Date | null }[];
  drawnById: string | null;
  checkedById: string | null;
};

/**
 * Why a transition is refused, or `null` if it is allowed.
 *
 * German, and returned rather than thrown, because the same function backs a
 * disabled button's tooltip: a rule that can only express itself as an exception
 * cannot explain itself before the user presses the button.
 */
export function refuseTransition(
  from: DrawingStatus,
  to: DrawingStatus,
  input: TransitionInput,
): string | null {
  if (from === to) return null;

  if (to === DrawingStatus.ISSUED) {
    return (
      "Ein Plan wird nicht auf „ausgegeben“ gesetzt, sondern versandt. " +
      "Der Planversand hält fest, wer welche Revision erhalten hat."
    );
  }
  if (to === DrawingStatus.SUPERSEDED) {
    return (
      "„Überholt“ wird nicht gesetzt, sondern verursacht: sobald eine neue " +
      "Revision freigegeben ist, ist die vorige überholt."
    );
  }

  if (!DRAWING_TRANSITIONS[from].includes(to)) {
    const allowed = DRAWING_TRANSITIONS[from];
    if (!allowed.length) return "Ein zurückgezogener Plan kann nicht mehr geändert werden.";
    return `Ein Plan im Status ${from} kann nur nach ${allowed.join(" oder ")} wechseln.`;
  }

  // Nothing to check, and nothing to release, without a revision: the status
  // describes the drawing *file*, and there is not one yet.
  if (
    (to === DrawingStatus.IN_CHECK || to === DrawingStatus.RELEASED) &&
    input.revisions.length === 0
  ) {
    return "Der Plan hat noch keine Revision — es gibt nichts zu prüfen oder freizugeben.";
  }

  if (to === DrawingStatus.CHECKED) {
    if (!input.checkedById) return "Für die Prüfung fehlt die prüfende Person.";
    const refusal = refuseFourEyes(input.drawnById, input.checkedById);
    if (refusal) return refusal;
  }

  return null;
}

/**
 * The four-eyes rule, in one place because it is asked in two.
 *
 * `docs/permissions.md` §3.10: *"a draftsman draws and may not check their own
 * work; an engineer checks and releases."* Note what is **not** enforced —
 * releasing a plan you checked is allowed, because the document names only the
 * first pair and inventing the second would refuse a two-person office's normal
 * day. When a rule is stricter than the firm's practice, the firm stops using
 * the system rather than the practice.
 */
export function refuseFourEyes(drawnById: string | null, checkedById: string | null): string | null {
  if (drawnById && checkedById && drawnById === checkedById) {
    return "Wer den Plan gezeichnet hat, kann ihn nicht selbst prüfen.";
  }
  return null;
}

/* ================================================================== */
/* Revisions                                                           */
/* ================================================================== */

/**
 * The next revision letter, **skipping `I` and `O`**.
 *
 * `core/versioning/revision.ts` declared `AMBIGUOUS_REVISION_LETTERS` during
 * F13 with the note *"Nothing in this module applies the exclusion yet —
 * Drawings are Wave 2."* This is Wave 2. `I` reads as a one and `O` as a nought
 * in a title block at the resolution a plan is usually read at, which is why
 * ISO 7200 omits both.
 *
 * **Base-26 with skips, not base-24**, and the difference is worth a sentence:
 * a true base-24 alphabet would need its own inverse, and `alphaValue` — which
 * `revision.test.ts` round-trips over the first thousand labels — would stop
 * agreeing with it. Advancing until the label is clean keeps one numbering
 * system with one inverse, at the cost of the gaps being visible in the
 * sequence. They are supposed to be visible; that is what a skipped letter is.
 */
export function nextDrawingRevision(current: string | null): string {
  if (!current) return "A";

  let next = nextRevisionLabel("ALPHA", current);
  while (hasAmbiguousLetter(next)) next = nextRevisionLabel("ALPHA", next);
  return next;
}

export function hasAmbiguousLetter(label: string): boolean {
  return AMBIGUOUS_REVISION_LETTERS.some((letter) => label.includes(letter));
}

/**
 * Whether a revision label may be stored at all.
 *
 * Hand-entered labels are allowed — a plan set that started life in AutoCAD
 * arrives at `C` — so the same exclusions have to be checked on the way in.
 * `alphaValue` throws on anything that is not `[A-Z]+`, and the throw is caught
 * here so the caller gets a sentence rather than a stack trace.
 */
export function refuseRevisionLabel(label: string): string | null {
  const trimmed = label.trim().toUpperCase();
  if (!trimmed) return "Die Revision braucht eine Bezeichnung.";
  try {
    alphaValue(trimmed);
  } catch {
    return `„${label}“ ist keine Revisionsbezeichnung — erlaubt sind Buchstaben von A bis Z.`;
  }
  if (hasAmbiguousLetter(trimmed)) {
    return `„${trimmed}“ enthält I oder O. Beide werden übersprungen, weil sie im Plankopf als 1 und 0 gelesen werden.`;
  }
  return null;
}

/** The shortest changeNote that says anything. Same bargain as a rationale. */
export const CHANGE_NOTE_MIN = 10;

export type RevisionInput = {
  changeNote: string;
  drawnById: string | null;
  checkedById: string | null;
  status: DrawingStatus;
};

/**
 * Why a new revision is refused, or `null`.
 *
 * **`changeNote` is required and must say something**, which is the whole point
 * of a revision: six months later the question is never "was there a revision
 * C" but "what changed in C". An empty note makes the row a date stamp.
 */
export function refuseRevision(input: RevisionInput): string | null {
  if (input.status === DrawingStatus.WITHDRAWN) {
    return "Ein zurückgezogener Plan bekommt keine neue Revision.";
  }
  const note = input.changeNote.trim();
  if (note.length < CHANGE_NOTE_MIN) {
    return `Was geändert wurde, gehört zur Revision — mindestens ${CHANGE_NOTE_MIN} Zeichen.`;
  }
  return refuseFourEyes(input.drawnById, input.checkedById);
}

/* ================================================================== */
/* Planversand                                                         */
/* ================================================================== */

export type TransmittalRevision = {
  id: string;
  /** For the message, so a refusal names the plan rather than an id. */
  label: string;
  releasedAt: Date | null;
  supersededAt: Date | null;
  drawingStatus: DrawingStatus;
};

/**
 * Why a Planversand is refused, or `null`.
 *
 * Three rules from `docs/data-model.md` §3.13, and the order matters: the most
 * specific message wins, because "der Versand ist nicht möglich" helps nobody.
 *
 * **Only a released revision may be sent.** Sending a WIP plan is how a
 * contractor builds from a drawing nobody checked, and it is the single
 * most expensive mistake this module exists to prevent.
 *
 * **A superseded revision may not be sent at all** — not even for information.
 * If somebody needs the old one they need it *with* the new one, and that is a
 * different act.
 */
export function refuseTransmittal(input: {
  revisions: readonly TransmittalRevision[];
  recipients: readonly { employeeId: string | null; externalName: string | null }[];
}): string | null {
  if (!input.revisions.length) {
    return "Ein Planversand ohne Pläne ist keiner.";
  }
  if (!input.recipients.length) {
    return "Ein Planversand braucht mindestens eine Empfängerin oder einen Empfänger.";
  }

  for (const recipient of input.recipients) {
    if (!recipient.employeeId && !recipient.externalName?.trim()) {
      return "Jede Empfängerzeile braucht entweder eine Person aus dem Personal oder einen Namen.";
    }
  }

  const superseded = input.revisions.filter((r) => r.supersededAt !== null);
  if (superseded.length) {
    return `${superseded.map((r) => r.label).join(", ")}: überholte Revisionen werden nicht versandt.`;
  }

  const unreleased = input.revisions.filter(
    (r) => r.releasedAt === null || r.drawingStatus === DrawingStatus.WIP,
  );
  if (unreleased.length) {
    return `${unreleased.map((r) => r.label).join(", ")}: nur freigegebene Revisionen können versandt werden.`;
  }

  const withdrawn = input.revisions.filter((r) => r.drawingStatus === DrawingStatus.WITHDRAWN);
  if (withdrawn.length) {
    return `${withdrawn.map((r) => r.label).join(", ")}: der Plan ist zurückgezogen.`;
  }

  return null;
}

export type PriorIssue = {
  /** Who already has an older revision of the same plan. */
  recipientLabel: string;
  drawingNumber: string;
  previousRevision: string;
  newRevision: string;
};

/**
 * Who must be told, as a **warning rather than a refusal**.
 *
 * `docs/data-model.md` §3.13: *"sending a revision that supersedes one already
 * issued to the same recipient raises a warning naming them, because that is
 * precisely the person who must be told."*
 *
 * A warning and not a refusal, and the distinction is the rule: this is the
 * normal case. A plan is revised and reissued constantly, and refusing it would
 * make the correct action impossible. What it must not be is *silent* — the
 * person holding revision B while C goes out is the one who builds the wrong
 * thing.
 *
 * Returns the list rather than a sentence, so a screen can render it as rows and
 * an API can return it beside the created transmittal.
 */
export function priorIssueWarnings(input: {
  sending: readonly { drawingId: string; drawingNumber: string; revision: string }[];
  /** Every earlier issue of the same plans, from the repository. */
  alreadyIssued: readonly {
    drawingId: string;
    revision: string;
    recipientLabel: string;
  }[];
}): PriorIssue[] {
  const warnings: PriorIssue[] = [];

  for (const item of input.sending) {
    for (const prior of input.alreadyIssued) {
      if (prior.drawingId !== item.drawingId) continue;
      // Only an *older* revision is a problem. Re-sending the same one is a
      // reminder, not a contradiction.
      if (!isOlderRevision(prior.revision, item.revision)) continue;

      const already = warnings.some(
        (w) =>
          w.recipientLabel === prior.recipientLabel &&
          w.drawingNumber === item.drawingNumber &&
          w.previousRevision === prior.revision,
      );
      if (already) continue;

      warnings.push({
        recipientLabel: prior.recipientLabel,
        drawingNumber: item.drawingNumber,
        previousRevision: prior.revision,
        newRevision: item.revision,
      });
    }
  }

  return warnings;
}

/**
 * Whether `a` comes before `b`.
 *
 * Compared by `alphaValue` rather than by string, because `"Z" < "AA"` is false
 * as a string and true as a revision — the one comparison in this module that
 * looks right and is backwards. Anything unparseable sorts as not-older, which
 * suppresses a warning rather than inventing one.
 */
export function isOlderRevision(a: string, b: string): boolean {
  try {
    return alphaValue(a.toUpperCase()) < alphaValue(b.toUpperCase());
  } catch {
    return false;
  }
}

/**
 * `PV-2026-0007`, allocated from the maximum already issued.
 *
 * From the maximum rather than from a count, for the reason project and decision
 * numbers give: a deleted row still consumed its number, and a transmittal
 * cannot be deleted at all — so the sequence has no holes to reuse and must
 * never appear to.
 */
export function formatTransmittalNumber(year: number, sequence: number): string {
  return `PV-${year}-${String(sequence).padStart(4, "0")}`;
}

export function nextTransmittalSequence(existing: readonly string[], year: number): number {
  const prefix = `PV-${year}-`;
  let max = 0;
  for (const number of existing) {
    if (!number.startsWith(prefix)) continue;
    const n = Number(number.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

/* ================================================================== */
/* The plan number                                                     */
/* ================================================================== */

/**
 * Whether a plan number is usable, or why not.
 *
 * Deliberately **not** a format check. `4723-HZG-EG-101` is this firm's shape
 * and the next client's will differ; a regex here would refuse a number the
 * office actually uses, and the office would put it in the title instead. What
 * is checked is what breaks things: emptiness, and the whitespace that makes two
 * numbers look identical and sort apart.
 */
export function refuseDrawingNumber(number: string): string | null {
  const trimmed = number.trim();
  if (!trimmed) return "Der Plan braucht eine Nummer.";
  if (trimmed.length > 60) return "Die Plannummer ist zu lang (höchstens 60 Zeichen).";
  if (/\s{2,}/.test(trimmed)) return "Die Plannummer enthält doppelte Leerzeichen.";
  return null;
}
