import { ToastProvider } from "@/shared/ui/feedback";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminLayout } from "./layout/AdminLayout";
import { AuthProvider } from "@/core/auth";
import { buildNavigation } from "./lib/navigation";
import { canFor } from "./lib/seededRoles.testing";

/**
 * Does the dashboard shell still render?
 *
 * `docs/ARCHITECTURE.md` → *Verifying a change* describes this as a Node script
 * run by hand; this is the same check as a test, so it runs in `npm run verify`
 * rather than when someone remembers. It is the strongest check available
 * without a browser, and it exists because a typecheck cannot catch a component
 * that throws on mount — which is what a blank dashboard actually is.
 *
 * Two things about the environment, both from CLAUDE.md and both load-bearing:
 *
 * - The `window` stub needs **both** `location.hash` and `location.origin`.
 *   `useRoute` in `lib/router.tsx` reads the first and `lib/api.ts` reads the
 *   second when it builds a request URL; a stub with only one fails on
 *   whichever runs first.
 * - Effects do not run under `renderToStaticMarkup`, so the session stays empty
 *   and `UserMenu` renders nothing. That is fine for what is asserted here —
 *   and it is why the shell is rendered directly with a real, role-derived
 *   `workspaces` list rather than through `App`, which would show the
 *   signed-out screen.
 */

const REAL_WINDOW = globalThis.window;

/** Points the stubbed router at a path before a render. */
function at(hash: string) {
  (globalThis.window as unknown as { location: { hash: string } }).location.hash = hash;
}

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      location: { hash: "#/", origin: "http://localhost:5173" },
      addEventListener: () => {},
      removeEventListener: () => {},
      localStorage: { getItem: () => null, setItem: () => {} },
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    },
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: REAL_WINDOW,
  });
});

function render(role = "super_admin"): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <AuthProvider>
        <AdminLayout workspaces={buildNavigation({ can: canFor(role) })}>
          <p>Inhalt</p>
        </AdminLayout>
      </AuthProvider>
    </ToastProvider>,
  );
}

describe("the dashboard shell renders", () => {
  let html = "";
  beforeAll(() => {
    at("#/");
    html = render();
  });

  it("does not throw", () => {
    expect(html.length).toBeGreaterThan(500);
  });

  it("renders the children", () => {
    expect(html).toContain("Inhalt");
  });

  it("renders the seven workspaces", () => {
    for (const label of ["Übersicht", "Aufgaben", "Projekte", "Website", "Personal", "Unternehmen", "System"]) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it("keeps the skip link first", () => {
    // The first focusable thing on the page, and the only way a keyboard user
    // skips the rail. Easy to lose to a layout change and invisible when it goes.
    expect(html).toContain("Zum Inhalt springen");
    expect(html.indexOf("Zum Inhalt springen")).toBeLessThan(html.indexOf("Inhalt</p>"));
  });

  it("uses the theme tokens rather than hardcoded colours", () => {
    expect(html).toContain("bg-base");
    expect(html).not.toMatch(/class="[^"]*#[0-9a-fA-F]{6}/);
  });

  it("puts the rail's labels on the inverse token, not on surface", () => {
    expect(html).toContain("text-inverse");
    expect(html).not.toContain("text-surface");
  });
});

/**
 * One workspace open at a time, and it is the one the route is in.
 *
 * Asserted through a real render because the behaviour is a *derivation*:
 * which workspace is open is computed from the path during render, not stored.
 */
describe("the rail opens the route's workspace", () => {
  it("lists a closed workspace's destinations nowhere", () => {
    at("#/");
    const html = render();
    expect(html).not.toContain('href="#/rollen"');
    expect(html).not.toContain('href="#/sitzungen"');
  });

  it("opens the workspace a detail route belongs to", () => {
    at("#/plaene/abc/revisionen");
    const html = render();
    expect(html).toContain('href="#/sitzungen"');
    expect(html).toMatch(/href="#\/plaene"[^>]*aria-current="page"/);
    // …and names it in the bar.
    expect(html).toMatch(/<h2[^>]*>Projekte<\/h2>/);
  });

  it("links to each destination once — the open workspace's row is not a second link", () => {
    /*
      Two adjacent links to one page is the duplicated navigation a browser
      test once caught as a strict-mode violation. The open workspace names
      itself as text; its first destination is the one link to that page.
    */
    at("#/benutzer");
    const html = render();
    const rail = html.slice(html.indexOf('aria-label="Hauptnavigation"'), html.indexOf("Website ansehen"));
    expect((rail.match(/href="#\/benutzer"/g) ?? []).length).toBe(1);
  });

  it("opens System for a settings section it owns, and Unternehmen for one it owns", () => {
    at("#/einstellungen/email");
    expect(render()).toMatch(/<h2[^>]*>System<\/h2>/);
    at("#/einstellungen/standorte");
    expect(render()).toMatch(/<h2[^>]*>Unternehmen<\/h2>/);
  });

  it("gives a content editor two workspaces and no System", () => {
    at("#/");
    const html = render("content_editor");
    expect(html).toContain(">Website<");
    expect(html).not.toContain(">System<");
    expect(html).not.toContain(">Projekte<");
  });
});
