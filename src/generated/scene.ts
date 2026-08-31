/*
 * GENERIERT von cad/build_scene.py — nicht von Hand ändern.
 *
 * Geometrie aus cad/model.py, derselben Quelle wie das DXF-Planblatt,
 * das IFC-Modell und der Hero-Schnitt. Nach jeder Massänderung:
 *
 *   python cad/build_scene.py
 *
 * Koordinaten sind bereits in three.js-Konvention (y = oben) und um die
 * Gebäudemitte zentriert. Masse in Metern. Die Punktreihenfolge einer
 * Polylinie ist die Fliessrichtung des Mediums.
 */

export type Vec3 = [number, number, number];

export const building = {
  width: 13.4,
  depth: 24,
  wallT: 0.3,
  slabT: 0.3,
  roofLevel: 14.2,
  basementLevel: -3.1,
  terrainLevel: 0,
};

/** Rohdecken: eine je Geschoss plus Dach. `base` ist OK Rohboden. */
export const storeys = [
  { name: "UG", base: -3.1, height: 3.1 },
  { name: "EG", base: 0, height: 4.6 },
  { name: "1. OG", base: 4.6, height: 4.8 },
  { name: "2. OG", base: 9.4, height: 4.8 },
] as const;

/** Ein Strang je Medium. `lines` in Fliessrichtung, `gewerk` für die
 *  Legende, `color` aus MEDIEN in model.py. */
