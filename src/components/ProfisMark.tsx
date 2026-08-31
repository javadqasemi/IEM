import { cn } from "@/lib/cn";

/**
 * The client's own "Wir machen Profis. Lehrbetrieb" mark over one of their PV
 * projects (Stuckimatte, Steffisburg), tinted navy so the white mark reads on
 * the photo.
 *
 * It lives beside the Karriere title rather than in the register below it, so
 * the claim sits with the section's own statement instead of competing with the
 * adverts. That means it is a *badge*, not a band: pass a size in `className`
 * and keep it in the neighbourhood of the title block's height — the header
 * aligns its two halves on `items-end`, so a tall image drags the title up.
 */
export function ProfisMark({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg", className)}>
      <img
        src="/img/career/stuckimatte-pv.jpg"
        alt="Photovoltaikanlage Stuckimatte, Steffisburg"
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
      <div aria-hidden className="absolute inset-0 bg-brand-navy/55" />
      <img
        src="/img/career/wir-machen-profis.svg"
        alt="Wir machen Profis"
        loading="lazy"
        className="absolute inset-0 m-auto w-2/3 max-w-[170px]"
      />
    </div>
  );
}
