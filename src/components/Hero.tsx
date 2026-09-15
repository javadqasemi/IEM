import { useState } from "react";
import { openBewerbung } from "./BewerbungButton";
import { Button } from "./Button";
import { HeroModel } from "./HeroModel";
import { KPI } from "./KPI";
import { resolveTokens, useContent, type SiteContent } from "@/content/iem";

/**
 * The page's opening, over a moving backdrop: the Guglera coordination model
 * building itself through the six SIA phases, 31 Vorprojekt to 53
 * Inbetriebnahme.
 *
 * The model is scenery — `HeroModel` owns it and takes no interaction. What
 * this file owns is making it *stay* scenery. Three things do that:
 *
 * 1. **A scrim, not a dimmer.** The wash over the canvas is a horizontal
 *    gradient that is nearly opaque under the text column and clears toward the
 *    right, plus a fade at top and bottom. Uniformly dimming the model instead
 *    would cost the contrast the headline needs *and* the detail the model is
 *    there for. The headline keeps its full `text-ink` on a near-solid ground.
 * 2. **Nothing in the backdrop is content.** The canvas is `aria-hidden` and
 *    `pointer-events-none`; the phase readout below is the only part of the
 *    animation that is announced, because it is the only part that says
 *    something a reader could act on.
 * 3. **It is allowed not to be there.** Save-Data, reduced motion, a failed
 *    WebGL context or an old browser all end with the hero as it was: type on
 *    the blueprint grid. Nothing in the layout depends on the canvas.
 */
export function Hero() {
  const content = useContent();
  const { hero } = content;
  // Which SIA phase the backdrop is showing. Owned here rather than inside the
  // canvas because the readout is DOM — it gets the page's real typography and
  // is legible to a screen reader, which a sprite in the scene would not be.
  const [phase, setPhase] = useState(0);

  // Copy carries `{token}` placeholders for the figures the page computes, so
  // an editor can rewrite the sentence without freezing the number inside it.
  const t = (s: string) => resolveTokens(s, content);

  return (
    <section className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24">
      {/* ---- Backdrop ---- */}
      <div aria-hidden className="pointer-events-none absolute inset-0 select-none">
        <HeroModel onPhase={setPhase} className="absolute inset-0" />

        {/* Blueprint grid stays under the model: it is what the page's ground
            is made of, and it keeps the area alive before the model arrives
            and if it never does. */}
        <div className="grid-bg absolute inset-0 -z-10 opacity-70 [mask-image:radial-gradient(ellipse_at_50%_35%,black,transparent_72%)]" />

        {/* The scrim, in two versions, because the text does not sit in the
            same place at both widths.

            The breakpoint is `xl`, not `lg`, and that is measured rather than
            chosen: the text column is `max-w-2xl` inside `max-w-7xl` with the
            page's padding, so it ends at about 55 % of the viewport from
            1280 px up — but at 1024 px it still runs to 70 %, which leaves no
            room for a building. Below `xl` the wash is therefore flat and the
            model is a watermark; from `xl` on it stays solid to 54 % and
            clears fast, and `HeroModel` pans the building into that gap.
            **Change one and re-check the other.**

            The flat wash is 0.8, not higher: at 0.9 the model was technically
            present and practically invisible. The headline is `text-ink` at
            display size and survives a 20 % tint behind it; the body text is
            the one to re-check if this goes any lower.

            The colour is `base` (#F6F8FB) spelled out: a Tailwind gradient
            utility would need its `--tw-gradient-*` variables set on the same
            element, and mixing that with an arbitrary-value gradient is the
            kind of thing that works until someone reorders a class. */}
        <div className="absolute inset-0 bg-[rgba(246,248,251,0.8)] xl:bg-[linear-gradient(to_right,rgb(246,248,251)_0%,rgb(246,248,251)_54%,rgba(246,248,251,0.3)_70%,rgba(246,248,251,0)_88%)]" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-base to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-base to-transparent" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-10">
        <div className="flex max-w-2xl flex-col gap-7 animate-fade-up">
          <p className="eyebrow flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            <span className="text-brand-blue">{hero.eyebrowPlace}</span>
            <span aria-hidden className="h-px w-6 bg-line-strong" />
            <span>{t(hero.eyebrowSince)}</span>
          </p>

          <h1 className="font-display text-display-xl font-bold text-ink">{t(hero.title)}</h1>

          <p className="max-w-xl text-lg leading-relaxed text-muted">{t(hero.lead)}</p>

          <div className="flex flex-wrap items-center gap-3">
            {hero.ctas.map((c) =>
              // `action` CTAs fire a custom-event seam instead of navigating.
              // The only one today opens the form hosted down in `JobRegister`
              // over `iem:open-bewerbung`, so the hero neither owns the dialog
              // nor has to scroll the reader to Karriere to reach it.
              c.action === "bewerbung" ? (
                <Button
                  key={c.label}
                  size="lg"
                  variant={c.variant}
                  onClick={() => openBewerbung()}
                >
                  {c.label}
                </Button>
              ) : (
                <Button
                  key={c.label}
                  size="lg"
                  variant={c.variant}
                  href={t(c.href ?? "#")}
                  trailing={c.trailing}
                >
                  {c.label}
                </Button>
              ),
            )}
          </div>

          <PhasenAnzeige aktiv={phase} phases={content.phases} prefix={hero.phasePrefix} />
        </div>

        <dl className="tick-rule mt-16 grid grid-cols-2 gap-8 pt-10 sm:mt-20 sm:grid-cols-4">
          {hero.kpis.map((k) => (
            <KPI
              key={k.label}
              value={t(k.value)}
              label={k.label}
              note={t(k.note)}
              tone={k.tone}
            />
          ))}
        </dl>
      </div>

    </section>
  );
}

/**
 * The SIA phase the backdrop is currently at. A readout, not a control — there
 * is nothing to press, so it is not a button.
 *
 * `aria-live="polite"` because the animation is the only thing announcing it;
 * without that a screen reader gets a caption that silently changes every three
 * and a half seconds.
 */
function PhasenAnzeige({
  aktiv,
  phases,
  prefix,
}: {
  aktiv: number;
  phases: SiteContent["phases"];
  prefix: string;
}) {
  return (
    <div className="flex flex-col gap-2 pt-1">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {phases.map((p, i) => (
          <li key={p.no} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="h-px w-3 bg-line-strong" />}
            <span
              className={`font-mono text-[11px] tnum tracking-wide transition-colors duration-500 ${
                i === aktiv ? "font-medium text-brand-blue" : "text-muted/55"
              }`}
            >
              {p.no}
            </span>
          </li>
        ))}
      </ol>
      <p aria-live="polite" className="eyebrow text-muted">
        {prefix} {aktuellName(aktiv, phases)}
      </p>
    </div>
  );
}

function aktuellName(i: number, phases: SiteContent["phases"]) {
  const p = phases[Math.min(i, phases.length - 1)];
  return p ? `${p.no} · ${p.title}` : "";
}