export const runs: {
  id: string;
  label: string;
  short: string;
  gewerk: string;
  color: string;
  radius: number;
  lines: Vec3[][];
  /** T-Stücke: Punkt, Achse des durchgehenden Strangs, Richtung des
   *  Abgangs. Ohne sie stossen zwei Rohre nur aneinander. */
  fittings: { at: Vec3; axis: Vec3; branch: Vec3 }[];
}[] = [
  {
    id: "heizwasser_vl",
    label: "Heizwasser Vorlauf",
    short: "Vorlauf",
    gewerk: "Heizung",
    color: "#A2542A",
    radius: 0.025,
    lines: [
      [[-4.3, -1.9, -0.7], [-4.3, 11.8, -0.7]],
      [[-4.3, 2.2, -0.7], [-0.81, 2.2, -0.7], [-0.81, 2.2, -0.525], [-0.81, 1.025, -0.525]],
      [[-4.3, 7, -0.7], [-1.06, 7, -0.7], [-1.06, 7, -0.525], [-1.06, 6.85, -0.525]],
      [[-4.3, 11.8, -0.7], [-1.06, 11.8, -0.7], [-1.06, 11.8, -0.525], [-1.06, 11.65, -0.525]],
    ],
    fittings: [
      { at: [-4.3, 2.2, -0.7], axis: [0, 1, 0], branch: [1, 0, 0] },
      { at: [-4.3, 7, -0.7], axis: [0, 1, 0], branch: [1, 0, 0] },
      { at: [-4.3, 11.8, -0.7], axis: [0, 1, 0], branch: [1, 0, 0] },
    ],
  },
  {
    id: "heizwasser_rl",
    label: "Heizwasser Rücklauf",
    short: "Rücklauf",
    gewerk: "Heizung",
    color: "#7C644C",
    radius: 0.025,
    lines: [
      [[-0.41, 1.025, -0.525], [-0.41, 2.2, -0.525], [-0.41, 2.2, -0.35], [-3.95, 2.2, -0.35]],
      [[-0.16, 6.85, -0.525], [-0.16, 7, -0.525], [-0.16, 7, -0.35], [-3.95, 7, -0.35]],
      [[-0.16, 11.65, -0.525], [-0.16, 11.8, -0.525], [-0.16, 11.8, -0.35], [-3.95, 11.8, -0.35]],
      [[-3.95, 11.8, -0.35], [-3.95, -1.9, -0.35]],
    ],
    fittings: [
      { at: [-3.95, 2.2, -0.35], axis: [0, 1, 0], branch: [1, 0, 0] },
      { at: [-3.95, 7, -0.35], axis: [0, 1, 0], branch: [1, 0, 0] },
      { at: [-3.95, 11.8, -0.35], axis: [0, 1, 0], branch: [1, 0, 0] },
    ],
  },
  {
    id: "bodenheizung",
    label: "Bodenheizung",
    short: "Bodenheizung",
    gewerk: "Heizung",
    color: "#BC764A",
    radius: 0.0085,
    lines: [
      [[-0.61, 0.825, -0.7], [-0.61, 0.08, -0.7], [-2.5, 0.08, -4], [-2.5, 0.08, -4], [1.7, 0.08, -4], [1.7, 0.08, -3.75], [-2.5, 0.08, -3.75], [-2.5, 0.08, -3.5], [1.7, 0.08, -3.5], [1.7, 0.08, -3.25], [-2.5, 0.08, -3.25], [-2.5, 0.08, -3], [1.7, 0.08, -3], [1.7, 0.08, -2.75], [-2.5, 0.08, -2.75], [-2.5, 0.08, -2.5], [1.7, 0.08, -2.5], [1.7, 0.08, -2.25], [-2.5, 0.08, -2.25], [-2.5, 0.08, -2], [1.7, 0.08, -2], [1.7, 0.08, -1.75], [-2.5, 0.08, -1.75], [-2.5, 0.08, -1.5], [1.7, 0.08, -1.5], [1.7, 0.08, -1.25], [-2.5, 0.08, -1.25], [-2.5, 0.08, -1], [1.7, 0.08, -1], [1.7, 0.08, -0.75], [-2.5, 0.08, -0.75], [-2.5, 0.08, -0.5], [1.7, 0.08, -0.5], [1.7, 0.08, -0.25], [-2.5, 0.08, -0.25], [-2.5, 0.08, 0], [1.7, 0.08, 0], [1.7, 0.08, 0.25], [-2.5, 0.08, 0.25], [-2.5, 0.08, 0.5], [1.7, 0.08, 0.5], [1.7, 0.08, 0.75], [-2.5, 0.08, 0.75], [-2.5, 0.08, 1], [1.7, 0.08, 1], [1.7, 0.08, 1.25], [-2.5, 0.08, 1.25], [-2.5, 0.08, 1.5], [1.7, 0.08, 1.5], [1.7, 0.08, 1.75], [-2.5, 0.08, 1.75], [-2.5, 0.08, 2], [1.7, 0.08, 2], [1.7, 0.08, 2.25], [-2.5, 0.08, 2.25], [-2.5, 0.08, 2.5], [1.7, 0.08, 2.5], [1.7, 0.08, 2.75], [-2.5, 0.08, 2.75], [-2.5, 0.08, 3], [1.7, 0.08, 3], [1.7, 0.08, 3.25], [-2.5, 0.08, 3.25], [-2.5, 0.08, 3.5], [1.7, 0.08, 3.5], [1.7, 0.08, 3.75], [-2.5, 0.08, 3.75], [-0.61, 0.08, 3.875], [-0.61, 0.825, 3.75]],
    ],
    fittings: [
    ],
  },
  {
    id: "zuluft",
    label: "Zuluft",
    short: "Zuluft",
    gewerk: "Lüftung",
    color: "#2C5691",
    radius: 0.125,
    lines: [
      [[-5.64, 12.74, 0.3], [5.63, 12.74, 0.3]],
      [[1.41, 12.74, 0.3], [1.41, 10.3, 0.3]],
      [[4.09, 12.74, 0.3], [4.09, 10.3, 0.3]],
      [[5.63, 12.74, 0.3], [5.63, 7.95, 0.3], [3.03, 7.95, 0.3]],
    ],
    fittings: [
      { at: [1.41, 12.74, 0.3], axis: [1, 0, 0], branch: [0, -1, 0] },
      { at: [4.09, 12.74, 0.3], axis: [1, 0, 0], branch: [0, -1, 0] },
    ],
  },
  {
    id: "abluft",
    label: "Abluft",
    short: "Abluft",
    gewerk: "Lüftung",
    color: "#7C91B2",
    radius: 0.11,
    lines: [
      [[1.41, 10.3, 0.85], [1.41, 12.29, 0.85]],
      [[4.09, 10.3, 0.85], [4.09, 12.29, 0.85]],
      [[5.63, 12.29, 0.85], [-5.64, 12.29, 0.85]],
    ],
    fittings: [
      { at: [1.41, 12.29, 0.85], axis: [1, 0, 0], branch: [0, -1, 0] },
      { at: [4.09, 12.29, 0.85], axis: [1, 0, 0], branch: [0, -1, 0] },
    ],
  },
  {
    id: "kaltwasser",
    label: "Kaltwasser",
    short: "Kaltwasser",
    gewerk: "Sanitär",
    color: "#2F7D77",
    radius: 0.02,
    lines: [
      [[5.23, -1.9, 1.4], [5.23, 5.76, 1.4]],
      [[5.23, 1.38, 1.4], [2.43, 1.38, 1.4], [2.43, 1.38, 1.68], [2.43, 1.1, 1.68]],
      [[5.23, 3.57, 1.4], [3.03, 3.57, 1.4]],
    ],
    fittings: [
      { at: [5.23, 1.38, 1.4], axis: [0, 1, 0], branch: [-1, 0, 0] },
      { at: [5.23, 3.57, 1.4], axis: [0, 1, 0], branch: [-1, 0, 0] },
    ],
  },
  {
    id: "warmwasser",
    label: "Warmwasser",
    short: "Warmwasser",
    gewerk: "Sanitär",
    color: "#B76E3C",
    radius: 0.0125,
    lines: [
      [[4.88, -1.9, 1.75], [4.88, 5.76, 1.75]],
      [[4.88, 1.56, 1.75], [2.83, 1.56, 1.75], [2.83, 1.56, 1.68], [2.83, 1.1, 1.68]],
      [[4.88, 3.75, 1.75], [3.03, 3.75, 1.75]],
    ],
    fittings: [
      { at: [4.88, 1.56, 1.75], axis: [0, 1, 0], branch: [-1, 0, 0] },
      { at: [4.88, 3.75, 1.75], axis: [0, 1, 0], branch: [-1, 0, 0] },
    ],
  },
  {
    id: "abwasser",
    label: "Abwasser",
    short: "Abwasser",
    gewerk: "Sanitär",
    color: "#706A5E",
    radius: 0.055,
    lines: [
      [[2.63, 0.76, 1.8], [2.63, 1.13, 1.8], [2.63, 1.13, 2.2], [5.78, 1.13, 2.2]],
      [[3.03, 3.32, 2.2], [5.78, 3.32, 2.2]],
      [[5.78, 3.32, 2.2], [5.78, -2.6, 2.2]],
    ],
    fittings: [
      { at: [5.78, 1.13, 2.2], axis: [0, 1, 0], branch: [-1, 0, 0] },
      { at: [5.78, 3.32, 2.2], axis: [0, 1, 0], branch: [-1, 0, 0] },
    ],
  },
];

