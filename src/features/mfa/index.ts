import { lazy } from "react";

/**
 * The feature's public surface. Nothing else leaves this folder.
 *
 * Two `lazy()` boundaries rather than one, which is the split
 * `features/sessions` makes and for the same measurement: the two screens
 * are reached by different people from different places. Every signed-in
 * person opens "Mein Konto"; almost nobody holds `user.resetMfa` and opens a
 * colleague's record. Sharing a chunk would make each pay for the other, and
 * the parts they genuinely share — the repository, the mapper, the hooks —
 * are hoisted into a common chunk by Rollup rather than duplicated.
 *
 * A boundary rather than a plain re-export, which is the rule
 * `features/applications/index.ts` established: when the shell statically
 * imports anything from a feature's `index.ts` and something else imports it
 * dynamically, Rollup hoists the shared module into the **entry** chunk —
 * the route's own chunk disappears and the bundle grows, with no error.
 *
 * The enrolment wizard is deliberately *not* exported. It is reached through
 * `MfaCard` and nowhere else: a second entry point into "set up a second
 * factor" would be a second place the `PENDING` credential's lifecycle has
 * to be understood.
 */
export const MfaRoute = lazy(async () => {
  const module = await import("./screens/MfaCard");
  return { default: module.MfaCard };
});

/** The administrative view, behind its own boundary. */
export const UserMfaRoute = lazy(async () => {
  const module = await import("./screens/UserMfaPanel");
  return { default: module.UserMfaPanel };
});
