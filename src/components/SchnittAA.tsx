/*
 * GENERIERT von cad/build_svg.py — nicht von Hand ändern.
 *
 * Geometrie stammt aus cad/out/IEM-HLKS-101_Schnitt-AA.dxf, die
 * Beschriftung aus cad/model.py. Nach jeder Massänderung:
 *
 *   python cad/build_dxf.py && python cad/build_svg.py
 *
 * Die drei Trassen tragen pathLength="1" und strokeDasharray="1", damit
 * animate-draw unabhängig von der echten Pfadlänge sauber durchläuft.
 *
 * Darüber liegt je Trasse eine zweite Gruppe (.flow-run) mit einem hellen
 * Schlitten, der das Medium zeigt. Dauer und Strichlänge sind je Pfad aus
 * seiner echten Länge gerechnet, damit alle Stränge dieselbe
 * Geschwindigkeit in px/s haben. Unter prefers-reduced-motion blendet
 * globals.css .flow-run aus.
 */

export function SchnittAA({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 604 613" className={className} role="img"
      aria-label="Schematischer Gebäudeschnitt mit eingezeichneten Trassen für Heizung, Lüftung und Sanitär.">
      <defs>
        <pattern id="schnitt-hatch" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="8" className="stroke-line-strong" strokeWidth="1" />
        </pattern>
      </defs>

      {/* Terrain */}
      <path d="M14 482L92 482L92 498.5L14 498.5Z" fill="url(#schnitt-hatch)" opacity="0.7" />
      <path d="M512 482L590 482L590 498.5L512 498.5Z" fill="url(#schnitt-hatch)" opacity="0.7" />

      {/* Rohbau */}
      <g className="stroke-line-strong" fill="none" strokeWidth="1.2">
        <path d="M92 575L101 575L101 56L92 56Z" />
        <path d="M503 575L512 575L512 56L503 56Z" />
        <path d="M92 587L512 587L512 575L92 575Z" />
        <path d="M101 491L503 491L503 482L101 482Z" />
        <path d="M101 353L503 353L503 344L101 344Z" />
        <path d="M101 209L503 209L503 200L101 200Z" />
        <path d="M92 66.5L512 66.5L512 56L92 56Z" />
        <path d="M14 482L92 482" />
        <path d="M512 482L590 482" />
      </g>

      {/* Anlagen */}
      <g className="stroke-line-strong" fill="none" strokeWidth="1.1">
        <path d="M137.6 575L208.1 575L208.1 533L137.6 533Z" />
        <path d="M137.6 549L208.1 549" />
        <path d="M161.9 46.4L200.7 26.7" />
        <path d="M161.9 46.4L161.9 56" />
        <path d="M200.7 26.7L200.7 56" />
        <path d="M234.8 46.4L273.6 26.7" />
        <path d="M234.8 46.4L234.8 56" />
        <path d="M273.6 26.7L273.6 56" />
        <path d="M307.7 46.4L346.5 26.7" />
        <path d="M307.7 46.4L307.7 56" />
        <path d="M346.5 26.7L346.5 56" />
        <path d="M380.6 46.4L419.4 26.7" />
        <path d="M380.6 46.4L380.6 56" />
        <path d="M419.4 26.7L419.4 56" />
      </g>

      {/* Heizung */}
      <g className="stroke-disc-heat animate-draw" fill="none" strokeWidth="2.0" strokeLinecap="round" strokeDasharray="1">
        <path pathLength="1" d="M173 539L173 128" />
        <path pathLength="1" d="M173 416L283.7 416" />
        <path pathLength="1" d="M173 272L283.7 272" />
        <path pathLength="1" d="M173 128L283.7 128" />
        <path pathLength="1" d="M173 539L172.8 539" />
        <path pathLength="1" d="M172.8 539L172.8 533" />
      </g>
      {/* Durchfluss Heizung */}
      <g className="stroke-surface flow-run" fill="none" strokeWidth="1.1" strokeLinecap="round" opacity="0.9">
        <path pathLength="1" strokeDasharray="0.083 0.917" className="animate-flow" style={{ animationDuration: "5.9s", animationDelay: "1.40s" }} d="M173 539L173 128" />
        <path pathLength="1" strokeDasharray="0.307 0.693" className="animate-flow" style={{ animationDuration: "1.6s", animationDelay: "1.40s" }} d="M173 416L283.7 416" />
        <path pathLength="1" strokeDasharray="0.307 0.693" className="animate-flow" style={{ animationDuration: "1.6s", animationDelay: "1.40s" }} d="M173 272L283.7 272" />
        <path pathLength="1" strokeDasharray="0.307 0.693" className="animate-flow" style={{ animationDuration: "1.6s", animationDelay: "1.40s" }} d="M173 128L283.7 128" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.40s" }} d="M172.8 539L172.8 533" />
      </g>
      <circle cx="283.7" cy="416" r="3.6" className="fill-disc-heat" />
      <circle cx="283.7" cy="272" r="3.6" className="fill-disc-heat" />
      <circle cx="283.7" cy="128" r="3.6" className="fill-disc-heat" />

      {/* Lüftung */}
      <g className="stroke-disc-air animate-draw" fill="none" strokeWidth="2.0" strokeLinecap="round" strokeDasharray="1" style={{ animationDelay: "0.25s" }}>
        <path pathLength="1" d="M132.8 99.8L470.9 99.8" />
        <path pathLength="1" d="M344.3 99.8L344.3 173" />
        <path pathLength="1" d="M424.7 99.8L424.7 173" />
        <path pathLength="1" d="M470.9 99.8L470.9 243.5" />
        <path pathLength="1" d="M470.9 243.5L392.9 243.5" />
      </g>
      {/* Durchfluss Lüftung */}
      <g className="stroke-surface flow-run" fill="none" strokeWidth="1.1" strokeLinecap="round" opacity="0.9">
        <path pathLength="1" strokeDasharray="0.101 0.899" className="animate-flow" style={{ animationDuration: "4.8s", animationDelay: "1.65s" }} d="M132.8 99.8L470.9 99.8" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M344.3 99.8L344.3 173" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M424.7 99.8L424.7 173" />
        <path pathLength="1" strokeDasharray="0.237 0.763" className="animate-flow" style={{ animationDuration: "2.1s", animationDelay: "1.65s" }} d="M470.9 99.8L470.9 243.5" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M470.9 243.5L392.9 243.5" />
      </g>
      <circle cx="470.9" cy="99.8" r="3.6" className="fill-disc-air" />

      {/* Sanitär */}
      <g className="stroke-disc-water animate-draw" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="1" style={{ animationDelay: "0.5s" }}>
        <path pathLength="1" d="M458.9 539L458.9 309.2" />
        <path pathLength="1" d="M458.9 440.6L380.9 440.6" />
        <path pathLength="1" d="M458.9 374.9L392.9 374.9" />
      </g>
      {/* Durchfluss Sanitär */}
      <g className="stroke-surface flow-run" fill="none" strokeWidth="1.3" strokeLinecap="round" opacity="0.9">
        <path pathLength="1" strokeDasharray="0.148 0.852" className="animate-flow" style={{ animationDuration: "3.3s", animationDelay: "1.90s" }} d="M458.9 539L458.9 309.2" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.90s" }} d="M458.9 440.6L380.9 440.6" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.90s" }} d="M458.9 374.9L392.9 374.9" />
      </g>
      <circle cx="380.9" cy="440.6" r="3.6" className="fill-disc-water" />
      <circle cx="392.9" cy="374.9" r="3.6" className="fill-disc-water" />

      {/* Höhenmass und Geschosse — aus cad/model.py */}
      <g className="stroke-line-strong" strokeWidth="1">
        <path d="M35 56L35 482" />
        <path d="M28 56L42 56" />
        <path d="M28 482L42 482" />
      </g>
      <text x="29" y="269" transform="rotate(-90 29 269)" textAnchor="middle" className="fill-muted font-mono" fontSize="11">
        14.20 m
      </text>

      <g className="fill-muted font-mono" fontSize="10">
        <text x="111.5" y="528.5" dominantBaseline="middle">UG</text>
        <text x="111.5" y="413" dominantBaseline="middle">EG</text>
        <text x="111.5" y="272" dominantBaseline="middle">1. OG</text>
        <text x="111.5" y="128" dominantBaseline="middle">2. OG</text>
      </g>
    </svg>
  );
}

/** Messwerte aus cad/model.py, Position in % der Zeichenfläche. */
export const messpunkte = [
  {
    id: "MP-H-01",
    value: "38.6 °C",
    label: "Vorlauf",
    tone: "heat",
    side: "right",
    left: 46.97,
    top: 44.37,
    delay: "1.00s",
  },
  {
    id: "MP-L-01",
    value: "1'450 m³/h",
    label: "Volumenstrom",
    tone: "air",
    side: "left",
    left: 77.96,
    top: 16.28,
    delay: "1.15s",
  },
  {
    id: "MP-S-01",
    value: "12 l/min",
    label: "Durchfluss",
    tone: "water",
    side: "left",
    left: 63.06,
    top: 71.88,
    delay: "1.30s",
  },
] as const;

/** Seitenverhältnis der Zeichenfläche — der Hero rahmt damit die
 *  Fahnen deckungsgleich zum SVG ein. */
export const schnittAspect = "604 / 613";
