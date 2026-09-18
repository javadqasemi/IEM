import {
  LIVE_DECISION_STATUSES,
  type AgendaItem,
  type Attendee,
  type Decision,
  type DecisionDetail,
  type Meeting,
  type MeetingDetail,
  type MeetingItem,
  type MeetingItemKind,
} from "@/entities/meeting";

/**
 * Domain only. Pure functions over entity types — no React, no fetch, and
 * therefore testable with no mocks at all.
 *
 * **What is deliberately not here**, and the list is the point:
 *
 * | Not here | Where it is | Why |
 * | --- | --- | --- |
 * | The transition table | `allowedTransitions`, with the record | A second copy goes stale and nothing fails when it does |
 * | Whether the protocol is closed | `protocolLocked`, with the record | The server owns what the record *is*; a client rule would be a second answer |
 * | `14.3` | `key`, with the line | Assembling it here is the copy that goes wrong when a line is inserted |
 * | The approval rules | the server | A protocol that could be approved twice on one screen and not the other is worse than either |
 *
 * What follows is presentation logic the server has no reason to compute and
 * the screens have every reason not to duplicate.
 */

/* ================================================================== */
/* The protocol                                                        */
/* ================================================================== */

/**
 * The protocol grouped under the agenda it was discussed against.
 *
 * **Both halves matter and the second is the one that gets forgotten.** An
 * agenda item that was never reached has no lines, and half the useful lines
 * belong to no agenda item at all — a Bausitzung produces "und noch etwas" every
 * time. Grouping by `agendaItemId` alone would silently drop those lines from
 * the page they are supposed to be on, and a reader would only notice by
 * counting.
 *
 * The ungrouped lines come last, under their own heading, because that is where
 * they were said.
 */
export type ProtocolGroup = {
  agenda: AgendaItem | null;
  items: MeetingItem[];
};

export function groupProtocol(meeting: Pick<MeetingDetail, "agenda" | "items">): ProtocolGroup[] {
  const byAgenda = new Map<string, MeetingItem[]>();
  const loose: MeetingItem[] = [];

  for (const item of meeting.items) {
    if (!item.agendaItemId) {
      loose.push(item);
      continue;
    }
    const list = byAgenda.get(item.agendaItemId);
    if (list) list.push(item);
    else byAgenda.set(item.agendaItemId, [item]);
  }

  const groups: ProtocolGroup[] = meeting.agenda.map((agenda) => ({
    agenda,
    items: byAgenda.get(agenda.id) ?? [],
  }));

  // A line whose agenda item was deleted is loose rather than lost. The server
  // sets `agendaItemId` to null on delete, so this is belt and braces — and it
  // is the branch that keeps a line visible if it ever is not.
  for (const [id, items] of byAgenda) {
    if (!meeting.agenda.some((a) => a.id === id)) loose.push(...items);
  }

  if (loose.length) {
    groups.push({ agenda: null, items: loose.sort((a, b) => a.order - b.order) });
  }
  return groups;
}

/** Lines of one kind, in protocol order. */
export function itemsOfKind(
  meeting: Pick<MeetingDetail, "items">,
  kind: MeetingItemKind,
): MeetingItem[] {
  return meeting.items.filter((item) => item.kind === kind);
}

/**
 * The Pendenzen that are still open, by the task behind them.
 *
 * A Pendenz with no task is counted as open: the line says somebody owes
 * something, and "no task" means the link was declined rather than that the
 * work is done. Treating it as closed would let a protocol under-report itself
 * by exactly the lines somebody chose not to track.
 */
export function openPendenzen(meeting: Pick<MeetingDetail, "items">): MeetingItem[] {
  return itemsOfKind(meeting, "PENDENZ").filter(
    (item) => !item.task || (item.task.status !== "DONE" && item.task.status !== "CANCELLED"),
  );
}

/* ================================================================== */
/* Attendance                                                          */
/* ================================================================== */

/**
 * The room, split the way a protocol prints it.
 *
 * Present, apologised, absent, and **unrecorded** — four groups rather than
 * three, because `null` is not `false`. A protocol that printed unrecorded
 * people as absent would make a claim nobody checked.
 */
export function splitAttendance(attendees: readonly Attendee[]): {
  present: Attendee[];
  apologised: Attendee[];
  absent: Attendee[];
  unrecorded: Attendee[];
} {
  return {
    present: attendees.filter((a) => a.attended === true),
    apologised: attendees.filter((a) => a.attended !== true && a.apologised),
    absent: attendees.filter((a) => a.attended === false && !a.apologised),
    unrecorded: attendees.filter((a) => a.attended === null && !a.apologised),
  };
}

