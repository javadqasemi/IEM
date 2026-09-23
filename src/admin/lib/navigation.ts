import type { ContentTypeRow } from "./api";

/**
 * The dashboard's navigation, as one declarative registry (P1B).
 *
 * ---
 *
 * ## Workspaces, not modules
 *
 * The rail used to mirror the implementation: thirty-five content types in six
 * groups, "Unternehmen" twice (a content group and a settings group), the two
 * steps of the content workflow beside Projects in the "work" zone, and a
 * System group that opened for anybody holding `system.health` — twelve of the
 * fifteen seeded roles. `docs/COMPLETE_APPLICATION_AUDIT.md` Part 36 has the
 * matrix it was replaced from.
 *
 * It now answers *where would a person expect to do this*, in seven places:
 *
 * | Workspace | Owns |
 * | --- | --- |
 * | Übersicht | the home page |
 * | Aufgaben | the work queue |
 * | Projekte | projects and what hangs off them — Sitzungen, Entscheide, Pläne, Planversand |
 * | Website | content, its review and publication, media, and the approval rules |
 * | Personal | applications, accounts and roles |
 * | Unternehmen | the firm's own record — identity, legal, offices, contact |
 * | System | operation: health, jobs, diagnostics, audit, mail, backups, security, notification rules |
 *
 * **Ownership is information architecture, not a URL prefix.** Every route
 * kept its path — `/sitzungen` belongs to Projekte without becoming
 * `/projekte/sitzungen` — so no bookmark broke and there are no redirects.
 *
 * ## Three separate questions
 *
 * - **May this route render?** `routes.tsx`, unchanged — and the server's 403 is
 *   the control either way.
 * - **Is this destination shown in the rail?** `visibleWhen` here, *and* the
 *   workspace's audience.
 * - **Is it found by search?** The same answer as the rail, plus the content
 *   types and the reader's own account pages. Never wider: the palette reads
 *   `searchIndex`, which is built from the same filter, so a destination hidden
 *   from the rail cannot leak through it.
 *
 * A deep link to a route that is not in the rail is still valid if the route
 * allows it. `/freigaben` still renders for `content.read`; it is simply not
 * *offered* to somebody who cannot approve anything.
 *
 * ## Audiences, not role names
 *
 * Nothing here compares a role key. A workspace is shown when the reader holds
 * a capability that makes it *useful* (`AUDIENCES`), and a destination when the
 * reader holds the keys that make it work. A custom role assembled in the role
 * editor therefore gets a correct menu with nobody touching this file — the
 * test personas in `navigation.test.ts` are evidence, not logic.
 */

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

/**
 * 18×18 stroked glyphs, as path data.
 *
 * Drawn to one construction: 1.4 stroke, round joins, no fill.
 */