/** Wärmepumpe im UG — Mittelpunkt und Kantenlängen. */
export const waermepumpe = {
  center: [-4.305, -2.4, 0] as Vec3,
  size: [2.35, 1.4, 1.2] as Vec3,
};

/** PV-Feld auf dem Dach: je Reihe Mittelpunkt, Neigung um die Tiefenachse. */
export const pvRows: { center: Vec3 }[] = [
  { center: [-3.945, 14.849, 0] },
  { center: [-1.515, 14.849, 0] },
  { center: [0.915, 14.849, 0] },
  { center: [3.345, 14.849, 0] },
];

export const pvModule = {
  length: 1.45,
  width: 8,
  thickness: 0.04,
  tiltDeg: 27,
};

/** Wo die drei Menschen stehen und was um sie herum steht. Alles aus
 *  der Anlage abgeleitet: der Installateur am Steigstrang im UG, der
 *  Nutzer beim Heizkörper im 1. OG, der Planer draussen am Rechner. */
export const acteurs = {
  planer: [-10.9, 0, 3.2] as Vec3,
  installateur: [-3, -3.1, 1.4] as Vec3,
  nutzer: [0.74, 4.6, 1.3] as Vec3,
};

export const props = {
  heizkoerper: [-0.61, 6.55, 0] as Vec3,
  schalter: [1.99, 5.9, 1.3] as Vec3,
  becken: [2.73, 3.02, 0] as Vec3,
};