/** Whether anybody's presence is still unrecorded — the server refuses to hold. */
export function attendanceIncomplete(attendees: readonly Attendee[]): boolean {
  return attendees.length > 0 && attendees.every((a) => a.attended === null);
}

/* ================================================================== */
/* The list                                                            */
/* ================================================================== */

/** Held, minutes not sent. The Friday queue. */
export function minutesPending(meeting: Pick<Meeting, "status" | "minutesSentAt">): boolean {
  return meeting.status === "HELD" && meeting.minutesSentAt === null;
}

/**
 * Days until the meeting — negative once it has passed.
 *
 * Whole days from midnight, not from *now*: "in 0 Tagen" has to mean today all
 * day. Duplicated from the other two features' services rather than shared,
 * deliberately — a `shared/` date helper that three features imported would be
 * the first thread of the utility module `features/README.md` forbids, and it is
 * six lines.
 */
export function daysUntil(date: Date | null, now: Date = new Date()): number | null {
  if (!date) return null;
  const start = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((start - today) / 86_400_000);
}

/**
 * The meeting a reader should look at, out of a list.
 *
 * The next planned one if there is one, otherwise the last one held. Both are
 * questions people ask — "wann ist die nächste" and "was war das letzte Mal" —
 * and a list that highlighted neither would make somebody scan dates.
 */
export function focusMeeting(meetings: readonly Meeting[], now: Date = new Date()): Meeting | null {
  const upcoming = meetings
    .filter((m) => m.status === "PLANNED" && m.startsAt.getTime() >= now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (upcoming[0]) return upcoming[0];

  const past = meetings
    .filter((m) => m.status === "HELD")
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  return past[0] ?? null;
}

/* ================================================================== */
/* Decisions                                                           */
/* ================================================================== */

/** Still standing — everything but a reversal. Drives the default filter. */
export function isLive(status: Decision["status"]): boolean {
  return (LIVE_DECISION_STATUSES as readonly string[]).includes(status);
}

/**
 * Why a decision should be read with care, or `null`.
 *
 * **`AUFGEHOBEN` is the one that matters.** Somebody opening an old decision
 * needs to be told before they act on it, and "Aufgehoben" as a badge is easy
 * to miss in a page of prose. The sentence names the successor, because the
 * next question is always "by what".
 */
export function supersessionNotice(decision: DecisionDetail): string | null {
  if (decision.status === "AUFGEHOBEN") {
    return decision.supersededBy
      ? `Dieser Entscheid wurde aufgehoben und durch ${decision.supersededBy.number} ersetzt.`
      : // Should not happen: the server only reaches this status through
        // `supersede`, which always attaches a successor. Said plainly rather
        // than hidden, because a reversal with no successor is a data problem
        // somebody needs to see.
        "Dieser Entscheid wurde aufgehoben. Der ersetzende Entscheid ist nicht verknüpft.";
  }
  if (decision.supersedes) {
    return `Dieser Entscheid ersetzt ${decision.supersedes.number}.`;
  }
  return null;
}

/**
 * Whether a decision may still be edited on this screen.
 *
 * A courtesy only — the server refuses a write to a reversed decision — and it
 * is here so the form is read-only before the user types rather than after they
 * press save.
 */
export function isReadOnly(decision: Pick<Decision, "status">): boolean {
  return decision.status === "AUFGEHOBEN";
}

/**
 * How much a set of decisions has cost, as a **string**.
 *
 * Summed in integer Rappen and rendered back, so nothing is ever a float:
 * `"48000.00" + "26500.00"` as numbers is `74500.00000000001` often enough to
 * appear in a report. `null` when nothing in the set carries a figure, because
 * a total of zero and "nobody priced any of these" are different answers.
 */
export function totalCost(decisions: readonly Pick<Decision, "costImpact">[]): string | null {
  const figures = decisions.map((d) => d.costImpact).filter((v): v is string => v !== null);
  if (!figures.length) return null;

  const rappen = figures.reduce((sum, value) => {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
    return sum + (negative ? -amount : amount);
  }, 0);

  const negative = rappen < 0;
  const absolute = Math.abs(rappen);
  return `${negative ? "-" : ""}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
