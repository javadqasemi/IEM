import { Suspense, useMemo } from "react";
import { Button, EmptyState, Skeleton, Spinner } from "@/shared/ui/primitives";
import { ErrorBoundary } from "@/shared/ui/feedback";
import { useNewApplicationCount } from "@/features/applications";
import { useActiveProjectCount } from "@/features/projects";
import { useOverdueTaskCount } from "@/features/tasks";
import { usePendingMinutesCount } from "@/features/meetings";
import { useAwaitingCheckCount } from "@/features/drawings";
import { api } from "./lib/api";
import { useAuth } from "@/core/auth";
import { RouteMetaProvider, buildTrail, useRoute, useScrollReset, type Crumb } from "@/core/router";
import { useQuery } from "@/core/api";
import { FRESH_ON_VISIT } from "./lib/queries";
import { AdminLayout } from "./layout/AdminLayout";
import { buildNavigation, searchIndex, type NavWorkspace } from "./lib/navigation";
import { ROUTES, matchRoute, SPENT_AUTH_ROUTES } from "./routes";
import { LoginPage } from "./pages/Login";

/**
 * The dashboard's shell.
 *
 * The route table moved to `routes.tsx` so that two things could be true of it
 * that cannot be true of an `if` chain: every screen is a separate chunk, and
 * every route states the permissions that open it. See the note there.
 *
 * `LoginPage` is the one page still imported eagerly. It is what an unsigned-in
 * visitor renders, so code-splitting it would add a round trip to the first
 * screen in order to save bytes on a bundle that is otherwise not fetched yet.
 */
export function App() {
  const { user, loading, unreachable, retry, can } = useAuth();
  const route = useRoute();

  // Counts for the rail's badges. Only fetched once signed in, and failures
  // are silent — a missing badge is not worth an error screen.
  // Gated on the key that shows the row it counts: a badge nobody can see
  // should cost no request.
  // Off `useAsync` (P1C). A `null` key asks nothing, and the key carries the
  // user so the next person signing in on this tab never sees the last one's count.
  const reviews = useQuery(
    user && can("content.approve") ? ["shell", "reviews", user.id] : null,
    () => api.reviews().catch(() => []),
    FRESH_ON_VISIT,
  );
  // Applications is the one group that has moved to a feature folder, so its
  // count comes through the feature's public surface rather than off the shared
  // `api` object. It shares a cache entry with the list screen's filter chips.
  const newApplications = useNewApplicationCount(can("application.read"));
  // Live projects — `ACTIVE` plus `ON_HOLD`, not all of them. A badge that only
  // ever grows stops being read.
  const liveProjects = useActiveProjectCount(can("project.read"));
  // Overdue tasks, not open ones — "wie viele Aufgaben habe ich" is always some
  // tens and is a number nobody acts on. It shares a cache entry with the task
  // list's KPI tiles, so opening that page costs no extra request.
  const overdueTasks = useOverdueTaskCount(can("task.read"));
  // Protocols that have not gone out, not meetings. Same argument as the line
  // above, and the same arrangement: gated on the permission rather than on
  // being signed in, so a badge nobody can see costs no request — that is the
  // other half of the fix for the retry loop in `core/api/query.ts`.
  const pendingMinutes = usePendingMinutesCount(can("meeting.read"));
  // Plans in Prüfung, not plans. "Was liegt bei mir zur Prüfung" is the one
  // thing Pläne asks of a person; a count of the whole register only grows.
  const awaitingCheck = useAwaitingCheckCount(can("drawing.read"));

  /**
   * The content types — for the breadcrumb's middle step and for the command
   * palette, and no longer for the rail (P1B): thirty-five content types are
   * reached from Website › Inhalte and by search, not as thirty-five rows.
   *
   * Only asked for by somebody who can read content; failing quietly is right,
   * because an empty list costs a few search entries and nothing else.
   */
  // The types change only with a deployment, so the default cache is right.
  const types = useQuery(
    user && can("content.read") ? ["shell", "contentTypes", user.id] : null,
    () => api.contentTypes().catch(() => []),
  );

  /*
    Derived locally from the permissions already in the auth context: no
    request, no waterfall, and memoised so a badge count arriving re-renders
    the rail without rebuilding the search index.
  */
  const workspaces = useMemo(
    () =>
      buildNavigation({
        can,
        badges: {
          reviews: reviews.data?.length,
          applications: newApplications,
          projects: liveProjects,
          tasks: overdueTasks,
          meetings: pendingMinutes,
          drawings: awaitingCheck,
        },
      }),
    [can, reviews.data, newApplications, liveProjects, overdueTasks, pendingMinutes, awaitingCheck],
  );
  const searchEntries = useMemo(
    () => searchIndex({ can, types: types.data ?? [] }),
    [can, types.data],
  );

  /**
   * The breadcrumb trail, derived from the route table rather than written per
   * screen (weakness W11, foundation stage F4).
   *
   * Built here rather than inside the layout because this is where the content
   * types already are: the middle crumb of `/inhalte/projects/abc` is the
   * *list's* label, which the editor below it has no reason to know. The
   * record's own name comes the other way, through `usePageTitle`.
   *
   * A one-crumb trail is not drawn — "Medien" above a page whose heading is
   * already "Medien" is noise, not orientation.
   */
  const trail = useMemo<Crumb[]>(() => {
    const hit = matchRoute(route.path);
    if (!hit) return [];
    const labels = Object.fromEntries((types.data ?? []).map((t) => [t.key, t.name]));
    const crumbs = buildTrail(ROUTES, hit.route.pattern, hit.params, { labels });
    return crumbs.length > 1 ? crumbs : [];
  }, [route.path, types.data]);

  useScrollReset(route.path);

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-base">
        <Spinner className="h-6 w-6 text-accent" />
        <span className="sr-only">Sitzung wird geprüft …</span>
      </div>
    );
  }

  /*
    The server could not be asked, which is not the same as being signed out.

    Rendering the sign-in form here is what the shell used to do, and it is the
    one screen that cannot help: the credentials would go to the same
    unreachable API and come back as "Die Anmeldung ist fehlgeschlagen", which
    reads as a wrong password. The session in the cookie is very probably still
    good, so this says what happened and offers to try again.
  */
  if (!user && unreachable) return <Unreachable onRetry={retry} />;

  if (!user) return <LoginPage />;

  return (
    /*
      The provider sits above both halves on purpose: `AdminLayout` reads the
      screen's title and actions out of it, and the screen writes them into it.
      One context, two directions, and neither side imports the other.
    */
    <RouteMetaProvider>
      <AdminLayout workspaces={workspaces} searchEntries={searchEntries} trail={trail}>
        {/* Keyed on the path so navigating away remounts the boundary and clears
            a caught error — the rail stays usable while one screen is broken. */}
        <ErrorBoundary key={route.path}>
          {/* Also keyed on the path: without it, navigating between two lazy
              screens keeps the previous one mounted while the next chunk loads,
              so the fallback never shows and the page appears frozen. */}
          <Suspense key={route.path} fallback={<PageSkeleton />}>
            <Screen path={route.path} workspaces={workspaces} />
          </Suspense>
        </ErrorBoundary>
      </AdminLayout>
    </RouteMetaProvider>
  );
}

