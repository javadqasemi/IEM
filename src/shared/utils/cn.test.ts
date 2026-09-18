import { describe, expect, it } from "vitest";
import { cn } from "./cn";
import { cn as siteCn } from "@/lib/cn";

/**
 * The dashboard's `cn` resolves conflicts; the site's concatenates.
 *
 * Both behaviours are deliberate and the tests assert both, because the risk is
 * that someone "fixes" the difference in either direction: adding the merge to
 * the site would put a few kB into the stylesheet-and-bundle budget of a
 * marketing page, and removing it here would silently restore the bug where a
 * `className` passed to a component may or may not win depending on how
 * Tailwind sorted the stylesheet.
 */
describe("the dashboard's cn", () => {
  it("lets the last background win", () => {
    // The case that motivated it: overriding a component's base colour from a
    // call site. With plain clsx both survive and stylesheet order decides.
    expect(cn("bg-brand-navy", "bg-surface-2")).toBe("bg-surface-2");
  });

  it("lets the last text colour win", () => {
    expect(cn("text-ink", "text-muted")).toBe("text-muted");
  });

  it("keeps classes that do not conflict", () => {
    expect(cn("rounded-md", "bg-surface", "text-ink")).toBe("rounded-md bg-surface text-ink");
  });

  it("still takes conditionals, like clsx", () => {
    // Through a variable rather than a literal `false &&`, which the linter
    // correctly flags as a constant expression — the point is the runtime
    // behaviour with a falsy value, not the literal.
    const off = false as boolean;
    expect(cn("a", off && "b", null, undefined, ["c", "d"])).toBe("a c d");
  });

  it("resolves the project's own display sizes against each other", () => {
    // These are custom `fontSize` entries. Without the `extendTailwindMerge`
    // config they would be opaque to the merger and both would survive.
    expect(cn("text-display-lg", "text-display-md")).toBe("text-display-md");
  });

  it("resolves a display size against an arbitrary size", () => {
    expect(cn("text-display-xl", "text-[15px]")).toBe("text-[15px]");
  });

  it("does not confuse a text colour with a text size", () => {
    // The trap in teaching a merger about `text-*`: size and colour share the
    // prefix and must stay in different groups, or setting a size would drop
    // the colour.
    expect(cn("text-display-md", "text-muted")).toBe("text-display-md text-muted");
  });

  it("resolves the project's own shadows", () => {
    expect(cn("shadow-card", "shadow-glow")).toBe("shadow-glow");
  });

  it("keeps a token colour distinct from a same-prefix token", () => {
    expect(cn("bg-base", "bg-surface")).toBe("bg-surface");
  });

  it("merges opacity variants of the same property", () => {
    expect(cn("bg-inverse/10", "bg-inverse/[0.07]")).toBe("bg-inverse/[0.07]");
  });
});

describe("the site's cn is deliberately different", () => {
  it("concatenates rather than resolving", () => {
    // If this ever starts returning "bg-surface-2", tailwind-merge has been
    // added to the public bundle — check whether that was intended and what it
    // cost the page weight.
    expect(siteCn("bg-brand-navy", "bg-surface-2")).toBe("bg-brand-navy bg-surface-2");
  });
});
