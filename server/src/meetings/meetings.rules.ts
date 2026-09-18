import { DecisionStatus, MeetingItemKind, MeetingStatus } from "@prisma/client";

/**
 * What a meeting and a decision are allowed to do.
 *
 * **Pure.** No Prisma client, no Nest injection, nothing async — the rule
 * `projects.rules.ts` set and `tasks.rules.ts` kept. Everything here is
 * reachable from a test with a constructed object, which matters more in this
 * module than in either of the others: the two rules that protect the record
 * from becoming useless — a protocol cannot be edited after it is approved, and
 * a reversal must name its successor — are exactly the kind that get quietly
 * relaxed under pressure if they live inside a service.
 */

/* ================================================================== */
/* The meeting                                                         */
/* ================================================================== */

/**
 * `PLANNED → HELD`, and `CANCELLED` from either.
 *
 * **`HELD → PLANNED` is absent, and it is the important absence.** A meeting
 * that has happened has happened; moving it back would let somebody reopen a
 * protocol by changing a status, which is the whole thing `refuseProtocolEdit`
 * below exists to prevent. If a meeting was marked held by mistake, the answer
 * is to cancel it and create the real one — which leaves both facts on the
 * record, as it should.
 *
 * `CANCELLED` is terminal for the same reason: an uncancelled meeting is a new
 * meeting.
 */
export const MEETING_TRANSITIONS: Readonly<Record<MeetingStatus, readonly MeetingStatus[]>> = {
  PLANNED: ["HELD", "CANCELLED"],
  HELD: ["CANCELLED"],
  CANCELLED: [],
};

export function transitionsFrom(status: MeetingStatus): readonly MeetingStatus[] {
  return MEETING_TRANSITIONS[status];
}

export type HoldInput = {
  /** The protocol lines. A meeting may be held with none — see below. */
  items: readonly { kind: MeetingItemKind; text: string }[];
  attendees: readonly { attended: boolean | null }[];
};

/**
 * Why a transition is refused, or `null` if it is allowed.
 *
 * German, and returned rather than thrown, for the reason the other two rules
 * files give: the same function backs a disabled button's tooltip, and a rule
 * that can only express itself as an exception cannot explain itself before the
 * user presses the button.
 */
export function refuseTransition(
  from: MeetingStatus,
  to: MeetingStatus,
  input: HoldInput,
): string | null {
  if (from === to) return null;

  if (!MEETING_TRANSITIONS[from].includes(to)) {
    const allowed = MEETING_TRANSITIONS[from];
    if (!allowed.length) return "Eine abgesagte Sitzung kann nicht mehr geändert werden.";
    return `Eine Sitzung im Status ${from} kann nur nach ${allowed.join(" oder ")} wechseln.`;
  }

  if (to !== MeetingStatus.HELD) return null;

  /**
   * **A meeting may be held with an empty protocol, and that is deliberate.**
   *
   * Minutes are written in the days *after* a Bausitzung, not during it, and
   * refusing to mark a meeting held until its protocol exists would mean the
   * status lies for a week — or, worse, that somebody types three placeholder
   * lines to get past the check. The status says the meeting happened; the
   * items say what was said, and an empty protocol on a held meeting is
   * visible and true.
   *
   * What *is* refused is a line with no text, because a blank protocol row is
   * not a fact about anything.
   */
  const blank = input.items.filter((item) => !item.text.trim()).length;
  if (blank) return `${blank} Protokollzeile(n) haben keinen Text.`;

  /*
    And an attendance list nobody filled in.

    "Wer war da" is the second question a protocol answers and the one that is
    never reconstructable afterwards. `null` means not recorded; `false` means
    invited and absent, which is a recorded fact.
  */
  if (input.attendees.length && input.attendees.every((a) => a.attended === null)) {
    return "Für keine eingeladene Person ist die Anwesenheit erfasst.";
  }

  return null;
}

