import { Badge, Button } from "@/shared/ui/primitives";
import { cn } from "@/shared/utils/cn";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import { severityLabel, severityTone } from "../service";
import type { Notification } from "../types";

/**
 * One notification, in the panel and on the page.
 *
 * The same component in both, because they are the same row read at two
 * sizes — and two components would be two places to fix the unread marker.
 * `compact` drops the body and the severity word, which is the only thing the
 * dropdown genuinely cannot fit.
 *
 * ---
 *
 * **This is an operational feed, not a timeline.** No avatars, no "2 people
 * reacted", no infinite scroll. Every row answers four questions in reading
 * order — *how serious, what happened, when, and what do I do about it* —
 * and anything that does not serve one of those is noise in a list somebody
 * checks between two other tasks.
 *
 * **Unread is marked three ways**, deliberately: a filled dot, a heavier
 * title, and `aria-label` text. Colour alone fails for the reader who cannot
 * see it; weight alone fails in a list where every row is unread; the label
 * is what a screen reader gets, since a dot with no accessible name is
 * nothing at all.
 */
export function NotificationItem({
  notification,
  compact = false,
  onOpen,
  onToggleRead,
}: {
  notification: Notification;
  compact?: boolean;
  /** Navigates and marks read. `undefined` when there is nowhere to go. */
  onOpen?: (notification: Notification) => void;
  onToggleRead?: (notification: Notification) => void;
}) {
  const { read, severity, title, body, link, actorName, createdAt } = notification;

  /*
    The whole row is the control when there is somewhere to go.

    A `<button>` rather than an `<a>`: opening one has to mark it read as
    well as navigate, and an anchor whose click handler does something other
    than follow its href is a link that lies about middle-click. The href is
    still reachable — the title carries it as a real anchor below — so
    "open in a new tab" works where it makes sense.
  */
  const clickable = Boolean(link && onOpen);

  return (
    <li
      className={cn(
        "group relative flex gap-3 px-4 py-3 transition-colors",
        read ? "bg-transparent" : "bg-accent/[0.04]",
        clickable && "hover:bg-surface-2",
      )}
    >
      {/*
        The unread mark, and its accessible name.

        `aria-hidden` on the dot and the state in a visually hidden span, so
        the mark is not announced as a bullet and the state is announced as a
        word.
      */}
      <span className="mt-1.5 shrink-0">
        <span
          aria-hidden
          className={cn(
            "block h-2 w-2 rounded-full",
            read ? "bg-transparent ring-1 ring-line-strong" : "bg-accent",
          )}
        />
        <span className="sr-only">{read ? "Gelesen." : "Ungelesen."}</span>
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {clickable ? (
            <button
              type="button"
              onClick={() => onOpen!(notification)}
              className={cn(
                "min-w-0 text-left text-[14px] leading-snug text-ink hover:underline",
                read ? "font-normal" : "font-semibold",
              )}
            >
              {title}
            </button>
          ) : (
            <span
              className={cn(
                "min-w-0 text-[14px] leading-snug text-ink",
                read ? "font-normal" : "font-semibold",
              )}
            >
              {title}
            </span>
          )}

          {/*
            The severity as a *word*, never as a colour alone.

            Dropped in the compact panel, where the row has no width for it
            and the dot plus the title carry enough — the page below is one
            click away and shows it.
          */}
          {!compact ? (
            <Badge tone={severityTone(severity)}>{severityLabel(severity)}</Badge>
          ) : null}
        </div>

        {!compact && body ? (
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-muted">{body}</p>
        ) : null}

        <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
          {/*
            A relative time with the exact one in the title attribute.

            "vor 3 Minuten" is what a reader wants at a glance and is useless
            three weeks later in an incident review, which is what the
            tooltip and the `dateTime` attribute are for.
          */}
          <time dateTime={createdAt.toISOString()} title={formatDateTime(createdAt.toISOString())}>
            {relativeTime(createdAt.toISOString())}
          </time>
          {actorName ? <span>· {actorName}</span> : null}
        </p>
      </div>

      {onToggleRead ? (
        <div className="shrink-0 self-start">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onToggleRead(notification)}
            /*
              A full sentence naming the notification, because a list of
              fifteen "Als gelesen markieren" buttons is fifteen identical
              announcements with no way to tell which is which.
            */
            aria-label={
              read ? `„${title}“ als ungelesen markieren` : `„${title}“ als gelesen markieren`
            }
            title={read ? "Als ungelesen markieren" : "Als gelesen markieren"}
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {read ? <circle cx="8" cy="8" r="4.5" /> : <path d="M3 8.5 6.5 12 13 4.5" />}
            </svg>
          </Button>
        </div>
      ) : null}
    </li>
  );
}
