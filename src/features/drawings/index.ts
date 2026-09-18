import { lazy } from "react";

/**
 * The feature's public surface. Nothing else leaves this folder.
 *
 * `admin/routes.tsx` and `admin/pages/ProjectPage.tsx` import this and nothing
 * deeper. The repository, the mapper and the DTOs are deliberately **not**
 * exported — a screen in another feature that wanted a plan would call the
 * endpoint through its own slice, or the type would move to `entities/drawing`,
 * which is where it already is. `architecture.test.ts` enforces both halves.
 *
 * ---
 *
 * **The screens are exported as `lazy()`, and that is load-bearing.**
 *
 * The shell statically imports `useAwaitingCheckCount` from here for the rail's
 * badge — on every page. The route table imports the screens through
 * `import()`. When both point at the same module, Rollup resolves the conflict
 * by hoisting the shared module into the *parent* chunk: the whole screen lands
 * in `admin.js`, the route's own chunk disappears, and nothing reports it. It
 * happened to `ApplicationList`, and the two modules before this one carry the
 * same note.
 *
 * **Five boundaries**, because they are five different visits. A Planversand
 * register is opened by somebody who never goes near a revision dialog, and the
 * project tab — which most visits do not land on — would otherwise pull both
 * detail screens and four dialogs into the chunk that renders a project's
 * overview.
 */
export const DrawingsRoute = lazy(async () => {
  const module = await import("./screens/DrawingList");
  return { default: module.DrawingList };
});

export const DrawingDetailRoute = lazy(async () => {
  const module = await import("./screens/DrawingDetail");
  return { default: module.DrawingDetail };
});

export const TransmittalsRoute = lazy(async () => {
  const module = await import("./screens/TransmittalList");
  return { default: module.TransmittalList };
});

export const TransmittalDetailRoute = lazy(async () => {
  const module = await import("./screens/TransmittalDetail");
  return { default: module.TransmittalDetail };
});

export const ProjectDrawingsTab = lazy(async () => {
  const module = await import("./screens/ProjectDrawingsTab");
  return { default: module.ProjectDrawingsTab };
});

export { useAwaitingCheckCount } from "./hooks/useDrawings";
