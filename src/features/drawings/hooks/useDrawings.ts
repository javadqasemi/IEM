import { useCallback } from "react";
import { invalidate, useQuery, type Paginated } from "@/core/api";
import type {
  AcknowledgeDraft,
  Drawing,
  DrawingDetail,
  DrawingDraft,
  DrawingEdit,
  DrawingStats,
  DrawingStatusChange,
  ListedRevision,
  Revision,
  RevisionDraft,
  Transmittal,
  TransmittalDetail,
  TransmittalDraft,
  TransmittalResult,
} from "@/entities/drawing";
import {
  toAcknowledgeBody,
  toCreateDrawingBody,
  toCreateRevisionBody,
  toCreateTransmittalBody,
  toDrawingDetail,
  toDrawingPage,
  toDrawingStats,
  toRevision,
  toRevisionPage,
  toStatusBody,
  toTransmittalDetail,
  toTransmittalPage,
  toTransmittalResult,
  toUpdateDrawingBody,
  toVersion,
  type Version,
} from "../mapper";
import {
  drawingRepository,
  type DrawingQuery,
  type RevisionQuery,
  type TransmittalQuery,
} from "../repository";

/**
 * React only. Cache keys, loading state, invalidation.
 *
 * Every function here is `repository → mapper → cache`. Nothing below this file
 * knows about React, and nothing above it has seen a DTO.
 */

/**
 * **One prefix for both resources**, the decision Sitzungen made and this
 * module inherits for a stronger reason.
 *
 * Issuing a Planversand *changes the plans* — they move to `ISSUED` in the same
 * transaction. So a write to `/transmittals` changes what `/drawings` renders,
 * always, not occasionally. Two prefixes would mean every mutation guessing
 * which to invalidate, and the guess would be wrong exactly when somebody has
 * the register open beside the Planversand they just sent.
 */
const KEY = "drawings";

function listKey(query: DrawingQuery): (string | number)[] {
  return [
    KEY,
    "list",
    query.search ?? "",
    query.live ? "live" : (query.statuses ?? []).join(",") || (query.status ?? ""),
    query.type ?? "",
    query.format ?? "",
    query.phase ?? "",
    query.projectId ?? "",
    query.project ?? "",
    query.disciplineId ?? "",
    query.discipline ?? "",
    query.buildingId ?? "",
    query.drawnById ?? "",
    query.checkedById ?? "",
    `${query.sort?.field ?? ""}:${query.sort?.dir ?? ""}`,
    query.page ?? 1,
    query.perPage ?? 25,
  ];
}

export function useDrawingList(query: DrawingQuery) {
  return useQuery<Paginated<Drawing>>(listKey(query), () =>
    drawingRepository.list(query).then(toDrawingPage),
  );
}

export function useDrawingStats(enabled = true) {
  return useQuery<DrawingStats>(enabled ? [KEY, "stats"] : null, () =>
    drawingRepository.stats().then(toDrawingStats),
  );
}

/**
 * The rail's badge: how many plans are waiting to be checked.
 *
 * Not how many plans exist, and not how many are in progress. *"Was liegt bei
 * mir zur Prüfung"* is the one number on this module somebody acts on, and a
 * badge that is always lit is one people stop seeing — the same argument the
 * overdue count and the pending-minutes count make.
 */
export function useAwaitingCheckCount(enabled: boolean): number | undefined {
  return useDrawingStats(enabled).data?.awaitingCheck;
}

/** `null` disables the query — a detail route with no id fetches nothing. */
export function useDrawing(id: string | null) {
  return useQuery<DrawingDetail>(id ? [KEY, "detail", id] : null, () =>
    drawingRepository.get(id!).then(toDrawingDetail),
  );
}

/**
 * Revisions across every plan the reader may see.
 *
 * *"Was ist diese Woche freigegeben worden"* — its own screen, and its own
 * cache entry because it changes when *any* plan gains a revision, which the
 * shared prefix already handles.
 */
export function useRevisions(query: RevisionQuery) {
  return useQuery<Paginated<ListedRevision>>(
    [
      KEY,
      "revisions",
      query.search ?? "",
      query.drawingId ?? "",
      query.projectId ?? "",
      query.reason ?? "",
      query.discipline ?? "",
      query.drawnById ?? "",
      query.released === undefined ? "" : String(query.released),
      query.superseded === undefined ? "" : String(query.superseded),
      `${query.sort?.field ?? ""}:${query.sort?.dir ?? ""}`,
      query.page ?? 1,
      query.perPage ?? 25,
    ],
    () => drawingRepository.revisions(query).then(toRevisionPage),
  );
}