export const ICONS = {
  overview: "M3 9.5 9 4l6 5.5M4.5 8.5V14h9V8.5",
  content: "M3.5 3.5h11v11h-11zM6 6.5h6M6 9h6M6 11.5h3.5",
  review: "M3.5 9l3.5 3.5 6-7",
  publish: "M9 13.5V4M5.5 7.5 9 4l3.5 3.5",
  media: "M3.5 4.5h11v9h-11zM3.5 11l3-3 3 3 2-2 2.5 2.5",
  applications: "M3.5 5.5h11v8h-11zM3.5 5.5 9 10l5.5-4.5",
  users: "M9 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3.5 14c0-2.5 2.5-4 5.5-4s5.5 1.5 5.5 4",
  roles: "M9 3.5 14 6v4c0 2.5-2.5 4-5 4.5C6.5 14 4 12.5 4 10V6Z",
  settings:
    "M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9 2.5v2M9 13.5v2M2.5 9h2M13.5 9h2M4.4 4.4l1.4 1.4M12.2 12.2l1.4 1.4M13.6 4.4l-1.4 1.4M5.8 12.2l-1.4 1.4",
  audit: "M3.5 3.5h11v11h-11zM6 7h6M6 10h6",
  home: "M3.5 8.5 9 4l5.5 4.5M5 7.8V14h8V7.8M7.5 14v-3.5h3V14",
  company: "M4 14V4.5h6V14M10 7.5h4V14M3 14h12M6 7h2M6 9.5h2M12 10h1",
  seo: "M8 12.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM11.5 11.5 14.5 14.5",
  account: "M9 9a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 9 9ZM4 14.5c0-2.2 2.2-3.8 5-3.8s5 1.6 5 3.8",
  edit: "M11.8 3.2l3 3L7.3 13.7l-3.6.6.6-3.6zM10.3 4.7l3 3",
  star: "M9 3.2l1.8 3.7 4 .6-2.9 2.8.7 4L9 12.4l-3.6 1.9.7-4L3.2 7.5l4-.6z",
  clock: "M9 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM9 6v3.2l2.2 1.3",
  /** Projects: a building on a base line. */
  projects: "M4 14.5V4.5h6v10M10 8h4v6.5M2.5 14.5h13M6 7h2M6 9.5h2M12 10.5h.8",
  /** Aufgaben: a checklist — three lines, the first ticked. */
  tasks: "M3.5 5.2l1.4 1.4 2.4-2.6M3.5 9.5l1.4 1.4M3.5 13.8l1.4 1.4M9.5 5h5M9.5 9.8h5M9.5 14.6h5",
  /** Sitzungen: a table seen from above, with people round it. */
  meetings: "M5.4 7.2h7.2v3.6H5.4zM7.2 4.8v1.6M10.8 4.8v1.6M7.2 11.6v1.6M10.8 11.6v1.6M3 8.4h1.6M13.4 8.4h1.6",
  /** Entscheide: a fork with a tick on the branch that was taken. */
  decisions: "M9 15.4V9M9 9 5 5M9 9l3.4-3.4M11.2 6.6l1.3 1.3 2.5-2.7",
  /** Pläne: a sheet with a folded corner and a title block. */
  drawings: "M4 2.6h6.5L14 6.1v9.3H4zM10.5 2.6v3.5H14M6.2 11.4h5.6M6.2 13.4h3.2",
  /** Planversand: a sheet leaving, as an arrow out of a stack. */
  transmittals: "M3.2 5.4h6.4v7.2H3.2zM11 9h4.2M13.4 7l2 2-2 2",
  /** Benachrichtigungen: a bell. The header's bell draws the same path. */
  bell: "M4.5 12.5V8a4.5 4.5 0 0 1 9 0v4.5M3.2 12.5h11.6M7.4 14.5a1.7 1.7 0 0 0 3.2 0",
  /** Website: a globe, the mark the rail's foot already uses for "Website ansehen". */
  website:
    "M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12M3.3 7h11.4M3.3 11h11.4M9 3c-1.6 1.8-2.4 3.8-2.4 6S7.4 13.2 9 15c1.6-1.8 2.4-3.8 2.4-6S10.6 4.8 9 3",
} as const;

export type IconName = keyof typeof ICONS;

/* ------------------------------------------------------------------ */
/* Capabilities and audiences                                          */
/* ------------------------------------------------------------------ */

/** `can(key)` from the auth context. The only input navigation needs. */
export type Can = (permission: string) => boolean;

const any = (can: Can, ...keys: string[]) => keys.some((key) => can(key));

/**
 * Who a workspace is *for* — the one place this is decided.
 *
 * A workspace is drawn when its audience holds **and** at least one of its
 * destinations is visible. The audience is what stops a workspace appearing
 * because a role happens to hold one broad key that technically opens one page
 * of it:
 *
 * - **System** is for operators. `system.health` alone does not count — twelve
 *   of fifteen roles hold it, most of them so that the home page's overview
 *   call answers. The keys that mean somebody *operates* the installation do.
 * - **Website** is for people who work on the site — write, review, publish,
 *   manage media — and for roles whose *only* access is reading it (Viewer,
 *   Guest, Support), for whom it is the whole point of signing in. The
 *   operational roles hold `content.read` incidentally, beside project work,
 *   and are not sent into a workspace in which they can change nothing. Their
 *   deep links still open: the route decides that, not the menu.
 *
 * The other five need no more than "holds any key a destination needs", which
 * the per-destination filter already expresses — so they are `() => true`
 * here, and the rule is still written down in one place.
 */
