import { useCallback } from "react";
import { invalidate, useQuery, type Paginated } from "@/core/api";
import type {
  AgendaDraft,
  ApprovalDraft,
  AttendanceEntry,
  AttendeeDraft,
  Decision,
  DecisionDetail,
  DecisionDraft,
  DecisionEdit,
  DecisionStats,
  DecisionStatusChange,
  ItemDraft,
  ItemEdit,
  Meeting,
  MeetingDetail,
  MeetingDraft,
  MeetingEdit,
  MeetingStats,
  MeetingStatusChange,
  ProtocolLine,
} from "@/entities/meeting";
import {
  toAgendaBody,
  toAgendaUpdateBody,
  toApprovalBody,
  toAttendanceBody,
  toAttendeeBody,
  toCreateDecisionBody,
  toCreateMeetingBody,
  toDecisionDetail,
  toDecisionPage,
  toDecisionStatusBody,
  toDecisionStats,
  toItemBody,
  toItemUpdateBody,
  toMeetingDetail,
  toMeetingPage,
  toMeetingStats,
  toMeetingStatusBody,
  toProtocolPage,
  toUpdateDecisionBody,
  toUpdateMeetingBody,
  toVersion,
  type Version,
} from "../mapper";
import {
  meetingRepository,
  type DecisionQuery,
  type MeetingQuery,
  type ProtocolQuery,
} from "../repository";

/**
 * React only. Cache keys, loading state, invalidation.
 *
 * Every function here is `repository → mapper → cache`. Nothing below this file
 * knows about React, and nothing above it has seen a DTO.
 */

/**
 * **One prefix for both resources**, and that is the important decision in this
 * file.
 *
 * A decision is created *from* a protocol line and a protocol line shows its
 * decision's status, so a write to either can change what the other renders.
 * Two prefixes would mean every mutation had to guess which of them to
 * invalidate — and the guess would be wrong exactly when a decision was
 * superseded from a meeting screen, which is the case somebody is watching.
 */
const KEY = "meetings";

function listKey(query: MeetingQuery): (string | number)[] {
  return [
    KEY,
    "list",
    query.search ?? "",
    query.minutesPending ? "pending" : (query.statuses ?? []).join(",") || (query.status ?? ""),
    query.type ?? "",
    query.projectId ?? "",
    query.project ?? "",
    query.organiserId ?? "",
    query.seriesNumber ?? "",
    `${query.sort?.field ?? ""}:${query.sort?.dir ?? ""}`,
    query.page ?? 1,
    query.perPage ?? 25,
  ];
}

export function useMeetingList(query: MeetingQuery) {
  return useQuery<Paginated<Meeting>>(listKey(query), () =>
    meetingRepository.list(query).then(toMeetingPage),
  );
}

export function useMeetingStats(enabled = true) {
  return useQuery<MeetingStats>(enabled ? [KEY, "stats"] : null, () =>
    meetingRepository.stats().then(toMeetingStats),
  );
}

/**
 * The rail's badge: how many protocols are waiting to go out.
 *
 * Not how many meetings exist, and not how many are planned. "Wie viele
 * Protokolle muss ich noch versenden" is the one number on this module somebody
 * acts on, and a badge that is always lit is one people stop seeing.
 */
export function usePendingMinutesCount(enabled: boolean): number | undefined {
  return useMeetingStats(enabled).data?.minutesPending;
}

/** `null` disables the query — a detail route with no id fetches nothing. */
export function useMeeting(id: string | null) {
  return useQuery<MeetingDetail>(id ? [KEY, "detail", id] : null, () =>
    meetingRepository.get(id!).then(toMeetingDetail),
  );
}

/**
 * Protocol lines across every meeting.
 *
 * *"Alle offenen Pendenzen für Lüftung über alle Bausitzungen"* — its own hook
 * because it is its own screen, and its own cache entry because it changes when
 * *any* meeting's protocol does, which the shared prefix already handles.
 */
