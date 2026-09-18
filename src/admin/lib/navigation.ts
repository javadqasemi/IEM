import type { ContentTypeRow } from "./api";

/**
 * The dashboard's navigation, as data.
 *
 * Nothing in the shell spells out a menu any more: `AdminLayout` renders
 * whatever this returns. Two consequences worth knowing.
 *
 * **The Website section is built from the database.** Its entries are the
 * content types the server reports, sorted by the `rank` the type itself
 * carries, and slotted into a group by `GROUP_OF`. Adding a content type to
 * `content-types.ts` therefore adds a menu entry with no change here — and one
 * that is *not* listed in `GROUP_OF` still appears, under "Weitere Inhalte",
 * rather than silently going missing. That fallback is the difference between a
 * structure that scales and one that quietly drops things.
 *
 * **Permissions filter, they do not decorate.** Every entry names the keys that
 * grant it; `buildNavigation` drops what the caller cannot hold, and a group
 * left empty by that filtering disappears with its heading. Hiding is still
 * only a courtesy — the server re-checks each call — but an editor should not
 * be shown a door they cannot open.
 *
 * Only destinations that exist are listed. A menu entry pointing at a route the
 * application does not serve is a broken link, and a navigation full of them is
 * worse than a short one.
 */

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

/**
 * 18×18 stroked glyphs, as path data.
 *
 * The first ten are the marks the rail already used, moved here unchanged so
 * the menu keeps the icons it had. The rest are new, drawn to the same
 * construction: 1.4 stroke, round joins, no fill.
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
  services: "M3.5 5h11M3.5 9h11M3.5 13h7",
  company: "M4 14V4.5h6V14M10 7.5h4V14M3 14h12M6 7h2M6 9.5h2M12 10h1",
  structure: "M9 3.5v4M4.5 14.5v-3M13.5 14.5v-3M4.5 11.5h9v-4h-9zM7 3.5h4v2H7z",
  seo: "M8 12.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM11.5 11.5 14.5 14.5",
  career: "M3.5 6.5h11v7h-11zM6.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5",
  labels: "M3.5 7.5v-3a1 1 0 0 1 1-1h3L14 9.8l-4.2 4.2L3.5 7.5ZM6 6h.01",
  account: "M9 9a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 9 9ZM4 14.5c0-2.2 2.2-3.8 5-3.8s5 1.6 5 3.8",
  edit: "M11.8 3.2l3 3L7.3 13.7l-3.6.6.6-3.6zM10.3 4.7l3 3",
  star: "M9 3.2l1.8 3.7 4 .6-2.9 2.8.7 4L9 12.4l-3.6 1.9.7-4L3.2 7.5l4-.6z",
  clock: "M9 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM9 6v3.2l2.2 1.3",
  /**
   * Projects: a building on a base line.
   *
   * Drawn on the same 18×18 grid and the same 1.4 stroke as the rest, because
   * one icon from a different set is the one that looks wrong at 16px — and
   * the rail is where every set mismatch is visible side by side.
   */
  projects: "M4 14.5V4.5h6v10M10 8h4v6.5M2.5 14.5h13M6 7h2M6 9.5h2M12 10.5h.8",
  /**
   * Aufgaben: a checklist — three lines, the first ticked.
   *
   * Deliberately **not** a board of columns, which is what a Kanban module
   * usually gets. The board is one of two views; the rail row points at the
   * work, and a reader scanning icons at 16px reads "a list of things to do"
   * far faster than three vertical rectangles. Same 18×18 grid and 1.4 stroke
   * as the rest.
   */
  tasks: "M3.5 5.2l1.4 1.4 2.4-2.6M3.5 9.5l1.4 1.4M3.5 13.8l1.4 1.4M9.5 5h5M9.5 9.8h5M9.5 14.6h5",
  /**
   * Sitzungen: a table seen from above, with people round it.
   *
   * Deliberately **not** a speech bubble and not a calendar. A bubble reads as
   * messaging — this dashboard will have notifications, and two chat-shaped
   * icons in one rail is the mismatch nobody can unsee. A calendar reads as
   * scheduling, which is the one thing this module does not do: a meeting here
   * is a protocol, and the date is metadata on it.
   *
   * Same 18×18 grid and 1.4 stroke as the rest.
   */
  meetings: "M5.4 7.2h7.2v3.6H5.4zM7.2 4.8v1.6M10.8 4.8v1.6M7.2 11.6v1.6M10.8 11.6v1.6M3 8.4h1.6M13.4 8.4h1.6",
  /**
   * Entscheide: a fork with a tick on the branch that was taken.
   *
   * A gavel would be wrong — this firm is not a court, and the decisions are
   * engineering ones. A fork says the thing a decision record is *for*: there
   * was more than one way, and this is the one that was chosen and why.
   */
  decisions: "M9 15.4V9M9 9 5 5M9 9l3.4-3.4M11.2 6.6l1.3 1.3 2.5-2.7",
} as const;

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

