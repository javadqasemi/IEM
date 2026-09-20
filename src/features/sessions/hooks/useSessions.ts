import { useCallback } from "react";
import { invalidate, peek, prime, useQuery } from "@/core/api";
import { toSessions } from "../mapper";
import { sessionRepository } from "../repository";
import type { Session } from "../types";

/**
 * React only. Cache keys, loading state, invalidation.
 *
 * `repository → mapper → cache`, in that order: nothing below knows about
 * React and nothing above has seen a DTO.
 */
const KEY = "sessions";

export function useSessions(enabled = true) {
  return useQuery<Session[]>(
    enabled ? [KEY, "list"] : null,
    () => sessionRepository.list().then(toSessions),
    /*
      Ten seconds, against the default thirty.

      This is the one list in the dashboard whose staleness is a security
      question rather than a convenience: somebody looking at it is deciding
      whether a session they do not recognise is still live. It is also
      cheap — one indexed query over a handful of rows.
    */
    { staleMs: 10_000 },
  );
}

export function useSessionMutations() {
  /**
   * Ends one session and reports whether it was this browser's.
   *
   * The caller needs that answer: revoking your own session leaves the tab
   * holding a refresh token the server has already refused, and carrying on
   * would look like a random sign-out at the next rotation rather than the
   * thing the reader just asked for.
   */
  const revoke = useCallback(async (id: string): Promise<{ wasCurrent: boolean }> => {
    const result = await sessionRepository.revoke(id);
    invalidate([KEY]);
    return { wasCurrent: result.wasCurrent };
  }, []);

  const revokeOthers = useCallback(async (): Promise<number> => {
    const { revoked } = await sessionRepository.revokeOthers();

    /*
      Primed from what is already cached, not refetched.

      The outcome is known without asking: everything but this browser's own
      session is gone, and the cached list already says which one that is. A
      refetch would be a round trip to be told what we just decided — and
      `invalidate` zeroes `updatedAt`, which takes the list off screen for a
      tick while it reloads. On a list the reader is mid-decision about, a
      blank is the worst possible frame.

      `peek` returns `undefined` when nothing is cached, which cannot happen
      from this screen (the button only exists once the list has rendered)
      but is handled rather than asserted: falling back to an invalidate
      costs a fetch and is always correct.
    */
    const cached = peek<Session[]>([KEY, "list"]);
    if (cached) prime([KEY, "list"], cached.filter((s) => s.current));
    else invalidate([KEY]);

    return revoked;
  }, []);

  return { revoke, revokeOthers };
}

/* ================================================================== */
/* Somebody else's, for an administrator                               */
/* ================================================================== */

/**
 * One account's sessions, keyed by that account.
 *
 * `[KEY, "user", userId]` sits under the same prefix as the list above, so
 * `invalidate([KEY])` still clears everything — which is what you want when
 * an administrator ends their *own* session from somebody's user page and
 * both lists are now wrong.
 *
 * `null` when there is no user, which is `useQuery`'s own way of saying "do
 * not fetch": the dialog this renders in is mounted before a row is chosen.
 */
export function useUserSessions(userId: string | null) {
  return useQuery<Session[]>(
    userId ? [KEY, "user", userId] : null,
    () => sessionRepository.listForUser(userId!).then(toSessions),
    { staleMs: 10_000 },
  );
}

export function useUserSessionMutations(userId: string | null) {
  /**
   * Ends one of somebody else's.
   *
   * `wasCurrent` still comes back and still matters, because "somebody else"
   * includes an administrator looking at their own record — and there the
   * row they just ended may be the session they are using. The caller decides
   * what to do about it; this only reports it.
   */
  const revoke = useCallback(
    async (id: string): Promise<{ wasCurrent: boolean }> => {
      if (!userId) return { wasCurrent: false };
      const result = await sessionRepository.revokeForUser(userId, id);
      invalidate([KEY]);
      return { wasCurrent: result.wasCurrent };
    },
    [userId],
  );

  /**
   * Ends all of them.
   *
   * Invalidated rather than primed, which is the opposite of `revokeOthers`
   * above and deliberate. There the outcome was known — everything but this
   * browser's own — so priming avoided a round trip and a blank frame. Here
   * the expected outcome is an *empty* list, and priming an empty list is
   * indistinguishable on screen from a failed fetch. Asking the server is
   * worth one request to be sure the lockout actually happened.
   */
  const revokeAll = useCallback(async (): Promise<number> => {
    if (!userId) return 0;
    const { revoked } = await sessionRepository.revokeAllForUser(userId);
    invalidate([KEY]);
    return revoked;
  }, [userId]);

  return { revoke, revokeAll };
}
