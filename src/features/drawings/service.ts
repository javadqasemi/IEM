import {
  LIVE_DRAWING_STATUSES,
  type Drawing,
  type DrawingDetail,
  type ListedRevision,
  type PriorIssue,
  type Revision,
  type TransmittalDetail,
  type TransmittalItem,
  type TransmittalRecipient,
} from "@/entities/drawing";

/**
 * Domain only. Pure functions over entity types — no React, no fetch, and
 * therefore testable with no mocks at all.
 *
 * **What is deliberately not here**, and the list is the point:
 *
 * | Not here | Where it is | Why |
 * | --- | --- | --- |
 * | The transition table | `allowedTransitions`, with the record | A second copy goes stale and nothing fails when it does |
 * | Whether a plan may be edited | `readOnly`, with the record | The server owns what the record *is*; a client rule would be a second answer |
 * | The next revision letter | the server | `I` and `O` are skipped, and a second implementation is one that disagrees the day somebody enters a label by hand |
 * | Whether a revision may be sent | the server's `refuseTransmittal` | A screen that pre-refused would drift from the rule that actually decides |
 *
 * What follows is presentation logic the server has no reason to compute and
 * the screens have every reason not to duplicate.
 */

/* ================================================================== */
/* Revisions                                                           */
/* ================================================================== */

/**
 * The revision a reader means when they say "the plan".
 *
 * The newest, which is the first — the server sends them `createdAt desc`. A
 * `find` on `supersededAt === null` would be the obvious alternative and is
 * wrong in one case that matters: a plan whose newest revision has been
 * superseded by nothing yet *and* whose older ones were never marked, which is
 * what a hand-migrated plan set looks like.
 */
export function currentRevision(drawing: Pick<DrawingDetail, "revisions">): Revision | null {
  return drawing.revisions[0] ?? null;
}

/** Everything but the newest — the history, in the order it happened. */
export function priorRevisions(drawing: Pick<DrawingDetail, "revisions">): Revision[] {
  return drawing.revisions.slice(1);
}

/**
 * Whether this revision has been issued to anybody.
 *
 * Derived from the *plan's* status rather than from the revision, because a
 * revision does not know who received it — the transmittal does. `ISSUED` on
 * the plan means its current revision has left the building.
 */
export function isIssued(drawing: Pick<Drawing, "status">): boolean {
  return drawing.status === "ISSUED";
}

