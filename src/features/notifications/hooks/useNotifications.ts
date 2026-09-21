import { useCallback } from "react";
import { invalidate, peek, prime, useQuery } from "@/core/api";
import {
  toDeliveryPage,
  toNotificationPage,
  toPreferenceRow,
  toRuleRow,
} from "../mapper";
import { notificationRepository } from "../repository";
import type { DeliveryPage, NotificationPage, PreferenceRow } from "../types";

/**
 * React only. Cache keys, loading state, invalidation.
 *
 * `repository → mapper → cache`, in that order: nothing below knows about
 * React and nothing above has seen a DTO.
 */
const KEY = "notifications";
const COUNT_KEY = [KEY, "unread-count"];

/**
 * How often the bell asks.
 *
 * Sixty seconds, and the number is chosen against what it is for rather than
 * picked round. A notification is something **somebody else** caused, so it
 * is the one thing in this dashboard no local mutation will invalidate — but
 * it is also never urgent to the second. A minute is under the threshold at
 * which somebody notices the badge was late, and at one request per tab per
 * minute it is invisible against the default rate limit of 300.
 *
 * The poll pauses while the tab is hidden and fires once on the way back, so
 * a dashboard left open overnight costs nothing and a returning reader gets a
 * fresh count immediately. See `useQuery`'s `pollMs`.
 */
const POLL_MS = 60_000;

/**
 * The bell's number.
 *
 * `staleMs` is deliberately *below* the poll interval. If it were above,
 * `load` would serve the cached value and the tick would do nothing — a poll
 * that silently polls nothing, which is the kind of bug that is only found by
 * wondering why the badge never moves.
 */
export function useUnreadCount(enabled = true) {
  return useQuery<number>(
    enabled ? COUNT_KEY : null,
    () => notificationRepository.unreadCount().then((dto) => dto.unread),
    { staleMs: 30_000, pollMs: POLL_MS },
  );
}

export function useNotifications(query: {
  unread?: boolean;
  type?: string;
  severity?: string;
  page?: number;
  perPage?: number;
}) {
  return useQuery<NotificationPage>(
    /*
      Spread into primitives rather than passed as an object.

      `QueryKey` is a flat array of scalars on purpose — it is serialised to
      identify the entry, and an object in it would key on `JSON.stringify`'s
      property order, so two identical filters built in a different order
      would be two cache entries. Listing the parts is what makes the key
      mean what it says.
    */
    [KEY, "list", query.unread ?? false, query.type ?? "", query.severity ?? "", query.page ?? 1],
    () => notificationRepository.list(query).then(toNotificationPage),
    /*
      Ten seconds, against the default thirty.

      The same reasoning `useSessions` gives: this is a list somebody is
      looking at *because* they expect it to change, and it is cheap — one
      indexed page of a table that is small per user. The bell's count is
      what actually keeps it honest between refetches.
    */
    { staleMs: 10_000 },
  );
}

export function useNotificationMutations() {
  /**
   * Marks one read, and keeps the badge honest without a round trip.
   *
   * `prime` on the count rather than `invalidate`, for the reason CLAUDE.md
   * records twice: `invalidate` zeroes `updatedAt`, so the badge's data reads
   * `null` until the refetch lands and the number **disappears and comes
   * back**. On a control the reader has just clicked, a flicker is worse than
   * a stale value — and the value is not stale, because the outcome is known
   * without asking.
   *
   * The list is invalidated rather than primed: the row's own state changed,
   * the screen renders from it, and a refetch over data already on screen is
   * not a loading state.
   */
  const markRead = useCallback(async (id: string, read: boolean) => {
    await notificationRepository.markRead(id, read);
    const cached = peek<number>(COUNT_KEY);
    if (cached !== undefined) prime(COUNT_KEY, Math.max(0, cached + (read ? -1 : 1)));
    invalidate([KEY, "list"]);
  }, []);

  /**
   * Marks everything read.
   *
   * The count is primed to zero, which is the one outcome that is certain:
   * the server has just set `readAt` on every unread row of this account. A
   * refetch would be a round trip to be told what we decided.
   */
  const markAllRead = useCallback(async (): Promise<number> => {
    const { marked } = await notificationRepository.markAllRead();
    prime(COUNT_KEY, 0);
    invalidate([KEY, "list"]);
    return marked;
  }, []);

  return { markRead, markAllRead };
}

/* ================================================================== */
/* Preferences and rules                                               */
/* ================================================================== */

export function usePreferences(enabled = true) {
  return useQuery<PreferenceRow[]>(
    enabled ? [KEY, "preferences"] : null,
    () => notificationRepository.preferences().then((rows) => rows.map(toPreferenceRow)),
  );
}

export function useRules(enabled = true) {
  return useQuery<PreferenceRow[]>(
    enabled ? [KEY, "rules"] : null,
    () => notificationRepository.rules().then((rows) => rows.map(toRuleRow)),
  );
}

/**
 * Saving either screen.
 *
 * Both endpoints **return the whole recomputed list**, which is what lets
 * this `prime` rather than invalidate — and here that is not an optimisation
 * but a correctness point. The firm's rules bound the personal ones, so
 * saving a rule changes what a *preference* resolves to; the server has just
 * done that arithmetic and the response is the answer. Recomputing it on the
 * client would be the second copy of a rule this module is arranged to avoid.
 */
export function usePreferenceMutations() {
  const savePreferences = useCallback(
    async (updates: { type: string; inApp: boolean; email: boolean }[]) => {
      const rows = await notificationRepository
        .updatePreferences(updates)
        .then((list) => list.map(toPreferenceRow));
      prime([KEY, "preferences"], rows);
      return rows;
    },
    [],
  );

  const saveRules = useCallback(
    async (updates: { type: string; enabled: boolean; inApp: boolean; email: boolean }[]) => {
      const rows = await notificationRepository
        .updateRules(updates)
        .then((list) => list.map(toRuleRow));
      prime([KEY, "rules"], rows);
      /*
        The firm's rules bound everybody's preferences, so the personal list
        this browser may be holding is now wrong. Invalidated rather than
        primed: what it becomes depends on this person's own rows, which the
        rules response does not carry.
      */
      invalidate([KEY, "preferences"]);
      return rows;
    },
    [],
  );

  return { savePreferences, saveRules };
}

/* ================================================================== */
/* Deliveries — the operator's view                                    */
/* ================================================================== */

export function useDeliveries(
  query: { status?: string; page?: number },
  enabled = true,
) {
  return useQuery<DeliveryPage>(
    enabled ? [KEY, "deliveries", query.status ?? "", query.page ?? 1] : null,
    () => notificationRepository.deliveries(query).then(toDeliveryPage),
    { staleMs: 10_000 },
  );
}
