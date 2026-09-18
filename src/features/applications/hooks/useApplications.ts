import { useCallback } from "react";
import { invalidate, useQuery, type Paginated } from "@/core/api";
import type { Application, ApplicationStats, ApplicationStatus } from "@/entities/application";
import { toApplication, toApplicationPage, toApplicationStats, toPatchDto } from "../mapper";
import { applicationRepository, type ApplicationQuery } from "../repository";

/**
 * React only. Cache keys, loading state, invalidation.
 *
 * Every function here is `repository → mapper → cache`. That order is the
 * whole contract: nothing below this file knows about React, and nothing above
 * it has seen a DTO.
 */

/**
 * The cache prefix for everything in this feature.
 *
 * One constant rather than the string repeated at five call sites, because
 * invalidation is a prefix match — a typo in one key produces an entry nothing
 * ever invalidates, which shows up weeks later as a list that will not refresh.
 */
const KEY = "applications";

export function useApplicationList(query: ApplicationQuery) {
  return useQuery<Paginated<Application>>(
    [KEY, "list", query.search ?? "", query.status ?? "", query.page ?? 1, query.perPage ?? 50],
    () => applicationRepository.list(query).then(toApplicationPage),
  );
}

export function useApplicationStats(enabled = true) {
  return useQuery<ApplicationStats>(enabled ? [KEY, "stats"] : null, () =>
    applicationRepository.stats().then(toApplicationStats),
  );
}

/**
 * The rail's badge: how many applications nobody has looked at yet.
 *
 * Exported through the feature's `index.ts` so the shell can read one number
 * without importing a screen, a repository or a DTO — which is what the public
 * surface is for.
 *
 * It shares `[applications, stats]` with the list screen's filter chips, so
 * opening the page costs **no** extra request: the badge already fetched it,
 * and the cache hands the same entry to both. That is the difference `useQuery`
 * makes over `useAsync`, visible in one place.
 *
 * `undefined` when it has not loaded or the call failed. A missing badge is
 * the right failure — the rail still renders, and an error screen because a
 * count is unavailable would be worse than the count being unavailable.
 */
export function useNewApplicationCount(enabled: boolean): number | undefined {
  return useApplicationStats(enabled).data?.byStatus.NEW;
}

/** `null` disables the query — a detail panel that is closed fetches nothing. */
export function useApplication(id: string | null) {
  return useQuery<Application>(id ? [KEY, "detail", id] : null, () =>
    applicationRepository.get(id!).then(toApplication),
  );
}

export type ApplicationMutations = {
  update: (id: string, patch: { status?: ApplicationStatus; note?: string }) => Promise<Application>;
  remove: (id: string) => Promise<void>;
  downloadFile: (id: string, index: number, fallbackName: string) => Promise<void>;
};

/**
 * The writes.
 *
 * Each one invalidates the whole feature rather than the key it touched.
 * Deliberate: a status change moves a row between filtered lists *and* changes
 * two numbers in the stats tile, so the set of affected keys is not knowable
 * from the mutation. Invalidating six entries costs one round trip per mounted
 * screen; getting the set wrong costs a number that is quietly false.
 *
 * Errors are **not** swallowed here. The screen wraps the call in `useMutation`,
 * which is what turns an `ApiError`'s per-field messages into messages beside
 * the inputs — a hook that caught them would throw that away.
 */
export function useApplicationMutations(): ApplicationMutations {
  const update = useCallback(
    async (id: string, patch: { status?: ApplicationStatus; note?: string }) => {
      const dto = await applicationRepository.update(id, toPatchDto(patch));
      invalidate(KEY);
      return toApplication(dto);
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    await applicationRepository.remove(id);
    invalidate(KEY);
  }, []);

  const downloadFile = useCallback(
    (id: string, index: number, fallbackName: string) =>
      applicationRepository.downloadFile(id, index, fallbackName),
    [],
  );

  return { update, remove, downloadFile };
}
