import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { OtpInput } from "@/shared/ui/forms";
import { VerificationMotion } from "./VerificationMotion";
import {
  REDUCED_SUCCESS_HOLD_MS,
  SUCCESS_HOLD_MS,
  burstParticles,
  prefersReducedMotion,
  verificationState,
} from "./verification";

/**
 * The verification motion's rules, and the markup it renders.
 *
 * What these cannot see, and where it is checked instead: that the success
 * state only follows a *resolved* request, that a refusal returns focus, and
 * that the loader actually appears over a dimmed form — all of that is
 * `e2e/mfa.spec.ts`, against the running API, because it is behaviour of a
 * real request in a real browser. This file has no DOM (see
 * `vitest.config.ts`), so it pins the pure parts and the server-rendered
 * markup.
 */

describe("verificationState", () => {
  it("is idle with nothing typed and typing once something is", () => {
    expect(verificationState({ phase: "entry", error: "", value: "" })).toBe("idle");
    expect(verificationState({ phase: "entry", error: "", value: "12" })).toBe("typing");
  });

  it("reports the request's phase over everything else", () => {
    // A leftover error must not show while a new attempt is in flight — the
    // combination the single derived value exists to make unwritable.
    expect(verificationState({ phase: "verifying", error: "alt", value: "123456" })).toBe("verifying");
    expect(verificationState({ phase: "success", error: "alt", value: "123456" })).toBe("success");
  });

  it("is an error after a refusal, even with the field cleared", () => {
    expect(verificationState({ phase: "entry", error: "Dieser Code stimmt nicht.", value: "" })).toBe(
      "error",
    );
  });
});

describe("burstParticles", () => {
  const burst = burstParticles(12);

  it("stays within the 8–14 particle envelope", () => {
    expect(burst).toHaveLength(12);
  });

  it("travels 35–60px from the centre", () => {
    for (const p of burst) {
      const distance = Math.hypot(p.dx, p.dy);
      expect(distance).toBeGreaterThanOrEqual(35);
      expect(distance).toBeLessThanOrEqual(60.5);
    }
  });

  it("covers the full circle rather than a sector", () => {
    const quadrants = new Set(burst.map((p) => `${Math.sign(p.dx) >= 0}:${Math.sign(p.dy) >= 0}`));
    expect(quadrants.size).toBe(4);
  });

  it("is deterministic, so a screenshot is reproducible", () => {
    expect(burstParticles(12)).toEqual(burst);
  });
});

describe("the hold after success", () => {
  it("is long enough to see and short enough not to be waited on", () => {
    expect(SUCCESS_HOLD_MS).toBeGreaterThanOrEqual(500);
    expect(SUCCESS_HOLD_MS).toBeLessThanOrEqual(1200);
    expect(REDUCED_SUCCESS_HOLD_MS).toBeLessThan(SUCCESS_HOLD_MS);
  });
});

describe("prefersReducedMotion", () => {
  const REAL_WINDOW = globalThis.window;
  afterEach(() => {
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: REAL_WINDOW });
  });

  function withMedia(matches: boolean) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: { matchMedia: (q: string) => ({ matches: matches && q.includes("reduce") }) },
    });
  }

  it("reads the media query", () => {
    withMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    withMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("is false outside a browser rather than throwing", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: undefined });
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("VerificationMotion", () => {
  it("is decorative: hidden from assistive technology", () => {
    const html = renderToStaticMarkup(<VerificationMotion status="verifying" />);
    expect(html).toMatch(/^<span aria-hidden="true"/);
  });

  it("renders no burst and no check while verifying", () => {
    const html = renderToStaticMarkup(<VerificationMotion status="verifying" />);
    expect(html).toContain('data-status="verifying"');
    expect(html).toContain("vm-orbit");
    expect(html).toContain("vm-core");
    expect(html).not.toContain("vm-spark");
    expect(html).not.toContain("vm-check");
  });

  it("renders twelve sparks and the check on success", () => {
    const html = renderToStaticMarkup(<VerificationMotion status="success" />);
    expect(html).toContain('data-status="success"');
    expect(html.match(/class="vm-spark"/g)).toHaveLength(12);
    expect(html).toContain("vm-check");
  });
});

describe("OtpInput", () => {
  const render = (props: Partial<Parameters<typeof OtpInput>[0]> = {}) =>
    renderToStaticMarkup(<OtpInput id="otp" value="" onChange={() => {}} {...props} />);

  it("is still one input, with the attributes that make autofill and the number pad work", () => {
    const html = render();
    expect(html.match(/<input/g)).toHaveLength(1);
    // React 18's server renderer keeps these camel-cased; HTML attributes
    // are case-insensitive, so the browser reads them the same.
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('maxLength="6"');
    expect(html).toContain('id="otp"');
  });

  it("draws six slots, hidden from assistive technology, three and three", () => {
    const html = render({ value: "1234" });
    expect(html).toContain('<div aria-hidden="true" class="otp-slots"');
    expect(html.match(/class="otp-slot tnum"/g)).toHaveLength(6);
    expect(html.match(/data-filled="true"/g)).toHaveLength(4);
    expect(html).toContain("grid-template-columns:repeat(3, minmax(0, 1fr)) 0.25rem repeat(3, minmax(0, 1fr))");
  });

  it("claims no active slot before it has focus", () => {
    expect(render({ value: "12" })).not.toContain("data-active");
  });

  it("tones every slot through one state attribute", () => {
    expect(render({ invalid: true })).toContain('data-state="error"');
    expect(render({ invalid: true })).toContain('aria-invalid="true"');
    expect(render({ success: true })).toContain('data-state="success"');
    expect(render({ disabled: true })).toContain('data-disabled="true"');
    // An error wins over success: the two cannot be shown at once.
    expect(render({ invalid: true, success: true })).toContain('data-state="error"');
  });
});
