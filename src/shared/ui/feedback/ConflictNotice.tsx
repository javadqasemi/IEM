import { Button } from "@/shared/ui/primitives";

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
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-md bg-brand-bronze/[0.08] px-4 py-3 ring-1 ring-brand-bronze/25"
    >
      <div className="flex flex-col gap-1">
        <p className="text-[14px] font-semibold text-ink">Inzwischen von jemand anderem geändert</p>
        <p className="text-[13px] leading-relaxed text-muted">{message}</p>
        <p className="text-[13px] leading-relaxed text-muted">
          Ihre Eingaben stehen unten noch, sind aber <strong className="font-medium text-ink">nicht gespeichert</strong>.
          Übernehmen Sie, was Sie behalten möchten, nach dem Laden in die neue Fassung.
          {compareHint ? ` ${compareHint}` : null}
        </p>
      </div>
      <div>
        <Button size="sm" variant="secondary" onClick={onReload}>
          Neueste Fassung laden
        </Button>
      </div>
    </div>
  );
}

/** The sentence a blocked save button carries while a conflict is shown. */
export const CONFLICT_BLOCKS_SAVE = "Erst die neueste Fassung laden — dieser Stand ist überholt.";
