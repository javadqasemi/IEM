export const tokens = {
  color: {
    base: "#F6F8FB",
    surface: "#FFFFFF",
    surface2: "#EDF1F7",
    ink: "#0B1B33",
    muted: "#56657E",
    line: "#DCE3EC",
    lineStrong: "#BFCAD9",
    // The real IEM brand: logo navy, site blue, accent gold.
    brand: {
      navy: "#003882",
      blue: "#2C5691",
      gold: "#90814E",
      bronze: "#7A6C3F",
      sand: "#CBB87F",
    },
    // Discipline hues, all text-safe on a light ground.
    disc: {
      heat: "#A2542A",
      air: "#2C5691",
      water: "#2F7D77",
      power: "#7A6C3F",
      energy: "#4F7A43",
      model: "#003882",
    },
  },
  font: {
    display: "Archivo, Helvetica Neue, system-ui, sans-serif",
    sans: "IBM Plex Sans, system-ui, sans-serif",
    mono: "IBM Plex Mono, ui-monospace, monospace",
  },
  radius: { sm: "4px", md: "6px", lg: "10px", xl: "14px" },
  motion: {
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    duration: { fast: "180ms", base: "320ms", slow: "600ms" },
  },
} as const;

export type Tokens = typeof tokens;
