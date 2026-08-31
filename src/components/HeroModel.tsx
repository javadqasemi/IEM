import { useEffect, useRef } from "react";
// Types only — three.js and the model are imported at runtime inside the
// effect so they stay out of the page's main bundle.
import type * as Three from "three";
import type { Vec3 } from "@/generated/scene_guglera";
import { baueModell } from "@/lib/modellSzene";

/**
 * The hero's backdrop: the Guglera coordination model, playing itself through
 * the six SIA phases from 31 Vorprojekt to 53 Inbetriebnahme.
 *
 * It is scenery, not a widget. No controls, no pointer events, no labels —
 * the headline sits over it and has to stay the thing you read first. What it
 * says it says by building itself: rooms, then structure, then the runs, then
 * the plant, then the façade, and finally the media moving.
 *
 * Three decisions worth knowing:
 *
 * 1. **It loads after the page does.** This is the first viewport, and three.js
 *    plus the model are ~280 KB gzipped. Loading them eagerly would push the
 *    headline's paint behind a decoration. The import waits for an idle
 *    callback, so the text is on screen long before the model is, and the
 *    model fades in rather than popping.
 * 2. **Save-Data skips it entirely.** A visitor who has asked their browser to
 *    save data should not spend 280 KB on scenery. They get the page without
 *    it, which loses nothing they came for.
 * 3. **Reduced motion freezes it at the last phase.** Not "no model" — the
 *    finished building, standing still. A backdrop that cycles behind text is
 *    exactly the kind of motion the preference is about.
 *
 * The geometry itself is built by `lib/modellSzene`, shared with the 3D scene
 * in `#ablauf`. Never type a dimension here.
 */

/**
 * Opacity per SIA phase, by the category's own phase key. This table is the
 * whole animation.
 *
 *   31 Vorprojekt   32 Bauprojekt   41 Ausschreibung
 *   51 Ausführung   52 Fachbauleitung   53 Inbetriebnahme
 *
 * Rooms come first and fade as the building gets real — that is the order a
 * project actually happens in, not a fade-in of everything at once.
 *
 * These are absolute: unlike the Ablauf scene, the hero does **not** multiply
 * by the category's own opacity from the model. That factor is 0.06 for rooms,
 * which is right behind a foreground of coloured plant and completely wrong
 * here, where the rooms are the only thing on screen for the first seven
 * seconds. Multiplying made the opening phases invisible.
 */
const PHASE_OPACITY: Record<string, number[]> = {
  raum: [0.85, 0.6, 0.34, 0.15, 0, 0],
  // The shell peaks at Bauprojekt and then steps *back*: from Ausführung on
  // the subject is the installation, and a solid façade in front of it would
  // be a picture of a wall.
  roh: [0.4, 0.72, 0.64, 0.5, 0.52, 0.44],
  ausbau: [0, 0, 0, 0.15, 0.6, 1],
  technik: [0, 0, 0.4, 1, 1, 1],
  zubehoer: [0, 0, 0.25, 0.65, 0.75, 0.7],
};

/**
 * The backdrop's own palette. The model's colours are near-white — they are
 * meant for the Ablauf card, where the structure sits behind coloured plant
 * and only has to stay out of its way. On the page's paper ground (#F6F8FB)
 * white-on-white is nothing at all, so the shell gets a navy tint here and the
 * plant keeps the colours it has.
 */
const HERO_FARBE: Record<string, string> = {
  raum: "#8ba6c9",
  wand: "#6d8cb4",
  decke: "#5f80ad",
  fenster: "#5b83b0",
  tuer: "#7791bb",
};

/** The runs: a trace at Ausschreibung, the real pipe from Ausführung on. */
const MEDIUM_OPACITY = [0, 0.1, 0.35, 0.85, 1, 1];

/** Seconds each phase holds. Six of them make a ~21 s loop. */
const PHASE_DAUER = 3.5;

