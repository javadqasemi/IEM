import { useCallback, useState } from "react";
import { invalidate, useQuery } from "@/core/api";
import { systemRepository } from "../repository";
import type { DiagnosticsRun, JobFilters } from "../types";

/**
 * The System screens' data, with the refresh rates each one deserves.
 *
 * ---
 *
 * ## Three freshness classes, not one interval
 *
 * A dashboard that refreshes everything every second is a dashboard that
 * makes a request a second for a page nobody is reading. `useQuery`'s
 * `pollMs` already **pauses when the tab is hidden** and refreshes on the way
 * back, so the numbers below are about how fast the underlying fact moves
 * rather than about politeness:
 *
 * | | |
 * | --- | --- |
 * | Overview | 60 s — subsystem verdicts change on the scale of a backup or a delivery |
 * | Jobs | 15 s — the poller ticks every 10 s, so anything faster shows the same rows |
 * | Diagnostics | never — it is a button, and three of its checks reach a third party |
 *
 * `staleMs` is set below `pollMs` on both, because a poll that fires inside
 * the staleness window is served from cache and costs nothing — which would
 * make the interval a number that looks like it does something and does not.
 */

const OVERVIEW_KEY = ["system", "overview"] as const;

export function useSystemOverview() {
  return useQuery(OVERVIEW_KEY, () => systemRepository.overview(), {
    pollMs: 60_000,
    staleMs: 30_000,
  });
}

export function useJobStats() {
  return useQuery(["system", "jobs", "stats"], () => systemRepository.jobStats(), {
    pollMs: 15_000,
    staleMs: 10_000,
  });
}

export function useJobs(filters: JobFilters) {
  /*
    The filters are part of the key, so switching a chip is a different cache
    entry rather than a refetch of the same one — which is what makes going
    back to "alle" instant instead of a fresh round trip.

    Serialised to a string rather than spread as an object: `QueryKey` is a
    list of scalars, and a stable spelling is also what stops two renders with
    equivalent-but-differently-ordered filters looking like two keys.
  */
  const fingerprint = [
    filters.status ?? "",
    filters.name ?? "",
    filters.failedOnly ? "failed" : "",
    filters.search ?? "",
    filters.page ?? 1,
    filters.perPage ?? 50,
  ].join("|");

  return useQuery(
    ["system", "jobs", fingerprint] as const,
    () => systemRepository.jobs(filters),
    { pollMs: 15_000, staleMs: 10_000 },
  );
}

export function useJob(id: string | null) {
  return useQuery(
    id ? (["system", "jobs", "detail", id] as const) : null,
    () => systemRepository.job(id!),
    { staleMs: 5_000 },
  );
}

/**
 * Retry and cancel, and **why neither primes**.
 *
 * `MfaCard` and the notification centre prime their mutations' outcomes
 * because the server has just said what it did. Here it has not: `retry`
 * answers `QUEUED`, and by the time the row re-renders the poller may already
 * have claimed it and moved it to `RUNNING`. Priming `QUEUED` would paint a
 * state that was true for a moment and is now wrong, and the next poll would
 * flip it back — which reads as the screen arguing with itself.
 *
 * So both invalidate and let the list refetch. The list is a *list*, not a
 * dialog holding something unrepeatable, so the `invalidate` trap CLAUDE.md
 * records does not apply: `useQuery` keeps the previous page on screen while
 * a refetch is in the air, and only the key being invalidated goes briefly to
 * `null`. That key is the one the table renders from, so the table is primed
 * back by the refetch within a tick rather than unmounting a dialog.
 */
export function useJobActions() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    async (
      id: string,
      fn: (id: string, reason?: string) => Promise<unknown>,
      reason?: string,
    ): Promise<boolean> => {
      setBusy(id);
      setError(null);
      try {
        await fn(id, reason);
        invalidate(["system", "jobs"]);
        invalidate(["system", "overview"]);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Die Aktion ist fehlgeschlagen.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  return {
    busy,
    error,
    clearError: () => setError(null),
    retry: (id: string, reason?: string) => act(id, systemRepository.retryJob, reason),
    cancel: (id: string, reason?: string) => act(id, systemRepository.cancelJob, reason),
  };
}

/**
 * Diagnostics: explicit, and the result is **kept in component state**.
 *
 * Not in the query cache, deliberately. A cached diagnostics run would be
 * served again on the next visit and read as current — the single most
 * misleading thing this page could do, because the whole value of the run is
 * that it happened just now. An empty panel saying "noch nicht ausgeführt" is
 * the honest starting state.
 */
export function useDiagnostics() {
  const [run, setRun] = useState<DiagnosticsRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setRun(await systemRepository.runDiagnostics());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Die Diagnose ist fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }, []);

  return { run, busy, error, execute };
}