export function useProtocolLines(query: ProtocolQuery) {
  return useQuery<Paginated<ProtocolLine>>(
    [
      KEY,
      "protocol",
      query.search ?? "",
      query.kind ?? "",
      query.disciplineId ?? "",
      query.discipline ?? "",
      query.responsibleId ?? "",
      query.hasTask === undefined ? "" : String(query.hasTask),
      query.dueBefore ?? "",
      `${query.sort?.field ?? ""}:${query.sort?.dir ?? ""}`,
      query.page ?? 1,
      query.perPage ?? 25,
    ],
    () => meetingRepository.protocolLines(query).then(toProtocolPage),
  );
}

export function useMeetingHistory(id: string | null) {
  return useQuery<Version[]>(id ? [KEY, "versions", id] : null, () =>
    meetingRepository.history(id!).then((rows) => rows.map(toVersion)),
  );
}

/* ---- Decisions ------------------------------------------------------ */

export function useDecisionList(query: DecisionQuery) {
  return useQuery<Paginated<Decision>>(
    [
      KEY,
      "decisions",
      query.search ?? "",
      (query.statuses ?? []).join(",") || (query.status ?? ""),
      query.type ?? "",
      query.impact ?? "",
      query.projectId ?? "",
      query.project ?? "",
      query.meetingId ?? "",
      query.disciplineId ?? "",
      query.discipline ?? "",
      query.isReversal === undefined ? "" : String(query.isReversal),
      `${query.sort?.field ?? ""}:${query.sort?.dir ?? ""}`,
      query.page ?? 1,
      query.perPage ?? 25,
    ],
    () => meetingRepository.listDecisions(query).then(toDecisionPage),
  );
}

export function useDecisionStats(enabled = true) {
  return useQuery<DecisionStats>(enabled ? [KEY, "decisionStats"] : null, () =>
    meetingRepository.decisionStats().then(toDecisionStats),
  );
}

export function useDecision(id: string | null) {
  return useQuery<DecisionDetail>(id ? [KEY, "decision", id] : null, () =>
    meetingRepository.getDecision(id!).then(toDecisionDetail),
  );
}

export function useDecisionHistory(id: string | null) {
  return useQuery<Version[]>(id ? [KEY, "decisionVersions", id] : null, () =>
    meetingRepository.decisionHistory(id!).then((rows) => rows.map(toVersion)),
  );
}

/* ---- The writes ----------------------------------------------------- */

export type MeetingMutations = {
  create: (draft: MeetingDraft) => Promise<MeetingDetail>;
  update: (id: string, edit: MeetingEdit) => Promise<MeetingDetail>;
  changeStatus: (id: string, change: MeetingStatusChange) => Promise<MeetingDetail>;
  remove: (id: string) => Promise<void>;
  exportCsv: (query: MeetingQuery) => Promise<void>;
  addAttendee: (id: string, draft: AttendeeDraft) => Promise<MeetingDetail>;
  removeAttendee: (id: string, attendeeId: string) => Promise<MeetingDetail>;
  recordAttendance: (id: string, entries: AttendanceEntry[]) => Promise<MeetingDetail>;
  addAgendaItem: (id: string, draft: AgendaDraft) => Promise<MeetingDetail>;
  updateAgendaItem: (id: string, itemId: string, edit: Partial<AgendaDraft>) => Promise<MeetingDetail>;
  removeAgendaItem: (id: string, itemId: string) => Promise<MeetingDetail>;
  addItem: (id: string, draft: ItemDraft) => Promise<MeetingDetail>;
  updateItem: (id: string, itemId: string, edit: ItemEdit) => Promise<MeetingDetail>;
  removeItem: (id: string, itemId: string) => Promise<MeetingDetail>;
  reorderItems: (id: string, order: string[]) => Promise<MeetingDetail>;
  bulkDiscipline: (ids: string[], disciplineId: string | null) => Promise<number>;
  approve: (id: string, draft: ApprovalDraft) => Promise<MeetingDetail>;
  sendMinutes: (id: string) => Promise<MeetingDetail>;
  createDecision: (draft: DecisionDraft) => Promise<DecisionDetail>;
  updateDecision: (id: string, edit: DecisionEdit) => Promise<DecisionDetail>;
  changeDecisionStatus: (id: string, change: DecisionStatusChange) => Promise<DecisionDetail>;
  supersede: (id: string, supersedesId: string) => Promise<DecisionDetail>;
  removeDecision: (id: string) => Promise<void>;
  exportDecisionsCsv: (query: DecisionQuery) => Promise<void>;
};

