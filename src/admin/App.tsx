import { useMemo } from "react";
import { api } from "./lib/api";
import { useAuth } from "./lib/auth";
import { match, useRoute } from "./lib/router";
import { useAsync } from "./lib/useAsync";
import { AdminLayout, type NavItem } from "./layout/AdminLayout";
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
  const { user, loading } = useAuth();
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

  const nav = useMemo<NavItem[]>(
    () => [
      {
        to: "/",
        label: "Übersicht",
        permissions: ["system.health", "content.read"],
        icon: <Glyph d="M3 9.5 9 4l6 5.5M4.5 8.5V14h9V8.5" />,
      },
      {
        to: "/inhalte",
        label: "Inhalte",
        permissions: ["content.read"],
        icon: <Glyph d="M3.5 3.5h11v11h-11zM6 6.5h6M6 9h6M6 11.5h3.5" />,
      },
      {
        to: "/freigaben",
        label: "Freigaben",
        permissions: ["content.approve", "content.read"],
        badge: reviews.data?.length,
        icon: <Glyph d="M3.5 9l3.5 3.5 6-7" />,
      },
      {
        to: "/veroeffentlichen",
        label: "Veröffentlichen",
        permissions: ["content.publish", "content.history"],
        icon: <Glyph d="M9 13.5V4M5.5 7.5 9 4l3.5 3.5" />,
      },
      {
        to: "/medien",
        label: "Medien",
        permissions: ["media.read"],
        icon: <Glyph d="M3.5 4.5h11v9h-11zM3.5 11l3-3 3 3 2-2 2.5 2.5" />,
      },
      {
        to: "/bewerbungen",
        label: "Bewerbungen",
        permissions: ["application.read"],
        badge: applications.data?.byStatus?.NEW,
        icon: <Glyph d="M3.5 5.5h11v8h-11zM3.5 5.5 9 10l5.5-4.5" />,
      },
      {
        to: "/benutzer",
        label: "Benutzer",
        permissions: ["user.read"],
        icon: <Glyph d="M9 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3.5 14c0-2.5 2.5-4 5.5-4s5.5 1.5 5.5 4" />,
      },
      {
        to: "/rollen",
        label: "Rollen",
        permissions: ["role.read"],
        icon: <Glyph d="M9 3.5 14 6v4c0 2.5-2.5 4-5 4.5C6.5 14 4 12.5 4 10V6Z" />,
      },
      {
        to: "/einstellungen",
        label: "Einstellungen",
        permissions: ["settings.read"],
        icon: <Glyph d="M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9 2.5v2M9 13.5v2M2.5 9h2M13.5 9h2M4.4 4.4l1.4 1.4M12.2 12.2l1.4 1.4M13.6 4.4l-1.4 1.4M5.8 12.2l-1.4 1.4" />,
      },
      {
        to: "/audit",
        label: "Audit-Log",
        permissions: ["audit.read"],
        icon: <Glyph d="M3.5 3.5h11v11h-11zM6 7h6M6 10h6" />,
      },
    ],
    [reviews.data, applications.data],
  );

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-base">
        <Spinner className="h-6 w-6 text-brand-navy" />
        <span className="sr-only">Sitzung wird geprüft …</span>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return <AdminLayout nav={nav}>{renderRoute(route.path)}</AdminLayout>;
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

/** A 18×18 stroked glyph, sized and coloured by its parent. */
function Glyph({ d }: { d: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