/**
 * Whether the protocol is closed to editing.
 *
 * **The rule that makes minutes worth keeping.** Once they are approved, they
 * are the record: a protocol that can still be edited afterwards is a document
 * whose contents at the time of approval are unknowable, which is precisely the
 * property a dispute needs it to have.
 *
 * The way to change an approved protocol is to approve an **amendment** at the
 * next meeting — `MeetingApproval` with `AMENDED` and a note — which leaves
 * both the original and the correction on the record.
 */
export function refuseProtocolEdit(input: {
  status: MeetingStatus;
  approvals: readonly { decision: string }[];
}): string | null {
  if (input.status === MeetingStatus.CANCELLED) {
    return "Eine abgesagte Sitzung ist schreibgeschützt.";
  }
  if (input.approvals.length) {
    return (
      "Dieses Protokoll ist genehmigt und damit der Stand. " +
      "Eine Korrektur wird als Änderung an der nächsten Sitzung genehmigt."
    );
  }
  return null;
}

/**
 * The display key a line is cited by — `14.3`.
 *
 * Derived from the meeting's series number and the line's order, never stored:
 * a stored key goes wrong the first time a line is inserted, and it is wrong
 * silently, in a document somebody quotes.
 *
 * A meeting with no series number — a Kickoff, an Abnahme — has no such key,
 * and its lines are cited by position alone.
 */
export function itemKey(seriesNumber: number | null, order: number): string {
  return seriesNumber === null ? String(order) : `${seriesNumber}.${order}`;
}

/**
 * The next series number for a meeting type on a project.
 *
 * From the **maximum** already issued, not from a count — the same rule
 * `nextSequence` states for project numbers, and for the same reason: a
 * cancelled Bausitzung still consumed its number. It was called Bausitzung 12
 * in an e-mail, and reissuing 12 would make two meetings answer to one name.
 */
export function nextSeriesNumber(existing: readonly (number | null)[]): number {
  let max = 0;
  for (const n of existing) {
    if (typeof n === "number" && n > max) max = n;
  }
  return max + 1;
}

/* ================================================================== */
/* The protocol                                                        */
/* ================================================================== */

/**
 * What a line of each kind requires.
 *
 * The three kinds are not interchangeable and this is where that stops being a
 * comment: a `PENDENZ` without somebody to do it is a line that reads like work
 * and is not, and an `ENTSCHEID` is what the `Decision` table exists for.
 */
export function refuseItem(input: {
  kind: MeetingItemKind;
  text: string;
  responsibleId: string | null;
  dueDate: Date | null;
  decisionId: string | null;
}): string | null {
  if (!input.text.trim()) return "Eine Protokollzeile braucht einen Text.";

  if (input.kind === MeetingItemKind.PENDENZ) {
    /*
      A Pendenz needs an owner and a date.

      This is the one rule in the module that people will want relaxed, and it
      is the one worth keeping: "wird noch angeschaut" with nobody's name
      against it is the line that is still open at Bausitzung 20. The task the
      Pendenz becomes needs both anyway.
    */
    if (!input.responsibleId) return "Eine Pendenz braucht eine zuständige Person.";
    if (!input.dueDate) return "Eine Pendenz braucht einen Termin.";
  }

  if (input.kind === MeetingItemKind.ENTSCHEID && !input.decisionId) {
    return "Ein Entscheid wird als Entscheid erfasst, nicht als Text — bitte einen Entscheid anlegen.";
  }

  if (input.kind !== MeetingItemKind.ENTSCHEID && input.decisionId) {
    return "Nur eine Zeile vom Typ Entscheid kann mit einem Entscheid verknüpft sein.";
  }

  return null;
}

/** An amendment nobody described is an amendment nobody can act on. */
export function refuseApproval(decision: string, note: string | null): string | null {
  if (decision === "AMENDED" && !note?.trim()) {
    return "Eine Genehmigung mit Änderung braucht eine Beschreibung der Änderung.";
  }
  return null;
}

