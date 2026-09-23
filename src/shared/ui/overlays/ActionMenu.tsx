import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";
import { Button, type ButtonVariant } from "@/shared/ui/primitives";

/**
 * A "Mehr" menu for the infrequent actions of a record (P1C).
 *
 * Before this the dashboard had no action menu at all (Part 11.1), so a record
 * screen put every action it had in a row of buttons — seven across a header
 * on a wide screen, three wrapped rows on a phone, the rarely-used ones
 * weighing as much as the next step. `RecordActions` keeps one primary and
 * one or two secondaries visible and puts the rest here.
 *
 * The WAI-ARIA *menu button* pattern, written out because it is hand-built:
 *
 * | Key | Does |
 * | --- | --- |
 * | Enter / Space / ↓ on the button | open, focus the first item |
 * | ↑ on the button | open, focus the last item |
 * | ↓ / ↑ | next / previous item, wrapping |
 * | Home / End | first / last item |
 * | Enter / Space on an item | run it, close, return focus to the button |
 * | Esc | close, return focus to the button |
 * | Tab | close and move on |
 *
 * Destructive items come last, after a separator, in the bronze of a
 * destructive trigger — the menu is the trigger; whatever it opens (a
 * `ConfirmDialog`, a `StatusTransitionDialog`) is the confirmation. A
 * disabled item stays in the list with its reason, like a disabled button.
 */
export type ActionMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  /** Keeps the item listed but inert, with the reason in visible text. */
  disabledReason?: string | null;
};

export function ActionMenu({
  items,
  label = "Mehr",
  variant = "secondary",
  size = "sm",
  align = "end",
}: {
  items: ActionMenuItem[];
  /** The button's visible text. Always a word, never only "⋯". */
  label?: string;
  variant?: Extract<ButtonVariant, "secondary" | "ghost">;
  size?: "sm" | "md";
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** Which item to focus once the list has rendered — set by whoever opened it. */
  const focusOnOpen = useRef<"first" | "last">("first");

  const ordered = [...items.filter((i) => !i.destructive), ...items.filter((i) => i.destructive)];
  const firstDestructive = ordered.findIndex((i) => i.destructive);

  useEffect(() => {
    if (!open) return;
    const refs = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    (focusOnOpen.current === "last" ? refs[refs.length - 1] : refs[0])?.focus();

    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (!ordered.length) return null;

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusOnOpen.current = e.key === "ArrowUp" ? "last" : "first";
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const refs = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    const index = refs.indexOf(document.activeElement as HTMLButtonElement);
    const move = (next: number) => {
      e.preventDefault();
      refs[(next + refs.length) % refs.length]?.focus();
    };
    if (e.key === "ArrowDown") move(index + 1);
    else if (e.key === "ArrowUp") move(index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(refs.length - 1);
    else if (e.key === "Escape") {
      // Stopped, so a `<dialog>` this menu sits in does not close as well.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Button
        ref={buttonRef}
        variant={variant}
        size={size}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          focusOnOpen.current = "first";
          setOpen((v) => !v);
        }}
        onKeyDown={onButtonKeyDown}
        trailing={
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 6 L8 10 L12 6" />
          </svg>
        }
      >
        {label}
      </Button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute top-full z-40 mt-1 flex min-w-[13rem] max-w-[min(20rem,calc(100vw-2rem))] flex-col rounded-lg bg-surface p-1 shadow-card ring-1 ring-line",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {ordered.map((item, i) => (
            <MenuItem
              key={item.id}
              item={item}
              separated={i === firstDestructive && i > 0}
              itemRef={(el) => {
                itemRefs.current[i] = el;
              }}
              onRun={() => {
                close(true);
                item.onSelect();
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  item,
  separated,
  onRun,
  itemRef,
}: {
  item: ActionMenuItem;
  separated: boolean;
  onRun: () => void;
  /** Not `ref`: on React 18 a function component never receives that prop. */
  itemRef: (el: HTMLButtonElement | null) => void;
}): ReactNode {
  const reasonId = useId();
  const blocked = Boolean(item.disabledReason);
  return (
    <>
      {separated ? <div role="separator" className="my-1 h-px bg-line" /> : null}
      <button
        ref={itemRef}
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? reasonId : undefined}
        data-destructive={item.destructive || undefined}
        onClick={() => {
          if (!blocked) onRun();
        }}
        className={cn(
          "flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-[13px] outline-none transition-colors",
          "hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent",
          "[@media(pointer:coarse)]:min-h-11",
          item.destructive ? "text-brand-bronze" : "text-ink",
          blocked && "cursor-not-allowed opacity-60",
        )}
      >
        <span className="font-medium">{item.label}</span>
        {blocked ? (
          <span id={reasonId} className="text-[12px] leading-snug text-muted">
            {item.disabledReason}
          </span>
        ) : null}
      </button>
    </>
  );
}
