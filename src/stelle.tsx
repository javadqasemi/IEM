import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { CodeGate } from "./components/CodeGate";
import { StelleDetail, StelleNichtGefunden } from "./components/StelleDetail";
import { hydrate, useContent } from "./content/iem";
import "./styles/globals.css";

/**
 * Entry point for the job-advert window (`stelle.html?id=…`).
 *
 * A second Vite entry rather than a route: this project has no router, and one
 * static page per opening is all this needs. `id` is matched against the
 * published `openings`, so an address that names a filled position lands on a
 * real message instead of a blank page.
 *
 * The advert is picked inside a component rather than at module scope, which it
 * used to be. The list is published content now: resolving it once on import
 * would pin this window to whatever the bundle was built with and ignore a
 * vacancy added, edited or withdrawn since. Everything else about the page is
 * unchanged — the first paint still comes from the embedded snapshot, so there
 * is nothing to wait for.
 */
const id = new URLSearchParams(window.location.search).get("id");

function StelleSeite() {
  const { openings, stelleLabels } = useContent();
  const opening = openings.find((o) => o.id === id);

  // The tab is often opened beside the register and left there — name it after
  // the position rather than leaving every one of them called "Stelle". In an
  // effect, because it re-runs if a publish renames the advert under the page.
  useEffect(() => {
    document.title = opening
      ? `${opening.detail.titel} — ${stelleLabels.firma}`
      : `${stelleLabels.nichtGefundenTitel} — ${stelleLabels.firma}`;
  }, [opening, stelleLabels]);

  return opening ? <StelleDetail opening={opening} /> : <StelleNichtGefunden />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CodeGate>
      <StelleSeite />
    </CodeGate>
  </StrictMode>,
);

// After first paint, never before it — see `hydrate` in `src/content/store.ts`.
void hydrate();