export const AUDIENCES: Record<WorkspaceId, (can: Can) => boolean> = {
  overview: () => true,
  tasks: () => true,
  projects: () => true,
  website: (can) =>
    any(
      can,
      "content.create",
      "content.update",
      "content.delete",
      "content.approve",
      "content.publish",
      "content.schedule",
      "content.unpublish",
      "media.upload",
      "media.update",
    ) ||
    // Read-only content roles: reading the site is their job, not a side grant.
    (can("content.read") && !any(can, "project.read", "task.read", "meeting.read", "drawing.read")),
  people: () => true,
  company: () => true,
  system: (can) =>
    any(
      can,
      "settings.read",
      "audit.read",
      "system.backup",
      "job.read",
      "notification.configure",
      "notification.readDeliveries",
    ),
};

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

export type WorkspaceId =
  | "overview"
  | "tasks"
  | "projects"
  | "website"
  | "people"
  | "company"
  | "system";

export type Workspace = {
  id: WorkspaceId;
  label: string;
  icon: IconName;
};

/** In rail order: the day's work first, administration last. */
export const WORKSPACES: Workspace[] = [
  { id: "overview", label: "Übersicht", icon: "overview" },
  { id: "tasks", label: "Aufgaben", icon: "tasks" },
  { id: "projects", label: "Projekte", icon: "projects" },
  { id: "website", label: "Website", icon: "website" },
  { id: "people", label: "Personal", icon: "users" },
  { id: "company", label: "Unternehmen", icon: "company" },
  { id: "system", label: "System", icon: "settings" },
];

/** Keys the shell fills with counts. A destination names at most one. */
export type BadgeKey = "reviews" | "applications" | "projects" | "tasks" | "meetings" | "drawings";
export type Badges = Partial<Record<BadgeKey, number>>;

export type Destination = {
  /** Stable — favourites and history are stored by it. */
  id: string;
  to: string;
  label: string;
  /** `null` for the reader's own account pages, which belong to no workspace. */
  workspace: WorkspaceId | null;
  /** Shown to the reader when this is true. Always `can`-derived. */
  visibleWhen: (can: Can) => boolean;
  /** Other words people type for it. German first; technical and English aliases welcome. */
  keywords?: string[];
  /** A sub-heading inside the workspace's navigation. */
  group?: string;
  /** Match the path exactly rather than as a prefix. */
  exact?: boolean;
  badge?: BadgeKey;
  /**
   * Whether the badge is something to act on, and so worth summing onto the
   * workspace's own row. Live projects are a count, not a to-do.
   */
  actionable?: boolean;
  /** In search, never in the rail — the reader's own account pages. */
  searchOnly?: boolean;
};

/**
 * Every fixed destination, in the order each workspace lists them.
 *
 * The first visible destination of a workspace is where its rail row leads.
 */
