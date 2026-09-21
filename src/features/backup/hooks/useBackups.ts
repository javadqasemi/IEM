import { useCallback, useState } from "react";
import { invalidate, useQuery } from "@/core/api";
import { backupRepository } from "../repository";
import { anyInFlight } from "../service";
import type {
  BackupOverview,
  BackupPage,
  BackupType,
  RestoreMode,
  RestoreRun,
  Restorability,
  RetentionPreview,
} from "../types";

const KEY = "backup";

/**
 * The backup screens' data.
 *
 * ---
 *
 * ## Polling, and why it stops
 *
 * A backup is a long operation with no push channel — the same situation the
 * notification bell is in, and the same seam: `pollMs` on `useQuery`. What is
 * different here is that it is **conditional**. The bell polls forever because
 * a notification can arrive at any time; a backup list only changes while
 * something is in flight, and a list left polling on an idle tab is a request
 * per tab per interval against an endpoint that aggregates six tables.
 *
 * So the interval is passed in by the caller, which computes it from the data
 * it already has. When nothing is running the list is static and asks nothing.
 */

export function useBackupStatus(pollMs = 0) {
  return useQuery<BackupOverview>([KEY, "status"], () => backupRepository.status(), {
    staleMs: 5_000,
    pollMs,
  });
}

export function useBackupList(query: { status?: string; type?: string; page?: number }) {
  const [poll, setPoll] = useState(0);
  const result = useQuery<BackupPage>(
    [KEY, "list", query.status ?? "", query.type ?? "", String(query.page ?? 1)],
    () => backupRepository.list({ ...query, perPage: 25 }),
    { staleMs: 5_000, pollMs: poll },
  );

  /*
    Derived from the data rather than held as state that something has to
    remember to clear. `useQuery` re-renders on every load, so this settles to
    the right value one render after the last run finishes — which is exactly
    when polling should stop.
  */
  const shouldPoll = result.data ? anyInFlight(result.data.items) : false;
  if (shouldPoll && poll === 0) setPoll(3000);
  if (!shouldPoll && poll !== 0 && result.data) setPoll(0);

  return result;
}

export function useRestoreHistory(pollMs = 0) {
  return useQuery<{ items: RestoreRun[] }>([KEY, "restores"], () => backupRepository.restores(), {
    staleMs: 5_000,
    pollMs,
  });
}

export function useRetentionPreview() {
  return useQuery<RetentionPreview>([KEY, "retention"], () => backupRepository.retentionPreview());
}

/** Whether one backup could be restored. Off the wire until a dialog opens. */
export function useRestorability(backupId: string | null) {
  return useQuery<Restorability>(
    backupId ? [KEY, "restorability", backupId] : null,
    () => backupRepository.restorability(backupId!),
  );
}

/**
 * The write operations.
 *
 * Every one **invalidates rather than primes**, which is the opposite of the
 * rule most of this codebase follows and is right here for one reason: none of
 * these responses is the new state. `create` answers with an id and a queued
 * job; the row it produces is written by a worker seconds later. Priming a
 * guess would put an invented row on screen beside real ones.
 *
 * The `invalidate` trap that bit `MfaCard` and the notification centre does not
 * apply: nothing here is the parent of a component holding unrecoverable
 * state, so a refetch that briefly empties the list costs a skeleton.
 */
export function useBackupMutations() {
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    invalidate([KEY, "list"]);
    invalidate([KEY, "status"]);
    invalidate([KEY, "retention"]);
  };

  const create = useCallback(async (type: BackupType) => {
    setBusy("create");
    try {
      const result = await backupRepository.create(type);
      refresh();
      return result;
    } finally {
      setBusy(null);
    }
  }, []);

  const setProtectedFlag = useCallback(async (id: string, value: boolean) => {
    setBusy(id);
    try {
      const result = await backupRepository.setProtected(id, value);
      refresh();
      return result;
    } finally {
      setBusy(null);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    setBusy(id);
    try {
      await backupRepository.remove(id);
      refresh();
    } finally {
      setBusy(null);
    }
  }, []);

  const restore = useCallback(
    async (id: string, body: { mode: RestoreMode; confirmation: string; reauthToken: string }) => {
      setBusy("restore");
      try {
        const result = await backupRepository.restore(id, body);
        invalidate([KEY, "restores"]);
        invalidate([KEY, "status"]);
        return result;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  return { busy, create, setProtectedFlag, remove, restore };
}