export function useDrawingHistory(id: string | null) {
  return useQuery<Version[]>(id ? [KEY, "versions", id] : null, () =>
    drawingRepository.history(id!).then((rows) => rows.map(toVersion)),
  );
}

/* ---- Planversand ---------------------------------------------------- */

export function useTransmittalList(query: TransmittalQuery) {
  return useQuery<Paginated<Transmittal>>(
    [
      KEY,
      "transmittals",
      query.search ?? "",
      query.projectId ?? "",
      query.project ?? "",
      query.purpose ?? "",
      query.medium ?? "",
      query.sentById ?? "",
      query.recipient ?? "",
      query.sentAfter ?? "",
      `${query.sort?.field ?? ""}:${query.sort?.dir ?? ""}`,
      query.page ?? 1,
      query.perPage ?? 25,
    ],
    () => drawingRepository.listTransmittals(query).then(toTransmittalPage),
  );
}

export function useTransmittal(id: string | null) {
  return useQuery<TransmittalDetail>(id ? [KEY, "transmittal", id] : null, () =>
    drawingRepository.getTransmittal(id!).then(toTransmittalDetail),
  );
}

/* ---- The writes ----------------------------------------------------- */

export type DrawingMutations = {
  create: (draft: DrawingDraft) => Promise<DrawingDetail>;
  update: (id: string, edit: DrawingEdit) => Promise<DrawingDetail>;
  changeStatus: (id: string, change: DrawingStatusChange) => Promise<DrawingDetail>;
  remove: (id: string) => Promise<void>;
  exportCsv: (query: DrawingQuery) => Promise<void>;
  createRevision: (drawingId: string, draft: RevisionDraft) => Promise<Revision>;
  createTransmittal: (draft: TransmittalDraft) => Promise<TransmittalResult>;
  acknowledge: (id: string, draft: AcknowledgeDraft) => Promise<TransmittalDetail>;
  exportTransmittalsCsv: (query: TransmittalQuery) => Promise<void>;
};

/**
 * The writes.
 *
 * Each invalidates the whole feature rather than the key it touched, and here
 * that is correctness rather than caution: **issuing a Planversand moves every
 * plan in it to `ISSUED`**, and creating a revision changes the register's
 * `currentRevision` column. The set of affected entries is not knowable from
 * the mutation.
 *
 * Errors are **not** swallowed. The screen wraps the call and turns an
 * `ApiError`'s per-field messages into messages beside the inputs — and the 409
 * a stale plan raises is the one a form most needs to show.
 */
export function useDrawingMutations(): DrawingMutations {
  const create = useCallback(async (draft: DrawingDraft) => {
    const dto = await drawingRepository.create(toCreateDrawingBody(draft));
    invalidate(KEY);
    return toDrawingDetail(dto);
  }, []);

  const update = useCallback(async (id: string, edit: DrawingEdit) => {
    const dto = await drawingRepository.update(id, toUpdateDrawingBody(edit));
    invalidate(KEY);
    return toDrawingDetail(dto);
  }, []);

  const changeStatus = useCallback(async (id: string, change: DrawingStatusChange) => {
    const dto = await drawingRepository.changeStatus(id, toStatusBody(change));
    invalidate(KEY);
    return toDrawingDetail(dto);
  }, []);

  const remove = useCallback(async (id: string) => {
    await drawingRepository.remove(id);
    invalidate(KEY);
  }, []);

  const exportCsv = useCallback((query: DrawingQuery) => drawingRepository.exportCsv(query), []);

  const createRevision = useCallback(async (drawingId: string, draft: RevisionDraft) => {
    const dto = await drawingRepository.createRevision(drawingId, toCreateRevisionBody(draft));
    invalidate(KEY);
    return toRevision(dto);
  }, []);

  const createTransmittal = useCallback(async (draft: TransmittalDraft) => {
    const dto = await drawingRepository.createTransmittal(toCreateTransmittalBody(draft));
    // Both halves: the transmittal is new *and* every plan in it just moved to
    // `ISSUED`. One prefix covers both, which is why there is one prefix.
    invalidate(KEY);
    return toTransmittalResult(dto);
  }, []);

  const acknowledge = useCallback(async (id: string, draft: AcknowledgeDraft) => {
    const dto = await drawingRepository.acknowledge(id, toAcknowledgeBody(draft));
    invalidate(KEY);
    return toTransmittalDetail(dto);
  }, []);

  const exportTransmittalsCsv = useCallback(
    (query: TransmittalQuery) => drawingRepository.exportTransmittalsCsv(query),
    [],
  );

  return {
    create,
    update,
    changeStatus,
    remove,
    exportCsv,
    createRevision,
    createTransmittal,
    acknowledge,
    exportTransmittalsCsv,
  };
}
