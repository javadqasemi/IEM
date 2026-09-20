import { lazy } from "react";

/**
 * The feature's public surface. Nothing else leaves this folder.
 *
 * A `lazy()` boundary rather than a re-export, which is the rule
 * `features/applications/index.ts` established: when the shell statically
 * imports anything from a feature's `index.ts` and something else imports it
 * dynamically, Rollup hoists the shared module into the *entry* chunk — the
 * route's own chunk disappears and the bundle grows, with no error.
 *
 * Here the card is embedded in "Mein Konto" rather than being a route of its
 * own, so `pages/Operations.tsx` is the one importer. Declaring the boundary
 * anyway keeps the sessions list, its table and its two dialogs out of the
 * entry chunk, which every signed-in user downloads and almost none of them
 * open.
 */
export const SessionsRoute = lazy(async () => {
  const module = await import("./screens/SessionsCard");
  return { default: module.SessionsCard };
});

/**
 * The administrative view, behind its own boundary.
 *
 * A second `lazy()` rather than one chunk for the feature, because the two
 * screens are reached by different people from different places: almost
 * everybody opens "Mein Konto" and almost nobody holds `user.readSessions`.
 * Sharing a chunk would make each of them pay for the other, and the shared
 * parts — the mapper, the columns, the DTO — are hoisted into a common chunk
 * by Rollup rather than duplicated.
 */
export const UserSessionsRoute = lazy(async () => {
  const module = await import("./screens/UserSessionsPanel");
  return { default: module.UserSessionsPanel };
});
