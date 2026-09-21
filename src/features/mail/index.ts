/**
 * Email Operations — the public surface of this feature.
 *
 * `features/README.md`'s rule: everything outside reaches the feature through
 * this file, and nothing outside imports a screen, a hook or the repository
 * directly. `src/architecture.test.ts` enforces it.
 *
 * **Not lazy, and that is deliberate.** `features/applications/index.ts`
 * exports a `lazy()` because the shell statically imports it for a rail badge
 * *and* the route table imports it dynamically — a conflict Rollup resolves by
 * hoisting the module into the entry chunk, silently losing the split. Nothing
 * statically imports this one: it is reached only through
 * `admin/pages/SettingsPage.tsx`, which is itself inside the lazily-loaded
 * settings route, so the boundary already exists one level up and a second
 * `lazy()` here would add a loading state inside a screen that has one.
 */
export { MailSection } from "./screens/MailSection";
export type { MailState, MailStatus } from "./types";