export type NavItem = {
  /** Stable across renders — favourites and history are stored by this. */
  id: string;
  to: string;
  label: string;
  /** Holding any one of these grants the item. Empty means "any signed-in user". */
  permissions: string[];
  /** Shown as a count chip. */
  badge?: number;
  /**
   * Match the path exactly instead of by prefix.
   *
   * Needed by a destination that is the parent of other destinations.
   * "Website bearbeiten" is `/inhalte`, and every content list below it is
   * `/inhalte/<type>` — under the default prefix rule it would stay lit on all
   * of them and, worse, win `activeSection` ahead of the group the editor is
   * actually in, putting the wrong name in the top bar.
   */
  exact?: boolean;
};

/**
 * The rail's blocks, in the order they are drawn.
 *
 * The order is the editor's working day, not the database's: what is waiting
 * for you, then what you edit, then what you administer. Before this the rail
 * was one flat list of fifteen peers in whatever order the two builders
 * happened to be concatenated in, which put seven content groups above
 * "Übersicht" — the home page sat eighth.
 *
 * `work` is deliberately unlabelled. A heading over the first three rows would
 * name what the reader can already see at the top of a menu, and the two
 * headings below do their work by being the only two.
 *
 * `hidden` is not drawn at all. It exists so a destination can leave the rail
 * without leaving the menu: "Mein Konto" duplicates the header's user panel as
 * a row, but `flattenNavigation` still finds it, so search and favourites keep
 * reaching it. Dropping the section outright would have made it unsearchable.
 */
export type Zone = "work" | "website" | "admin" | "hidden";

export const ZONES: { id: Zone; label: string | null }[] = [
  { id: "work", label: null },
  { id: "website", label: "Website" },
  { id: "admin", label: "Verwaltung" },
];

export type NavSection = {
  id: string;
  label: string;
  /** A key of `ICONS`. */
  icon: string;
  /** Which block of the rail this sits in. `"hidden"` is searchable, not drawn. */
  zone: Zone;
  /** Set when the section is itself a destination and has no children. */
  to?: string;
  permissions: string[];
  badge?: number;
  /** As `NavItem.exact`. */
  exact?: boolean;
  /**
   * Leave the section's name out of the top bar.
   *
   * For a page that already says where it is. "Website bearbeiten" embeds the
   * live site, which carries its own header; the dashboard's label above that
   * frame read as a breadcrumb into the site's navigation rather than as a
   * heading, and the rail already shows which page is open.
   */
  hideBarTitle?: boolean;
  /**
   * The group's entries. Rendered by `SectionTabs` across the top of the
   * group's page, not in the rail — the rail lists groups only.
   */
  items: NavItem[];
};

/* ------------------------------------------------------------------ */
/* Where each content type belongs                                     */
/* ------------------------------------------------------------------ */

/**
 * The grouping of the Website section, in the order the groups appear.
 *
 * Ordered by how often an editor touches them, not alphabetically and not by
 * the order they happen to sit in `content-types.ts`: the areas that change
 * weekly come first, and the label blocks — edited about once a year — last.
 */
const CONTENT_GROUPS: { id: string; label: string; icon: string }[] = [
  { id: "web-main", label: "Hauptinhalte", icon: "star" },
  { id: "web-services", label: "Leistungen", icon: "services" },
  { id: "web-career", label: "Karriere", icon: "career" },
  { id: "web-company", label: "Unternehmen", icon: "company" },
  // SEO used to be its own group holding exactly one type, which spent a whole
  // rail row on a single page. It sits with the other site-wide plumbing.
  { id: "web-structure", label: "Struktur & SEO", icon: "structure" },
  { id: "web-labels", label: "Beschriftungen", icon: "labels" },
  // Anything `GROUP_OF` does not name lands here rather than vanishing.
  { id: "web-other", label: "Weitere Inhalte", icon: "content" },
];

