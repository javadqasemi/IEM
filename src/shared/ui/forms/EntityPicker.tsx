import { markRequirable } from "./requirable";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebounced } from "@/shared/hooks";
import { Combobox, type ComboboxOption } from "./Combobox";

/**
 * "Pick a customer." The control that appears in a dozen modules.
 *
 * A `Combobox` whose options come from a **server** search, which is the whole
 * difference: a project's customer, a task's assignee, a drawing's discipline
 * and a time entry's project are all this, and none of their lists fits in the
 * client. Every one of them would otherwise be written again, slightly
 * differently, and one of them would forget to debounce.
 *
 * Three behaviours it owns so a call site cannot get them wrong:
 *
 * **The selected record survives a search that no longer returns it.** Type
 * three letters and the option list changes; the thing already chosen must not
 * silently vanish from the input. It is kept as a pinned option until it is
 * replaced.
 *
 * **A stale response never wins.** Typing "Mei" then "Meier" fires two
 * searches and they can land in either order; the earlier one is dropped, the
 * same guard `useAsync` carries for exactly this reason.
 *
 * **Nothing is fetched until it is opened.** A form with six pickers on it
 * would otherwise make six requests before the reader has looked at any of
 * them.
 */

export type EntityOption = ComboboxOption;

export function EntityPicker({
  id,
  value,
  /** The chosen record, for the label. Absent while the parent is still loading it. */
  selected,
  onChange,
  search,
  placeholder = "Suchen …",
  emptyLabel = "Nichts gefunden",
  disabled,
  invalid,
  className,
  "aria-describedby": describedBy,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
}: {
  id: string;
  /** From `Field`, passed through to the input — see `Combobox`. */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  value: string | null;
  selected?: EntityOption | null;
  onChange: (next: string | null, option: EntityOption | null) => void;
  /** Returns matches for a term. Called on a pause, never on a keystroke. */
  search: (query: string) => Promise<EntityOption[]>;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const debounced = useDebounced(query);

  // Monotonic, so a response that started earlier cannot overwrite a later one.
  const run = useRef(0);
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    if (!touched) return;
    const id = ++run.current;
    setLoading(true);
    searchRef
      .current(debounced)
      .then((found) => {
        if (id !== run.current) return;
        setResults(found);
        setLoading(false);
      })
      .catch(() => {
        if (id !== run.current) return;
        // A failed lookup shows an empty list, not an error: the field is one
        // control on a form, and a banner over the whole form because a search
        // failed would bury whatever the reader was actually doing.
        setResults([]);
        setLoading(false);
      });
  }, [debounced, touched]);

  /**
   * The results, with the current selection pinned in front of them.
   *
   * Without this, choosing "Meier AG" and then typing "Bau" leaves the input
   * showing nothing at all — `Combobox` reads the label out of the option list,
   * and the chosen record is no longer in it.
   */
  const options = useMemo(() => {
    if (!selected || results.some((o) => o.value === selected.value)) return results;
    return [selected, ...results];
  }, [results, selected]);

  return (
    <Combobox
      id={id}
      options={options}
      value={value}
      loading={loading}
      disabled={disabled}
      invalid={invalid}
      aria-describedby={describedBy}
      aria-invalid={ariaInvalid}
      aria-required={ariaRequired}
      placeholder={placeholder}
      emptyLabel={emptyLabel}
      className={className}
      onOpen={() => setTouched(true)}
      onQueryChange={(next) => {
        setTouched(true);
        setQuery(next);
      }}
      onChange={(next) => onChange(next, options.find((o) => o.value === next) ?? null)}
    />
  );
}

// Passes `aria-required` to a real input — see `requirable.ts`.
markRequirable(EntityPicker);
