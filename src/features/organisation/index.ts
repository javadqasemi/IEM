import { lazy } from "react";

/**
 * The feature's public surface. Nothing else leaves this folder.
 *
 * One route, not several: the workspace reads its own section from the URL, so
 * the eleven sections are one chunk and one entry in `routes.tsx`. Splitting
 * them per section would put a network round trip between clicking "Standorte"
 * and seeing it, for eleven chunks that share the same two queries.
 *
 * The screen is exported as `lazy()` here rather than being re-exported, which
 * is the rule `features/applications/index.ts` established: when the shell
 * statically imports anything from a feature's `index.ts` and the route table
 * imports it dynamically, Rollup hoists the shared module into the *entry*
 * chunk — the route's own chunk disappears and the bundle grows, with no
 * error. Declaring the boundary here keeps the only reference dynamic.
 *
 * Nothing in this feature feeds a rail badge today, so the hazard is latent
 * rather than live. It is written the safe way anyway: the day somebody adds
 * "3 Standorte ohne Telefon" to the rail, the failure would be a silent 40 kB
 * on every page rather than something that breaks.
 */
export const SettingsRoute = lazy(async () => {
  const module = await import("./screens/SettingsWorkspace");
  return { default: module.SettingsWorkspace };
});

export { DEFAULT_SECTION, SETTINGS_SECTIONS } from "./service";