const FALLBACK_GROUP = "web-other";

/** Content type key → group id. Types absent from this map go to the fallback. */
const GROUP_OF: Record<string, string> = {
  // Touched constantly: the front page, the references, the people.
  hero: "web-main",
  sections: "web-main",
  projects: "web-main",
  team: "web-main",
  teamImage: "web-main",

  // What the firm sells, and how the work runs.
  services: "web-services",
  disciplines: "web-services",
  phases: "web-services",
  bauakte: "web-services",

  // Everything a vacancy needs, including the form it is applied to with.
  openings: "web-career",
  jobTexts: "web-career",
  jobCategoryNotes: "web-career",
  bewerbung: "web-career",
  contactEmail: "web-career",

  // Stable facts about IEM itself.
  leitbild: "web-company",
  facts: "web-company",
  offices: "web-company",
  sponsorships: "web-company",
  contact: "web-company",
  socials: "web-company",

  navItems: "web-structure",
  footer: "web-structure",
  seo: "web-structure",

  appLabels: "web-labels",
  navLabels: "web-labels",
  serviceLabels: "web-labels",
  referenzLabels: "web-labels",
  projectDialogLabels: "web-labels",
  teamLabels: "web-labels",
  jobLabels: "web-labels",
  stelleLabels: "web-labels",
  siteSearchLabels: "web-labels",
  searchLabels: "web-labels",
  ueberUnsLabels: "web-labels",
  ablaufControls: "web-labels",
  phaseTrack: "web-labels",
};

/* ------------------------------------------------------------------ */
/* Everything that is not a content type                               */
/* ------------------------------------------------------------------ */

/**
 * The fixed part of the menu, in its two blocks.
 *
 * `reviews` and `applications` take their counts from the caller, which is why
 * these are a function rather than a constant.
 *
 * The split is by what the row is *for*, not by what it touches. "Freigaben"
 * and "Veröffentlichen" are steps in getting an edit onto the live site, so
 * they lead; "Medien" and "Bewerbungen" are stores you visit when you need
 * something from them, so they sit with the administrative rows.
 */