/**
 * Whether these minutes may be approved at all.
 *
 * Only a **held** meeting has minutes to approve, and **one protocol has one
 * approval** — of either kind.
 *
 * The second half was wrong in the first version of this file, which refused a
 * repeat `APPROVED` and allowed an `APPROVED` after an `AMENDED`. That
 * contradicted `refuseProtocolEdit` one screen away, which closes the protocol
 * on *any* approval: the minutes would have been locked and then approvable
 * again, and which of the two rows was "the" approval would have been a
 * question about row order. An amendment is not a step before the approval —
 * it **is** the approval, of a record that was corrected in the saying.
 *
 * Found by an e2e assertion, because both halves are individually plausible and
 * only their combination is wrong.
 */
export function refuseApprovalTiming(input: {
  status: MeetingStatus;
  approvals: readonly { decision: string }[];
}): string | null {
  if (input.status !== MeetingStatus.HELD) {
    return "Nur das Protokoll einer durchgeführten Sitzung kann genehmigt werden.";
  }
  const existing = input.approvals[0];
  if (existing) {
    // Named, because "already approved" on a protocol whose page shows an
    // amendment reads as a different record.
    return existing.decision === "AMENDED"
      ? "Dieses Protokoll wurde bereits mit Änderung genehmigt."
      : "Dieses Protokoll ist bereits genehmigt.";
  }
  return null;
}

/* ================================================================== */
/* Decisions                                                           */
/* ================================================================== */

/**
 * `E-2026-017` — the number an Entscheid is quoted by.
 *
 * Per project and per year, like a project number, because that is how the firm
 * already writes them and because a number that restarts per project makes two
 * decisions on two projects share a name.
 */
export function formatDecisionNumber(year: number, sequence: number): string {
  return `E-${year}-${String(sequence).padStart(3, "0")}`;
}

