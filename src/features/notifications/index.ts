import { lazy } from "react";

export { NotificationBell } from "./screens/NotificationBell";

/**
 * The feature's public surface. Nothing else leaves this folder.
 *
 * ---
 *
 * **The bell is a plain export and everything else is behind `lazy()`**,
 * which is the opposite of what `features/applications` and
 * `features/sessions` do — and it is the same reasoning arriving at a
 * different answer.
 *
 * Those two are behind a boundary because the shell imports their `index.ts`
 * statically for a rail badge while the route table imports it dynamically,
 * and Rollup resolves that conflict by hoisting the screen into the **entry**
 * chunk: the route's own chunk disappears and the bundle grows, with no
 * error. The bell has no such conflict, because it is *only* ever rendered by
 * the shell — it is in the header on every screen, so deferring it would
 * mean a spinner in the top bar on every page load and a chunk fetched by
 * everybody anyway.
 *
 * The centre and the settings section are the ones a reader may never open,
 * so they keep their boundaries. They are separate boundaries rather than
 * one, because they are reached by different people: everybody has a
 * notification centre and almost nobody holds `notification.configure`.
 */
export const NotificationCenterRoute = lazy(async () => {
  const module = await import("./screens/NotificationCenter");
  return { default: module.NotificationCenter };
});

/** The organisation's configuration, embedded in the settings workspace. */
export const NotificationRulesRoute = lazy(async () => {
  const module = await import("./screens/NotificationRulesSection");
  return { default: module.NotificationRulesSection };
});
