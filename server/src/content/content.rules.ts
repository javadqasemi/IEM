import { WorkflowState } from "@prisma/client";

/**
 * Every publishing decision that is arithmetic rather than I/O.
 *
 * The same split `auth.rules.ts`, `tasks.rules.ts`, `drawings.rules.ts` and
 * `backup.rules.ts` make, arriving late to the module that needed it first.
 * The transition table already lived in `content.service.ts` and was already a
 * table rather than a chain of `if`s — what it was not was **reachable without
 * a database**, so the one question an auditor actually asks ("can an editor
 * move something from IN_REVIEW straight to PUBLISHED?") could only be
 * answered by reading code rather than by running a test over every pair.
 *
 * `content.rules.test.ts` now asserts the whole 6×6 matrix, which is 36 cases
 * and takes milliseconds. That is the difference this file makes.
 *
 * No Prisma, no request, no clock it does not receive.
 */

/* ================================================================== */
/* The state machine                                                   */
/* ================================================================== */

/**
 * The transitions the workflow allows.
 *
 * Written as a table rather than as `if` chains in each method, because the
 * question an auditor asks is "can an editor move something from IN_REVIEW
 * straight to PUBLISHED?" and a table answers it by being read. The answer is
 * no: publishing is only reachable from APPROVED, and only by someone holding
 * `content.publish`, which in the seeded roles is Super Admin alone.
 *
 * **`PUBLISHED → DRAFT` is what unpublishing is** (P2-3). It was already in
 * the table before there was a verb for it, which is why adding one needed no
 * change here — the machine was right and the API was short.
 */
export const TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  DRAFT: ["IN_REVIEW", "ARCHIVED"],
  IN_REVIEW: ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED: ["PUBLISHED", "DRAFT", "REJECTED"],
  PUBLISHED: ["DRAFT", "ARCHIVED"],
  REJECTED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

export const WORKFLOW_STATES = Object.keys(TRANSITIONS) as WorkflowState[];

/** Whether the machine permits this step at all. */
export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Why this step is refused, or `null` when it is allowed.
 *
 * A message rather than a throw, so the caller decides the HTTP shape and so
 * the rule can be tested without catching anything — the pattern every other
 * `refuse*` in this codebase follows.
 */
export function refuseTransition(from: WorkflowState, to: WorkflowState): string | null {
  if (canTransition(from, to)) return null;
  return `Ein Eintrag im Status „${from}“ kann nicht direkt nach „${to}“ wechseln.`;
}

/* ================================================================== */
/* Unpublish                                                           */
/* ================================================================== */

/**
 * Why this entry may not be withdrawn from the live site, or `null`.
 *
 * ---
 *
 * ## What unpublishing actually is here
 *
 * The public site serves a **snapshot**, not the entry table — so "withdraw
 * this from the site" cannot be a status change alone. An entry is live if it
 * carries `publishedData` and is neither hidden nor deleted, so withdrawing it
 * means clearing that column *and* building a new snapshot. A status change
 * with no republish would leave the entry looking withdrawn in the dashboard
 * and still visible to every visitor, which is the worst possible version of
 * this feature.
 *
 * ## Why `hidden` is not the same thing, though it looks like it
 *
 * `hidden` is an editorial choice that survives a republish and is meant to be
 * toggled back. Unpublishing clears the published copy: the draft remains and
 * the entry returns to `DRAFT`, so it has to go through review again before it
 * can be live. That is the distinction between "not showing this at the
 * moment" and "this should not be on the site".
 */
export function refuseUnpublish(entry: {
  status: WorkflowState;
  hasPublishedData: boolean;
  deletedAt: Date | null;
}): string | null {
  if (entry.deletedAt) {
    return "Dieser Eintrag ist gelöscht. Stellen Sie ihn zuerst wieder her.";
  }
  if (!entry.hasPublishedData) {
    /*
      The check that matters more than the status.

      An entry can read `PUBLISHED` and carry no published copy — it was
      unpublished once and re-approved, say — and one that reads `DRAFT` can
      still be live, because the snapshot keeps serving what was published
      until the next publish replaces it. `publishedData` is the fact; the
      status is the workflow's opinion about it.
    */
    return "Dieser Eintrag ist nicht veröffentlicht. Es gibt nichts zurückzuziehen.";
  }
  return refuseTransition(entry.status, WorkflowState.DRAFT);
}

/* ================================================================== */
/* Scheduling                                                          */
/* ================================================================== */

/**
 * The floor on how soon a publication may be scheduled.
 *
 * The cron ticks every five minutes, so anything nearer than that would be
 * "publish now" wearing a timestamp — and would look, to whoever set it, like
 * a schedule that fired late. Naming the number here rather than in the
 * service is what lets the test assert the boundary rather than a behaviour
 * near it.
 */
export const MIN_SCHEDULE_LEAD_MS = 5 * 60_000;

/** A year. Beyond this a date is a typo far more often than an intention. */
export const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 3_600_000;

/**
 * Why this entry may not be scheduled for `at`, or `null`.
 *
 * ---
 *
 * ## Only `APPROVED`, and that is the approval boundary
 *
 * Scheduling is a *delay on publication*, not a way around review. An entry
 * scheduled while still in draft would either publish unreviewed at 02:00 or
 * sit waiting for an approval nobody knows is needed — and the cron already
 * refuses to publish anything that is not `APPROVED`, so the second is what
 * would actually happen: a schedule that silently never fires.
 *
 * Requiring `APPROVED` up front makes the refusal immediate and legible
 * instead of a date that passes with nothing happening.
 */