export const DESTINATIONS: Destination[] = [
  {
    id: "overview",
    to: "/",
    label: "Übersicht",
    workspace: "overview",
    exact: true,
    keywords: ["dashboard", "start", "home", "kennzahlen"],
    // The route's own keys: the home page is also the landing page.
    visibleWhen: (can) => any(can, "system.health", "content.read"),
  },

  {
    id: "tasks",
    to: "/aufgaben",
    label: "Aufgaben",
    workspace: "tasks",
    badge: "tasks",
    actionable: true,
    keywords: ["tasks", "todo", "pendenzen", "board"],
    visibleWhen: (can) => can("task.read"),
  },

  /*
    Projekte. "Alle Projekte" rather than a second "Projekte" under the
    workspace of that name — the register is one of five things here, not the
    workspace itself.
  */
  {
    id: "projects",
    to: "/projekte",
    label: "Alle Projekte",
    workspace: "projects",
    badge: "projects",
    keywords: ["projekte", "projects", "register", "bauherrschaft"],
    visibleWhen: (can) => can("project.read"),
  },
  {
    id: "meetings",
    to: "/sitzungen",
    label: "Sitzungen",
    workspace: "projects",
    badge: "meetings",
    actionable: true,
    keywords: ["meetings", "bausitzung", "protokoll", "traktanden"],
    visibleWhen: (can) => can("meeting.read"),
  },
  {
    id: "decisions",
    to: "/entscheide",
    label: "Entscheide",
    workspace: "projects",
    keywords: ["decisions", "beschluss", "entscheidungen"],
    visibleWhen: (can) => can("decision.read"),
  },
  {
    id: "drawings",
    to: "/plaene",
    label: "Pläne",
    workspace: "projects",
    badge: "drawings",
    actionable: true,
    keywords: ["plaene", "drawings", "plans", "zeichnungen", "revisionen"],
    visibleWhen: (can) => can("drawing.read"),
  },
  {
    id: "transmittals",
    to: "/planversand",
    label: "Planversand",
    workspace: "projects",
    keywords: ["transmittal", "versand", "ausgabe"],
    visibleWhen: (can) => can("transmittal.read"),
  },

  /*
    Website. Review and publication are stages of the content's life, so they
    sit with it rather than in the day's-work block where the old rail had them
    — and each is offered to the people who can *act* there: approving is
    `content.approve`, not `content.read`; publishing is the three publishing
    verbs, not `content.history`.
  */
  {
    id: "content",
    to: "/inhalte",
    label: "Inhalte",
    workspace: "website",
    keywords: ["website bearbeiten", "content", "texte", "seiten", "cms"],
    visibleWhen: (can) => can("content.read"),
  },
  {
    id: "reviews",
    to: "/freigaben",
    label: "Freigaben",
    workspace: "website",
    badge: "reviews",
    actionable: true,
    keywords: ["review", "approve", "prüfen", "vier-augen"],
    visibleWhen: (can) => can("content.approve"),
  },
  {
    id: "publish",
    to: "/veroeffentlichen",
    label: "Veröffentlichen",
    workspace: "website",
    keywords: ["publish", "publizieren", "live", "snapshot", "terminieren"],
    visibleWhen: (can) => any(can, "content.publish", "content.schedule", "content.unpublish"),
  },
  {
    id: "media",
    to: "/medien",
    label: "Medien",
    workspace: "website",
    keywords: ["media", "bilder", "dateien", "images", "uploads"],
    visibleWhen: (can) => can("media.read"),
  },
  {
    id: "settings-workflow",
    to: "/einstellungen/freigabe",
    label: "Freigabe-Regeln",
    workspace: "website",
    group: "Einstellungen",
    keywords: ["freigabe", "vier-augen-prinzip", "workflow", "auto-publish"],
    visibleWhen: (can) => can("settings.read"),
  },

  /* Personal. Roles are access administration, grouped under it. */
  {
    id: "applications",
    to: "/bewerbungen",
    label: "Bewerbungen",
    workspace: "people",
    badge: "applications",
    actionable: true,
    keywords: ["applications", "kandidaten", "dossier", "rekrutierung"],
    visibleWhen: (can) => can("application.read"),
  },
  {
    id: "users",
    to: "/benutzer",
    label: "Benutzer",
    workspace: "people",
    group: "Zugang",
    keywords: ["users", "konten", "accounts", "einladen", "zugänge"],
    visibleWhen: (can) => can("user.read"),
  },
  {
    id: "roles",
    to: "/rollen",
    label: "Rollen",
    workspace: "people",
    group: "Zugang",
    keywords: ["roles", "rechte", "berechtigungen", "permissions"],
    visibleWhen: (can) => can("role.read"),
  },
  {
    id: "settings-applications",
    to: "/einstellungen/bewerbungen",
    label: "Bewerbungen einrichten",
    workspace: "people",
    group: "Einstellungen",
    keywords: ["aufbewahrung", "retention", "dateigrösse"],
    visibleWhen: (can) => can("settings.read"),
  },

  /*
    Unternehmen — the firm's own record, and the only thing this label now
    means. Leitbild, Sponsoring and the like are *website content about* the
    company; they stay content, edited under Website › Inhalte.
  */
  {
    id: "company-general",
    to: "/einstellungen/unternehmen",
    label: "Allgemein",
    workspace: "company",
    keywords: ["firma", "organisation", "firmenname"],
    visibleWhen: (can) => can("organisation.read"),
  },
  {
    id: "company-legal",
    to: "/einstellungen/rechtliches",
    label: "Recht und Identität",
    workspace: "company",
    keywords: ["impressum", "uid", "handelsregister", "rechtliches", "mwst"],
    visibleWhen: (can) => can("organisation.read"),
  },
  {
    id: "company-offices",
    to: "/einstellungen/standorte",
    label: "Standorte",
    workspace: "company",
    keywords: ["offices", "büro", "adresse", "hauptsitz"],
    visibleWhen: (can) => can("office.read"),
  },
  {
    id: "company-contact",
    to: "/einstellungen/kontakt",
    label: "Kontakt",
    workspace: "company",
    keywords: ["telefon", "e-mail-adressen", "contact"],
    visibleWhen: (can) => can("organisation.read"),
  },
  {
    id: "company-website",
    to: "/einstellungen/website",
    label: "Website-Vorgaben",
    workspace: "company",
    keywords: ["seo", "favicon", "vorschaubild", "og image"],
    visibleWhen: (can) => can("organisation.read"),
  },

  /*
    System. The operations half first — what somebody opens when something is
    wrong — then the configuration half under its own heading.
  */
  {
    id: "system-overview",
    to: "/system",
    label: "Systemzustand",
    workspace: "system",
    keywords: ["health", "status", "control center", "datenbank", "speicher"],
    visibleWhen: (can) => can("system.health"),
  },
  {
    id: "system-jobs",
    to: "/system/aufgaben",
    label: "Hintergrundaufgaben",
    workspace: "system",
    keywords: ["jobs", "queue", "warteschlange", "wiederholen"],
    // The route opens on `system.health`; the section needs `job.read` too.
    visibleWhen: (can) => can("system.health") && can("job.read"),
  },
  {
    id: "system-diagnostics",
    to: "/system/diagnose",
    label: "Diagnose",
    workspace: "system",
    keywords: ["diagnostics", "check", "prüfen", "fehlersuche"],
    visibleWhen: (can) => can("system.health"),
  },
  {
    id: "backups",
    to: "/sicherungen",
    label: "Sicherungen",
    workspace: "system",
    keywords: ["backup", "backups", "restore", "wiederherstellen", "einspielen"],
    visibleWhen: (can) => can("system.backup"),
  },
  {
    id: "audit",
    to: "/audit",
    label: "Audit-Log",
    workspace: "system",
    keywords: ["log", "protokoll", "verlauf", "wer hat"],
    visibleWhen: (can) => can("audit.read"),
  },
  {
    id: "settings-email",
    to: "/einstellungen/email",
    label: "E-Mail",
    workspace: "system",
    group: "Einstellungen",
    keywords: ["mail", "smtp", "email", "absender", "versand"],
    visibleWhen: (can) => can("settings.read"),
  },
  {
    id: "settings-backup",
    to: "/einstellungen/sicherung",
    label: "Sicherung einrichten",
    workspace: "system",
    group: "Einstellungen",
    keywords: ["backup", "zeitplan", "aufbewahrung"],
    visibleWhen: (can) => can("system.backup"),
  },
  {
    id: "settings-security",
    to: "/einstellungen/sicherheit",
    label: "Sicherheit",
    workspace: "system",
    group: "Einstellungen",
    keywords: ["security", "passwort", "sperre", "lockout", "sitzungsdauer"],
    visibleWhen: (can) => can("settings.read"),
  },
  {
    id: "settings-notifications",
    to: "/einstellungen/benachrichtigungen",
    label: "Benachrichtigungsregeln",
    workspace: "system",
    group: "Einstellungen",
    keywords: ["notifications", "regeln", "zustellprotokoll", "deliveries"],
    visibleWhen: (can) => any(can, "notification.configure", "notification.readDeliveries"),
  },
  {
    id: "settings-system",
    to: "/einstellungen/system",
    label: "Installation",
    workspace: "system",
    group: "Einstellungen",
    keywords: ["version", "laufzeit", "migrationen", "integrationen"],
    visibleWhen: (can) => can("system.health"),
  },

  /* The reader's own — no workspace, in search only. */
  {
    id: "notifications",
    to: "/benachrichtigungen",
    label: "Benachrichtigungen",
    workspace: null,
    searchOnly: true,
    keywords: ["notifications", "meldungen", "inbox", "glocke"],
    visibleWhen: () => true,
  },
  {
    id: "account",
    to: "/profil",
    label: "Mein Konto",
    workspace: null,
    searchOnly: true,
    keywords: ["profil", "passwort ändern", "zwei-faktor", "2fa", "sitzungen", "design"],
    visibleWhen: () => true,
  },
];

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