function operationalSections(badges: {
  reviews?: number;
  applications?: number;
  projects?: number;
  tasks?: number;
  meetings?: number;
}): NavSection[] {
  return [
    {
      id: "overview",
      label: "Übersicht",
      icon: "overview",
      zone: "work",
      to: "/",
      permissions: ["system.health", "content.read"],
      items: [],
    },
    {
      /**
       * The first row of the operational platform, and it leads the zone for a
       * reason: at IEM the project *is* the work. Tasks, meetings, drawings,
       * time and invoices are all reached through one, which is what makes the
       * project view a container rather than one module among nineteen.
       *
       * `exact: false` — the default — because `/projekte/:id/gewerke` should
       * light this row. That is the opposite of "Website bearbeiten", which
       * needs `exact` precisely because it is the parent of other
       * destinations that have rails of their own.
       *
       * The badge counts live projects (`ACTIVE` + `ON_HOLD`), not all of
       * them: a number that only ever grows stops being read. It shares a
       * cache entry with the list screen's filter chips, so it costs no extra
       * request.
       */
      id: "projects",
      label: "Projekte",
      icon: "projects",
      zone: "work",
      to: "/projekte",
      permissions: ["project.read"],
      badge: badges.projects,
      items: [],
    },
    {
      /**
       * Aufgaben, directly under Projekte and above Freigaben.
       *
       * It sits with the project rather than in the administrative zone because
       * it is *work*, not a store you visit: "was liegt bei mir" is the first
       * question somebody has on signing in, and the second is "was ist auf
       * meinen Projekten los".
       *
       * The badge counts **overdue** tasks, not open ones. "Wie viele Aufgaben
       * habe ich" is always some tens and is a number nobody acts on; a badge
       * that is always lit is one people stop seeing. It shares a cache entry
       * with the list screen's KPI tiles, so it costs no extra request.
       */
      id: "tasks",
      label: "Aufgaben",
      icon: "tasks",
      zone: "work",
      to: "/aufgaben",
      permissions: ["task.read"],
      badge: badges.tasks,
      items: [],
    },
    {
      /**
       * Sitzungen, under Aufgaben.
       *
       * The badge counts **protocols that have not gone out** — held meetings
       * with no `minutesSentAt` — and not meetings, not upcoming ones. "Wie
       * viele Sitzungen gibt es" is a number nobody acts on; "welches Protokoll
       * muss ich noch versenden" is the one thing this module asks of a person,
       * and it is answerable on a Friday afternoon. Same argument as the overdue
       * count above, and it shares a cache entry with the list's KPI tiles.
       */
      id: "meetings",
      label: "Sitzungen",
      icon: "meetings",
      zone: "work",
      to: "/sitzungen",
      permissions: ["meeting.read"],
      badge: badges.meetings,
      items: [],
    },
    {
      /**
       * Entscheide, a rail row of its own rather than a tab under Sitzungen.
       *
       * A decision outlives the meeting it was taken in, and some are taken in
       * no meeting at all — on the Bauplatz, on the phone. Filing the register
       * under Sitzungen would make "was wurde hier entschieden" reachable only
       * through the chronology it is independent of.
       *
       * **No badge.** There is no number here anybody acts on: open decisions
       * are somebody's to carry, not something this rail can chase, and a count
       * of everything the firm has ever decided is a figure that only grows.
       */
      id: "decisions",
      label: "Entscheide",
      icon: "decisions",
      zone: "work",
      to: "/entscheide",
      permissions: ["decision.read"],
      items: [],
    },
    {
      id: "reviews",
      label: "Freigaben",
      icon: "review",
      zone: "work",
      to: "/freigaben",
      permissions: ["content.approve", "content.read"],
      badge: badges.reviews,
      items: [],
    },
    {
      id: "publish",
      label: "Veröffentlichen",
      icon: "publish",
      zone: "work",
      to: "/veroeffentlichen",
      permissions: ["content.publish", "content.history"],
      items: [],
    },
    {
      /**
       * The index of every content type, which `ContentIndexPage` has always
       * served at `/inhalte` with nothing linking to it. The rail's Website
       * block goes straight to the individual groups, so the one screen that
       * shows the whole site at once was reachable only by typing the URL.
       *
       * It leads its zone rather than joining the groups: it is the way in to
       * all of them, not a seventh one beside them.
       *
       * No entries and no name in the bar. The page embeds the live site, and
       * the site brings its own header with it — a second copy of that
       * navigation above the frame said the same thing twice.
       */
      id: "content-index",
      label: "Website bearbeiten",
      icon: "edit",
      zone: "website",
      to: "/inhalte",
      exact: true,
      hideBarTitle: true,
      permissions: ["content.read"],
      items: [],
    },
    {
      id: "media",
      label: "Medien",
      icon: "media",
      zone: "admin",
      to: "/medien",
      permissions: ["media.read"],
      items: [],
    },
    {
      id: "applications",
      label: "Bewerbungen",
      icon: "applications",
      zone: "admin",
      to: "/bewerbungen",
      permissions: ["application.read"],
      badge: badges.applications,
      items: [],
    },
    {
      id: "people",
      label: "Benutzer & Rollen",
      icon: "users",
      zone: "admin",
      permissions: ["user.read", "role.read"],
      items: [
        { id: "users", to: "/benutzer", label: "Benutzer", permissions: ["user.read"] },
        { id: "roles", to: "/rollen", label: "Rollen", permissions: ["role.read"] },
      ],
    },
    {
      id: "system",
      label: "System",
      icon: "settings",
      zone: "admin",
      permissions: ["settings.read", "audit.read"],
      items: [
        {
          id: "settings",
          to: "/einstellungen",
          label: "Einstellungen",
          permissions: ["settings.read"],
        },
        { id: "audit", to: "/audit", label: "Audit-Log", permissions: ["audit.read"] },
      ],
    },
    {
      id: "account",
      label: "Mein Konto",
      icon: "account",
      // Off the rail: the header's user panel already carries Profil and
      // Abmelden, and a second door to the same room is a row that teaches the
      // reader nothing. `hidden` keeps it in search and favourites.
      zone: "hidden",
      to: "/profil",
      // No key: everyone reaches their own profile.
      permissions: [],
      items: [],
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

/**
 * Builds the menu for one signed-in user.
 *
 * `canAny([])` is treated as granted — an item naming no permission is open to
 * anyone who is signed in, which is what "Mein Konto" wants.
 */
export function buildNavigation({
  types,
  canAny,
  badges = {},
}: {
  /** From `api.contentTypes()`. Pass an empty array before it resolves. */
  types: ContentTypeRow[];
  canAny: (permissions: string[]) => boolean;
  badges?: {
    reviews?: number;
    applications?: number;
    projects?: number;
    tasks?: number;
    meetings?: number;
  };
}): NavSection[] {
  // Sorted into rail order here rather than in the rail, so that everything
  // reading this list agrees: `flattenNavigation` feeds search in the same
  // order the eye meets the rows, and a `find` for the active section walks
  // them the same way. `hidden` sorts last and is dropped by the rail.
  const rank = (z: Zone) => {
    const at = ZONES.findIndex((zone) => zone.id === z);
    return at === -1 ? ZONES.length : at;
  };
  const sections = [...operationalSections(badges), ...buildWebsiteGroups(types)].sort(
    (a, b) => rank(a.zone) - rank(b.zone),
  );

  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAny(item.permissions)),
    }))
    // A link-shaped section stands on its own permissions. A group stands or
    // falls with its children: filtering every child away leaves a heading over
    // nothing, which is worse than an absent heading.
    .filter((section) =>
      section.to ? canAny(section.permissions) : section.items.length > 0,
    );
}

