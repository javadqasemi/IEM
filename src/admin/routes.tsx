import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { ApplicationsRoute } from "@/features/applications";
import { ProjectDetailRoute, ProjectsRoute } from "@/features/projects";
import { match } from "@/core/router";

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
  /**
   * The route one step up, as a pattern in this table.
   *
   * Foundation stage F4. It is what makes the breadcrumb trail derived rather
   * than written per screen — a parallel structure listing the trail for each
   * page is a structure that goes out of date the first time a route moves,
   * with nothing to notice. Absent on a top-level screen, where a one-crumb
   * trail would be noise.
   */
  parent?: string;
  /** Names the screen from the URL. See `CrumbRoute` in `core/router`. */
  crumb?: (params: Record<string, string>, labels: Record<string, string>) => string;
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
    // The one real three-level chain in the dashboard, and the reason F4's
    // breadcrumbs are worth having: the editor had no way back to its list
    // except the rail, which is off-canvas on a phone.
    parent: "/inhalte/:type",
  },
  {
    pattern: "/inhalte/:type",
    permissions: ["content.read"],
    component: page(() => import("./pages/Content"), "ContentListPage"),
    props: ({ type }) => ({ typeKey: type }),
    label: "Inhalte",
    parent: "/inhalte",
    // `projects` → "Projekte". The shell has already fetched the content types
    // to build the menu; without the lookup the middle of the trail would show
    // a URL slug, which is the one crumb a screen cannot publish for itself.
    crumb: ({ type }, labels) => labels[type] ?? type,
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
    /**
     * The first route pointing at a feature folder rather than at a page file.
     *
     * It takes the component the feature already declared rather than wrapping
     * it in `page()`, because the feature has to own its own `lazy()` boundary:
     * the shell statically imports the same `index.ts` for the rail's badge,
     * and two references to one module — one static, one dynamic — make Rollup
     * hoist the screen into the entry chunk. See the note in
     * `features/applications/index.ts`.
     */
    component: ApplicationsRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    label: "Bewerbungen",
  },
  /**
   * The project view, and the reason it needs two patterns plus a bare one.
   *
   * The tab is in the URL — `/projekte/:id/gewerke` is a link somebody sends a
   * colleague — so the three-segment form has to be tried before the two, and
   * both before the list. `match()` is exact-length, so this is reading order
   * rather than correctness; the order still matters to whoever adds the next
   * one.
   *
   * Both detail patterns point at the same component and the screen reads the
   * trailing segment itself. A route per tab would be fourteen entries that
   * differ in one string, and adding a module would mean editing this table as
   * well as the tab list — two places to forget.
   */
  {
    pattern: "/projekte/:id/:tab",
    permissions: ["project.read"],
    component: ProjectDetailRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    props: ({ id }) => ({ projectId: id }),
    label: "Projekt",
    parent: "/projekte",
  },
  {
    pattern: "/projekte/:id",
    permissions: ["project.read"],
    component: ProjectDetailRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    props: ({ id }) => ({ projectId: id }),
    label: "Projekt",
    parent: "/projekte",
  },
  {
    pattern: "/projekte",
    permissions: ["project.read"],
    // Like `/bewerbungen`: the component comes from the feature's own `lazy()`
    // boundary rather than from `page()`, because the shell statically imports
    // the same `index.ts` for the rail's badge. See the note in
    // `features/projects/index.ts`.
    component: ProjectsRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    label: "Projekte",
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