export function refuseSchedule(
  entry: { status: WorkflowState; deletedAt: Date | null; scheduledAt: Date | null },
  at: Date,
  now: Date,
): string | null {
  if (entry.deletedAt) return "Ein gelöschter Eintrag kann nicht terminiert werden.";

  if (entry.status !== WorkflowState.APPROVED) {
    return (
      `Nur freigegebene Einträge lassen sich terminieren — dieser steht auf „${entry.status}“. ` +
      "Eine Terminierung verschiebt die Veröffentlichung; sie ersetzt die Freigabe nicht."
    );
  }

  if (Number.isNaN(at.getTime())) return "Das ist kein gültiger Zeitpunkt.";

  const lead = at.getTime() - now.getTime();
  if (lead < MIN_SCHEDULE_LEAD_MS) {
    return (
      "Der Zeitpunkt muss mindestens fünf Minuten in der Zukunft liegen — " +
      "die Zeitsteuerung prüft alle fünf Minuten. Für sofort verwenden Sie „Veröffentlichen“."
    );
  }
  if (lead > MAX_SCHEDULE_AHEAD_MS) {
    return "Der Zeitpunkt liegt mehr als ein Jahr in der Zukunft. Ist das Datum richtig?";
  }
  return null;
}

/**
 * Why this entry's schedule may not be cancelled, or `null`.
 *
 * Idempotency is *not* granted here: cancelling a schedule that does not exist
 * is refused rather than silently succeeding, because the two readings of a
 * quiet success are "I cancelled it" and "it had already fired", and those are
 * very different facts to be wrong about.
 */
export function refuseCancelSchedule(entry: { scheduledAt: Date | null }): string | null {
  return entry.scheduledAt
    ? null
    : "Für diesen Eintrag ist keine Veröffentlichung terminiert.";
}

/* ================================================================== */
/* Publishing                                                          */
/* ================================================================== */

/**
 * Why a stale editor may not publish, or `null`.
 *
 * ---
 *
 * ## The lost-update this closes
 *
 * Editor A opens an entry at version 8. Editor B saves, taking it to 9. A then
 * approves and publishes. Without this check A publishes **B's text under A's
 * review** — the content that goes live was never the content anybody
 * approved, and nothing in the audit log would say so.
 *
 * The same argument `ProjectsRepository.updateIfUnchanged` makes, and the
 * reason `expectedVersion` is required rather than optional there: a lock a
 * caller may omit is one every caller omits exactly once, and the failure is
 * silent.
 *
 * `expected === null` means the caller did not claim to know, which is the
 * publish-everything case the site-wide button uses — it publishes what is
 * approved, whatever version that is, and the approval is the control.
 */
export function refuseStalePublish(current: number, expected: number | null): string | null {
  if (expected === null) return null;
  if (current === expected) return null;
  return (
    `Dieser Eintrag wurde inzwischen geändert (Version ${current}, Sie haben ${expected} geöffnet). ` +
    "Laden Sie ihn neu und prüfen Sie, was jetzt veröffentlicht würde."
  );
}

/**
 * What the next publish would do to one entry, as a word.
 *
 * Used by the publishing centre so a row says *why* it is listed rather than
 * only that it is. Derived from the two facts that decide it — the workflow
 * status and whether a published copy exists — rather than stored, because a
 * stored answer would be a third fact free to disagree with the other two.
 */
export type PublishEffect = "PUBLISH" | "REPUBLISH" | "WITHDRAW" | "NONE";

export function publishEffect(entry: {
  status: WorkflowState;
  hasPublishedData: boolean;
  hidden: boolean;
  deletedAt: Date | null;
}): PublishEffect {
  // A deletion never becomes APPROVED and never enters review — the trap
  // CLAUDE.md records about counting approved rows. What it *does* do is
  // disappear from the next document, which is a withdrawal.
  if (entry.deletedAt) return entry.hasPublishedData ? "WITHDRAW" : "NONE";
  if (entry.hidden) return entry.hasPublishedData ? "WITHDRAW" : "NONE";
  if (entry.status === WorkflowState.APPROVED) {
    return entry.hasPublishedData ? "REPUBLISH" : "PUBLISH";
  }
  return "NONE";
}

/* ================================================================== */
/* Ordering                                                            */
/* ================================================================== */

/**
 * Whether a reorder request may be applied.
 *
 * `reorder` numbers the ids it is sent from zero, so the request has to be
 * **the whole collection, once each**. Before this rule it was applied as
 * sent: one page of a longer list gave page two the same positions as page
 * one, an id from another content type was quietly renumbered into this one,
 * and a deleted entry took a slot a live one then shared. None of it failed —
 * the list simply came back in an order nobody chose. The dashboard now asks
 * for the whole collection before it offers the control (UX-01); this is the
 * half that does not depend on the client being right.
 *
 * `live` is every non-deleted entry of the type, in any order.
 */
export function refuseReorder(ids: readonly string[], live: readonly string[]): string | null {
  if (ids.length === 0) return "Die Reihenfolge ist leer.";
  if (new Set(ids).size !== ids.length) {
    return "Ein Eintrag kommt in der Reihenfolge mehrfach vor.";
  }
  const known = new Set(live);
  const foreign = ids.filter((id) => !known.has(id)).length;
  if (foreign > 0) {
    return foreign === 1
      ? "Ein Eintrag gehört nicht zu diesem Bereich oder ist gelöscht."
      : `${foreign} Einträge gehören nicht zu diesem Bereich oder sind gelöscht.`;
  }
  const missing = live.length - ids.length;
  if (missing > 0) {
    return missing === 1
      ? "Ein Eintrag fehlt in der Reihenfolge — sie muss den ganzen Bereich umfassen. Bitte die Liste neu laden."
      : `${missing} Einträge fehlen in der Reihenfolge — sie muss den ganzen Bereich umfassen. Bitte die Liste neu laden.`;
  }
  return null;
}