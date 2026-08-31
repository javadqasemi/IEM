/*
 * GENERIERT von cad/build_svg_ifc.py — nicht von Hand ändern.
 *
 * Schnitt durch das Fachmodell zum Projekt Guglera, Giffers:
 * ifc/4723_Architektur.ifc, ifc/4723_Heizung.ifc, ifc/4723_Lüftung.ifc.
 * Neu erzeugen mit:
 *
 *   python cad/build_svg_ifc.py
 *
 * Schnittebene x = 5.00 m, Technik aus einem Band von
 * ±8.00 m darum auf die Ebene projiziert. Rohbau sind echte
 * Schnittkanten (Ebene gegen das Dreiecksnetz), die Punkte sind quer
 * zur Ebene laufende, also angeschnittene Stränge.
 *
 * Die Trassen tragen pathLength="1" und strokeDasharray="1", damit
 * animate-draw unabhängig von der echten Pfadlänge durchläuft; darüber
 * liegt je Gewerk eine .flow-run-Gruppe, deren Dauer und Strichlänge
 * pro Pfad aus seiner Pixellänge gerechnet sind.
 */

export function SchnittGuglera({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 645.6 601" className={className} role="img"
      aria-label="Gebäudeschnitt aus dem IFC-Fachmodell: neun Geschosse mit den Trassen für Heizung, Lüftung und Sanitär.">

      {/* Rohbau — Schnittflächen aus dem Architekturmodell */}
      <g className="fill-brand-navy stroke-brand-navy" fillOpacity="0.10" strokeOpacity="0.45" strokeWidth="0.9" strokeLinejoin="round">
        <path d="M437.4 102.5L445.6 102.5L445.6 58.1L437.4 58.1Z" />
        <path d="M303.9 102.5L303.9 58.1L307.5 58.1L307.5 102.5Z" />
        <path d="M239.1 102.5L242.7 102.5L242.7 58.1L239.1 58.1Z" />
        <path d="M113.5 102.5L113.5 58.1L118.2 58.1L118.2 102.5Z" />
        <path d="M432.1 102.5L432.1 58.1L437.4 58.1L437.4 102.5Z" />
        <path d="M108.3 102.5L108.3 58.1L111.5 58.1L111.5 102.5Z" />
        <path d="M111.5 58.1L111.5 52.3L445.6 52.3L445.6 58.1Z" />
        <path d="M111.5 102.5L111.5 58.1L113.5 58.1L113.5 102.5Z" />
        <path d="M239.1 152L242.7 152L242.7 106.1L239.1 106.3Z" />
        <path d="M108.3 152L108.3 106.1L113.5 106.1L113.5 152Z" />
        <path d="M437.4 152L445.6 152L445.6 106.1L437.4 106.1Z" />
        <path d="M195.2 152L195.2 106.1L195.8 106.1L195.8 152Z" />
        <path d="M108.3 106.1L108.3 102.5L445.6 102.5L445.6 106.1Z" />
        <path d="M113.5 152L113.5 106.1L118.2 106.1L118.2 152Z" />
        <path d="M432.7 152L432.7 106.1L437.4 106.1L437.4 152Z" />
        <path d="M303.9 152L303.9 106.1L307.5 106.1L307.5 152Z" />
        <path d="M108.3 201.5L113.6 201.5L113.6 155.6L108.3 155.6Z" />
        <path d="M304 201.5L304 155.6L307.6 155.6L307.6 201.5Z" />
        <path d="M239.2 201.5L242.8 201.5L242.8 155.6L239.2 155.6Z" />
        <path d="M108.3 155.6L108.3 152L460 152L460 155.6Z" />
        <path d="M452 201.5L459.3 201.5L459.3 155.6L452 155.6Z" />
        <path d="M113.6 201.5L113.6 155.6L118.3 155.6L118.3 201.5Z" />
        <path d="M108.3 251L113.6 251L113.6 205.1L108.3 205.1Z" />
        <path d="M239.2 251L242.8 251L242.8 205.1L239.2 205.1Z" />
        <path d="M304 251L304 205.1L307.6 205.1L307.6 251Z" />
        <path d="M108.3 205.1L108.3 201.5L460 201.5L460 205.1Z" />
        <path d="M451.8 251L459.1 251L459.1 205.1L451.8 205.1Z" />
        <path d="M113.6 251L113.6 205.1L118.3 205.1L118.3 251Z" />
        <path d="M108.3 300.5L113.6 300.5L113.6 254.6L108.3 254.6Z" />
        <path d="M451.8 300.5L460 300.5L460 254.6L451.8 254.6Z" />
        <path d="M239.2 300.5L242.8 300.5L242.8 254.6L239.2 254.6Z" />
        <path d="M304 300.5L304 254.6L307.6 254.6L307.6 300.5Z" />
        <path d="M108.3 254.6L108.3 251L460 251L460 254.6Z" />
        <path d="M113.6 300.5L113.6 254.6L118.3 254.6L118.3 300.5Z" />
        <path d="M238.2 350L238.2 304.1L242.7 304.1L242.7 350Z" />
        <path d="M304 350L304 304.1L307.6 304.1L307.6 350Z" />
        <path d="M432.2 350L435.4 350L435.4 343.9L432.2 343.9Z" />
        <path d="M432.2 310.2L435.4 310.2L435.4 304.1L432.2 304.1Z" />
        <path d="M55.3 350L55.3 304.1L60.5 304.1L60.5 350Z" />
        <path d="M108.3 304.1L108.3 300.5L460 300.5L460 304.1Z" />
        <path d="M55.3 304.1L55.3 300.5L108.3 300.5L108.3 304.1Z" />
        <path d="M303.4 407.6L303.4 354.7L307.9 354.7L307.9 407.6Z" />
        <path d="M238.6 407.6L238.6 354.7L243.1 354.7L243.1 407.6Z" />
        <path d="M52.3 407.6L52.3 354.7L60.5 354.7L60.5 407.6Z" />
        <path d="M615.1 407.6L623.3 407.6L623.3 354.7L615.1 354.7Z" />
        <path d="M433.9 407.6L436.6 407.6L436.6 354.7L433.9 354.7Z" />
        <path d="M191 407.6L193.7 407.6L193.7 354.7L191 354.7Z" />
        <path d="M481.9 407.6L481.9 354.7L484.6 354.7L484.6 407.6Z" />
        <path d="M52.3 354.7L52.3 350L435.4 350L435.4 354.7Z" />
        <path d="M435.4 354.7L435.4 350L623.3 350L623.3 354.7Z" />
        <path d="M303.6 477.8L303.6 412.8L308.1 412.8L308.1 477.8Z" />
        <path d="M238.8 441.8L238.8 412.8L243.3 412.8L243.3 441.8Z" />
        <path d="M69 477.8L69 412.8L79 412.8L79 477.8Z" />
        <path d="M191.1 477.8L193.8 477.8L193.8 412.8L191.1 412.8Z" />
        <path d="M55.3 412.8L55.3 407.6L620.3 407.6L620.3 412.8Z" />
        <path d="M308.1 421.8L308.1 412.8L597.6 412.8L597.6 421.8Z" />
        <path d="M597.6 477.8L607.5 477.8L607.5 412.8L597.6 412.8Z" />
        <path d="M71.1 526.4L71.1 482.5L79 482.5L79 526.4Z" />
        <path d="M596.2 526.4L605.4 526.4L605.4 482.5L596.2 482.5Z" />
        <path d="M71.1 482.5L71.1 477.8L605.4 477.8L605.4 482.5Z" />
        <path d="M238.8 538.7L238.8 536.5L436.8 536.5L436.8 538.7Z" />
        <path d="M71.1 529.5L71.1 526.4L238.8 526.4L238.8 529.5Z" />
        <path d="M436.8 529.5L436.8 526.4L605.4 526.4L605.4 529.5Z" />
      </g>

      {/* Höhenkoten der Geschosse — aus den IfcBuildingStorey */}
      <g className="fill-muted font-mono" fontSize="9">
        <text x="16" y="533.5">−2.75</text>
        <text x="16" y="474.8">+0.51</text>
        <text x="16" y="404.6">+4.41</text>
        <text x="16" y="347">+7.61</text>
        <text x="16" y="297.5">+10.36</text>
        <text x="16" y="248">+13.11</text>
        <text x="16" y="198.5">+15.86</text>
        <text x="16" y="149">+18.61</text>
        <text x="16" y="99.5">+21.36</text>
      </g>

      {/* heizwasser_rl */}
      <g className="stroke-disc-heat animate-draw" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1" opacity="0.55">
        <path pathLength="1" d="M61.8 348.9L62.2 346.2" />
        <path pathLength="1" d="M61.8 348.6L61.8 346.2" />
        <path pathLength="1" d="M62 406.2L62 403.8" />
        <path pathLength="1" d="M80.3 476.7L90.4 476.7" />
        <path pathLength="1" d="M80.6 476.7L81.6 476.4L81.6 474" />
        <path pathLength="1" d="M80.9 476.4L80.9 474" />
        <path pathLength="1" d="M114.8 299.4L119.8 299.4" />
        <path pathLength="1" d="M114.8 249.9L119.8 249.9" />
        <path pathLength="1" d="M114.7 200.4L119.8 200.4" />
        <path pathLength="1" d="M115.1 299.4L115.4 296.7" />
        <path pathLength="1" d="M115.1 249.9L115.4 247.2" />
        <path pathLength="1" d="M115.1 200.4L115.4 197.7" />
        <path pathLength="1" d="M115.3 148.2L115.3 150.6L114.9 150.9L115.7 150.6L115.7 148.2" />
        <path pathLength="1" d="M115.3 98.7L115.3 101.1L114.9 101.4L115.7 101.1L115.7 98.7" />
        <path pathLength="1" d="M235.5 306.8L293 306.8L293 307.4" />
        <path pathLength="1" d="M246.5 407.3L246.8 403.5" />
        <path pathLength="1" d="M289.9 306.8L298.1 306.8" />
        <path pathLength="1" d="M290.5 306.8L428.9 306.8" />
        <path pathLength="1" d="M294.6 60.2L301.4 60.2L301.9 60.7" />
        <path pathLength="1" d="M295 60.2L349 60.2L349 66.1" />
        <path pathLength="1" d="M298.1 307.7L298.1 305" />
        <path pathLength="1" d="M298.4 61.7L302.7 61.7" />
        <path pathLength="1" d="M302.7 98.4L303 62" />
        <path pathLength="1" d="M356.8 526.6L357 484.7L430.5 484.7L423.1 484.7L422.4 485.3L422.4 536.5" />
        <path pathLength="1" d="M364.2 489.7L364.2 484.7" />
        <path pathLength="1" d="M415.9 536.5L415.9 485.3L416.6 484.7L429.8 484.7" />
        <path pathLength="1" d="M415.9 535.8L415.9 527.5" />
        <path pathLength="1" d="M424.2 484.7L429.6 484.7" />
        <path pathLength="1" d="M429.9 486.4L431.8 484.5L468.8 484.5L472.5 488.6" />
        <path pathLength="1" d="M430.1 407.3L455.8 407.3L455.8 359.5L455.5 361.7L430.1 361.4" />
        <path pathLength="1" d="M431.2 150.9L436.2 150.9" />
        <path pathLength="1" d="M432.1 361.4L455.5 361.7" />
        <path pathLength="1" d="M432.1 346.2L435.3 345.9" />
        <path pathLength="1" d="M432.4 495.1L432.9 494.6L440.4 494.6" />
        <path pathLength="1" d="M432.4 493.6L432.4 487L433.3 486.1L447.6 486.1" />
        <path pathLength="1" d="M435.2 98.7L435.2 101.1L436.2 101.4" />
        <path pathLength="1" d="M435.6 296.7L435.9 299.4" />
        <path pathLength="1" d="M435.6 247.2L435.9 249.9" />
        <path pathLength="1" d="M435.6 197.7L435.9 200.4" />
        <path pathLength="1" d="M435.6 148.2L435.9 150.9" />
        <path pathLength="1" d="M435.6 98.7L435.9 101.4" />
        <path pathLength="1" d="M436.2 299.4L450.6 299.4" />
        <path pathLength="1" d="M436.2 249.9L451 249.9" />
        <path pathLength="1" d="M436.2 200.4L451 200.4" />
        <path pathLength="1" d="M438.4 403.2L438.4 359.3L455.5 359" />
        <path pathLength="1" d="M440.4 486.1L440.4 499.2L440.8 499.6L543 499.6L543.4 499.2L543.4 487.9" />
        <path pathLength="1" d="M450 296.7L450.3 299.4" />
        <path pathLength="1" d="M450.3 247.2L450.6 249.9" />
        <path pathLength="1" d="M450.3 197.7L450.6 200.4" />
        <path pathLength="1" d="M507.9 504.8L508.6 504.1L543 504.1L543.4 503.7L543.4 488.3" />
        <path pathLength="1" d="M595.4 474L595.4 476.4L596.3 476.7" />
        <path pathLength="1" d="M610.2 406.5L614.4 406.5" />
        <path pathLength="1" d="M610.5 406.5L614 406.5L613.8 403.8" />
      </g>
      <g className="stroke-surface flow-run" fill="none" strokeWidth="0.8" strokeLinecap="round" opacity="0.9">
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.40s" }} d="M235.5 306.8L293 306.8L293 307.4" />
        <path pathLength="1" strokeDasharray="0.217 0.783" className="animate-flow" style={{ animationDuration: "2.0s", animationDelay: "1.40s" }} d="M290.5 306.8L428.9 306.8" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.40s" }} d="M295 60.2L349 60.2L349 66.1" />
        <path pathLength="1" strokeDasharray="0.171 0.829" className="animate-flow" style={{ animationDuration: "2.5s", animationDelay: "1.40s" }} d="M356.8 526.6L357 484.7L430.5 484.7L423.1 484.7L422.4 485.3L422.4 536.5" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.40s" }} d="M415.9 536.5L415.9 485.3L416.6 484.7L429.8 484.7" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.40s" }} d="M429.9 486.4L431.8 484.5L468.8 484.5L472.5 488.6" />
        <path pathLength="1" strokeDasharray="0.297 0.703" className="animate-flow" style={{ animationDuration: "1.4s", animationDelay: "1.40s" }} d="M430.1 407.3L455.8 407.3L455.8 359.5L455.5 361.7L430.1 361.4" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.40s" }} d="M438.4 403.2L438.4 359.3L455.5 359" />
        <path pathLength="1" strokeDasharray="0.235 0.765" className="animate-flow" style={{ animationDuration: "1.8s", animationDelay: "1.40s" }} d="M440.4 486.1L440.4 499.2L440.8 499.6L543 499.6L543.4 499.2L543.4 487.9" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.40s" }} d="M507.9 504.8L508.6 504.1L543 504.1L543.4 503.7L543.4 488.3" />
      </g>
      <g className="fill-disc-heat" opacity="0.55">
        <circle cx="430.3" cy="101.4" r="1.6" />
        <circle cx="294.6" cy="60.2" r="1.6" />
        <circle cx="119.1" cy="101.4" r="1.6" />
        <circle cx="430.9" cy="150.9" r="1.6" />
        <circle cx="119.1" cy="150.9" r="1.6" />
        <circle cx="451.3" cy="200.4" r="1.6" />
        <circle cx="120.1" cy="200.4" r="1.6" />
        <circle cx="120.1" cy="249.9" r="1.6" />
        <circle cx="451.3" cy="249.9" r="1.6" />
        <circle cx="450.9" cy="299.4" r="1.6" />
        <circle cx="120.1" cy="299.4" r="1.6" />
        <circle cx="297.7" cy="306.8" r="1.6" />
        <circle cx="428.9" cy="306.8" r="1.6" />
        <circle cx="455.8" cy="359" r="1.6" />
        <circle cx="65.4" cy="406.5" r="1.6" />
        <circle cx="610.2" cy="406.5" r="1.6" />
        <circle cx="80.3" cy="476.7" r="1.6" />
        <circle cx="543.4" cy="487.9" r="1.6" />
        <circle cx="447.6" cy="486.1" r="1.6" />
      </g>

      {/* heizwasser_vl */}
      <g className="stroke-disc-heat animate-draw" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1" opacity="1.0">
        <path pathLength="1" d="M61.8 347.9L62.2 342.6" />
        <path pathLength="1" d="M61.8 347.5L61.8 342.6" />
        <path pathLength="1" d="M62 405.1L62 396.6" />
        <path pathLength="1" d="M80.6 475.7L81.6 475.3L81.6 468.6" />
        <path pathLength="1" d="M80.9 475.3L80.9 468.6" />
        <path pathLength="1" d="M114.8 298.4L119.8 298.4" />
        <path pathLength="1" d="M114.8 248.9L119.8 248.9" />
        <path pathLength="1" d="M114.7 199.4L119.8 199.4" />
        <path pathLength="1" d="M115.1 298.4L115.4 293.1" />
        <path pathLength="1" d="M115.1 248.9L115.4 243.6" />
        <path pathLength="1" d="M115.1 199.4L115.4 194.1" />
        <path pathLength="1" d="M115.3 144.6L115.3 149.5L114.9 149.9L115.7 149.5L115.7 144.6" />
        <path pathLength="1" d="M115.3 95.1L115.3 100L114.9 100.4L115.7 100L115.7 95.1" />
        <path pathLength="1" d="M195.5 356.9L195.5 362.7L195.9 363.2L301.4 363.2L301.9 362.7" />
        <path pathLength="1" d="M231.9 306.8L295.5 306.8L295.5 307.4" />
        <path pathLength="1" d="M245 407.3L245.4 372.9" />
        <path pathLength="1" d="M291.9 60.2L301.4 60.2L301.9 60.7" />
        <path pathLength="1" d="M293.5 306.8L300.6 306.8" />
        <path pathLength="1" d="M294.1 306.8L426.4 306.8" />
        <path pathLength="1" d="M300.6 307.7L300.6 305" />
        <path pathLength="1" d="M300.6 61.1L302.7 60.8" />
        <path pathLength="1" d="M302.7 67.8L303 61.1" />
        <path pathLength="1" d="M351 60.2L351.7 60.2L351.7 66.1" />
        <path pathLength="1" d="M367.8 489.7L367.8 484.7L426.9 484.7L422.4 484.7L422.4 485.3" />
        <path pathLength="1" d="M368.8 484.7L386.4 484.7L386.4 526.6" />
        <path pathLength="1" d="M415.9 528.2L415.9 484.7L426.2 484.7" />
        <path pathLength="1" d="M423.3 484.7L426 484.7" />
        <path pathLength="1" d="M429.5 361.7L451.9 361.7L452.2 359.5L452.2 407.3L430.1 407.3" />
        <path pathLength="1" d="M430.1 486.4L432 484.5L468.8 484.5L472.5 488.6" />
        <path pathLength="1" d="M430.4 361.7L451.9 361.7" />
        <path pathLength="1" d="M430.6 100.4L436.7 100.4L431.5 100.4L436.1 100.4L435.2 100L435.2 95.1" />
        <path pathLength="1" d="M430.9 342.3L435.3 342.3" />
        <path pathLength="1" d="M431.2 149.9L436.2 149.9" />
        <path pathLength="1" d="M432.4 495L432.8 494.6L444 494.6" />
        <path pathLength="1" d="M432.4 487L433.3 486.1L451.2 486.1" />
        <path pathLength="1" d="M435.6 293.1L435.9 298.4" />
        <path pathLength="1" d="M435.6 243.6L435.9 248.9" />
        <path pathLength="1" d="M435.6 194.1L435.9 199.4" />
        <path pathLength="1" d="M435.6 144.6L435.9 149.9" />
        <path pathLength="1" d="M435.6 95.1L435.9 100.4" />
        <path pathLength="1" d="M436.2 298.4L450.6 298.4" />
        <path pathLength="1" d="M436.2 248.9L451 248.9" />
        <path pathLength="1" d="M436.2 199.4L451 199.4" />
        <path pathLength="1" d="M438.4 369L438.8 359L451.9 359" />
        <path pathLength="1" d="M444 486.1L444 499.2L444.4 499.6L540.3 499.6L540.7 499.2L540.7 487.9" />
        <path pathLength="1" d="M450 293.1L450.3 298.4" />
        <path pathLength="1" d="M450.3 243.6L450.6 248.9" />
        <path pathLength="1" d="M450.3 194.1L450.6 199.4" />
        <path pathLength="1" d="M540.3 504.1L540.7 503.7L540.7 488.3" />
        <path pathLength="1" d="M595.4 468.6L595.4 475.3L596.4 475.7" />
        <path pathLength="1" d="M610.2 405.5L614.3 405.5" />
        <path pathLength="1" d="M610.5 405.5L614 405.5" />
        <path pathLength="1" d="M613.8 405.1L613.8 396.6" />
      </g>
      <g className="stroke-surface flow-run" fill="none" strokeWidth="1.1" strokeLinecap="round" opacity="0.9">
        <path pathLength="1" strokeDasharray="0.266 0.734" className="animate-flow" style={{ animationDuration: "1.6s", animationDelay: "1.40s" }} d="M195.5 356.9L195.5 362.7L195.9 363.2L301.4 363.2L301.9 362.7" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.40s" }} d="M231.9 306.8L295.5 306.8L295.5 307.4" />
        <path pathLength="1" strokeDasharray="0.227 0.773" className="animate-flow" style={{ animationDuration: "1.9s", animationDelay: "1.40s" }} d="M294.1 306.8L426.4 306.8" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.40s" }} d="M367.8 489.7L367.8 484.7L426.9 484.7L422.4 484.7L422.4 485.3" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.40s" }} d="M368.8 484.7L386.4 484.7L386.4 526.6" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.40s" }} d="M415.9 528.2L415.9 484.7L426.2 484.7" />
        <path pathLength="1" strokeDasharray="0.318 0.682" className="animate-flow" style={{ animationDuration: "1.3s", animationDelay: "1.40s" }} d="M429.5 361.7L451.9 361.7L452.2 359.5L452.2 407.3L430.1 407.3" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.40s" }} d="M430.1 486.4L432 484.5L468.8 484.5L472.5 488.6" />
        <path pathLength="1" strokeDasharray="0.247 0.753" className="animate-flow" style={{ animationDuration: "1.7s", animationDelay: "1.40s" }} d="M444 486.1L444 499.2L444.4 499.6L540.3 499.6L540.7 499.2L540.7 487.9" />
      </g>
      <g className="fill-disc-heat" opacity="1.0">
        <circle cx="430.3" cy="100.4" r="1.6" />
        <circle cx="291.9" cy="60.2" r="1.6" />
        <circle cx="119.1" cy="100.4" r="1.6" />
        <circle cx="430.9" cy="149.9" r="1.6" />
        <circle cx="119.1" cy="149.9" r="1.6" />
        <circle cx="451.3" cy="199.4" r="1.6" />
        <circle cx="120.1" cy="199.4" r="1.6" />
        <circle cx="120.1" cy="248.9" r="1.6" />
        <circle cx="451.3" cy="248.9" r="1.6" />
        <circle cx="450.9" cy="298.4" r="1.6" />
        <circle cx="120.1" cy="298.4" r="1.6" />
        <circle cx="301.3" cy="306.8" r="1.6" />
        <circle cx="426.4" cy="306.8" r="1.6" />
        <circle cx="452.2" cy="359" r="1.6" />
        <circle cx="195.5" cy="356.9" r="1.6" />
        <circle cx="65.4" cy="405.5" r="1.6" />
        <circle cx="610.2" cy="405.5" r="1.6" />
        <circle cx="80.3" cy="475.7" r="1.6" />
        <circle cx="540.7" cy="487.9" r="1.6" />
        <circle cx="451.2" cy="486.1" r="1.6" />
      </g>

      {/* abluft */}
      <g className="stroke-disc-air animate-draw" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1" opacity="0.55" style={{ animationDelay: "0.25s" }}>
        <path pathLength="1" d="M196 108.6L342.1 108.6" />
        <path pathLength="1" d="M231.9 108.6L234.6 108.6" />
        <path pathLength="1" d="M239.1 108.6L252.6 108.6L258.5 112.3L263.5 112.3L266 109.9L266 109.3" />
        <path pathLength="1" d="M239.1 108.6L251.6 108.6L257.9 113L263.5 113L266 109.9" />
        <path pathLength="1" d="M268.3 108.6L307.5 108.6L311.6 104.5" />
        <path pathLength="1" d="M287.2 110.4L287.2 113L287.2 108.6L306.8 108.6" />
        <path pathLength="1" d="M310 60.3L424.6 60.3" />
        <path pathLength="1" d="M311.4 256.9L442.4 256.9" />
        <path pathLength="1" d="M311.4 207.4L440.8 207.4" />
        <path pathLength="1" d="M311.4 157.9L440.8 157.9" />
        <path pathLength="1" d="M311.6 97.4L311.6 66.3L315.6 62.3L360.1 62.3" />
        <path pathLength="1" d="M311.7 256.9L371.4 256.9" />
        <path pathLength="1" d="M311.7 207.4L389.2 207.4" />
        <path pathLength="1" d="M311.7 157.9L442 157.9" />
        <path pathLength="1" d="M311.7 60.3L418.8 60.3" />
        <path pathLength="1" d="M316.6 256.9L440.8 256.9" />
        <path pathLength="1" d="M316.6 207.4L371.4 207.4" />
        <path pathLength="1" d="M316.6 157.9L371.4 157.9" />
        <path pathLength="1" d="M316.6 60.3L371.4 60.3" />
        <path pathLength="1" d="M356.4 76L345.9 76L341 67.4L345.9 62.3L380.2 62.3L386.1 60.9L415.3 60.9L415.3 84.5" />
        <path pathLength="1" d="M394.6 60.9L398.2 60.8L398.2 59.9" />
        <path pathLength="1" d="M395.9 224L396.4 167.3L398.2 161L398.2 65.3" />
        <path pathLength="1" d="M396.8 256.4L396.8 254.6" />
        <path pathLength="1" d="M400.8 60.3L412.5 60.3" />
        <path pathLength="1" d="M401.8 207.4L442 207.4" />
        <path pathLength="1" d="M402.6 60.3L420.1 60.3" />
        <path pathLength="1" d="M410.2 91.3L429 91.3L429 55.7" />
        <path pathLength="1" d="M416.6 109L418.9 109L418.9 104.5" />
        <path pathLength="1" d="M508.9 510.8L520.6 510.7L527.3 503L527.3 488" />
        <path pathLength="1" d="M585.2 519L585.2 501.4L592.4 496" />
      </g>
      <g className="stroke-surface flow-run" fill="none" strokeWidth="0.8" strokeLinecap="round" opacity="0.9">
        <path pathLength="1" strokeDasharray="0.205 0.795" className="animate-flow" style={{ animationDuration: "2.1s", animationDelay: "1.65s" }} d="M196 108.6L342.1 108.6" />
        <path pathLength="1" strokeDasharray="0.262 0.738" className="animate-flow" style={{ animationDuration: "1.6s", animationDelay: "1.65s" }} d="M310 60.3L424.6 60.3" />
        <path pathLength="1" strokeDasharray="0.229 0.771" className="animate-flow" style={{ animationDuration: "1.9s", animationDelay: "1.65s" }} d="M311.4 256.9L442.4 256.9" />
        <path pathLength="1" strokeDasharray="0.232 0.768" className="animate-flow" style={{ animationDuration: "1.8s", animationDelay: "1.65s" }} d="M311.4 207.4L440.8 207.4" />
        <path pathLength="1" strokeDasharray="0.232 0.768" className="animate-flow" style={{ animationDuration: "1.8s", animationDelay: "1.65s" }} d="M311.4 157.9L440.8 157.9" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M311.6 97.4L311.6 66.3L315.6 62.3L360.1 62.3" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M311.7 256.9L371.4 256.9" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M311.7 207.4L389.2 207.4" />
        <path pathLength="1" strokeDasharray="0.230 0.770" className="animate-flow" style={{ animationDuration: "1.9s", animationDelay: "1.65s" }} d="M311.7 157.9L442 157.9" />
        <path pathLength="1" strokeDasharray="0.280 0.720" className="animate-flow" style={{ animationDuration: "1.5s", animationDelay: "1.65s" }} d="M311.7 60.3L418.8 60.3" />
        <path pathLength="1" strokeDasharray="0.242 0.758" className="animate-flow" style={{ animationDuration: "1.8s", animationDelay: "1.65s" }} d="M316.6 256.9L440.8 256.9" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M316.6 207.4L371.4 207.4" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M316.6 157.9L371.4 157.9" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M316.6 60.3L371.4 60.3" />
        <path pathLength="1" strokeDasharray="0.249 0.751" className="animate-flow" style={{ animationDuration: "1.7s", animationDelay: "1.65s" }} d="M356.4 76L345.9 76L341 67.4L345.9 62.3L380.2 62.3L386.1 60.9L415.3 60.9L415.3 84.5" />
        <path pathLength="1" strokeDasharray="0.189 0.811" className="animate-flow" style={{ animationDuration: "2.3s", animationDelay: "1.65s" }} d="M395.9 224L396.4 167.3L398.2 161L398.2 65.3" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M410.2 91.3L429 91.3L429 55.7" />
      </g>
      <g className="fill-disc-air" opacity="0.55">
        <circle cx="266" cy="108.6" r="1.6" />
        <circle cx="418.9" cy="109" r="1.6" />
        <circle cx="398.2" cy="60.6" r="1.6" />
      </g>

      {/* zuluft */}
      <g className="stroke-disc-air animate-draw" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1" opacity="1.0" style={{ animationDelay: "0.25s" }}>
        <path pathLength="1" d="M213.3 108.6L258 108.6" />
        <path pathLength="1" d="M239.1 108.6L259.4 108.6" />
        <path pathLength="1" d="M239.1 108.6L326.6 108.6" />
        <path pathLength="1" d="M260.3 110.4L262.8 113L268.5 113L274.7 108.6L307.5 108.6L311.6 104.5" />
        <path pathLength="1" d="M287.7 109.4L396.5 109" />
        <path pathLength="1" d="M297.9 109.4L297.9 102.5L300.6 93.3L300.6 66.3L305.6 61.4L307.5 61.4L322.1 64.8L339.2 64.8L345.5 61.7L368 61.7L372.5 60.8L381.1 60.8L381.1 60.3L368 59.9L313.6 60.3" />
        <path pathLength="1" d="M311.6 97.4L311.6 66.3L315.6 62.3L338.1 62.3L342.2 66.3L342.2 91.3L345.1 91.3" />
        <path pathLength="1" d="M312.1 256.9L315.7 256.9" />
        <path pathLength="1" d="M312.1 207.4L315.7 207.4" />
        <path pathLength="1" d="M312.1 157.9L315.7 157.9" />
        <path pathLength="1" d="M318.4 256.9L350 256.9L354.5 256.4L387.8 256.9L387.4 167.3L385.6 161L385.6 121.4L381.1 107L381.1 65.3" />
        <path pathLength="1" d="M318.4 207.4L349.6 207.4L354.1 206.9L387.4 207.4L387.4 206.9" />
        <path pathLength="1" d="M318.4 157.9L347.8 157.9L352.3 157.4L385.6 157.9" />
        <path pathLength="1" d="M319.6 256.9L381.5 256.9" />
        <path pathLength="1" d="M319.6 207.4L381.1 207.4" />
        <path pathLength="1" d="M319.6 157.9L396.9 157.9L396.9 157.4" />
        <path pathLength="1" d="M319.6 60.3L396.5 60.3" />
        <path pathLength="1" d="M330.7 73.4L330.7 91.3L339.2 91.3" />
        <path pathLength="1" d="M410.2 76L428.2 76L438.5 73.8" />
        <path pathLength="1" d="M497.1 516.7L499.1 509.1L503 502.3L505.1 494.8L505.1 486.2L509.6 488.4" />
        <path pathLength="1" d="M612.6 519.8L612.6 511.3" />
      </g>
      <g className="stroke-surface flow-run" fill="none" strokeWidth="1.1" strokeLinecap="round" opacity="0.9">
        <path pathLength="1" strokeDasharray="0.343 0.657" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M239.1 108.6L326.6 108.6" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M260.3 110.4L262.8 113L268.5 113L274.7 108.6L307.5 108.6L311.6 104.5" />
        <path pathLength="1" strokeDasharray="0.276 0.724" className="animate-flow" style={{ animationDuration: "1.6s", animationDelay: "1.65s" }} d="M287.7 109.4L396.5 109" />
        <path pathLength="1" strokeDasharray="0.154 0.846" className="animate-flow" style={{ animationDuration: "2.8s", animationDelay: "1.65s" }} d="M297.9 109.4L297.9 102.5L300.6 93.3L300.6 66.3L305.6 61.4L307.5 61.4L322.1 64.8L339.2 64.8L345.5 61.7L368 61.7L372.5 60.8L381.1 60.8L381.1 60.3L368 59.9L313.6 60.3" />
        <path pathLength="1" strokeDasharray="0.323 0.677" className="animate-flow" style={{ animationDuration: "1.3s", animationDelay: "1.65s" }} d="M311.6 97.4L311.6 66.3L315.6 62.3L338.1 62.3L342.2 66.3L342.2 91.3L345.1 91.3" />
        <path pathLength="1" strokeDasharray="0.115 0.885" className="animate-flow" style={{ animationDuration: "3.7s", animationDelay: "1.65s" }} d="M318.4 256.9L350 256.9L354.5 256.4L387.8 256.9L387.4 167.3L385.6 161L385.6 121.4L381.1 107L381.1 65.3" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M318.4 207.4L349.6 207.4L354.1 206.9L387.4 207.4L387.4 206.9" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M318.4 157.9L347.8 157.9L352.3 157.4L385.6 157.9" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M319.6 256.9L381.5 256.9" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M319.6 207.4L381.1 207.4" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M319.6 157.9L396.9 157.9L396.9 157.4" />
        <path pathLength="1" strokeDasharray="0.350 0.650" className="animate-flow" style={{ animationDuration: "1.2s", animationDelay: "1.65s" }} d="M319.6 60.3L396.5 60.3" />
      </g>
      <g className="fill-disc-air" opacity="1.0">
        <circle cx="260.3" cy="108.6" r="1.6" />
        <circle cx="297.9" cy="109.4" r="1.6" />
        <circle cx="316.6" cy="425.9" r="1.6" />
        <circle cx="311.2" cy="425.9" r="1.6" />
        <circle cx="381.1" cy="60.6" r="1.6" />
      </g>

      {/* kaltwasser */}
      <g className="stroke-disc-water animate-draw" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1" opacity="1.0" style={{ animationDelay: "0.5s" }}>
        <path pathLength="1" d="M489.7 486.7L489.7 484.8" />
      </g>

    </svg>
  );
}

/**
 * Auslegungswerte aus den Property-Sets der angeschriebenen Bauteile,
 * Position in % der Zeichenfläche — der Hero legt sie als HTML darüber.
 */
export const messpunkte = [
  {
    id: "hk",
    value: "50 / 40 °C",
    label: "Auslegung",
    tone: "heat",
    side: "left",
    left: 69.90,
    top: 33.17,
    delay: "1.00s",
  },
  {
    id: "zl",
    value: "754 × 1’304 mm",
    label: "Zuluftkanal",
    tone: "air",
    side: "left",
    left: 53.23,
    top: 15.19,
    delay: "1.15s",
  },
  {
    id: "kw",
    value: "DN 100 · 0.56 m/s",
    label: "Kaltwasser",
    tone: "water",
    side: "left",
    left: 75.86,
    top: 80.68,
    delay: "1.30s",
  },
] as const;

/** Seitenverhältnis der Zeichenfläche — der Hero rahmt damit die
 *  Fahnen deckungsgleich zum SVG ein. */
export const schnittAspect = "645.6 / 601";