/** The next sequence for a year, from the numbers already issued. */
export function nextDecisionSequence(existing: readonly string[], year: number): number {
  const prefix = `E-${year}-`;
  let max = 0;
  for (const number of existing) {
    if (!number.startsWith(prefix)) continue;
    const n = Number(number.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * `OFFEN → ENTSCHIEDEN → UMGESETZT`, and `AUFGEHOBEN` from the two settled
 * states.
 *
 * **`AUFGEHOBEN` is never set directly**, which is why it appears here as a
 * target and is refused by `refuseDecisionStatus` below: a reversal is
 * performed by the decision that replaces it, through `supersede`. A status
 * anybody could type would make "aufgehoben" a claim rather than a fact with a
 * successor attached.
 */
export const DECISION_TRANSITIONS: Readonly<Record<DecisionStatus, readonly DecisionStatus[]>> = {
  OFFEN: ["ENTSCHIEDEN", "AUFGEHOBEN"],
  ENTSCHIEDEN: ["UMGESETZT", "OFFEN", "AUFGEHOBEN"],
  UMGESETZT: ["AUFGEHOBEN"],
  AUFGEHOBEN: [],
};

export function refuseDecisionStatus(
  from: DecisionStatus,
  to: DecisionStatus,
  bySupersede = false,
): string | null {
  if (from === to) return null;

  if (to === DecisionStatus.AUFGEHOBEN && !bySupersede) {
    return (
      "Ein Entscheid wird nicht direkt aufgehoben, sondern durch den Entscheid ersetzt, " +
      "der an seine Stelle tritt."
    );
  }

  if (!DECISION_TRANSITIONS[from].includes(to)) {
    const allowed = DECISION_TRANSITIONS[from];
    if (!allowed.length) return "Ein aufgehobener Entscheid kann nicht mehr geändert werden.";
    return `Ein Entscheid im Status ${from} kann nur nach ${allowed.join(", ")} wechseln.`;
  }
  return null;
}

/**
 * Why a decision cannot be recorded, or `null`.
 *
 * `rationale` is required by the schema *and* here, because the schema can only
 * refuse an empty string and the thing worth refusing is a rationale that says
 * nothing. Twenty characters is not a quality bar — it is the difference
 * between a sentence and "ok".
 */
export function refuseDecision(input: {
  title: string;
  rationale: string;
  impact: string;
  costImpact: number | null;
}): string | null {
  if (input.title.trim().length < 3) return "Ein Entscheid braucht einen Titel.";

  const rationale = input.rationale.trim();
  if (!rationale) {
    return "Ein Entscheid ohne Begründung ist in zwei Jahren nicht mehr nachvollziehbar.";
  }
  if (rationale.length < 20) {
    return "Die Begründung ist zu kurz — ein Satz, der erklärt, warum so entschieden wurde.";
  }

  /*
    A negative cost impact is legitimate and is not an error: a decision that
    saves money is a decision with a cost impact. What is refused is a figure
    on a decision that claims to have no cost impact, because one of the two is
    then wrong and neither can be trusted.
  */
  if (input.impact === "KEINE" && input.costImpact !== null && input.costImpact !== 0) {
    return "Ein Entscheid ohne Auswirkung kann keine Kostenfolge haben.";
  }

  return null;
}

/**
 * Whether superseding would close a loop.
 *
 * A → B → C → A means three decisions each claiming to replace the next, and
 * none of them can be read as current. The database cannot see it; the walk is
 * upward through `supersedesId`, and it counts its own steps so an already
 * cyclic table produces a refusal rather than a request that never returns.
 */
export function wouldSupersedeCycle(
  supersedes: ReadonlyMap<string, string | null>,
  newId: string,
  targetId: string,
): boolean {
  if (newId === targetId) return true;

  let current: string | null = targetId;
  let steps = 0;
  while (current && steps < supersedes.size + 1) {
    if (current === newId) return true;
    current = supersedes.get(current) ?? null;
    steps += 1;
  }
  return false;
}

/**
 * Why one decision may not supersede another.
 *
 * The cross-project rule is the one that matters: a decision on Guglera cannot
 * reverse one on Aarefeld, and allowing it would make a project's decision
 * history depend on a record nobody looking at that project can see.
 */
export function refuseSupersede(input: {
  newProjectId: string;
  targetProjectId: string;
  targetStatus: DecisionStatus;
}): string | null {
  if (input.newProjectId !== input.targetProjectId) {
    return "Ein Entscheid kann nur einen Entscheid desselben Projekts ersetzen.";
  }
  if (input.targetStatus === DecisionStatus.AUFGEHOBEN) {
    return "Dieser Entscheid ist bereits aufgehoben.";
  }
  return null;
}

/* ================================================================== */
/* Dates                                                               */
/* ================================================================== */

/** `endsAt` after `startsAt` — the one date rule the schema cannot hold. */
export function refuseTimes(startsAt: Date, endsAt: Date | null): string | null {
  if (!endsAt) return null;
  return endsAt.getTime() > startsAt.getTime()
    ? null
    : "Das Ende der Sitzung muss nach dem Beginn liegen.";
}

/**
 * A decision may predate its minutes, and that is not an error.
 *
 * `docs/data-model.md` §3.11: "a decision on site is still a decision". What is
 * refused is a decision dated *after* the meeting that recorded it, which is
 * either a typo or a claim that the meeting decided something it had not yet
 * heard.
 */
export function refuseDecisionDate(decidedAt: Date, meetingStartsAt: Date | null): string | null {
  if (!meetingStartsAt) return null;
  // The whole day of the meeting, not the minute: minutes are written up
  // afterwards and a decision recorded at 17:00 for a 14:00 Bausitzung is
  // normal.
  const endOfDay = new Date(meetingStartsAt);
  endOfDay.setHours(23, 59, 59, 999);
  return decidedAt.getTime() <= endOfDay.getTime()
    ? null
    : "Ein Entscheid kann nicht nach der Sitzung datiert sein, die ihn festhält.";
}
