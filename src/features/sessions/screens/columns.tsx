import { Badge, Button } from "@/shared/ui/primitives";
import type { Column } from "@/shared/ui/data";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import type { Session } from "../types";

/**
 * What a session row looks like, in the one place both screens read it from.
 *
 * There are two session tables — the account's own under "Mein Konto" and an
 * administrator's under a user — and they differ only in which actions sit at
 * the end of the row. Everything else is the same four cells, and the brief's
 * rule and this codebase's agree: a second `SessionsTable` would be a second
 * copy of the loading, empty, caption and responsive behaviour `DataTable`
 * already has, and a second copy of these cells to keep in step with it.
 *
 * So the *table* is `DataTable` and the *cells* are here. What each screen
 * still owns is its actions and its confirmations, which is right, because
 * that is exactly where the two genuinely differ: ending your own session
 * signs you out, and ending somebody else's interrupts them.
 *
 * **"Zuletzt aktiv", never "Angemeldet seit".** The server sends the last
 * rotation — a `RefreshToken` row is replaced on every refresh — and the
 * sign-in time would need the chain walked back through an unindexed column.
 * Labelling a rotation as a sign-in would be a plausible-looking lie, which is
 * the one thing a security screen must not contain.
 */
export function sessionColumns(options: {
  /** Rendered in the last cell. The only thing the two screens disagree on. */
  action: (session: Session) => React.ReactNode;
  /**
   * What the badge on the caller's own row says, or `null` for a table where
   * no row can be the caller's.
   *
   * An administrator reading somebody else's sessions has none of their own
   * among them, so the badge would never appear — but their *own* record is
   * reachable from the same screen, and there it must.
   */
  currentLabel?: string;
}): Column<Session>[] {
  const { action, currentLabel = "Diese Sitzung" } = options;

  return [
    {
      key: "device",
      header: "Gerät",
      required: true,
      render: (s) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-ink">{s.device}</span>
          {s.current ? <Badge tone="navy">{currentLabel}</Badge> : null}
        </span>
      ),
    },
    {
      key: "ip",
      header: "IP-Adresse",
      secondary: true,
      render: (s) => <span className="tabular-nums text-muted">{s.ip ?? "—"}</span>,
    },
    {
      key: "lastActiveAt",
      header: "Zuletzt aktiv",
      render: (s) => (
        <span className="text-muted" title={formatDateTime(s.lastActiveAt)}>
          {relativeTime(s.lastActiveAt)}
        </span>
      ),
    },
    {
      key: "expiresAt",
      header: "Läuft ab",
      secondary: true,
      render: (s) => <span className="text-muted">{formatDateTime(s.expiresAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (s) => <div className="flex justify-end">{action(s)}</div>,
    },
  ];
}

/** The row action both screens happen to want: a quiet "Beenden". */
export function endButton(onClick: () => void) {
  return (
    <Button size="sm" variant="danger-quiet" onClick={onClick}>
      Beenden
    </Button>
  );
}
