import { lazy } from "react";

/**
 * The feature's public surface. Nothing else leaves this folder.
 *
 * `app/routes.tsx` imports this and nothing deeper; if something outside needs
 * a file two levels in, the boundary is wrong. The repository, the mapper and
 * the DTOs are deliberately **not** exported — a screen in another feature that
 * wanted an application would call the same endpoint through its own slice, or
 * the type would move to `entities/`, which is where it already is.
 * `architecture.test.ts` enforces both halves of that.
 *
 * ---
 *
 * **The screen is exported as a `lazy()`, and that is load-bearing.**
 *
 * The shell imports `useNewApplicationCount` from here for the rail's badge —
 * a static import, on every page. The route table imports the screen through
 * `import()`. When both point at the same module, Rollup resolves the conflict
 * by hoisting the shared module into the *parent* chunk, so the whole screen
 * lands in `admin.js` and the route's own chunk disappears. That is precisely
 * what happened: the first version of this file re-exported the component
 * directly and the build lost `ApplicationList-*.js`, growing the entry bundle
 * by 3.7 kB with no error anywhere.
 *
 * Declaring the boundary *here* means the only reference to the screen is a
 * dynamic one, so it keeps its chunk while the badge hook — which the shell
 * genuinely needs at boot — stays in the entry.
 */
export const ApplicationsRoute = lazy(async () => {
  const module = await import("./screens/ApplicationList");
  return { default: module.ApplicationList };
});

export { useNewApplicationCount } from "./hooks/useApplications";
