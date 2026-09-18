import { lazy } from "react";

/**
 * The feature's public surface. Nothing else leaves this folder.
 *
 * `admin/routes.tsx` and `admin/pages/ProjectPage.tsx` import this and nothing
 * deeper. The repository, the mapper and the DTOs are deliberately **not**
 * exported — a screen in another feature that wanted a meeting would call the
 * endpoint through its own slice, or the type would move to `entities/meeting`,
 * which is where it already is. `architecture.test.ts` enforces both halves.
 *
 * ---
 *
 * **The screens are exported as `lazy()`, and that is load-bearing.**
 *
 * The shell statically imports `usePendingMinutesCount` from here for the rail's
 * badge — on every page. The route table imports the screens through `import()`.
 * When both point at the same module, Rollup resolves the conflict by hoisting
 * the shared module into the *parent* chunk: the whole screen lands in
 * `admin.js`, the route's own chunk disappears, and nothing reports it. It
 * happened to `ApplicationList`, and `features/tasks/index.ts` carries the same
 * note.
 *
 * **Four boundaries rather than one**, because they are four different visits.
 * A decision register is opened by somebody who never goes near a protocol
 * editor, and the project tab — which thirteen visits out of fourteen do not
 * land on — would otherwise pull both detail screens and four dialogs into the
 * chunk that renders a project's overview.
 */
export const MeetingsRoute = lazy(async () => {
  const module = await import("./screens/MeetingList");
  return { default: module.MeetingList };
});

export const MeetingDetailRoute = lazy(async () => {
  const module = await import("./screens/MeetingDetail");
  return { default: module.MeetingDetail };
});

export const DecisionsRoute = lazy(async () => {
  const module = await import("./screens/DecisionList");
  return { default: module.DecisionList };
});

export const DecisionDetailRoute = lazy(async () => {
  const module = await import("./screens/DecisionDetail");
  return { default: module.DecisionDetail };
});

export const ProjectMeetingsTab = lazy(async () => {
  const module = await import("./screens/ProjectMeetingsTab");
  return { default: module.ProjectMeetingsTab };
});

export { usePendingMinutesCount } from "./hooks/useMeetings";
