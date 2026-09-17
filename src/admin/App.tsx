import { useMemo } from "react";
import { api } from "./lib/api";
import { useAuth } from "./lib/auth";
import { match, useRoute } from "./lib/router";
import { useAsync } from "./lib/useAsync";
import { AdminLayout } from "./layout/AdminLayout";
import { buildNavigation } from "./lib/navigation";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { Button, EmptyState, Spinner } from "./ui/primitives";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { ContentEditorPage } from "./pages/ContentEditor";
import { ContentIndexPage, ContentListPage } from "./pages/Content";
import { MediaPage } from "./pages/Media";
import { PublishPage, ReviewsPage } from "./pages/Workflow";
import { RolesPage, UsersPage } from "./pages/People";
import { ApplicationsPage, AuditPage, ProfilePage, SettingsPage } from "./pages/Operations";

/**
 * The dashboard's route table and shell.
 *
 * Routes are matched in order and the list is short enough to read at a
 * glance, which is the point of keeping the router small — the alternative is
 * a nested configuration that has to be traced to answer "what renders at
 * /inhalte/team?".
 *
 * Authorisation is not done here. The rail hides what a user cannot reach and
 * the server refuses what they call anyway; a route that renders a screen the
 * caller has no permission for shows the server's own 403 message, which is
 * more useful than a blanket "kein Zugriff".
 */
export function App() {
  const { user, loading, canAny } = useAuth();
  const route = useRoute();

  // Counts for the rail's badges. Only fetched once signed in, and failures
  // are silent — a missing badge is not worth an error screen.
  const reviews = useAsync(
    () => (user ? api.reviews().catch(() => []) : Promise.resolve([])),
    [user?.id],
  );
  const applications = useAsync(
    () =>
      user
        ? api.applicationStats().catch(() => ({ total: 0, byStatus: {} as Record<string, number> }))
        : Promise.resolve(null),
    [user?.id],
  );

  /**
   * The content types the menu's Website groups are made of.
   *
   * Fetched here rather than inside the rail so the whole shell has one owner
   * for it. Failing quietly is right: an empty list costs the Website groups,
   * and the operational entries — where someone would go to find out *why* the
   * server is unhappy — still render.
   */
  const types = useAsync(
    () => (user ? api.contentTypes().catch(() => []) : Promise.resolve([])),
    [user?.id],
  );

  const sections = useMemo(
    () =>
      buildNavigation({
        types: types.data ?? [],
        // The context's `canAny` takes varargs; the menu passes an array, and
        // an item naming no permission is open to anyone signed in.
        canAny: (permissions) => permissions.length === 0 || canAny(...permissions),
        badges: {
          reviews: reviews.data?.length,
          applications: applications.data?.byStatus?.NEW,
        },
      }),
    [types.data, reviews.data, applications.data, canAny],
  );

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-base">
        <Spinner className="h-6 w-6 text-accent" />
        <span className="sr-only">Sitzung wird geprüft …</span>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <AdminLayout sections={sections}>
      {/* Keyed on the path so navigating away remounts the boundary and clears
          a caught error — the rail stays usable while one screen is broken. */}
      <ErrorBoundary key={route.path}>{renderRoute(route.path)}</ErrorBoundary>
    </AdminLayout>
  );
}

function renderRoute(path: string) {
  if (path === "/" || path === "") return <DashboardPage />;
  if (path === "/inhalte") return <ContentIndexPage />;

  const editor = match("/inhalte/:type/:id", path);
  if (editor) return <ContentEditorPage typeKey={editor.type} entryId={editor.id} />;

  const list = match("/inhalte/:type", path);
  if (list) return <ContentListPage typeKey={list.type} />;

  if (path === "/freigaben") return <ReviewsPage />;
  if (path === "/veroeffentlichen") return <PublishPage />;
  if (path === "/medien") return <MediaPage />;
  if (path === "/bewerbungen") return <ApplicationsPage />;
  if (path === "/benutzer") return <UsersPage />;
  if (path === "/rollen") return <RolesPage />;
  if (path === "/einstellungen") return <SettingsPage />;
  if (path === "/audit") return <AuditPage />;
  if (path === "/profil") return <ProfilePage />;

  // A signed-in user reaching the sign-in routes has already signed in —
  // send them to the dashboard rather than showing a "not found".
  if (["/passwort-vergessen", "/passwort-zuruecksetzen", "/einladung"].includes(path)) {
    return <DashboardPage />;
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
