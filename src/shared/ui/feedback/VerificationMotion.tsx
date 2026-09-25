import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/shared/utils/cn";
import { burstParticles } from "./verification";

/**
 * The picture of a code being checked, and of it being accepted.
 *
 * ---
 *
 * ## Layers
 *
 * ```
 * VerificationMotion
 * ├── ambient glow     a radial wash, gold while checking, green once accepted
 * ├── orbit            one rotating element carrying the ring *and* the particle
 * │   ├── ring         a conic gradient masked to a 2px band
 * │   └── particle     at twelve o'clock, so it rides the ring for free
 * ├── core             pulses on its own clock, independent of the orbit
 * ├── burst            twelve particles, rendered only on success
 * └── check            drawn in once the burst is under way
 * ```
 *
 * **CSS only, and only `transform` and `opacity` on anything that repeats.**
 * No animation library (the project has none and this is not a reason to add
 * one), no per-frame JavaScript and no React state that changes while it
 * runs — the component renders twice in its life, once per status. The
 * stylesheet is the `vm-` block at the end of `admin.css`.
 *
 * The particle sits *inside* the rotating element rather than being animated
 * along a path of its own, so the two cannot drift apart and the browser
 * composites one transform for both.
 *
 * ## The one line of script
 *
 * On success the ring **accelerates** rather than stopping dead: the running
 * animation's playback rate is raised through the Web Animations API. Changing
 * `animation-duration` instead would recompute the progress from the new
 * duration and make the ring jump to a different angle mid-turn.
 *
 * ## Accessibility
 *
 * Purely decorative — `aria-hidden`. The words that describe the state belong
 * to the caller's live region, because only the caller knows what is being
 * verified. Reduced motion stops the orbit, drops the burst and shows the
 * check at once; the rules live beside the keyframes.
 */
export type VerificationMotionStatus = "verifying" | "success";

const BURST = burstParticles(12);
const LAST_SPARK = BURST.reduce((last, p, i) => (p.delay > BURST[last].delay ? i : last), 0);

export function VerificationMotion({
  status,
  className,
}: {
  status: VerificationMotionStatus;
  className?: string;
}) {
  const orbit = useRef<HTMLSpanElement>(null);

  /*
    The burst removes itself once every spark has finished, so a caller that
    stays on its success state is not left holding twelve invisible spans.
    Reset during render when the status changes — React's documented pattern
    for state derived from a prop, and no effect that sets state.
  */
  const [burstDone, setBurstDone] = useState(false);
  const [seen, setSeen] = useState(status);
  if (seen !== status) {
    setSeen(status);
    setBurstDone(false);
  }

  useEffect(() => {
    if (status !== "success") return;
    const el = orbit.current;
    if (!el || typeof el.getAnimations !== "function") return;
    for (const animation of el.getAnimations()) {
      // `updatePlaybackRate` keeps the current angle; a plain assignment to
      // `playbackRate` may jump on some engines.
      if (typeof animation.updatePlaybackRate === "function") animation.updatePlaybackRate(3);
      else animation.playbackRate = 3;
    }
  }, [status]);

  return (
    <span aria-hidden="true" className={cn("vm", className)} data-status={status}>
      <span className="vm-ambient" />
      <span className="vm-ambient vm-ambient-success" />
      <span ref={orbit} className="vm-orbit">
        <span className="vm-ring" />
        <span className="vm-particle" />
      </span>
      <span className="vm-ring-done" />
      <span className="vm-core" />
      {status === "success" ? (
        <>
          {burstDone ? null : (
            <span className="vm-burst">
              {BURST.map((p, i) => (
                <span
                  key={i}
                  className="vm-spark"
                  // Every spark runs for the same duration, so the one with
                  // the longest delay is the last to finish.
                  onAnimationEnd={i === LAST_SPARK ? () => setBurstDone(true) : undefined}
                  style={
                    {
                      "--dx": `${p.dx}px`,
                      "--dy": `${p.dy}px`,
                      "--s": `${p.size}px`,
                      "--delay": `${p.delay}ms`,
                    } as CSSProperties
                  }
                />
              ))}
            </span>
          )}
          <svg className="vm-check" viewBox="0 0 24 24" fill="none">
            <path d="M6 12.5l4 4 8-9" />
          </svg>
        </>
      ) : null}
    </span>
  );
}