export function HeroModel({
  onPhase,
  className,
}: {
  /** Called with the index of the phase currently showing. */
  onPhase?: (i: number) => void;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  // The callback is read from a ref so a new closure from the parent does not
  // tear down and rebuild the whole scene.
  const phaseCb = useRef(onPhase);
  useEffect(() => {
    phaseCb.current = onPhase;
  }, [onPhase]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;

    // A visitor on Save-Data gets the page without the scenery.
    const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    // Wait for idle: the headline is the reason this page exists and it must
    // not queue behind a 280 KB backdrop.
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(() => void los(), { timeout: 1200 })
      : window.setTimeout(() => void los(), 500);

    async function los() {
      const [THREE, M] = await Promise.all([
        import("three"),
        import("@/generated/scene_guglera").then((m) => m.ladeModell()),
      ]);
      if (disposed || !host.current) return;

      const el = host.current;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const letzte = PHASE_OPACITY.roh.length - 1;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      // Scenery does not need the full retina budget; 1.5 is indistinguishable
      // behind a scrim and costs a third less fill.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setSize(el.clientWidth, el.clientHeight, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const spanne = Math.max(M.bauwerk.breite, M.bauwerk.tiefe);
      const mitteY = M.bauwerk.min[1] + M.bauwerk.hoehe * 0.45;

      const camera = new THREE.PerspectiveCamera(
        40,
        el.clientWidth / Math.max(el.clientHeight, 1),
        0.5,
        spanne * 14,
      );

      // One camera station per phase, all on a slow orbit around the building.
      // Azimuth turns about 30°, the camera drops and closes in as the project
      // gets specific, then pulls back out once the plant is running.
      //
      // The backdrop deliberately stays *outside*. Flying into the plant room
      // — which is what the Ablauf scene does in its second act — fills the
      // frame with pipework that reads as abstract texture behind a headline.
      // Here the building has to stay recognisable as a building.
      // `weit` is a multiple of the building's own span. Below about 1.2 the
      // near façade fills the frame and hides the plant behind it — the whole
      // point of the later phases is being able to see into the building.
      const STATIONEN = [
        { az: 0.95, hoch: 0.62, weit: 1.52 }, // 31 Vorprojekt
        { az: 0.88, hoch: 0.58, weit: 1.46 }, // 32 Bauprojekt
        { az: 0.8, hoch: 0.53, weit: 1.38 }, //  41 Ausschreibung
        { az: 0.71, hoch: 0.48, weit: 1.31 }, // 51 Ausführungsprojekt
        { az: 0.62, hoch: 0.43, weit: 1.26 }, // 52 Fachbauleitung
        { az: 0.5, hoch: 0.56, weit: 1.44 }, //  53 Inbetriebnahme
      ];

      // The scrim is solid under the text column, which runs to about 55 % of
      // the width, so the building has to stand in the right-hand third or it
      // is behind the wash — visible as haze, legible as nothing. Shifting
      // camera *and* target by the same lateral vector pans the frame left,
      // which moves the subject right; moving only one would turn the camera
      // and leave the building where it was.
      //
      // 0.30 × span puts the model's centre at roughly three quarters of the
      // frame at this field of view. Change it together with the scrim in
      // Hero.tsx — the two are a pair.
      const seitlich = spanne * 0.3;

      const VIEWS: { pos: Vec3; target: Vec3 }[] = STATIONEN.map(({ az, hoch, weit }) => {
        const sx = Math.sin(az);
        const sz = Math.cos(az);
        // Die Kamera steht auf (sx, sz) und blickt zum Ursprung, die
        // Blickrichtung ist also −(sx, sz). „Rechts davon" ist (−sz, sx) — und
        // verschoben wird nach **links**, denn ein nach links gerückter
        // Ausschnitt zeigt das Motiv rechts.
        const vx = -sz * seitlich;
        const vz = sx * seitlich;
        return {
          pos: [sx * spanne * weit + vx, M.bauwerk.min[1] + spanne * hoch, sz * spanne * weit + vz],
          target: [vx, mitteY, vz],
        };
      });

      // Lighting has to stay near unity here, and that is not a taste call.
      // A Lambert surface comes out as colour × (ambient + key·NdotL); the
      // Ablauf card runs ambient at 2.1, which drives every light colour to
      // pure white and only leaves the saturated pipes recognisable. On the
      // card that reads as a bright model. As a backdrop it meant the shell —
      // rooms, walls, slabs, the only things on screen for the first seven
      // seconds — rendered white on a white page and the model looked absent.
      // Summing to about 1 keeps the tint and still gives the faces shading.
      // Summing to about 1 on a lit face keeps the tint; anything much above
      // that washes the whole shell to white, which is invisible on this page.
      scene.add(new THREE.AmbientLight(0xffffff, 0.38));
      const key = new THREE.DirectionalLight(0xffffff, 0.66);
      key.position.set(spanne, spanne * 1.5, spanne * 0.7);
      scene.add(key);
      // A weak counter-light so the faces turned away are shaded, not black.
      const gegen = new THREE.DirectionalLight(0xffffff, 0.2);
      gegen.position.set(-spanne, spanne * 0.4, -spanne * 0.8);
      scene.add(gegen);

      const aufbau = baueModell(THREE, scene, M, {
        deckkraft: (kat) => PHASE_OPACITY[kat.phase] ?? MEDIUM_OPACITY,
        farbe: (kat) => HERO_FARBE[kat.id],
        medienDeckkraft: MEDIUM_OPACITY,
        schlittenRadius: 0.16,
      });

      let phase = reduced ? letzte : 0;
      phaseCb.current?.(phase);
      // Start already framed on the first phase rather than flying in from
      // wherever the camera happened to be constructed.
      camera.position.set(...VIEWS[phase].pos);
      const ziel = new THREE.Vector3(...VIEWS[phase].target);

      const ro = new ResizeObserver(() => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      });
      ro.observe(el);

      // Pause while off screen. The hero leaves the viewport as soon as anyone
      // scrolls, and a backdrop nobody can see has no business holding the GPU.
      let sichtbar = true;
      const io = new IntersectionObserver(
        (entries) => {
          sichtbar = entries.some((e) => e.isIntersecting);
        },
        { rootMargin: "80px" },
      );
      io.observe(el);

      const uhr = new THREE.Clock();
      const wunschPos = new THREE.Vector3();
      const wunschZiel = new THREE.Vector3();
      let raf = 0;
      let seitPhase = 0;
      let flussZeit = 0;
      // Fade the whole canvas in once the first frame is on screen, so the
      // model arrives rather than appearing.
      el.style.opacity = "0";
      el.style.transition = "opacity 1.2s ease-out";

      function frame() {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(uhr.getDelta(), 0.05);
        if (!sichtbar) return;

        if (!reduced) {
          seitPhase += dt;
          if (seitPhase >= PHASE_DAUER) {
            seitPhase = 0;
            phase = (phase + 1) % VIEWS.length;
            phaseCb.current?.(phase);
          }
          flussZeit += dt;
        }

        const k = 1 - Math.exp(-dt * 2.2);
        for (const { mat, targets } of aufbau.blenden) {
          mat.opacity += (targets[phase] - mat.opacity) * k;
        }
        // The media move only once the plant has been commissioned.
        const flussZiel = phase === letzte && !reduced ? 0.9 : 0;
        for (const m of aufbau.flussMaterialien) {
          m.opacity += (flussZiel - m.opacity) * k;
        }
        if (flussZiel > 0) {
          for (const f of aufbau.fluss) {
            const u = (f.offset + (flussZeit * 1.4) / Math.max(f.len, 0.001)) % 1;
            f.mesh.position.copy(f.curve.getPointAt(u));
          }
        }

        wunschPos.set(...VIEWS[phase].pos);
        wunschZiel.set(...VIEWS[phase].target);
        const kk = 1 - Math.exp(-dt * 0.8);
        camera.position.lerp(wunschPos, kk);
        ziel.lerp(wunschZiel, kk);
        camera.lookAt(ziel);

        renderer.render(scene, camera);
        el.style.opacity = "1";
      }
      frame();

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        renderer.dispose();
        scene.traverse((o) => {
          const mesh = o as Three.Mesh;
          mesh.geometry?.dispose?.();
        });
        renderer.domElement.remove();
      };
      if (disposed) cleanup();
    }

    return () => {
      disposed = true;
      if (window.cancelIdleCallback && typeof idle === "number") {
        window.cancelIdleCallback(idle);
      }
      clearTimeout(idle as number);
      cleanup?.();
    };
  }, []);

  return <div ref={host} aria-hidden className={className} />;
}
