import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { ToastProvider } from "./ui/toast";
import "./admin.css";

/**
 * The dashboard's entry point — the third and last Vite input.
 *
 * It mounts its own React root and imports `admin.css`, which selects the
 * dashboard's own Tailwind config. Nothing here is shared with the public
 * site's bundle except the theme tokens and two components (`Wordmark`,
 * `cn`), so the site's payload is unchanged by anything on this side.
 *
 * `ToastProvider` wraps `AuthProvider`, not the other way round: the auth
 * layer has no use for toasts, but a failure surfaced during session restore
 * needs somewhere to go.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