/** Waschbecken im Sanitärraum — Endpunkt von Kalt- und Warmwasser,
 *  Anfang des Abwassers. */
export const waschbecken = {
  center: [2.63, 0.77, 1.8] as Vec3,
  size: [0.62, 0.18, 0.44] as Vec3,
};

/** Zuluftauslässe am Ende der Abwürfe — ein Kanal, der im Raum
 *  aufhört, ist kein Kanal. */
export const luftauslaesse: { center: Vec3 }[] = [
  { center: [1.41, 10.24, 0.3] },
  { center: [4.09, 10.24, 0.3] },
];
export const luftauslassSize: Vec3 = [0.6, 0.12, 0.4];

/** Heizkörper an den Abgängen der Obergeschosse. Das EG trägt keinen —
 *  dort liegt die Bodenheizung, gespeist aus dem Verteiler. */
export const heizkoerper: { center: Vec3 }[] = [
  { center: [-0.61, 6.55, -0.525] },
  { center: [-0.61, 11.35, -0.525] },
];
export const heizkoerperSize: Vec3 = [1.1, 0.6, 0.12];

/** Heizkreisverteiler der Bodenheizung, am Ende des EG-Abgangs. */
export const verteiler = {
  center: [-0.61, 0.75, -0.525] as Vec3,
  size: [0.7, 0.55, 0.16] as Vec3,
};

/** Die Gebäudehülle als Quader. `kind` steuert das Material in der
 *  Szene, `phase` wann das Teil erscheint: "roh" mit dem Rohbau im
 *  zweiten Akt, "ausbau" erst im dritten — erst Decken und Träger,
 *  dann Fassade und Glas. */
