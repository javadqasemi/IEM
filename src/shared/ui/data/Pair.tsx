import type { ReactNode } from "react";

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
 */
export function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="field-label">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
