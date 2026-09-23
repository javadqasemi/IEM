import { describe, expect, it } from "vitest";
import {
  AUDIENCES,
  DESTINATIONS,
  WORKSPACES,
  activeWorkspace,
  buildNavigation,
  isOffered,
  normalise,
  ownerOf,
  search,
  searchIndex,
  type Can,
} from "./navigation";
import type { ContentTypeRow } from "./api";
import { SEEDED_ROLES, canFor } from "./seededRoles.testing";

/**
 * The workspace model, tested as data (P1B).
 *
 * Navigation is derived from permissions, never from role names — the seeded
 * roles below are *personas* the derivation is checked against, read from the
 * server's catalogue so a change to a role's grants shows up here as a changed
 * menu. The counts are deliberate: each one was decided, not observed, and
 * `docs/COMPLETE_APPLICATION_AUDIT.md` Part 36 argues each.
 */

const workspacesOf = (role: string) => buildNavigation({ can: canFor(role) }).map((w) => w.id);

const TYPES = [
  { key: "team", name: "Team", rank: 40, description: "Die Mitarbeitenden" },
  { key: "leitbild", name: "Leitbild", rank: 170, description: "Werte der Firma" },
] as unknown as ContentTypeRow[];

describe("the registry", () => {
  it("has seven workspaces, each named once", () => {
    expect(WORKSPACES.map((w) => w.label)).toEqual([
      "Übersicht",
      "Aufgaben",
      "Projekte",
      "Website",
      "Personal",
      "Unternehmen",
      "System",
    ]);
  });

  it("has no duplicate destination id and no duplicate route", () => {
    const ids = DESTINATIONS.map((d) => d.id);
    const routes = DESTINATIONS.map((d) => d.to);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("gives every destination a workspace, except the reader's own account pages", () => {
    const loose = DESTINATIONS.filter((d) => d.workspace === null).map((d) => d.id);
    expect(loose.sort()).toEqual(["account", "notifications"]);
    expect(DESTINATIONS.filter((d) => d.workspace === null).every((d) => d.searchOnly)).toBe(true);
  });

  it("uses the label 'Unternehmen' for exactly one thing", () => {
    // It used to name a content group *and* a settings group (UX-09).
    const uses = [
      ...WORKSPACES.map((w) => w.label),
      ...DESTINATIONS.map((d) => d.label),
      ...DESTINATIONS.map((d) => d.group ?? ""),
    ].filter((label) => label === "Unternehmen");
    expect(uses).toEqual(["Unternehmen"]);
  });
});

describe("ownership (the brief's placement rules)", () => {
  const owner = (path: string) => activeWorkspace(path);

  it("puts review and publishing in Website", () => {
    expect(owner("/freigaben")).toBe("website");
    expect(owner("/veroeffentlichen")).toBe("website");
    expect(owner("/medien")).toBe("website");
  });

  it("puts Sitzungen, Entscheide, Pläne and Planversand in Projekte — detail routes too", () => {
    for (const path of [
      "/projekte/abc/gewerke",
      "/sitzungen",
      "/sitzungen/abc/protokoll",
      "/entscheide/abc",
      "/plaene/abc",
      "/plaene/abc/revisionen",
      "/planversand/abc",
    ]) {
      expect(owner(path), path).toBe("projects");
    }
  });

  it("puts system configuration in System", () => {
    for (const path of [
      "/system",
      "/system/aufgaben",
      "/system/diagnose",
      "/sicherungen",
      "/audit",
      "/einstellungen/email",
      "/einstellungen/sicherung",
      "/einstellungen/sicherheit",
      "/einstellungen/benachrichtigungen",
      "/einstellungen/system",
    ]) {
      expect(owner(path), path).toBe("system");
    }
  });

  it("puts the firm's record in Unternehmen, and content *about* the firm in Website", () => {
    expect(owner("/einstellungen/rechtliches")).toBe("company");
    expect(owner("/einstellungen/standorte")).toBe("company");
    expect(owner("/einstellungen")).toBe("company");
    expect(owner("/inhalte/leitbild")).toBe("website");
    expect(owner("/inhalte/team/abc")).toBe("website");
  });

  it("puts applications and access in Personal", () => {
    expect(owner("/bewerbungen")).toBe("people");
    expect(owner("/benutzer")).toBe("people");
    expect(owner("/rollen")).toBe("people");
    expect(owner("/einstellungen/bewerbungen")).toBe("people");
  });

  it("resolves the longest match, not the first", () => {
    expect(ownerOf("/system/aufgaben")?.id).toBe("system-jobs");
    expect(ownerOf("/system")?.id).toBe("system-overview");
    expect(ownerOf("/")?.id).toBe("overview");
    expect(ownerOf("/unbekannt")).toBeNull();
  });

  it("keeps the reader's own pages out of every workspace", () => {
    expect(owner("/profil")).toBeNull();
    expect(owner("/benachrichtigungen/einstellungen")).toBeNull();
  });
});

describe("the 35 content types are not rail rows", () => {
  it("no destination points at a single content type", () => {
    expect(DESTINATIONS.filter((d) => /^\/inhalte\/.+/.test(d.to))).toEqual([]);
  });

  it("but every content type is found by search, under Website", () => {
    const entries = searchIndex({ can: () => true, types: TYPES });
    const team = entries.find((e) => e.id === "type:team")!;
    expect(team.to).toBe("/inhalte/team");
    expect(team.context).toBe("Website › Inhalte");
  });
});

/* ------------------------------------------------------------------ */
/* Personas                                                            */
/* ------------------------------------------------------------------ */

describe("what each seeded role is offered", () => {
  it.each([
    ["super_admin", ["overview", "tasks", "projects", "website", "people", "company", "system"]],
    ["administrator", ["overview", "tasks", "projects", "website", "people", "company", "system"]],
    // No Website: `content.read` is incidental beside project work. People and
    // System stay — user/role reads and the audit log are governance.
    ["management", ["overview", "tasks", "projects", "people", "company", "system"]],
    ["project_manager", ["overview", "tasks", "projects"]],
    ["engineer", ["overview", "tasks", "projects"]],
    ["finance", ["overview", "tasks", "projects"]],
    // HR writes the careers content, reads projects for staffing, handles
    // applications — and holds only `system.health` of the System keys.
    ["hr", ["overview", "projects", "website", "people"]],
    ["content_editor", ["overview", "website"]],
    ["marketing", ["overview", "website"]],
    ["viewer", ["overview", "website"]],
    ["guest", ["overview", "website"]],
    ["support", ["overview", "website", "people", "system"]],
    ["manager", ["overview", "website", "people", "company", "system"]],
  ])("%s", (role, expected) => {
    expect(workspacesOf(role)).toEqual(expected);
  });

  it("covers every seeded role, so a new one cannot slip through unasserted", () => {
    const asserted = new Set([
      "super_admin", "administrator", "management", "project_manager", "engineer", "finance",
      "hr", "content_editor", "marketing", "viewer", "guest", "support", "manager",
      "engineering", "sales",
    ]);
    expect(SEEDED_ROLES.map((r) => r.key).filter((k) => !asserted.has(k))).toEqual([]);
    expect(workspacesOf("engineering")).toEqual(["overview", "website"]);
    expect(workspacesOf("sales")).toEqual(["overview", "website"]);
  });

  it("never draws a workspace with nothing in it", () => {
    for (const role of SEEDED_ROLES) {
      for (const workspace of buildNavigation({ can: canFor(role.key) })) {
        expect(workspace.destinations.length, `${role.key} › ${workspace.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("offers Freigaben only to somebody who can approve", () => {
    const has = (role: string, id: string) =>
      buildNavigation({ can: canFor(role) }).some((w) => w.destinations.some((d) => d.id === id));
    expect(has("content_editor", "reviews")).toBe(false);
    expect(has("viewer", "reviews")).toBe(false);
    expect(has("administrator", "reviews")).toBe(true);
    expect(has("manager", "reviews")).toBe(true);
  });

  it("offers Veröffentlichen only to somebody who can publish, schedule or withdraw", () => {
    const has = (role: string) =>
      buildNavigation({ can: canFor(role) }).some((w) => w.destinations.some((d) => d.id === "publish"));
    // `content.history` alone used to show it — to Content Editors and Viewers.
    expect(has("content_editor")).toBe(false);
    expect(has("viewer")).toBe(false);
    expect(has("administrator")).toBe(true); // content.schedule
    expect(has("super_admin")).toBe(true);
  });

  it("does not open System for `system.health` alone — the audit's SYSTEM finding", () => {
    const healthOnly: Can = (p) => p === "system.health" || p === "content.read";
    expect(AUDIENCES.system(healthOnly)).toBe(false);
    expect(buildNavigation({ can: healthOnly }).map((w) => w.id)).not.toContain("system");
  });

  it("shows Hintergrundaufgaben only with `job.read` as well", () => {
    const withoutJobs: Can = (p) => ["system.health", "audit.read"].includes(p);
    const system = buildNavigation({ can: withoutJobs }).find((w) => w.id === "system")!;
    expect(system.destinations.map((d) => d.id)).not.toContain("system-jobs");
  });
});

describe("badges", () => {
  it("puts counts on destinations and sums only the actionable ones onto the workspace", () => {
    const projects = buildNavigation({
      can: () => true,
      badges: { projects: 12, meetings: 2, drawings: 3 },
    }).find((w) => w.id === "projects")!;
    expect(projects.destinations.find((d) => d.id === "projects")?.count).toBe(12);
    // Live projects are a count, not a to-do; minutes to send and plans to check are.
    expect(projects.count).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

describe("search", () => {
  const all = searchIndex({ can: () => true, types: TYPES });
  const first = (q: string) => search(all, q)[0]?.label;

  it.each([
    ["backup", "Sicherungen"],
    ["mail", "E-Mail"],
    ["publ", "Veröffentlichen"],
    ["team", "Team"],
    ["plaene", "Pläne"],
    ["Plän", "Pläne"],
    ["impressum", "Recht und Identität"],
    ["jobs", "Hintergrundaufgaben"],
    ["audit", "Audit-Log"],
    ["rollen", "Rollen"],
  ])("%s → %s", (query, expected) => {
    expect(first(query)).toBe(expected);
  });

  it("normalises German spellings", () => {
    expect(normalise("Pläne")).toBe("plaene");
    expect(normalise("Grösse")).toBe("groesse");
    expect(normalise("Straße")).toBe("strasse");
  });

  it("finds nothing for nothing", () => {
    expect(search(all, "   ")).toEqual([]);
    expect(search(all, "xyzzy")).toEqual([]);
  });
});

describe("search cannot see more than the rail", () => {
  it.each(SEEDED_ROLES.map((r) => r.key))("%s: every search entry is offered", (key) => {
    const can = canFor(key);
    const offeredRoutes = new Set(DESTINATIONS.filter((d) => isOffered(d, can)).map((d) => d.to));
    const website = buildNavigation({ can }).some((w) => w.id === "website");
    for (const entry of searchIndex({ can, types: TYPES })) {
      if (entry.id.startsWith("type:")) {
        expect(website, `${key} found ${entry.label} without the Website workspace`).toBe(true);
      } else {
        expect(offeredRoutes.has(entry.to), `${key} found ${entry.label}`).toBe(true);
      }
    }
  });

  it("a Projektleiter searching 'sicherung' finds nothing", () => {
    const entries = searchIndex({ can: canFor("project_manager"), types: TYPES });
    expect(search(entries, "sicherung")).toEqual([]);
    expect(search(entries, "backup")).toEqual([]);
    // …and no content type either: no Website workspace for them.
    expect(search(entries, "team")).toEqual([]);
  });

  it("a content editor does not find Freigaben or System", () => {
    const entries = searchIndex({ can: canFor("content_editor"), types: TYPES });
    expect(search(entries, "freigaben").map((e) => e.id)).not.toContain("reviews");
    expect(search(entries, "audit")).toEqual([]);
  });
});
