import { useEffect, useRef } from "react";
import { cn } from "@/shared/utils/cn";
import { Link } from "@/core/router";
import type { NavWorkspace } from "../lib/navigation";

/**
 * The open workspace's destinations as one scrolling row — below `lg` only.
 *
 * On a laptop the rail shows them, nested under the workspace. Below `lg` the
 * rail is a drawer, and reaching *Pläne* from *Sitzungen* would cost opening
 * it; so the same destinations, from the same registry entry, sit above the
 * page as a strip. It is the one workspace navigation, drawn where it is
 * reachable — not a second menu with rules of its own.
 *
 * Real links with `aria-current`, in a named `<nav>`, like `SideNav`: each
 * destination is a URL somebody bookmarks, and the active one has to be
 * announced as well as drawn. The strip scrolls sideways rather than wrapping,
 * and the active item is scrolled into view, so a long German label never
 * pushes the page wider than the screen.
 */
export function WorkspaceStrip({
  workspace,
  activeDestination,
}: {
  workspace: NavWorkspace;
  activeDestination: string | null;
}) {
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    nav.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeDestination]);

  return (
    <nav
      ref={nav}
      aria-label={`Bereiche in ${workspace.label}`}
      className="scroll-thin -mx-4 -mt-2 flex gap-1 overflow-x-auto border-b border-line px-4 lg:hidden"
    >
      {workspace.destinations.map((destination) => {
        const active = destination.id === activeDestination;
        return (
          <Link
            key={destination.id}
            to={destination.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[14px] transition-colors",
              active
                ? "border-brand-blue font-medium text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {destination.label}
            {destination.count ? (
              <span className="rounded-full bg-surface-2 px-1.5 font-mono text-[11px] tnum text-muted">
                {destination.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
