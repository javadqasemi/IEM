import type * as Three from "three";
import type { Modell } from "@/generated/scene_guglera";

/**
 * Baut das Fachmodell in eine three.js-Szene — geteilt von der 3D-Ansicht im
 * Ablauf und vom Hintergrund im Hero.
 *
 * Beide zeigen dasselbe Gebäude, inszenieren es aber verschieden: der Ablauf in
 * drei Akten mit Figuren und Beschriftung, der Hero als stille Kulisse über
 * sechs SIA-Phasen. Was beide gemeinsam haben, ist der Aufbau selbst — 2'451
 * Körper, 7'694 Rohre, 1'468 Rechteckkanäle und 18 Deckennetze, worin 1'475
 * Dämmhüllen stecken — und der gehört genau einmal geschrieben. Die
 * Inszenierung bleibt beim jeweiligen Aufrufer.
 *
 * Die Zahl der Bühnenbilder legt der Aufrufer fest: `deckkraft` gibt je
 * Kategorie ein Feld zurück, dessen Länge die Zahl der Stufen ist. Der Ablauf
 * übergibt drei (Akte), der Hero sechs (Phasen).
 */

export type Blende = { mat: { opacity: number }; targets: number[] };

export type Aufbau = {
  /** Materialien mit ihrem Deckkraftziel je Stufe. */
  blenden: Blende[];
  /** Die Schlitten, die das Medium durch das Netz tragen. */
  fluss: {
    curve: Three.Curve<Three.Vector3>;
    mesh: Three.Mesh;
    len: number;
    offset: number;
  }[];
  /** Materialien der Schlitten — der Aufrufer schaltet sie zusammen ein. */
  flussMaterialien: { opacity: number }[];
};

