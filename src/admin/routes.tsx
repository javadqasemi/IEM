import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { match } from "./lib/router";

/**
 * The dashboard's routes, as data.
 *
 * Two things moved here out of `App.tsx`'s `if` chain, and both need the table
 * to exist before they are possible.
 *
 * **Every page is loaded on demand.** They were all statically imported, so the
 * dashboard shipped as one 153 kB chunk and a sign-in downloaded the media grid,
 * the audit log and the role editor whether or not the reader could reach them.
 * At eleven screens that was merely wasteful; the enterprise modules turn it
 * into a multi-megabyte first paint. `lazy()` puts each screen in its own chunk
 * and the shell fetches the one being rendered.
 *
 * **Every route names the permissions that open it.** `renderRoute` used to
 * render any page to any signed-in user, on the reasoning that the server
 * refuses the data anyway — which is true, and which produced a screen of error
 * states rather than an answer. It is also a reasoning that stops holding the
 * moment a screen has anything on it that is not fetched, and Finance and HR
 * screens will. Hiding remains a courtesy: the server re-checks every call, so
 * this changes what a person *sees*, never what they can *get*.
 *
 * The keys are the same permission strings the server's guards use, so the two
 * can be compared by grep. Where they differ, the server wins.
 */

export type Route = {
  /** A `match()` pattern. `:name` segments become params. */
  pattern: string;
  /**
   * Holding **any one** of these opens the route. Empty means any signed-in
   * user, which is right for one's own profile.
   *
   * Any-of rather than all-of because that is what the navigation already does
   * and what the screens need: the publish page is useful to someone who can
   * only read the history as well as to someone who can publish.
   */
  permissions: string[];
  /** Rendered with the matched params, mapped through `props` when present. */
  component: LazyExoticComponent<ComponentType<Record<string, string>>>;
  /**
   * Turns URL params into the component's props.
   *
   * The two differ on purpose. A URL segment is named for the reader —
   * `/inhalte/:type/:id` — while the component is named for the domain
   * (`typeKey`, `entryId`), and renaming either to match the other would make
   * one of them worse. Omitted when they already agree, which is every route
   * with no params.
   */
  props?: (params: Record<string, string>) => Record<string, string>;
  /** Shown in the "no access" screen so the message can name the place. */
  label: string;
};

/**
 * `lazy()` wants a default export; these pages are named exports, because a
 * file like `Operations.tsx` holds four screens. The `.then` picks one out.
 */
const page = <P extends Record<string, string>>(
  load: () => Promise<Record<string, unknown>>,
  name: string,
) =>
  lazy(async () => {
    const mod = await load();
    return { default: mod[name] as ComponentType<P> };
  }) as LazyExoticComponent<ComponentType<Record<string, string>>>;

export const ROUTES: Route[] = [
  {
    pattern: "/",
    // `system.health` is what `GET /dashboard/overview` requires, but the page
    // is also the only landing place, so it opens for anyone who can read
    // content too — and it degrades rather than erroring when the overview call
    // is refused. See the note in `Dashboard.tsx`.
    permissions: ["system.health", "content.read"],
    component: page(() => import("./pages/Dashboard"), "DashboardPage"),
    label: "Übersicht",
  },

  // Order matters: the two-segment editor pattern has to be tried before the
  // one-segment list, and both before the bare index — `match()` is
  // exact-length, so this is about reading order rather than correctness.
  {
    pattern: "/inhalte/:type/:id",
    permissions: ["content.read"],
    component: page(() => import("./pages/ContentEditor"), "ContentEditorPage"),
    props: ({ type, id }) => ({ typeKey: type, entryId: id }),
    label: "Inhalt bearbeiten",
  },
  {
    pattern: "/inhalte/:type",
    permissions: ["content.read"],
    component: page(() => import("./pages/Content"), "ContentListPage"),
    props: ({ type }) => ({ typeKey: type }),
    label: "Inhalte",
  },
  {
    pattern: "/inhalte",
    permissions: ["content.read"],
    component: page(() => import("./pages/Content"), "ContentIndexPage"),
    label: "Website bearbeiten",
  },

  {
    pattern: "/freigaben",
    permissions: ["content.approve", "content.read"],
    component: page(() => import("./pages/Workflow"), "ReviewsPage"),
    label: "Freigaben",
  },
  {
    pattern: "/veroeffentlichen",
    permissions: ["content.publish", "content.history"],
    component: page(() => import("./pages/Workflow"), "PublishPage"),
    label: "Veröffentlichen",
  },
  {
    pattern: "/medien",
    permissions: ["media.read"],
    component: page(() => import("./pages/Media"), "MediaPage"),
    label: "Medien",
  },
  {
    pattern: "/bewerbungen",
    permissions: ["application.read"],
    component: page(() => import("./pages/Operations"), "ApplicationsPage"),
    label: "Bewerbungen",
  },
  {
    pattern: "/benutzer",
    permissions: ["user.read"],
    component: page(() => import("./pages/People"), "UsersPage"),
    label: "Benutzer",
  },
  {
    pattern: "/rollen",
    permissions: ["role.read"],
    component: page(() => import("./pages/People"), "RolesPage"),
    label: "Rollen",
  },
  {
    pattern: "/einstellungen",
    permissions: ["settings.read"],
    component: page(() => import("./pages/Operations"), "SettingsPage"),
    label: "Einstellungen",
  },
  {
    pattern: "/audit",
    permissions: ["audit.read"],
    component: page(() => import("./pages/Operations"), "AuditPage"),
    label: "Audit-Log",
  },
  {
    // No permission: everyone reaches their own profile. It is also where the
    // appearance setting lives, so it has to stay open to every role.
    pattern: "/profil",
    permissions: [],
    component: page(() => import("./pages/Operations"), "ProfilePage"),
    label: "Mein Konto",
  },
];

/**
 * The routes a signed-in user reaching them has already finished with.
 *
 * Sending them to the dashboard beats a "not found" for a link out of an old
 * invitation mail that they have already accepted.
 */
export const SPENT_AUTH_ROUTES = [
  "/passwort-vergessen",
  "/passwort-zuruecksetzen",
  "/einladung",
];

export function matchRoute(path: string): { route: Route; params: Record<string, string> } | null {
  const normalised = path === "" ? "/" : path;
  for (const route of ROUTES) {
    const params = match(route.pattern, normalised);
    if (params) return { route, params };
  }
  return null;
}
