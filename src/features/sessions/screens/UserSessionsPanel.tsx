import { useState } from "react";
import { toFailure } from "@/core/api";
import { Button, EmptyState, ErrorState, SkeletonTable } from "@/shared/ui/primitives";
import { DataTable } from "@/shared/ui/data";
import { ConfirmDialog } from "@/shared/ui/overlays";
import { useToast } from "@/shared/ui/feedback";
import { useUserSessionMutations, useUserSessions } from "../hooks/useSessions";
import { endButton, sessionColumns } from "./columns";
import type { Session } from "../types";

/**
 * Where somebody *else* is signed in, and how to lock them out.
 *
 * The administrative half of P2-9. It shares `sessionColumns`, the mapper, the
 * DTO and the server's allowlist with the account's own card under "Mein
 * Konto" — what it does not share is the actions, because the two differ in
 * the only way that matters: ending your own session signs you out, and
 * ending somebody else's interrupts a colleague mid-task.
 *
 * ---
 *
 * **It lives in the user dialog rather than on a route, and the cost is
 * stated rather than discovered.** There is no user *detail page* in this
 * application at all — `/benutzer` is a list whose rows open `EditUserDialog`
 * — so a route here would mean inventing that page, which is `P2-7`'s job and
 * not this module's. The cost is the one Aufgaben named for its drawer: **a
 * user's sessions have no shareable URL**, so "look at what is going on with
 * this account" cannot be sent to a colleague as a link. When the detail page
 * arrives this panel moves onto it unchanged, which is why it is a panel and
 * not a dialog of its own.
 *
 * **Nesting a `ConfirmDialog` inside the user dialog is safe here**, and that
 * is a property of the component rather than a hope: `Modal` renders a native
 * `<dialog>` and opens it with `showModal()`, so the browser puts it in the
 * top layer. A second one stacks above the first with its own backdrop and
 * takes Escape for itself. Rolling a bespoke inline confirmation to avoid a
 * problem the platform does not have would have been the wrong caution.
 *
 * **No row is marked "Diese Sitzung" unless it really is.** An administrator
 * reading somebody else's sessions has none of their own among the rows, so
 * the badge never appears — but the same screen reaches their *own* record,
 * and there it does. The server decides it by comparing the presented cookie's
 * hash, so it cannot be marked by accident in either direction.
 */
export function UserSessionsPanel({
  userId,
  userName,
  canRevoke,
  onSelfSignedOut,
}: {
  userId: string | null;
  userName: string;
  /** `user.revokeSessions`. Without it this is a read-only view, not a hidden one. */
  canRevoke: boolean;
  /**
   * Called when the administrator has just ended the session *they* are
   * using, which is only reachable on their own record. The shell has to put
   * them back at the sign-in screen: carrying on would leave this tab holding
   * a refresh token the server has already refused, and the sign-out would
   * arrive minutes later looking like a random one.
   */
  onSelfSignedOut?: () => void;
}) {
  const toast = useToast();
  const sessions = useUserSessions(userId);
  const { revoke, revokeAll } = useUserSessionMutations(userId);

  const [pending, setPending] = useState<Session | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = sessions.data ?? [];

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast.success(success);
      setPending(null);
      setConfirmAll(false);
    } catch (err) {
      setError(toFailure(err).message);
    } finally {
      setBusy(false);
    }
  }

  const columns = sessionColumns({
    currentLabel: "Ihre Sitzung",
    action: (s) =>
      canRevoke ? (
        endButton(() => setPending(s))
      ) : (
        // A dash rather than a disabled button: a control that can never be
        // pressed is an offer the screen cannot keep.
        <span className="text-muted">—</span>
      ),
  });

  return (
    <section className="flex flex-col gap-3" aria-labelledby="user-sessions-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id="user-sessions-heading" className="text-[13px] font-semibold text-ink">
            Aktive Sitzungen
          </h3>
          <p className="text-[12px] leading-relaxed text-muted">
            Wo dieses Konto angemeldet ist. Beendete Sitzungen müssen sich neu anmelden.
          </p>
        </div>
        {canRevoke && rows.length > 0 ? (
          <Button variant="danger-quiet" size="sm" onClick={() => setConfirmAll(true)}>
            Alle beenden ({rows.length})
          </Button>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md bg-brand-bronze/[0.08] px-4 py-3 text-[13px] font-medium leading-relaxed text-brand-bronze ring-1 ring-brand-bronze/25"
        >
          {error}
        </p>
      ) : null}

      {sessions.error ? (
        <ErrorState message={sessions.error} onRetry={sessions.refetch} />
      ) : sessions.loading && !sessions.data ? (
        <SkeletonTable rows={2} cols={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Keine aktiven Sitzungen"
          description="Dieses Konto ist zurzeit nirgends angemeldet."
        />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(s) => s.id}
          error={sessions.error}
          onRetry={sessions.refetch}
          caption={`Aktive Sitzungen von ${userName}`}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        busy={busy}
        onClose={() => {
          setPending(null);
          setError(null);
        }}
        onConfirm={() => {
          if (!pending) return;
          const wasOwnRow = pending.current;
          void run(async () => {
            const { wasCurrent } = await revoke(pending.id);
            if (wasCurrent || wasOwnRow) onSelfSignedOut?.();
          }, "Die Sitzung wurde beendet.");
        }}
        destructive
        confirmLabel={pending?.current ? "Hier abmelden" : "Sitzung beenden"}
        title={pending?.current ? "Ihre eigene Sitzung beenden?" : "Sitzung beenden?"}
        message={
          pending?.current
            ? "Das ist die Sitzung, die Sie gerade verwenden. Sie werden sofort abgemeldet und müssen sich neu anmelden."
            : `„${pending?.device}“ wird abgemeldet. ${userName} muss sich auf diesem Gerät neu anmelden.`
        }
      />

      <ConfirmDialog
        open={confirmAll}
        busy={busy}
        onClose={() => {
          setConfirmAll(false);
          setError(null);
        }}
        onConfirm={() =>
          void run(async () => {
            const count = await revokeAll();
            /*
              "All" genuinely means all, including the administrator's own if
              they are looking at their own record — `logout-all`, not
              `revoke-others`, because there is no "other" to preserve on an
              account that is not yours. On your own record there is, and this
              is the one place the distinction can bite somebody.
            */
            if (rows.some((s) => s.current)) onSelfSignedOut?.();
            return count;
          }, "Alle Sitzungen wurden beendet.")
        }
        destructive
        confirmLabel="Alle beenden"
        title="Alle Sitzungen beenden?"
        message={
          rows.some((s) => s.current)
            ? `Alle ${rows.length} Sitzungen von ${userName} werden beendet — einschliesslich der Sitzung, die Sie gerade verwenden. Sie werden sofort abgemeldet.`
            : `Alle ${rows.length} Sitzungen von ${userName} werden beendet. Die Person wird überall abgemeldet und muss sich neu anmelden.`
        }
      />
    </section>
  );
}
