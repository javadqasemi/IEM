import { lazy } from "react";

/**
 * The feature's public surface. Nothing else leaves this folder.
 *
 * `admin/routes.tsx` imports this and nothing deeper; if something outside
 * needs a file two levels in, the boundary is wrong. The repository, the mapper
 * and the DTOs are deliberately **not** exported — a screen in another feature
 * that wanted a project would call the endpoint through its own slice, or the
 * type would move to `entities/project`, which is where it already is.
 * `architecture.test.ts` enforces both halves of that.
 *
 * ---
 *
 * **The screens are exported as `lazy()`, and that is load-bearing.**
 *
 * The shell statically imports `useActiveProjectCount` from here for the rail's
 * badge — on every page. The route table imports the screens through
 * `import()`. When both point at the same module, Rollup resolves the conflict
 * by hoisting the shared module into the *parent* chunk, so the whole screen
 * lands in `admin.js` and the route's own chunk disappears: no error, a larger
 * entry bundle, and nothing to notice. It happened to `ApplicationList`, which
 * is why that feature's `index.ts` carries the same note.
 *
 * Declaring the boundary *here* means the only reference to a screen is a
 * dynamic one, so each keeps its chunk while the badge hook — which the shell
 * genuinely needs at boot — stays in the entry.
 *
 * The detail screen is a **separate** `lazy()` from the list rather than one
 * module exporting both: they are different routes and the list is by far the
 * commoner entry point, so bundling the fourteen tabs with it would make the
 * cheap page pay for the expensive one.
 */
export const ProjectsRoute = lazy(async () => {
  const module = await import("./screens/ProjectList");
  return { default: module.ProjectList };
});

export const ProjectDetailRoute = lazy(async () => {
  const module = await import("./screens/ProjectDetail");
  return { default: module.ProjectDetail };
});

export { useActiveProjectCount } from "./hooks/useProjects";
