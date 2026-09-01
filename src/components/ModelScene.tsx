import { useEffect, useRef, useState } from "react";
// Types only — the library itself is imported at runtime inside the effect, so
// it lands in its own chunk instead of the page's main bundle. A plain
// `import * as THREE` here would undo that no matter how the effect is written.
import type * as Three from "three";
import type { Modell, Vec3 } from "@/generated/scene_guglera";
import { baueModell } from "@/lib/modellSzene";

/**
 * The building as a real 3D model, played in three acts: someone plans it,
 * someone builds it, someone switches it on.
 *
 * The geometry is **not** modelled here and it is not a sample building either.
 * `src/generated/scene_guglera.ts` is written by `cad/build_scene_ifc.py` out of
 * the client's own three IFC files in `ifc/` — Architektur, Heizung, Lüftung for
 * the Guglera conversion in Giffers — the same source as the hero section. Never
 * type a dimension into this file; change the plane or the rules in `cad/` and
 * regenerate with `python cad/build_scene_ifc.py`.
 *
 * What this file does own is the *staging*: the three figures, the desk, the
 * ladder and the light switch. They stand at points the exporter derives from
 * the plant, so they move with it.
 *
 * Five decisions worth knowing:
 *
 * 1. **three.js and the model are both loaded on demand.** three.js is ~190 KB
 *    gzipped and the scene data another ~100 KB against the page's own ~88 KB,
 *    so a static import would multiply the cost of a page most visitors never
 *    scroll this far down. An IntersectionObserver starts both imports when the
 *    section comes near, and Vite emits them as their own chunks.
 * 2. **Everything is instanced.** 7'786 components is far too many for one mesh
 *    each — the draw calls alone would stall the frame. One `InstancedMesh` per
 *    body category and one per medium brings it to about twenty draw calls, and
 *    an act change only animates their material opacities.
 * 3. **The camera moves, the objects do not.** Act changes re-target the camera
 *    and fade materials; no geometry is rebuilt. That keeps the transitions
 *    interruptible — click through the acts quickly and nothing queues up.
 * 4. **Media, not trades.** Five strands, each its own colour: Vor- and
 *    Rücklauf, Zu- and Abluft, Kaltwasser. A schematic can draw one line per
 *    trade; a building that is running cannot, because those pipes carry
 *    different things in different directions.
 * 5. **Labels are HTML, not sprites.** Role markers and values are DOM nodes
 *    positioned by projecting their 3D anchor to screen space each frame, the
 *    same device the hero uses over its SVG. They get the page's real
 *    typography and stay legible at any pixel ratio.
 */

type Act = 0 | 1 | 2;

/**
 * Opacity per act, by the phase an element belongs to. This is the whole
 * dramaturgy in one table.
 *
 * Act one is the planner's: rooms as volumes, structure barely there, no plant.
 * Act two is the site's: structure and installation solid, rooms gone. Act
 * three is the occupant's: the façade closes and the media start to move — but
 * walls stay translucent, because a scene that hides its own plant behind
 * finished surfaces has nothing left to say.
 */
const PHASE_OPACITY: Record<string, [number, number, number]> = {
  raum: [0.17, 0, 0],
  roh: [0.13, 0.5, 0.34],
  ausbau: [0, 0.12, 1],
  technik: [0, 1, 1],
  zubehoer: [0, 0.55, 0.45],
};

/**
 * In act one the runs are a faint trace — a route on a plan. In act two they
 * become the pipe at its real diameter: same geometry, installed.
 */
const MEDIUM_OPACITY: [number, number, number] = [0.2, 1, 1];

const TONE_TEXT: Record<string, string> = {
  heat: "text-disc-heat",
  air: "text-disc-air",
  water: "text-disc-water",
};

const TONE_DOT: Record<string, string> = {
  heat: "bg-disc-heat",
  air: "bg-disc-air",
  water: "bg-disc-water",
};

const NAVY = 0x003882;
const LINE = 0xbfcad9;