export const envelope: {
  kind: "dach" | "stein" | "glas" | "rahmen" | "balken";
  phase: "roh" | "ausbau";
  center: Vec3;
  size: Vec3;
}[] = [
  { kind: "dach", phase: "roh", center: [-1.6, 14.35, 2.1], size: [12.4, 0.3, 22] },
  { kind: "dach", phase: "roh", center: [5.55, 14.35, 0], size: [4.5, 0.3, 27.3] },
  { kind: "dach", phase: "roh", center: [-1.6, 9.25, -10.45], size: [12.4, 0.3, 5.3] },
  { kind: "stein", phase: "ausbau", center: [5.1, 5.55, 0], size: [3.2, 17.3, 25.1] },
  { kind: "glas", phase: "ausbau", center: [-1.575, 2.3, -12], size: [9.55, 3.404, 0.12] },
  { kind: "glas", phase: "ausbau", center: [-1.575, 2.3, 12], size: [9.55, 3.404, 0.12] },
  { kind: "rahmen", phase: "ausbau", center: [-1.575, 0.598, -12], size: [9.55, 0.09, 0.18] },
  { kind: "rahmen", phase: "ausbau", center: [-1.575, 0.598, 12], size: [9.55, 0.09, 0.18] },
  { kind: "rahmen", phase: "ausbau", center: [-1.575, 4.002, -12], size: [9.55, 0.09, 0.18] },
  { kind: "rahmen", phase: "ausbau", center: [-1.575, 4.002, 12], size: [9.55, 0.09, 0.18] },
  { kind: "glas", phase: "ausbau", center: [-1.575, 7, -12], size: [9.55, 3.552, 0.12] },
  { kind: "glas", phase: "ausbau", center: [-1.575, 7, 12], size: [9.55, 3.552, 0.12] },
  { kind: "rahmen", phase: "ausbau", center: [-1.575, 5.224, -12], size: [9.55, 0.09, 0.18] },
  { kind: "rahmen", phase: "ausbau", center: [-1.575, 5.224, 12], size: [9.55, 0.09, 0.18] },
  { kind: "rahmen", phase: "ausbau", center: [-1.575, 8.776, -12], size: [9.55, 0.09, 0.18] },
  { kind: "rahmen", phase: "ausbau", center: [-1.575, 8.776, 12], size: [9.55, 0.09, 0.18] },
  { kind: "glas", phase: "ausbau", center: [-1.575, 11.8, -7.8], size: [9.55, 3.552, 0.12] },
  { kind: "glas", phase: "ausbau", center: [-1.575, 11.8, 12], size: [9.55, 3.552, 0.12] },
  { kind: "rahmen", phase: "ausbau", center: [-1.575, 10.024, -7.8], size: [9.55, 0.09, 0.18] },
  { kind: "rahmen", phase: "ausbau", center: [-1.575, 10.024, 12], size: [9.55, 0.09, 0.18] },
  { kind: "rahmen", phase: "ausbau", center: [-1.575, 13.576, -7.8], size: [9.55, 0.09, 0.18] },
  { kind: "rahmen", phase: "ausbau", center: [-1.575, 13.576, 12], size: [9.55, 0.09, 0.18] },
  { kind: "glas", phase: "ausbau", center: [5.1, 8.9, -12.55], size: [1.4, 7.4, 0.12] },
  { kind: "dach", phase: "roh", center: [-2.7, 4.47, -12.95], size: [8, 0.26, 1.9] },
  { kind: "glas", phase: "ausbau", center: [-2.7, 5.125, -13.9], size: [8, 1.05, 0.08] },
  { kind: "balken", phase: "roh", center: [-6.35, 12.23, -10.3], size: [0.2, 0.26, 5.6] },
  { kind: "balken", phase: "roh", center: [-5.583, 12.23, -10.3], size: [0.191, 0.26, 5.6] },
  { kind: "balken", phase: "roh", center: [-4.817, 12.23, -10.3], size: [0.182, 0.26, 5.6] },
  { kind: "balken", phase: "roh", center: [-4.05, 12.23, -10.3], size: [0.173, 0.26, 5.6] },
  { kind: "balken", phase: "roh", center: [-3.283, 12.23, -10.3], size: [0.163, 0.26, 5.6] },
  { kind: "balken", phase: "roh", center: [-2.517, 12.23, -10.3], size: [0.154, 0.26, 5.6] },
  { kind: "balken", phase: "roh", center: [-1.75, 12.23, -10.3], size: [0.145, 0.26, 5.6] },
  { kind: "balken", phase: "roh", center: [-0.983, 12.23, -10.3], size: [0.136, 0.26, 5.6] },
  { kind: "balken", phase: "roh", center: [-0.217, 12.23, -10.3], size: [0.127, 0.26, 5.6] },
  { kind: "balken", phase: "roh", center: [0.55, 12.23, -10.3], size: [0.117, 0.26, 5.6] },
  { kind: "balken", phase: "roh", center: [1.317, 12.23, -10.3], size: [0.108, 0.26, 5.6] },
  { kind: "balken", phase: "roh", center: [2.083, 12.23, -10.3], size: [0.099, 0.26, 5.6] },
  { kind: "balken", phase: "roh", center: [2.85, 12.23, -10.3], size: [0.09, 0.26, 5.6] },
  { kind: "balken", phase: "roh", center: [-1.9, 12.02, -12.85], size: [9.6, 0.16, 0.18] },
  { kind: "balken", phase: "roh", center: [-1.9, 12.02, -7.9], size: [9.6, 0.16, 0.18] },
  { kind: "balken", phase: "roh", center: [-5.8, 10.75, -12.85], size: [0.16, 2.7, 0.16] },
  { kind: "balken", phase: "roh", center: [2.1, 10.75, -12.85], size: [0.16, 2.7, 0.16] },
];

