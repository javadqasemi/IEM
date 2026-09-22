import { lazy } from "react";

/**
 * The System Control Center — the public surface of this feature.
 *
 * `features/README.md`'s rule: everything outside reaches the feature through
 * this file, and `src/architecture.test.ts` enforces it.
 *
 * **`SystemRoute` is `lazy()`**, which is the trap `features/applications`
 * records. The route table imports this module dynamically; if the shell ever
 * also imports it statically — for a rail badge saying how many jobs have
 * died, which is a plausible next step — Rollup resolves the conflict by
 * hoisting the whole module into the **entry** chunk. The route's own chunk
 * disappears and the bundle grows, with no error anywhere. The lazy boundary
 * here means the split survives that.
 */
export const SystemRoute = lazy(() =>
  import("./screens/SystemWorkspace").then((m) => ({ default: m.SystemWorkspace })),
);

export type { SystemOverview, JobRow, DiagnosticsRun } from "./types";