function buildWebsiteGroups(types: ContentTypeRow[]): NavSection[] {
  const byGroup = new Map<string, NavItem[]>();

  for (const type of [...types].sort((a, b) => a.rank - b.rank)) {
    const group = GROUP_OF[type.key] ?? FALLBACK_GROUP;
    const item: NavItem = {
      id: `type:${type.key}`,
      to: `/inhalte/${type.key}`,
      label: type.name,
      permissions: ["content.read"],
    };
    byGroup.set(group, [...(byGroup.get(group) ?? []), item]);
  }

  return CONTENT_GROUPS.filter((g) => byGroup.has(g.id)).map((g) => ({
    id: g.id,
    label: g.label,
    icon: g.icon,
    zone: "website",
    permissions: ["content.read"],
    items: byGroup.get(g.id)!,
  }));
}

/**
 * Where a main group leads when it is clicked.
 *
 * A group is not itself a destination — "Hauptinhalte" has no page — so it
 * stands for its first entry. That keeps every rail row a real link, with no
 * landing routes invented to sit behind a heading, and it means the row is
 * middle-clickable and bookmarkable like any other.
 */
export function sectionHref(section: NavSection): string | null {
  return section.to ?? section.items[0]?.to ?? null;
}

/**
 * The group the current path belongs to.
 *
 * Matched on the group's own route first, then on any entry inside it, so an
 * editor three segments deep (`/inhalte/projects/abc`) still resolves to
 * "Hauptinhalte" and gets that group's tabs above the page.
 */
export function activeSection(sections: NavSection[], path: string): NavSection | null {
  return (
    sections.find((s) => s.to && isActive(s.to, path, s.exact)) ??
    sections.find((s) => s.items.some((i) => isActive(i.to, path, i.exact))) ??
    null
  );
}

/** Every destination in the menu, flattened — what search and history read. */
export function flattenNavigation(sections: NavSection[]): NavItem[] {
  const out: NavItem[] = [];
  for (const section of sections) {
    if (section.to) {
      out.push({
        id: section.id,
        to: section.to,
        label: section.label,
        permissions: section.permissions,
        exact: section.exact,
      });
    }
    out.push(...section.items);
  }
  return out;
}

/**
 * Whether a path belongs to a destination.
 *
 * Prefix-matched so `/inhalte/projects/abc` keeps "Referenzprojekte" lit while
 * the editor is open — but only on a segment boundary, or `/inhalte/team` would
 * also light `/inhalte/teamImage`.
 */
export function isActive(to: string, path: string, exact = false): boolean {
  if (to === "/") return path === "/" || path === "";
  if (exact) return path === to;
  return path === to || path.startsWith(`${to}/`);
}