/**
 * The writes.
 *
 * Each invalidates the whole feature rather than the key it touched, and here
 * that is not caution but correctness: **adding a Pendenz creates a task in
 * another module**, approving a protocol closes it, and superseding a decision
 * changes the status shown on a protocol line in a meeting nobody has open. The
 * set of affected entries is not knowable from the mutation.
 *
 * `invalidate("tasks")` on the two writes that touch tasks, because that
 * prefix belongs to another feature's cache and the shared one cannot reach it.
 * It is a cache key rather than an import, which is the difference between
 * knowing a string and knowing a module.
 *
 * Errors are **not** swallowed. The screen wraps the call in `useMutation`,
 * which turns an `ApiError`'s per-field messages into messages beside the
 * inputs — and the 403 an approved protocol raises is the one a screen most
 * needs to show.
 */
export function useMeetingMutations(): MeetingMutations {
  const create = useCallback(async (draft: MeetingDraft) => {
    const dto = await meetingRepository.create(toCreateMeetingBody(draft));
    invalidate(KEY);
    return toMeetingDetail(dto);
  }, []);

  const update = useCallback(async (id: string, edit: MeetingEdit) => {
    const dto = await meetingRepository.update(id, toUpdateMeetingBody(edit));
    invalidate(KEY);
    return toMeetingDetail(dto);
  }, []);

  const changeStatus = useCallback(async (id: string, change: MeetingStatusChange) => {
    const dto = await meetingRepository.changeStatus(id, toMeetingStatusBody(change));
    invalidate(KEY);
    return toMeetingDetail(dto);
  }, []);

  const remove = useCallback(async (id: string) => {
    await meetingRepository.remove(id);
    invalidate(KEY);
  }, []);

  const exportCsv = useCallback((query: MeetingQuery) => meetingRepository.exportCsv(query), []);

  const addAttendee = useCallback(async (id: string, draft: AttendeeDraft) => {
    const dto = await meetingRepository.addAttendee(id, toAttendeeBody(draft));
    invalidate(KEY);
    return toMeetingDetail(dto);
  }, []);

  const removeAttendee = useCallback(async (id: string, attendeeId: string) => {
    const dto = await meetingRepository.removeAttendee(id, attendeeId);
    invalidate(KEY);
    return toMeetingDetail(dto);
  }, []);

  const recordAttendance = useCallback(async (id: string, entries: AttendanceEntry[]) => {
    const dto = await meetingRepository.recordAttendance(id, toAttendanceBody(entries));
    invalidate(KEY);
    return toMeetingDetail(dto);
  }, []);

  const addAgendaItem = useCallback(async (id: string, draft: AgendaDraft) => {
    const dto = await meetingRepository.addAgendaItem(id, toAgendaBody(draft));
    invalidate(KEY);
    return toMeetingDetail(dto);
  }, []);

  const updateAgendaItem = useCallback(
    async (id: string, itemId: string, edit: Partial<AgendaDraft>) => {
      const dto = await meetingRepository.updateAgendaItem(id, itemId, toAgendaUpdateBody(edit));
      invalidate(KEY);
      return toMeetingDetail(dto);
    },
    [],
  );

  const removeAgendaItem = useCallback(async (id: string, itemId: string) => {
    const dto = await meetingRepository.removeAgendaItem(id, itemId);
    invalidate(KEY);
    return toMeetingDetail(dto);
  }, []);

  const addItem = useCallback(async (id: string, draft: ItemDraft) => {
    const dto = await meetingRepository.addItem(id, toItemBody(draft));
    invalidate(KEY);
    // A Pendenz just created a task in another module's cache.
    if (draft.kind === "PENDENZ") invalidate("tasks");
    return toMeetingDetail(dto);
  }, []);

  const updateItem = useCallback(async (id: string, itemId: string, edit: ItemEdit) => {
    const dto = await meetingRepository.updateItem(id, itemId, toItemUpdateBody(edit));
    invalidate(KEY);
    return toMeetingDetail(dto);
  }, []);

  const removeItem = useCallback(async (id: string, itemId: string) => {
    const dto = await meetingRepository.removeItem(id, itemId);
    invalidate(KEY);
    // The task survives the line — see the server's `removeItem` — but its
    // link does not, so a task screen showing "aus Bausitzung 14" is stale.
    invalidate("tasks");
    return toMeetingDetail(dto);
  }, []);

  const reorderItems = useCallback(async (id: string, order: string[]) => {
    const dto = await meetingRepository.reorderItems(id, { order });
    invalidate(KEY);
    return toMeetingDetail(dto);
  }, []);

  const bulkDiscipline = useCallback(async (ids: string[], disciplineId: string | null) => {
    const result = await meetingRepository.bulkDiscipline(ids, disciplineId);
    invalidate(KEY);
    return result.changed;
  }, []);

  const approve = useCallback(async (id: string, draft: ApprovalDraft) => {
    const dto = await meetingRepository.approve(id, toApprovalBody(draft));
    invalidate(KEY);
    return toMeetingDetail(dto);
  }, []);

  const sendMinutes = useCallback(async (id: string) => {
    const dto = await meetingRepository.sendMinutes(id);
    invalidate(KEY);
    return toMeetingDetail(dto);
  }, []);

  const createDecision = useCallback(async (draft: DecisionDraft) => {
    const dto = await meetingRepository.createDecision(toCreateDecisionBody(draft));
    invalidate(KEY);
    return toDecisionDetail(dto);
  }, []);

  const updateDecision = useCallback(async (id: string, edit: DecisionEdit) => {
    const dto = await meetingRepository.updateDecision(id, toUpdateDecisionBody(edit));
    invalidate(KEY);
    return toDecisionDetail(dto);
  }, []);

  const changeDecisionStatus = useCallback(async (id: string, change: DecisionStatusChange) => {
    const dto = await meetingRepository.changeDecisionStatus(id, toDecisionStatusBody(change));
    invalidate(KEY);
    return toDecisionDetail(dto);
  }, []);

  const supersede = useCallback(async (id: string, supersedesId: string) => {
    const dto = await meetingRepository.supersede(id, { supersedesId });
    invalidate(KEY);
    return toDecisionDetail(dto);
  }, []);

  const removeDecision = useCallback(async (id: string) => {
    await meetingRepository.removeDecision(id);
    invalidate(KEY);
  }, []);

  const exportDecisionsCsv = useCallback(
    (query: DecisionQuery) => meetingRepository.exportDecisionsCsv(query),
    [],
  );

  return {
    create,
    update,
    changeStatus,
    remove,
    exportCsv,
    addAttendee,
    removeAttendee,
    recordAttendance,
    addAgendaItem,
    updateAgendaItem,
    removeAgendaItem,
    addItem,
    updateItem,
    removeItem,
    reorderItems,
    bulkDiscipline,
    approve,
    sendMinutes,
    createDecision,
    updateDecision,
    changeDecisionStatus,
    supersede,
    removeDecision,
    exportDecisionsCsv,
  };
}
