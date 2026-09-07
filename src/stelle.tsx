import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CodeGate } from "./components/CodeGate";
import { StelleDetail, StelleNichtGefunden } from "./components/StelleDetail";
import { openings } from "./content/iem";
import "./styles/globals.css";

/**
 * Entry point for the job-advert window (`stelle.html?id=…`).
 *
 * A second Vite entry rather than a route: this project has no router, and one
 * static page per opening is all this needs. `id` comes from `openings`, so an
 * address that names a filled position lands on a real message instead of a
 * blank page.
 */
const id = new URLSearchParams(window.location.search).get("id");
const opening = openings.find((o) => o.id === id);

// The tab is often opened beside the register and left there — name it after
// the position rather than leaving every one of them called "Stelle".
document.title = opening ? `${opening.detail.titel} — IEM AG` : "Stelle nicht gefunden — IEM AG";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CodeGate>{opening ? <StelleDetail opening={opening} /> : <StelleNichtGefunden />}</CodeGate>
  </StrictMode>,
);