export function ModelScene({ act, running }: { act: Act; running: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const actRef = useRef<Act>(act);
  const runRef = useRef(running);
  // The scene hands React a handle for the zoom buttons — the alternative is
  // lifting the whole three.js state up, which nothing else needs.
  const api = useRef<{ zoom: (dir: 1 | -1) => void } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "running" | "failed">("idle");
  // The legend, the labels and the component count all come out of the model,
  // so they can only be rendered once it has loaded.
  const [model, setModel] = useState<{
    medien: Modell["medien"];
    messpunkte: Modell["messpunkte"];
    zentralen: Modell["zentralen"];
    bauteile: number;
  } | null>(null);

  // The render loop reads both through refs: re-running the three.js setup on
  // every act or switch change would rebuild the scene and drop the camera.
  useEffect(() => {
    actRef.current = act;
  }, [act]);
  useEffect(() => {
    runRef.current = running;
  }, [running]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setStatus("loading");
        start()
          .then((fn) => {
            if (disposed) fn?.();
            else {
              cleanup = fn;
              setStatus("running");
            }
          })
          .catch(() => setStatus("failed"));
      },
      { rootMargin: "300px" },
    );
    io.observe(node);

    async function start() {
      const [THREE, { OrbitControls }, M] = await Promise.all([
        import("three"),
        import("three/examples/jsm/controls/OrbitControls.js"),
        import("@/generated/scene_guglera").then((m) => m.ladeModell()),
      ]);
      if (disposed || !host.current) return undefined;

      const el = host.current;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(el.clientWidth, el.clientHeight, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();

      // ---- Framing, derived from the building rather than typed in ----
      // The Guglera is 51 m long and 27 m tall; the sample building this scene
      // used to show was a third of that. Hard-coded camera positions would
      // have to be re-tuned by hand for every model, so they are computed from
      // the bounding box the exporter writes.
      const spanne = Math.max(M.bauwerk.breite, M.bauwerk.tiefe);
      const mitte: Vec3 = [0, (M.bauwerk.min[1] + M.bauwerk.max[1]) / 2, 0];
      const zentrale = M.zentralen[0].at;

      // The Guglera is 51 m long, 32 m deep and 27 m tall. Framing it needs
      // roughly 70 m of standoff at this field of view — a distance that only
      // reads as a number if it comes from the building, which is why these are
      // multiples of `spanne` rather than the metres they happen to work out to.
      const VIEWS: { pos: Vec3; target: Vec3 }[] = [
        // Planen: over the planner's shoulder, the whole massing in view.
        {
          pos: [
            M.acteurs.planer[0] - spanne * 0.42,
            spanne * 0.5,
            M.acteurs.planer[2] + spanne * 0.72,
          ],
          target: [mitte[0], M.bauwerk.min[1] + M.bauwerk.hoehe * 0.45, mitte[2]],
        },
        // Bauen: in on the plant room, close enough to read a pipe but far
        // enough to see which part of the building it sits in.
        {
          pos: [zentrale[0] + 24, zentrale[1] + 13, zentrale[2] + 27],
          target: [zentrale[0], zentrale[1] + 2, zentrale[2]],
        },
        // Nutzen: pulled back to the corner where the building reads as
        // architecture, with the installation still visible through it.
        {
          pos: [spanne * 0.72, M.bauwerk.max[1] * 1.25, spanne * 0.9],
          target: [mitte[0], M.bauwerk.min[1] + M.bauwerk.hoehe * 0.45, mitte[2]],
        },
      ];

      const camera = new THREE.PerspectiveCamera(
        38,
        el.clientWidth / Math.max(el.clientHeight, 1),
        0.1,
        spanne * 12,
      );
      camera.position.set(...VIEWS[0].pos);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = false; // panning loses the building off-screen
      controls.minDistance = 6;
      controls.maxDistance = spanne * 2.4;
      controls.target.set(...VIEWS[0].target);

      // Wheel zoom is armed only after the visitor has actually touched the
      // scene. A canvas that zooms on the way past swallows the page scroll,
      // which is the single worst thing an embedded 3D view can do. The zoom
      // buttons below work from the first frame, so the function is never
      // hidden behind that gesture.
      controls.enableZoom = false;
      // Two fingers dolly and rotate; one finger is left to the page, so a
      // touch scroll through the section is never captured.
      controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE } as never;

      let free = false;
      // Capture phase on purpose: OrbitControls listens for `pointerdown` on
      // the same element, and it reads `enableZoom` while handling the event.
      // Arming in the bubble phase would lose the first pinch.
      renderer.domElement.addEventListener(
        "pointerdown",
        () => {
          controls.enableZoom = true;
        },
        { capture: true },
      );
      controls.addEventListener("start", () => {
        free = true;
      });

      // The buttons scale the *framing distance* rather than moving the camera
      // outright, so an act change still re-frames the model — at whatever zoom
      // the visitor has chosen.
      let zoomFactor = 1;
      api.current = {
        zoom(dir) {
          zoomFactor = Math.min(2.2, Math.max(0.32, zoomFactor * (dir > 0 ? 0.78 : 1.28)));
          if (free) {
            // Once the camera is off the rails, zoom has to move it itself.
            const offset = camera.position.clone().sub(controls.target);
            const next = Math.min(
              controls.maxDistance,
              Math.max(controls.minDistance, offset.length() * (dir > 0 ? 0.78 : 1.28)),
            );
            camera.position.copy(controls.target).add(offset.setLength(next));
          }
        },
      };

      scene.add(new THREE.AmbientLight(0xffffff, 2.1));
      const key = new THREE.DirectionalLight(0xffffff, 1.4);
      key.position.set(spanne, spanne * 1.4, spanne * 0.8);
      scene.add(key);

      // ---- Fading is per act: [Planen, Bauen, Nutzen] ----
      const fading: { mat: { opacity: number }; targets: number[] }[] = [];
      const track = (mat: { opacity: number }, targets: [number, number, number]) =>
        fading.push({ mat, targets });

      // The model itself is built by the shared routine in lib/modellSzene —
      // the hero background draws the same 7'786 components and there is no
      // reason for two copies of that code. What stays here is the staging.
      const aufbau = baueModell(THREE, scene, M, {
        // Die Kategorie-Deckkraft aus dem Modell zählt hier mit: Räume sind in
        // dieser Ansicht ein Hauch von Füllung hinter der Technik.
        deckkraft: (kat) =>
          (PHASE_OPACITY[kat.phase] ?? [0, 1, 1]).map((o) => o * kat.opacity),
        medienDeckkraft: MEDIUM_OPACITY,
      });
      fading.push(...aufbau.blenden);
      const flows = aufbau.fluss;
      const flowMats = aufbau.flussMaterialien;

      const grid = new THREE.GridHelper(spanne * 2.4, 40, LINE, LINE);
      grid.position.y = M.bauwerk.min[1] - 0.05;
      (grid.material as Three.Material).transparent = true;
      (grid.material as Three.Material).opacity = 0.22;
      scene.add(grid);

      // ---- The three people ----
      //
      // Built out of joints rather than a stack of capsules: hips, knees,
      // shoulders and elbows are real pivots, so a pose is a set of angles and
      // the arms can be animated. That is what makes these read as people —
      // posture and movement, not detail. They stay untextured navy
      // silhouettes: a face at this scale is two dark pixels and a stock
      // character model would date the page within a year.
      //
      // At 1.8 m against a 51 m building they are also the only thing in the
      // scene that gives it scale.
      //
      // A figure faces +Z; `faceTowards` turns the whole group.
      const H = {
        thigh: 0.46,
        shin: 0.46,
        torso: 0.62,
        upperArm: 0.3,
        foreArm: 0.28,
        shoulderW: 0.19,
        hipW: 0.11,
      };
      const HIP_Y = H.thigh + H.shin;
      const SHOULDER_Y = HIP_Y + H.torso;
      const limbs: { part: Three.Object3D; base: number; amp: number; freq: number; act: Act }[] =
        [];

      function limb(material: Three.Material, len: number, r: number) {
        // A capsule hung from its top end, so the parent group is the joint.
        const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - r * 2, 4, 10), material);
        seg.position.y = -len / 2;
        return seg;
      }

      function person(
        at: Vec3,
        material: Three.Material,
        pose: {
          seated?: boolean;
          /** Rotation of the right arm at the shoulder, radians, forward = −. */
          rightArm?: number;
          rightElbow?: number;
          leftArm?: number;
          leftElbow?: number;
          headTilt?: number;
        },
      ) {
        const g = new THREE.Group();
        const hipY = pose.seated ? 0.47 : HIP_Y;

        const hips = new THREE.Group();
        hips.position.y = hipY;
        g.add(hips);

        for (const side of [-1, 1]) {
          const thigh = new THREE.Group();
          thigh.position.x = side * H.hipW;
          thigh.add(limb(material, H.thigh, 0.085));
          // Seated: thighs forward, shins down. Standing: both plumb.
          thigh.rotation.x = pose.seated ? -Math.PI / 2 : 0;
          const knee = new THREE.Group();
          knee.position.y = -H.thigh;
          knee.rotation.x = pose.seated ? Math.PI / 2 : 0;
          knee.add(limb(material, H.shin, 0.075));
          thigh.add(knee);
          hips.add(thigh);
        }

        const torso = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.16, H.torso - 0.22, 4, 12),
          material,
        );
        torso.position.y = hipY + H.torso / 2;
        torso.scale.z = 0.7;
        g.add(torso);

        const shoulderY = hipY + H.torso;
        const arms: Three.Group[] = [];
        for (const side of [-1, 1]) {
          const shoulder = new THREE.Group();
          shoulder.position.set(side * H.shoulderW, shoulderY, 0);
          shoulder.add(limb(material, H.upperArm, 0.062));
          const elbow = new THREE.Group();
          elbow.position.y = -H.upperArm;
          elbow.add(limb(material, H.foreArm, 0.055));
          const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), material);
          hand.position.y = -H.foreArm;
          elbow.add(hand);
          shoulder.add(elbow);
          shoulder.rotation.x = side < 0 ? (pose.leftArm ?? 0) : (pose.rightArm ?? 0);
          elbow.rotation.x = side < 0 ? (pose.leftElbow ?? 0) : (pose.rightElbow ?? 0);
          g.add(shoulder);
          arms.push(shoulder);
        }

        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.09, 8), material);
        neck.position.y = shoulderY + 0.05;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), material);
        head.position.y = shoulderY + 0.21;
        head.scale.z = 1.15;
        head.rotation.x = pose.headTilt ?? 0;
        g.add(neck, head);

        g.position.set(...at);
        scene.add(g);
        return { group: g, leftArm: arms[0], rightArm: arms[1], head };
      }

      /** Turn a figure so its front (+Z) points at a place in the model. */
      const faceTowards = (from: Vec3, to: Vec3) =>
        Math.atan2(to[0] - from[0], to[2] - from[2]);

      const personMat = (targets: [number, number, number]) => {
        const m = new THREE.MeshLambertMaterial({
          color: NAVY,
          transparent: true,
          opacity: 0,
        });
        track(m, targets);
        return m;
      };

      // Each figure is fully lit only in their own act — present but stepped
      // back in the others, so the building never reads as deserted.

      // The planner: seated, forearms out over the keyboard, head down to the
      // screen. The desk is built at the same anchor further below.
      const planerMat = personMat([1, 0.16, 0.16]);
      const planer = person(M.acteurs.planer, planerMat, {
        seated: true,
        rightArm: -1.15,
        rightElbow: 0.75,
        leftArm: -1.15,
        leftElbow: 0.75,
        headTilt: 0.22,
      });
      const planerFacing = faceTowards(M.acteurs.planer, mitte);
      planer.group.rotation.y = planerFacing;
      limbs.push(
        { part: planer.rightArm, base: -1.15, amp: 0.045, freq: 5.5, act: 0 },
        { part: planer.leftArm, base: -1.15, amp: 0.038, freq: 4.7, act: 0 },
      );

      // The installer: standing in the plant room, right arm up on the pipe,
      // left hand down at the toolbox.
      const installateurMat = personMat([0, 1, 0.16]);
      const installateur = person(M.acteurs.installateur, installateurMat, {
        rightArm: -2.25,
        rightElbow: 0.5,
        leftArm: -0.25,
        leftElbow: 0.3,
      });
      installateur.group.rotation.y = faceTowards(M.acteurs.installateur, [
        zentrale[0],
        M.acteurs.installateur[1] + 1.6,
        zentrale[2],
      ]);
      limbs.push({ part: installateur.rightArm, base: -2.25, amp: 0.13, freq: 2.6, act: 1 });

      // A hard hat, because one prop says "Installateur" faster than any label.
      const helmetMat = new THREE.MeshLambertMaterial({
        color: 0x90814e,
        transparent: true,
        opacity: 0,
      });
      track(helmetMat, [0, 1, 0.16]);
      const helmet = new THREE.Group();
      helmet.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
          helmetMat,
        ),
      );
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 16), helmetMat);
      brim.position.y = 0.005;
      helmet.add(brim);
      helmet.position.set(
        M.acteurs.installateur[0],
        M.acteurs.installateur[1] + SHOULDER_Y + 0.2,
        M.acteurs.installateur[2],
      );
      scene.add(helmet);

      // The occupant, at a radiator on an upper floor, hand out to the switch
      // beside them. The switch is staging, so it is placed here rather than
      // exported: there is no light switch in an HLK model.
      const schalter: Vec3 = [
        M.acteurs.nutzer[0] + 0.75,
        M.acteurs.nutzer[1] + 1.15,
        M.acteurs.nutzer[2],
      ];
      const nutzerMat = personMat([0, 0.16, 1]);
      const nutzer = person(M.acteurs.nutzer, nutzerMat, {
        rightArm: -1.45,
        rightElbow: 0.25,
        leftArm: -0.12,
      });
      nutzer.group.rotation.y = faceTowards(M.acteurs.nutzer, schalter);

      // ---- Props: the desk, the ladder, the toolbox, the switch ----
      const propMat = (targets: [number, number, number], color = 0xd7dde8) => {
        const m = new THREE.MeshLambertMaterial({
          color,
          transparent: true,
          opacity: 0,
        });
        track(m, targets);
        return m;
      };

      // The planner's workstation, built in the figure's own frame: +Z is the
      // direction they face, so the desk goes in front of them and the whole
      // group turns with `planerFacing`. Placing it in world coordinates would
      // mean redoing the trigonometry by hand every time the anchor moves.
      const deskMat = propMat([1, 0.15, 0.15]);
      const desk = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.85), deskMat);
      top.position.set(0, 0.74, 0.75);
      const pedestal = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 0.7), deskMat);
      pedestal.position.set(0, 0.37, 0.9);
      desk.add(top, pedestal);

      const chair = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), deskMat);
      seat.position.y = 0.44;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.06), deskMat);
      back.position.set(0, 0.72, -0.24);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.42, 8), deskMat);
      stem.position.y = 0.21;
      chair.add(seat, back, stem);
      desk.add(chair);

      const screenMat = propMat([1, 0.15, 0.15], 0xf3f6fb);
      const screen = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.62, 0.04), screenMat);
      screen.position.set(0, 1.15, 1.02);
      screen.rotation.x = 0.12;
      desk.add(screen);

      const keyboard = new THREE.Mesh(
        new THREE.BoxGeometry(0.44, 0.02, 0.16),
        propMat([1, 0.15, 0.15], 0xc3cbd8),
      );
      keyboard.position.set(0, 0.78, 0.55);
      desk.add(keyboard);

      // Coloured lines on the screen: the plan being drawn, in the colours of
      // the media it will become.
      [0, 3, 2].forEach((m, i) => {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(0.66, 0.045, 0.01),
          propMat([1, 0.12, 0.12], new THREE.Color(M.medien[m].color).getHex()),
        );
        bar.position.set(-0.08, 1.3 - i * 0.16, 0.99);
        bar.rotation.x = 0.12;
        desk.add(bar);
      });

      desk.position.set(...M.acteurs.planer);
      desk.rotation.y = planerFacing;
      scene.add(desk);

      // The installer's ladder and toolbox.
      const ladderMat = propMat([0, 1, 0.25], 0xb9c2d1);
      const ladder = new THREE.Group();
      for (const dx of [-0.22, 0.22]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.6, 0.05), ladderMat);
        rail.position.set(dx, 1.3, 0);
        ladder.add(rail);
      }
      for (let i = 0; i < 7; i++) {
        const rung = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.04, 0.04), ladderMat);
        rung.position.y = 0.25 + i * 0.35;
        ladder.add(rung);
      }
      ladder.position.set(
        M.acteurs.installateur[0] - 0.9,
        M.acteurs.installateur[1],
        M.acteurs.installateur[2],
      );
      ladder.rotation.z = 0.06;
      scene.add(ladder);

      const toolbox = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.28, 0.3),
        propMat([0, 1, 0.25], 0x90814e),
      );
      toolbox.position.set(
        M.acteurs.installateur[0] + 0.7,
        M.acteurs.installateur[1] + 0.14,
        M.acteurs.installateur[2] + 0.2,
      );
      scene.add(toolbox);

      // The switch is the one object whose material is not act-driven: it
      // answers the `running` flag, because that is what the third act is
      // about. Gold when on, grey when off.
      const switchMat = new THREE.MeshBasicMaterial({
        color: 0x90814e,
        transparent: true,
        opacity: 0,
      });
      const switchPlate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.04), switchMat);
      switchPlate.position.set(...schalter);
      scene.add(switchPlate);

      // ---- Hand the overlay what it needs, now that the model is here ----
      setModel({
        medien: M.medien,
        messpunkte: M.messpunkte,
        zentralen: M.zentralen,
        bauteile: M.inventar.gezeichnet.reduce((sum, r) => sum + r.n, 0),
      });

      // ---- Labels ----
      // Read on the next frame: the anchors above are state, so the DOM nodes
      // carrying `data-anchor` do not exist until React has re-rendered.
      const marks: { el: HTMLElement; at: Three.Vector3 }[] = [];
      const collect = () => {
        marks.length = 0;
        const layer = overlay.current;
        if (!layer) return;
        for (const node of Array.from(layer.querySelectorAll<HTMLElement>("[data-anchor]"))) {
          const [x, y, z] = node.dataset.anchor!.split(",").map(Number);
          marks.push({ el: node, at: new THREE.Vector3(x, y, z) });
        }
      };
      const mo = new MutationObserver(collect);
      if (overlay.current) mo.observe(overlay.current, { childList: true, subtree: true });
      collect();

      const ro = new ResizeObserver(() => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      });
      ro.observe(el);

      const clock = new THREE.Clock();
      const wantPos = new THREE.Vector3();
      const wantTarget = new THREE.Vector3();
      const projected = new THREE.Vector3();
      let raf = 0;
      let flowTime = 0;

      function frame() {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(clock.getDelta(), 0.05);
        const current = actRef.current;
        const on = runRef.current;

        const k = 1 - Math.exp(-dt * 3.5);
        for (const { mat, targets } of fading) {
          mat.opacity += (targets[current] - mat.opacity) * k;
        }

        // Media only move visibly while the plant is switched on — that is the
        // whole content of the third act.
        const flowTarget = current === 2 && on && !reduced ? 1 : 0;
        for (const m of flowMats) m.opacity += (flowTarget - m.opacity) * k;
        switchMat.opacity += ((current === 2 ? 1 : 0) - switchMat.opacity) * k;
        switchMat.color.setHex(on ? 0x90814e : 0x9aa4b4);

        if (on) flowTime += dt;

        // The two working figures keep working: the planner's forearms tick
        // over the keyboard, the installer's raised arm moves on the pipe.
        // Only in their own act — a figure fidgeting in the background while
        // another act is being read is noise.
        if (!reduced) {
          const t = clock.getElapsedTime();
          for (const l of limbs) {
            l.part.rotation.x =
              l.base + (l.act === current ? Math.sin(t * l.freq) * l.amp : 0);
          }
        }

        if (!free) {
          wantTarget.set(...VIEWS[current].target);
          // The framing is an offset from the target, scaled by the visitor's
          // zoom — not an absolute camera position.
          wantPos
            .set(...VIEWS[current].pos)
            .sub(wantTarget)
            .multiplyScalar(zoomFactor)
            .add(wantTarget);
          camera.position.lerp(wantPos, 1 - Math.exp(-dt * 1.8));
          controls.target.lerp(wantTarget, 1 - Math.exp(-dt * 1.8));
        }
        controls.update();

        if (flowTarget > 0) {
          for (const f of flows) {
            // 1.4 m/s along the run, wrapped — the slug leaves at one end and
            // re-enters at the source rather than bouncing back up the pipe.
            const u = (f.offset + (flowTime * 1.4) / Math.max(f.len, 0.001)) % 1;
            f.mesh.position.copy(f.curve.getPointAt(u));
          }
        }

        for (const m of marks) {
          projected.copy(m.at).project(camera);
          m.el.style.transform = `translate(-50%, -50%) translate(${
            ((projected.x + 1) / 2) * el.clientWidth
          }px, ${((-projected.y + 1) / 2) * el.clientHeight}px)`;
          m.el.style.visibility = projected.z > 1 ? "hidden" : "visible";
        }

        renderer.render(scene, camera);
      }
      frame();

      return () => {
        cancelAnimationFrame(raf);
        api.current = null;
        mo.disconnect();
        ro.disconnect();
        controls.dispose();
        renderer.dispose();
        scene.traverse((o) => {
          const mesh = o as Three.Mesh;
          mesh.geometry?.dispose?.();
        });
        renderer.domElement.remove();
      };
    }

    return () => {
      disposed = true;
      io.disconnect();
      cleanup?.();
    };
  }, []);

  return (
    /* Below lg the card is sized by aspect ratio, which is right when the width
       is whatever the phone gives it. From lg on it is sized by *height*
       instead: a 16/9 card at the container's full width is about 675 px tall,
       which on a 768 px laptop screen is the entire viewport and pushes the
       phase buttons and the caption below the fold. Height that answers to the
       viewport keeps the whole section in view; the cap stops it growing
       absurd on a tall monitor. */
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-surface shadow-card sm:aspect-[16/10] lg:aspect-auto lg:h-[min(58vh,560px)]">
      <div aria-hidden className="grid-bg absolute inset-0 opacity-50" />

      <div
        ref={host}
        className="absolute inset-0"
        role="img"
        aria-label="Dreidimensionales Modell des Projekts Guglera in Giffers, zusammengesetzt aus den IFC-Fachmodellen für Architektur, Heizung und Lüftung: Planer am Rechner, Installateur in der Heizzentrale, Nutzer im Obergeschoss, mit den Leitungen für Vor- und Rücklauf, Zu- und Abluft und Kaltwasser. Der Ablauf ist daneben als Text beschrieben."
      />

      {/* Labels ride above the canvas. `data-anchor` is the 3D point each one
          is pinned to; the render loop projects it and writes the transform. */}
      <div ref={overlay} aria-hidden className="pointer-events-none absolute inset-0">
        {/* The three figures carry no label in the scene. Who is acting is
            already said twice beside it — by the heading ("Der Installateur
            baut sie ein.") and by the act the reader just pressed — and a
            third time floating over the model was one too many. The figures
            still stand where the exporter put them; they read as people at
            1.8 m against a 51 m building, which is also the only thing in the
            scene giving it scale. */}

        {/* Two rooms are named in the scene, and only two: the plant rooms are
            where the building's services actually live, and the second act
            plays in one of them. Naming all 168 rooms would turn the model
            into a floor plan with labels all over it — and the rooms in this
            model are all called "Raum" anyway. */}
        {model?.zentralen.map((z) => (
          <div
            key={z.name}
            data-anchor={[z.at[0], z.at[1] + 2.4, z.at[2]].join(",")}
            className={`absolute left-0 top-0 transition-opacity duration-500 ${
              act === 0 ? "opacity-0" : "opacity-100"
            }`}
          >
            <span className="whitespace-nowrap rounded-sm bg-surface/90 px-1.5 py-0.5 eyebrow text-brand-blue ring-1 ring-line backdrop-blur-sm">
              {z.name}
            </span>
          </div>
        ))}

        {model?.messpunkte.map((mp) => (
          <div
            key={mp.id}
            data-anchor={mp.at.join(",")}
            className={`absolute left-0 top-0 transition-opacity duration-500 ${
              act === 2 && running ? "opacity-100" : "opacity-0"
            }`}
          >
            <span className="flex items-center gap-1.5 whitespace-nowrap rounded-sm bg-surface/90 px-1.5 py-0.5 ring-1 ring-line backdrop-blur-sm">
              <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[mp.tone]}`} />
              <span className={`font-mono text-[11px] font-medium tnum ${TONE_TEXT[mp.tone]}`}>
                {mp.value}
              </span>
            </span>
          </div>
        ))}
      </div>

      {/* Media legend. Five strands are only legible if the colours are named
          — this is the difference between "pipes" and "an installation". */}
      <ul
        className={`pointer-events-none absolute left-3 top-3 flex max-w-[70%] flex-wrap gap-x-3 gap-y-1 transition-opacity duration-500 ${
          status === "running" ? "opacity-100" : "opacity-0"
        }`}
      >
        {model?.medien
          .filter((m) => m.id !== "unbekannt")
          .map((m) => (
            <li key={m.id} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: m.color }}
              />
              <span className="eyebrow whitespace-nowrap text-muted">{m.short}</span>
            </li>
          ))}
      </ul>

      {/* Zoom as buttons, not only as a wheel gesture: they work on touch and
          from the keyboard, they are visible, and they cannot be triggered by
          scrolling past. */}
      {status === "running" && (
        <div className="absolute bottom-14 right-3 flex flex-col gap-1.5">
          {([1, -1] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={() => api.current?.zoom(dir)}
              aria-label={dir > 0 ? "Näher heranzoomen" : "Weiter herauszoomen"}
              className="grid h-8 w-8 place-items-center rounded-md bg-surface/90 text-[15px] font-medium text-ink ring-1 ring-line backdrop-blur-sm transition-colors hover:bg-surface hover:ring-line-strong"
            >
              <span aria-hidden>{dir > 0 ? "+" : "−"}</span>
            </button>
          ))}
        </div>
      )}

      {status !== "running" && (
        <div className="absolute inset-0 grid place-items-center">
          <p className="eyebrow text-muted">
            {status === "failed" ? "3D-Ansicht nicht verfügbar" : "Modell wird geladen …"}
          </p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-line bg-surface/80 px-4 py-2.5 backdrop-blur-sm">
        <span className="eyebrow text-muted">
          Guglera, Giffers · IFC
          {model ? ` · ${model.bauteile.toLocaleString("de-CH")} Bauteile` : ""}
        </span>
        <span className="eyebrow hidden text-muted sm:inline">
          Ziehen zum Drehen · + / − zoomt
        </span>
      </div>
    </div>
  );
}