export type NavDestination = Destination & { count?: number };

export type NavWorkspace = Workspace & {
  /** Where the rail row leads: the first visible destination. */
  to: string;
  destinations: NavDestination[];
  /** Sum of the actionable counts inside — shown while the workspace is closed. */
  count?: number;
};

/** Whether a destination is offered to this reader: its own rule *and* its workspace's audience. */
export function isOffered(destination: Destination, can: Can): boolean {
  if (!destination.visibleWhen(can)) return false;
  return destination.workspace === null || AUDIENCES[destination.workspace](can);
}

/**
 * The rail for one reader.
 *
 * A workspace with no visible destination is not returned — never an empty
 * heading, never a row that leads to a refusal. Pure, and cheap: it reads the
 * permissions already in the auth context and makes no request.
 */
export function buildNavigation({ can, badges = {} }: { can: Can; badges?: Badges }): NavWorkspace[] {
  const out: NavWorkspace[] = [];
  for (const workspace of WORKSPACES) {
    const destinations: NavDestination[] = DESTINATIONS.filter(
      (d) => d.workspace === workspace.id && !d.searchOnly && isOffered(d, can),
    ).map((d) => (d.badge && badges[d.badge] ? { ...d, count: badges[d.badge] } : d));
    if (!destinations.length) continue;

    const count = destinations
      .filter((d) => d.actionable && d.count)
      .reduce((sum, d) => sum + (d.count ?? 0), 0);

    out.push({ ...workspace, to: destinations[0].to, destinations, count: count || undefined });
  }
  return out;
}