/** Grobe Nutzungsaufteilung je Geschoss. `technik` markiert die
 *  Technikzentrale — sie bekommt in der Szene ein Schild, die
 *  übrigen Räume nur ihre Wände. Höhe ist die lichte Geschosshöhe. */
export const raeume: {
  storey: string;
  name: string;
  center: Vec3;
  size: Vec3;
  technik: boolean;
}[] = [
  {
    storey: "UG",
    name: "Technikzentrale",
    center: [-3.2, -1.55, -1.5],
    size: [6.2, 3.1, 9],
    technik: true,
  },
  {
    storey: "UG",
    name: "Lager",
    center: [3.3, -1.55, -1.5],
    size: [6, 3.1, 9],
    technik: false,
  },
  {
    storey: "UG",
    name: "Veloraum",
    center: [0, -1.55, 7.05],
    size: [12.6, 3.1, 6.9],
    technik: false,
  },
  {
    storey: "EG",
    name: "Empfang",
    center: [-4.8, 2.3, 0],
    size: [3, 4.6, 8.8],
    technik: false,
  },
  {
    storey: "EG",
    name: "Büro",
    center: [-0.5, 2.3, 0],
    size: [4.8, 4.6, 8.8],
    technik: false,
  },
  {
    storey: "EG",
    name: "Sanitär",
    center: [3.4, 2.3, 0],
    size: [2.2, 4.6, 8.8],
    technik: false,
  },
  {
    storey: "EG",
    name: "Nebenraum",
    center: [5.6, 2.3, 0],
    size: [1.4, 4.6, 8.8],
    technik: false,
  },
  {
    storey: "1. OG",
    name: "Büro Nord",
    center: [-4.2, 7, 0],
    size: [4.2, 4.8, 12],
    technik: false,
  },
  {
    storey: "1. OG",
    name: "Büro Mitte",
    center: [0.4, 7, 0],
    size: [4.2, 4.8, 12],
    technik: false,
  },
  {
    storey: "1. OG",
    name: "Büro Süd",
    center: [4.6, 7, 0],
    size: [3.4, 4.8, 12],
    technik: false,
  },
  {
    storey: "2. OG",
    name: "Grossraum",
    center: [-3.2, 11.8, 0],
    size: [6.2, 4.8, 12],
    technik: false,
  },
  {
    storey: "2. OG",
    name: "Sitzungszimmer",
    center: [3.3, 11.8, 0],
    size: [6, 4.8, 12],
    technik: false,
  },
];

/** Warmwasserspeicher in der Technikzentrale. */
export const speicher = {
  center: [-2.1, -2.15, 0] as Vec3,
  radius: 0.4,
  height: 1.9,
};

/** Lüftungsmonoblock am Anfang des Zuluftkanals. */
export const lueftungsgeraet = {
  center: [-5.64, 12.74, 0] as Vec3,
  size: [1.8, 1.1, 1.3] as Vec3,
};

/** Umwälzpumpe im Vorlauf, über der Wärmepumpe. `length` liegt in der
 *  Rohrachse (senkrecht), `housing` ist der Motor quer dazu. */
export const pumpe = {
  center: [-4.3, -1.2, -0.7] as Vec3,
  length: 0.34,
  housing: 0.22,
};

/** Die drei Messwerte aus model.py, als Punkte im Modell. Sie erscheinen
 *  im dritten Akt — gemessen wird an der laufenden Anlage. */
export const messpunkte: {
  id: string;
  value: string;
  label: string;
  tone: string;
  at: Vec3;
}[] = [
  {
    id: "MP-H-01",
    value: "38.6 °C",
    label: "Vorlauf",
    tone: "heat",
    at: [-0.61, 7, -0.7],
  },
  {
    id: "MP-L-01",
    value: "1'450 m³/h",
    label: "Volumenstrom",
    tone: "air",
    at: [5.63, 12.74, 0.3],
  },
  {
    id: "MP-S-01",
    value: "12 l/min",
    label: "Durchfluss",
    tone: "water",
    at: [2.63, 1.38, 1.4],
  },
];
