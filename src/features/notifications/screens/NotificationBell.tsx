import { useEffect, useId, useRef, useState } from "react";
import { Button, Spinner } from "@/shared/ui/primitives";
import { cn } from "@/shared/utils/cn";
import { navigate } from "@/core/router";
import {
  useNotificationMutations,
  useNotifications,
  useUnreadCount,
} from "../hooks/useNotifications";
import { badgeCount, bellLabel } from "../service";
import { NotificationItem } from "./NotificationItem";
import type { Notification } from "../types";

/**
 * The header's bell, and the panel behind it.
 *
 * ---
 *
 * ## What it costs when nobody opens it
 *
 * One `count` request a minute, paused while the tab is hidden. **The list
 * is not fetched until the panel opens** — `useNotifications` is disabled
 * behind `open`, so a dashboard that nobody clicks the bell on never asks
 * for a page of notifications at all. That is the difference between a bell
 * that is free and one that is the most expensive thing in the shell.
 *
 * ## A dropdown above `sm`, a full page below it
 *
 * The brief asks for this and it is right: a 380px popover inside a 390px
 * viewport is a modal wearing a dropdown's clothes, with the page scrolling
 * behind it and nothing to grab. Below `sm` the button is a **link to the
 * notification centre** instead — same destination, no floating layer, and
 * the back button works.
 *
 * ## Keyboard and focus
 *
 * Escape closes and returns focus to the trigger; a click outside closes.
 * The panel is not a focus trap, deliberately — it is a menu, not a dialog,
 * and trapping focus in a menu is how somebody gets stuck in a dropdown they
 * cannot tab out of.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const count = useUnreadCount();
  // Only while the panel is open. See above.
  const list = useNotifications(open ? { page: 1, perPage: 8 } : {});
  const { markRead, markAllRead } = useNotificationMutations();

  const rootRef = useRef<HTMLDivElement>(null);
  /*
    `Button` is polymorphic — it renders an `<a>` when given `href` — so its
    forwarded ref is typed as the intersection of both elements. The widened
    type here is what that contract asks for; only `focus()` is ever called
    on it, which both have.
  */
  const triggerRef = useRef<(HTMLButtonElement & HTMLAnchorElement) | null>(null);
  const panelId = useId();

  const unread = count.data ?? 0;
  const badge = badgeCount(unread);

  /*
    Close on Escape and on a click outside.

    Both listeners are attached only while the panel is open: a document
    listener that exists for the lifetime of the shell runs on every click
    in the application to decide it has nothing to do.
  */
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  function openNotification(notification: Notification) {
    setOpen(false);
    if (!notification.read) void markRead(notification.id, true);
    if (notification.link) navigate(notification.link.replace(/^#/, ""));
  }

  return (
    <div ref={rootRef} className="relative">
      {/*
        Below `sm` this is a link to the centre; from `sm` it opens the
        panel. One element rather than two so the badge, the label and the
        icon are defined once.
      */}
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        aria-label={bellLabel(unread)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (window.matchMedia("(max-width: 639px)").matches) {
            navigate("/benachrichtigungen");
            return;
          }
          setOpen((v) => !v);
        }}
        className="relative"
      >
        <svg
          viewBox="0 0 18 18"
          className="h-[18px] w-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {/* A bell: a dome on a rim, with a clapper below. Same 18×18 grid
              and 1.4 stroke as every icon in `navigation.ts`. */}
          <path d="M4.5 12.5V8a4.5 4.5 0 0 1 9 0v4.5M3.2 12.5h11.6M7.4 14.5a1.7 1.7 0 0 0 3.2 0" />
        </svg>

        {badge ? (
          /*
            `brand-navy`, not `brand-bronze` — and this was a real contrast
            failure, not a preference.

            `--c-brand-bronze` is `#75683C` in the light theme and **`#CDB37A`
            in the dark one**, because in dark mode the gold family is a
            *foreground* colour meant to sit on a dark surface. White on it
            measures **2.03:1**, against the 4.5:1 that 10px text needs.

            It survived P2-2 because the badge only renders when the count is
            non-zero, and no spec had produced an unread notification before
            P2-4's acceptance test started raising real ones — so axe had never
            seen this element. `theme.contrast.test.ts` now asserts the pair, so
            the next person to change it is told by the unit suite rather than
            by a browser run twenty minutes in.

            `inverse` on `brand-navy` is the pairing the primary button already
            uses and the one that holds in both themes.
          */
          <span
            aria-hidden
            className={cn(
              "absolute -right-0.5 -top-0.5 grid min-w-[16px] place-items-center rounded-full",
              "bg-brand-navy px-1 text-[10px] font-semibold leading-[16px] text-inverse",
            )}
          >
            {badge}
          </span>
        ) : null}
      </Button>

      {/*
        The count, announced rather than only drawn.

        `role="status"` with `aria-live="polite"` so a change is read out
        when it happens without interrupting. The badge itself is
        `aria-hidden` because `99+` is a glyph; this is the sentence.
      */}
      <span role="status" aria-live="polite" className="sr-only">
        {bellLabel(unread)}
      </span>

      {open ? (
        <div
          id={panelId}
          role="menu"
          aria-label="Benachrichtigungen"
          className={cn(
            "absolute right-0 top-[calc(100%+0.5rem)] z-40 hidden w-[22rem] sm:block",
            "overflow-hidden rounded-lg bg-surface shadow-card ring-1 ring-line",
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="font-display text-[14px] font-semibold text-ink">
              Benachrichtigungen
            </h2>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-[12px] text-brand-blue transition-colors hover:text-brand-bronze"
              >
                Alle als gelesen
              </button>
            ) : null}
          </div>

          <div className="scroll-thin max-h-[26rem] overflow-y-auto">
            {list.loading && !list.data ? (
              <div className="grid h-24 place-items-center text-muted">
                <Spinner />
              </div>
            ) : list.error ? (
              <p role="alert" className="px-4 py-6 text-[13px] text-brand-bronze">
                {list.error}
              </p>
            ) : !list.data?.items.length ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted">
                Nichts Neues. Was hier erscheint, betrifft Ihr Konto oder Ihre Arbeit.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {list.data.items.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    compact
                    onOpen={openNotification}
                    onToggleRead={(n) => void markRead(n.id, !n.read)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-line px-4 py-2.5">
            <a
              href="#/benachrichtigungen"
              onClick={() => setOpen(false)}
              className="text-[13px] text-brand-blue transition-colors hover:text-brand-bronze"
            >
              Alle Benachrichtigungen
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
