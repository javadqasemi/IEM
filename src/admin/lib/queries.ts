/**
 * Query options for screens that move off `useAsync` (P1C).
 *
 * `useAsync` asked again on every mount; `useQuery` serves its cache for 30 s
 * by default. For most feature screens that is right — a mutation invalidates
 * what it changed. The legacy pages' data is changed by *other* screens'
 * direct API calls that invalidate nothing (a publish on the Veröffentlichen
 * page, a review decision), so a 30 s cache would show the home page's
 * "Änderungen seit der letzten Veröffentlichung" as stale right after a
 * publish — exactly the UX-07 answer P1A made trustworthy.
 *
 * So these ask again on each visit, like before, while keeping what is on
 * screen until the answer lands. **Not zero**: `load` treats an entry younger
 * than `staleMs` as fresh, and a window of 0 would make every settle's
 * `notify → sync → load` start another request — the unbounded loop
 * `RETRY_AFTER_MS` in `core/api/query.ts` exists to break for failures.
 */
export const FRESH_ON_VISIT = { staleMs: 2_000 } as const;