export function baueModell(
  THREE: typeof Three,
  scene: Three.Scene,
  M: Modell,
  opts: {
    /**
     * Deckkraft je Stufe für eine Körperkategorie.
     *
     * Die Kategorie kommt ganz herein, nicht nur ihre `phase`: ob die im
     * Modell hinterlegte `opacity` mitzählt, entscheidet der Aufrufer. Der
     * Ablauf multipliziert sie mit (Räume sind dort ein Hauch von Füllung),
     * der Hero nicht — dort sind die Räume in den frühen Phasen das Einzige,
     * was zu sehen ist, und 0.06 wäre gar nichts.
     */
    deckkraft: (kat: Modell["kategorien"][number]) => number[];
    /** Deckkraft der Leitungen je Stufe. */
    medienDeckkraft: number[];
    /**
     * Farbe je Kategorie überschreiben. Ohne das kommt die aus dem Modell —
     * die ist für die helle Karte im Ablauf gedacht, wo der Rohbau vor
     * farbiger Technik steht. Als Hintergrund auf Papiergrund braucht
     * derselbe Rohbau einen Tonwert, sonst ist es Weiss auf Weiss.
     */
    farbe?: (kat: Modell["kategorien"][number]) => string | undefined;
    /** Radius der Durchfluss-Schlitten in Metern. */
    schlittenRadius?: number;
  },
): Aufbau {
  const blenden: Blende[] = [];
  const merke = (mat: { opacity: number }, targets: number[]) =>
    blenden.push({ mat, targets });

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const mat4 = new THREE.Matrix4();

  // ---- Körper, eine InstancedMesh je Kategorie ----
  // Wände, Decken, Fenster, Türen, Räume, Heizkörper, Luftdurchlässe, Geräte,
  // Speicher, Armaturen, Zubehör. Jeder ist ein gedrehter Quader, den der
  // Exporter auf die eigene Grundfläche des Bauteils gelegt hat — eine schräg
  // stehende Wand ist damit diese Wand und nicht die Box darum.
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const jeKategorie: number[][] = M.kategorien.map(() => []);
  for (let i = 0; i < M.koerper.length; i += M.KOERPER_STRIDE) {
    jeKategorie[M.koerper[i]].push(i);
  }
  M.kategorien.forEach((kat, k) => {
    const idx = jeKategorie[k];
    if (!idx.length) return;
    const material = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.farbe?.(kat) ?? kat.color),
      transparent: true,
      opacity: 0,
      // Nur die nahezu deckenden Kategorien schreiben Tiefe. Eine
      // durchscheinende Wand, die Tiefe schreibt, verdeckt jedes Rohr dahinter
      // — genau verkehrt herum für eine Szene über die Installation.
      depthWrite: kat.phase === "technik",
      side: THREE.DoubleSide,
    });
    merke(material, opts.deckkraft(kat));

    const mesh = new THREE.InstancedMesh(unitBox, material, idx.length);
    idx.forEach((o, n) => {
      pos.set(M.koerper[o + 1], M.koerper[o + 2], M.koerper[o + 3]);
      scl.set(M.koerper[o + 4], M.koerper[o + 5], M.koerper[o + 6]);
      quat.setFromAxisAngle(up, M.koerper[o + 7]);
      mesh.setMatrixAt(n, mat4.compose(pos, quat, scl));
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  });

  // ---- Decken als echtes Netz ----
  // Die einzige Ausnahme von der Quaderregel. Ein Quader über einer
  // Geschossdecke füllt die Schächte, und dann verschwinden die Steigstränge,
  // wegen derer die Szene existiert. 18 Decken sind 472 Dreiecke.
  if (M.decken.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(M.decken, 3));
    geo.computeVertexNormals();
    // Die Decken zählen als „decke", damit sie dieselbe Farb- und
    // Deckkraftregel treffen wie die Wände.
    const alsDecke = M.kategorien.find((k) => k.id === "decke") ?? M.kategorien[0];
    const deckenMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.farbe?.(alsDecke) ?? alsDecke.color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    merke(deckenMat, opts.deckkraft(alsDecke).map((o) => o * 1.1));
    scene.add(new THREE.Mesh(geo, deckenMat));
  }

  // ---- Leitungen, je Medium eine InstancedMesh für Rohre und eine für Kanäle ----
  // Rundes und Rechteckiges sind zwei Körper, nicht einer. Ein Formstück steht
  // dabei als mehrere Stücke: der Exporter schneidet die Portachsen im
  // Bauteilmittelpunkt und zieht von dort je Anschluss einen Ast — ein Bogen
  // wird sein Bogen, ein T-Stück behält seinen Abzweig. Beides hier deshalb
  // nur noch aufstellen, nicht ausdenken.
  const unitTube = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const quer = new THREE.Vector3();
  const dritte = new THREE.Vector3();

  // Der Deckkraftfaktor des Mediums zählt mit. Für die fünf Medien ist er 1;
  // die Dämmung liegt als Hülle über dem Rohr und muss durchscheinen, sonst
  // sieht man von der Leitung nur noch ihre Verpackung.
  const leitungsMaterial = (medium: Modell["medien"][number]) => {
    const material = new THREE.MeshLambertMaterial({
      color: new THREE.Color(medium.color),
      transparent: true,
      opacity: 0,
      // Eine durchscheinende Hülle, die Tiefe schreibt, radiert das Rohr darin
      // aus — dasselbe Problem wie bei den Wänden weiter oben.
      depthWrite: medium.deckkraft >= 1,
    });
    merke(material, opts.medienDeckkraft.map((o) => o * medium.deckkraft));
    return material;
  };

  const jeMedium: number[][] = M.medien.map(() => []);
  for (let i = 0; i < M.straenge.length; i += M.STRANG_STRIDE) {
    jeMedium[M.straenge[i]].push(i);
  }
  M.medien.forEach((medium, m) => {
    const idx = jeMedium[m];
    if (!idx.length) return;
    const mesh = new THREE.InstancedMesh(unitTube, leitungsMaterial(medium), idx.length);
    idx.forEach((o, n) => {
      a.set(M.straenge[o + 1], M.straenge[o + 2], M.straenge[o + 3]);
      b.set(M.straenge[o + 4], M.straenge[o + 5], M.straenge[o + 6]);
      const r = M.straenge[o + 7];
      dir.subVectors(b, a);
      const len = dir.length() || 1e-4;
      pos.addVectors(a, b).multiplyScalar(0.5);
      // Ein Zylinder zeigt nach +Y; auf die Achse des Strangs drehen.
      quat.setFromUnitVectors(up, dir.divideScalar(len));
      scl.set(r, len, r);
      mesh.setMatrixAt(n, mat4.compose(pos, quat, scl));
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  });

  // ---- Rechteckkanäle ----
  // Die Querachse kommt fertig aus dem Modell, statt sie hier zu raten: sie
  // steht in der Platzierung des Anschlusses. Damit wird die Drehung um die
  // Kanalachse aus der Basis (Querachse, Achse, Kreuzprodukt) aufgebaut und
  // nicht über setFromUnitVectors, das für die Drehung um die eigene Achse
  // keine Aussage macht — ein hochkant stehender 200 × 700er läge sonst
  // zufällig flach.
  const kanalIdx: number[][] = M.medien.map(() => []);
  for (let i = 0; i < M.kanaele.length; i += M.KANAL_STRIDE) {
    kanalIdx[M.kanaele[i]].push(i);
  }
  M.medien.forEach((medium, m) => {
    const idx = kanalIdx[m];
    if (!idx.length) return;
    const mesh = new THREE.InstancedMesh(unitBox, leitungsMaterial(medium), idx.length);
    idx.forEach((o, n) => {
      a.set(M.kanaele[o + 1], M.kanaele[o + 2], M.kanaele[o + 3]);
      b.set(M.kanaele[o + 4], M.kanaele[o + 5], M.kanaele[o + 6]);
      const breite = M.kanaele[o + 7];
      const hoehe = M.kanaele[o + 8];
      quer.set(M.kanaele[o + 9], M.kanaele[o + 10], M.kanaele[o + 11]);
      dir.subVectors(b, a);
      const len = dir.length() || 1e-4;
      dir.divideScalar(len);
      // Querachse gegen die Kanalachse orthonormieren, dann die dritte dazu.
      quer.addScaledVector(dir, -quer.dot(dir));
      if (quer.lengthSq() < 1e-12) quer.set(1, 0, 0).addScaledVector(dir, -dir.x);
      quer.normalize();
      dritte.crossVectors(quer, dir).normalize();
      pos.addVectors(a, b).multiplyScalar(0.5);
      mat4.makeBasis(quer, dir, dritte);
      quat.setFromRotationMatrix(mat4);
      scl.set(breite, len, hoehe);
      mesh.setMatrixAt(n, mat4.compose(pos, quat, scl));
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  });

  // ---- Das Medium selbst, auf dem Netz unterwegs ----
  // Der Exporter verkettet die Einzelbauteile eines Mediums zu durchgehenden
  // Zügen, die längsten zuerst. Ein Schlitten, der nach 40 cm am nächsten
  // Formstück endet, zeigt keinen Kreislauf.
  const fluss: Aufbau["fluss"] = [];
  const flussMaterialien: { opacity: number }[] = [];
  const jeMediumMat = new Map<number, Three.MeshBasicMaterial>();

  M.fliesslinien.forEach((linie, i) => {
    let material = jeMediumMat.get(linie.medium);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(M.medien[linie.medium].color),
        transparent: true,
        opacity: 0,
      });
      jeMediumMat.set(linie.medium, material);
      flussMaterialien.push(material);
    }
    const pts = linie.punkte.map((p) => new THREE.Vector3(...p));
    const pfad = new THREE.CurvePath<Three.Vector3>();
    for (let j = 0; j < pts.length - 1; j++) {
      if (pts[j].distanceTo(pts[j + 1]) > 1e-5) {
        pfad.add(new THREE.LineCurve3(pts[j], pts[j + 1]));
      }
    }
    if (!pfad.curves.length) return;
    const schlitten = new THREE.Mesh(
      new THREE.SphereGeometry(opts.schlittenRadius ?? 0.14, 10, 8),
      material,
    );
    scene.add(schlitten);
    fluss.push({
      curve: pfad,
      mesh: schlitten,
      len: pfad.getLength(),
      offset: (i * 0.37) % 1,
    });
  });

  return { blenden, fluss, flussMaterialien };
}
