import { markRequirable } from "./requirable";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/shared/utils/cn";
import { Spinner } from "@/shared/ui/primitives";

/**
 * A filtering single-select, on the ARIA combobox pattern.
 *
 * The one place this project builds a control the platform already has a
 * version of, and the reason is narrow: `<select>` cannot filter. A list of
 * eight activity types is a `<Select>` and should stay one; a list of 400
 * employees is a scroll nobody can use. The rule is the same one
 * `inputs.tsx` states — native until native genuinely cannot do it.
 *
 * Because it is hand-built, the keyboard is the whole specification and is
 * written out rather than assumed:
 *
 * | Key | Does |
 * | --- | --- |
 * | ↓ / ↑ | move the active option, opening the list if it is shut |
 * | Home / End | first / last option |
 * | Enter | choose the active option |
 * | Esc | shut the list, keep the value |
 * | Tab | shut the list and move on, keeping the value |
 *
 * `aria-activedescendant` rather than moving focus: focus stays in the input
 * so typing continues to filter, which is what makes this different from a
 * menu. The active option is scrolled into view by hand, because nothing has
 * focus to scroll to.
 */

export type ComboboxOption = {
  value: string;
  label: string;
  /** A second line — a customer's town, an employee's department. */
  hint?: string;
  disabled?: boolean;
};

export function Combobox({
  id,
  options,
  value,
  onChange,
  onQueryChange,
  onOpen,
  placeholder = "Suchen oder auswählen",
  loading,
  disabled,
  invalid,
  clearable = true,
  emptyLabel = "Nichts gefunden",
  className,
  "aria-describedby": describedBy,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
}: {
  id: string;
  /*
    Supplied by `Field`, which clones its child with them. A composite control
    has to hand them to its real `<input>` itself — before P1C this one
    dropped them, so a picker's hint and error were never announced and the
    "Field owns the relationship" promise held for every control but this.
  */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  options: ComboboxOption[];
  value: string | null;
  onChange: (next: string | null) => void;
  /**
   * Given, the caller owns the filtering — this is how `EntityPicker` searches
   * on the server. Absent, the options are filtered here.
   */
  onQueryChange?: (query: string) => void;
  /** Fired when the list is first revealed — `EntityPicker` searches on it. */
  onOpen?: () => void;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  clearable?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const visible = useMemo(() => {
    if (onQueryChange) return options;
    const needle = query.trim().toLocaleLowerCase("de-CH");
    if (!needle) return options;
    return options.filter(
      (o) =>
        o.label.toLocaleLowerCase("de-CH").includes(needle) ||
        o.hint?.toLocaleLowerCase("de-CH").includes(needle),
    );
  }, [options, query, onQueryChange]);

  // Clamped rather than reset: filtering down to fewer options must not leave
  // `aria-activedescendant` pointing at an id that is no longer rendered,
  // which a screen reader announces as nothing at all.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, visible.length - 1)));
  }, [visible.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // `pointerdown`, not `click`: a click that starts inside the list and ends
    // outside it would otherwise shut the list before the choice registers.
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (option: ComboboxOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + visible.length) % Math.max(1, visible.length));
      return;
    }
    if (e.key === "Home" && open) {
      e.preventDefault();
      setActive(0);
      return;
    }
    if (e.key === "End" && open) {
      e.preventDefault();
      setActive(Math.max(0, visible.length - 1));
      return;
    }
    if (e.key === "Enter" && open) {
      e.preventDefault();
      const option = visible[active];
      if (option) choose(option);
      return;
    }
    if (e.key === "Escape" && open) {
      // Stopped, or a `<dialog>` above this would close too — a combobox
      // inside a drawer must not dismiss the drawer on its first Esc.
      e.stopPropagation();
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && visible[active] ? `${listId}-${active}` : undefined}
          aria-invalid={invalid || ariaInvalid || undefined}
          aria-describedby={describedBy}
          aria-required={ariaRequired || undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className={cn("field-input pr-16", invalid && "field-input-error")}
          placeholder={selected ? undefined : placeholder}
          value={open ? query : (selected?.label ?? "")}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
            onQueryChange?.(e.target.value);
          }}
          onFocus={() => {
            setOpen(true);
            onOpen?.();
          }}
          onKeyDown={onKeyDown}
        />

        <div className="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {loading ? <Spinner className="h-3.5 w-3.5 text-muted" /> : null}
          {clearable && selected && !disabled ? (
            <button
              type="button"
              aria-label="Auswahl aufheben"
              onClick={() => {
                onChange(null);
                setQuery("");
              }}
              className="pointer-events-auto grid h-5 w-5 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                <path d="M4 4 L12 12 M12 4 L4 12" />
              </svg>
            </button>
          ) : null}
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="h-3 w-3 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6 L8 10 L12 6" />
          </svg>
        </div>
      </div>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="scroll-thin absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-md bg-surface py-1 shadow-card ring-1 ring-line"
        >
          {visible.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-muted">{loading ? "Wird geladen …" : emptyLabel}</li>
          ) : (
            visible.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                data-active={index === active}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(option)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex cursor-pointer flex-col gap-0.5 px-3 py-2 text-[14px]",
                  option.disabled && "cursor-not-allowed text-muted",
                  index === active && !option.disabled && "bg-surface-2",
                  option.value === value && "font-medium text-accent",
                )}
              >
                <span className="truncate">{option.label}</span>
                {option.hint ? (
                  <span className="truncate text-[12px] text-muted">{option.hint}</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

// Passes `aria-required` to a real input — see `requirable.ts`.
markRequirable(Combobox);