/**
 * Picks the screen for a path, or explains why there is none.
 *
 * Three outcomes, and the difference between the last two is the point of doing
 * this here rather than letting the server answer: "you cannot open this" and
 * "this does not exist" are different facts, and a reader who gets the wrong one
 * goes looking in the wrong place.
 */
function Screen({ path, workspaces }: { path: string; workspaces: NavWorkspace[] }) {
  const { canAny } = useAuth();
  const hit = matchRoute(path);

  if (!hit) {
    // A signed-in user reaching the sign-in routes has already signed in —
    // send them on rather than showing a "not found".
    if (SPENT_AUTH_ROUTES.includes(path)) {
      return <Redirect to="/" />;
    }
    return (
      <EmptyState
        title="Diese Seite gibt es nicht."
        description={`„${path}“ führt nirgendwohin. Vielleicht ist der Link veraltet.`}
        action={
          <Button variant="primary" href="#/">
            Zur Übersicht
          </Button>
        }
      />
    );
  }

  const { route, params } = hit;
  const allowed = route.permissions.length === 0 || canAny(...route.permissions);

  if (!allowed) return <NoAccess label={route.label} workspaces={workspaces} />;

  const Page = route.component;
  return <Page {...(route.props ? route.props(params) : params)} />;
}

/**
 * The shape of a page, while its chunk arrives.
 *
 * A skeleton rather than a spinner, for the same reason the tables use one: the
 * heading and the first card are in the same place before and after, so the
 * layout does not jump when the screen lands. On a warm cache this is never
 * seen; on a cold one it is the difference between "loading" and "broken".
 */
function PageSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-72" />
      </div>
      <Skeleton className="h-64 rounded-lg" />
      <span className="sr-only" role="status">
        Seite wird geladen …
      </span>
    </>
  );
}

/**
 * What a reader sees at a route their role does not open.
 *
 * It names the page and offers somewhere they *can* go, taken from their own
 * menu — which is more use than the server's "Fehlende Berechtigung:
 * content.publish" for someone who is not an administrator, and is why this is
 * worth having in front of the 403 rather than instead of it. The server still
 * refuses the data; this only decides what is drawn.
 */
function NoAccess({ label, workspaces }: { label: string; workspaces: NavWorkspace[] }) {
  const first = workspaces[0]?.destinations[0];
  return (
    <EmptyState
      title="Dafür fehlt Ihnen die Berechtigung."
      description={`„${label}“ ist für Ihre Rolle nicht freigegeben. Wenn Sie hier arbeiten müssen, kann eine Administratorin Ihre Rolle erweitern.`}
      action={
        first ? (
          <Button variant="primary" href={`#${first.to}`}>
            Weiter zu „{first.label}“
          </Button>
        ) : null
      }
    />
  );
}

/**
 * What a reader sees when the API cannot be reached at all.
 *
 * Deliberately says nothing about whether they are signed in, because nobody
 * knows: the refresh never got an answer. The retry re-runs the same restore, so
 * a session that was live the whole time comes straight back with no password
 * typed — which is the outcome that separates this from the sign-in form.
 */
function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-base px-6">
      <EmptyState
        title="Der Server antwortet nicht."
        description="Die Verbindung zum Dashboard-Server ist unterbrochen. Ihre Sitzung ist davon nicht betroffen — sobald der Server wieder erreichbar ist, geht es ohne erneute Anmeldung weiter."
        action={
          <Button variant="primary" onClick={onRetry}>
            Erneut versuchen
          </Button>
        }
      />
    </div>
  );
}

/** Replaces the current entry, so Back does not return to the spent link. */
function Redirect({ to }: { to: string }) {
  if (typeof window !== "undefined" && window.location.hash !== `#${to}`) {
    window.location.replace(`#${to}`);
  }
  return <PageSkeleton />;
}
