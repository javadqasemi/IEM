import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { ApplicationsRoute } from "@/features/applications";
import { ProjectsRoute } from "@/features/projects";
import { TasksRoute } from "@/features/tasks";
import {
  DecisionDetailRoute,
  DecisionsRoute,
  MeetingDetailRoute,
  MeetingsRoute,
} from "@/features/meetings";
import {
  DrawingDetailRoute,
  DrawingsRoute,
  TransmittalDetailRoute,
  TransmittalsRoute,
} from "@/features/drawings";
import { NotificationCenterRoute } from "@/features/notifications";
import { BackupRoute } from "@/features/backup";
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
    /**
     * `ProjectPage`, not `ProjectDetailRoute` directly.
     *
     * The wrapper is where the other modules' tabs are composed in — Aufgaben
     * is the first — because `features/projects` may not import
     * `features/tasks` and `widgets/` may not import a feature at all. The
     * shell is the only layer above both. See `pages/ProjectPage.tsx`.
     *
     * This is also the one route that goes back through `page()` rather than
     * taking a feature's own `lazy()`: the wrapper *is* this chunk's boundary,
     * and the feature's `index.ts` it imports holds only two `lazy()` calls and
     * a hook, so the screens themselves still split.
     */
    component: page(() => import("./pages/ProjectPage"), "ProjectPage"),
    props: ({ id }) => ({ projectId: id }),
    label: "Projekt",
    parent: "/projekte",
  },
  {
    pattern: "/projekte/:id",
    permissions: ["project.read"],
    component: page(() => import("./pages/ProjectPage"), "ProjectPage"),
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

  /**
   * Aufgaben, and it has **no detail route**.
   *
   * The opposite of the choice `/projekte/:id` makes, and deliberate: a task is
   * opened in a drawer beside the board rather than on a page of its own — see
   * the note on `TaskDrawer`. The consequence, stated rather than discovered, is
   * that a task has no shareable URL. The day that is wrong, this table gains a
   * `/aufgaben/:id` and the drawer becomes a route without anything else moving.
   */
  {
    pattern: "/aufgaben",
    permissions: ["task.read"],
    // From the feature's own `lazy()` boundary, like `/projekte`: the shell
    // statically imports the same `index.ts` for the rail's overdue badge, and
    // two references to one module — one static, one dynamic — make Rollup
    // hoist the screen into the entry chunk.
    component: TasksRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    label: "Aufgaben",
  },

  /**
   * Sitzungen, and it **does** have a detail route — the opposite of Aufgaben
   * one entry above, decided on the same grounds and coming out the other way.
   *
   * A task is opened, ticked and closed, so a drawer keeps the board underneath.
   * A protocol is read, quoted and sent to people who were not in the room:
   * *"siehe Bausitzung 14, Punkt 3"* has to be a link somebody can paste into an
   * e-mail, and a drawer has no URL to paste. The cost is the mirror image —
   * opening two protocols means going back.
   *
   * Two patterns for the same reason `/projekte` has two: the tab is in the URL,
   * so `/sitzungen/:id/protokoll` is where a reload returns to, and the
   * three-segment form has to be read before the two.
   */
  {
    pattern: "/sitzungen/:id/:tab",
    permissions: ["meeting.read"],
    component: MeetingDetailRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    props: ({ id }) => ({ meetingId: id }),
    label: "Sitzung",
    parent: "/sitzungen",
  },
  {
    pattern: "/sitzungen/:id",
    permissions: ["meeting.read"],
    component: MeetingDetailRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    props: ({ id }) => ({ meetingId: id }),
    label: "Sitzung",
    parent: "/sitzungen",
  },
  {
    pattern: "/sitzungen",
    permissions: ["meeting.read"],
    // From the feature's own `lazy()` boundary: the shell statically imports the
    // same `index.ts` for the rail's pending-minutes badge.
    component: MeetingsRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    label: "Sitzungen",
  },

  /**
   * Entscheide — its own top-level destination, not a tab under Sitzungen.
   *
   * A decision outlives the meeting it was taken in, and some are taken in no
   * meeting at all. Filing the register under Sitzungen would make the answer to
   * *"was wurde auf diesem Projekt entschieden"* reachable only through the
   * chronology it is independent of.
   */
  {
    pattern: "/entscheide/:id",
    permissions: ["decision.read"],
    component: DecisionDetailRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    props: ({ id }) => ({ decisionId: id }),
    label: "Entscheid",
    parent: "/entscheide",
  },
  {
    pattern: "/entscheide",
    permissions: ["decision.read"],
    component: DecisionsRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    label: "Entscheide",
  },

  /**
   * Pläne — two patterns, like `/projekte` and `/sitzungen`.
   *
   * The tab is in the URL, so `/plaene/:id/revisionen` is where a reload
   * returns to, and the three-segment form has to be read before the two.
   * A plan is cited by number and its URL gets pasted into an e-mail, which is
   * the same argument that gave Sitzungen a route where Aufgaben has a drawer.
   */
  {
    pattern: "/plaene/:id/:tab",
    permissions: ["drawing.read"],
    component: DrawingDetailRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    props: ({ id }) => ({ drawingId: id }),
    label: "Plan",
    parent: "/plaene",
  },
  {
    pattern: "/plaene/:id",
    permissions: ["drawing.read"],
    component: DrawingDetailRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    props: ({ id }) => ({ drawingId: id }),
    label: "Plan",
    parent: "/plaene",
  },
  {
    pattern: "/plaene",
    permissions: ["drawing.read"],
    // From the feature's own `lazy()` boundary: the shell statically imports
    // the same `index.ts` for the rail's awaiting-check badge.
    component: DrawingsRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    label: "Pläne",
  },

  /**
   * Planversand — its own destination, not a tab under Pläne.
   *
   * A transmittal is found by its own number months later, and the question it
   * answers — *"welche Revision hatte der Sanitär am 14. März"* — is about the
   * send rather than about any one plan.
   */
  {
    pattern: "/planversand/:id",
    permissions: ["transmittal.read"],
    component: TransmittalDetailRoute as LazyExoticComponent<
      ComponentType<Record<string, string>>
    >,
    props: ({ id }) => ({ transmittalId: id }),
    label: "Versand",
    parent: "/planversand",
  },
  {
    pattern: "/planversand",
    permissions: ["transmittal.read"],
    component: TransmittalsRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    label: "Planversand",
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
  /**
   * Sicherungen — the operations half of Backup & Recovery (P2-5).
   *
   * A destination of its own rather than a settings section, and that is the
   * brief's split for a reason worth restating: *Einstellungen → Sicherung*
   * answers "what should happen" and trains the movement "change a field,
   * press save". The most dangerous control in the application does not belong
   * inside that movement.
   *
   * **`system.backup` opens it, not `system.restore`.** Seeing the history is
   * not the same authority as replacing the database, and the screen reveals
   * the restore action only to somebody holding the second key.
   */
  {
    pattern: "/sicherungen",
    permissions: ["system.backup"],
    component: BackupRoute,
    label: "Sicherungen",
  },
  /**
   * Einstellungen — two patterns for one component, like `/projekte/:id`.
   *
   * The section is in the URL, so `/einstellungen/standorte` is a link
   * somebody sends a colleague and a place a reload returns to, and the
   * two-segment form has to be read before the one. A route per section would
   * be eleven entries differing in one string, and adding a section would
   * mean editing this table as well as `features/organisation/service.ts`.
   *
   * **All four keys, any one of which opens it**, because the eleven sections
   * do not share a permission: Standorte is `office.read`, the company's
   * record is `organisation.read`, the key/value groups are `settings.read`
   * and the System panel is `system.health`. Listing only `settings.read`
   * would shut somebody holding just `system.health` out of the page their
   * own rail row points at — which is what `routes.test.ts` caught, by
   * comparing the menu's keys against this table in both directions.
   *
   * `visibleSections` then narrows the sub-navigation to what each reader can
   * actually open, and the server re-checks every section's own data
   * regardless. Widening the route is a courtesy; it grants nothing.
   */
  {
    pattern: "/einstellungen/:section",
    /*
      `notification.configure` and `notification.readDeliveries` joined the
      list when Benachrichtigungen got its section (P2-3), for the reason the
      note above gives: the eleven sections do not share a permission, and a
      role holding only one of these two would otherwise be shut out of the
      page its own rail row points at. `routes.test.ts` compares the menu's
      keys against this table in both directions and is what caught it the
      first time.
    */
    permissions: [
      "settings.read",
      "organisation.read",
      "office.read",
      "system.health",
      "notification.configure",
      "notification.readDeliveries",
      /*
        `system.backup` joined the list when Sicherung got its section (P2-5),
        for the same reason and caught by the same test: the section stands on
        `system.backup`, so a role holding only it would be shut out of the
        page its own rail row points at. `routes.test.ts` compares the menu's
        keys against this table in both directions — the third time that
        comparison has caught this, which is what makes it worth having.
      */
      "system.backup",
    ],
    /**
     * `SettingsPage`, not `SettingsRoute` directly — the wrapper is where
     * the notification section is composed in, because
     * `features/organisation` may not import `features/notifications`. Same
     * arrangement as `/projekte/:id`. See `pages/SettingsPage.tsx`.
     */
    component: page(() => import("./pages/SettingsPage"), "SettingsPage"),
    props: ({ section }) => ({ section }),
    label: "Einstellungen",
    parent: "/einstellungen",
  },
  {
    pattern: "/einstellungen",
    permissions: [
      "settings.read",
      "organisation.read",
      "office.read",
      "system.health",
      "notification.configure",
      "notification.readDeliveries",
      /*
        `system.backup` joined the list when Sicherung got its section (P2-5),
        for the same reason and caught by the same test: the section stands on
        `system.backup`, so a role holding only it would be shut out of the
        page its own rail row points at. `routes.test.ts` compares the menu's
        keys against this table in both directions — the third time that
        comparison has caught this, which is what makes it worth having.
      */
      "system.backup",
    ],
    component: page(() => import("./pages/SettingsPage"), "SettingsPage"),
    label: "Einstellungen",
  },
  {
    pattern: "/audit",
    permissions: ["audit.read"],
    component: page(() => import("./pages/Operations"), "AuditPage"),
    label: "Audit-Log",
  },
  /**
   * Benachrichtigungen — two patterns, and **no permission on either**.
   *
   * These are the reader's own messages and their own preferences, like
   * `/profil`: a key every role had to hold for the bell to work is a key
   * that means nothing, and the server takes the account from the verified
   * token rather than from the URL. The *firm's* configuration is a
   * different screen behind `notification.configure`, reached through
   * `/einstellungen/benachrichtigungen`.
   *
   * The second pattern is read first, the same ordering `/projekte/:id/:tab`
   * needs — `match()` is exact-length, so this is reading order rather than
   * correctness. The settings tab has a URL of its own because the
   * notification e-mails link straight to it: "how do I stop receiving
   * this" has to be one click from the message, not a hunt through a
   * workspace.
   */
  {
    pattern: "/benachrichtigungen/einstellungen",
    permissions: [],
    component: NotificationCenterRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    /*
      "Einstellungen", not "Benachrichtigungen". The screen publishes no
      `usePageTitle` — it is the same component as its parent with a
      different tab — so this label *is* the last crumb, and repeating the
      parent's word would render the trail as
      "Benachrichtigungen / Benachrichtigungen", which says nothing twice.
    */
    label: "Einstellungen",
    parent: "/benachrichtigungen",
  },
  {
    pattern: "/benachrichtigungen",
    permissions: [],
    component: NotificationCenterRoute as LazyExoticComponent<ComponentType<Record<string, string>>>,
    label: "Benachrichtigungen",
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
