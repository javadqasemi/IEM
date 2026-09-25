/**
 * The state of a code being checked, and the numbers its motion is built from.
 *
 * Pure, so the rules can be tested without a DOM — this project has none in
 * its unit run, deliberately (see `vitest.config.ts`).
 *
 * ---
 *
 * ## One state, derived rather than stored
 *
 * The screen stores exactly two facts: **where the request is** (`phase`) and
 * **what the server last refused** (`error`). Everything the motion needs is
 * derived from those two and the field's value, so there is no `isLoading`
 * beside an `isSuccess` beside a `showAnimation` that can disagree with each
 * other — the combination "verifying *and* showing an error" cannot be written.
 *
 * ## `success` is the server's word, never the screen's
 *
 * `phase` becomes `"success"` only inside the continuation of a resolved
 * verification request; nothing here can reach it by a timer. The animation
 * *follows* a session that has already been issued — the hold after it is
 * presentational and delays showing the dashboard, never deciding whether
 * there is one. The server is the authority; this is a picture of its answer.
 */
export type VerificationState = "idle" | "typing" | "verifying" | "success" | "error";

/** Where the request is. `entry` covers idle, typing and error alike. */
export type VerificationPhase = "entry" | "verifying" | "success";

export function verificationState({
  phase,
  error,
  value,
}: {
  phase: VerificationPhase;
  error: string;
  value: string;
}): VerificationState {
  if (phase !== "entry") return phase;
  if (error) return "error";
  return value.length > 0 ? "typing" : "idle";
}

/**
 * How long the success animation holds the screen before the session is
 * adopted and the dashboard replaces it.
 *
 * Long enough for burst, check and the green state to be *seen* — about the
 * 500–800 ms the sequence takes, plus a beat to read "Bestätigt". With reduced
 * motion there is nothing to watch, but the state change should still be
 * perceivable rather than a flash, so the hold shortens instead of vanishing.
 */
export const SUCCESS_HOLD_MS = 950;
export const REDUCED_SUCCESS_HOLD_MS = 450;

/**
 * One particle of the success burst: where it travels, how big it is, when
 * it starts. Offsets are pixels from the centre.
 */
export type BurstParticle = { dx: number; dy: number; size: number; delay: number };

/**
 * The burst, as data.
 *
 * Deterministic rather than `Math.random()`: the same twelve particles every
 * time, so a screenshot is reproducible and a test can pin the envelope. The
 * variation comes from a fixed pattern of offsets, which is enough to stop
 * the ring of particles reading as a mechanical star.
 */
export function burstParticles(count = 12): BurstParticle[] {
  const distance = [44, 56, 38, 52, 47, 60, 41, 54, 36, 58, 45, 50, 40, 55];
  const size = [5, 4, 6, 4, 5, 4, 6, 5, 4, 5, 6, 4, 5, 4];
  const jitter = [0, 6, -5, 4, -7, 3, -2, 7, -4, 5, -6, 2, -3, 6];
  const out: BurstParticle[] = [];
  for (let i = 0; i < count; i += 1) {
    const k = i % distance.length;
    const angle = ((360 / count) * i + jitter[k] - 90) * (Math.PI / 180);
    out.push({
      dx: Math.round(Math.cos(angle) * distance[k] * 10) / 10,
      dy: Math.round(Math.sin(angle) * distance[k] * 10) / 10,
      size: size[k],
      delay: (k % 4) * 18,
    });
  }
  return out;
}

/** Whether the reader has asked the system for less motion. Safe outside a browser. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}
