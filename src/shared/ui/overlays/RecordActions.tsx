import type { ReactNode } from "react";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";

/**
 * The actions of one record, in the standard shape (P1C).
 *
 * ```text
 * [secondary] [secondary] [Mehr ▾]  [Primary]
 * ```
 *
 * - **One primary**: the next step in the record's workflow — Freigeben,
 *   Protokoll genehmigen, Versenden. Absent when there is none for this reader.
 * - **At most two secondaries**: the common, safe actions — Bearbeiten, Neue
 *   Revision.
 * - **Everything else in "Mehr"**, destructive items last. A record header
 *   with seven equal buttons is a header that has not decided what the record
 *   is for.
 *
 * Right-aligned, primary rightmost: the same order as a dialog footer, so the
 * next step is always in the same place. It renders buttons the caller built,
 * because a button that opens a dialog, a link to a sub-route and a download
 * are three different elements and this component should not pretend
 * otherwise.
 */
export function RecordActions({
  primary,
  secondary,
  more = [],
  moreLabel,
}: {
  primary?: ReactNode;
  secondary?: ReactNode;
  more?: ActionMenuItem[];
  moreLabel?: string;
}) {
  if (!primary && !secondary && !more.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2" data-record-actions>
      {secondary}
      {more.length ? <ActionMenu items={more} label={moreLabel} /> : null}
      {primary}
    </div>
  );
}
