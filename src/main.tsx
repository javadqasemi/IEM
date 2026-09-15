import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { CodeGate } from "./components/CodeGate";
import { hydrate } from "./content/iem";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CodeGate>
      <App />
    </CodeGate>
  </StrictMode>,
);

/**
 * Fetch the published content **after** the first render has been queued, never
 * before it.
 *
 * The store is already seeded with the snapshot the build embedded, so the page
 * paints complete and correct without this call. Awaiting it here — or gating
 * the render on it — would turn a static first paint into a network round trip
 * and put a spinner where the headline is, which is the one thing the CMS
 * migration was not allowed to do. With `VITE_CMS_API` unset it is a no-op.
 */
void hydrate();
