import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Navy-tinted "technical paper" ground, keyed to the logo navy.
        base: "#F6F8FB",
        surface: "#FFFFFF",
        "surface-2": "#EDF1F7",
        ink: "#0B1B33",
        muted: "#56657E",
        line: "#DCE3EC",
        "line-strong": "#BFCAD9",

        // The real IEM brand, read off the logo and the live site's CSS
        // custom properties. See CLAUDE.md before changing any of these.
        brand: {
          navy: "#003882", // logo fill — primary actions, dark panels
          blue: "#2C5691", // --sitecolor — links and interactive text on paper
          gold: "#90814E", // --linkcolor-hov — accent fills, rules, highlight band
          bronze: "#7A6C3F", // gold darkened for small text on paper (5.2:1)
          sand: "#CBB87F", // gold lightened for text on navy (5.5:1)
        },

        // Discipline hues, all derived from the navy/gold family and all
        // text-safe on `surface` (>= 4.8:1), so there is no separate "ink"
        // variant to keep in sync.
        disc: {
          heat: "#A2542A", // Heizung & HLK — bronze, the warm cousin of gold
          air: "#2C5691", // Lüftung & Klima — the site blue
          water: "#2F7D77", // Sanitär — teal
          power: "#7A6C3F", // Elektro & Automation — darkened gold
          energy: "#4F7A43", // Energie & Sanierung — moss
          model: "#003882", // BIM & 3D — the logo navy
        },
      },
      fontFamily: {
        display: ["Archivo", "Helvetica Neue", "system-ui", "sans-serif"],
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-xl": ["clamp(2.5rem, 4.6vw, 4rem)", { lineHeight: "1.03", letterSpacing: "-0.025em" }],
        "display-lg": ["clamp(2rem, 4.2vw, 2.875rem)", { lineHeight: "1.06", letterSpacing: "-0.02em" }],
        "display-md": ["clamp(1.5rem, 2.4vw, 2rem)", { lineHeight: "1.12", letterSpacing: "-0.015em" }],
      },
      letterSpacing: { "ultra-wide": "0.18em" },
      boxShadow: {
        card: "0 1px 2px rgba(0,56,130,0.05), 0 8px 24px -16px rgba(0,56,130,0.16)",
        glow: "0 0 0 1px rgba(0,56,130,0.35), 0 14px 34px -14px rgba(0,56,130,0.24)",
        rail: "0 1px 0 rgba(0,56,130,0.06)",
      },
      backgroundImage: {
        grid: "linear-gradient(rgba(0,56,130,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,56,130,0.05) 1px, transparent 1px)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-line": {
          "0%, 100%": { opacity: "0.45" },
          "50%": { opacity: "1" },
        },
        // Hero readout: a value "settles" the way a probe stabilises.
        sample: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "60%": { opacity: "1" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Schematic runs draw themselves in on load. Paths carry pathLength="1"
        // so this works regardless of a path's real length — a fixed dash array
        // leaves gaps in any run longer than the value.
        draw: {
          "0%": { strokeDashoffset: "1" },
          "100%": { strokeDashoffset: "0" },
        },
        // Medium travelling along a run once it has drawn itself in. Same
        // normalised unit as `draw` — the dash pattern's period is the whole
        // path, so exactly one slug is on a pipe at a time and the loop is
        // seamless. Duration is set per path by cad/build_svg.py from the
        // path's real length, so every run flows at the same px/s.
        flow: {
          "0%": { strokeDashoffset: "1" },
          "100%": { strokeDashoffset: "0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s cubic-bezier(0.22,1,0.36,1) both",
        "pulse-line": "pulse-line 2.4s ease-in-out infinite",
        sample: "sample 0.5s cubic-bezier(0.22,1,0.36,1) both",
        draw: "draw 1.4s cubic-bezier(0.22,1,0.36,1) both",
        // `backwards` holds the slug at the start of the pipe during its delay,
        // while the run is still drawing itself in. Duration and delay are
        // overridden inline per path — an inline style beats the shorthand.
        flow: "flow 3s linear infinite backwards",
      },
    },
  },
  plugins: [],
} satisfies Config;
