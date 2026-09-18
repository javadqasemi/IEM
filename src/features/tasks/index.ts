import { lazy } from "react";

/**
 * The feature's public surface. Nothing else leaves this folder.
 *
 * `admin/routes.tsx` imports this and nothing deeper; if something outside
 * needs a file two levels in, the boundary is wrong. The repository, the mapper
 * and the DTOs are deliberately **not** exported — a screen in another feature
 * that wanted a task would call the endpoint through its own slice, or the type
 * would move to `entities/task`, which is where it already is.
 * `architecture.test.ts` enforces both halves.
 *
 * ---
 *
 * **The screens are exported as `lazy()`, and that is load-bearing.**
 *
 * The shell statically imports `useOverdueTaskCount` from here for the rail's
 * badge — on every page. The route table imports the screen through `import()`.
 * When both point at the same module, Rollup resolves the conflict by hoisting
 * the shared module into the *parent* chunk, so the whole screen lands in
 * `admin.js` and the route's own chunk disappears: no error, a larger entry
 * bundle, and nothing to notice. It happened to `ApplicationList`, which is why
 * that feature's `index.ts` carries the same note.
 *
 * **`ProjectTasksTab` is a `lazy()` too**, although it is rendered *inside*
 * another feature's route rather than being one. Same reason, one step further
 * along: the project detail route would otherwise pull the whole board, its
 * drawer and its two dialogs into the chunk that renders a project's overview —
 * which is the tab thirteen visits out of fourteen land on.
 */
export const TasksRoute = lazy(async () => {
  const module = await import("./screens/TaskList");
  return { default: module.TaskList };
});

export const ProjectTasksTab = lazy(async () => {
  const module = await import("./screens/ProjectTasksTab");
  return { default: module.ProjectTasksTab };
});

export { useOverdueTaskCount } from "./hooks/useTasks";