/** Whether a path is a destination — prefix-matched on a segment boundary unless `exact`. */
export function isActive(to: string, path: string, exact = false): boolean {
  const p = path === "" ? "/" : path;
  if (to === "/") return p === "/";
  if (exact) return p === to;
  return p === to || p.startsWith(`${to}/`);
}

/**
 * Which destination a path belongs to, over the **whole registry** rather than
 * the reader's filtered menu — ownership is a property of the route, not of the
 * person looking at it. The longest match wins, so `/system/aufgaben` is
 * Hintergrundaufgaben and not Systemzustand, and `/inhalte/team/abc` is Inhalte.
 *
 * `/einstellungen` with no section shows the first one, which is Unternehmen's.
 */
export function ownerOf(path: string): Destination | null {
  const p = path === "" ? "/" : path;
  if (p === "/einstellungen") return DESTINATIONS.find((d) => d.id === "company-general") ?? null;
  let best: Destination | null = null;
  for (const d of DESTINATIONS) {
    if (!isActive(d.to, p, d.exact)) continue;
    if (!best || d.to.length > best.to.length) best = d;
  }
  return best;
}

/** The workspace a path belongs to, or `null` for the reader's own pages and unknown paths. */
export function activeWorkspace(path: string): WorkspaceId | null {
  return ownerOf(path)?.workspace ?? null;
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export type SearchEntry = {
  id: string;
  to: string;
  label: string;
  /** Where it lives, for the result row: "Website › Inhalte". */
  context: string;
  keywords: string[];
};

/**
 * Everything the command palette may offer this reader.
 *
 * Built from exactly the filter the rail uses (`isOffered`), so the palette
 * cannot reveal a destination the rail hides. The content types are added
 * **only when the reader's Website workspace is visible** — they are reachable
 * contextually from Inhalte and here, and no longer from thirty-five rail rows.
 */
export function searchIndex({ can, types }: { can: Can; types: ContentTypeRow[] }): SearchEntry[] {
  const label = new Map(WORKSPACES.map((w) => [w.id, w.label]));
  const entries: SearchEntry[] = DESTINATIONS.filter((d) => isOffered(d, can)).map((d) => ({
    id: d.id,
    to: d.to,
    label: d.label,
    context: d.workspace
      ? [label.get(d.workspace), d.group].filter(Boolean).join(" › ")
      : "Mein Bereich",
    keywords: d.keywords ?? [],
  }));

  const content = DESTINATIONS.find((d) => d.id === "content")!;
  if (isOffered(content, can)) {
    for (const type of [...types].sort((a, b) => a.rank - b.rank)) {
      entries.push({
        id: `type:${type.key}`,
        to: `/inhalte/${type.key}`,
        label: type.name,
        context: "Website › Inhalte",
        keywords: [type.key, type.description ?? ""],
      });
    }
  }
  return entries;
}

/**
 * German-aware normalisation: lower case, no diacritics, `ß` → `ss`, so
 * "planversand", "Plänè" and "PLAENE" meet "Pläne" somewhere reasonable.
 * `ä` also matches `ae`, which is how Swiss keyboards without umlauts type.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Every character of `needle`, in order, somewhere in `hay`. */
function subsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const char of hay) if (char === needle[i]) i += 1;
  return i === needle.length;
}