/** Still in play — `WIP` through `ISSUED`. Drives the default filter. */
export function isLive(status: Drawing["status"]): boolean {
  return (LIVE_DRAWING_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether the four-eyes rule is satisfied *as the record stands*.
 *
 * A courtesy, not the control — the server refuses a check by whoever drew it,
 * whatever this returns. It is here so a form can say so before the user
 * presses the button rather than after.
 */
export function violatesFourEyes(
  drawing: Pick<DrawingDetail, "drawnById" | "checkedById">,
): boolean {
  return Boolean(
    drawing.drawnById && drawing.checkedById && drawing.drawnById === drawing.checkedById,
  );
}

/**
 * Why a plan cannot be sent, or `null`.
 *
 * **Deliberately a subset of the server's rule**, and the asymmetry is stated
 * rather than hidden: this checks only what a screen already knows — the plan's
 * status and whether the revision is superseded. The server also refuses a
 * revision from another project and re-reads the release stamp, and it is the
 * one that decides.
 *
 * The purpose is to grey out a checkbox with a reason attached, so somebody
 * does not assemble a Planversand of twelve plans and have it refused whole.
 */
export function refuseSelection(
  drawing: Pick<Drawing, "status" | "number">,
  revision: Pick<Revision, "releasedAt" | "supersededAt"> | null,
): string | null {
  if (!revision) return "Noch keine Revision.";
  if (drawing.status === "WITHDRAWN") return "Der Plan ist zurückgezogen.";
  if (revision.supersededAt) return "Diese Revision ist überholt.";
  if (!revision.releasedAt) return "Noch nicht freigegeben.";
  return null;
}

/* ================================================================== */
/* The register                                                        */
/* ================================================================== */

/**
 * Plans grouped by Gewerk, in code order.
 *
 * How a plan set is read and how it is filed. Plans with no Gewerk cannot
 * happen — `disciplineId` is required — but the grouping tolerates one rather
 * than dropping it, because a row that vanishes from a register is worse than
 * a row under a heading nobody expected.
 */
export type DisciplineGroup = {
  code: string;
  name: string;
  colour: string | null;
  drawings: Drawing[];
};

export function groupByDiscipline(drawings: readonly Drawing[]): DisciplineGroup[] {
  const groups = new Map<string, DisciplineGroup>();

  for (const drawing of drawings) {
    const code = drawing.discipline?.code ?? "—";
    const existing = groups.get(code);
    if (existing) {
      existing.drawings.push(drawing);
      continue;
    }
    groups.set(code, {
      code,
      name: drawing.discipline?.name ?? "Ohne Gewerk",
      colour: drawing.discipline?.colour ?? null,
      drawings: [drawing],
    });
  }

  return [...groups.values()].sort((a, b) => a.code.localeCompare(b.code, "de-CH"));
}

/**
 * How many plans are waiting on somebody, out of a page.
 *
 * `IN_CHECK` only. `WIP` is work in progress and nobody is blocked by it;
 * `CHECKED` is waiting on a release, which is a different person's queue and
 * counted separately by the server's `stats`.
 */
export function awaitingCheck(drawings: readonly Drawing[]): Drawing[] {
  return drawings.filter((d) => d.status === "IN_CHECK");
}

/**
 * The plans whose current revision has been superseded since it was issued.
 *
 * *"Wer baut nach einem überholten Plan"* — the question the whole module
 * exists to answer, asked of a list rather than of a Planversand. A plan is in
 * this set when it is `ISSUED` and its newest revision is not the one that went
 * out, which shows as an issued plan with a revision created afterwards.
 */
export function issuedButRevised(drawings: readonly Drawing[]): Drawing[] {
  return drawings.filter((d) => d.status === "ISSUED" && d.counts.revisions > 1);
}

/* ================================================================== */
/* Planversand                                                         */
/* ================================================================== */

/**
 * The recipients split by whether they have confirmed.
 *
 * Two groups and not three, unlike attendance: a Planversand has no "did not
 * receive" — everybody on the list was sent it, and `acknowledgedAt` records
 * only whether they said so. That is the difference between a fact about the
 * past and a fact about a room.
 */
export function splitAcknowledgement(recipients: readonly TransmittalRecipient[]): {
  confirmed: TransmittalRecipient[];
  outstanding: TransmittalRecipient[];
} {
  return {
    confirmed: recipients.filter((r) => r.acknowledgedAt !== null),
    outstanding: recipients.filter((r) => r.acknowledgedAt === null),
  };
}

/**
 * Whether anything in this Planversand has been superseded since it went out.
 *
 * The flag an old transmittal most needs: somebody opening it six months later
 * is asking *"is this still current"*, and the answer is on the items rather
 * than on the record.
 */
export function supersededSince(transmittal: Pick<TransmittalDetail, "items">): TransmittalItem[] {
  return transmittal.items.filter((item) => item.supersededAt !== null);
}

/**
 * The warnings as sentences, grouped by the person who must be told.
 *
 * One line per recipient rather than per plan, because the action is one
 * e-mail. A list of twelve warnings naming the same contractor twelve times is
 * a list somebody stops reading at the third.
 */
export function warningsByRecipient(
  warnings: readonly PriorIssue[],
): { recipient: string; plans: string[] }[] {
  const grouped = new Map<string, string[]>();

  for (const warning of warnings) {
    const line = `${warning.drawingNumber} (hatte Rev. ${warning.previousRevision}, neu ${warning.newRevision})`;
    const existing = grouped.get(warning.recipientLabel);
    if (existing) existing.push(line);
    else grouped.set(warning.recipientLabel, [line]);
  }

  return [...grouped.entries()]
    .map(([recipient, plans]) => ({ recipient, plans }))
    .sort((a, b) => a.recipient.localeCompare(b.recipient, "de-CH"));
}

/**
 * How many sheets a Planversand actually is.
 *
 * Copies summed rather than items counted, because that is what goes in an
 * envelope and what somebody is charged for. An item with no explicit count is
 * one copy — the server defaults it, and this agrees rather than assuming.
 */
export function sheetCount(items: readonly TransmittalItem[]): number {
  return items.reduce((sum, item) => sum + (item.copies || 1), 0);
}

/* ================================================================== */
/* Files                                                               */
/* ================================================================== */

/**
 * A file size a person can read.
 *
 * Binary units with decimal names, which is what every operating system this
 * firm uses shows — 1 KB is 1024 bytes in the Explorer window beside the
 * browser, and matching the number somebody can see beats matching the
 * standard they cannot.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10, none above: `1.4 MB` and `230 KB` both read at a
  // glance, `1.44 MB` and `230.2 KB` do not.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Days since a revision was released — negative is impossible and returns null.
 *
 * Whole days from midnight, not from *now*: "vor 0 Tagen" has to mean today all
 * day. Duplicated from the other features' services rather than shared,
 * deliberately — a `shared/` date helper that four features imported would be
 * the first thread of the utility module `features/README.md` forbids.
 */
export function daysSince(date: Date | null, now: Date = new Date()): number | null {
  if (!date) return null;
  const then = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today - then) / 86_400_000);
  return days < 0 ? null : days;
}

/**
 * The revisions released in the last `days` days, newest first.
 *
 * *"Was ist diese Woche freigegeben worden"* — computed over a page rather than
 * fetched, because the cross-plan revision list already answers it with a
 * filter and this is the same question asked of what is on screen.
 */
export function releasedWithin(
  revisions: readonly ListedRevision[],
  days: number,
  now: Date = new Date(),
): ListedRevision[] {
  return revisions
    .filter((revision) => {
      const since = daysSince(revision.releasedAt, now);
      return since !== null && since <= days;
    })
    .sort((a, b) => (b.releasedAt?.getTime() ?? 0) - (a.releasedAt?.getTime() ?? 0));
}
