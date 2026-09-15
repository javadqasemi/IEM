import { useEffect, useRef, useState } from "react";
import { ModelScene } from "./ModelScene";
import { PhaseTrack } from "./PhaseTrack";
import { cn } from "@/lib/cn";
import { useContent } from "@/content/iem";

/**
 * The Ablauf section: the model, the three people who touch it, and the SIA
 * phases underneath — one story told three ways at once.
 *
 * The act is owned here rather than inside the scene because it drives three
 * things at once: the camera, the caption, and which phases the track below
 * lights up. Planning is 31–51, the installer is 52, the occupant starts at 53
 * — so the animation and the fee stages cannot tell different stories.
 *
 * It plays itself, once. A loop would keep pulling the eye back while someone
 * is reading the phases, and stopping at the last act leaves the scene in the
 * state that carries the page's own argument: the plant running, measured.
 * Reduced motion skips the auto-play entirely and leaves the acts to the
 * buttons, which are the real control either way.
 */
const DWELL = 7000;

export function Bauablauf() {
  const { bauakte, ablaufControls } = useContent();
  const [act, setAct] = useState<0 | 1 | 2>(0);
  // The plant starts running when the third act begins — the building is
  // handed over working. Switching it off is the visitor's move, and it is the
  // one thing in this section that is genuinely the *occupant's* to do.
  const [running, setRunning] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  // Both of these are refs, not state, and deliberately so: a `played` state
  // would land in this effect's dependencies, and setting it from inside the
  // observer would tear the effect down mid-sequence — cleanup would clear the
  // very timers it had just set, and the acts would never advance.
  const timers = useRef<number[]>([]);
  const takenOver = useRef(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const node = host.current;
    if (!node) return;

    // Start the sequence when the section is actually on screen — an animation
    // that has already finished by the time it is scrolled to has told nobody
    // anything.
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        if (takenOver.current) return;
        timers.current.push(
          window.setTimeout(() => !takenOver.current && setAct(1), DWELL),
          window.setTimeout(() => !takenOver.current && setAct(2), DWELL * 2),
        );
      },
      { threshold: 0.4 },
    );
    io.observe(node);

    const pending = timers.current;
    return () => {
      io.disconnect();
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  function pick(i: 0 | 1 | 2) {
    // A click owns the sequence from here on — nothing should move the scene
    // out from under someone who is steering it.
    takenOver.current = true;
    timers.current.forEach((t) => window.clearTimeout(t));
    setAct(i);
  }

  const current = bauakte[act];

  return (
    <div ref={host} className="flex flex-col gap-10">
      {/* The model takes the full width and the controls sit under it, the way
          a viewer is built: the thing being looked at gets the room, and the
          buttons stay in reach directly below rather than off to one side. */}
      <div className="flex flex-col gap-6">
        <ModelScene act={act} running={running} />

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
          {/* The SIA phase numbers as the control. Swiss clients plan in these,
              so the number is the thing they recognise; the role it belongs to
              is carried by the marker in the scene and by the heading beside
              it, and stays in each button's accessible name — a screen reader
              announcing three bare numbers would have nothing to go on. */}
          <div
            role="group"
            aria-label={ablaufControls.groupLabel}
            className="flex flex-wrap gap-2 lg:shrink-0"
          >
            {bauakte.map((a, i) => {
              const phasen = `SIA ${a.phases[0]}${
                a.phases.length > 1 ? `–${a.phases[a.phases.length - 1]}` : ""
              }`;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pick(i as 0 | 1 | 2)}
                  aria-pressed={i === act}
                  aria-label={`${a.role} — ${phasen}`}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 font-mono text-[13px] tnum transition-colors",
                    i === act
                      ? "bg-brand-navy text-surface"
                      : "bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-line-strong",
                  )}
                >
                  {phasen}
                </button>
              );
            })}
          </div>

          {/* aria-live so the caption is announced when the scene moves on by
              itself — the visual change means nothing to a screen reader. */}
          <div aria-live="polite" className="flex max-w-prose flex-col gap-2">
            <h3 className="font-display text-xl font-semibold leading-tight text-ink">
              {current.title}
            </h3>
            <p className="leading-relaxed text-muted">{current.body}</p>
          </div>

          {/* The occupant's control, and only theirs: it appears with the third
              act, because before the handover there is nothing to switch. */}
          {act === 2 && (
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setRunning((v) => !v)}
                aria-pressed={running}
                className={cn(
                  "flex items-center gap-2.5 rounded-full px-4 py-2 text-[14px] font-medium transition-colors",
                  running
                    ? "bg-brand-navy text-surface"
                    : "bg-surface text-ink ring-1 ring-line hover:ring-line-strong",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-2 w-2 rounded-full transition-colors",
                    running ? "bg-brand-sand" : "bg-muted",
                  )}
                />
                {running ? ablaufControls.running : ablaufControls.stopped}
              </button>
              <span className="text-[13px] text-muted">
                {running ? ablaufControls.turnOff : ablaufControls.turnOn}
              </span>
            </div>
          )}
        </div>
      </div>

      <PhaseTrack active={current.phases} />
    </div>
  );
}
