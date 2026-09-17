import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminLayout } from "./layout/AdminLayout";
import { ToastProvider } from "./ui/toast";
import { AuthProvider } from "./lib/auth";
import type { NavSection } from "./lib/navigation";

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
 *   and it is why the shell is rendered directly with a hand-built `sections`
 *   array rather than through `App`, which would show the signed-out screen.
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
      // `useTheme` reads both during render. Each access is already wrapped in
      // try/catch, so the stub only has to not be a trap — but returning real
      // shapes keeps the test honest about the light default.
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

/** A menu shaped like the real one, without needing a server to build it. */
const SECTIONS: NavSection[] = [
  {
    id: "overview",
    label: "Übersicht",
    icon: "overview",
    zone: "work",
    to: "/",
    permissions: ["system.health"],
    items: [],
  },
  {
    id: "people",
    label: "Benutzer & Rollen",
    icon: "users",
    zone: "admin",
    permissions: ["user.read"],
    items: [
      { id: "users", to: "/benutzer", label: "Benutzer", permissions: ["user.read"] },
      { id: "roles", to: "/rollen", label: "Rollen", permissions: ["role.read"] },
    ],
  },
];

function render(): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <AuthProvider>
        <AdminLayout sections={SECTIONS}>
          <p>Inhalt</p>
        </AdminLayout>
      </AuthProvider>
    </ToastProvider>,
  );
}

describe("the dashboard shell renders", () => {
  let html = "";
  beforeAll(() => {
    html = render();
  });

  it("does not throw", () => {
    expect(html.length).toBeGreaterThan(500);
  });

  it("renders the children", () => {
    expect(html).toContain("Inhalt");
  });

  it("renders the rail's groups", () => {
    expect(html).toContain("Übersicht");
    expect(html).toContain("Benutzer &amp; Rollen");
  });

  it("keeps the skip link first", () => {
    // The first focusable thing on the page, and the only way a keyboard user
    // skips a thirteen-row rail. Easy to lose to a layout change and invisible
    // when it goes.
    expect(html).toContain("Zum Inhalt springen");
    expect(html.indexOf("Zum Inhalt springen")).toBeLessThan(html.indexOf("Inhalt</p>"));
  });

  it("uses the theme tokens rather than hardcoded colours", () => {
    // The whole point of the token migration: the markup says `bg-base`, and
    // what `base` means is decided by the stylesheet. A literal hex or an
    // `rgb(` in a class attribute would mean something bypassed it.
    expect(html).toContain("bg-base");
    expect(html).not.toMatch(/class="[^"]*#[0-9a-fA-F]{6}/);
  });

  it("puts the rail's labels on the inverse token, not on surface", () => {
    // `text-surface` on the rail would be dark-on-dark in the dark theme. All
    // twenty call sites moved to `text-inverse`; this is the one that would be
    // noticed last, because the rail looks fine in the light theme either way.
    expect(html).toContain("text-inverse");
    expect(html).not.toContain("text-surface");
  });
});

/**
 * The rail's groups fold open in place.
 *
 * Asserted through a real render rather than by reading the component, because
 * the behaviour that matters is a *derivation*: which group is open is computed
 * from the path during render, not stored. A test that called a helper would
 * miss the wiring, which is the part that broke when the entries lived in the
 * top bar.
 */
describe("the rail folds a group open", () => {
  it("offers a disclosure on a group with several entries", () => {
    at("#/");
    const html = render();
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Benutzer &amp; Rollen aufklappen");
  });

  it("keeps a group's entries out of the DOM while it is closed", () => {
    // Unmounted rather than hidden: the rail's arrow-key navigation reads
    // `[data-nav-link]` off the DOM, so a hidden entry would be a stop on a
    // journey through rows nobody can see.
    at("#/");
    expect(render()).not.toContain('href="#/rollen"');
  });

  it("opens the group the current route is in, with no stored state", () => {
    at("#/benutzer");
    const html = render();
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('href="#/rollen"');
    expect(html).toContain("Benutzer &amp; Rollen zuklappen");
  });

  it("marks the open entry as the current page", () => {
    at("#/rollen");
    const html = render();
    expect(html).toContain('href="#/rollen"');
    expect(html).toMatch(/href="#\/rollen"[^>]*aria-current="page"/);
  });

  it("does not fold a group that is a single destination", () => {
    // "Übersicht" is one page. A disclosure on it would be a control that
    // reveals nothing.
    at("#/");
    const html = render();
    const overview = html.slice(html.indexOf("Übersicht") - 400, html.indexOf("Übersicht"));
    expect(overview).not.toContain("aufklappen");
  });

  it("no longer renders the entries a second time in the top bar", () => {
    // `SectionTabs` was removed with this change. Two copies of one navigation
    // is what the choice between them was about.
    at("#/benutzer");
    const html = render();
    expect(html).not.toContain("Unterbereiche");
    expect((html.match(/href="#\/rollen"/g) ?? []).length).toBe(1);
  });
});
