import { useCallback } from "react";
import { peek, prime, useQuery } from "@/core/api";
import { toEnrolment, toMfaStatus, toRecoveryCodes } from "../mapper";
import { mfaRepository } from "../repository";
import type { Enrolment, MfaStatus, RecoveryCodes } from "../types";

/**
 * React only. Cache keys, loading state, invalidation.
 *
 * `repository → mapper → cache`, in that order: nothing below knows about
 * React and nothing above has seen a DTO.
 *
 * ---
 *
 * ## Nothing here calls `invalidate`, and that is the whole design of the file
 *
 * `invalidate()` sets `updatedAt = 0`, and `useQuery` gates `data` on
 * `updatedAt > 0` — so `data` reads `null` between the invalidate and the
 * refetch landing. A screen that renders a skeleton when it has no data
 * therefore **unmounts**, and everything its children were holding goes with
 * it. CLAUDE.md records that sequence taking the settings workspace down.
 *
 * Here it is worse than a lost form, and it was caught by `mfa.spec.ts`
 * rather than by review:
 *
 * - `MfaCard` renders a skeleton while it has no status, and the enrolment
 *   wizard is **inside** it. An `invalidate` after starting an enrolment
 *   unmounted the dialog and put the reader back on the intro screen, with a
 *   pending credential on the server they could not see.
 * - The same call after *finishing* one would have unmounted the dialog
 *   showing the **ten recovery codes**, which are displayed exactly once and
 *   cannot be fetched again. That is not a lost form; that is a person who
 *   can never get back into their account if they lose their phone.
 *
 * So every mutation below **primes the new status in the same tick**, which
 * is possible because in every case the outcome is known without asking: the
 * server has just told us what it did. `peek` supplies the untouched fields
 * and falls back to leaving the cache alone if nothing is cached — which
 * cannot happen from this screen, since the card rendered in order to have a
 * button, but is handled rather than asserted.
 */
const KEY = "mfa";
const STATUS_KEY = [KEY, "status"];

/**
 * The account's own status.
 *
 * No `staleMs` override, unlike `useSessions`. The reasoning there was that
 * a session list is a security decision being taken *now* and may be stale
 * by seconds; this changes only when the reader themselves changes it, and
 * every mutation below writes the new value back. Polling it would be one
 * request every thirty seconds on a screen where nothing moves.
 */
export function useMfaStatus(enabled = true) {
  return useQuery<MfaStatus>(
    enabled ? STATUS_KEY : null,
    () => mfaRepository.status().then(toMfaStatus),
  );
}

/** Writes a new status over the cached one, leaving the rest alone. */
function patchStatus(change: Partial<MfaStatus>): void {
  const cached = peek<MfaStatus>(STATUS_KEY);
  if (cached) prime(STATUS_KEY, { ...cached, ...change } satisfies MfaStatus);
}

export function useMfaMutations() {
  /**
   * Step 2 — a secret and a QR code.
   *
   * The enrolment itself is **returned, not cached**. It contains the secret,
   * and a secret in the query cache outlives the dialog: `clearQueryCache`
   * runs on sign-in and sign-out, which is not the lifetime this value should
   * have. The dialog holds it in state and drops it when it unmounts.
   *
   * What *is* written back is the one field that changed for the card behind
   * the dialog — see the note at the top of the file for why this is a
   * `prime` and not an `invalidate`.
   */
  const start = useCallback(async (): Promise<Enrolment> => {
    const enrolment = await mfaRepository.startEnrolment().then(toEnrolment);
    patchStatus({ pending: true, pendingExpiresAt: enrolment.expiresAt });
    return enrolment;
  }, []);

  /**
   * Step 3 — the first correct code, and the recovery codes.
   *
   * The codes come back from here and are shown once. Priming rather than
   * refetching is what keeps the dialog holding them mounted long enough for
   * the reader to write them down.
   */
  const verify = useCallback(async (code: string): Promise<RecoveryCodes> => {
    const codes = await mfaRepository.verifyEnrolment(code).then(toRecoveryCodes);
    patchStatus({
      enabled: true,
      method: "TOTP",
      verifiedAt: codes.generatedAt,
      lastUsedAt: codes.generatedAt,
      pending: false,
      pendingExpiresAt: null,
      recoveryCodes: { total: codes.codes.length, remaining: codes.codes.length, low: false },
    });
    return codes;
  }, []);

  const regenerate = useCallback(async (reauthToken: string): Promise<RecoveryCodes> => {
    const codes = await mfaRepository.regenerateRecoveryCodes(reauthToken).then(toRecoveryCodes);
    patchStatus({
      recoveryCodes: { total: codes.codes.length, remaining: codes.codes.length, low: false },
    });
    return codes;
  }, []);

  /** Turns it off. Everything about the factor goes with it. */
  const disable = useCallback(async (reauthToken: string) => {
    await mfaRepository.disable(reauthToken);
    patchStatus({
      enabled: false,
      method: null,
      verifiedAt: null,
      lastUsedAt: null,
      pending: false,
      pendingExpiresAt: null,
      recoveryCodes: { total: 0, remaining: 0, low: false },
    });
  }, []);

  return { start, verify, regenerate, disable };
}

/* ================================================================== */
/* Somebody else's, for an administrator                               */
/* ================================================================== */

/**
 * Clears one account's factor.
 *
 * There is no `useUserMfaStatus` beside it, deliberately: the boolean an
 * administrator sees comes back on the user row itself (`GET /users`), so a
 * second request per row would fetch something the list already has. The
 * counterpart in `features/sessions` needs its own query because a session
 * list is not on the user record; a `mfaEnabled` flag is.
 */
export function useAdminMfaMutations() {
  return useCallback(
    (userId: string, reauthToken: string) => mfaRepository.resetFor(userId, reauthToken),
    [],
  );
}
