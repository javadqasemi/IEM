import { useEffect, useState } from "react";
import { Button } from "./Button";
import { BewerbungDialog } from "./BewerbungDialog";

/**
 * Any trigger anywhere can ask for the form. Same seam the site search already
 * uses for the project dialog and the team filter — a custom event keeps the
 * job cards and the section header from having to share a parent's state.
 */
export const OPEN_BEWERBUNG = "iem:open-bewerbung";

/** Opens the application form, optionally on a specific position. */
export function openBewerbung(position?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_BEWERBUNG, { detail: { position } }));
}

/**
 * The "Spontan bewerben" trigger and the single dialog host in one unit, so
 * `App` stays a pure composition of content and layout.
 */
export function BewerbungButton({
  className,
  size,
}: {
  className?: string;
  /** Passed through to `Button` — the register's filter row wants `sm`. Set it
   *  here rather than by class: `cn` is plain `clsx`, so an `h-9` in className
   *  and the variant's own `h-11` collide and Tailwind breaks the tie by
   *  stylesheet order, not class order. */
  size?: "sm" | "md" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<string | undefined>();

  useEffect(() => {
    const onOpen = (e: Event) => {
      setPosition((e as CustomEvent<{ position?: string }>).detail?.position);
      setOpen(true);
    };
    window.addEventListener(OPEN_BEWERBUNG, onOpen);
    return () => window.removeEventListener(OPEN_BEWERBUNG, onOpen);
  }, []);

  return (
    <>
      <Button variant="mark" size={size} className={className} onClick={() => openBewerbung()}>
        Spontan bewerben
      </Button>
      <BewerbungDialog open={open} position={position} onClose={() => setOpen(false)} />
    </>
  );
}
