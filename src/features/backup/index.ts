import { lazy } from "react";

/**
 * Sicherung und Wiederherstellung — the public surface of this feature.
 *
 * `features/README.md`'s rule: everything outside reaches the feature through
 * this file. `src/architecture.test.ts` enforces it.
 *
 * **`BackupRoute` is `lazy()` and `BackupSettingsPanel` is not**, and the
 * asymmetry is the trap `features/applications/index.ts` records. The route
 * table imports this module dynamically; if the shell ever also imports it
 * statically — for a rail badge, say — Rollup resolves the conflict by
 * hoisting the whole module into the **entry** chunk, the route's own chunk
 * disappears and the bundle grows with no error. Exporting the route as a lazy
 * boundary here means the split survives that.
 *
 * The settings panel needs none of it: it is reached only through
 * `admin/pages/SettingsPage.tsx`, which is itself inside the lazily-loaded
 * settings route, so the boundary already exists one level up.
 */
export const BackupRoute = lazy(() =>
  import("./screens/BackupRoute").then((m) => ({ default: m.BackupRoute })),
);

export { BackupSettingsPanel } from "./screens/BackupSettingsPanel";
export type { BackupOverview, BackupState } from "./types";