/**
 * Ranks entries for a query. Higher is better; `0` means no match.
 *
 * Label prefix beats a word inside the label, which beats a keyword, which
 * beats a loose subsequence — so "publ" finds Veröffentlichen through its alias
 * without an unrelated fuzzy hit ranking above it.
 */
export function score(entry: SearchEntry, query: string): number {
  const q = normalise(query.trim());
  if (!q) return 0;
  const label = normalise(entry.label);
  if (label.startsWith(q)) return 100 - label.length / 100;
  if (label.split(/[\s\-/›]+/).some((word) => word.startsWith(q))) return 80;
  if (label.includes(q)) return 70;
  const keywords = entry.keywords.map(normalise);
  if (keywords.some((k) => k.startsWith(q))) return 60;
  if (keywords.some((k) => k.includes(q))) return 50;
  if (normalise(entry.context).includes(q)) return 30;
  if (q.length >= 3 && subsequence(q, label)) return 20;
  return 0;
}

/** The best matches first; ties keep the registry's order. */
export function search(entries: SearchEntry[], query: string, limit = 12): SearchEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, s: score(entry, query) }))
    .filter((hit) => hit.s > 0)
    .sort((a, b) => b.s - a.s || a.index - b.index)
    .slice(0, limit)
    .map((hit) => hit.entry);
}
