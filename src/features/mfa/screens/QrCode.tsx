import type { QrMatrix } from "../types";

/**
 * The QR symbol, drawn from the matrix the server sent.
 *
 * ---
 *
 * **Always dark-on-white, in both themes.** A QR code is not a graphic that
 * should follow the palette: scanners expect dark modules on a light field,
 * and inverting it is the single commonest reason a code will not scan on a
 * phone in a dark room. So the white card is explicit rather than inherited,
 * and it is the one element in the dashboard that deliberately ignores
 * `data-theme`.
 *
 * **The quiet zone is part of the symbol.** Four modules of clear space on
 * every side, which the specification requires and which is the second
 * commonest reason a code fails — it scans on the developer's screen, where
 * the page background happens to be white, and fails on the user's, where a
 * dark panel runs right up to the edge. Expressed in the `viewBox` rather
 * than as padding, so it scales with the code instead of with the layout.
 *
 * **`shapeRendering="crispEdges"`.** Without it the renderer antialiases
 * every module boundary, and at small sizes a 33×33 symbol turns into grey
 * mush that a camera cannot threshold.
 *
 * The `<title>` is what a screen reader announces. It says what the thing is
 * and, more usefully, that there is another way — the manual key is beside
 * it on the same screen, because somebody using a screen reader is not going
 * to be photographing their own monitor.
 */
export function QrCode({ matrix, className }: { matrix: QrMatrix; className?: string }) {
  const quiet = 4;
  const total = matrix.size + quiet * 2;

  return (
    <div
      className={
        className ??
        "mx-auto w-full max-w-[15rem] rounded-lg bg-white p-3 ring-1 ring-line shadow-sm"
      }
    >
      <svg
        viewBox={`0 0 ${total} ${total}`}
        role="img"
        aria-labelledby="mfa-qr-title"
        shapeRendering="crispEdges"
        className="block h-auto w-full"
      >
        <title id="mfa-qr-title">
          QR-Code zum Einrichten der Authenticator-App. Alternativ steht der
          Einrichtungsschlüssel als Text daneben.
        </title>
        {/* The quiet zone, drawn rather than assumed — see above. */}
        <rect width={total} height={total} fill="#ffffff" />
        <g transform={`translate(${quiet} ${quiet})`}>
          {/*
            One path for the whole symbol. A version-3 code is 29×29, so the
            rectangle-per-module alternative is up to 841 elements in a
            dialog — see the server's `mfa.qr.ts`.

            `#0d1b2a` rather than `currentColor`: the field is fixed white, so
            the foreground has to be fixed too, and pure black at this scale
            reads harsher than the brand's near-black without scanning any
            better.
          */}
          <path d={matrix.path} fill="#0d1b2a" />
        </g>
      </svg>
    </div>
  );
}
