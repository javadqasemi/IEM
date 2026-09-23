import { createContext, useContext } from "react";

/**
 * Where a screen's `PageHeader` actions are drawn (P1C, UX-18).
 *
 * The shell's top bar is sticky; the page header is not. Sixteen screens put
 * their actions in `PageHeader.actions` — "Neues Projekt", "+ Einladen", the
 * editor's save — which is to say at the top of a page that scrolls, so the
 * action was out of reach exactly when a long list or a long form had been
 * worked through. `usePageActions` (the sticky alternative) had one caller.
 *
 * So the shell provides this slot — an element in its bar — and `PageHeader`
 * portals its actions into it. Every screen gets sticky actions without being
 * edited, and a screen rendered outside the shell (the smoke test) still gets
 * them inline, because the slot is then `null`.
 */
export const PageActionsSlot = createContext<HTMLElement | null>(null);

export const usePageActionsSlot = () => useContext(PageActionsSlot);
