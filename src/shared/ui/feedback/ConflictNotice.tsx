import { Button } from "@/shared/ui/primitives";
import { Callout } from "./Callout";

/**
 * A 409, said in place — above the form, with the form still there.
 *
 * ---
 *
 * **What it replaced.** Five edit dialogs answered a conflict by swapping the
 * whole form for a second dialog whose only way forward was
 * `window.location.reload()` (UX-15). Two things were wrong with that, and
 * neither was the refusal itself, which is correct:
 *
 * - The reader's input vanished the moment the conflict was reported, before
 *   they had a chance to see what they had typed — the one thing that would
 *   let them re-enter it into the newer version.
 * - A full page reload is the heaviest possible answer to "one record is
 *   newer": it drops every other screen's cache, restarts the SPA, re-runs
 *   the session refresh, and — on a test run — spends a refresh from a budget
 *   that has signed people out before.
 *
 * So the form stays, read-only in spirit (its save is blocked with a reason),
 * and this banner offers the newer version. `onReload` refetches the record
 * in place (`revalidate`, which keeps what is on screen until the fresh copy
 * lands) and closes the dialog; the reader reopens it on the new version.
 *
 * **What it deliberately does not offer: "save anyway".** A button that
 * resubmitted with the new version would be a two-click way to do exactly the
 * overwrite the lock exists to prevent — and it would look like the safe
 * option, which is worse. The history of the record is where a comparison
 * lives; `compareHint` says where.
 */
export function ConflictNotice({
  message,
  onReload,
  compareHint,
}: {
  /** The server's sentence. */
  message: string;
  /** Refetch the record and leave the form. */
  onReload: () => void;
  /** Where the changes can be read — "Der Verlauf des Projekts zeigt …". */
  compareHint?: string;
}) {
  /*
    On `Callout` since P1C: the one shared box, announced because it appears
    *because* the reader pressed save. The copy is the standard's two
    sentences — the record changed elsewhere; your input has not been
    discarded — and it is the only conflict UI in the dashboard. A future
    lock (content entries, P2) reuses it rather than drawing its own.
  */
  return (
    <Callout
      tone="warning"
      announce
      title="Inzwischen von jemand anderem geändert"
      actions={
        <Button size="sm" variant="secondary" onClick={onReload}>
          Neueste Fassung laden
        </Button>
      }
    >
      <p>{message}</p>
      <p>
        Ihre Eingaben stehen unten noch, sind aber <strong>nicht gespeichert</strong>. Übernehmen
        Sie, was Sie behalten möchten, nach dem Laden in die neue Fassung.
        {compareHint ? ` ${compareHint}` : null}
      </p>
    </Callout>
  );
}

/** The sentence a blocked save button carries while a conflict is shown. */
export const CONFLICT_BLOCKS_SAVE = "Erst die neueste Fassung laden — dieser Stand ist überholt.";
