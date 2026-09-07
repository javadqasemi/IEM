import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { CodeGate } from "./components/CodeGate";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CodeGate>
      <App />
    </CodeGate>
  </StrictMode>,
);
