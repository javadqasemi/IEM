import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * One label/value row of a definition list.
 *
 * The smallest piece of the `PropertyList` every detail screen in the
 * enterprise modules will need (`docs/enterprise-architecture.md` §6.2). It is
 * here now because three screens had written it locally and a fourth was about
 * to — a `<dt>`/`<dd>` pair is trivial and *being* trivial is exactly why four
 * slightly different copies appear.
 *
 * The caller supplies the `<dl>`, so a screen decides its own column count.
 *
 * **`className` is for the grid, and it is why it exists.** A row that needs
 * the full width of a two-column `<dl>` used to be wrapped in a
 * `<div className="sm:col-span-2">` — and axe fails that as a `definition-list`
 * violation, because a `div` inside a `dl` has to *be* a dt/dd group rather
 * than contain another list. Spanning from the group itself is both correct
 * markup and one element fewer.
 */
export function Pair({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <dt className="field-label">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
