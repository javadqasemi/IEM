import { useMemo, useState } from "react";
import { Button, Card, EmptyState, ErrorState, SkeletonTable } from "@/shared/ui/primitives";
import { DataTable } from "@/shared/ui/data";
import { ConfirmDialog } from "@/shared/ui/overlays";
import { useToast } from "@/shared/ui/feedback";
import { useSessionMutations, useSessions } from "../hooks/useSessions";
import { endButton, sessionColumns } from "./columns";
import type { Session } from "../types";

/**
 * Where this account is signed in, and how to end any of it.
 *
 * Built from the shared primitives rather than as its own table — `DataTable`
 * already has the loading, empty and error shapes, the caption and the
 * responsive behaviour, and a `SessionsTable` would be a fourth copy of all
 * of it. The brief's rule and the codebase's agree here. The *cells* are in
 * `columns.tsx` for the same reason once more, because the administrator's
 * `UserSessionsPanel` renders the same four and they have to say the same
 * thing in both places — including "Zuletzt aktiv", which is a claim about
 * what the server can honestly report rather than a label.
 *
 * What stays here is what the two screens genuinely disagree about: the
 * actions and the confirmations.
 *
 * **The current session is pinned to the top and marked.** It is the row a
 * reader is looking for in order to *avoid* it, and hunting for it down a
 * list of twenty identical "Chrome auf Windows" entries is how somebody ends
 * the session they are using by accident.
 *
 * **Ending it anyway is allowed**, with a different confirmation that says
 * what will happen. Refusing would send the reader to the sign-out menu to
 * achieve the same thing by another route, which teaches them the screen is
 * lying about what it can do.
 */
export function SessionsCard({ onSignedOut }: { onSignedOut?: () => void }) {
  const toast = useToast();
  const sessions = useSessions();
  const { revoke, revokeOthers } = useSessionMutations();

  const [pending, setPending] = useState<Session | null>(null);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => sessions.data ?? [], [sessions.data]);
  const others = rows.filter((s) => !s.current).length;

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast.success(success);
      setPending(null);
      setConfirmOthers(false);
    } catch (err) {
      // In place, not as a toast: the message names what to do about it and
      // the reader is still looking at the row it refers to.
      setError(err instanceof Error ? err.message : "Unbekannter Fehler.");
    } finally {
      setBusy(false);
    }
  }

  const columns = sessionColumns({ action: (s) => endButton(() => setPending(s)) });

  if (sessions.error) {
    return <ErrorState message={sessions.error} onRetry={sessions.refetch} />;
  }

  return (
    <>
      <Card
        title="Aktive Sitzungen"
        description="Jede Anmeldung an diesem Konto — auf diesem Gerät und auf allen anderen. Was Sie hier beenden, muss sich neu anmelden."
        action={
          others > 0 ? (
            <Button variant="secondary" onClick={() => setConfirmOthers(true)}>
              Andere beenden ({others})
            </Button>
          ) : null
        }
        bodyClassName="p-0"
      >
        {error ? (
          <p
            role="alert"
            className="m-5 rounded-md bg-brand-bronze/[0.08] px-4 py-3 text-[13px] font-medium leading-relaxed text-brand-bronze ring-1 ring-brand-bronze/25"
          >
            {error}
          </p>
        ) : null}

        {sessions.loading && !sessions.data ? (
          <div className="p-5">
            <SkeletonTable rows={3} cols={5} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Keine aktiven Sitzungen"
              description="Das sollte nicht vorkommen, solange Sie angemeldet sind — laden Sie die Seite neu."
            />
          </div>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(s) => s.id}
            caption="Aktive Sitzungen dieses Kontos"
          />
        )}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        busy={busy}
        onClose={() => {
          setPending(null);
          setError(null);
        }}
        onConfirm={() => {
          if (!pending) return;
          const wasCurrentRow = pending.current;
          void run(async () => {
            const { wasCurrent } = await revoke(pending.id);
            // Ending your own session means this tab is holding a refresh
            // token the server has just refused. Saying so now beats a
            // mysterious sign-out at the next rotation.
            if (wasCurrent || wasCurrentRow) onSignedOut?.();
          }, "Die Sitzung wurde beendet.");
        }}
        destructive
        confirmLabel={pending?.current ? "Hier abmelden" : "Sitzung beenden"}
        title={pending?.current ? "Diese Sitzung beenden?" : "Sitzung beenden?"}
        message={
          pending?.current
            ? "Das ist die Sitzung, die Sie gerade verwenden. Sie werden sofort abgemeldet und müssen sich neu anmelden."
            : `„${pending?.device}“ wird abgemeldet und muss sich neu anmelden. Falls Sie dieses Gerät nicht kennen, ändern Sie anschliessend Ihr Passwort.`
        }
      />

      <ConfirmDialog
        open={confirmOthers}
        busy={busy}
        onClose={() => {
          setConfirmOthers(false);
          setError(null);
        }}
        onConfirm={() =>
          void run(async () => {
            const count = await revokeOthers();
            return count;
          }, "Die anderen Sitzungen wurden beendet.")
        }
        destructive
        confirmLabel="Andere beenden"
        title="Alle anderen Sitzungen beenden?"
        message={`${others} andere Sitzung(en) werden abgemeldet. Diese hier bleibt bestehen, Sie arbeiten ohne Unterbrechung weiter.`}
      />
    </>
  );
}
