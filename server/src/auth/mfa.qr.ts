import { create as createQr } from "qrcode";

/**
 * The QR code, as geometry rather than as an image.
 *
 * ---
 *
 * **Why the server draws it at all.** The alternative is shipping an encoder
 * to the browser, and the dashboard's bundle is something every signed-in
 * person downloads for a screen almost none of them opens. The server already
 * holds the secret; turning it into a picture is the same request.
 *
 * **Why geometry and not a PNG.** Three things fall out of returning a path
 * instead of an image:
 *
 * - No `dangerouslySetInnerHTML`. An SVG *document* from the server has to be
 *   injected as markup; a `d` attribute is a string in an attribute, and the
 *   difference is the whole class of markup-injection bugs.
 * - It is sharp at any size, on any screen, and it costs about 2 kB instead of
 *   about 12.
 * - The client chooses the colours, so the quiet zone and the contrast can be
 *   drawn with the page's own tokens in both themes rather than being baked
 *   into pixels that are white in dark mode.
 *
 * One path rather than one rectangle per module, and that is not premature:
 * a version-3 symbol is 29×29, so the naive rendering is up to 841 elements
 * in the DOM for one dialog.
 *
 * **Error correction is `M`.** The default, and the right default here — `L`
 * saves a version at the cost of scanning reliability on a screen with glare,
 * and `Q`/`H` exist so a printed code survives being torn, which is not a
 * thing that happens to a dialog. An `otpauth://` URI for this firm is around
 * 100 characters, which is a 29×29 or 33×33 symbol at `M`.
 */

export type QrMatrix = {
  /** Modules per side, not pixels. The client's `viewBox` is `0 0 size size`. */
  size: number;
  /**
   * SVG path data in module units — one `M…h1v1h-1z` per dark module.
   *
   * Module units rather than pixels so that nothing here decides how large
   * the code is drawn. A QR symbol has to be rendered at an integral scale to
   * stay crisp, and the only layer that knows the available width is the one
   * doing the layout.
   */
  path: string;
};

/**
 * @throws if the text is too long to encode. Not caught here: an `otpauth`
 * URI is a fixed shape of bounded length, so this failing means the issuer or
 * the account label has become something unexpected, and a caller silently
 * rendering no QR code would turn that into "the setup screen is blank".
 */
export function qrMatrix(text: string): QrMatrix {
  const { modules } = createQr(text, { errorCorrectionLevel: "M" });
  const { size, data } = modules;

  /*
    Row-major, one rect per dark module, emitted as relative path commands.

    `h1v1h-1z` after an absolute `M x y` is four characters shorter per module
    than the equivalent absolute form, which on a 33×33 symbol with roughly
    half its modules dark is a few hundred bytes. It is also the form every
    QR-to-SVG renderer produces, so the output is comparable with theirs.
  */
  const parts: string[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y * size + x]) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }

  return { size, path: parts.join("") };
}
